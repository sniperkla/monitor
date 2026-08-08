import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * POST /api/rclone/oauth
 *
 * Starts a Google Drive OAuth flow on the remote server via SSH.
 * Uses `rclone authorize` with --auth-no-open-browser so it prints
 * the Google auth URL without needing a local browser on the server.
 *
 * The user visits the URL, Google redirects to:
 *   https://monitor.eaqdragon.com/api/rclone/oauth/callback
 *
 * That callback route exchanges the code and writes the token.
 *
 * Body: { connectionId, remoteName, clientId, clientSecret, scope? }
 */
export async function POST(req) {
  try {
    const { connectionId, remoteName, clientId, clientSecret, scope = 'drive' } = await req.json();

    if (!connectionId || !remoteName || !clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: 'connectionId, remoteName, clientId, and clientSecret are required' },
        { status: 400 }
      );
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const host = req.headers.get('host') || 'monitor.eaqdragon.com';
    const proto = host.includes('localhost') ? 'http' : 'https';
    const callbackUrl = `${proto}://${host}/api/rclone/oauth/callback`;

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

    // Build the Google OAuth URL manually — rclone's drive auth URL format
    // We don't run rclone authorize here because it needs an interactive TTY.
    // Instead, build the URL directly using Google's OAuth endpoint.
    const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
    const SCOPES = {
      drive: 'https://www.googleapis.com/auth/drive',
      'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
      'drive.file': 'https://www.googleapis.com/auth/drive.file',
    };
    const driveScope = SCOPES[scope] || SCOPES['drive'];

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: driveScope,
      access_type: 'offline',
      prompt: 'consent',
      // Store context in state so callback knows which server/remote to write to
      state: Buffer.from(JSON.stringify({ connectionId, remoteName, clientId, clientSecret, scope })).toString('base64url'),
    });

    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

    // Verify rclone is installed on remote before starting
    const checkRes = await execCommand(sshConfig, `${pathPrefix}command -v rclone >/dev/null 2>&1 || [ -x "$HOME/.local/bin/rclone" ] && echo "OK" || echo "NOT_FOUND"`);
    if (!checkRes.stdout?.includes('OK')) {
      return NextResponse.json({ success: false, error: 'rclone is not installed on the remote server' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      authUrl,
      callbackUrl,
      remoteName,
    });

  } catch (error) {
    console.error('[rclone/oauth POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
