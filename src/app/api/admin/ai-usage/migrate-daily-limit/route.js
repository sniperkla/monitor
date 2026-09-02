import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
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

    let requestedLimit = null;
    try {
      const body = await req.json();
      const limit = Number(body?.dailyLimit);
      if (Number.isFinite(limit) && limit > 0) requestedLimit = limit;
    } catch (e) {
      // ignore invalid/missing json
    }

    const envLimit = Number(process.env.AI_DAILY_LIMIT);
    const targetLimit =
      requestedLimit ??
      (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : null);

    // Ensure the global ai_limits setting exists with the daily limit
    const result = await SystemSetting.findOneAndUpdate(
      { key: 'ai_limits' },
      {
        $setOnInsert: { key: 'ai_limits' },
        ...(targetLimit ? { $set: { 'value.dailyLimit': targetLimit } } : {}),
      },
      { upsert: true, new: true }
    );

    const dailyLimit = result?.value?.dailyLimit || 10000;

    await auditLog({
      req,
      action: 'admin.ai_limits.migrate',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { dailyLimit, requestedLimit, updated: !!targetLimit },
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      dailyLimit,
      message: targetLimit
        ? 'AI daily limit has been updated. Usage is tracked per-user in the AiUsage collection.'
        : 'AI daily limit already exists. Usage is tracked per-user in the AiUsage collection.',
    });
  } catch (error) {
    await auditLog({
      req,
      action: 'admin.ai_limits.migrate',
      userId: String(adminUser?._id || ''),
      userEmail: adminUser?.email,
      detail: { reason: 'error', error: String(error?.message || '').slice(0, 200) },
      status: 'failure',
    });
    logger.error('Migrate AI dailyLimit error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
