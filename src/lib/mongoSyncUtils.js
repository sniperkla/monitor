import mongoose from 'mongoose';

/**
 * Convert 24-char hex strings or { $oid: "..." } objects to ObjectId instances.
 * Returns the original value if conversion is not possible.
 */
export function sanitizeObjectId(id) {
  if (!id) return id;
  if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
    try { return new mongoose.Types.ObjectId(id); } catch (_) {}
  }
  if (typeof id === 'object' && id.$oid) {
    try { return new mongoose.Types.ObjectId(id.$oid); } catch (_) {}
  }
  return id;
}

/**
 * Recursively walk an object and convert any $oid values to ObjectIds.
 */
export function sanitizeOidFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      if (v.$oid) {
        obj[k] = sanitizeObjectId(v.$oid);
      } else {
        sanitizeOidFields(v);
      }
    }
  }
  return obj;
}

/**
 * Sanitize a single document's _id and nested $oid fields.
 */
export function sanitizeDocument(doc) {
  const cleanDoc = { ...doc };
  if (cleanDoc._id) cleanDoc._id = sanitizeObjectId(cleanDoc._id);
  sanitizeOidFields(cleanDoc);
  return cleanDoc;
}

/**
 * Retry an async function with exponential backoff.
 */
export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'operation' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[retry] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// Token refresh deduplication — prevents concurrent refreshes
let pendingRefresh = null;

/**
 * Get a Google access token, refreshing if expired. Deduplicates concurrent refresh calls.
 * @param {Function} refreshTokenFn — async function that returns { accessToken, config }
 * @param {Function} getConfigFn — async function that returns the current drive config
 * @param {Function} saveConfigFn — async function that saves the updated config
 */
export async function getDeduplicatedToken(refreshTokenFn, getConfigFn, saveConfigFn) {
  const config = await getConfigFn();

  // Check if token is still valid (with 5-minute safety buffer)
  if (config?.accessToken && config?.expiresAt && config.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return config.accessToken;
  }

  // If a refresh is already in progress, wait for it
  if (pendingRefresh) {
    return pendingRefresh;
  }

  pendingRefresh = (async () => {
    try {
      const result = await refreshTokenFn(config);
      await saveConfigFn(result.config);
      return result.accessToken;
    } finally {
      pendingRefresh = null;
    }
  })();

  return pendingRefresh;
}

/**
 * Normalize connection config for MongoSync.
 * If the connection is an SSH server record (type === 'ssh' or port === 22),
 * transform it into an SSH Tunnel configuration pointing to MongoDB on 127.0.0.1:27017 on the remote server.
 */
export function normalizeMongoConnection(connData) {
  if (!connData) return connData;

  const isSshRecord = connData.type === 'ssh' || (!connData.dbProvider && connData.type !== 'database') || Number(connData.port) === 22;

  if (isSshRecord && !connData.sshTunnel) {
    return {
      ...connData,
      dbProvider: 'mongodb',
      host: connData.mongoHost || '127.0.0.1',
      port: Number(connData.mongoPort) || 27017,
      username: connData.mongoUsername || '',
      password: connData.mongoPassword || '',
      database: connData.database || connData.mongoDatabase || 'monitor',
      sshTunnel: true,
      sshTunnelHost: connData.host,
      sshTunnelPort: Number(connData.port) || 22,
      sshTunnelUser: connData.username || '',
      sshTunnelAuth: connData.authType || 'password',
      sshTunnelPassword: connData.password || null,
      sshTunnelPrivateKey: connData.privateKey || null,
      sshTunnelPassphrase: connData.passphrase || null,
    };
  }

  return connData;
}
