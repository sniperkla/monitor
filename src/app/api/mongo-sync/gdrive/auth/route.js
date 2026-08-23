import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { logger } from '@/lib/logger';

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

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db, userId);
    await settingRepo.init();
    const savedConfigSetting = await settingRepo.findOne({ key: 'google_drive_config' });
    const savedConfig = savedConfigSetting ? savedConfigSetting.value : {};

    const clientId = savedConfig?.clientId || process.env.GOOGLE_CLIENT_ID;
    
    if (!clientId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Google Client ID is not configured. Please set it in the Google Drive Setup tab.' 
      }, { status: 400 });
    }

    // Determine redirect URI: use process.env.GDRIVE_REDIRECT_URI if set, or build from origin
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

    // Save temporary redirectUri and client details so callback knows which client secret to use
    // Using a simple cookie or we can just expect it.
    
    const scope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly email profile';
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `access_type=offline&` +
      `prompt=consent`;

    return NextResponse.redirect(authUrl);

  } catch (error) {
    logger.error('Google Drive Auth redirect error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
