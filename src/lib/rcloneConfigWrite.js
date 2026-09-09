import { NextResponse } from 'next/server';
import { execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * Write (create or replace) a Google Drive remote in the remote server's
 * rclone.conf over SSH.
 *
 * Shared by /api/rclone/oauth/save-token (browser-driven path) and the
 * OAuth callback route (fully server-side save — no browser handoff needed).
 *
 * Returns { ok, message, name, error }.
 */
export async function writeDriveRemote(sshConfig, { name, clientId, clientSecret, scope = 'drive', rcloneToken }) {
  const cleanName  = String(name || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

  const SCOPES = {
    drive:            'https://www.googleapis.com/auth/drive',
    'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
    'drive.file':     'https://www.googleapis.com/auth/drive.file',
  };
  const driveScope = SCOPES[scope] || SCOPES['drive'];

  if (!cleanName || !rcloneToken) {
    return { ok: false, error: 'remote name and token are required' };
  }

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
    return {
      ok: true,
      message: `Google Drive remote "${cleanName}" configured successfully!`,
      name: cleanName,
    };
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
    `&& echo RCLONE_CONF_PATCHED`,
  ].join(' ');

  const fallback = await execCommand(sshConfig, patchCmd);

  if (fallback.code === 0 && (fallback.stdout || '').includes('RCLONE_CONF_PATCHED')) {
    return {
      ok: true,
      message: `Google Drive remote "${cleanName}" added to rclone.conf!`,
      name: cleanName,
    };
  }

  return {
    ok: false,
    error: result.stderr?.trim() || fallback.stderr?.trim() || 'Failed to write rclone config on the server',
  };
}
