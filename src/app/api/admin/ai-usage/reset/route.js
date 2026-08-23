import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import AiUsage from '@/models/AiUsage';
import { logger } from '@/lib/logger';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const adminList = String(process.env.ADMIN_EMAIL || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (adminList.length === 0 || !adminList.includes(String(session.user?.email || ''))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

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
