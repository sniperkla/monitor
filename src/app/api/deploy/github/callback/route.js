import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { encrypt } from '@/utils/encryption';
import { resolveUserIdQuery, normalizeUserId, validateProjectId } from '@/lib/deployUserQuery';
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

    // Atomic single-use consume. The previous findOne() + deleteOne() pair left
    // a replay window: two callbacks carrying the same state would both pass
    // the lookup before either deleted the record.
    const stateRecord = await SystemSetting.findOneAndDelete({ key: stateKey });
    if (!stateRecord) return NextResponse.json({ success: false, error: 'Invalid or expired state' }, { status: 400 });

    // Reject expired state records (older than 10 minutes)
    const createdAt = stateRecord.value?.createdAt;
    if (createdAt && (Date.now() - new Date(createdAt).getTime()) > 10 * 60 * 1000) {
      return NextResponse.json({ success: false, error: 'OAuth state expired. Please try again.' }, { status: 400 });
    }

    // The state MUST name the user who started the flow. It is written by
    // /api/deploy/github/connect from a live session; this callback has no
    // session of its own to trust (it is a redirect from github.com), so this
    // field is the only attributable link back to the initiator.
    //
    // Without it the write below has no owner, which is how the token ended up
    // attributed to "whichever auto_deploy_config document Mongo returned
    // first" — a cross-tenant write.
    const stateUserId = stateRecord.value?.userId || stateRecord.userId;
    if (!stateUserId) {
      logger.warn('[deploy/github/callback] state record carries no userId — refusing to attribute the token');
      return NextResponse.json({ success: false, error: 'Invalid OAuth state' }, { status: 400 });
    }

    let userId;
    try {
      userId = normalizeUserId(stateUserId);
    } catch (err) {
      logger.warn('[deploy/github/callback] state record carries an unusable userId');
      return NextResponse.json({ success: false, error: 'Invalid OAuth state' }, { status: 400 });
    }

    // Defence in depth: if the browser still carries a session, it must be the
    // same account that started the flow. A mismatch means someone handed this
    // callback URL to a different logged-in user (OAuth CSRF). A missing
    // session is tolerated — the state binding above already covers it, and
    // requiring one would break the flow for users whose session lapsed during
    // the 10-minute window.
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionUserId = session?.user?.id || session?.user?.sub || null;
    if (sessionUserId && String(sessionUserId) !== String(userId)) {
      logger.warn('[deploy/github/callback] session user does not match OAuth state owner — refusing');
      return NextResponse.json({ success: false, error: 'OAuth state does not belong to this session' }, { status: 403 });
    }

    const project = validateProjectId(stateRecord.value?.project);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Invalid project in OAuth state' }, { status: 400 });
    }

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

    // Save token encrypted into the INITIATOR'S project settings.
    //
    // Both the read and the write are scoped by userId. They previously matched
    // on `key` alone, and because SystemSetting is unique on (userId, key),
    // every tenant with a `default` project owns a document with the same key —
    // so an unscoped findOneAndUpdate wrote the GitHub token into an arbitrary
    // tenant's config. That is an account-linking primitive: the victim's
    // deploys would then pull the attacker's repository.
    const dbKey = project === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${project}`;
    const userIdQuery = resolveUserIdQuery(userId);

    const setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    const existing = setting?.value || {};
    const updated = { ...existing, githubConnected: true, githubUser, githubToken: encrypt(accessToken), githubRepo: existing.githubRepo || '' };

    await SystemSetting.findOneAndUpdate(
      { ...userIdQuery, key: dbKey },
      { $set: { userId, key: dbKey, value: updated } },
      { upsert: true }
    );

    // Redirect back to settings UI
    const redirectTo = (process.env.NEXTAUTH_URL || (request.headers.get('origin') || '')) + '/?tab=deployment';
    return NextResponse.redirect(redirectTo);
  } catch (error) {
    logger.error('[deploy/github/callback] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
