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

/**
 * POST /api/user/vault/recovery
 * 
 * Sends a 6-digit recovery code to the user's email.
 * The code expires in 15 minutes.
 * Rate limited: max 1 request per 2 minutes.
 */
export async function POST() {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Rate limiting: 2 minutes between requests
    if (user.recovery?.lastRequestAt) {
      const elapsed = Date.now() - new Date(user.recovery.lastRequestAt).getTime();
      if (elapsed < 2 * 60 * 1000) {
        const remaining = Math.ceil((2 * 60 * 1000 - elapsed) / 1000);
        return NextResponse.json({ 
          success: false, 
          error: `Please wait ${remaining} seconds before requesting a new code` 
        }, { status: 429 });
      }
    }

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

    // ALWAYS log/write for debugging until we confirm emails are working
    const debugInfo = `
============================================
🔐 RECOVERY CODE for ${session.user.email}
Code: ${recoveryCode}
Time: ${new Date().toLocaleString()}
============================================
`;
    logger.info(`[Vault Recovery] Code generated for user`);
    try {
      fs.writeFileSync(path.join(process.cwd(), 'RECOVERY_CODE.txt'), debugInfo);
    } catch (fsErr) {
      logger.error('Failed to write RECOVERY_CODE.txt');
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

    return NextResponse.json({ 
      success: true, 
      message: `Recovery code sent to ${masked}`,
      maskedEmail: masked,
    });
  } catch (error) {
    logger.error('Recovery email error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
