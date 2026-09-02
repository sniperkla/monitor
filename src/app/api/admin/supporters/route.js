import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';
import SystemSetting from '@/models/SystemSetting';
import { extendExpiry, invalidateSupporter, DEFAULT_GRANT_DAYS } from '@/utils/supporter';
import { logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/requireAdmin';
import { maskEmail, maskName } from '@/utils/pii';

export const dynamic = 'force-dynamic';

/**
 * Kill the user's relay tokens + active relay connections.
 * server.js and Next.js routes share one process, so the globals are reachable here.
 */
function killUserRelays(email, userDoc) {
  try {
    const candidateIds = new Set([String(userDoc._id)]);
    if (userDoc.googleId) candidateIds.add(String(userDoc.googleId));

    global.__relayTokens = global.__relayTokens || new Map();
    let tokenChanged = false;
    for (const [t, e] of global.__relayTokens.entries()) {
      if ((e.email && String(e.email).toLowerCase() === email) || candidateIds.has(String(e.userId))) {
        global.__relayTokens.delete(t);
        tokenChanged = true;
      }
    }

    for (const uid of candidateIds) {
      const userRelays = global.__activeRelays?.get(uid);
      if (!userRelays) continue;
      const relayList = userRelays instanceof Map ? [...userRelays.values()] : [userRelays];
      for (const relay of relayList) {
        try { relay.ws?.send?.(JSON.stringify({ type: 'disconnect', reason: 'Supporter revoked' })); } catch (_) {}
        try { relay.ws?.close?.(4003, 'Supporter revoked'); } catch (_) {}
        try { relay.netServer?.close(); } catch (_) {}
      }
      global.__activeRelays.delete(uid);
    }

    if (tokenChanged && typeof global.__persistRelayTokens === 'function') {
      global.__persistRelayTokens().catch(() => {});
    }
  } catch (e) {
    logger.warn('killUserRelays failed:', e.message);
  }
}

/**
 * Locate the target account for a grant/revoke/dismiss action.
 *
 * Callers address the account by internal user id, not by email. `email` is
 * still accepted so older clients keep working, but it is treated as a
 * lookup key only — it is never echoed back in a response.
 */
async function findTargetUser(userId, email) {
  if (userId && typeof userId === 'string' && /^[a-f\d]{24}$/i.test(userId)) {
    return User.findById(userId);
  }
  if (email) return User.findOne({ email: String(email).toLowerCase() });
  return null;
}

/**
 * GET /api/admin/supporters — list supporters + pending access requests.
 *
 * Privacy: this response deliberately carries NO plaintext emails and NO full
 * names. Every entry is identified by its internal user id (which is what
 * POST actions take) plus a masked email/initials so the admin can still tell
 * rows apart. See src/utils/pii.js.
 */
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    await connectDB(process.env.MONGODB_URI, true);

    const docs = await User.find({
      $or: [
        { 'supporter.status': true },
        { 'supporter.request.status': 'pending' },
        { role: 'admin' },
      ],
    }).select('name email role supporter createdAt').lean();

    const now = Date.now();
    const supporters = [];
    const requests = [];
    for (const doc of docs) {
      const s = doc.supporter || {};
      const userId = String(doc._id);
      if (s.status || doc.role === 'admin') {
        supporters.push({
          userId,
          maskedEmail: maskEmail(doc.email),
          maskedName: maskName(doc.name),
          isAdmin: doc.role === 'admin',
          status: doc.role === 'admin' ? 'admin' : (s.expiresAt && new Date(s.expiresAt).getTime() <= now ? 'expired' : 'active'),
          expiresAt: s.expiresAt || null,
          source: s.source || 'admin',
          grantedAt: s.grantedAt || null,
          grantedBy: maskEmail(s.grantedBy) || '',
          note: s.note || '',
        });
      }
      if (s.request?.status === 'pending') {
        requests.push({
          userId,
          maskedEmail: maskEmail(doc.email),
          maskedName: maskName(doc.name),
          kofiName: maskName(s.request.kofiName) || '',
          kofiEmail: maskEmail(s.request.kofiEmail) || '',
          note: s.request.note || '',
          requestedAt: s.request.requestedAt || null,
        });
      }
    }

    // Recent Ko-fi webhook payments that couldn't be matched to an account —
    // surfaced in the admin panel so the admin can contact the supporter.
    // The raw webhook payload carries the payer's name and email address, so
    // those are masked here too; the admin only needs enough to recognise
    // which payment to reconcile.
    const paySetting = await SystemSetting.findOne({ key: 'kofi_payments' });
    const allPayments = Array.isArray(paySetting?.value?.payments) ? paySetting.value.payments : [];
    const kofiUnmatched = allPayments
      .filter((p) => !p.matchedEmail)
      .slice(-20)
      .reverse()
      .map((p) => ({
        messageId: p.messageId,
        fromName: maskName(p.fromName),
        fromEmail: maskEmail(p.fromEmail),
        amount: p.amount,
        currency: p.currency,
        tierName: p.tierName,
        type: p.type,
        kofiTimestamp: p.kofiTimestamp,
        receivedAt: p.receivedAt,
      }));

    return NextResponse.json({ success: true, supporters, requests, kofiUnmatched, defaultGrantDays: DEFAULT_GRANT_DAYS });
  } catch (error) {
    logger.error('Admin supporters API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/supporters — manage supporter status.
 * Body: { action: 'grant'|'revoke'|'dismiss', userId, days?, note? }
 *
 * `userId` is the preferred identifier (it is what GET returns). `email` is
 * accepted for backwards compatibility but never echoed back in a response.
 */
export async function POST(request) {
  try {
    const { user: adminUser, error } = await requireAdmin();
    if (error) return error;
    const adminEmail = adminUser?.email || '';

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    const userId = String(body.userId || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (!userId && !email) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const targetUser = await findTargetUser(userId, email);
    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Resolve the real address once, for internal use (relay kill-list,
    // cache invalidation). It is never returned to the client.
    const targetEmail = String(targetUser.email || '').toLowerCase();
    const targetLabel = maskEmail(targetEmail) || String(targetUser._id);

    if (action === 'grant') {
      const days = Number(body.days) > 0 ? Number(body.days) : DEFAULT_GRANT_DAYS;
      const s = targetUser.supporter || {};
      const newExpiry = extendExpiry(s.expiresAt, days);
      targetUser.supporter = {
        ...(s || {}),
        status: true,
        expiresAt: newExpiry,
        source: 'admin',
        grantedAt: s.grantedAt || new Date(),
        grantedBy: adminEmail,
        note: String(body.note || s.note || '').slice(0, 300),
        request: s.request?.status === 'pending' ? { ...s.request, status: 'granted' } : (s.request || { status: 'pending' }),
      };
      await targetUser.save();
      invalidateSupporter(targetEmail);
      return NextResponse.json({ success: true, message: `Granted ${days} day(s) to ${targetLabel}`, expiresAt: newExpiry });
    }

    if (action === 'revoke') {
      const s = targetUser.supporter || {};
      targetUser.supporter = { ...(s || {}), status: false };
      await targetUser.save();
      invalidateSupporter(targetEmail);
      if (global.__relaySupporterCache instanceof Map) global.__relaySupporterCache.clear();
      killUserRelays(targetEmail, targetUser);
      return NextResponse.json({ success: true, message: `Revoked supporter access for ${targetLabel}` });
    }

    if (action === 'dismiss') {
      const s = targetUser.supporter || {};
      targetUser.supporter = { ...(s || {}), request: { ...(s.request || {}), status: 'dismissed' } };
      await targetUser.save();
      return NextResponse.json({ success: true, message: `Dismissed request from ${targetLabel}` });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    logger.error('Admin supporters POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
