import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { migrateConnections } from './migrate/migrator';
import { getActiveRelayInfo } from '@/lib/mongodb';
import { rewriteUriForTunnel, normalizeRelayDatabaseUri, isLocalhostUri } from '@/lib/sshTunnel';
import { assertSafeUri } from '@/lib/ssrfGuard';
import { requireAdmin } from '@/lib/requireAdmin';
import { auditLog } from '@/lib/auditLog';
import { safeConnectionError } from '@/lib/connectionError';
import { logger } from '@/lib/logger';

function getCurrentUri() {
  return process.env.MONGODB_URI || '';
}

/**
 * Describe a database URI without disclosing its credentials.
 *
 * GET used to return the raw `process.env.MONGODB_URI`, which is a full
 * connection string including the username and password for the production
 * database. Anyone with a session — any role — could read it. Callers only
 * need to know *which* database is in use, not how to authenticate to it.
 */
function describeUri(uri) {
  if (!uri) return { configured: false, provider: null, host: null, port: null, database: null };
  try {
    const url = new URL(uri);
    const protocol = url.protocol.replace(/:$/, '');
    let provider = protocol;
    if (protocol === 'mongodb' || protocol === 'mongodb+srv') provider = 'mongodb';
    else if (protocol === 'mysql') provider = 'mysql';
    else if (protocol === 'postgres' || protocol === 'postgresql') provider = 'postgres';

    return {
      configured: true,
      provider,
      host: url.hostname || null,
      port: url.port ? Number(url.port) : null,
      // Leading slash of the pathname is the database name.
      database: url.pathname ? decodeURIComponent(url.pathname.replace(/^\//, '')) || null : null,
    };
  } catch {
    // Unparseable: report that something is configured, but reveal nothing.
    return { configured: true, provider: null, host: null, port: null, database: null };
  }
}

export async function GET(request) {
  // Admin-only: this endpoint exposes the server's own database configuration.
  // requireAdmin re-reads the role from the database rather than trusting the
  // session object (which deliberately omits `role`), and writes an audit
  // entry on every denial.
  const { session, error } = await requireAdmin(request);
  if (error) return error;

  const uri = getCurrentUri();
  let connected = mongoose.connection.readyState === 1;

  // Check SQL pool if not a mongo connection
  if (!connected && uri) {
    if (uri.startsWith('postgres') && global.__connectionPool?.has('center:postgres')) {
      connected = true;
    } else if (uri.startsWith('mysql') && global.__connectionPool?.has('center:mysql')) {
      connected = true;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...describeUri(uri),
      connected,
    },
  });
}

// POST — verify a URI and repoint the server's database at it.
//
// This is the highest-privilege endpoint in the application: it tears down the
// live database connection and replaces it. It is admin-gated, the URI is
// passed through the SSRF guard, and the connection is validated on a throwaway
// connection BEFORE the live one is disturbed.
export async function POST(request) {
  const { session, error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { uri } = body;

    // Migration is now OPT-IN. It used to run automatically whenever the URI
    // changed, meaning a successful repoint silently copied every stored
    // connection record to whatever database the caller nominated. Require an
    // explicit `migrate: true` before moving user data.
    const migrate = body.migrate === true;

    if (!uri || typeof uri !== 'string') {
      return NextResponse.json({ success: false, error: 'URI is required' }, { status: 400 });
    }

    // Basic URI validation
    const allowedProtocols = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowedProtocols.some(p => uri.startsWith(p));

    if (!isValid) {
      return NextResponse.json({
        success: false,
        error: `URI must start with one of: ${allowedProtocols.join(', ')}`
      }, { status: 400 });
    }

    // Rewrite localhost URIs through Local Relay Agent if one is active.
    // Parsed-hostname check, not a substring test — see isLocalhostUri.
    const normalizedUri = normalizeRelayDatabaseUri(uri);
    let effectiveUri = normalizedUri;
    let usedRelay = false;
    const isLocalhost = isLocalhostUri(normalizedUri);
    if (isLocalhost) {
      const relayInfo = await getActiveRelayInfo(normalizedUri);
      if (relayInfo) {
        effectiveUri = rewriteUriForTunnel(normalizedUri, relayInfo.port);
        usedRelay = true;
        logger.info(`🔗 [settings/database] Relay active: ${normalizedUri} → ${effectiveUri}`);
      } else if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({
          success: true,
          skippedTest: true,
          warning: 'Saved without connection test. Start Local Relay Agent to activate this database connection.'
        });
      }
    }

    // SSRF protection. Without this the endpoint is a general-purpose
    // outbound-connection oracle: an admin (or anyone who reaches this handler)
    // could point the server at 169.254.169.254, internal services, or the
    // server's own loopback, and read the difference between "refused" and
    // "connected" to map the internal network.
    //
    // Relay-routed URIs are exempt because the connection is made from the
    // user's machine, not the server.
    if (!usedRelay) {
      const ssrfCheck = await assertSafeUri(effectiveUri);
      if (!ssrfCheck.safe) {
        logger.warn(`[settings/database] SSRF blocked: ${ssrfCheck.reason}`);
        await auditLog({
          req: request,
          action: 'settings.database.ssrf_blocked',
          userId: String(session.user.id),
          userEmail: session.user?.email,
          detail: { reason: ssrfCheck.reason, target: describeUri(effectiveUri) },
          status: 'failure',
        });
        return NextResponse.json({
          success: false,
          error: `Connection blocked: ${ssrfCheck.reason}`,
        }, { status: 403 });
      }
    }

    // Remember old URI for (now opt-in) migration
    const oldUri = getCurrentUri();

    // Test on an INDEPENDENT connection first. The previous implementation
    // disconnected the live database before knowing whether the new URI worked,
    // so a single bad URI — or a blocked host — left the whole application
    // without a database until restart. Validate, then swap.
    const testResult = await tryConnect(effectiveUri, usedRelay);
    if (!testResult.ok) {
      return NextResponse.json({
        success: false,
        // Driver error text carries internal topology (hostnames, relay ports).
        // Return a categorised message and keep the raw detail in the log.
        error: testResult.message,
      }, { status: 400 });
    }

    // --- Validation passed. From here on we mutate live state. ---

    // 1. Disconnect existing connection
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch (e) {}

    // 2. Clear global cache so lib/mongodb.js picks up the new URI
    if (global.mongoose) {
      global.mongoose = { conn: null, promise: null };
    }
    // Clear SQL connection pool entries for clean reconnect
    if (global.__connectionPool) {
      for (const key of ['center:postgres', 'center:mysql']) {
        const c = global.__connectionPool.get(key);
        if (c) {
          try { if (c.pool) c.pool.end(); if (c.end) c.end(); } catch (_) {}
          global.__connectionPool.delete(key);
        }
      }
    }

    // 3. Establish the new live connection
    if (effectiveUri.startsWith('mongodb')) {
      try {
        await mongoose.connect(effectiveUri, {
          bufferCommands: false,
          serverSelectionTimeoutMS: usedRelay ? 15000 : 5000,
          connectTimeoutMS: usedRelay ? 15000 : 10000,
          ...(usedRelay ? { directConnection: true } : {}),
        });
        logger.info('✅ Live-connected to new MongoDB');
      } catch (connectErr) {
        logger.error('[settings/database] repoint failed after successful test:', connectErr?.message);
        return NextResponse.json({
          success: false,
          error: safeConnectionError(connectErr, {
            onWithheld: (raw) => logger.error('[settings/database] mongo repoint detail withheld:', raw),
          }),
        }, { status: 400 });
      }
    }
    // mysql:// and postgres:// live pools are created lazily by lib/mongodb.js
    // on first use, so the successful test above is sufficient validation.

    // Repointing the server's database is the single most consequential action
    // in the app. Record it.
    await auditLog({
      req: request,
      action: 'settings.database.repoint',
      userId: String(session.user.id),
      userEmail: session.user?.email,
      detail: {
        from: describeUri(oldUri),
        to: describeUri(effectiveUri),
        usedRelay,
        migrated: migrate,
      },
      status: 'success',
    });

    // 4. Migrate connections from old DB → new DB — only when explicitly asked.
    let migration = null;
    if (migrate && oldUri && oldUri !== uri) {
      try {
        logger.info('🔄 Explicit migration requested');
        migration = await migrateConnections(oldUri, uri);
        logger.info('✅ Migration result:', migration);
      } catch (migErr) {
        logger.error('⚠️ Migration failed (non-fatal):', migErr.message);
        migration = { success: false, error: migErr.message, migrated: 0, skipped: 0 };
      }
    }

    return NextResponse.json({
      success: true,
      message: migration?.migrated > 0
        ? `Connected! ${migration.migrated} connection(s) migrated from previous database.`
        : 'Connected successfully!',
      migration,
    });
  } catch (error) {
    logger.error('[settings/database] unexpected error:', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to update database configuration' },
      { status: 500 }
    );
  }
}

/**
 * Open a throwaway connection to `uri` to prove it works, then close it.
 * Never touches the application's live connection.
 */
async function tryConnect(uri, usedRelay = false) {
  const withheld = (raw) => logger.error('[settings/database] connect detail withheld:', raw);

  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
    let conn = null;
    try {
      conn = await mongoose.createConnection(uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: usedRelay ? 15000 : 5000,
        connectTimeoutMS: usedRelay ? 15000 : 10000,
        ...(usedRelay ? { directConnection: true } : {}),
      }).asPromise();
      // asPromise() resolves on topology selection; ping to be certain.
      await conn.db.admin().ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: safeConnectionError(err, { onWithheld: withheld }) };
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  if (uri.startsWith('mysql://')) {
    let connection = null;
    try {
      connection = await mysql.createConnection(uri);
      await connection.ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: safeConnectionError(err, { onWithheld: withheld }) };
    } finally {
      if (connection) { try { await connection.end(); } catch (_) {} }
    }
  }

  if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
    const client = new Client({ connectionString: uri, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: safeConnectionError(err, { onWithheld: withheld }) };
    } finally {
      try { await client.end(); } catch (_) {}
    }
  }

  return { ok: false, message: 'Unsupported protocol' };
}
