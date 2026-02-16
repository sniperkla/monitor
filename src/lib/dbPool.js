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

import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { decrypt } from '@/utils/encryption';

// Global pool (survives hot reloads in dev)
const globalPool = global.__dbPool || (global.__dbPool = new Map());

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
  if (provider === 'mongodb') {
    const uri = buildMongoUri(conn, password);
    db = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 5,        // MongoDB driver-level pooling (5 sockets per connection)
      minPoolSize: 1,
      maxIdleTimeMS: 60000,  // Close idle sockets after 60s 
    }).asPromise();
  } else if (provider === 'mysql') {
    db = await mysql.createConnection({
      host: conn.host,
      port: conn.port,
      user: conn.username || '',
      password: password || '',
      database: conn.database,
      connectTimeout: 5000,
    });
  } else {
    throw new Error(`Provider ${provider} not supported`);
  }

  const entry = { db, provider, key, lastUsed: Date.now() };
  globalPool.set(key, entry);

  console.log(`🔗 Pool: New connection created for ${key} (pool size: ${globalPool.size})`);
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
