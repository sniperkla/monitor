import { NextResponse } from 'next/server';
import { getSshConfig } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { takeOauthJob } from '@/lib/rcloneOauthJobs';
import { writeDriveRemote } from '@/lib/rcloneConfigWrite';

/**
 * POST /api/rclone/oauth/save-token
 *
 * Writes the rclone config on the remote server after Google OAuth consent.
 * Called by the frontend (RcloneApp) through the normal apiFetch path so it
 * carries the correct x-mongodb-uri / x-ssh-mode headers.
 *
 * Body: { connectionId, remoteName, clientId, clientSecret, scope,
 *         rcloneToken | jobId }
 *
 * jobId is preferred: the callback stored the token server-side under a
 * one-time jobId, which makes the save recoverable even if the opener window
 * reloaded and the postMessage was lost.
 *
 * NOTE: the primary path is now server-side — the callback route writes the
 * config itself using the vault DB URI stashed at OAuth start. This route
 * remains as fallback/compat.
 */
export async function POST(req) {
  try {
    const body = await req.json();

    // Two ways to receive the token:
    //  1. jobId  — the callback stored the token server-side (preferred)
    //  2. rcloneToken — legacy inline token
    let {
      connectionId,
      remoteName,
      clientId,
      clientSecret,
      scope = 'drive',
      rcloneToken,
    } = body;

    if (body?.jobId && !rcloneToken) {
      const job = takeOauthJob(body.jobId);
      if (!job) {
        return NextResponse.json({
          success: false,
          error: 'OAuth token expired or already used — please sign in again (valid for 10 minutes).',
        }, { status: 410 });
      }
      rcloneToken  = job.rcloneToken;
      connectionId = connectionId || job.connectionId;
      remoteName   = remoteName  || job.remoteName;
      clientId     = clientId    || job.clientId;
      clientSecret = clientSecret || job.clientSecret;
      scope        = body.scope  || job.scope || scope;
    }

    if (!connectionId || !remoteName || !rcloneToken) {
      return NextResponse.json(
        { success: false, error: 'connectionId, remoteName, and rcloneToken (or jobId) are required' },
        { status: 400 }
      );
    }

    const sshMode        = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const result = await writeDriveRemote(sshConfig, {
      name: remoteName,
      clientId,
      clientSecret,
      scope,
      rcloneToken,
    });

    if (result.ok) {
      return NextResponse.json({ success: true, message: result.message, name: result.name });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });

  } catch (err) {
    logger.error('[rclone/oauth/save-token] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
