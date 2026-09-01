import { NextResponse } from 'next/server';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { sendPasswordResetEmail } from '@/lib/resend';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/authRateLimit';

/**
 * POST /api/auth/forgot-password
 * Generates password reset code and emails it via Resend
 */
export async function POST(request) {
  try {
    // IP-based rate limit: prevent email spraying (sending reset emails to
    // many different addresses from one source). The per-user 2-min limit
    // below only stops repeated requests for the SAME email.
    const ip = getClientIp(request);
    const gate = checkRateLimit('forgotPassword', ip);
    if (!gate.allowed) {
      return NextResponse.json({
        success: false,
        error: `Too many requests. Please try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.`,
      }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });
    }

    const body = await request.json();
    const { email } = body || {};

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email address is required' }, { status: 400 });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    await connectDB(process.env.MONGODB_URI, true);

    const user = await User.findOne({ email: cleanEmail });

    // For security, don't disclose whether a user account exists or not
    if (!user) {
      return NextResponse.json({
        success: true,
        message: 'If an account exists with that email, a password reset code has been sent.',
      });
    }

    // Rate limiting: 2 minutes between password reset requests
    if (user.passwordReset?.lastRequestAt) {
      const elapsed = Date.now() - new Date(user.passwordReset.lastRequestAt).getTime();
      if (elapsed < 2 * 60 * 1000) {
        const remaining = Math.ceil((2 * 60 * 1000 - elapsed) / 1000);
        return NextResponse.json({
          success: false,
          error: `Please wait ${remaining} seconds before requesting a new password reset code`
        }, { status: 429 });
      }
    }

    // Generate 6-digit code
    const resetCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(resetCode).digest('hex');

    await User.findOneAndUpdate(
      { email: cleanEmail },
      {
        passwordReset: {
          codeHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          lastRequestAt: new Date(),
        }
      }
    );

    let emailResult = null;
    try {
      emailResult = await sendPasswordResetEmail({ to: cleanEmail, code: resetCode });
      logger.info(`[Resend] Password reset code sent to ${cleanEmail}:`, emailResult);
      if (emailResult?.error) {
        logger.error('[Resend Error Details]:', emailResult.error);
        return NextResponse.json({
          success: false,
          error: `Failed to send email via Resend: ${emailResult.error.message || JSON.stringify(emailResult.error)}`
        }, { status: 500 });
      }
    } catch (emailErr) {
      logger.error('[Resend Exception]:', emailErr);
      return NextResponse.json({
        success: false,
        error: `Failed to send email: ${emailErr.message}`
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Password reset code has been sent to your email address.',
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
