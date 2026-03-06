import mongoose from "mongoose";
import { headers } from "next/headers";
import mysql from "mysql2/promise";
import { createSSHTunnel, rewriteUriForTunnel, parseUriHostPort } from './sshTunnel.js';

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

/**
 * Extracts Database URI from headers (Private Browser Mode)
 */
export async function getUriFromRequest() {
  try {
    const headersList = await headers();
    const clientUri = headersList.get('x-mongodb-uri');
    if (clientUri) return clientUri;
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
 * Connects to the primary "Center" database using the default mongoose connection.
 */
async function connectCenter(uri) {
  // Check if already connected via the default connection
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };
    // Use the URI from env as the definitive center DB if possible
    const centerUri = process.env.MONGODB_URI || uri;
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

  return cached.conn;
}

/**
 * Connects to a specific private URI and returns a separate connection.
 * Supports MongoDB, MySQL, and SSH-tunneled connections.
 *
 * @param {string} uri           Database URI
 * @param {object|null} tunnelConfig  SSH tunnel config from x-vault-tunnel header
 */
async function getDynamicConnection(uri, tunnelConfig = null) {
  if (!uri) throw new Error("Database URI is missing.");

  // Unique cache key: tunneled connections use a separate key per SSH host
  const cacheKey = tunnelConfig?.enabled
    ? `tunnel:${tunnelConfig.sshUser}@${tunnelConfig.sshHost}:${tunnelConfig.sshPort || 22}=>${uri}`
    : uri;

  if (connectionPool.has(cacheKey)) {
    const cachedConn = connectionPool.get(cacheKey);
    // For Mongoose connections
    if (cachedConn.readyState && cachedConn.readyState === 1) return cachedConn;
    // For MySQL pools (simple check)
    if (cachedConn.pool && !cachedConn._closing) return cachedConn;
    connectionPool.delete(cacheKey);
  }

  // Open SSH tunnel if requested
  let connectUri = uri;
  if (tunnelConfig?.enabled) {
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

  // Default to MongoDB
  const opts = {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    // Required when connecting via tunnel to avoid SRV lookup
    ...(tunnelConfig?.enabled ? { directConnection: true } : {}),
  };
  const conn = await mongoose.createConnection(connectUri, opts).asPromise();
  connectionPool.set(cacheKey, conn);
  return conn;
}

/**
 * Main entry point for database connections.
 * @param {string} uri - Optional URI to connect to.
 * @param {boolean} isCenter - If true, connects to the global default instance.
 */
async function connectDB(uri = null, isCenter = false) {
  const targetUri = uri || (await getUriFromRequest());

  // If this is the center DB (User storage), use the default connection
  if (isCenter || targetUri === process.env.MONGODB_URI) {
    return connectCenter(targetUri);
  }

  // When URI came from request headers, also check for SSH tunnel config.
  // When URI was provided explicitly (e.g., internal server calls), skip tunnel.
  const tunnelConfig = uri ? null : await getTunnelFromRequest();

  // Otherwise, use a separate pool connection for tenant isolation
  return getDynamicConnection(targetUri, tunnelConfig);
}

export default connectDB;
