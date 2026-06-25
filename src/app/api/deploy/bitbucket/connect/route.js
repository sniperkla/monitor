import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { encrypt } from '@/utils/encryption';

// POST /api/deploy/bitbucket/connect?project=projectId
// Body: { username, appPassword }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'default';
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;

    const { username, appPassword } = await request.json();
    if (!username || !appPassword) {
      return NextResponse.json({ success: false, error: 'Username and app password are required' }, { status: 400 });
    }

    // Validate credentials by fetching user info
    const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const userRes = await fetch('https://api.bitbucket.org/2.0/user', {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      return NextResponse.json({ success: false, error: 'Invalid Bitbucket credentials' }, { status: 401 });
    }

    const userData = await userRes.json();
    const bbUser = userData?.username || username;

    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
    const existing = setting?.value || {};

    const updated = {
      ...existing,
      bitbucketConnected: true,
      bitbucketUser: bbUser,
      bitbucketUsername: encrypt(username),
      bitbucketAppPassword: encrypt(appPassword),
    };

    await SystemSetting.findOneAndUpdate({ key: dbKey }, { $set: { value: updated } }, { upsert: true });

    return NextResponse.json({ success: true, bitbucketUser: bbUser });
  } catch (error) {
    console.error('[deploy/bitbucket/connect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/deploy/bitbucket/connect?project=projectId
// Returns connection status
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'default';
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;

    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
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
