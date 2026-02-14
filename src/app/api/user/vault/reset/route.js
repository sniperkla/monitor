import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import crypto from 'crypto';

/**
 * POST /api/user/vault/reset
 * 
 * Verifies the recovery code and resets the vault.
 * After reset, the user must set up a new Master Password + URI.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await request.json();

    if (!code || code.length !== 6) {
      return NextResponse.json({ success: false, error: 'Invalid code format' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Check if recovery is pending
    if (!user.recovery?.codeHash || !user.recovery?.expiresAt) {
      return NextResponse.json({ 
        success: false, 
        error: 'No recovery request pending. Please request a new code.' 
      }, { status: 400 });
    }

    // Check expiry
    if (new Date() > new Date(user.recovery.expiresAt)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Recovery code has expired. Please request a new one.' 
      }, { status: 400 });
    }

    // Verify code
    const inputHash = crypto
      .createHash('sha256')
      .update(code)
      .digest('hex');

    if (inputHash !== user.recovery.codeHash) {
      return NextResponse.json({ 
        success: false, 
        error: 'Incorrect recovery code' 
      }, { status: 400 });
    }

    // ✅ Code is valid — RESET the vault
    await User.findOneAndUpdate(
      { email: session.user.email },
      {
        vault: {
          encryptedUri: '',
          salt: '',
          iv: '',
          passwordHash: '',
          isConfigured: false,
        },
        privateDbUri: '',
        recovery: {
          codeHash: '',
          expiresAt: null,
          lastRequestAt: user.recovery.lastRequestAt,
        }
      }
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Vault has been reset. You can now set up a new Master Password.' 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
