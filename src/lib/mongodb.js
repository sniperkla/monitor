import mongoose from "mongoose";
import { headers } from "next/headers.js";
import mysql from "mysql2/promise";
import { getToken } from 'next-auth/jwt';
import {
  createSSHTunnel,
  rewriteUriForTunnel,
  parseUriHostPort,
  findActiveRelay,
  applyRelayTarget,
  normalizeRelayDatabaseUri,
} from './sshTunnel.js';
import { Pool as PgPool } from 'pg';
import fs from 'fs';
import path from 'path';

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections from growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectionPool = new Map();

export function getCenterUri() {
  // In production (Docker), always use the environment variable
  if (process.env.NODE_ENV === 'production') {
    return process.env.MONGODB_URI;
  }
  // In development, prefer db-config.json for local DB
  try {
    const p = path.join(process.cwd(), 'db-config.json');
    if (fs.existsSync(p)) {
      const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (c.uri) return c.uri;
    }
  } catch (e) {}
  return process.env.MONGODB_URI;
}

/**
 * Extracts Database URI from headers (Private Browser Mode)
 */
export async function getUriFromRequest() {
  try {
    const headersList = await headers();
    const clientUri = headersList.get('x-mongodb-uri');
    const supported = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    if (clientUri && supported.some(p => clientUri.startsWith(p))) {
      return clientUri;
    }
  } catch (e) {}
  return getCenterUri();
}

/**
 * Extracts SSH tunnel config from the x-vault-tunnel header.
 * Returns null if no tunnel header is present.
 */
export async function getTunnelFromRequest() {
  try {
    const headersList = await headers();
    const tunnelHeader = headersList.get('x-vault-tunnel');
    if (tunnelHeader) {
      return JSON.parse(tunnelHeader);
    }
  } catch (e) {}
  return null;
}

/**
 * Checks whether the current user has an active Local Relay Agent connected
 * and the URI targets localhost. Returns { port, userId } or null.
 * Updates the relay's targetHost/targetPort so the TCP proxy knows where to forward.
 */
export async function getActiveRelayInfo(uri, relayName) {
  if (!global.__activeRelays?.size) return null;
  if (!/localhost|127\.0\.0\.1/.test(uri)) return null;

  try {
    uri = normalizeRelayDatabaseUri(uri);

    const h = await headers();
    const preferredRelay = h.get('x-preferred-relay');
    const cookie = h.get('cookie') || '';
    const cookies = Object.fromEntries(
      cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => {
        const i = c.indexOf('=');
        return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
      })
    );
    const token = await getToken({
      req: { headers: { cookie }, cookies },
      secret: process.env.NEXTAUTH_SECRET,
    });

    const found = findActiveRelay(token?.sub, relayName || preferredRelay || undefined);
    if (!found?.relay) return null;

    const { remoteHost, remotePort } = parseUriHostPort(uri);
    applyRelayTarget(found.relay, remoteHost, remotePort);

    return { port: found.relay.localPort, userId: found.userId, relayId: found.relayId };
  } catch {
    return null;
  }
}

/**
 * Connects to the primary "Center" database using the default mongoose connection.
 */
async function connectCenter(uri) {
  // Check if already connected via the default connection
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  // Only return cached connection if it is actually connected
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // If there's no active promise, or connection is disconnected/connecting without a promise, start connection
  if (!cached.promise || mongoose.connection.readyState === 0) {
    const opts = {
      bufferCommands: false,
    };
    // Use the URI from env or config file as the definitive center DB if possible
    const centerUri = getCenterUri() || uri;
    cached.promise = mongoose.connect(centerUri, opts).then((mongoose) => {
      return mongoose;
    });
  }
  
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  // Double check connection status after promise resolves
  if (mongoose.connection.readyState !== 1) {
    cached.promise = null;
    throw new Error("Mongoose connection readyState is not 1 (connected) after awaiting connect promise.");
  }

  return cached.conn;
}

/**
 * Connects to a specific private URI and returns a separate connection.
 * Supports MongoDB, MySQL, SSH-tunneled, and Local Relay connections.
 *
 * @param {string} uri           Database URI
 * @param {object|null} tunnelConfig  SSH tunnel config from x-vault-tunnel header
 */
export async function flushRelayDynamicConnections(reason = 'relay disconnect', filterPort = null) {
  let flushed = 0;
  for (const [key, conn] of connectionPool.entries()) {
    if (!key.startsWith('relay:')) continue;
    if (filterPort && !key.includes(`:${filterPort}`) && !key.includes(`@127.0.0.1:${filterPort}`)) continue;
    try {
      if (conn.readyState) await conn.close();
      else if (conn.pool) await conn.pool.end();
    } catch (_) {}
    connectionPool.delete(key);
    flushed++;
  }
  if (flushed > 0) {
    console.log(`🧹 [mongodb] Flushed ${flushed} relay-backed connection(s) (${reason}${filterPort ? ` port ${filterPort}` : ''})`);
  }
}

