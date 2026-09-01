import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import AiUsage from '@/models/AiUsage';
import { logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/requireAdmin';

export async function POST(req) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

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

    return NextResponse.json({
      success: true,
      dayKey,
      matched: res.matchedCount ?? res.n,
      modified: res.modifiedCount ?? res.nModified,
    });
  } catch (error) {
    logger.error('Reset AI usage error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
