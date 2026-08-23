import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { sendVerificationEmail } from '@/lib/resend';
import { logger } from '@/lib/logger';

export async function POST(request) {
  try {
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

    // Check if user already exists
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Account with this email already exists. Please sign in instead.' },
        { status: 409 }
      );
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

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      message: 'Account registered! A verification code has been sent to your email.',
      userId: newUser._id.toString(),
      email: cleanEmail,
    });
  } catch (error) {
    logger.error('❌ Registration error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Server error during registration' },
      { status: 500 }
    );
  }
}
