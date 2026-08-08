import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * Returns an HTML page that sends a postMessage to window.opener and
 * then closes the popup window.
 */
function popupResponse({ success, message, error }) {
  const payload = JSON.stringify({ oauthResult: { success, message, error } });
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${success ? 'Authenticated!' : 'Auth Failed'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
      background: ${success ? '#0f1a12' : '#1a0f0f'};
      color: ${success ? '#4ade80' : '#f87171'};
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { margin: 0 0 .5rem; font-size: 1.1rem; }
    p  { margin: 0; font-size: .85rem; opacity: .7; }
  </style>
</head>
<body>
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${success ? 'Google Drive Connected!' : 'Authentication Failed'}</h2>
  <p>${success ? (message || 'Remote configured successfully. This window will close…') : (error || 'An error occurred.')}</p>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${payload}, window.location.origin);
      }
    } catch(e) {}
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * GET /api/rclone/oauth/callback?code=...&state=...
 *
 * Google redirects here after user authorises the app.
 * The `state` param carries base64url-encoded JSON with:
 *   { connectionId, remoteName, clientId, clientSecret, scope }
 *
 * This handler:
 *  1. Decodes state → SSH target context
 *  2. Exchanges `code` for tokens via Google's token endpoint (server-side)
 *  3. Writes / patches the rclone remote config on the remote server via SSH
 *  4. Returns an HTML page that sends postMessage to the opener popup and closes
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Google returned an error (user denied etc.)
  if (error) {
    return popupResponse({ success: false, error: `Google OAuth denied: ${error}` });
  }

  if (!code || !state) {
    return popupResponse({ success: false, error: 'Missing code or state parameter from Google.' });
  }

  // ── Decode state ────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return popupResponse({ success: false, error: 'Invalid state parameter — please try again.' });
  }

  const { connectionId, remoteName, clientId, clientSecret, scope = 'drive' } = ctx;

  if (!connectionId || !remoteName || !clientId || !clientSecret) {
    return popupResponse({ success: false, error: 'Incomplete state context — please try again.' });
  }

  // ── Build redirect_uri (must match what was sent in the auth request) ───
  const host        = req.headers.get('host') || 'localhost:3000';
  const proto       = host.startsWith('localhost') ? 'http' : 'https';
  const redirectUri = `${proto}://${host}/api/rclone/oauth/callback`;

  // ── Exchange code for tokens (server-side, no CORS issues) ──────────────
  let tokenData;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    });

    tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      return popupResponse({
        success: false,
        error: `Token exchange failed: ${tokenData.error_description || tokenData.error || tokenRes.statusText}`,
      });
    }
  } catch (err) {
    return popupResponse({ success: false, error: `Token exchange request failed: ${err.message}` });
  }

  // ── Build rclone token JSON (rclone's internal format) ──────────────────
  const rcloneToken = JSON.stringify({
    access_token:  tokenData.access_token,
    token_type:    tokenData.token_type    || 'Bearer',
    refresh_token: tokenData.refresh_token || '',
    expiry: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString(),
  });

  // ── Write config to remote server via SSH ───────────────────────────────
  try {
    const sshConfig  = await getSshConfig(connectionId);
    const cleanName  = remoteName.replace(/[^a-zA-Z0-9_\-]/g, '');
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

    const SCOPES = {
      drive:              'https://www.googleapis.com/auth/drive',
      'drive.readonly':   'https://www.googleapis.com/auth/drive.readonly',
      'drive.file':       'https://www.googleapis.com/auth/drive.file',
    };
    const driveScope = SCOPES[scope] || SCOPES['drive'];

    // Try rclone config create (idempotent — creates or overwrites the remote)
    const createCmd = [
      pathPrefix,
      `rclone config create ${quote(cleanName)} drive`,
      `client_id=${quote(clientId)}`,
      `client_secret=${quote(clientSecret)}`,
      `scope=${quote(driveScope)}`,
      `token=${quote(rcloneToken)}`,
      'non_interactive=true',
    ].join(' ');

    const result = await execCommand(sshConfig, createCmd);

    if (result.code !== 0) {
      // Fallback: directly patch rclone.conf
      const confBlock = [
        `[${cleanName}]`,
        `type = drive`,
        `client_id = ${clientId}`,
        `client_secret = ${clientSecret}`,
        `scope = ${driveScope}`,
        `token = ${rcloneToken}`,
        '',
      ].join('\n');

      const patchCmd = [
        pathPrefix,
        `mkdir -p ~/.config/rclone`,
        `&& python3 -c "`,
          `import re, os;`,
          `f='$HOME/.config/rclone/rclone.conf';`,
          `txt=open(f).read() if os.path.exists(f) else '';`,
          `txt=re.sub(r'\\\\[${cleanName}\\\\][^\\\\[]*', '', txt).strip();`,
          `open(f, 'w').write(txt + '\\n')`,
        `" 2>/dev/null || true`,
        `&& printf %s ${quote('\n' + confBlock)} >> ~/.config/rclone/rclone.conf`,
      ].join(' ');

      const fallback = await execCommand(sshConfig, patchCmd);
      if (fallback.code !== 0) {
        return popupResponse({
          success: false,
          error: `Failed to write rclone config: ${fallback.stderr || fallback.stdout}`,
        });
      }
    }
  } catch (err) {
    return popupResponse({ success: false, error: `SSH error: ${err.message}` });
  }

  // ── Success ──────────────────────────────────────────────────────────────
  return popupResponse({
    success: true,
    message: `Google Drive remote "${remoteName}" authenticated successfully!`,
  });
}