async function getDynamicConnection(uri, tunnelConfig = null, relayName = null) {
  if (!uri) throw new Error("Database URI is missing.");

  uri = normalizeRelayDatabaseUri(uri);

  let connectUri = uri;
  let cachePrefix = '';

  // 1. Try Local Relay Agent (free, no SSH/Tailscale needed)
  if (!tunnelConfig?.enabled) {
    const isLocalhost = /localhost|127\.0\.0\.1/.test(uri);
    const relayInfo = isLocalhost ? await getActiveRelayInfo(uri, relayName) : null;

    if (relayInfo) {
      connectUri = rewriteUriForTunnel(uri, relayInfo.port);
      cachePrefix = `relay:${relayInfo.userId}:`;
      console.log(`🔗 [Local Relay] ${uri} → ${connectUri}`);
    } else if (isLocalhost) {
      // Localhost URI but no relay active.
      // In development the server itself is on localhost, so direct access is fine.
      // In production, reject to avoid silently hitting the server's own loopback.
      const isDev = process.env.NODE_ENV === 'development';
      if (!isDev) {
        throw new Error(
          'Local Relay Agent is not connected. ' +
          'Run local-relay.js on your machine to access localhost databases.'
        );
      }
      // Dev mode: connect directly (server is on same machine as DB)
    }
  }

  // Unique cache key: relay & tunnel connections are keyed separately
  const cacheKey = tunnelConfig?.enabled
    ? `tunnel:${tunnelConfig.sshUser}@${tunnelConfig.sshHost}:${tunnelConfig.sshPort || 22}=>${uri}`
    : `${cachePrefix}${uri}`;

  if (connectionPool.has(cacheKey)) {
    const cachedConn = connectionPool.get(cacheKey);
    // For Mongoose connections (connected or connecting)
    if (cachedConn.readyState && (cachedConn.readyState === 1 || cachedConn.readyState === 2)) return cachedConn;
    // For MySQL pools (simple check)
    if (cachedConn.pool && !cachedConn._closing) return cachedConn;
    connectionPool.delete(cacheKey);
  }

  // 2. Open SSH tunnel if requested (and no relay was found)
  if (tunnelConfig?.enabled && connectUri === uri) {
    const { remoteHost, remotePort } = parseUriHostPort(uri);
    const localPort = await createSSHTunnel({
      sshHost: tunnelConfig.sshHost,
      sshPort: tunnelConfig.sshPort,
      sshUser: tunnelConfig.sshUser,
      sshAuth: tunnelConfig.sshAuth,
      sshPassword: tunnelConfig.sshPassword,
      sshPrivateKey: tunnelConfig.sshPrivateKey,
      sshPassphrase: tunnelConfig.sshPassphrase,
      remoteHost,
      remotePort,
    });
    connectUri = rewriteUriForTunnel(uri, localPort);
    console.log(`🔒 [Vault Tunnel] ${tunnelConfig.sshUser}@${tunnelConfig.sshHost} → ${remoteHost}:${remotePort} (local :${localPort})`);
  }

  if (connectUri.startsWith('mysql://')) {
    const pool = mysql.createPool(connectUri);
    const conn = {
      type: 'mysql',
      pool,
      query: (sql, params) => pool.execute(sql, params),
    };
    connectionPool.set(cacheKey, conn);
    return conn;
  }

  if (connectUri.startsWith('postgres://') || connectUri.startsWith('postgresql://')) {
    const pool = new PgPool({ connectionString: connectUri, max: 5, connectionTimeoutMillis: 10000 });
    // Eagerly verify the connection is reachable
    const testClient = await pool.connect();
    testClient.release();
    const conn = {
      type: 'postgres',
      pool,
      query: (sql, params) => pool.query(sql, params),
    };
    connectionPool.set(cacheKey, conn);
    return conn;
  }

  if (!connectUri.startsWith('mongodb://') && !connectUri.startsWith('mongodb+srv://')) {
    throw new Error(
      `Unsupported database URI scheme: "${connectUri.split(':')[0]}://". ` +
      'Supported schemes: mongodb://, mongodb+srv://, mysql://'
    );
  }

  // Default to MongoDB
  const useTunnel = tunnelConfig?.enabled || cachePrefix.startsWith('relay:');
  const opts = {
    bufferCommands: false,
    serverSelectionTimeoutMS: useTunnel ? 15000 : 5000,
    connectTimeoutMS: useTunnel ? 15000 : 10000,
    // directConnection required when going through a local proxy/tunnel
    ...(useTunnel ? { directConnection: true } : {}),
  };
  const conn = await mongoose.createConnection(connectUri, opts).asPromise();
  connectionPool.set(cacheKey, conn);
  return conn;
}

/**
 * Main entry point for database connections.
 * @param {string} uri - Optional URI to connect to.
 * @param {boolean} isCenter - If true, connects to the default instance.
 */
async function connectDB(uri = null, isCenter = false, relayName = null) {
  const targetUri = uri || (await getUriFromRequest());
  const normalizedUri = normalizeRelayDatabaseUri(targetUri);

  // Non-MongoDB URIs must always go through the dynamic connection path
  const isNonMongo = normalizedUri && !normalizedUri.startsWith('mongodb://') && !normalizedUri.startsWith('mongodb+srv://');

  const centerUri = getCenterUri();
  // If this is the center DB (User storage), use the default connection
  if (!isNonMongo && (isCenter || normalizedUri === centerUri || targetUri === centerUri || normalizedUri === process.env.MONGODB_URI || targetUri === process.env.MONGODB_URI)) {
    return connectCenter(normalizedUri);
  }

  // When URI came from request headers, also check for SSH tunnel config.
  // When URI was provided explicitly (e.g., internal server calls), skip tunnel.
  const tunnelConfig = uri ? null : await getTunnelFromRequest();

  // Otherwise, use a separate pool connection for tenant isolation
  return getDynamicConnection(normalizedUri, tunnelConfig, relayName);
}

export default connectDB;
