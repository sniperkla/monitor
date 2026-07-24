import { Resend } from 'resend';

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Resend] RESEND_API_KEY environment variable is not defined.');
  }
  return new Resend(process.env.RESEND_API_KEY);
};

export const getFromAddress = () => {
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  return fromEmail.includes('@resend.dev') ? fromEmail : `SSH Monitor <${fromEmail}>`;
};

/**
 * Send email confirmation code via Resend
 */
export async function sendVerificationEmail({ to, code }) {
  const resend = getResendClient();
  const from = getFromAddress();

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background-color: #0b0f19; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1, #06b6d4); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; text-align: center;">
          <span style="font-size: 32px; vertical-align: middle; line-height: 1;">✉️</span>
        </div>
        <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 0 0 8px;">Confirm Your Email</h1>
        <p style="color: #94a3b8; font-size: 14px; margin: 0;">SSH Monitor Security</p>
      </div>
      <div style="background: #1e293b; border-radius: 16px; padding: 32px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 16px;">Your email verification code is:</p>
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin: 0 0 16px; border: 1px solid #334155;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          This code will expire in <strong style="color: #f59e0b;">15 minutes</strong>. If you did not create an account, please ignore this email.
        </p>
      </div>
    </div>
  `;

  return await resend.emails.send({
    from,
    to,
    subject: '✉️ Confirm Your Email Address — SSH Monitor',
    html,
  });
}

/**
 * Send password reset code via Resend
 */
export async function sendPasswordResetEmail({ to, code }) {
  const resend = getResendClient();
  const from = getFromAddress();

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background-color: #0b0f19; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f43f5e, #8b5cf6); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; text-align: center;">
          <span style="font-size: 32px; vertical-align: middle; line-height: 1;">🔑</span>
        </div>
        <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 0 0 8px;">Reset Password</h1>
        <p style="color: #94a3b8; font-size: 14px; margin: 0;">SSH Monitor Account Recovery</p>
      </div>
      <div style="background: #1e293b; border-radius: 16px; padding: 32px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 16px;">You requested to reset your password. Use code:</p>
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin: 0 0 16px; border: 1px solid #334155;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #f43f5e; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          This code expires in <strong style="color: #f59e0b;">15 minutes</strong>. If you did not request a password reset, your account is safe.
        </p>
      </div>
    </div>
  `;

  return await resend.emails.send({
    from,
    to,
    subject: '🔑 Password Reset Code — SSH Monitor',
    html,
  });
}
