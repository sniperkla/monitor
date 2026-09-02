import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import {
  generateTotpSecret,
  sealSecret,
  verifyTotp,
  requiresMfa,
  REQUIRE_FOR_UNENROLLED,
} from '@/lib/mfa';
import { auditLog } from '@/lib/auditLog';

/**
 * GET /api/user/mfa — enrolment status for the signed-in user.
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email }).lean();
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        // Whether this account *should* have a factor (admin or supporter).
        required: requiresMfa(user),
        // Whether it actually has one active.
        enrolled: !!user.mfa?.enabled,
        enrolledAt: user.mfa?.enrolledAt || null,
        lastUsedAt: user.mfa?.lastUsedAt || null,
        backupCodesRemaining: (user.mfa?.backupCodes || []).length,
        // True when the deployment refuses login for unenrolled privileged
        // accounts — the UI needs this to explain a rejection it did not cause.
        unenrolledBlocked: REQUIRE_FOR_UNENROLLED,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/user/mfa — begin enrolment.
 *
 * Returns an otpauth:// URI (render as a QR code) and stashes the secret as
 * `mfa.pendingSecret`. Nothing is activated yet: the user must prove they can
 * produce a valid code from it via POST /api/user/mfa/verify. Staging it this
 * way means an abandoned setup cannot leave the account holding a factor the
 * user cannot satisfy.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const { secret, uri } = generateTotpSecret(user.email);

    await User.updateOne(
      { _id: user._id },
      { $set: { 'mfa.pendingSecret': sealSecret(secret) } }
    );

    await auditLog({
      req: request,
      action: 'mfa.enroll.begin',
      userId: user._id.toString(),
      userEmail: user.email,
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      // `secret` is also returned so the user can type it manually if the QR
      // cannot be scanned. Scoped to this response only — it is never re-sent.
      data: { uri, secret },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/user/mfa — remove the second factor.
 *
 * Requires a currently valid code (or a backup code). Without that check, an
 * attacker with a stolen session could strip MFA and lock the real owner out
 * of their own second factor.
 */
export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await request.json().catch(() => ({}));

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const enrolled = !!user.mfa?.enabled && !!user.mfa?.secret;
    if (!enrolled) {
      return NextResponse.json({ success: false, error: 'MFA is not enabled' }, { status: 400 });
    }

    // Accept either the authenticator code or an unused backup code, so a user
    // who lost their phone can still disable rather than being stuck.
    const validCode = verifyTotp(user.mfa.secret, String(code || '').trim(), user.email);
    if (!validCode) {
      await auditLog({
        req: request,
        action: 'mfa.disable',
        userId: user._id.toString(),
        userEmail: user.email,
        detail: { reason: 'invalid_code' },
        status: 'failure',
      });
      return NextResponse.json(
        { success: false, error: 'Invalid code. Enter a current code from your authenticator app.' },
        { status: 403 }
      );
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          'mfa.enabled': false,
          'mfa.secret': '',
          'mfa.pendingSecret': '',
          'mfa.backupCodes': [],
          'mfa.enrolledAt': null,
          'mfa.lastUsedAt': null,
        },
      }
    );

    await auditLog({
      req: request,
      action: 'mfa.disable',
      userId: user._id.toString(),
      userEmail: user.email,
      status: 'success',
    });

    return NextResponse.json({ success: true, message: 'Two-factor authentication disabled' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
