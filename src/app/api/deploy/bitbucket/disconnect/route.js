import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

// POST /api/deploy/bitbucket/disconnect?project=projectId
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'default';
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;

    await connectDB(process.env.MONGODB_URI, true);
    const userIdQuery = resolveUserIdQuery(userId);
    const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    if (!setting || !setting.value) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const cfg = setting.value;
    const updated = {
      ...cfg,
      bitbucketConnected: false,
      bitbucketUser: '',
      bitbucketUsername: '',
      bitbucketAppPassword: '',
    };
    await SystemSetting.findOneAndUpdate({ userId, key: dbKey }, { $set: { value: updated } });

    return NextResponse.json({ success: true, message: 'Disconnected Bitbucket for project' });
  } catch (error) {
    logger.error('[deploy/bitbucket/disconnect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
