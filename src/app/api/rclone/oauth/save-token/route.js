import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { takeOauthJob } from '@/lib/rcloneOauthJobs';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

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
 */
export async function POST(req) {
  try {
    const body = await req.json();

    // Two ways to receive the token:
    //  1. jobId  — the callback stored the token server-side (preferred; used
    //     by the postMessage path AND the localStorage self-heal path)
    //  2. rcloneToken — legacy inline token (kept for backward compatibility)
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

    const sshConfig  = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const cleanName  = remoteName.replace(/[^a-zA-Z0-9_\-]/g, '');
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

    const SCOPES = {
      drive:            'https://www.googleapis.com/auth/drive',
      'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
      'drive.file':     'https://www.googleapis.com/auth/drive.file',
    };
    const driveScope = SCOPES[scope] || SCOPES['drive'];

    // Try rclone config create (idempotent — creates or overwrites the named remote)
    const createCmd = [
      pathPrefix,
      `rclone config create ${quote(cleanName)} drive`,
      `client_id=${quote(clientId || '')}`,
      `client_secret=${quote(clientSecret || '')}`,
      `scope=${quote(driveScope)}`,
      `token=${quote(rcloneToken)}`,
      'non_interactive=true',
    ].join(' ');

    const result = await execCommand(sshConfig, createCmd);

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Google Drive remote "${cleanName}" configured successfully!`,
        name: cleanName,
      });
    }

    // ── Fallback: directly patch ~/.config/rclone/rclone.conf ───────────────
    const confBlock = [
      `[${cleanName}]`,
      `type = drive`,
      ...(clientId    ? [`client_id = ${clientId}`]       : []),
      ...(clientSecret ? [`client_secret = ${clientSecret}`] : []),
      `scope = ${driveScope}`,
      `token = ${rcloneToken}`,
      '',
    ].join('\n');

    // Strip any existing [remoteName] section, then append the new block
    const patchCmd = [
      pathPrefix,
      `mkdir -p ~/.config/rclone`,
      `&& CONF="$HOME/.config/rclone/rclone.conf"`,
      `&& python3 -c "`,
        `import re, os;`,
        `f=os.path.expanduser('~/.config/rclone/rclone.conf');`,
        `txt=open(f).read() if os.path.exists(f) else '';`,
        `txt=re.sub(r'\\[${cleanName}\\][^\\[]*', '', txt).strip();`,
        `open(f,'w').write(txt+'\\n')`,
      `" 2>/dev/null || true`,
      `&& printf '%s\\n' ${quote(confBlock)} >> ~/.config/rclone/rclone.conf`,
    ].join(' ');

    const fallback = await execCommand(sshConfig, patchCmd);

    if (fallback.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Google Drive remote "${cleanName}" added to rclone.conf!`,
        name: cleanName,
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || fallback.stderr.trim() || 'Failed to write rclone config',
    }, { status: 500 });

  } catch (err) {
    logger.error('[rclone/oauth/save-token] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
