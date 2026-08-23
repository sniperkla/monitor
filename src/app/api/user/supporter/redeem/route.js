import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';
import SystemSetting from '@/models/SystemSetting';
import { extendExpiry, invalidateSupporter, DEFAULT_GRANT_DAYS } from '@/utils/supporter';

export const dynamic = 'force-dynamic';

const CODES_KEY = 'supporter_codes';

/**
 * POST /api/user/supporter/redeem — redeem a single-use activation code.
 * Codes are stored SHA-256 hashed; redemption stacks onto any unexpired remainder.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const email = String(session.user.email).trim().toLowerCase();

    const body = await request.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || code.length < 6) {
      return NextResponse.json({ success: false, error: 'Please enter a valid activation code.' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const setting = await SystemSetting.findOne({ key: CODES_KEY });
    const codes = setting?.value?.codes;
    if (!Array.isArray(codes)) {
      return NextResponse.json({ success: false, error: 'Invalid activation code.' }, { status: 400 });
    }

    const match = codes.find((c) => c && c.hash === codeHash);
    if (!match) {
      return NextResponse.json({ success: false, error: 'Invalid activation code.' }, { status: 400 });
    }
    if (match.usedAt) {
      return NextResponse.json({ success: false, error: 'This code has already been used.' }, { status: 400 });
    }

    const planDays = Number(match.planDays) > 0 ? Number(match.planDays) : DEFAULT_GRANT_DAYS;

    // Atomically claim the code (guards double-submit races)
    const claimed = await SystemSetting.findOneAndUpdate(
      { key: CODES_KEY, 'codes.hash': codeHash, 'codes.usedAt': { $in: [null, undefined] } },
      { $set: { 'codes.$.usedAt': new Date(), 'codes.$.usedBy': email } },
      { new: true }
    );
    if (!claimed) {
      return NextResponse.json({ success: false, error: 'This code has already been used.' }, { status: 400 });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
    }

    const newExpiry = extendExpiry(user.supporter?.expiresAt, planDays);
    user.supporter = {
      ...(user.supporter || {}),
      status: true,
      expiresAt: newExpiry,
      source: 'code',
      grantedAt: user.supporter?.grantedAt || new Date(),
      grantedBy: '',
      note: user.supporter?.note || '',
      request: user.supporter?.request || { status: 'pending' },
    };
    if (user.supporter.request && user.supporter.request.status === 'pending') {
      user.supporter.request.status = 'granted';
    }
    await user.save();

    invalidateSupporter(email);

    return NextResponse.json({
      success: true,
      message: `Supporter activated for ${planDays} day${planDays === 1 ? '' : 's'}.`,
      expiresAt: newExpiry,
    });
  } catch (error) {
    console.error('Supporter redeem API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
