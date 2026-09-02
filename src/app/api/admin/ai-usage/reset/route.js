import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import AiUsage from '@/models/AiUsage';
import { logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/requireAdmin';
import { auditLog } from '@/lib/auditLog';

export async function POST(req) {
  let adminUser = null;
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;
    adminUser = auth.user;

    await connectDB(process.env.MONGODB_URI, true);

    // Calculate today's day key in UTC+7
    const now = new Date();
    const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dayKey = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;

    // Reset all users' AI usage for today
    const res = await AiUsage.updateMany(
      {},
      {
        $set: {
          tokensUsed: 0,
          dayKey: dayKey,
          lastUpdated: now,
        },
      }
    );

    const matched = res.matchedCount ?? res.n;
    const modified = res.modifiedCount ?? res.nModified;

    // Tenant-wide mutation: record the blast radius, not just that it happened.
    await auditLog({
      req,
      action: 'admin.ai_usage.reset',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { dayKey, matched, modified },
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      dayKey,
      matched,
      modified,
    });
  } catch (error) {
    await auditLog({
      req,
      action: 'admin.ai_usage.reset',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    logger.error('Reset AI usage error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
