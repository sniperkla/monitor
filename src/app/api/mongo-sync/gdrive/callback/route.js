import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import SystemSetting from '@/models/SystemSetting';

export async function GET(request) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return new NextResponse('<h1>Authorization failed: missing auth code</h1>', {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();
    const savedConfigSetting = await settingRepo.findOne({ key: 'google_drive_config' });
    const savedConfig = savedConfigSetting ? savedConfigSetting.value : {};

    const clientId = savedConfig?.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = savedConfig?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return new NextResponse('<h1>Configuration Error: Client ID or Secret missing</h1>', {
        headers: { 'Content-Type': 'text/html' }
      });
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
      return new NextResponse(`<h1>Token exchange failed: ${tokenData.error_description || tokenData.error}</h1>`, {
        headers: { 'Content-Type': 'text/html' }
      });
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
      console.error('Failed to fetch Google user info:', infoErr);
    }

    // Save configuration
    const driveConfig = {
      ...savedConfig,
      accessToken: access_token,
      refreshToken: refresh_token || savedConfig.refreshToken, // Google only returns refresh token on prompt=consent
      expiresAt: Date.now() + expires_in * 1000,
      connectedAt: Date.now(),
      email: userInfo.email || 'linked-account@google.com',
      name: userInfo.name || 'Google Drive Sync',
      picture: userInfo.picture || ''
    };

    // Update in DB (using upsert logic via SystemSettingRepository)
    await settingRepo.update({ key: 'google_drive_config' }, { value: driveConfig });

    // Return a success page that auto-closes
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Drive Authorized</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .card {
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(99, 102, 241, 0.2);
            padding: 2.5rem;
            border-radius: 1.5rem;
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5);
            backdrop-filter: blur(12px);
            max-width: 400px;
          }
          h1 {
            color: #10b981;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          p {
            color: #94a3b8;
            font-size: 0.9rem;
            line-height: 1.5;
            margin-bottom: 2rem;
          }
          .spinner {
            border: 3px solid rgba(16, 185, 129, 0.1);
            width: 36px;
            height: 36px;
            clear: both;
            margin: 0.5rem auto;
            border-top-color: #10b981;
            border-radius: 50%;
            animation: spin 1s infinite linear;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google Drive Linked!</h1>
          <p>Your Google Drive account has been connected successfully as <strong>${driveConfig.email.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]))}</strong>.</p>
          <div class="spinner"></div>
          <p style="margin-top: 1.5rem; font-size: 0.8rem; color: #64748b;">This window will close automatically...</p>
        </div>
        <script>
          setTimeout(() => {
            window.close();
          }, 2000);
        </script>
      </body>
      </html>
    `;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    console.error('Google Drive Callback error:', error);
    return new NextResponse(`<h1>Internal Server Error: ${error.message}</h1>`, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
