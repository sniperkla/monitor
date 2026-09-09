import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/requireSession';

/**
 * /api/rclone/upload-sa
 *
 * Google Drive "Service Account" helper. The service-account JSON key must
 * live ON THE SERVER running rclone, so this endpoint lets the UI:
 *   action=home    → resolve the target host's absolute $HOME (for building
 *                    real absolute paths in the file picker)
 *   action=upload  → write an uploaded JSON key (content) to
 *                    $HOME/.config/rclone/service-accounts/<name> on the
 *                    target host and return its ABSOLUTE path
 *
 * The write is a single SSH command: the content travels base64-encoded so
 * quoting/newlines can never break the shell, then chmod 600 — service keys
 * are credentials and must not be world-readable.
 */

const MAX_SA_BYTES = 1024 * 1024; // 1 MiB — real Google SA keys are ~2.3 KB

export async function POST(req) {
  // Defence in depth: these routes are also covered by the middleware
  // session gate, but an explicit check keeps a matcher change from
  // silently exposing remote-command endpoints.
  const { error: authError } = await requireSession(req);
  if (authError) return authError;
  try {
    const { connectionId, action = 'upload', fileName, content } = await req.json();
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    if (action === 'home') {
      const r = await execCommand(sshConfig, 'printf %s "$HOME"', { timeoutMs: 20000 });
      if (r.code !== 0 || !(r.stdout || '').trim()) {
        return NextResponse.json({ success: false, error: 'Could not resolve home directory' }, { status: 500 });
      }
      return NextResponse.json({ success: true, home: (r.stdout || '').trim() });
    }

    // action === 'upload' (default)
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ success: false, error: 'content is required' }, { status: 400 });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_SA_BYTES) {
      return NextResponse.json({ success: false, error: 'File too large (max 1 MB)' }, { status: 400 });
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json({ success: false, error: 'File is not valid JSON' }, { status: 400 });
    }
    // Basic sanity: a Google service-account key carries these markers.
    if (parsed?.type !== 'service_account' || !parsed?.private_key) {
      return NextResponse.json(
        { success: false, error: 'Not a Google service-account key (expected type=service_account with a private_key)' },
        { status: 400 }
      );
    }

    let safeName = String(fileName || 'gdrive-sa.json')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/\.+/g, '.')
      .replace(/^[-.]+/, '')
      .slice(0, 120);
    if (!safeName.endsWith('.json')) safeName += '.json';
    if (!safeName || safeName === '.json') safeName = 'gdrive-sa.json';

    const dir = '$HOME/.config/rclone/service-accounts';
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const cmd =
      `mkdir -p "$HOME/.config/rclone/service-accounts" && ` +
      `printf %s '${b64}' | base64 -d > "$HOME/.config/rclone/service-accounts/${safeName}" && ` +
      `chmod 600 "$HOME/.config/rclone/service-accounts/${safeName}" && ` +
      `printf %s "$HOME/.config/rclone/service-accounts/${safeName}"`;

    const result = await execCommand(sshConfig, cmd, { timeoutMs: 30000 });
    if (result.code !== 0) {
      return NextResponse.json(
        { success: false, error: result.stderr?.trim() || result.stdout?.trim() || 'Failed to write the file on the server' },
        { status: 500 }
      );
    }
    const absPath = (result.stdout || '').trim();
    return NextResponse.json({
      success: true,
      path: absPath,
      name: safeName,
      // The SA email — folders must be SHARED with this address (or accessed
      // via a Shared Drive) or the remote lists an empty Drive. Surfacing it
      // here lets the UI show a copy-paste hint right after upload.
      clientEmail: parsed.client_email || null,
    });
  } catch (error) {
    logger.error('[rclone/upload-sa] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}