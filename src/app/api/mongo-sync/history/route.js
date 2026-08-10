import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const db = await connectDB();
    const repo = new SystemSettingRepository(db, userId);
    await repo.init();

    const historySetting = await repo.findOne({ key: 'mongo_sync_history' });
    const history = historySetting?.value || [];

    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    console.error('Fetch Sync History error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const db = await connectDB();
    const repo = new SystemSettingRepository(db, userId);
    await repo.init();

    await repo.upsert('mongo_sync_history', []);

    return NextResponse.json({ success: true, data: [] });
  } catch (error) {
    console.error('Clear Sync History error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
