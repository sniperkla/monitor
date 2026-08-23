import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/reset-password
 * Verifies code & updates user's password
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { email, code, newPassword } = body || {};

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Email, code, and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, error: 'New password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();
    await connectDB(process.env.MONGODB_URI, true);

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid email or code' }, { status: 400 });
    }

    if (!user.passwordReset?.codeHash || !user.passwordReset?.expiresAt) {
      return NextResponse.json({ success: false, error: 'No active password reset request found' }, { status: 400 });
    }

    if (new Date() > new Date(user.passwordReset.expiresAt)) {
      return NextResponse.json({ success: false, error: 'Password reset code has expired. Please request a new one.' }, { status: 400 });
    }

    const inputHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
    if (inputHash !== user.passwordReset.codeHash) {
      return NextResponse.json({ success: false, error: 'Invalid password reset code' }, { status: 400 });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await User.findOneAndUpdate(
      { email: cleanEmail },
      {
        password: hashedPassword,
        passwordReset: { codeHash: '', expiresAt: null, lastRequestAt: null },
      }
    );

    logger.info(`🔑 Password reset successfully for user: ${cleanEmail}`);

    return NextResponse.json({
      success: true,
      message: 'Your password has been reset successfully! You can now log in with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
