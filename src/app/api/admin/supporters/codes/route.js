import { NextResponse } from 'next/server';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { DEFAULT_GRANT_DAYS } from '@/utils/supporter';
import { logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/requireAdmin';
import { auditLog } from '@/lib/auditLog';

export const dynamic = 'force-dynamic';

const CODES_KEY = 'supporter_codes';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — readable codes

function generateCode() {
  const group = () =>
    Array.from(crypto.randomBytes(5)).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `SUP-${group()}-${group()}-${group()}`;
}

/**
 * POST /api/admin/supporters/codes — generate N single-use activation codes.
 * Only SHA-256 hashes are stored; plaintext codes are returned once.
 * Body: { count?, planDays? }
 */
export async function POST(request) {
  let adminUser = null;
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    adminUser = auth.user;

    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
    const planDays = Math.min(Math.max(Number(body.planDays) || DEFAULT_GRANT_DAYS, 1), 3650);

    await connectDB(process.env.MONGODB_URI, true);

    const setting = await SystemSetting.findOne({ key: CODES_KEY });
    const codes = Array.isArray(setting?.value?.codes) ? setting.value.codes : [];

    const fresh = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const code = generateCode();
      fresh.push({
        code, // plaintext — returned once, stripped before saving
        planDays,
        createdAt: now,
      });
      codes.push({
        hash: crypto.createHash('sha256').update(code).digest('hex'),
        planDays,
        createdAt: now,
        usedAt: null,
        usedBy: '',
      });
    }

    // Keep the list bounded — drop claimed codes older than a year
    const trimmed = codes.filter(
      (c) => !c.usedAt || (c.createdAt && new Date(c.createdAt).getTime() > Date.now() - 365 * 24 * 3600 * 1000)
    );

    await SystemSetting.findOneAndUpdate(
      { key: CODES_KEY },
      { $set: { userId: 'system', value: { codes: trimmed } } },
      { upsert: true, new: true }
    );

    // Count and plan only — the codes themselves are bearer-equivalent
    // credentials and must never enter the audit trail.
    await auditLog({
      req: request,
      action: 'admin.supporters.codes.generate',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { count: fresh.length, planDays, totalAfter: trimmed.length },
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      planDays,
      codes: fresh.map((f) => f.code),
    });
  } catch (error) {
    await auditLog({
      req: request,
      action: 'admin.supporters.codes.generate',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    logger.error('Admin codes API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * GET /api/admin/supporters/codes — code stats (never the codes themselves).
 */
export async function GET(request) {
  let adminUser = null;
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    adminUser = auth.user;

    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: CODES_KEY });
    const codes = Array.isArray(setting?.value?.codes) ? setting.value.codes : [];
    return NextResponse.json({
      success: true,
      total: codes.length,
      used: codes.filter((c) => c.usedAt).length,
      available: codes.filter((c) => !c.usedAt).length,
    });
  } catch (error) {
    logger.error('Admin codes GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
