import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getGoogleDriveConfig, saveGoogleDriveConfig, listGoogleDriveFolders } from '@/lib/gdriveHelper';
import { maskTail } from '@/utils/pii';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;

    const config = await getGoogleDriveConfig(userId);
    const isConnected = !!(config && config.refreshToken);

    let folders = [];
    if (isConnected) {
      try {
        folders = await listGoogleDriveFolders(null, userId);
      } catch (err) {
        logger.warn('Could not list Google Drive folders:', err);
      }
    }

    // OAuth client IDs are not secrets, but the deployment-wide
    // GOOGLE_CLIENT_ID has no business being handed to every signed-in user:
    // it is shared infrastructure and reveals which Google Cloud project this
    // instance belongs to. Only a clientId the user configured themselves is
    // echoed back (so the settings form can prefill); an env-provided one is
    // reduced to a "something is configured" tail hint.
    const ownClientId = config?.clientId || null;
    const envClientId = process.env.GOOGLE_CLIENT_ID || null;
    const clientIdSource = ownClientId ? 'user' : (envClientId ? 'env' : null);

    return NextResponse.json({
      success: true,
      connected: isConnected,
      email: config?.email || null,
      name: config?.name || null,
      hasClientId: !!(ownClientId || envClientId),
      clientIdSource,
      clientId: ownClientId,
      clientIdMasked: clientIdSource === 'env' ? maskTail(envClientId, 4) : null,
      hasClientSecret: !!(config?.clientSecret || process.env.GOOGLE_CLIENT_SECRET),
      folders
    });

  } catch (error) {
    logger.error('Google Drive Status API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;

    const body = await request.json();
    const { clientId, clientSecret, disconnect } = body;

    const currentConfig = await getGoogleDriveConfig(userId) || {};

    if (disconnect) {
      // Clear out connection info but preserve API client credentials if desired
      const newConfig = {
        clientId: currentConfig.clientId,
        clientSecret: currentConfig.clientSecret
      };
      await saveGoogleDriveConfig(newConfig, userId);
      return NextResponse.json({ success: true, message: 'Google Drive disconnected successfully.' });
    }

    const newConfig = {
      ...currentConfig,
      clientId: clientId !== undefined ? clientId : currentConfig.clientId,
      clientSecret: clientSecret !== undefined ? clientSecret : currentConfig.clientSecret
    };

    await saveGoogleDriveConfig(newConfig, userId);

    return NextResponse.json({ success: true, message: 'Google Drive configuration updated successfully.' });

  } catch (error) {
    logger.error('Google Drive Config Update error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
