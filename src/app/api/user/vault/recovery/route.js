import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import crypto from 'crypto';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/serverGuard';
import { auditLog } from '@/lib/auditLog';
import { getClientIp } from '@/lib/clientIp';

const RECOVERY_RATE_LIMIT = 3;

/**
 * POST /api/user/vault/recovery
 * 
 * Sends a 6-digit recovery code to the user's email.
 * The code expires in 15 minutes.
 * Rate limited: max 1 request per 2 minutes.
 */
export async function POST(request) {
  // Outside the try so the catch can still attribute the failure.
  let session = null;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    session = await getServerSession(authOptions);
    if (!session) {
      await auditLog({
        req: request,
        action: 'vault.recovery.request',
        userId: null,
        detail: { reason: 'unauthenticated' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userKey = session.user?.id || session.user?.email || 'unknown';
    const clientIp = getClientIp(request);
    const rateCheck = checkRateLimit(`vault-recovery:${userKey}:${clientIp}`, RECOVERY_RATE_LIMIT);
    if (!rateCheck.allowed) {
      await auditLog({
        req: request,
        action: 'vault.recovery.rate_limited',
        userId: String(session.user?.id || ''),
        userEmail: session.user?.email,
        detail: { resetIn: rateCheck.resetIn },
        status: 'failure',
      });
      return NextResponse.json(
        { success: false, error: `Too many recovery-code requests. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) } }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      await auditLog({
        req: request,
        action: 'vault.recovery.request',
        userId: String(session.user?.id || ''),
        userEmail: session.user?.email,
        detail: { reason: 'user_not_found' },
        status: 'failure',
      });
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Rate limiting: 2 minutes between requests
    if (user.recovery?.lastRequestAt) {
      const elapsed = Date.now() - new Date(user.recovery.lastRequestAt).getTime();
      if (elapsed < 2 * 60 * 1000) {
        const remaining = Math.ceil((2 * 60 * 1000 - elapsed) / 1000);
        await auditLog({
          req: request,
          action: 'vault.recovery.cooldown',
          userId: String(user._id),
          userEmail: session.user?.email,
          detail: { remainingSeconds: remaining },
          status: 'failure',
        });
        return NextResponse.json({ 
          success: false, 
          error: `Please wait ${remaining} seconds before requesting a new code` 
        }, { status: 429 });
      }
    }

    // Set if the development escape hatch below actually fires. Recorded in the
    // audit entry because "a plaintext recovery code was written to disk" is
    // exactly the kind of thing that should be visible after the fact.
    let debugCodeWritten = false;

    // Generate 6-digit recovery code
    const recoveryCode = crypto.randomInt(100000, 999999).toString();
    
    // Hash the code before storing
    const codeHash = crypto
      .createHash('sha256')
      .update(recoveryCode)
      .digest('hex');

    // Store hashed code
    await User.findOneAndUpdate(
      { email: session.user.email },
      {
        recovery: {
          codeHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          lastRequestAt: new Date(),
        }
      }
    );

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const fromAddress = fromEmail.includes('@resend.dev') ? fromEmail : `SSH Monitor <${fromEmail}>`;
    
    const htmlContent = `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; text-align: center;">
            <span style="font-size: 32px; vertical-align: middle; line-height: 1;">🔐</span>
          </div>
          <h1 style="color: #fff; font-size: 24px; margin: 0 0 8px;">Vault Recovery</h1>
          <p style="color: #94a3b8; font-size: 14px; margin: 0;">SSH Monitor Security</p>
        </div>
        <div style="background: #1e293b; border-radius: 16px; padding: 32px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #94a3b8; font-size: 14px; margin: 0 0 16px;">Your recovery code is:</p>
          <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin: 0 0 16px;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #818cf8; font-family: monospace;">${recoveryCode}</span>
          </div>
          <p style="color: #64748b; font-size: 12px; margin: 0;">
            This code expires in <strong style="color: #f59e0b;">15 minutes</strong>.
          </p>
        </div>
      </div>
    `;

    logger.info(`[Vault Recovery] Code generated for user`);

    // Writing the plaintext code to RECOVERY_CODE.txt in the working directory
    // turned a secrets-in-email control into a secrets-on-disk hole: the file
    // is world-readable to anything running as the app user, is served from
    // process.cwd() (one misconfigured static route away from being public),
    // and lands in container images and backups. It also outlives the 15-minute
    // expiry that the code itself is subject to.
    //
    // The escape hatch is retained for local development only, and requires an
    // explicit opt-in on top of NODE_ENV — matching the CSRF_ENFORCE
    // kill-switch convention used elsewhere in this codebase.
    if (process.env.NODE_ENV !== 'production' && process.env.DEBUG_EXPOSE_RECOVERY_CODE === '1') {
      const debugInfo = `
============================================
🔐 RECOVERY CODE for ${session.user.email}
Code: ${recoveryCode}
Time: ${new Date().toLocaleString()}
============================================
`;
      try {
        fs.writeFileSync(path.join(process.cwd(), 'RECOVERY_CODE.txt'), debugInfo);
        logger.warn('[Vault Recovery] DEBUG: plaintext code written to RECOVERY_CODE.txt');
        debugCodeWritten = true;
      } catch (fsErr) {
        logger.error('Failed to write RECOVERY_CODE.txt');
      }
    }

    try {
      const resendRes = await resend.emails.send({
        from: fromAddress,
        to: session.user.email,
        subject: '🔐 Vault Recovery Code — SSH Monitor',
        html: htmlContent,
      });
      logger.info('Resend email sent successfully');
    } catch (emailErr) {
      logger.error('Resend email failed:', emailErr.message);
    }

    const parts = session.user.email.split('@');
    const masked = parts[0].substring(0, 2) + '***@' + parts[1];

    await auditLog({
      req: request,
      action: 'vault.recovery.request',
      userId: String(user._id),
      userEmail: session.user?.email,
      detail: {
        debugCodeWritten,
        expiresInMinutes: 15,
      },
      target: String(user._id),
      status: 'success',
    });

    return NextResponse.json({ 
      success: true, 
      message: `Recovery code sent to ${masked}`,
      maskedEmail: masked,
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'vault.recovery.request',
      userId: String(session?.user?.id || ''),
      userEmail: session?.user?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    logger.error('Recovery email error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
