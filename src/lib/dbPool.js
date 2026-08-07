/**
 * Database Connection Pool Manager
 * 
 * Purpose: Instead of creating a NEW database connection for every single API call
 * (schema, query, test, export, import...), we cache and reuse connections.
 * 
 * This dramatically reduces:
 * - RAM (no new socket per request)
 * - CPU (no TLS handshake per request)
 * - Network (no TCP setup/teardown per request)
 * - Load on the target database server
 * 
 * Connections auto-expire after 5 minutes of inactivity.
 */

import net from 'net';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { Client as SshClient } from 'ssh2';
import { decrypt } from '../utils/encryption.js';
import { resolveLocalhostViaRelay } from './sshTunnel.js';
import { headers } from 'next/headers.js';


// Global pool (survives hot reloads in dev)
const globalPool = global.__dbPool || (global.__dbPool = new Map());
// SSH tunnel pool: tunnelKey → { sshClient, server, port, alive }
const tunnelPool = global.__tunnelPool || (global.__tunnelPool = new Map());

const POOL_TTL_MS = 5 * 60 * 1000; // 5 minutes idle timeout
const MAX_POOL_SIZE = 20; // Max concurrent different connections

async function resolveRelayForLocalhost(host, port, userId, relayId) {
  let targetRelayId = relayId;
  if (!targetRelayId) {
    try {
      const h = await headers();
      const preferred = h.get('x-preferred-relay');
      if (preferred) targetRelayId = preferred;
    } catch (e) {}
  }
  return resolveLocalhostViaRelay(host, port, userId, targetRelayId);
}

/**
 * Generate a unique cache key for a connection config.
 * We use host:port:database:username as the key (NOT password for security).
 */
function getCacheKey(conn, connectHost, connectPort) {
  const provider = conn.dbProvider || 'mongodb';
  const host = connectHost || conn.host;
  const port = connectPort || conn.port || 'default';
  const authPart = conn.authSource ? `?authSource=${conn.authSource}` : '';
  const userPart = conn._userId ? `#${conn._userId}` : '';
  return `${provider}://${conn.username || ''}@${host}:${port}/${conn.database || ''}${authPart}${userPart}`;
}

/**
 * Resolve the actual TCP endpoint (SSH tunnel or relay) before connecting.
 */
async function resolveConnectEndpoint(conn) {
  const provider = conn.dbProvider || 'mongodb';
  const defaultPort = provider === 'postgres' ? 5432 : provider === 'mysql' ? 3306 : 27017;
  let connectHost = conn.host;
  let connectPort = conn.port || defaultPort;
  let tunnelKey = null;
  let usedRelay = false;

  if (conn.sshTunnel) {
    const tunnel = await createSSHTunnel(conn);
    connectHost = '127.0.0.1';
    connectPort = tunnel.port;
    tunnelKey = tunnel.tunnelKey;
  } else {
    const resolved = await resolveRelayForLocalhost(connectHost, connectPort, conn._userId, conn.relayName);
    connectHost = resolved.host;
    connectPort = resolved.port;
    usedRelay = resolved.usedRelay;
  }

  return { connectHost, connectPort, tunnelKey, usedRelay };
}

async function validatePooledEntry(entry) {
  const { provider, db } = entry;
  if (provider === 'mongodb') {
    if (db.readyState !== 1) return false;
    await db.db.admin().ping();
    return true;
  }
  if (provider === 'mysql') {
    await db.ping();
    return true;
  }
  if (provider === 'postgres') {
    await db.query('SELECT 1');
    return true;
  }
  return false;
}

/**
 * Open an SSH tunnel and expose the remote DB port on a random local port.
 * Returns { port, tunnelKey } — connect your DB client to 127.0.0.1:port.
 * Tunnels are cached and reused until explicitly closed or cleaned up.
 */
