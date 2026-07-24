import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

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

    const newUser = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      role: isAdminEmail ? 'admin' : 'user',
    });

    console.log(`🆕 New user registered via Credentials: ${cleanEmail}`);

    return NextResponse.json({
      success: true,
      message: 'Account registered successfully! You can now log in.',
      userId: newUser._id.toString(),
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Server error during registration' },
      { status: 500 }
    );
  }
}
