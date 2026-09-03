import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { checkRateLimit } from '@/lib/serverGuard';
import { getActiveRelayInfo } from '@/lib/mongodb';
import { rewriteUriForTunnel, normalizeRelayDatabaseUri, isLocalhostUri } from '@/lib/sshTunnel';
import { assertSafeUri } from '@/lib/ssrfGuard';
import { logger } from '@/lib/logger';
import { safeConnectionError } from '@/lib/connectionError';
import { getClientIp } from '@/lib/clientIp';

/**
 * POST - Test a raw database URI connection
 * Used by MasterPasswordModal and SettingsApp for vault setup
 */
export async function POST(request) {
  try {
    // Defence in depth: testing arbitrary database URIs initiates outbound
    // network connections. Assert authentication here as well as in proxy.
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const clientIP = getClientIp(request);
    const rateCheck = checkRateLimit(`test-uri:${clientIP}`, 20);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, 
        error: `Too many connection tests. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const body = await request.json();
    const { uri } = body;

    if (!uri || typeof uri !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: 'Database URI is required' 
      }, { status: 400 });
    }

    const trimmedUri = uri.trim();

    // Validate protocol strictly — only database protocols allowed.
    // Non-database schemes (file:, gopher:, http:, ftp:, etc.) are rejected immediately.
    const allowed = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const lower = trimmedUri.toLowerCase();
    const isValid = allowed.some(p => lower.startsWith(p));
    
    if (!isValid) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unsupported database protocol. Must be MongoDB, MySQL, or PostgreSQL' 
      }, { status: 400 });
    }

    // Rewrite localhost URIs through Local Relay Agent if one is active.
    // The SSRF guard runs AFTER relay rewriting so that legitimate localhost
    // connections are routed through the relay (which connects from the
    // user's machine, not the server). If no relay is available, localhost
    // connections fall through to the SSRF guard which blocks them.
    const normalizedUri = normalizeRelayDatabaseUri(trimmedUri);
    let effectiveUri = normalizedUri;
    let usedRelay = false;
    // Parsed-hostname check, not a substring test: see the comment on
    // isLocalhostUri in src/lib/sshTunnel.js. A substring match lets
    // "mongodb://169.254.169.254/x?db=localhost" be treated as a relay target
    // and thereby skip the SSRF guard below.
    const isLocalhost = isLocalhostUri(normalizedUri);
    if (isLocalhost) {
      const relayInfo = await getActiveRelayInfo(normalizedUri);
      if (relayInfo) {
        effectiveUri = rewriteUriForTunnel(normalizedUri, relayInfo.port);
        usedRelay = true;
        logger.info(`🔗 [test-uri] Relay active: ${normalizedUri} → ${effectiveUri}`);
      } else if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({
          success: false,
          relayRequired: true,
          error: 'Local Relay Agent is not connected. Please start local-relay.js on your machine to access localhost databases.'
        }, { status: 400 });
      }
    }

    // SSRF protection: resolve all hostnames in the EFFECTIVE URI and verify
    // every resolved IP is in a public range. This prevents the server from
    // being used as a proxy to reach internal services (169.254.169.254,
    // 127.x, 10.x, 172.16/12, 192.168/16, etc.) and eliminates the 10s
    // timeout timing oracle that existed when internal IPs were simply left
    // to time out.
    //
    // If a relay rewrote the URI, the effective host is the relay port
    // (typically 127.0.0.1:<port> on the server) — which is safe because the
    // relay itself only accepts connections from the server process.
    if (!usedRelay) {
      const ssrfCheck = await assertSafeUri(effectiveUri);
      if (!ssrfCheck.safe) {
        logger.warn(`[test-uri] SSRF blocked: ${ssrfCheck.reason}`);
        return NextResponse.json({
          success: false,
          error: `Connection blocked: ${ssrfCheck.reason}`,
        }, { status: 403 });
      }
    }

    // Test connection based on protocol
    if (effectiveUri.startsWith('mongodb://') || effectiveUri.startsWith('mongodb+srv://')) {
      return await testMongoConnection(effectiveUri, usedRelay);
    } else if (effectiveUri.startsWith('mysql://')) {
      return await testMySQLConnection(effectiveUri);
    } else if (effectiveUri.startsWith('postgres://') || effectiveUri.startsWith('postgresql://')) {
      return await testPostgresConnection(effectiveUri);
    }

    return NextResponse.json({ 
      success: false, 
      error: 'Unsupported protocol' 
    }, { status: 400 });

  } catch (error) {
    logger.error('Test URI Error:', error?.message || error);
    return NextResponse.json({
      success: false,
      error: safeConnectionError(error),
    }, { status: 500 });
  }
}

async function testMongoConnection(uri, usedRelay = false) {
  let conn = null;
  try {
    conn = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      ...(usedRelay ? { directConnection: true } : {}),
    }).asPromise();

    // Try to get server info
    let version = 'Connected';
    try {
      const admin = conn.db.admin();
      const status = await admin.serverStatus();
      version = `MongoDB ${status.version}`;
    } catch (e) {
      // Some MongoDB instances don't allow admin commands
      version = 'MongoDB (Connected)';
    }

    await conn.close();
    return NextResponse.json({ 
      success: true, 
      message: `Successfully connected to ${version}`,
      info: version
    });

  } catch (error) {
    if (conn) {
      try { await conn.close(); } catch (e) {}
    }
    
    // Map to a client-safe message. Unrecognised driver errors are logged
    // server-side rather than returned, because their text can carry internal
    // hostnames and relay port numbers.
    const errorMessage = safeConnectionError(error, {
      onWithheld: (raw) => logger.error('[test-uri] mongo error detail withheld from client:', raw),
    });

    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 400 });
  }
}

async function testMySQLConnection(uri) {
  let connection = null;
  try {
    connection = await mysql.createConnection(uri);
    const [rows] = await connection.query('SELECT VERSION() as version');
    await connection.end();
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully connected to MySQL ${rows[0].version}`,
      info: `MySQL ${rows[0].version}`
    });

  } catch (error) {
    if (connection) {
      try { await connection.end(); } catch (e) {}
    }

    const errorMessage = safeConnectionError(error, {
      onWithheld: (raw) => logger.error('[test-uri] mysql error detail withheld from client:', raw),
    });

    return NextResponse.json({ 
      success: false, 
      error: errorMessage
    }, { status: 400 });
  }
}

async function testPostgresConnection(uri) {
  const client = new Client({ connectionString: uri, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query('SELECT version()');
    const version = result.rows[0].version.split(' ').slice(0, 2).join(' ');
    await client.end();

    return NextResponse.json({
      success: true,
      message: `Successfully connected to ${version}`,
      info: version
    });

  } catch (error) {
    try { await client.end(); } catch (e) {}

    const errorMessage = safeConnectionError(error, {
      onWithheld: (raw) => logger.error('[test-uri] postgres error detail withheld from client:', raw),
    });

    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 400 });
  }
}
