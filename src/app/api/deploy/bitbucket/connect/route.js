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
    console.log('[bitbucket/connect] API user response:', JSON.stringify(userData, null, 2));
    
    // Extract the username slug from the API response
    // Bitbucket API /2.0/user returns: username, display_name, nickname, account_id, uuid
    let bbUser = userData?.username || userData?.nickname || '';
    
    // If username looks like an email or is empty, try to get workspace from repositories
    if (!bbUser || bbUser.includes('@')) {
      console.log('[bitbucket/connect] Username missing or is email, fetching repos to find workspace...');
      try {
        const reposRes = await fetch('https://api.bitbucket.org/2.0/repositories?role=owner&pagelen=1', {
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
          },
        });
        if (reposRes.ok) {
          const reposData = await reposRes.json();
          const firstRepo = reposData?.values?.[0];
          const workspace = firstRepo?.workspace?.slug || firstRepo?.owner?.username || '';
          if (workspace && !workspace.includes('@')) {
            bbUser = workspace;
            console.log('[bitbucket/connect] Got username from repos workspace:', bbUser);
          }
        }
      } catch (e) {
        console.warn('[bitbucket/connect] Failed to fetch repos for workspace:', e.message);
      }
    }
    
    // If still empty or email, try to extract from raw input
    if (!bbUser || bbUser.includes('@')) {
      if (bbUser.includes('@')) {
        console.warn('[bitbucket/connect] Username still contains @, stripping domain:', bbUser);
        bbUser = bbUser.split('@')[0];
      } else {
        console.warn('[bitbucket/connect] API returned no username, falling back to raw input:', username);
        bbUser = username.includes('@') ? username.split('@')[0] : username;
      }
    }
    
    console.log('[bitbucket/connect] ✅ Resolved Bitbucket username slug:', bbUser);

    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
    const existing = setting?.value || {};

    const updated = {
      ...existing,
      bitbucketConnected: true,
      bitbucketUser: bbUser,
      bitbucketUsername: encrypt(bbUser), // use API-resolved slug, not raw email input
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
