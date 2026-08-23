import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { encrypt } from '@/utils/encryption';
import { logger } from '@/lib/logger';

// GET /api/deploy/github/callback?code=...&state=...
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) return NextResponse.json({ success: false, error: 'Missing code or state' }, { status: 400 });

    await connectDB(process.env.MONGODB_URI, true);
    const stateKey = `auto_deploy_oauth_state_${state}`;
    const stateRecord = await SystemSetting.findOne({ key: stateKey });
    if (!stateRecord) return NextResponse.json({ success: false, error: 'Invalid or expired state' }, { status: 400 });

    // Reject expired state records (older than 10 minutes)
    const createdAt = stateRecord.value?.createdAt;
    if (createdAt && (Date.now() - new Date(createdAt).getTime()) > 10 * 60 * 1000) {
      await SystemSetting.deleteOne({ key: stateKey });
      return NextResponse.json({ success: false, error: 'OAuth state expired. Please try again.' }, { status: 400 });
    }

    const project = stateRecord.value?.project || 'default';

    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData || !tokenData.access_token) {
      return NextResponse.json({ success: false, error: 'GitHub token exchange failed', details: tokenData }, { status: 502 });
    }

    const accessToken = tokenData.access_token;

    // Fetch user info
    const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/vnd.github+json' } });
    const userData = await userRes.json();
    const githubUser = userData?.login || '';

    // Save token encrypted into project settings
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
    const setting = await SystemSetting.findOne({ key: dbKey });
    const existing = setting?.value || {};
    const updated = { ...existing, githubConnected: true, githubUser, githubToken: encrypt(accessToken), githubRepo: existing.githubRepo || '' };

    await SystemSetting.findOneAndUpdate({ key: dbKey }, { $set: { value: updated } }, { upsert: true });

    // Clean up state record
    await SystemSetting.deleteOne({ key: stateKey });

    // Redirect back to settings UI
    const redirectTo = (process.env.NEXTAUTH_URL || (request.headers.get('origin') || '')) + '/?tab=deployment';
    return NextResponse.redirect(redirectTo);
  } catch (error) {
    logger.error('[deploy/github/callback] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
