import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { COMPAT_PROBE, parseCompatOutput } from '@/lib/serverCompat';
import { logger } from '@/lib/logger';

/**
 * POST /api/ssh/compat — run the cross-distro capability probe on a server.
 * Body: { connectionId }
 * Returns per-function pass/warn/fail with impact explanations, so users can
 * see exactly WHICH features will work on that server and WHY.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(`compat:${clientIP}:${session.user?.id}`, 20).allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { connectionId } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId required' }, { status: 400 });

    const userId = session.user?.id || session.user?.sub || null;
    // getSshConfig enforces ownership via ConnectionRepository scoping
    let sshConfig;
    try {
      sshConfig = await getSshConfig(connectionId, {
        sshMode: request.headers.get('x-ssh-mode'),
        preferredRelay: request.headers.get('x-preferred-relay'),
        userId,
      });
    } catch (err) {
      if (/belongs to another user/i.test(err.message)) {
        return NextResponse.json({ success: false, error: err.message }, { status: 403 });
      }
      // "Connection not found": tell the user WHICH case they're in
      if (/Connection not found/i.test(err.message)) {
        try {
          const db = await connectDB();
          const diag = new ConnectionRepository(db);
          const row = await diag.findById(connectionId);
          if (row) {
            return NextResponse.json({
              success: false,
              error: `This server belongs to another account${row.email ? ` (${row.email})` : ''}. Log in as the owner to run checks on it.`,
            }, { status: 403 });
          }
          return NextResponse.json({
            success: false,
            error: 'This server entry no longer exists — refresh your server list.',
          }, { status: 404 });
        } catch (diagErr) {
          logger.warn('[compat] diagnostic lookup failed:', diagErr.message);
        }
      }
      throw err;
    }

    const result = await execCommand(sshConfig, COMPAT_PROBE, { pool: false });
    const output = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
    const parsed = parseCompatOutput(output);

    if (parsed.checks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Probe produced no results — the server may be unreachable or the shell unusable.',
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, ...parsed });
  } catch (error) {
    logger.warn('[compat] probe failed:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Compatibility check failed' }, { status: 500 });
  }
}
