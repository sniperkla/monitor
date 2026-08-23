import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { decrypt } from '@/utils/encryption';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

// POST /api/deploy/github/disconnect?project=projectId
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
    const encryptedToken = cfg.githubToken;
    let token = null;
    try {
      token = encryptedToken ? decrypt(encryptedToken) : null;
    } catch (e) {
      token = null;
    }

    // Attempt to revoke token if client credentials are available
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (token && clientId && clientSecret) {
      try {
        const revokeUrl = `https://api.github.com/applications/${clientId}/token`;
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        await fetch(revokeUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'monitor-app'
          },
          body: JSON.stringify({ access_token: token })
        });
      } catch (err) {
        logger.warn('GitHub token revoke failed:', err.message);
      }
    }

    // Clear token and mark disconnected
    const updated = { ...cfg, githubConnected: false, githubUser: '', githubToken: '', githubRepo: cfg.githubRepo || '' };
    await SystemSetting.findOneAndUpdate({ userId, key: dbKey }, { $set: { value: updated } });

    return NextResponse.json({ success: true, message: 'Disconnected GitHub for project' });
  } catch (error) {
    logger.error('[deploy/github/disconnect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
