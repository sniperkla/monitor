import mongoose from "mongoose";
import { headers } from "next/headers";
import mysql from "mysql2/promise";

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
 * Supports MongoDB and MySQL.
 */
async function getDynamicConnection(uri) {
  if (!uri) throw new Error("Database URI is missing.");
  
  if (connectionPool.has(uri)) {
    const cachedConn = connectionPool.get(uri);
    // For Mongoose connections
    if (cachedConn.readyState && cachedConn.readyState === 1) return cachedConn;
    // For MySQL pools (simple check)
    if (cachedConn.pool && !cachedConn._closing) return cachedConn;
    
    connectionPool.delete(uri);
  }

  if (uri.startsWith('mysql://')) {
    const pool = mysql.createPool(uri);
    const conn = { 
      type: 'mysql', 
      pool,
      // Helper to mimic mongoose query interface roughly
      query: (sql, params) => pool.execute(sql, params)
    };
    connectionPool.set(uri, conn);
    return conn;
  }

  // Default to MongoDB
  const opts = { bufferCommands: false, serverSelectionTimeoutMS: 5000 };
  const conn = await mongoose.createConnection(uri, opts).asPromise();
  connectionPool.set(uri, conn);
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

  // Otherwise, use a separate pool connection for tenant isolation
  return getDynamicConnection(targetUri);
}

export default connectDB;
