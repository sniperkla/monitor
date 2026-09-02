import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import crypto from 'crypto';
import { auditLog } from '@/lib/auditLog';

/**
 * POST /api/user/vault/reset
 * 
 * Verifies the recovery code and resets the vault.
 * After reset, the user must set up a new Master Password + URI.
 *
 * Audit note: the recovery code is a six-digit bearer credential. Every branch
 * below is audited, and none of them may ever write the submitted value — the
 * trail records that an attempt failed and why, never the guess itself.
 */
export async function POST(request) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
    if (!session) {
      await auditLog({
        req: request,
        action: 'vault.reset',
        userId: null,
        detail: { reason: 'unauthenticated' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await request.json();

    if (!code || code.length !== 6) {
      await auditLog({
        req: request,
        action: 'vault.reset',
        userId: String(session.user?.id || ''),
        userEmail: session.user?.email,
        detail: { reason: 'malformed_code' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Invalid code format' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      await auditLog({
        req: request,
        action: 'vault.reset',
        userId: String(session.user?.id || ''),
        userEmail: session.user?.email,
        detail: { reason: 'user_not_found' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Check if recovery is pending
    if (!user.recovery?.codeHash || !user.recovery?.expiresAt) {
      await auditLog({
        req: request,
        action: 'vault.reset',
        userId: String(user._id),
        userEmail: session.user?.email,
        detail: { reason: 'no_pending_recovery' },
        status: 'failure',
      });
      return NextResponse.json({ 
        success: false, 
        error: 'No recovery request pending. Please request a new code.' 
      }, { status: 400 });
    }

    // Check expiry
    if (new Date() > new Date(user.recovery.expiresAt)) {
      await auditLog({
        req: request,
        action: 'vault.reset',
        userId: String(user._id),
        userEmail: session.user?.email,
        detail: { reason: 'expired' },
        status: 'failure',
      });
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
      // The one signal that matters most here: a 6-digit code has 900k
      // possible values, so the rate limit is the real control — but without
      // this entry there is no way to tell a determined guessing run from a
      // user fat-fingering their own code.
      await auditLog({
        req: request,
        action: 'vault.reset.code_rejected',
        userId: String(user._id),
        userEmail: session.user?.email,
        detail: { reason: 'code_mismatch' },
        status: 'failure',
      });
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

    // Destructive and irreversible: the encrypted contents are gone and there
    // is no server-side copy to restore from. Record that it happened and who
    // did it, so "my vault is empty" has an answer.
    await auditLog({
      req: request,
      action: 'vault.reset',
      userId: String(user._id),
      userEmail: session.user?.email,
      detail: { reason: 'code_accepted' },
      target: String(user._id),
      status: 'success',
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Vault has been reset. You can now set up a new Master Password.' 
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'vault.reset',
      userId: String(session?.user?.id || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
