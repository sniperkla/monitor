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
import { Client as SshClient } from 'ssh2';
import { decrypt } from '@/utils/encryption';

// Global pool (survives hot reloads in dev)
const globalPool = global.__dbPool || (global.__dbPool = new Map());
// SSH tunnel pool: tunnelKey → { sshClient, server, port, alive }
const tunnelPool = global.__tunnelPool || (global.__tunnelPool = new Map());

const POOL_TTL_MS = 5 * 60 * 1000; // 5 minutes idle timeout
const MAX_POOL_SIZE = 20; // Max concurrent different connections

/**
 * Generate a unique cache key for a connection config.
 * We use host:port:database:username as the key (NOT password for security).
 */
function getCacheKey(conn) {
  const provider = conn.dbProvider || 'mongodb';
  return `${provider}://${conn.username || ''}@${conn.host}:${conn.port || 'default'}/${conn.database || ''}`;
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
  
  if (conn.username && password) {
    return `${protocol}://${conn.username}:${encodeURIComponent(password)}@${conn.host}${portPart}/${conn.database || ''}`;
  }
  return `${protocol}://${conn.host}${portPart}/${conn.database || ''}`;
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
  const key = getCacheKey(conn);
  const provider = conn.dbProvider || 'mongodb';
  const password = decrypt(conn.password);

  // Check if we have a cached connection
  if (globalPool.has(key)) {
    const cached = globalPool.get(key);

    // Validate connection is still alive
    try {
      if (provider === 'mongodb' && cached.db.readyState === 1) {
        cached.lastUsed = Date.now();
        return cached;
      } else if (provider === 'mysql') {
        // Quick ping to check if alive
        await cached.db.ping();
        cached.lastUsed = Date.now();
        return cached;
      }
    } catch (e) {
      // Connection is dead, remove it
      console.log(`♻️ Pool: Stale connection removed for ${key}`);
      try { await cached.db.close?.() || await cached.db.end?.(); } catch (_) {}
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
  let tunnelKey = null;

  if (provider === 'mongodb') {
    let connectHost = conn.host;
    let connectPort = conn.port || 27017;

    if (conn.sshTunnel && conn.sshTunnelHost) {
      const tunnel = await createSSHTunnel(conn);
      connectHost = '127.0.0.1';
      connectPort = tunnel.port;
      tunnelKey = tunnel.tunnelKey;
    }

    const tunnelConn = { ...conn, host: connectHost, port: connectPort, isSrv: false };
    const uri = buildMongoUri(tunnelConn, password);
    db = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: tunnelKey ? 10000 : 5000,
      maxPoolSize: 5,
      minPoolSize: 1,
      maxIdleTimeMS: 60000,
      ...(tunnelKey ? { directConnection: true } : {}), // bypass replica set discovery when tunnelled
    }).asPromise();
  } else if (provider === 'mysql') {
    let connectHost = conn.host;
    let connectPort = conn.port || 3306;

    if (conn.sshTunnel && conn.sshTunnelHost) {
      const tunnel = await createSSHTunnel(conn);
      connectHost = '127.0.0.1';
      connectPort = tunnel.port;
      tunnelKey = tunnel.tunnelKey;
    }

    db = await mysql.createConnection({
      host: connectHost,
      port: connectPort,
      user: conn.username || '',
      password: password || '',
      database: conn.database,
      connectTimeout: tunnelKey ? 10000 : 5000,
    });
  } else {
    throw new Error(`Provider ${provider} not supported`);
  }

  const entry = { db, provider, key, tunnelKey, lastUsed: Date.now() };
  globalPool.set(key, entry);

  console.log(`🔗 Pool: New connection created for ${key}${tunnelKey ? ' (via SSH tunnel)' : ''} (pool size: ${globalPool.size})`);
  return entry;
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
      else if (entry.provider === 'mysql') await entry.db.end();
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
          else if (entry.provider === 'mysql') await entry.db.end();
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
