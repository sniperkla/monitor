import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';
import SystemSetting from '@/models/SystemSetting';
import { extendExpiry, invalidateSupporter, DEFAULT_GRANT_DAYS } from '@/utils/supporter';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  const adminEmail = process.env.ADMIN_EMAIL;
  if (session.user.role !== 'admin' && (!adminEmail || session.user.email !== adminEmail)) {
    return { error: NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 }) };
  }
  return { session };
}

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
    console.warn('killUserRelays failed:', e.message);
  }
}

/**
 * GET /api/admin/supporters — list supporters + pending access requests.
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
      if (s.status || doc.role === 'admin') {
        supporters.push({
          email: doc.email,
          name: doc.name,
          isAdmin: doc.role === 'admin',
          status: doc.role === 'admin' ? 'admin' : (s.expiresAt && new Date(s.expiresAt).getTime() <= now ? 'expired' : 'active'),
          expiresAt: s.expiresAt || null,
          source: s.source || 'admin',
          grantedAt: s.grantedAt || null,
          grantedBy: s.grantedBy || '',
          note: s.note || '',
        });
      }
      if (s.request?.status === 'pending') {
        requests.push({
          email: doc.email,
          name: doc.name,
          kofiName: s.request.kofiName || '',
          kofiEmail: s.request.kofiEmail || '',
          note: s.request.note || '',
          requestedAt: s.request.requestedAt || null,
        });
      }
    }

    // Recent Ko-fi webhook payments that couldn't be matched to an account —
    // surfaced in the admin panel so the admin can contact the supporter.
    const paySetting = await SystemSetting.findOne({ key: 'kofi_payments' });
    const allPayments = Array.isArray(paySetting?.value?.payments) ? paySetting.value.payments : [];
    const kofiUnmatched = allPayments
      .filter((p) => !p.matchedEmail)
      .slice(-20)
      .reverse();

    return NextResponse.json({ success: true, supporters, requests, kofiUnmatched, defaultGrantDays: DEFAULT_GRANT_DAYS });
  } catch (error) {
    console.error('Admin supporters API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/supporters — manage supporter status.
 * Body: { action: 'grant'|'revoke'|'dismiss', email, days?, note? }
 */
export async function POST(request) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;
    const adminEmail = session.user.email;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (action === 'grant') {
      const days = Number(body.days) > 0 ? Number(body.days) : DEFAULT_GRANT_DAYS;
      const s = user.supporter || {};
      const newExpiry = extendExpiry(s.expiresAt, days);
      user.supporter = {
        ...(s || {}),
        status: true,
        expiresAt: newExpiry,
        source: 'admin',
        grantedAt: s.grantedAt || new Date(),
        grantedBy: adminEmail,
        note: String(body.note || s.note || '').slice(0, 300),
        request: s.request?.status === 'pending' ? { ...s.request, status: 'granted' } : (s.request || { status: 'pending' }),
      };
      await user.save();
      invalidateSupporter(email);
      return NextResponse.json({ success: true, message: `Granted ${days} day(s) to ${email}`, expiresAt: newExpiry });
    }

    if (action === 'revoke') {
      const s = user.supporter || {};
      user.supporter = { ...(s || {}), status: false };
      await user.save();
      invalidateSupporter(email);
      if (global.__relaySupporterCache instanceof Map) global.__relaySupporterCache.clear();
      killUserRelays(email, user);
      return NextResponse.json({ success: true, message: `Revoked supporter access for ${email}` });
    }

    if (action === 'dismiss') {
      const s = user.supporter || {};
      user.supporter = { ...(s || {}), request: { ...(s.request || {}), status: 'dismissed' } };
      await user.save();
      return NextResponse.json({ success: true, message: `Dismissed request from ${email}` });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Admin supporters POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
