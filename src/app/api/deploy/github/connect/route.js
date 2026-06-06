import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import crypto from 'crypto';

// GET /api/deploy/github/connect?project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const project = url.searchParams.get('project') || 'default';

    const state = crypto.randomBytes(16).toString('hex');

    await connectDB(process.env.MONGODB_URI, true);
    // Save temporary state mapping
    await SystemSetting.findOneAndUpdate(
      { key: `auto_deploy_oauth_state_${state}` },
      { $set: { value: { project, createdAt: new Date() } } },
      { upsert: true }
    );

    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = `${process.env.NEXTAUTH_URL || (request.headers.get('origin') || '')}/api/deploy/github/callback`;
    const scope = 'repo';

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state
    });

    const githubUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    return NextResponse.redirect(githubUrl);
  } catch (error) {
    console.error('[deploy/github/connect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
