import { NextResponse } from 'next/server';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';
import SystemSetting from '@/models/SystemSetting';
import { extendExpiry, invalidateSupporter } from '@/utils/supporter';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PAYMENTS_KEY = 'kofi_payments';
const MAX_LOG = 200; // bounded ring of recent payments (also the dedupe set)

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Constant-time comparison of the Ko-fi verification token. */
function verifyToken(received) {
  const expected = process.env.KOFI_WEBHOOK_TOKEN;
  if (!expected || typeof received !== 'string' || !received) return false;
  const a = crypto.createHash('sha256').update(received).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Find the account a Ko-fi payment belongs to. Match priority:
 *   1. account email == payment email
 *   2. pending/granted access request submitted with this Ko-fi/payment email
 *   3. access request submitted with this Ko-fi display name (case-insensitive)
 */
async function matchUser(fromEmail, fromName) {
  const email = String(fromEmail || '').trim().toLowerCase();
  const name = String(fromName || '').trim();
  if (email && email !== 'null') {
    const byEmail = await User.findOne({ $or: [{ email }, { 'supporter.request.kofiEmail': email }] }).lean();
    if (byEmail) return byEmail;
  }
  if (name) {
    const byName = await User.findOne({
      'supporter.request.kofiName': new RegExp(`^${escapeRegex(name)}$`, 'i'),
    }).lean();
    if (byName) return byName;
  }
  return null;
}

/**
 * POST /api/webhooks/kofi — Ko-fi payment webhook.
 *
 * Ko-fi posts application/x-www-form-urlencoded with a single `data` field
 * containing a JSON string. The verification_token must match
 * KOFI_WEBHOOK_TOKEN. message_id is deduped so Ko-fi's retries never
 * double-grant. Subscriptions grant KOFI_GRANT_DAYS (default 31); tips only
 * grant when KOFI_TIP_GRANT_DAYS is set. Unmatched payments are logged for
 * the admin panel. Always 200 once the token checks out.
 */
export async function POST(request) {
  let data;
  try {
    const form = await request.formData();
    data = JSON.parse(String(form.get('data') || '{}'));
  } catch (_) {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ success: false, error: 'bad payload' }, { status: 400 });
  }
  if (!verifyToken(data.verification_token)) {
    return NextResponse.json({ success: false, error: 'invalid token' }, { status: 401 });
  }
  const messageId = String(data.message_id || '');
  if (!messageId) {
    return NextResponse.json({ success: false, error: 'missing message_id' }, { status: 400 });
  }

  try {
    await connectDB(process.env.MONGODB_URI, true);

    const setting = await SystemSetting.findOne({ key: PAYMENTS_KEY });
    const payments = Array.isArray(setting?.value?.payments) ? setting.value.payments : [];
    if (payments.some((p) => p.messageId === messageId)) {
      return NextResponse.json({ success: true, duplicate: true }); // retried message — already processed
    }

    const type = String(data.type || '');
    const isSubscription = data.is_subscription_payment === true || type === 'Subscription';
    const grantDays = isSubscription
      ? Number(process.env.KOFI_GRANT_DAYS) || 31
      : (type === 'Donation' || type === 'Tip') && Number(process.env.KOFI_TIP_GRANT_DAYS) > 0
        ? Number(process.env.KOFI_TIP_GRANT_DAYS)
        : 0;

    const fromEmail = String(data.from_email || '').trim().toLowerCase();
    const fromName = String(data.from_name || '').trim();
    const matched = await matchUser(fromEmail, fromName);

    let grantedDays = 0;
    if (matched && grantDays > 0) {
      const user = await User.findOne({ _id: matched._id }); // re-fetch as a doc so we can save
      const s = user.supporter || {};
      user.supporter = {
        ...s,
        status: true,
        expiresAt: extendExpiry(s.expiresAt, grantDays),
        source: 'kofi',
        grantedAt: s.grantedAt || new Date(),
        grantedBy: 'ko-fi webhook',
        note: `Ko-fi ${data.tier_name || type}${data.amount ? ` — ${data.amount} ${data.currency || ''}` : ''}`.trim().slice(0, 300),
        request: s.request?.status === 'pending' ? { ...s.request, status: 'granted' } : (s.request || { status: 'pending' }),
      };
      await user.save();
      grantedDays = grantDays;
      invalidateSupporter(user.email); // clears both caches — see src/utils/supporter.js
    }

    payments.push({
      messageId,
      type,
      tierName: data.tier_name || '',
      isSubscription,
      fromName,
      fromEmail: fromEmail && fromEmail !== 'null' ? fromEmail : '',
      amount: String(data.amount || ''),
      currency: String(data.currency || ''),
      kofiTimestamp: data.timestamp || null,
      receivedAt: new Date(),
      matchedEmail: matched?.email || null,
      grantedDays,
    });
    const trimmed = payments.slice(-MAX_LOG);

    await SystemSetting.findOneAndUpdate(
      { key: PAYMENTS_KEY },
      { $set: { userId: 'system', value: { payments: trimmed } } },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, matched: !!matched, grantedDays });
  } catch (error) {
    // Nothing was logged or granted, so let Ko-fi retry (same message_id is
    // deduped once it eventually lands) rather than silently losing a payment.
    logger.error('Ko-fi webhook error (message_id:', messageId + '):', error.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
