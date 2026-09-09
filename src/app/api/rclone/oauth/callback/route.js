import { NextResponse } from 'next/server';
import { putOauthJob, takeOauthJob } from '@/lib/rcloneOauthJobs';
import { getSshConfig } from '@/app/api/server-backup/_ssh';
import { writeDriveRemote } from '@/lib/rcloneConfigWrite';
import { logger } from '@/lib/logger';

/**
 * Returns an HTML page that sends a postMessage to window.opener and
 * then closes the popup window.
 */
function popupResponse({ success, message, error, payload }) {
  const data = JSON.stringify({
    oauthResult: { success, message, error, ...(payload || {}) },
  });
  // Same-origin persistence: a reloaded opener tab reads this on focus and
  // completes the save via /api/rclone/oauth/save-token { jobId }.
  const pendingFlag = payload?.jobId
    ? JSON.stringify({ jobId: payload.jobId, ts: Date.now(), done: payload.saved === true })
    : null;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${success ? 'Authenticated!' : 'Auth Failed'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 1rem; text-align: center;
      background: ${success ? '#0f1a12' : '#1a0f0f'};
      color: ${success ? '#4ade80' : '#f87171'};
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { margin: 0 0 .5rem; font-size: 1.1rem; }
    p  { margin: 0 0 1rem; font-size: .85rem; opacity: .7; }
    a.back {
      display: inline-block; padding: .6rem 1.2rem; border-radius: .6rem;
      background: rgba(255,255,255,.08); color: #e2e8f0; text-decoration: none;
      font-size: .85rem; font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${success ? 'Google Sign-In Successful!' : 'Authentication Failed'}</h2>
  <p>${success ? 'Saving your configuration… This window will close.' : (error || 'An error occurred.')}</p>
  ${success ? '<a class="back" href="/?app=rclone">Back to app</a>' : ''}
  <script>
    (function () {
      var payload = ${data};
      try {
        // Same-origin handoff: survives an opener reload. The app picks this
        // up on load/focus and completes the config save.
        ${pendingFlag ? `localStorage.setItem('rclone_oauth_pending', ${JSON.stringify(pendingFlag)});` : ''}
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {
        // cross-origin safety — should never happen since same origin
      }
      // Close after a short delay so the user can read the message
      setTimeout(function () { window.close(); }, ${success ? 1500 : 3000});
    })();
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
 * Google redirects here after the user authorises the app.
 * The `state` param carries base64url-encoded JSON with:
 *   { connectionId, remoteName, clientId, clientSecret, scope }
 *
 * This handler ONLY:
 *  1. Decodes state
 *  2. Exchanges `code` for OAuth tokens via Google (server-side, no CORS)
 *  3. Sends the token + context back to the opener via postMessage
 *
 * The opener (RcloneApp) then calls POST /api/rclone/oauth/save-token
 * through the normal apiFetch path (which carries x-mongodb-uri, etc.)
 * to actually SSH into the server and write the rclone config.
 *
 * This separation is necessary because this callback is a plain browser
 * redirect from Google — it carries NO custom headers (x-mongodb-uri,
 * x-ssh-mode, etc.) that apiFetch normally injects, so any direct DB /
 * SSH call here would fail with "Connection not found".
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return popupResponse({ success: false, error: `Google denied access: ${error}` });
  }

  if (!code || !state) {
    return popupResponse({ success: false, error: 'Missing code or state from Google.' });
  }

  // ── Decode state ─────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return popupResponse({ success: false, error: 'Invalid state parameter — please try again.' });
  }

  const { connectionId, remoteName, clientId, clientSecret, scope = 'drive' } = ctx;

  if (!connectionId || !remoteName || !clientId || !clientSecret) {
    return popupResponse({ success: false, error: 'Incomplete OAuth context — please try again.' });
  }

  // ── Build redirect_uri (must exactly match what was registered) ──────────
  const host        = req.headers.get('host') || 'localhost:3000';
  const proto       = host.startsWith('localhost') ? 'http' : 'https';
  const redirectUri = `${proto}://${host}/api/rclone/oauth/callback`;

  // ── Exchange code → tokens (server-side) ─────────────────────────────────
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
    return popupResponse({ success: false, error: `Token exchange error: ${err.message}` });
  }

  // ── Build rclone token JSON ───────────────────────────────────────────────
  const rcloneToken = JSON.stringify({
    access_token:  tokenData.access_token,
    token_type:    tokenData.token_type    || 'Bearer',
    refresh_token: tokenData.refresh_token || '',
    expiry: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString(),
  });

  // ── PRIMARY PATH: save the rclone config server-side, right here ─────────
  // The start route stashed the caller's vault DB URI + context under
  // state.startJobId. The callback GET is a same-origin navigation from
  // Google, so it carries the user's session cookies — getSshConfig can
  // resolve ownership, and the stashed URI covers the vault DB lookup.
  // This makes the save completely independent of the popup/opener handoff.
  let startJob = null;
  try { startJob = ctx.startJobId ? takeOauthJob(ctx.startJobId) : null; } catch (_) {}

  let saved = false;
  let saveError = null;
  if (startJob?.connectionId) {
    try {
      const sshConfig = await getSshConfig(startJob.connectionId, {
        dbUri: startJob.vaultUri || undefined,
      });
      const result = await writeDriveRemote(sshConfig, {
        name: startJob.remoteName || remoteName,
        clientId: startJob.clientId,
        clientSecret: startJob.clientSecret,
        scope: startJob.scope || scope,
        rcloneToken,
      });
      saved = result.ok;
      if (!result.ok) saveError = result.error;
    } catch (err) {
      logger.error('[rclone/oauth/callback] server-side save failed:', err.message);
      saveError = err.message;
    }
  }

  // ── FALLBACK PATH: stash the token for the browser-driven save ────────────
  // Used when the start job expired (>10 min on consent) or the server-side
  // SSH write failed and the app should retry with its own headers.
  const jobId = putOauthJob({
    rcloneToken,
    connectionId,
    remoteName,
    clientId,
    clientSecret,
    scope,
  });

  // ── Report the outcome to the parent window ───────────────────────────────
  const message = saved
    ? `Configuration saved to rclone.conf on your server!`
    : `Google authorisation received for "${remoteName}". ${saved === false && saveError ? 'Will retry from the app…' : 'Saving config…'}`;

  return popupResponse({
    success: true,
    message,
    error: saved ? null : saveError,
    payload: {
      jobId,
      saved,
      rcloneToken,
      connectionId,
      remoteName,
      clientId,
      clientSecret,
      scope,
    },
  });
}
