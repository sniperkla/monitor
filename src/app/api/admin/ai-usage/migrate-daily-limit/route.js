import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

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

    // Ensure the global ai_limits setting exists with the daily limit
    const result = await SystemSetting.findOneAndUpdate(
      { key: 'ai_limits' },
      {
        $setOnInsert: { key: 'ai_limits' },
        $set: { 'value.dailyLimit': 10000 },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      success: true,
      dailyLimit: result?.value?.dailyLimit || 10000,
      message: 'AI daily limit has been set. Usage is now tracked per-user in the AiUsage collection.',
    });
  } catch (error) {
    console.error('Migrate AI dailyLimit error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
