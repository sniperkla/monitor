import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { sendVerificationEmail } from '@/lib/resend';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/authRateLimit';

export async function POST(request) {
  try {
    // IP-based rate limit: prevent mass account creation from one source.
    const ip = getClientIp(request);
    const gate = checkRateLimit('register', ip);
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many registration attempts. Please try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.` },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    const body = await request.json();
    const { name, email, password } = body || {};

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(name || '').trim() || cleanEmail.split('@')[0];

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);

    // Check if user already exists.
    //
    // Anti-enumeration: return the SAME success-shaped response whether or not
    // the email is already registered. Previously a duplicate returned 409 and
    // a new email returned 200, which let an attacker probe which addresses
    // had accounts. Now we send a verification email for new accounts and a
    // generic "check your inbox" message for duplicates — externally identical.
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      // Resend verification if unverified; otherwise send nothing. Either way
      // the response body and status match the new-user path.
      if (!existingUser.emailVerified) {
        const verifyCode = crypto.randomInt(100000, 999999).toString();
        const codeHash = crypto.createHash('sha256').update(verifyCode).digest('hex');
        await User.updateOne(
          { _id: existingUser._id },
          {
            $set: {
              'emailVerification.codeHash': codeHash,
              'emailVerification.expiresAt': new Date(Date.now() + 15 * 60 * 1000),
              'emailVerification.lastRequestAt': new Date(),
            },
          }
        );
        try {
          await sendVerificationEmail({ to: cleanEmail, code: verifyCode });
          logger.info(`[Resend] Verification email re-sent to existing unverified user ${cleanEmail}`);
        } catch (resendErr) {
          logger.error('[Resend] Failed to re-send verification email:', resendErr.message);
        }
      }
      // Return 200 (not 409) with the same shape as a successful registration.
      // Do NOT include userId/email — the new-user path below includes them,
      // and their presence/absence would re-enable enumeration. Both paths
      // return the identical minimal body.
      return NextResponse.json({
        success: true,
        requiresVerification: true,
        message: 'Account registered! A verification code has been sent to your email.',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const isAdminEmail = !!process.env.ADMIN_EMAIL && cleanEmail === process.env.ADMIN_EMAIL;

    // Generate 6-digit confirmation code
    const verifyCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(verifyCode).digest('hex');

    const newUser = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      role: isAdminEmail ? 'admin' : 'user',
      emailVerified: false,
      emailVerification: {
        codeHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lastRequestAt: new Date(),
      },
    });

    logger.info(`🆕 New user registered via Credentials: ${cleanEmail}`);

    // Send confirmation email via Resend
    try {
      await sendVerificationEmail({ to: cleanEmail, code: verifyCode });
      logger.info(`[Resend] Verification email sent to ${cleanEmail}`);
    } catch (resendErr) {
      logger.error('[Resend] Failed to send verification email:', resendErr.message);
    }

    // Return the same minimal body as the duplicate path — no userId/email —
    // so the response is byte-identical to the "already exists" case.
    return NextResponse.json({
      success: true,
      requiresVerification: true,
      message: 'Account registered! A verification code has been sent to your email.',
    });
  } catch (error) {
    logger.error('❌ Registration error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Server error during registration' },
      { status: 500 }
    );
  }
}
