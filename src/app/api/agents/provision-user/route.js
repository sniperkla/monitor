import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { provisionUser, sanitizeUsername } from '../_multi-instance';
import { logger } from '@/lib/logger';

/**
 * Strict multi-owner mode: provision one dedicated Linux user per "friend".
 *
 * POST body: { connectionId, username, publicKey? }
 *
 * Creates (idempotently) on the remote server:
 *   - a dedicated Linux user (own home, own credentials, chmod 700)
 *   - loginctl enable-linger (their gateway units run without login)
 *   - optional SSH public key install for that user
 *
 * The friend then adds their own SSH connection (same host, their username) in
 * the monitor and installs/uses any agent — every existing agents/* route works
 * unchanged because everything is SSH-user-scoped.
 *
 * Shared mode (same account, tagged instances) remains available via the
 * normal spawn-instance action of each agent route.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const { connectionId, username, publicKey = '' } = body || {};
    if (!connectionId) return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    const u = sanitizeUsername(username);
    if (!u) {
      return NextResponse.json({ success: false, error: 'Invalid username (use a-z, 0-9, -, _; must start with a letter)' }, { status: 400 });
    }
    const sshConfig = await getSshConfig(connectionId);
    const r = await provisionUser(sshConfig, u, { publicKey });
    if (!r.ok) {
      logger.error('[agents/provision-user] failed:', r.error);
      return NextResponse.json({ success: false, error: r.error || 'Provision failed' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      mode: 'strict',
      username: r.username,
      home: r.home,
      uid: r.uid,
      instructions: [
        `1. Linux user "${r.username}" is ready on the server (home: ${r.home}, linger enabled).`,
        '2. In the monitor, add a new SSH connection to the SAME host but with this username (password or the public key you provided).',
        '3. Open any AI agent on that connection and click Install — everything (config, .env, systemd units, logs) will live inside their home, fully isolated from yours.',
        '4. IMPORTANT: the friend must use their OWN bot token / API keys — never share yours.',
      ],
    });
  } catch (e) {
    logger.error('[agents/provision-user] POST failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' }, { status: 500 });
  }
}

// Quick syntax/self-check helper used by tests: expose the script generator.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ success: true, agents: ['hermes', 'nanobot', 'openclaw', 'zeroclaw'] });
}
