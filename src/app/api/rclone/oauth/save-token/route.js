import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * POST /api/rclone/oauth/save-token
 *
 * Called by the frontend (RcloneApp) after the OAuth popup returns a token
 * via postMessage. This route runs through the normal apiFetch path so it
 * carries the correct x-mongodb-uri / x-ssh-mode headers.
 *
 * Body: { connectionId, remoteName, clientId, clientSecret, scope, rcloneToken }
 */
export async function POST(req) {
  try {
    const {
      connectionId,
      remoteName,
      clientId,
      clientSecret,
      scope = 'drive',
      rcloneToken,
    } = await req.json();

    if (!connectionId || !remoteName || !rcloneToken) {
      return NextResponse.json(
        { success: false, error: 'connectionId, remoteName, and rcloneToken are required' },
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
    console.error('[rclone/oauth/save-token] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
