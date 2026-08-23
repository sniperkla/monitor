import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { encrypt } from '@/utils/encryption';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

// POST /api/deploy/bitbucket/connect?project=projectId
// Body: { username, appPassword }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'default';
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;

    const { username, appPassword } = await request.json();
    if (!appPassword) {
      return NextResponse.json({ success: false, error: 'Token is required' }, { status: 400 });
    }

    // Try to validate with x-token-auth (workspace access token format)
    // Skip strict validation — git will verify the token on first fetch
    let bbUser = username || 'bitbucket';
    try {
      const credentials = Buffer.from(`x-token-auth:${appPassword}`).toString('base64');
      const userRes = await fetch('https://api.bitbucket.org/2.0/user', {
        headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        bbUser = userData?.username || username || 'bitbucket';
      }
    } catch (e) {
      // Validation failed, continue anyway — token will be verified at deploy time
    }

    await connectDB(process.env.MONGODB_URI, true);
    const userIdQuery = resolveUserIdQuery(userId);
    const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    const existing = setting?.value || {};

    const updated = {
      ...existing,
      bitbucketConnected: true,
      bitbucketUser: bbUser,
      bitbucketUsername: encrypt(username),
      bitbucketAppPassword: encrypt(appPassword),
    };

    const targetUserId = normalizeUserId(setting?.userId || userId, true);
    await SystemSetting.findOneAndUpdate({ ...resolveUserIdQuery(targetUserId), key: dbKey }, { $set: { userId: targetUserId, value: updated } }, { upsert: true });

    return NextResponse.json({ success: true, bitbucketUser: bbUser });
  } catch (error) {
    logger.error('[deploy/bitbucket/connect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/deploy/bitbucket/connect?project=projectId
// Returns connection status
export async function GET(request) {
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
    const cfg = setting?.value || {};

    return NextResponse.json({
      success: true,
      connected: !!cfg.bitbucketConnected,
      user: cfg.bitbucketUser || '',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
