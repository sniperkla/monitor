import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import crypto from 'crypto';
import { normalizeUserId, validateProjectId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

// GET /api/deploy/github/connect?project=projectId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const url = new URL(request.url);
    const project = validateProjectId(url.searchParams.get('project'));
    if (!project) {
      return NextResponse.json({ success: false, error: 'Invalid project id' }, { status: 400 });
    }

    const state = crypto.randomBytes(16).toString('hex');

    await connectDB(process.env.MONGODB_URI, true);
    // Clean up expired state records (older than 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await SystemSetting.deleteMany({
      key: { $regex: '^auto_deploy_oauth_state_' },
      'value.createdAt': { $lt: tenMinutesAgo }
    });

    // Save temporary state mapping, BOUND TO THE INITIATING USER.
    //
    // /api/deploy/github/callback is reached by a top-level browser redirect
    // from github.com, so it has to recover "whose project is this?" from this
    // record alone. Storing only `project` made the state a bearer token for
    // "write a GitHub token into the default project of whoever Mongo returns
    // first" — an attacker could hand their own state+code to a logged-in
    // victim and have the victim's browser link the attacker's GitHub account
    // (and, because the callback's write was unscoped, possibly a third
    // party's project config). The userId field is what makes the callback
    // attributable.
    await SystemSetting.findOneAndUpdate(
      { userId, key: `auto_deploy_oauth_state_${state}` },
      { $set: { userId, value: { project, userId: String(userId), createdAt: new Date() } } },
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
    logger.error('[deploy/github/connect] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