async function createSSHTunnel(conn) {
  const tunnelKey = `ssh:${conn.sshTunnelUser}@${conn.sshTunnelHost}:${conn.sshTunnelPort || 22}→${conn.host}:${conn.port}`;

  // Reuse alive tunnel
  if (tunnelPool.has(tunnelKey)) {
    const existing = tunnelPool.get(tunnelKey);
    if (existing.alive) {
      existing.lastUsed = Date.now();
      console.log(`♻️ SSH Tunnel: Reusing tunnel on port ${existing.port} (${tunnelKey})`);
      return { port: existing.port, tunnelKey };
    }
    // Dead tunnel — clean it up
    try { existing.server.close(); } catch (_) {}
    try { existing.sshClient.end(); } catch (_) {}
    tunnelPool.delete(tunnelKey);
  }

  return new Promise((resolve, reject) => {
    const sshClient = new SshClient();

    const sshConfig = {
      host: conn.sshTunnelHost,
      port: parseInt(conn.sshTunnelPort) || 22,
      username: conn.sshTunnelUser || '',
      readyTimeout: 15000,
    };

    const tunnelAuth = conn.sshTunnelAuth || 'password';
    if (tunnelAuth === 'password' && conn.sshTunnelPassword) {
      try { sshConfig.password = decrypt(conn.sshTunnelPassword); } catch (_) { sshConfig.password = conn.sshTunnelPassword; }
    } else if (tunnelAuth === 'privateKey' && conn.sshTunnelPrivateKey) {
      try { sshConfig.privateKey = decrypt(conn.sshTunnelPrivateKey); } catch (_) { sshConfig.privateKey = conn.sshTunnelPrivateKey; }
      if (conn.sshTunnelPassphrase) {
        try { sshConfig.passphrase = decrypt(conn.sshTunnelPassphrase); } catch (_) { sshConfig.passphrase = conn.sshTunnelPassphrase; }
      }
    }

    const targetHost = conn.host || 'localhost';
    const targetPort = parseInt(conn.port) || 27017;

    // Local TCP server that proxies each socket through the SSH forward
    const localServer = net.createServer((localSocket) => {
      sshClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
        if (err) {
          console.error(`[SSH Tunnel] forwardOut error: ${err.message}`);
          localSocket.destroy();
          return;
        }
        localSocket.pipe(stream);
        stream.pipe(localSocket);
        localSocket.once('close', () => { try { stream.close(); } catch (_) {} });
        stream.once('close', () => { try { localSocket.destroy(); } catch (_) {} });
        stream.once('error', () => { try { localSocket.destroy(); } catch (_) {} });
        localSocket.once('error', () => { try { stream.close(); } catch (_) {} });
      });
    });

    sshClient.once('ready', () => {
      localServer.listen(0, '127.0.0.1', () => {
        const localPort = localServer.address().port;
        console.log(`🔌 SSH Tunnel: OPEN — ${conn.sshTunnelHost} → 127.0.0.1:${localPort} → ${targetHost}:${targetPort}`);
        tunnelPool.set(tunnelKey, {
          sshClient,
          server: localServer,
          port: localPort,
          alive: true,
          lastUsed: Date.now(),
        });
        resolve({ port: localPort, tunnelKey });
      });
    });

    sshClient.once('error', (err) => {
      try { localServer.close(); } catch (_) {}
      reject(new Error(`SSH Tunnel connect error: ${err.message}`));
    });

    try {
      sshClient.connect(sshConfig);
    } catch (err) {
      try { localServer.close(); } catch (_) {}
      reject(err);
    }
  });
}

/** Close and remove an SSH tunnel from the pool. */
async function closeSSHTunnel(tunnelKey) {
  if (!tunnelKey || !tunnelPool.has(tunnelKey)) return;
  const tunnel = tunnelPool.get(tunnelKey);
  tunnel.alive = false;
  try { tunnel.server.close(); } catch (_) {}
  try { tunnel.sshClient.end(); } catch (_) {}
  tunnelPool.delete(tunnelKey);
  console.log(`🔌 SSH Tunnel: CLOSED — ${tunnelKey}`);
}

/**
 * Build a MongoDB URI from a connection config object.
 */
