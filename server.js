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
const next = require('next');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
const { decrypt } = require('./src/utils/encryption');
const compression = require('compression');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
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
async function getModels(uri) {
  const targetUri = uri || getLatestCenterUri();
  if (!targetUri) {
     return { Connection: null, Session: null };
  }

  
  if (modelsPool.has(targetUri)) {
    const cached = modelsPool.get(targetUri);
    if (cached.type === 'mysql') return cached;
    if (cached.readyState === 1 || cached.readyState === 2) return { 
      type: 'mongodb',
      Connection: cached.models.Connection || cached.model('Connection', ConnectionSchema),
      Session: cached.models.Session || cached.model('Session', SessionSchema)
    };
    modelsPool.delete(targetUri);
  }

  if (targetUri.startsWith('mysql://')) {
    try {
      const pool = mysql.createPool(targetUri);
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
      modelsPool.set(targetUri, repo);
      return repo;
    } catch (e) {
      console.warn('⚠️ MySQL Init Error:', e.message);
      return { type: 'mysql', Connection: null, Session: null };
    }
  }

  if (!targetUri.startsWith('mongodb')) {
    console.warn('⚠️ Unsupported target URI scheme:', targetUri);
    return { type: 'unknown', Connection: null, Session: null };
  }

  try {
    const conn = await mongoose.createConnection(targetUri, { serverSelectionTimeoutMS: 5000 }).asPromise();
    modelsPool.set(targetUri, conn);
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
      origin: process.env.NODE_ENV === 'production' ? (process.env.NEXT_PUBLIC_APP_URL || false) : '*',
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
      const { Connection: CurrentConnectionModel, Session: CurrentSessionModel } = await getModels(dbUri);

      try {
        let connection;
        
        // Handle DB Connections
        if (connectionId && !connectionId.startsWith('local-')) {
          if (!CurrentConnectionModel) {
             socket.emit('ssh:error', { message: 'Vault not configured. Please setup your private database.' });
             return;
          }
          await connectMongo();
          connection = await CurrentConnectionModel.findById(connectionId);
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
          'sftp:writeFile', 'sftp:copy', 'sftp:move', 'sftp:cross_server_transfer',
          'sftp:upload', 'sftp:download'
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

        // Create session only for DB connections AND if Session model is available
        let session = null;
        if (connectionId && !connectionId.startsWith('local-') && CurrentSessionModel) {
          session = await CurrentSessionModel.create({
            connectionId: connection._id,
            status: 'active',
          });
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
              socket.emit('ssh:error', { message: err.message });
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
            sshClient.sftp((err, sftp) => {
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

          // Notify client we are connected
          socket.emit('ssh:connected', { sessionId: session ? session._id : null });

          // Update connection status only for DB
          if (connectionId && !connectionId.startsWith('local-')) {
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

          if (connectionId && !connectionId.startsWith('local-')) {
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
          sshConfig.privateKey = decryptedKey;

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
        if (needsMigration && connectionId && !connectionId.startsWith('local-')) {
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
             await CurrentConnectionModel.findByIdAndUpdate(session.connectionId, { status: 'offline' });
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

  server.listen(port, () => {
    console.log(`\n\x1b[36m╔════════════════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[1;32m🚀 SSH Monitor running on \x1b[1;37mhttp://${hostname}:${port}\x1b[0m                     \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[37m📡 WebSocket path: \x1b[36m/api/socket\x1b[0m                               \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m   \x1b[37m💾 Database: \x1b[33m${MONGODB_URI}\x1b[0m              \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m╚════════════════════════════════════════════════════════════════╝\x1b[0m\n`);
  });
});
