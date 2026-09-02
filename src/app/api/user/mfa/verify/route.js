import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { generateTotpSecret, verifyTotp } from '@/lib/mfa';
import { auditLog } from '@/lib/auditLog';

/**
 * POST /api/user/mfa/verify — confirm enrolment and activate the factor.
 *
 * Body: { code: string }  — a 6-digit code from the pending secret.
 *
 * On success the pending secret is promoted to the active secret, MFA is
 * enabled, and a fresh set of single-use recovery codes is issued. The codes
 * are returned exactly once, in this response, and only their SHA-256 hashes
 * are stored.
 */

function hashBackupCode(code) {
  return crypto
    .createHash('sha256')
    .update(String(code).replace(/-/g, '').toUpperCase())
    .digest('hex');
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await request.json().catch(() => ({}));
    const submitted = String(code || '').replace(/\D/g, '');
    if (submitted.length !== 6) {
      return NextResponse.json(
        { success: false, error: 'Enter the 6-digit code from your authenticator app.' },
        { status: 400 }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (!user.mfa?.pendingSecret) {
      return NextResponse.json(
        { success: false, error: 'No pending enrolment. Start setup again.' },
        { status: 400 }
      );
    }

    if (!verifyTotp(user.mfa.pendingSecret, submitted, user.email)) {
      await auditLog({
        req: request,
        action: 'mfa.enroll.verify',
        userId: user._id.toString(),
        userEmail: user.email,
        detail: { reason: 'invalid_code' },
        status: 'failure',
      });
      return NextResponse.json(
        { success: false, error: 'That code is not valid. Wait for a new one and try again.' },
        { status: 400 }
      );
    }

    // Codes are regenerated on every successful (re)enrolment, which
    // invalidates any set the user previously printed.
    const { backupCodes } = generateTotpSecret(user.email);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          'mfa.enabled': true,
          'mfa.secret': user.mfa.pendingSecret,
          'mfa.pendingSecret': '',
          'mfa.enrolledAt': new Date(),
          'mfa.backupCodes': backupCodes.map(hashBackupCode),
        },
      }
    );

    await auditLog({
      req: request,
      action: 'mfa.enroll.verify',
      userId: user._id.toString(),
      userEmail: user.email,
      detail: { backupCodesIssued: backupCodes.length },
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication enabled',
      data: {
        backupCodes,
        warning:
          'Save these recovery codes now. They are shown only once and each can be used a single time.',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