export function buildMongoUri(conn, password) {
  const isSrv = conn.isSrv || (conn.host && conn.host.includes('.mongodb.net'));
  const protocol = isSrv ? 'mongodb+srv' : 'mongodb';
  const portPart = (isSrv || !conn.port || (conn.port === 27017 && isSrv)) ? '' : `:${conn.port}`;

  let base;
  if (conn.username && password) {
    base = `${protocol}://${conn.username}:${encodeURIComponent(password)}@${conn.host}${portPart}/${conn.database || ''}`;
  } else {
    base = `${protocol}://${conn.host}${portPart}/${conn.database || ''}`;
  }

  const params = new URLSearchParams();
  // Default to authSource=admin when credentials are present but authSource is missing
  const authSource = conn.authSource || (conn.username && password ? 'admin' : null);
  if (authSource) params.set('authSource', authSource);
  if (conn.dbOptions && typeof conn.dbOptions === 'object') {
    for (const [key, value] of Object.entries(conn.dbOptions)) {
      if (value != null && value !== '') params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Get or create a pooled database connection.
 * Returns: { db, provider, close: Function }
 * 
 * `db` is:
 *   - For MongoDB: a mongoose.Connection instance (use db.db.collection(...))
 *   - For MySQL: a mysql2 connection instance (use db.query(...))
 */
export async function getPooledConnection(conn) {
  const provider = conn.dbProvider || 'mongodb';
  const password = decrypt(conn.password);

  const { connectHost, connectPort, tunnelKey, usedRelay } = await resolveConnectEndpoint(conn);
  const key = getCacheKey(conn, connectHost, connectPort);

  // Check if we have a cached connection (key includes relay/tunnel port)
  if (globalPool.has(key)) {
    const cached = globalPool.get(key);

    try {
      if (await validatePooledEntry(cached)) {
        cached.lastUsed = Date.now();
        return cached;
      }
    } catch (e) {
      console.log(`♻️ Pool: Stale connection removed for ${key}: ${e.message}`);
      try { await cached.db.close?.() || await cached.db.end?.(); } catch (_) {}
      if (cached.tunnelKey) await closeSSHTunnel(cached.tunnelKey);
      globalPool.delete(key);
    }
  }

  // Evict oldest connection if pool is full
  if (globalPool.size >= MAX_POOL_SIZE) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of globalPool.entries()) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const old = globalPool.get(oldestKey);
      try { await old.db.close?.() || await old.db.end?.(); } catch (_) {}
      globalPool.delete(oldestKey);
      console.log(`♻️ Pool: Evicted oldest connection (pool full): ${oldestKey}`);
    }
  }

  // Create new connection
  let db;

  if (provider === 'mongodb') {
    const tunnelConn = { ...conn, host: connectHost, port: connectPort, isSrv: false };
    const uri = buildMongoUri(tunnelConn, password);
    // DEBUG: log masked URI to diagnose auth failures
    const maskedUri = uri.replace(/:([^@]+)@/, ':***@');
    console.log('[dbPool] MongoDB URI:', maskedUri);
    console.log('[dbPool] authSource:', tunnelConn.authSource, '| password length:', password?.length || 0, '| username:', tunnelConn.username);
    try {
      db = await mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
        maxPoolSize: usedRelay ? 2 : 5,
        minPoolSize: 0,
        maxIdleTimeMS: usedRelay ? 30000 : 60000,
        directConnection: true,
        appName: 'ssh-monitor',
      }).asPromise();
    } catch (err) {
      console.error(`[dbPool] Mongo connection error for user:${tunnelConn.username} host:${connectHost} port:${connectPort} authSource:${tunnelConn.authSource} - ${err.message}`);

      // If authentication failed and no authSource was provided, try a safe fallback to authSource=admin
      const authFailed = String(err.message || '').toLowerCase().includes('authentication failed') || err.code === 18;
      if (authFailed && !tunnelConn.authSource) {
        try {
          console.log('[dbPool] Attempting fallback with authSource=admin');
          const fallbackConn = { ...tunnelConn, authSource: 'admin' };
          const fallbackUri = buildMongoUri(fallbackConn, password);
          const maskedFallback = fallbackUri.replace(/:([^@]+)@/, ':***@');
          console.log('[dbPool] MongoDB fallback URI:', maskedFallback);
          db = await mongoose.createConnection(fallbackUri, {
            serverSelectionTimeoutMS: 15000,
            connectTimeoutMS: 15000,
            maxPoolSize: usedRelay ? 2 : 5,
            minPoolSize: 0,
            maxIdleTimeMS: usedRelay ? 30000 : 60000,
            directConnection: true,
            appName: 'ssh-monitor',
          }).asPromise();
          // Update tunnelConn.authSource so cache key reflects the chosen authSource
          tunnelConn.authSource = 'admin';
        } catch (fbErr) {
          console.error('[dbPool] Mongo fallback authSource=admin failed:', fbErr.message);
          throw err; // rethrow original for upstream handling
        }
      } else {
        // Rethrow original error for upstream handling
        throw err;
      }
    }
  } else if (provider === 'mysql') {
    db = await mysql.createConnection({
      host: connectHost,
      port: connectPort,
      user: conn.username || '',
      password: password || '',
      database: conn.database,
    });
  } else if (provider === 'postgres') {
    db = new PgClient({
      host: connectHost,
      port: connectPort,
      user: conn.username || '',
      password: password || '',
      database: conn.database,
      connectionTimeoutMillis: 10000,
    });
    await db.connect();
  } else {
    throw new Error(`Provider ${provider} not supported`);
  }

  const entry = {
    db,
    provider,
    key,
    tunnelKey,
    usedRelay,
    relayPort: usedRelay ? connectPort : null,
    lastUsed: Date.now(),
  };
  globalPool.set(key, entry);

  const via = tunnelKey ? 'SSH tunnel' : usedRelay ? `relay :${connectPort}` : 'direct';
  console.log(`🔗 Pool: New connection created for ${key} (via ${via}, pool size: ${globalPool.size})`);
  return entry;
}

