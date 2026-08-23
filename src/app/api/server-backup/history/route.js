import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { logger } from '@/lib/logger';

const HISTORY_KEY = 'server_backup_history';
const MAX_ENTRIES = 100;

// GET — load backup history
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    await connectDB();
    const setting = await SystemSetting.findOne({ key: HISTORY_KEY });
    return NextResponse.json({ success: true, history: setting?.value || [] });
  } catch (error) {
    logger.error('[server-backup/history] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — save backup history (replaces entire list)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { history } = body;

    if (!Array.isArray(history)) {
      return NextResponse.json({ success: false, error: 'history must be an array' }, { status: 400 });
    }

    // Cap at MAX_ENTRIES
    const trimmed = history.slice(0, MAX_ENTRIES);

    await connectDB();
    await SystemSetting.findOneAndUpdate(
      { key: HISTORY_KEY },
      { $set: { value: trimmed } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[server-backup/history] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
