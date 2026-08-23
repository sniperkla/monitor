import { NextResponse } from 'next/server';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { sendVerificationEmail } from '@/lib/resend';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/verify-email
 * Action: 'request' -> sends a new verification code to user email
 * Action: 'confirm' -> verifies code and sets emailVerified = true
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, email, code } = body || {};

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // 1. Resend verification code request
    if (action === 'request') {
      if (user.emailVerified) {
        return NextResponse.json({ success: true, message: 'Email is already verified' });
      }

      // Rate limit: 2 minutes
      if (user.emailVerification?.lastRequestAt) {
        const elapsed = Date.now() - new Date(user.emailVerification.lastRequestAt).getTime();
        if (elapsed < 2 * 60 * 1000) {
          const remaining = Math.ceil((2 * 60 * 1000 - elapsed) / 1000);
          return NextResponse.json({
            success: false,
            error: `Please wait ${remaining} seconds before requesting a new code`
          }, { status: 429 });
        }
      }

      const verifyCode = crypto.randomInt(100000, 999999).toString();
      const codeHash = crypto.createHash('sha256').update(verifyCode).digest('hex');

      await User.findOneAndUpdate(
        { email: cleanEmail },
        {
          emailVerification: {
            codeHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            lastRequestAt: new Date(),
          }
        }
      );

      try {
        const emailResult = await sendVerificationEmail({ to: cleanEmail, code: verifyCode });
        logger.info(`[Resend] Re-sent verification code to ${cleanEmail}:`, emailResult);
        if (emailResult?.error) {
          logger.error('[Resend Error Details]:', emailResult.error);
          return NextResponse.json({
            success: false,
            error: `Failed to send email via Resend: ${emailResult.error.message || JSON.stringify(emailResult.error)}`
          }, { status: 500 });
        }
      } catch (err) {
        logger.error('[Resend Exception]:', err);
        return NextResponse.json({
          success: false,
          error: `Failed to send email: ${err.message}`
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'A new verification code has been sent to your email.',
      });
    }

    // 2. Confirm verification code
    if (action === 'confirm') {
      if (!code) {
        return NextResponse.json({ success: false, error: 'Verification code is required' }, { status: 400 });
      }

      if (!user.emailVerification?.codeHash || !user.emailVerification?.expiresAt) {
        return NextResponse.json({ success: false, error: 'No active verification code found' }, { status: 400 });
      }

      if (new Date() > new Date(user.emailVerification.expiresAt)) {
        return NextResponse.json({ success: false, error: 'Verification code has expired' }, { status: 400 });
      }

      const inputHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
      if (inputHash !== user.emailVerification.codeHash) {
        return NextResponse.json({ success: false, error: 'Invalid verification code' }, { status: 400 });
      }

      // Mark email as verified and clear token
      await User.findOneAndUpdate(
        { email: cleanEmail },
        {
          emailVerified: true,
          emailVerification: { codeHash: '', expiresAt: null, lastRequestAt: null }
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Email confirmed successfully! You can now sign in.',
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    logger.error('Verify email route error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
