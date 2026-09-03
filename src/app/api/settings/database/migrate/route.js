import { NextResponse } from 'next/server';
import { migrateConnections } from './migrator';
import { requireAdmin } from '@/lib/requireAdmin';
import { assertSafeUri } from '@/lib/ssrfGuard';
import { normalizeRelayDatabaseUri, isLocalhostUri } from '@/lib/sshTunnel';
import { auditLog } from '@/lib/auditLog';
import { logger } from '@/lib/logger';

/**
 * POST /api/settings/database/migrate
 *
 * Body: { sourceUri: "mongodb://...", targetUri: "postgres://..." }
 *
 * Reads all connections from sourceUri and writes them to targetUri.
 * Skips connections that already exist (by name+host).
 * Credentials are kept encrypted as-is (same ENCRYPTION_KEY on both sides).
 *
 * Admin-only, and both URIs are passed through the SSRF guard: this handler
 * makes the server open outbound connections to two caller-supplied hosts and
 * copy stored credentials between them. Without the guard it is a read-and-
 * exfiltrate primitive aimed at anything the server can reach.
 */
export async function POST(request) {
  const { session, error } = await requireAdmin(request);
  if (error) return error;

  try {
    const { sourceUri, targetUri } = await request.json();

    if (!sourceUri || !targetUri) {
      return NextResponse.json({
        success: false,
        error: 'Both sourceUri and targetUri are required.',
      }, { status: 400 });
    }

    if (typeof sourceUri !== 'string' || typeof targetUri !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'sourceUri and targetUri must be strings.',
      }, { status: 400 });
    }

    // Reject internal targets before the migrator opens any socket.
    for (const [name, raw] of [['sourceUri', sourceUri], ['targetUri', targetUri]]) {
      const normalized = normalizeRelayDatabaseUri(raw);
      // A URI the relay will handle never leaves the server's own loopback,
      // so there is nothing to guard. Everything else must be public.
      if (isLocalhostUri(normalized)) continue;

      const check = await assertSafeUri(normalized);
      if (!check.safe) {
        logger.warn(`[settings/database/migrate] SSRF blocked on ${name}: ${check.reason}`);
        await auditLog({
          req: request,
          action: 'settings.database.migrate.ssrf_blocked',
          userId: String(session.user.id),
          userEmail: session.user?.email,
          detail: { field: name, reason: check.reason },
          status: 'failure',
        });
        return NextResponse.json({
          success: false,
          error: `Migration blocked: ${check.reason}`,
        }, { status: 403 });
      }
    }

    const result = await migrateConnections(sourceUri, targetUri);

    await auditLog({
      req: request,
      action: 'settings.database.migrate',
      userId: String(session.user.id),
      userEmail: session.user?.email,
      detail: { migrated: result.migrated, skipped: result.skipped, total: result.total },
      status: 'success',
    });

    return NextResponse.json({
      ...result,
      message: result.migrated > 0
        ? `Migration complete! ${result.migrated} connection(s) migrated, ${result.skipped} skipped.`
        : result.total > 0
          ? `All ${result.total} connections already exist in the target database.`
          : 'No connections found in the source database.',
    });
  } catch (error) {
    logger.error('Migration Error:', error?.message || error);
    // The raw message can carry hostnames and connection topology from either
    // endpoint; keep it server-side.
    return NextResponse.json(
      { success: false, error: 'Migration failed. Check the server logs for details.' },
      { status: 500 }
    );
  }
}
