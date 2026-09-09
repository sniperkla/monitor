import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { logger } from '@/lib/logger';

// Emit the OAuth outcome back to the opener window (postMessage) AND write it
// to localStorage as a same-origin relay, then attempt to close the popup.
// The opener closes the popup too, so the flow completes even if
// window.close() is blocked or the app tab reloaded mid-flow.
function notifyScript(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script>
  (function () {
    var payload = ${json};
    try { localStorage.setItem('gdrive_oauth_pending', JSON.stringify(payload)); } catch (e) {}
    try { if (window.opener) window.opener.postMessage({ gdriveOauthResult: payload }, window.location.origin); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
  })();
</script>`;
}

function escHtml(str) {
  return String(str).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function polishPage(title, bodyHtml, scriptHtml = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a; color: #f8fafc;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; text-align: center; padding: 1rem;
    }
    .card {
      background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(99, 102, 241, 0.2);
      padding: 2.5rem; border-radius: 1.5rem;
      box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5);
      backdrop-filter: blur(12px); max-width: 420px;
    }
    h1 { margin-bottom: 1rem; font-size: 1.5rem; }
    h1.ok { color: #10b981; }
    h1.err { color: #f87171; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; word-break: break-word; }
    .spinner { border: 3px solid rgba(16, 185, 129, 0.1); width: 36px; height: 36px; clear: both;
      margin: 0.5rem auto; border-top-color: #10b981; border-radius: 50%; animation: spin 1s infinite linear; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    small { color: #475569; }
  </style>
</head>
<body>
  <div class="card">${bodyHtml}</div>
  ${scriptHtml}
</body>
</html>`;
}

function errorPage(message) {
  const html = polishPage('Google Drive Link Failed',
    `<h1 class="err">Google Drive Link Failed</h1>
     <p>${escHtml(message || 'Unknown error')}</p>
     <p><small>This window will close — return to the app for details.</small></p>`,
    notifyScript({ success: false, error: message || 'Unknown error' }));
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return errorPage('Authorization failed: missing auth code');
    }

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db, userId);
    await settingRepo.init();
    const savedConfigSetting = await settingRepo.findOne({ key: 'google_drive_config' });
    const savedConfig = savedConfigSetting ? savedConfigSetting.value : {};

    const clientId = savedConfig?.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = savedConfig?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return errorPage('Configuration Error: Client ID or Secret missing. Save them in the app first.');
    }

    let redirectUri = process.env.GDRIVE_REDIRECT_URI;
    if (!redirectUri) {
      let origin = process.env.NEXTAUTH_URL;
      if (!origin || origin.includes('localhost')) {
        const forwardedProto = request.headers.get('x-forwarded-proto');
        const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
        if (forwardedHost) {
          const proto = forwardedProto || (forwardedHost.includes('localhost') ? 'http' : 'https');
          origin = `${proto}://${forwardedHost}`;
        } else {
          origin = request.nextUrl.origin;
        }
      }
      redirectUri = `${origin.replace(/\/$/, '')}/api/mongo-sync/gdrive/callback`;
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return errorPage(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch user info from Google
    let userInfo = {};
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      userInfo = await infoRes.json();
    } catch (infoErr) {
      logger.error('Failed to fetch Google user info:', infoErr);
    }

    // Save configuration (persist clientId and clientSecret for background sync)
    const driveConfig = {
      ...savedConfig,
      clientId: clientId || savedConfig.clientId,
      clientSecret: clientSecret || savedConfig.clientSecret,
      accessToken: access_token,
      refreshToken: refresh_token || savedConfig.refreshToken, // Google only returns refresh token on prompt=consent
      expiresAt: Date.now() + expires_in * 1000,
      connectedAt: Date.now(),
      email: userInfo.email || 'linked-account@google.com',
      name: userInfo.name || 'Google Drive Sync',
      picture: userInfo.picture || ''
    };

    // Update in DB (using upsert logic)
    await settingRepo.upsert('google_drive_config', driveConfig);

    // Success page: notifies the opener (postMessage + localStorage relay) so
    // the app window can close the popup and refresh the connected state, then
    // also attempts to close itself as a backstop.
    const html = polishPage('Google Drive Authorized',
      `<h1 class="ok">Google Drive Linked!</h1>
       <p>Your Google Drive account has been connected successfully as <strong>${escHtml(driveConfig.email)}</strong>.</p>
       <div class="spinner"></div>
       <p><small>This window will close automatically...</small></p>`,
      notifyScript({ success: true, email: driveConfig.email, name: driveConfig.name }));

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    logger.error('Google Drive Callback error:', error);
    return errorPage(`Internal Server Error: ${error.message}`);
  }
}
