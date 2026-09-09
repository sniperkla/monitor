import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { shellQuote } from '@/utils/shellQuote';
import { requireSession } from '@/lib/requireSession';

const quote = shellQuote;

/**
 * /api/rclone/test
 *
 * Read-only connectivity diagnostic for one remote. Runs the same commands a
 * human would on the server and returns the RAW output so "remote looks
 * empty" can be told apart from "remote is broken":
 *   1. rclone config show <name>   — effective config (is root_folder_id set?)
 *   2. [ -f <service_account_file> ] — is the SA key file actually there?
 *   3. rclone lsd --max-depth 1 <name>: — the listing the browser shows
 * All stderr is merged in; nothing is hidden.
 */
export async function POST(req) {
  // Defence in depth: these routes are also covered by the middleware
  // session gate, but an explicit check keeps a matcher change from
  // silently exposing remote-command endpoints.
  const { error: authError } = await requireSession(req);
  if (authError) return authError;
  try {
    const { connectionId, name } = await req.json();
    if (!connectionId || !name) {
      return NextResponse.json({ success: false, error: 'connectionId and name are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const cleanName = String(name).replace(/[^a-zA-Z0-9_\-]/g, '');
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';
    const steps = [];

    // 1. Effective config
    const showRes = await execCommand(
      sshConfig,
      `${pathPrefix}rclone config show ${quote(cleanName)} 2>&1 | head -30`,
      { timeoutMs: 20000 }
    );
    steps.push({ title: `rclone config show ${cleanName}`, output: (showRes.stdout || showRes.stderr || '(no output)').trim() });

    // 2. If it is a service-account drive remote, verify the key file exists
    const saFile = (showRes.stdout || '').match(/service_account_file\s*=\s*(.+)/)?.[1]?.trim();
    if (saFile) {
      const fileRes = await execCommand(
        sshConfig,
        `${pathPrefix}if [ -f ${quote(saFile)} ]; then echo "EXISTS"; ls -la ${quote(saFile)}; else echo "MISSING"; fi`,
        { timeoutMs: 15000 }
      );
      steps.push({ title: `SA key file check: ${saFile}`, output: (fileRes.stdout || fileRes.stderr || '(no output)').trim() });
    }

    // 3. The actual listing
    const lsdRes = await execCommand(
      sshConfig,
      `${pathPrefix}rclone lsd --max-depth 1 ${quote(cleanName)}: 2>&1 | head -40`,
      { timeoutMs: 60000 }
    );
    steps.push({
      title: `rclone lsd ${cleanName}:  (exit ${lsdRes.code})`,
      output: (lsdRes.stdout || lsdRes.stderr || '(no output)').trim() || '(empty — the remote root has no folders)',
    });

    return NextResponse.json({ success: true, steps });
  } catch (error) {
    logger.error('[rclone/test] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}