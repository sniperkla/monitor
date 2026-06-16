import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getGoogleDriveConfig, saveGoogleDriveConfig, listGoogleDriveFolders } from '@/lib/gdriveHelper';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getGoogleDriveConfig();
    const isConnected = !!(config && config.refreshToken);

    let folders = [];
    if (isConnected) {
      try {
        folders = await listGoogleDriveFolders();
      } catch (err) {
        console.warn('Could not list Google Drive folders:', err);
      }
    }

    return NextResponse.json({
      success: true,
      connected: isConnected,
      email: config?.email || null,
      name: config?.name || null,
      clientId: config?.clientId || process.env.GOOGLE_CLIENT_ID || null,
      hasClientSecret: !!(config?.clientSecret || process.env.GOOGLE_CLIENT_SECRET),
      folders
    });

  } catch (error) {
    console.error('Google Drive Status API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { clientId, clientSecret, disconnect } = body;

    const currentConfig = await getGoogleDriveConfig() || {};

    if (disconnect) {
      // Clear out connection info but preserve API client credentials if desired
      const newConfig = {
        clientId: currentConfig.clientId,
        clientSecret: currentConfig.clientSecret
      };
      await saveGoogleDriveConfig(newConfig);
      return NextResponse.json({ success: true, message: 'Google Drive disconnected successfully.' });
    }

    const newConfig = {
      ...currentConfig,
      clientId: clientId !== undefined ? clientId : currentConfig.clientId,
      clientSecret: clientSecret !== undefined ? clientSecret : currentConfig.clientSecret
    };

    await saveGoogleDriveConfig(newConfig);

    return NextResponse.json({ success: true, message: 'Google Drive configuration updated successfully.' });

  } catch (error) {
    console.error('Google Drive Config Update error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