/**
 * Drop pooled DB connections when the Local Relay reconnects or disconnects.
 * Stale mongoose pools keep talking to old relay ports (e.g. 127.0.0.1:55004) and fail with "connection closed".
 */
export async function flushRelayPooledConnections(reason = 'relay disconnect', filterPort = null) {
  let flushed = 0;
  for (const [key, entry] of globalPool.entries()) {
    if (!entry.usedRelay) continue;
    if (filterPort && entry.relayPort !== filterPort) continue;
    try {
      if (entry.provider === 'mongodb') await entry.db.close();
      else if (entry.provider === 'mysql' || entry.provider === 'postgres') await entry.db.end();
    } catch (_) {}
    if (entry.tunnelKey) await closeSSHTunnel(entry.tunnelKey);
    globalPool.delete(key);
    flushed++;
  }
  if (flushed > 0) {
    console.log(`🧹 Pool: Flushed ${flushed} relay-backed connection(s) (${reason}${filterPort ? ` port ${filterPort}` : ''})`);
  }
}

/**
 * Release (actually just mark as available) - connections stay in pool.
 * Only explicitly close if needed.
 */
export function releaseConnection(key) {
  // No-op: connections stay alive in the pool for reuse. 
  // They will be cleaned up by the TTL sweep.
}

/**
 * Force close and remove a specific connection from pool.
 */
export async function closePooledConnection(key) {
  if (globalPool.has(key)) {
    const entry = globalPool.get(key);
    try {
      if (entry.provider === 'mongodb') await entry.db.close();
      else if (entry.provider === 'mysql' || entry.provider === 'postgres') await entry.db.end();
    } catch (_) {}
    if (entry.tunnelKey) await closeSSHTunnel(entry.tunnelKey);
    globalPool.delete(key);
  }
}

/**
 * Periodic cleanup of idle connections.
 * Runs every 60 seconds in the background.
 */
function startPoolCleanup() {
  if (global.__dbPoolCleanupStarted) return;
  global.__dbPoolCleanupStarted = true;

  setInterval(async () => {
    const now = Date.now();
    for (const [key, entry] of globalPool.entries()) {
      if (now - entry.lastUsed > POOL_TTL_MS) {
        console.log(`🧹 Pool: Cleaning idle connection: ${key}`);
        try {
          if (entry.provider === 'mongodb') await entry.db.close();
          else if (entry.provider === 'mysql' || entry.provider === 'postgres') await entry.db.end();
        } catch (_) {}
        if (entry.tunnelKey) await closeSSHTunnel(entry.tunnelKey);
        globalPool.delete(key);
      }
    }
  }, 60 * 1000); // Check every 60 seconds
}

// Start the cleanup timer
startPoolCleanup();

/**
 * Get current pool stats (for monitoring/debugging).
 */
export function getPoolStats() {
  const stats = [];
  for (const [key, entry] of globalPool.entries()) {
    stats.push({
      key,
      provider: entry.provider,
      idleMs: Date.now() - entry.lastUsed,
      alive: entry.provider === 'mongodb' 
        ? entry.db.readyState === 1 
        : true,
    });
  }
  return { size: globalPool.size, maxSize: MAX_POOL_SIZE, connections: stats };
}
