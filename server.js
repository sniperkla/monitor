// Load env manually because node server.js doesn't auto-load .env
const fs = require('fs');
const path = require('path');
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const firstEqual = line.indexOf('=');
      if (firstEqual > 0) {
        const key = line.substring(0, firstEqual).trim();
        let value = line.substring(firstEqual + 1).trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        if (key && !process.env[key]) {
           process.env[key] = value;
        }
      }
    });
  }
} catch(e) { console.error('Error loading .env', e); }

const { createServer } = require('http');
const net = require('net');
const next = require('next');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
const { Client: PgClient, Pool: PgPool } = require('pg');
const { decrypt } = require('./src/utils/encryption');
const compression = require('compression');

const dev = process.env.NODE_ENV !== 'production';
const hostname = dev ? 'localhost' : '0.0.0.0';
const port = parseInt(process.env.PORT, 10) || 3000;

const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

// MongoDB connection — Priority: db-config.json > .env > default
let MONGODB_URI = null;
try {
  const dbConfigPath = path.resolve(__dirname, 'db-config.json');
  if (fs.existsSync(dbConfigPath)) {
    const dbConfig = JSON.parse(fs.readFileSync(dbConfigPath, 'utf-8'));
    if (dbConfig.uri) {
      MONGODB_URI = dbConfig.uri;
      console.log('📂 Using database URI from db-config.json');
    }
  }
} catch (e) {
  console.error('Error reading db-config.json:', e);
}
if (!MONGODB_URI && process.env.MONGODB_URI) {
  MONGODB_URI = process.env.MONGODB_URI;
  console.log('📂 Using database URI from .env');
}

let mongoConnected = false;

async function connectMongo() {
  // Support live reconnection — check if already connected (e.g. via API route)
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    mongoConnected = true;
    return;
  }
  if (!MONGODB_URI) {
    console.log('⚠️  No MongoDB URI configured. Go to Settings → Database to set up.');
    return;
  }

  // ONLY connect to Mongoose if it's a MongoDB URI
  if (!MONGODB_URI.startsWith('mongodb')) {
    console.log('📝 Mongoose skipped: Main database is not MongoDB (MySQL/PostgreSQL mode active)');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    mongoConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('💡 You can configure MongoDB in Settings → Database');
  }
}


// Connection schema (inline for server.js)
const ConnectionSchema = new mongoose.Schema({
  name: String,
  host: String,
  port: { type: Number, default: 22 },
  username: String,
  authType: String,
  password: String,
  privateKey: String,
  keyFileName: String,
  passphrase: String,
  tags: [String],
  color: { type: String, default: '#6366f1' },
  lastConnected: Date,
  status: { type: String, default: 'unknown' },
  isFavorite: { type: Boolean, default: false },
  notes: String,
  info: String,
}, { timestamps: true });

// Session schema
const SessionSchema = new mongoose.Schema({
  connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Connection' },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  duration: Number,
  status: { type: String, default: 'active' },
  errorMessage: String,
}, { timestamps: true });


function getLatestCenterUri() {
  try {
    const dbConfigPath = path.resolve(__dirname, 'db-config.json');
    if (fs.existsSync(dbConfigPath)) {
      const dbConfig = JSON.parse(fs.readFileSync(dbConfigPath, 'utf-8'));
      if (dbConfig.uri) return dbConfig.uri;
    }
  } catch (e) {}
  return process.env.MONGODB_URI || MONGODB_URI;
}

// Multi-tenant Model Pool
const modelsPool = new Map();

/**
 * Rewrite a localhost URI through the user's active Local Relay Agent.
 * If no relay is active for this user, returns the URI unchanged.
 */
