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
  return process.env.MONGODB_URI;
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
async function connectCenter() {
  // Already connected
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  // Connection in progress (e.g. initiated by server.js) — wait for it
  if (mongoose.connection.readyState === 2) {
    if (cached.promise) {
      try {
        cached.conn = await cached.promise;
        return cached.conn;
      } catch (e) {
        cached.promise = null;
        throw e;
      }
    }
    // Connection initiated externally (e.g. server.js) — wait until ready or failed
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 10000);
      const check = () => {
        if (mongoose.connection.readyState === 1) {
          clearTimeout(timeout);
          resolve();
        } else if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
          clearTimeout(timeout);
          reject(new Error('MongoDB connection failed'));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
    cached.conn = mongoose;
    return cached.conn;
  }

  // Disconnected — start new connection
  if (!cached.promise || mongoose.connection.readyState === 0) {
    const centerUri = process.env.MONGODB_URI;
    if (!centerUri) throw new Error("MONGODB_URI environment variable is not set");
    
    cached.promise = mongoose.connect(centerUri, { bufferCommands: false }).then((mongoose) => {
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
      const isDev = process.env.NODE_ENV === 'development';
      if (!isDev) {
        throw new Error(
          'Local Relay Agent is not connected. ' +
          'Run local-relay.js on your machine to access localhost databases.'
        );
      }
    }
  }

  // Unique cache key: relay & tunnel connections are keyed separately
  const cacheKey = tunnelConfig?.enabled
    ? `tunnel:${tunnelConfig.sshUser}@${tunnelConfig.sshHost}:${tunnelConfig.sshPort || 22}=>${uri}`
    : `${cachePrefix}${uri}`;

  if (connectionPool.has(cacheKey)) {
    const cachedConn = connectionPool.get(cacheKey);
    if (cachedConn.readyState && (cachedConn.readyState === 1 || cachedConn.readyState === 2)) return cachedConn;
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
    ...(useTunnel ? { directConnection: true } : {}),
  };
  const conn = await mongoose.createConnection(connectUri, opts).asPromise();
  connectionPool.set(cacheKey, conn);
  return conn;
}

/**
 * Main entry point for database connections.
 * @param {string} uri - Optional URI to connect to (for vault/private DB).
 * @param {boolean} isCenter - If true, connects to the default MONGODB_URI.
 * @param {string} relayName - Optional relay name for Local Relay connections.
 */
async function connectDB(uri = null, isCenter = false, relayName = null) {
  // If requesting center DB, use the cached default connection
  if (isCenter || !uri) {
    return connectCenter();
  }

  // Non-MongoDB URIs must always go through the dynamic connection path
  const normalizedUri = normalizeRelayDatabaseUri(uri);
  const isNonMongo = normalizedUri && !normalizedUri.startsWith('mongodb://') && !normalizedUri.startsWith('mongodb+srv://');

  // Check if the URI matches the center URI (reuse cached connection)
  if (!isNonMongo && normalizedUri === process.env.MONGODB_URI) {
    return connectCenter();
  }

  // When URI came from request headers, also check for SSH tunnel config.
  // When URI was provided explicitly (e.g., internal server calls), skip tunnel.
  // We need to re-check headers since uri was passed explicitly
  const tunnelConfig = uri ? null : await getTunnelFromRequest();

  // Otherwise, use a separate pool connection for tenant isolation
  return getDynamicConnection(normalizedUri, tunnelConfig, relayName);
}

export default connectDB;