function rewriteUriViaRelay(uri, userId) {
  if (!uri || !/localhost|127\.0\.0\.1/.test(uri)) return uri;
  if (!userId || !global.__activeRelays?.size) return uri;
  const relay = global.__activeRelays.get(userId);
  if (!relay?.localPort) return uri;
  // Extract original target port from URI and update relay target
  const portMatch = uri.match(/:(\d+)\//);
  if (portMatch) {
    relay.targetHost = '127.0.0.1';
    relay.targetPort = parseInt(portMatch[1]);
  }
  // Rewrite host:port → 127.0.0.1:{relay.localPort}
  return uri.replace(/(localhost|127\.0\.0\.1):\d+/, `127.0.0.1:${relay.localPort}`);
}

async function getModels(uri, userId) {
  let targetUri = uri || getLatestCenterUri();
  if (!targetUri) return { Connection: null, Session: null };

  // Route localhost URIs through the user's relay agent if one is active
  const effectiveUri = rewriteUriViaRelay(targetUri, userId) || targetUri;
  if (modelsPool.has(effectiveUri)) {
    const cached = modelsPool.get(effectiveUri);
    if (cached.type === 'mysql' || cached.type === 'postgres') return cached;
    if (cached.readyState === 1 || cached.readyState === 2) return {
      type: 'mongodb',
      Connection: cached.models.Connection || cached.model('Connection', ConnectionSchema),
      Session: cached.models.Session || cached.model('Session', SessionSchema)
    };
    modelsPool.delete(effectiveUri);
  }

  if (effectiveUri.startsWith('mysql://')) {
    try {
      const pool = mysql.createPool(effectiveUri);
      const repo = {
        type: 'mysql',
        pool,
        Connection: {
          findById: async (id) => {
            const [rows] = await pool.execute('SELECT * FROM connections WHERE id = ?', [id]);
            if (rows.length === 0) return null;
            const r = rows[0];
            return {
              ...r,
              _id: r.id.toString(),
              tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []),
              isFavorite: !!r.isFavorite,
              database: r.database_name
            };
          },
          findByIdAndUpdate: async (id, data) => {
             const updates = [];
             const values = [];
             for (const [k, v] of Object.entries(data)) {
               if (k === '_id' || k === 'id') continue;
               updates.push(`${k === 'database' ? 'database_name' : k} = ?`);
               values.push(k === 'tags' ? JSON.stringify(v) : (k === 'isFavorite' ? (v ? 1 : 0) : v));
             }
             if (updates.length > 0) {
               values.push(id);
               await pool.execute(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`, values);
             }
             return true;
          }
        },
        Session: {
          create: async (data) => {
             try {
               await pool.execute(`
                 CREATE TABLE IF NOT EXISTS ssh_sessions (
                   id INT AUTO_INCREMENT PRIMARY KEY,
                   connectionId INT,
                   startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
                   endTime DATETIME,
                   duration INT,
                   status VARCHAR(50) DEFAULT 'active',
                   errorMessage TEXT,
                   createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                   updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                 )
               `);
               const [res] = await pool.execute(
                 'INSERT INTO ssh_sessions (connectionId, status) VALUES (?, ?)',
                 [data.connectionId, data.status]
               );
               return { _id: res.insertId, ...data, startTime: new Date() };
             } catch (e) {
               console.error('MySQL Session Error:', e);
               return null;
             }
          },
          findByIdAndUpdate: async (id, data) => {
            try {
              const updates = [];
              const values = [];
              for (const [k, v] of Object.entries(data)) {
                if (k === '_id' || k === 'id') continue;
                updates.push(`${k} = ?`);
                values.push(v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v);
              }
              if (updates.length > 0) {
                values.push(id);
                await pool.execute(`UPDATE ssh_sessions SET ${updates.join(', ')} WHERE id = ?`, values);
              }
              return true;
            } catch (e) {
              console.error('MySQL Session Update Error:', e);
              return false;
            }
          }
        }
      };
      modelsPool.set(effectiveUri, repo);
      return repo;
    } catch (e) {
      console.warn('⚠️ MySQL Init Error:', e.message);
      return { type: 'mysql', Connection: null, Session: null };
    }
  }

  if (effectiveUri.startsWith('postgres://') || effectiveUri.startsWith('postgresql://')) {
    try {
      const pool = new PgPool({ connectionString: effectiveUri, max: 5, connectionTimeoutMillis: 10000 });
      const repo = {
        type: 'postgres',
        pool,
        Connection: {
          findById: async (id) => {
            // PostgreSQL uses integer serial IDs — skip if id looks like a MongoDB ObjectId
            if (!/^\d+$/.test(String(id))) return null;
            const res = await pool.query('SELECT * FROM connections WHERE id = $1', [id]);
            if (res.rows.length === 0) return null;
            const r = res.rows[0];
            return {
              ...r,
              _id: r.id.toString(),
              tags: (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) || [],
              isFavorite: !!r.isfavorite,
              isSrv: !!r.issrv,
              sshTunnel: !!r.sshtunnel,
              database: r.database_name,
              authType: r.authtype || 'password',
              privateKey: r.privatekey || null,
              passphrase: r.passphrase || null,
            };
          },
          findByIdAndUpdate: async (id, data) => {
            if (!/^\d+$/.test(String(id))) return true;
            const fields = [];
            const values = [];
            let i = 0;
            for (const [k, v] of Object.entries(data)) {
              if (k === '_id' || k === 'id') continue;
              const dbKey = k === 'database' ? 'database_name' : k;
              fields.push(`${dbKey} = $${++i}`);
              values.push(['isFavorite', 'isSrv', 'sshTunnel'].includes(k) ? !!v : v);
            }
            if (fields.length === 0) return true;
            values.push(id);
            await pool.query(`UPDATE connections SET ${fields.join(', ')} WHERE id = $${++i}`, values);
            return true;
          }
        },
        Session: {
          create: async (data) => {
            try {
              await pool.query(`
                CREATE TABLE IF NOT EXISTS ssh_sessions (
                  id SERIAL PRIMARY KEY,
                  connection_id INTEGER,
                  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  end_time TIMESTAMP,
                  duration INTEGER,
                  status VARCHAR(50) DEFAULT 'active',
                  error_message TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
              `);
              const res = await pool.query(
                'INSERT INTO ssh_sessions (connection_id, status) VALUES ($1, $2) RETURNING id',
                [data.connectionId, data.status]
              );
              return { _id: res.rows[0].id, ...data, startTime: new Date() };
            } catch (e) {
              console.error('PostgreSQL Session Error:', e);
              return null;
            }
          },
          findByIdAndUpdate: async (id, data) => {
            try {
              if (!/^\d+$/.test(String(id))) return true;
              const updates = [];
              const values = [];
              let i = 0;
              for (const [k, v] of Object.entries(data)) {
                if (k === '_id' || k === 'id') continue;
                updates.push(`${k === 'connectionId' ? 'connection_id' : k} = $${++i}`);
                values.push(v instanceof Date ? v.toISOString() : v);
              }
              if (updates.length > 0) {
                values.push(id);
                await pool.query(`UPDATE ssh_sessions SET ${updates.join(', ')} WHERE id = $${++i}`, values);
              }
              return true;
            } catch (e) {
              console.error('PostgreSQL Session Update Error:', e);
              return false;
            }
          }
        }
      };
      modelsPool.set(effectiveUri, repo);
      return repo;
    } catch (e) {
      console.warn('⚠️ PostgreSQL Init Error:', e.message);
      return { type: 'postgres', Connection: null, Session: null };
    }
  }

  if (!effectiveUri.startsWith('mongodb')) {
    console.warn('⚠️ Unsupported target URI scheme:', effectiveUri);
    return { type: 'unknown', Connection: null, Session: null };
  }

  try {
    const conn = await mongoose.createConnection(effectiveUri, { serverSelectionTimeoutMS: 5000 }).asPromise();
    modelsPool.set(effectiveUri, conn);
    return {
      type: 'mongodb',
      Connection: conn.models.Connection || conn.model('Connection', ConnectionSchema),
      Session: conn.models.Session || conn.model('Session', SessionSchema)
    };
  } catch (e) {
    console.warn('⚠️ Socket DB fallback:', e.message);
    return { type: 'mongodb', Connection: null, Session: null };
  }
}




app.prepare().then(async () => {
  await connectMongo();

  const compress = compression();
  const server = createServer((req, res) => {
    // Apply compression
    compress(req, res, async () => {
    try {
      // Serve local-relay.js as a public static file — bypass Next.js/auth entirely
      // so unauthenticated curl downloads work (e.g. one-liner installer)
      if (req.url === '/local-relay.js') {
        const scriptPath = path.join(__dirname, 'public', 'local-relay.js');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const stream = fs.createReadStream(scriptPath);
        stream.on('error', () => { res.statusCode = 404; res.end('Not found'); });
        stream.pipe(res);
        return;
      }

      // Security Headers - Apply only to main pages, not static assets or internal Next.js paths
      const isNextInternal = req.url.startsWith('/_next/') || req.url.includes('/favicon.ico');
      
      if (!isNextInternal) {
        const cspHeader = `
          default-src 'self';
          script-src 'self' 'unsafe-inline' 'unsafe-eval';
          style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https:;
          img-src 'self' blob: data: https://ui-avatars.com https://images.unsplash.com https://lh3.googleusercontent.com https:;
          font-src 'self' data: https://fonts.gstatic.com https:;
          connect-src 'self' ws: wss: https://ui-avatars.com https:;
          frame-src 'none';
          object-src 'none';
          base-uri 'self';
          form-action 'self' http://localhost:3000 https://accounts.google.com;
          frame-ancestors 'none';
          block-all-mixed-content;
        `.replace(/\s{2,}/g, ' ').trim();

        res.setHeader('Content-Security-Policy', cspHeader);
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      }

      await handle(req, res);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
    }); // End of compress callback
  });

  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || true)
        : '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    path: '/api/socket',
  });

  io.use(async (socket, next) => {
    try {
      const { getToken } = require('next-auth/jwt');
      // Polyfill req.cookies for NextAuth
      if (!socket.request.cookies) {
         const cookieHeader = socket.request.headers.cookie || '';
         socket.request.cookies = Object.fromEntries(cookieHeader.split('; ').filter(Boolean).map(c => {
           let [k, ...v] = c.split('=');
           return [k, decodeURIComponent(v.join('='))];
         }));
      }
      const token = await getToken({ 
        req: socket.request, 
        secret: process.env.NEXTAUTH_SECRET 
      });
      if (!token) return next(new Error("Authentication error: Session invalid."));
      socket.user = token;
      next();
    } catch (err) {
      console.error("Socket Auth Error:", err.message);
      next(new Error("Authentication error"));
    }
  });

// Track active SSH connections
const activeSessions = new Map();

// Idle timeout (10 minutes)
const SSH_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SSH_IDLE_CHECK_INTERVAL_MS = 30 * 1000;

  io.on('connection', (socket) => {
    const dbUri = socket.handshake.query.dbUri;
    console.log(`🔌 Socket connected: ${socket.id} ${dbUri ? '(Private DB)' : '(Global DB)'}`);

    const touchActivity = () => {
      const s = activeSessions.get(socket.id);
      if (s) s.lastActivityAt = Date.now();
    };

    const ensureIdleWatcher = () => {
      const s = activeSessions.get(socket.id);
      if (!s) return;
      if (s.idleInterval) return;
      s.idleInterval = setInterval(async () => {
        const cur = activeSessions.get(socket.id);
        if (!cur) return;
        const last = cur.lastActivityAt || Date.now();
        const idleFor = Date.now() - last;

        if (idleFor > SSH_IDLE_TIMEOUT_MS / 2) {
          const lastLogAt = cur.lastIdleLogAt || 0;
          if (Date.now() - lastLogAt > 30 * 1000) {
            cur.lastIdleLogAt = Date.now();
            console.log(`🕒 SSH idle watcher socket ${socket.id}: idleFor=${idleFor}ms timeout=${SSH_IDLE_TIMEOUT_MS}ms`);
          }
        }

        if (idleFor > SSH_IDLE_TIMEOUT_MS) {
          console.log(`⏳ SSH idle timeout for socket ${socket.id} (>${SSH_IDLE_TIMEOUT_MS}ms). Disconnecting.`);
          try {
            socket.emit('ssh:idle_timeout');
          } catch (e) {}
          await cleanupSession(socket.id);
          try {
            socket.disconnect(true);
          } catch (e) {}
        }
      }, SSH_IDLE_CHECK_INTERVAL_MS);
    };

    // Count any SSH/SFTP usage as activity. (We do NOT count heartbeat pings as activity.)
    socket.onAny((eventName) => {
      if (
        eventName === 'ssh:input' ||
        (typeof eventName === 'string' && eventName.startsWith('sftp:'))
      ) {
        touchActivity();
      }
    });

    // Latency Ping-Pong - Also serves as a keep-alive to prevent SSH idle timeout
    socket.on('heartbeat:ping', (timestamp) => {
      touchActivity();
      socket.emit('heartbeat:pong', timestamp);
    });

      socket.on('ssh:connect', async (data) => {
      const { connectionId, connection: connectionData, cols, rows } = data;
      const repo = await getModels(dbUri, socket.user?.sub);
      const { Connection: CurrentConnectionModel, Session: CurrentSessionModel } = repo;

      try {
        let connection;

        // Helper: check if a string is a valid 24-char MongoDB ObjectId
        const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
        
        // Handle DB Connections
        if (connectionId && !connectionId.startsWith('local-')) {
          if (CurrentConnectionModel) {
            try {
              // For MongoDB: only look up if connectionId looks like a real ObjectId
              // For PostgreSQL/MySQL: the model's findById handles numeric IDs directly
              if (isValidObjectId(connectionId) || typeof CurrentConnectionModel.findById === 'function') {
                if (isValidObjectId(connectionId)) await connectMongo();
                connection = await CurrentConnectionModel.findById(connectionId);
              }
            } catch (lookupErr) {
              if (lookupErr.name === 'CastError') {
                // connectionId is not a valid MongoDB ObjectId (e.g. a PostgreSQL integer ID)
                // Fall through to connectionData below
                connection = null;
              } else if (lookupErr.code === 'ECONNREFUSED' || lookupErr.message?.includes('Local Relay')) {
                // Center DB unreachable (relay not running) — fall through to connectionData
                console.warn('⚠️ Center DB unreachable for connection lookup — using provided connectionData:', lookupErr.message);
                connection = null;
              } else {
                throw lookupErr;
              }
            }
          } else if (!connectionData) {
            // Vault not configured and no fallback data — vault needs to unlock first
            socket.emit('ssh:error', { message: 'vault_not_ready' });
            return;
          }
        }
        
        // Use provided data if DB lookup fails or if it's a local/manual connection
        if (!connection && connectionData) {
          connection = connectionData;
        }

        if (!connection) {
          socket.emit('ssh:error', { message: 'Connection not found' });
          return;
        }

        // Cleanup any existing session on this socket before creating a new one
        await cleanupSession(socket.id);
        
        // Prevent listener stacking: remove previous SFTP and SSH specific handlers
        const sftpEvents = [
          'sftp:list', 'sftp:mkdir', 'sftp:delete', 'sftp:readFile', 
          'sftp:writeFile', 'sftp:applyPatch', 'sftp:copy', 'sftp:move', 'sftp:cross_server_transfer',
          'sftp:upload', 'sftp:download', 'sftp:download_folder', 'sftp:search'
        ];
        const sshEvents = ['ssh:input', 'ssh:resize'];
        sftpEvents.forEach(ev => socket.removeAllListeners(ev));
        sshEvents.forEach(ev => socket.removeAllListeners(ev));

        const ensureSftp = (sessionData) => {
          return new Promise((resolve, reject) => {
            if (sessionData.sftp) return resolve(sessionData.sftp);
            sessionData.sshClient.sftp((err, sftp) => {
              if (err) return reject(err);
              sessionData.sftp = sftp;
              resolve(sftp);
            });
          });
        };

        // Create session only for valid DB connections AND if Session model is available
        // For MongoDB: connectionId must be a valid ObjectId (skip for PostgreSQL integer IDs)
        // For PostgreSQL/MySQL: the SQL Session model handles integer IDs natively
        let session = null;
        if (connectionId && !connectionId.startsWith('local-') && CurrentSessionModel) {
          // Only use Mongoose session model for valid MongoDB ObjectIds
          const isMgoSession = repo.type === 'mongodb' && isValidObjectId(connectionId);
          const isSqlSession = (repo.type === 'mysql' || repo.type === 'postgres') && /^\d+$/.test(String(connectionId));
          if (isMgoSession || isSqlSession) {
            try {
              // Final safety: if MongoDB, ensure the ID we're saving is also a valid ObjectId
              if (repo.type === 'mongodb' && !isValidObjectId(connection._id)) {
                 throw new Error(`Cannot save non-ObjectId ${connection._id} to MongoDB session`);
              }
              session = await CurrentSessionModel.create({
                connectionId: connection._id,
                status: 'active',
              });
            } catch (sessionErr) {
              // Non-fatal: session tracking is optional
              console.warn('⚠️ Could not create session record:', sessionErr.message);
            }
          }
        }

        const sshClient = new Client();

        sshClient.on('ready', () => {
          console.log(`✅ SSH ready for ${connection.host}`);
          
          const emitSftpError = (err, prefix = '') => {
            const message = typeof err === 'string' ? err : (err?.message || 'Unknown SFTP error');
            socket.emit('sftp:error', { message: prefix ? `${prefix}: ${message}` : message });
          };

          const getSftp = (cb) => {
            const sessionData = activeSessions.get(socket.id);
            if (sessionData && sessionData.sftp) {
              return cb(null, sessionData.sftp);
            }
            sshClient.sftp((err, sftp) => {
              if (err) return cb(err);
              if (sessionData) sessionData.sftp = sftp;
              cb(null, sftp);
            });
          };
          
          // Request a PTY shell
          sshClient.shell({ term: 'xterm-256color', cols: cols || 120, rows: rows || 30 }, (err, stream) => {
            if (err) {
              socket.emit('ssh:error', { message: err?.message || String(err) || 'Failed to open shell' });
              return;
            }

            // Store active session
            activeSessions.set(socket.id, { 
              sshClient, 
              stream, 
              session, 
              connectionId, 
              dbUri,
              activeTransfers: new Set(), // Track transfer IDs for cleanup
              lastActivityAt: Date.now(),
              lastIdleLogAt: 0,
              idleInterval: null,
            });

            ensureIdleWatcher();

            // Forward SSH output to client
            stream.on('data', (data) => {
              touchActivity();
              socket.emit('ssh:data', data.toString('utf-8'));
            });

            stream.stderr.on('data', (data) => {
              touchActivity();
              socket.emit('ssh:data', data.toString('utf-8'));
            });

            stream.on('close', () => {
              console.log(`📴 SSH stream closed for socket ${socket.id}`);
              socket.emit('ssh:closed');
              // Don't cleanup everything immediately if we want to keep SFTP alive
              // But we usually want to close both.
            });

            // Forward client input to SSH
            socket.on('ssh:input', (inputData) => {
              touchActivity();
              if (stream.writable) {
                stream.write(inputData);
              }
            });

            // Handle terminal resize
            socket.on('ssh:resize', ({ cols, rows }) => {
              if (stream) {
                stream.setWindow(rows, cols, 0, 0);
              }
            });
          });

          // Register SFTP handlers immediately when ready
          socket.on('sftp:list', (path = '.') => {
            console.log(`📂 [${socket.id}] SFTP LIST REQUEST: ${path}`);
            if (!sshClient || sshClient._state === 'closed') {
               return socket.emit('sftp:error', { message: 'SSH Connection Closed' });
            }

            let sftpHandled = false;
            const sftpTimeout = setTimeout(() => {
              if (sftpHandled) return;
              sftpHandled = true;
              fallbackFileListing(socket, sshClient, path);
            }, 2000);

            getSftp((err, sftp) => {
              if (sftpHandled) return;
              clearTimeout(sftpTimeout);
              sftpHandled = true;

              if (err) return fallbackFileListing(socket, sshClient, path);

              const targetPath = path === '.' ? './' : path;
              sftp.readdir(targetPath, (err, list) => {
                if (err) return fallbackFileListing(socket, sshClient, path);
                socket.emit('sftp:list', { path, files: list });
              });
            });
          });

          // ── Global SFTP Search (find across entire filesystem) ──────────────
          socket.on('sftp:search', ({ query } = {}) => {
            const q = String(query || '').trim();
            if (!q) return socket.emit('sftp:searchResult', { query: q, results: [], error: null });
            if (!sshClient || sshClient._state === 'closed') {
              return socket.emit('sftp:searchResult', { query: q, results: [], error: 'SSH not connected' });
            }
            console.log(`🔍 [${socket.id}] SFTP SEARCH: "${q}"`);

            // Escape only characters that could break the shell pattern inside double-quotes
            const escapedQ = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');

            // Two-pass search (semicolon-separated so both always run):
            // 1) $HOME — covers all user/hidden files like .zeroclaw (fast)
            // 2) / excluding $HOME and noisy pseudo-fs (broader, may be slower)
            // Results are merged and de-duplicated on arrival.
            // Double-quoted pattern so $HOME is expanded by the remote shell.
            const cmd = [
              `find $HOME -iname "*${escapedQ}*" 2>/dev/null | head -150`,
              `find / \\( -path "$HOME" -o -path /proc -o -path /sys -o -path /dev -o -path /run \\) -prune -o -iname "*${escapedQ}*" -print 2>/dev/null | head -100`,
            ].join(' ; ');

            let output = '';
            let done = false;

            // Safety valve: emit whatever arrived after 8 s if stream never closes
            const safetyTimer = setTimeout(() => {
              if (done) return;
              done = true;
              emitResults();
            }, 8000);

            const emitResults = () => {
              clearTimeout(safetyTimer);
              const seen = new Set();
              const results = output
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !seen.has(l) && seen.add(l))
                .map(absPath => ({
                  filename: absPath.split('/').pop(),
                  absPath,
                  dir: absPath.split('/').slice(0, -1).join('/') || '/',
                }));
              console.log(`🔍 [${socket.id}] Search "${q}" → ${results.length} results`);
              socket.emit('sftp:searchResult', { query: q, results, error: null });
            };

            sshClient.exec(cmd, (err, stream) => {
              if (err) {
                clearTimeout(safetyTimer);
                return socket.emit('sftp:searchResult', { query: q, results: [], error: err.message });
              }
              stream.on('data', d => { output += d.toString(); });
              stream.stderr.on('data', () => {}); // suppress permission-denied noise
              stream.on('close', () => { if (!done) { done = true; emitResults(); } });
            });
          });

          // Helper for ls fallback
          function fallbackFileListing(socket, client, path) {
            // Fix: ensure '.' is passed effectively or handled correctly
            // If path is '.', use '.' as argument.
            // If path is '.', use '.' as argument WITHOUT quotes because quotes on dot can be weird in some shells or handled weirdly?
            // Actually, quotes are fine. But let's be safe.
            const target = path === '.' ? '.' : `"${path}"`;
            const cmd = `ls -la --full-time ${target}`; 
            console.log(`🔧 [${socket.id}] Running fallback command: ${cmd}`);
            
            if (!client || client._state === 'closed') {
               console.warn(`⚠️ [${socket.id}] Fallback skip: client not connected`);
               return socket.emit('sftp:error', { message: 'SSH Client Disconnected during listing' });
            }
            client.exec(cmd, (err, stream) => {
              if (err) {
                 console.error(`❌ Fallback exec failed: ${err.message}`);
                 return socket.emit('sftp:error', { message: 'Fallback command failed: ' + err.message });
              }
              
              let output = '';
              stream.on('data', (data) => { output += data.toString(); });
              stream.on('close', () => {
                const files = parseLsOutput(output);
                console.log(`✅ Fallback found ${files.length} items`);
                socket.emit('sftp:list', { path, files });
              });
              stream.stderr.on('data', (data) => console.error('Fallback stderr:', data.toString()));
            });
          }

          function parseLsOutput(output) {
            const lines = output.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('total'));
            return lines.map(line => {
              // Simple parser for standard ls -la output
              // drwxr-xr-x 2 root root 4096 2023-01-01 10:00:00.000000000 +0000 dirname
              const parts = line.split(/\s+/);
              if (parts.length < 9) return null;
              
              const isDir = parts[0].startsWith('d');
              const size = parseInt(parts[4]) || 0;
              // Reconstruct date/time (simplified)
              const dateStr = `${parts[5]} ${parts[6]}`; 
              const mtime = new Date(dateStr).getTime() / 1000;
              
              // Handle filename (can contain spaces)
              const filename = parts.slice(8).join(' ');
              if (filename === '.' || filename === '..') return null;
              
              return {
                filename: filename,
                longname: line, // Simulate SFTP longname
                attrs: {
                  size: size,
                  mtime: new Date(dateStr).getTime() / 1000,
                  mode: isDir ? 16877 : 33188 // Standard dir/file modes
                }
              };
            }).filter(f => f !== null);
          }

           socket.on('sftp:mkdir', (path) => {
            getSftp((err, sftp) => {
              if (err) return emitSftpError(err, 'SFTP Init');
              sftp.mkdir(path, (err) => {
                if (err) return emitSftpError(err, 'Mkdir failed');
                socket.emit('sftp:action_success', { action: 'mkdir', path });
              });
            });
          });

          // Delete File/Directory
          socket.on('sftp:delete', (path) => {
            console.log(`🗑️ [${socket.id}] SFTP DELETE: ${path}`);
            getSftp((err, sftp) => {
              if (err) {
                 // Fallback to rm
                 console.warn('⚠️ SFTP unavailable for delete. Using rm fallback.');
                 return sshClient.exec(`rm -rf "${path}"`, (err, stream) => {
                   if (err) return emitSftpError(err, 'Fallback delete failed');
                   stream.on('close', (code) => {
                     if (code === 0) socket.emit('sftp:action_success', { action: 'delete', path });
                     else emitSftpError(`Exit code ${code}`, 'Delete failed');
                   });
                 });
              }

              // Try unlink first (for files), if fails try rmdir (for dirs)
              // Or just use exec 'rm -rf' directly? Actually 'rm -rf' is safer often than manual recursion.
              // Let's stick with 'rm -rf' even if SFTP is available if it's recursive?
              // SFTP unlink is only for files. rmdir is for empty dirs.
              // To be safe and powerful, let's just use 'rm -rf' via exec always if we can?
              // But 'sftp' is safer for restricted shells. Let's try sftp.unlink first.
              
              sftp.unlink(path, (err) => {
                if (!err) return socket.emit('sftp:action_success', { action: 'delete', path });
                
                // If unlink failed, maybe it's a directory?
                sftp.rmdir(path, (err2) => {
                   if (!err2) return socket.emit('sftp:action_success', { action: 'delete', path });
                   
                   // If both failed, try fallback rm -rf
                   console.log('⚠️ SFTP unlink/rmdir failed. Trying fallback rm -rf');
                   sshClient.exec(`rm -rf "${path}"`, (err, stream) => {
                      if (err) return emitSftpError(err, 'Delete failed');
                      stream.on('close', (code) => {
                        if (code === 0) socket.emit('sftp:action_success', { action: 'delete', path });
                        else emitSftpError(`Exit code ${code}`, 'Delete failed');
                      });
                   });
                });
              });
            });
          });

          // Read File
          socket.on('sftp:readFile', (path) => {
            console.log(`📖 [${socket.id}] SFTP READ: ${path}`);
            getSftp((err, sftp) => {
              if (err) {
                 return sshClient.exec(`cat "${path}"`, (err, stream) => {
                   if (err) return emitSftpError(err, 'Fallback read failed');
                   let content = '';
                   stream.on('data', d => content += d.toString());
                   stream.on('close', () => socket.emit('sftp:file_content', { path, content }));
                 });
              }

              const stream = sftp.createReadStream(path);
              let content = '';
              stream.on('data', d => content += d.toString());
              stream.on('end', () => socket.emit('sftp:file_content', { path, content }));
              stream.on('error', (err) => {
                 console.error('SFTP Read Error:', err);
                 // Fallback
                 sshClient.exec(`cat "${path}"`, (err, stream) => {
                   if (err) return emitSftpError(err, 'Read failed');
                   let content = '';
                   stream.on('data', d => content += d.toString());
                   stream.on('close', () => socket.emit('sftp:file_content', { path, content }));
                 });
              });
            });
          });

          // Write File
          socket.on('sftp:writeFile', ({ path, content }) => {
            console.log(`💾 [${socket.id}] SFTP WRITE: ${path} (${content.length} bytes)`);
            getSftp((err, sftp) => {
              if (err) {
                 const b64 = Buffer.from(content).toString('base64');
                 const cmd = `echo "${b64}" | base64 -d > "${path}"`;
                 return sshClient.exec(cmd, (err, stream) => {
                    if (err) return emitSftpError(err, 'Fallback write failed');
                    stream.on('close', (code) => {
                      if (code === 0) socket.emit('sftp:action_success', { action: 'write', path });
                      else emitSftpError(`Exit code ${code}`, 'Write failed');
                    });
                 });
              }

              const stream = sftp.createWriteStream(path);
              stream.write(content);
              stream.end();
              stream.on('close', () => socket.emit('sftp:action_success', { action: 'write', path }));
              stream.on('error', (err) => emitSftpError(err, 'Write failed'));
            });
          });

          // ── Apply Patch via diff-match-patch ─────────────────────────────────
          socket.on('sftp:applyPatch', ({ diffText, backupId }) => {
            console.log(`🩹 [${socket.id}] SFTP APPLY PATCH (backupId: ${backupId})`);
            const diff_match_patch = require('diff-match-patch');

            // Parse unified diff into per-file sections
            const parseDiffIntoFiles = (text) => {
              const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
              const sections = [];
              let current = null;

              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                if (trimmed.startsWith('--- ') && !trimmed.startsWith('--- a/')) {
                  const nextLine = (lines[i + 1] || '').trim();
                  if (nextLine.startsWith('+++ ')) {
                    if (current) sections.push(current);
                    let filePath = trimmed.slice(4).split('\t')[0].trim();
                    current = { filePath, diffLines: [line] };
                    continue;
                  }
                } else if (trimmed.startsWith('--- a/')) {
                  if (current) sections.push(current);
                  let filePath = trimmed.slice(6).split('\t')[0].trim();
                  current = { filePath, diffLines: [line] };
                  continue;
                }

                if (current) {
                  current.diffLines.push(line);
                  // Update filePath from +++ line
                  if (trimmed.startsWith('+++ ') && !current.plusPath) {
                    let pp = trimmed.slice(4).split('\t')[0].trim();
                    if (pp.startsWith('b/')) pp = pp.slice(2);
                    if (pp !== '/dev/null') current.plusPath = pp;
                  }
                }
              }
              if (current) sections.push(current);

              // Resolve final file path for each section
              for (const sec of sections) {
                let fp = sec.plusPath || sec.filePath;
                if (fp.startsWith('a/')) fp = fp.slice(2);
                if (fp.startsWith('b/')) fp = fp.slice(2);
                sec.resolvedPath = fp;
              }
              return sections;
            };

            // Convert a per-file unified diff section into DMP patch text
            const unifiedToDmpPatch = (diffLines) => {
              // DMP patch_fromText expects the GNU unified diff format
              // We'll rebuild it cleanly
              const patchLines = [];
              for (const line of diffLines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('diff ') || trimmed.startsWith('index ')) continue;
                if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ')) continue;
                patchLines.push(line);
              }
              return patchLines.join('\n');
            };

            const sections = parseDiffIntoFiles(diffText);
            if (sections.length === 0) {
              return socket.emit('sftp:patchResult', { success: false, error: 'No valid diff sections found' });
            }

            const results = [];
            let completed = 0;

            const resolveFilePath = (filePath, cb) => {
              // Expand ~ to $HOME on the remote
              if (filePath.startsWith('~')) {
                // Use a quick exec to get $HOME
                sshClient.exec('echo $HOME', (err, stream) => {
                  if (err) return cb(filePath); // fallback
                  let home = '';
                  stream.on('data', (d) => home += d.toString().trim());
                  stream.on('close', () => {
                    if (home) {
                      cb(filePath.replace(/^~/, home));
                    } else {
                      cb(filePath);
                    }
                  });
                });
              } else {
                cb(filePath);
              }
            };

            const processSection = (section) => {
              resolveFilePath(section.resolvedPath, (absPath) => {
                console.log(`🩹 [${socket.id}] Patching file: ${absPath}`);

                // Read current file content
                const readFile = (cb) => {
                  getSftp((err, sftp) => {
                    if (err) {
                      // Fallback to exec cat
                      sshClient.exec(`cat "${absPath}" 2>/dev/null || echo ""`, (err, stream) => {
                        if (err) return cb(err, '');
                        let content = '';
                        stream.on('data', d => content += d.toString());
                        stream.on('close', () => cb(null, content));
                      });
                      return;
                    }
                    const rs = sftp.createReadStream(absPath);
                    let content = '';
                    rs.on('data', d => content += d.toString());
                    rs.on('end', () => cb(null, content));
                    rs.on('error', (readErr) => {
                      // File might not exist yet (new file)
                      cb(null, '');
                    });
                  });
                };

                readFile((err, originalContent) => {
                  if (err) {
                    results.push({ file: absPath, success: false, error: err.message, originalContent: '', newContent: '' });
                    finishOne();
                    return;
                  }

                  // Create backup if backupId provided
                  const doBackup = (cb) => {
                    if (!backupId) return cb();
                    getSftp((err, sftp) => {
                      if (err) return cb(); // skip backup on error
                      const backupPath = `${absPath}.bak.${backupId}`;
                      const ws = sftp.createWriteStream(backupPath);
                      ws.write(originalContent);
                      ws.end();
                      ws.on('close', () => {
                        console.log(`💾 [${socket.id}] Backup created: ${backupPath}`);
                        cb();
                      });
                      ws.on('error', () => cb()); // skip backup on error
                    });
                  };

                  doBackup(() => {
                    // Apply patch using diff-match-patch
                    try {
                      const dmp = new diff_match_patch();
                      dmp.Match_Threshold = 0.5; // fuzzy matching
                      dmp.Patch_DeleteThreshold = 0.5;

                      // Build the unified diff text for this file.
                      // Strip --- / +++ / diff / index header lines first — DMP's patch_fromText
                      // treats lines starting with '-'/'+'  as content deletions/insertions, so
                      // leaving the file-header lines in would corrupt the output.
                      const hunkText = unifiedToDmpPatch(section.diffLines);

                      // Try DMP patch_fromText with the cleaned hunk
                      let patches;
                      try {
                        patches = dmp.patch_fromText(hunkText);
                      } catch (e) {
                        // Fallback: manually parse unified diff into DMP patches
                        patches = dmp.patch_make(originalContent, applyManualUnifiedDiff(originalContent, section.diffLines));
                      }

                      if (!patches || patches.length === 0) {
                        // Try manual line-by-line application as final fallback
                        const manualResult = applyManualUnifiedDiff(originalContent, section.diffLines);
                        if (manualResult !== null && manualResult !== originalContent) {
                          writeResult(absPath, manualResult, () => {
                            results.push({ file: absPath, success: true, method: 'manual', originalContent, newContent: manualResult });
                            finishOne();
                          });
                          return;
                        }
                        results.push({ file: absPath, success: false, error: 'Could not parse patches', originalContent, newContent: originalContent });
                        finishOne();
                        return;
                      }

                      const [newText, patchResults] = dmp.patch_apply(patches, originalContent);
                      const allApplied = patchResults.every(r => r === true);
                      const anyApplied = patchResults.some(r => r === true);

                      if (allApplied || anyApplied) {
                        writeResult(absPath, newText, () => {
                          results.push({ 
                            file: absPath, 
                            success: true, 
                            method: 'dmp',
                            partial: !allApplied,
                            applied: patchResults.filter(r => r).length,
                            total: patchResults.length,
                            originalContent,
                            newContent: newText
                          });
                          finishOne();
                        });
                      } else {
                        // DMP failed, try manual line-by-line
                        const manualResult = applyManualUnifiedDiff(originalContent, section.diffLines);
                        if (manualResult !== null && manualResult !== originalContent) {
                          writeResult(absPath, manualResult, () => {
                            results.push({ file: absPath, success: true, method: 'manual-fallback', originalContent, newContent: manualResult });
                            finishOne();
                          });
                        } else {
                          results.push({ file: absPath, success: false, error: 'All hunks failed to apply', originalContent, newContent: originalContent });
                          finishOne();
                        }
                      }
                    } catch (patchErr) {
                      console.error(`🩹 [${socket.id}] Patch error for ${absPath}:`, patchErr.message);
                      results.push({ file: absPath, success: false, error: patchErr.message, originalContent, newContent: originalContent });
                      finishOne();
                    }
                  });
                });
              });
            };

            // Manual unified diff application (line-by-line)
            const applyManualUnifiedDiff = (original, diffLines) => {
              try {
                const origLines = original.split('\n');
                const newLines = [...origLines];
                let offset = 0;

                // Parse hunks
                let i = 0;
                while (i < diffLines.length) {
                  const line = diffLines[i].trim();
                  const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                  if (!hunkMatch) { i++; continue; }

                  const oldStart = parseInt(hunkMatch[1]) - 1; // 0-indexed
                  i++;

                  let pos = oldStart + offset;
                  while (i < diffLines.length) {
                    const dl = diffLines[i];
                    if (dl.trim().startsWith('@@ ') || dl.trim().startsWith('--- ') || dl.trim().startsWith('+++ ') || dl.trim().startsWith('diff ')) break;

                    if (dl.startsWith('-')) {
                      // Remove line
                      if (pos < newLines.length) {
                        newLines.splice(pos, 1);
                        offset--;
                      }
                    } else if (dl.startsWith('+')) {
                      // Add line
                      newLines.splice(pos, 0, dl.slice(1));
                      pos++;
                      offset++;
                    } else {
                      // Context line (space prefix) — skip
                      pos++;
                    }
                    i++;
                  }
                }
                return newLines.join('\n');
              } catch (e) {
                console.error('Manual unified diff apply failed:', e);
                return null;
              }
            };

            const writeResult = (filePath, content, cb) => {
              getSftp((err, sftp) => {
                if (err) {
                  // Fallback: use base64 write
                  const b64 = Buffer.from(content).toString('base64');
                  const cmd = `echo "${b64}" | base64 -d > "${filePath}"`;
                  sshClient.exec(cmd, (err, stream) => {
                    if (err) return cb(err);
                    stream.on('close', () => cb());
                  });
                  return;
                }
                const ws = sftp.createWriteStream(filePath);
                ws.write(content);
                ws.end();
                ws.on('close', () => cb());
                ws.on('error', (writeErr) => cb(writeErr));
              });
            };

            const finishOne = () => {
              completed++;
              if (completed >= sections.length) {
                const allSuccess = results.every(r => r.success);
                const successFiles = results.filter(r => r.success).map(r => r.file);
                const failedFiles = results.filter(r => !r.success).map(r => ({ file: r.file, error: r.error }));
                
                console.log(`🩹 [${socket.id}] Patch complete: ${successFiles.length}/${sections.length} files patched`);
                socket.emit('sftp:patchResult', {
                  success: allSuccess,
                  results,
                  summary: allSuccess 
                    ? `✅ Patched ${successFiles.length} file(s) successfully`
                    : `⚠️ ${successFiles.length}/${sections.length} files patched. Failed: ${failedFiles.map(f => f.file).join(', ')}`
                });
              }
            };

            // Process all file sections
            sections.forEach(processSection);
          });

          // Copy File/Directory
          socket.on('sftp:copy', ({ src, dest }) => {
            console.log(`📋 [${socket.id}] SFTP COPY: ${src} -> ${dest}`);
            getSftp((err, sftp) => {
              if (err) return emitSftpError(err, 'SFTP Init');
              
              sftp.stat(src, (err, stats) => {
                if (err) return emitSftpError(err, 'Stat failed');

                if (stats.isDirectory()) {
                  // For directories, use tar for speed and to avoid rate limits by streaming
                  const srcDir = path.posix.dirname(src);
                  const srcBase = path.posix.basename(src);
                  const destDir = path.posix.dirname(dest);
                  
                  socket.emit('sftp:progress', { action: 'copy', filename: srcBase, progress: 10 });
                  
                  // Wrap in a subshell to ensure proper directory nesting - use 'z' for compression
                  const cmd = `tar czf - -C "${srcDir}" "${srcBase}" | tar xzf - -C "${destDir}"`;
                  console.log(`📦 Running optimized tar copy: ${cmd}`);
                  
                  sshClient.exec(cmd, (err, stream) => {
                    if (err) return emitSftpError(err, 'Copy Init');
                    socket.emit('sftp:progress', { action: 'copy', filename: srcBase, progress: 50 });
                    stream.on('close', (code) => {
                      if (code === 0) {
                        socket.emit('sftp:progress', { action: 'copy', filename: srcBase, progress: 100 });
                        socket.emit('sftp:action_success', { action: 'copy', path: dest });
                      } else emitSftpError(`Exit code ${code}`, 'Copy failed');
                    });
                  });
                } else {
                  // For files, use streaming to enable REAL progress bar
                  const rStream = sftp.createReadStream(src);
                  const wStream = sftp.createWriteStream(dest);
                  let bytes = 0;
                  
                  rStream.on('data', (d) => {
                    bytes += d.length;
                    socket.emit('sftp:progress', {
                      action: 'copy',
                      filename: path.posix.basename(src),
                      progress: Math.round((bytes / stats.size) * 100)
                    });
                  });
                  
                  rStream.pipe(wStream);
                  wStream.on('close', () => socket.emit('sftp:action_success', { action: 'copy', path: dest }));
                  rStream.on('error', (err) => emitSftpError(err, 'Read Source'));
                  wStream.on('error', (err) => emitSftpError(err, 'Write Dest'));
                }
              });
            });
          });

          // Move File/Directory
          socket.on('sftp:move', ({ src, dest }) => {
            console.log(`🚚 [${socket.id}] SFTP MOVE: ${src} -> ${dest}`);
            getSftp((err, sftp) => {
              if (err) return emitSftpError(err, 'SFTP Init');
              
              socket.emit('sftp:progress', { action: 'move', filename: path.posix.basename(src), progress: 30 });
              
              sftp.rename(src, dest, (err) => {
                if (!err) {
                  socket.emit('sftp:progress', { action: 'move', filename: path.posix.basename(src), progress: 100 });
                  return socket.emit('sftp:action_success', { action: 'move', path: dest });
                }
                
                // Fallback mv
                sshClient.exec(`mv "${src}" "${dest}"`, (err, stream) => {
                  if (err) return emitSftpError(err, 'Move failed');
                  socket.emit('sftp:progress', { action: 'move', filename: path.posix.basename(src), progress: 60 });
                  stream.on('close', (code) => {
                    if (code === 0) {
                      socket.emit('sftp:progress', { action: 'move', filename: path.posix.basename(src), progress: 100 });
                      socket.emit('sftp:action_success', { action: 'move', path: dest });
                    }
                    else emitSftpError(`Exit code ${code}`, 'Move failed');
                  });
                });
              });
            });
          });

          // Cross-Server File Transfer
          socket.on('sftp:cross_server_transfer', ({ srcConnId, srcPath, destPath, action }) => {
            console.log(`🌐 [${socket.id}] CROSS-SERVER: ${srcConnId}:${srcPath} -> CurrentServer:${destPath}`);
            
            const srcSession = Array.from(activeSessions.values()).find(s => s.connectionId && String(s.connectionId) === String(srcConnId));
            
            if (!srcSession) {
              console.error(`❌ [${socket.id}] Cross Transfer: Source session not found for ID ${srcConnId}`);
              return emitSftpError('Source connection not active. Please ensure the source server tab is open.', 'Cross Transfer');
            }

            // Global timeout for the transfer to prevent UI hanging
            const transferTimer = setTimeout(() => {
              console.error(`⏱️ [${socket.id}] Cross Transfer TIMEOUT`);
              socket.emit('sftp:error', { message: 'Transfer timed out after 5 minutes' });
            }, 300000);

            const finish = (err = null) => {
              clearTimeout(transferTimer);
              if (err) {
                console.error(`❌ [${socket.id}] Cross Transfer Error:`, err);
                emitSftpError(err, 'Cross Transfer');
              }
            };

            const transfer = async () => {
              try {
                const srcSftp = await ensureSftp(srcSession);
                const destSession = activeSessions.get(socket.id);
                if (!destSession) throw new Error("Destination session lost");
                const destSftp = await ensureSftp(destSession);

                srcSftp.stat(srcPath, (err, stats) => {
                  if (err) return finish(err);

                  if (stats.isDirectory()) {
                    const srcDir = path.posix.dirname(srcPath);
                    const srcBase = path.posix.basename(srcPath);
                    const destDir = path.posix.dirname(destPath);
                    
                    console.log(`📂 [${socket.id}] Folder Transfer Start: ${srcPath} -> ${destPath}`);

                    let totalBytes = 0;
                    srcSession.sshClient.exec(`du -sb "${srcPath}" | cut -f1`, (err, duStream) => {
                      if (!err) {
                        duStream.on('data', (d) => {
                          const size = parseInt(d.toString().trim());
                          if (!isNaN(size)) totalBytes = size;
                        });
                      }
                    });

                    const cmdSrc = `tar czf - -C "${srcDir}" "${srcBase}"`;
                    const cmdDest = `tar xzf - -C "${destDir}"`;
                    
                    srcSession.sshClient.exec(cmdSrc, (err, srcStream) => {
                      if (err) return finish(err);
                      sshClient.exec(cmdDest, (err, destStream) => {
                        if (err) {
                          srcStream.destroy();
                          return finish(err);
                        }
                        
                        srcStream.pipe(destStream);
                        socket.emit('sftp:progress', { action: 'copy', filename: srcBase, progress: 1 });
                        
                        let bytesSent = 0;
                        srcStream.on('data', (chunk) => {
                          bytesSent += chunk.length;
                          if (totalBytes > 0) {
                            const progress = Math.min(99, Math.round((bytesSent / totalBytes) * 100));
                            socket.emit('sftp:progress', { action: 'copy', filename: srcBase, progress });
                          }
                        });

                        destStream.on('close', (code) => {
                          clearTimeout(transferTimer);
                          if (code === 0) {
                            socket.emit('sftp:action_success', { action: action === 'cut' ? 'move' : 'copy', path: destPath });
                            if (action === 'cut') srcSession.sshClient.exec(`rm -rf "${srcPath}"`, () => {});
                          } else {
                            finish(`Tar failed with code ${code}`);
                          }
                        });

                        srcStream.on('end', () => destStream.end());
                        srcStream.on('error', (err) => { finish(err); srcStream.destroy(); destStream.destroy(); });
                        destStream.on('error', (err) => { finish(err); srcStream.destroy(); destStream.destroy(); });
                      });
                    });
                  } else {
                    const os = require('os');
                    const tempFile = path.resolve(os.tmpdir(), `transfer-${socket.id}-${Date.now()}-${path.basename(srcPath)}`);
                    
                    console.log(`🚀 [${socket.id}] Starting reliable transfer via temp: ${tempFile}`);
                    
                    // Step 1: Download from Source to Temp (0-50%)
                    srcSftp.fastGet(srcPath, tempFile, {
                      step: (transferred, chunk, total) => {
                        const percent = Math.round((transferred / total) * 50);
                        socket.emit('sftp:progress', {
                          action: action === 'cut' ? 'move' : 'copy',
                          filename: path.posix.basename(srcPath),
                          progress: percent
                        });
                      }
                    }, (err) => {
                      if (err) {
                        console.error(`❌ [${socket.id}] Download failed:`, err);
                        fs.unlink(tempFile, () => {});
                        return finish(err);
                      }

                      console.log(`✅ [${socket.id}] Download complete. Starting upload...`);
                      
                      // Step 2: Upload from Temp to Destination (50-100%)
                      destSftp.fastPut(tempFile, destPath, {
                        step: (transferred, chunk, total) => {
                          const percent = 50 + Math.round((transferred / total) * 50);
                           socket.emit('sftp:progress', {
                            action: action === 'cut' ? 'move' : 'copy',
                            filename: path.posix.basename(srcPath),
                            progress: percent
                          });
                        }
                      }, (err) => {
                         // Clean up temp file
                         fs.unlink(tempFile, () => {});
                         
                         if (err) {
                           console.error(`❌ [${socket.id}] Upload failed:`, err);
                           return finish(err);
                         }

                         console.log(`✅ [${socket.id}] Upload complete!`);
                         clearTimeout(transferTimer);
                         socket.emit('sftp:action_success', { action: action === 'cut' ? 'move' : 'copy', path: destPath });
                         if (action === 'cut') srcSftp.unlink(srcPath, () => {});
                      });
                    });
                  }
                });
              } catch (err) {
                finish(err);
              }
            };

            transfer();
          });

          // Extract Archive (Zip/Tar)
          socket.on('sftp:extract', ({ path: archivePath, type }) => {
            console.log(`📦 [${socket.id}] SFTP EXTRACT: ${archivePath} (${type})`);
            if (!sshClient || sshClient._state === 'closed') return emitSftpError('SSH Connection Closed', 'Extract');

            const targetDir = path.posix.dirname(archivePath);
            const filename = path.posix.basename(archivePath);

            // Step 1: Detect availability of unzip vs python fallback
            // Step 1: Detect availability of unzip vs python fallback vs tar
            const detectCmd = `if command -v unzip >/dev/null; then echo "unzip"; elif command -v python3 >/dev/null; then echo "python3"; fi; if command -v tar >/dev/null; then echo "tar"; fi`;
            
            sshClient.exec(detectCmd, (err, detStream) => {
              if (err) return emitSftpError(err, 'Tool detection failed');
              let detected = "";
              detStream.on('data', (d) => detected += d.toString());

              detStream.on('close', () => {
                let countCmd, extractCmd;
                const hasUnzip = detected.includes('unzip');
                const hasPython = detected.includes('python3');
                const hasTar = detected.includes('tar');
                const usePython = type === 'zip' && !hasUnzip && hasPython;

                if (type === 'zip') {
                  if (usePython) {
                    console.log(`🐍 Using Python fallback for unzipping: ${archivePath}`);
                    countCmd = `python3 -c "import zipfile; z = zipfile.ZipFile('${archivePath}'); print(len([f for f in z.namelist() if not f.endswith('/')]))"`;
                    extractCmd = `python3 -c "import zipfile; zipfile.ZipFile('${archivePath}').extractall('${targetDir}')"`;
                  } else if (hasUnzip) {
                    countCmd = `unzip -Z1 "${archivePath}" | wc -l`;
                    extractCmd = `unzip -o "${archivePath}" -d "${targetDir}"`;
                  } else {
                    return emitSftpError('Neither "unzip" nor "python3" were found on the remote server. Please install zip support.', 'Server Environment');
                  }
                } else {
                  if (hasTar) {
                    const isGzip = archivePath.endsWith('.gz') || archivePath.endsWith('.tgz');
                    countCmd = `tar -t${isGzip ? 'z' : ''}f "${archivePath}" | wc -l`;
                    extractCmd = `tar -xv${isGzip ? 'z' : ''}f "${archivePath}" -C "${targetDir}"`;
                  } else {
                    return emitSftpError('"tar" command not found on the remote server.', 'Server Environment');
                  }
                }

                socket.emit('sftp:progress', { action: 'extract', filename, progress: 5, status: 'Initializing metadata...' });

                sshClient.exec(countCmd, (err, countStream) => {
                  if (err) return emitSftpError(err, 'Extract Init');
                  
                  let output = '';
                  countStream.on('data', (d) => output += d.toString());
                  
                  countStream.on('close', (code) => {
                    const totalItems = parseInt(output.trim()) || 0;
                    
                    sshClient.exec(extractCmd, (err, stream) => {
                      if (err) return emitSftpError(err, 'Extract failed');
                      
                      let extractedCount = 0;
                      let buffer = '';
                      
                      stream.on('data', (data) => {
                        buffer += data.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        
                        const validLines = lines.filter(l => l.trim().length > 0);
                        if (validLines.length > 0) {
                          extractedCount += validLines.length;
                          const lastLine = validLines[validLines.length - 1];
                          const currentFile = lastLine.replace(/^(extracting:|  inflating:|inflating:|creating:|  creating:)/i, '').trim();
                          
                          if (totalItems > 0) {
                            const prog = Math.min(99, Math.round((extractedCount / totalItems) * 100));
                            socket.emit('sftp:progress', { 
                              action: 'extract', filename, progress: prog, status: usePython ? 'Processing files...' : `Extracting: ${currentFile}`
                            });
                          }
                        }
                      });

                      let extractError = '';
                      stream.stderr.on('data', (d) => extractError += d.toString());

                      stream.on('close', (code) => {
                        // Cleanup archive
                        sshClient.exec(`rm "${archivePath}"`, () => {});
                        
                        if (code === 0) {
                          socket.emit('sftp:progress', { action: 'extract', filename, progress: 100 });
                          socket.emit('sftp:action_success', { action: 'extract', path: targetDir });
                        } else {
                          const errorMsg = extractError || `Exit code ${code}`;
                          if (errorMsg.includes('command not found')) {
                            emitSftpError('Missing "unzip" or "python3" on server. Please install zip utilities.', 'Server Environment');
                          } else {
                            emitSftpError(errorMsg, 'Extraction failed');
                          }
                        }
                      });
                    });
                  });
                });
              });
            });
          });

          // Upload File (Client -> Server) - Resumable with Offset
          socket.on('sftp:upload', ({ filename, path: destPath, size, offset = 0 }) => {
            console.log(`📤 [${socket.id}] SFTP UPLOAD START: ${filename} (Size: ${size}, Offset: ${offset})`);
            
            const { checkRateLimit, getConcurrencyLimiter, checkMemory } = require('./src/lib/serverGuard');
            
            // 1. Memory Guard
            const mem = checkMemory(300); // Need at least 300MB free
            if (!mem.safe) {
               return socket.emit('sftp:error', { message: 'Server is under high load. Please try again later.' });
            }

            // 2. Concurrency Guard (Global fair-share)
            const limiter = getConcurrencyLimiter('file_transfer', 10); // Max 10 active transfers global
            if (!limiter.allowed) {
               return socket.emit('sftp:error', { message: 'Server transfer capacity reached. Please wait for other transfers to finish.' });
            }

            // 3. Per-User Rate Limit
            const rate = checkRateLimit(`sftp_upload:${socket.id}`, 20); 
            if (!rate.allowed) {
               return socket.emit('sftp:error', { 
                 message: `Upload rate limit exceeded. Please wait ${Math.ceil(rate.resetIn / 1000)}s.`,
                 resetIn: rate.resetIn
               });
            }

            const sessionData = activeSessions.get(socket.id);
            if (!sessionData) return;

            getSftp((err, sftp) => {
               if (err) return emitSftpError(err, 'Upload SFTP Init');
               
               const transferId = `up_${Date.now()}`;
               const startUpload = (actualOffset) => {
                  // ... inside startUpload ...
                  sessionData.activeTransfers.add(transferId);
                  limiter.acquire(); 

                  // Use 'r+' to allow writing at specific offset, 'w' for new file
                  const flags = actualOffset > 0 ? 'r+' : 'w';
                  const writeStream = sftp.createWriteStream(destPath, { flags, start: actualOffset });
                  
                  let bytesReceivedInSession = 0;
                  
                  const chunkHandler = (chunk) => {
                    // Backpressure: only ack when data is actually written
                    writeStream.write(chunk, (err) => {
                       if (err) return emitSftpError(err, 'Stream Write Error');
                       
                       bytesReceivedInSession += chunk.length;
                       const totalTransferred = actualOffset + bytesReceivedInSession;
                       
                       socket.emit(`sftp:upload_ack:${filename}`, { 
                         received: chunk.length, 
                         totalTransferred,
                         progress: Math.round((totalTransferred / size) * 100)
                       });
                    });
                  };

                  socket.on(`sftp:upload_chunk:${filename}`, chunkHandler);
                  socket.emit('sftp:can_upload', { filename, offset: actualOffset }); 

                  socket.once(`sftp:upload_done:${filename}`, () => {
                    writeStream.end();
                    socket.off(`sftp:upload_chunk:${filename}`, chunkHandler);
                  });

                  writeStream.on('close', () => {
                    if (sessionData.activeTransfers.has(transferId)) {
                        limiter.release();
                        sessionData.activeTransfers.delete(transferId);
                    }
                    socket.emit('sftp:action_success', { action: 'upload', path: destPath });
                  });

                  writeStream.on('error', (err) => {
                    if (sessionData.activeTransfers.has(transferId)) {
                        limiter.release();
                        sessionData.activeTransfers.delete(transferId);
                    }
                    emitSftpError(err, 'Upload failed');
                    socket.off(`sftp:upload_chunk:${filename}`, chunkHandler);
                  });
               };

               // Auto-Resume Detection: If client didn't specify offset, check if file exists
               if (offset === 0) {
                  sftp.stat(destPath, (err, stats) => {
                     if (!err && stats.isFile() && stats.size < size) {
                        console.log(`🔍 [${socket.id}] Auto-resume detected: ${stats.size} bytes already present`);
                        startUpload(stats.size);
                     } else {
                        startUpload(0);
                     }
                  });
               } else {
                  startUpload(offset);
               }
            });
          });

          // Download File (Server -> Client) - Resumable with Offset
          socket.on('sftp:download', ({ filePath, offset = 0 }) => {
             console.log(`📥 [${socket.id}] SFTP DOWNLOAD: ${filePath} (Offset: ${offset})`);
             
             const { checkRateLimit, getConcurrencyLimiter, checkMemory } = require('./src/lib/serverGuard');
             
             // 1. Memory & Concurrency Guards
             const mem = checkMemory(300);
             if (!mem.safe) return socket.emit('sftp:error', { message: 'Server busy' });

             const limiter = getConcurrencyLimiter('file_transfer', 10);
             if (!limiter.allowed) {
                return socket.emit('sftp:error', { message: 'Server transfer capacity reached' });
             }

             const rate = checkRateLimit(`sftp_download:${socket.id}`, 30);
             if (!rate.allowed) {
                return socket.emit('sftp:error', { 
                  message: `Download rate limit exceeded. Please wait ${Math.ceil(rate.resetIn / 1000)}s.`,
                  resetIn: rate.resetIn
                });
             }

             const sessionData = activeSessions.get(socket.id);
             if (!sessionData) return;

             getSftp((err, sftp) => {
               if (err) return emitSftpError(err, 'Download SFTP Init');
               
               sftp.stat(filePath, (err, stats) => {
                 if (err) return emitSftpError(err, 'Download Stat');
                 
                 const transferId = `down_${Date.now()}`;
                 sessionData.activeTransfers.add(transferId);
                 limiter.acquire();

                 const readStream = sftp.createReadStream(filePath, { start: offset });
                 const filename = path.posix.basename(filePath);
                 const totalSize = stats.size;
                 
                 socket.emit('sftp:download_start', { filename, size: totalSize, offset });
                 
                 let bytesSentInSession = 0;
                 readStream.on('data', (chunk) => {
                   bytesSentInSession += chunk.length;
                   const progress = Math.round(((offset + bytesSentInSession) / totalSize) * 100);
                   socket.emit('sftp:download_chunk', { filename, chunk, progress, offset: offset + bytesSentInSession });
                 });
                 
                 readStream.on('end', () => {
                   if (sessionData && sessionData.activeTransfers.has(transferId)) {
                        limiter.release();
                        sessionData.activeTransfers.delete(transferId);
                   }
                   socket.emit('sftp:download_done', { filename });
                 });
                 
                 readStream.on('error', (err) => {
                   if (sessionData && sessionData.activeTransfers.has(transferId)) {
                        limiter.release();
                        sessionData.activeTransfers.delete(transferId);
                   }
                   emitSftpError(err, 'Download failed');
                 });
               });
             });
          });

          // Download Folder / Multi-file as TAR.GZ (Server → Client)
          // Accepts { folderPath } for a single directory, or { paths: [{filePath, isDir}] } for multiple items.
          // Uses `tar czf -` via exec and streams chunks immediately — no in-memory buffering.
          socket.on('sftp:download_folder', ({ folderPath, paths: multiPaths }) => {
             const { checkRateLimit, getConcurrencyLimiter, checkMemory } = require('./src/lib/serverGuard');
             const mem = checkMemory(300);
             if (!mem.safe) return socket.emit('sftp:error', { message: 'Server busy' });
             const limiter = getConcurrencyLimiter('file_transfer', 10);
             if (!limiter.allowed) return socket.emit('sftp:error', { message: 'Server transfer capacity reached' });
             const rate = checkRateLimit(`sftp_download:${socket.id}`, 30);
             if (!rate.allowed) return socket.emit('sftp:error', { message: `Download rate limit exceeded. Please wait ${Math.ceil(rate.resetIn / 1000)}s.`, resetIn: rate.resetIn });
             const sessionData = activeSessions.get(socket.id);
             if (!sessionData) return;

             // Safe single-quote shell escaping
             const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}' `;

             let archiveName, tarCmd;
             if (folderPath) {
               const folderName = path.posix.basename(folderPath);
               const parentDir  = path.posix.dirname(folderPath);
               archiveName = folderName + '.tar.gz';
               tarCmd = `tar czf - -C ${sq(parentDir)} ${sq(folderName)}`;
             } else {
               if (!multiPaths || multiPaths.length === 0)
                 return socket.emit('sftp:error', { message: 'No paths specified' });
               archiveName = 'selection.tar.gz';
               const parentDir = path.posix.dirname(multiPaths[0].filePath);
               const items = multiPaths.map(p => sq(path.posix.basename(p.filePath))).join(' ');
               tarCmd = `tar czf - -C ${sq(parentDir)} ${items}`;
             }

             const transferId = `downfolder_${Date.now()}`;
             sessionData.activeTransfers.add(transferId);
             limiter.acquire();
             const cleanup = () => {
               if (sessionData?.activeTransfers.has(transferId)) {
                 limiter.release();
                 sessionData.activeTransfers.delete(transferId);
               }
             };

             sshClient.exec(tarCmd, (execErr, stream) => {
               if (execErr) {
                 cleanup();
                 return socket.emit('sftp:error', { message: `Archive failed: ${execErr.message}` });
               }

               let totalSent  = 0;
               let headerSent = false;
               let stderrBuf  = '';

               stream.on('data', (chunk) => {
                 if (!headerSent) {
                   socket.emit('sftp:download_start', { filename: archiveName, size: 0, offset: 0 });
                   headerSent = true;
                 }
                 totalSent += chunk.length;
                 socket.emit('sftp:download_chunk', { filename: archiveName, chunk, progress: -1, offset: totalSent });
               });

               stream.stderr.on('data', (d) => { stderrBuf += d.toString(); });

               stream.on('close', (code) => {
                 cleanup();
                 if (code === 0) {
                   if (!headerSent) socket.emit('sftp:download_start', { filename: archiveName, size: 0, offset: 0 });
                   socket.emit('sftp:download_done', { filename: archiveName });
                 } else {
                   socket.emit('sftp:error', { message: stderrBuf.trim() || `tar exited with code ${code}` });
                 }
               });
             });
          });

          // Notify client we are connected
          socket.emit('ssh:connected', { sessionId: session ? session._id : null });

          // Update connection status only for DB
          if (connectionId && !connectionId.startsWith('local-') && isValidObjectId(connectionId)) {
            CurrentConnectionModel.findByIdAndUpdate(connectionId, {
              status: 'online',
              lastConnected: new Date(),
            }).catch(console.error);
          }
        });

        sshClient.on('error', async (err) => {
          console.error(`❌ SSH error: ${err?.message || err}`);
          socket.emit('ssh:error', { message: err?.message || 'Connection failed' });

          if (session) {
            await CurrentSessionModel.findByIdAndUpdate(session._id, {
              status: 'error',
              endTime: new Date(),
              errorMessage: err.message,
            });
          }

          if (connectionId && !connectionId.startsWith('local-') && isValidObjectId(connectionId)) {
            await CurrentConnectionModel.findByIdAndUpdate(connectionId, {
              status: 'offline',
            });
          }
        });

        sshClient.on('close', () => {
          socket.emit('ssh:closed');
          cleanupSession(socket.id);
        });

        // Build SSH config
        const sshConfig = {
          host: connection.host,
          port: connection.port,
          username: connection.username,
          readyTimeout: 15000,
          keepaliveInterval: 10000,
          // debug: (str) => console.log(`[SSH DEBUG ${connection.host}]`, str), // Uncomment for verbose logs
        };

        const { encrypt, decryptWithMetadata } = require('./src/utils/encryption');
        
        // Track if migration is needed
        let needsMigration = false;
        let originalPass = connection.password;
        let originalKey = connection.privateKey;
        let originalPassphrase = connection.passphrase;

        if (connection.authType === 'password') {
          const { text, success, usedOldKey } = decryptWithMetadata(connection.password);
          if (!success) {
             socket.emit('ssh:error', { message: 'Decryption failed. Owner has rotated encryption keys. Please re-enter your password in Connection Settings.' });
             return;
          }
          sshConfig.password = text;
          if (usedOldKey) {
             needsMigration = true;
             originalPass = encrypt(text); // Re-encrypt with NEW key
             console.log('🔄 Migrating password to new encryption key...');
          }
        } else if (connection.authType === 'privateKey') {
          console.log('🔑 Using Private Key auth for:', connection.host);

          if (!connection.privateKey) {
            socket.emit('ssh:error', { message: 'No private key stored for this connection. Please edit the connection and upload your private key.' });
            return;
          }

          const { text: decryptedKey, success: keySuccess, usedOldKey: keyOld } = decryptWithMetadata(connection.privateKey);
          
          if (!keySuccess) {
             socket.emit('ssh:error', { message: 'Decryption failed. Owner has rotated encryption keys. Please re-enter your Private Key in Connection Settings.' });
             return;
          }
          
          if (keyOld) {
             needsMigration = true;
             originalKey = encrypt(decryptedKey);
             console.log('🔄 Migrating private key to new encryption key...');
          }

          if (decryptedKey && decryptedKey.includes('PuTTY-User-Key-File')) {
            console.warn('⚠️ .ppk file detected. Rejecting.');
            socket.emit('ssh:error', { message: 'PPK format detected. Please convert to OpenSSH/PEM format.' });
            return;
          }

          // Normalize the private key: fix Windows line endings and trim outer whitespace
          const normalizedKey = decryptedKey
            ? decryptedKey.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
            : null;

          // Log key type for debugging (safe — shows only the header line)
          console.log(`🔑 Key header: ${normalizedKey ? normalizedKey.split('\n')[0] : 'empty'}`);

          if (!normalizedKey || !normalizedKey.startsWith('-----BEGIN')) {
            socket.emit('ssh:error', { message: 'Invalid private key format. Key must be in PEM/OpenSSH format.' });
            return;
          }

          sshConfig.privateKey = normalizedKey;

          if (connection.passphrase) {
            const { text: decryptedPassphrase, success: passSuccess, usedOldKey: passOld } = decryptWithMetadata(connection.passphrase);
            if (!passSuccess) {
                 socket.emit('ssh:error', { message: 'Passphrase decryption failed. Please update connection settings.' });
                 return;
            }
            sshConfig.passphrase = decryptedPassphrase;
            if (passOld) {
               needsMigration = true;
               originalPassphrase = encrypt(decryptedPassphrase);
            }
          }
        }

        // AUTO-MIGRATION: Update DB if we used an old key
        if (needsMigration && connectionId && !connectionId.startsWith('local-') && isValidObjectId(connectionId)) {
            CurrentConnectionModel.findByIdAndUpdate(connectionId, {
              password: originalPass,
              privateKey: originalKey,
              passphrase: originalPassphrase,
            }).then(() => console.log('✅ Connection migrated to new encryption key successfully'))
              .catch(err => console.error('❌ Migration failed:', err));
        }

        // console.log('Connecting with config:', { ...sshConfig, privateKey: 'REDACTED', password: 'REDACTED' });
        sshClient.connect(sshConfig);
      } catch (err) {
        console.error('SSH connect error:', err);
        socket.emit('ssh:error', { message: err.message });
      }
    });

    socket.on('ssh:disconnect', () => {
      cleanupSession(socket.id);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
      cleanupSession(socket.id);
    });
  });

  async function cleanupSession(socketId) {
    const session = activeSessions.get(socketId);
    if (session) {
      try {
        if (session.idleInterval) {
          clearInterval(session.idleInterval);
          session.idleInterval = null;
        }
        if (session.sftp) {
           // No explicit close needed for sftp if client is closed
        }
        if (session.sshClient) {
           session.sshClient.end();
        }

        if (session.session) {
          const endTime = new Date();
          const duration = Math.floor((endTime - session.session.startTime) / 1000);
          const { Session: CleanupSessionModel } = await getModels(session.dbUri);
          await CleanupSessionModel.findByIdAndUpdate(session.session._id, {
            status: 'closed',
            endTime,
            duration,
          });
        }
        
        if (session.connectionId && !session.connectionId.startsWith('local-')) {
           const { Connection: CurrentConnectionModel } = await getModels(session.dbUri);
           if (CurrentConnectionModel) {
             try {
               await CurrentConnectionModel.findByIdAndUpdate(session.connectionId, { status: 'offline' });
             } catch (updateErr) {
               // Ignore CastError (e.g. PostgreSQL integer ID on MongoDB model)
               if (updateErr.name !== 'CastError') console.warn('⚠️ Could not update connection status:', updateErr.message);
             }
           }
        }

        // --- NEW: Cleanup any active file transfers ---
        if (session.activeTransfers && session.activeTransfers.size > 0) {
           const { getConcurrencyLimiter } = require('./src/lib/serverGuard');
           const limiter = getConcurrencyLimiter('file_transfer');
           for (const tId of session.activeTransfers) {
              limiter.release();
              console.log(`🧹 Released capacity for abandoned transfer: ${tId}`);
           }
           session.activeTransfers.clear();
        }
      } catch (err) {
        console.error('Error cleaning up session:', err);
      }
      activeSessions.delete(socketId);
    }
  }

  // =======================================================================
  // LOCAL RELAY AGENT — WebSocket TCP proxy (free, no port forwarding needed)
  // Users run local-relay.js on their machine; it connects outward here.
  // =======================================================================
  {
    let WebSocketServer;
    try { WebSocketServer = (require('ws').WebSocketServer || require('ws').Server); } catch (e) {
      console.warn('⚠️  ws not found — Local Relay disabled (socket.io should include it)');
    }

    if (WebSocketServer) {
      // Global stores — shared between server.js and Next.js API routes (same process)
      global.__relayTokens  = global.__relayTokens  || new Map(); // token → {userId, expiresAt}
      global.__activeRelays = global.__activeRelays || new Map(); // userId → {localPort, netServer, targetHost, targetPort}

      // ── Persist tokens to disk so they survive server restarts ──────────────
      const RELAY_TOKENS_FILE = path.resolve(__dirname, '.relay-tokens.json');

      function loadPersistedRelayTokens() {
        try {
          if (fs.existsSync(RELAY_TOKENS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(RELAY_TOKENS_FILE, 'utf-8'));
            const now = Date.now();
            let loaded = 0;
            for (const [token, entry] of Object.entries(raw)) {
              if (entry.expiresAt > now) {
                global.__relayTokens.set(token, entry);
                loaded++;
              }
            }
            if (loaded > 0) console.log(`🔗 [Relay] Loaded ${loaded} persisted token(s) from disk.`);
          }
        } catch (e) {
          console.warn('⚠️  Could not load persisted relay tokens:', e.message);
        }
      }

      function persistRelayTokens() {
        try {
          const obj = {};
          for (const [token, entry] of global.__relayTokens) obj[token] = entry;
          fs.writeFileSync(RELAY_TOKENS_FILE, JSON.stringify(obj, null, 2));
        } catch (e) {
          console.warn('⚠️  Could not persist relay tokens:', e.message);
        }
      }

      // Load on startup
      loadPersistedRelayTokens();

      // Purge expired tokens every 24h and persist
      setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [t, e] of global.__relayTokens) {
          if (e.expiresAt < now) { global.__relayTokens.delete(t); changed = true; }
        }
        if (changed) persistRelayTokens();
      }, 24 * 60 * 60 * 1000);

      // Expose persist function for use by API route
      global.__persistRelayTokens = persistRelayTokens;

      const relayWss = new WebSocketServer({ noServer: true });

      // Intercept HTTP upgrades — only take /relay-ws, leave the rest to socket.io
      server.on('upgrade', (req, sock, head) => {
        if (req.url && req.url.startsWith('/relay-ws')) {
          relayWss.handleUpgrade(req, sock, head, (ws) => relayWss.emit('connection', ws, req));
        }
      });

      relayWss.on('connection', (ws, req) => {
        const url    = new URL(req.url, 'http://localhost');
        const token  = url.searchParams.get('token');
        const entry  = global.__relayTokens.get(token);

        if (!entry || entry.expiresAt < Date.now()) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
          ws.close(4001, 'Invalid token');
          return;
        }

        const { userId } = entry;
        const tcpSockets = new Map(); // connId → tcp socket (MongoDB driver side)

        // Local TCP server — Mongoose driver connects here; we proxy to relay agent
        const netServer = net.createServer((tcpSock) => {
          const connId  = Math.random().toString(36).slice(2, 10);
          const relay   = global.__activeRelays.get(userId);
          const tHost   = relay?.targetHost || 'localhost';
          const tPort   = relay?.targetPort || 27017;

          if (ws.readyState === 1 /*OPEN*/) {
            ws.send(JSON.stringify({ type: 'open', connId, host: tHost, port: tPort }));
          }

          // Mongoose driver → relay agent
          tcpSock.on('data', (data) => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', connId, data: data.toString('base64') }));
          });
          tcpSock.on('close', () => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'close', connId }));
            tcpSockets.delete(connId);
          });
          tcpSock.on('error', () => tcpSock.destroy());
          tcpSockets.set(connId, tcpSock);
        });

        netServer.on('error', (err) => {
          console.error(`🔗 [Relay] netServer error for user ${userId}: ${err.message}`);
        });

        netServer.listen(0, '127.0.0.1', () => {
          const localPort = netServer.address().port;
          global.__activeRelays.set(userId, { localPort, netServer, targetHost: 'localhost', targetPort: 27017 });
          ws.send(JSON.stringify({ type: 'ready', localPort }));
          console.log(`🔗 [Relay] Connected: user ${userId} → :${localPort}`);
        });

        // Server-side WS-level ping every 30s to keep the connection alive through proxies
        const serverPingTimer = setInterval(() => {
          if (ws.readyState === 1) ws.ping();
        }, 30000);

        // relay agent → Mongoose driver
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'ping') {
              // Keepalive — respond with pong to confirm relay is alive
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
              return;
            }
            if (msg.type === 'init') {
              // Relay agent reports which local port it is forwarding
              const r = global.__activeRelays.get(userId);
              if (r) { r.targetHost = msg.targetHost || 'localhost'; r.targetPort = Number(msg.targetPort) || 27017; }
            }
            if (msg.type === 'data') {
              const s = tcpSockets.get(msg.connId);
              if (s && !s.destroyed) s.write(Buffer.from(msg.data, 'base64'));
            }
            if (msg.type === 'close') {
              const s = tcpSockets.get(msg.connId);
              if (s) { s.destroy(); tcpSockets.delete(msg.connId); }
            }
          } catch {}
        });

        ws.on('close', () => {
          clearInterval(serverPingTimer);
          netServer.close();
          // Only clear __activeRelays if OUR netServer is still the registered one.
          // A newer relay connection may have already replaced it — don't wipe theirs.
          const current = global.__activeRelays.get(userId);
          if (current && current.netServer === netServer) {
            global.__activeRelays.delete(userId);
          }
          tcpSockets.forEach(s => s.destroy());
          console.log(`🔗 [Relay] Disconnected: user ${userId}`);
        });

        ws.on('error', () => {});
      });

      console.log('🔗 Local Relay Agent: ready (/relay-ws)');
    }
  }

  server.listen(port, () => {
    console.log(`\n\x1b[36m╔════════════════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[1;32m🚀 SSH Monitor running on \x1b[1;37mhttp://${hostname}:${port}\x1b[0m                     \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[37m📡 WebSocket path: \x1b[36m/api/socket\x1b[0m                               \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[37m💾 Database: \x1b[33m${MONGODB_URI}\x1b[0m              \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m╚════════════════════════════════════════════════════════════════╝\x1b[0m\n`);
  });
});
