/**
 * WebSocket-to-TCP Relay Server (Lightweight SSH Mode)
 *
 * Uses ssh2 on the server (browsers can't do SSH natively) but with
 * minimal overhead:
 * - No session tracking Map
 * - No SFTP handling
 * - No exec queue
 * - No idle timeout management
 * - Just SSH connect + byte piping
 *
 * This reduces per-connection memory and CPU usage significantly
 * compared to the full Socket.io SSH handler.
 */

const { Client } = require('ssh2');
const { decryptWithMetadata } = require('../utils/encryption');

class WsTcpRelay {
  constructor(io, options = {}) {
    this.io = io;
    this.connections = new Map();
    this.maxConnections = options.maxConnections || 200;
    this.rateLimiter = new Map(); // userId → { count, resetAt }
    this.RATE_LIMIT = 50; // max connections per minute per user
    this.RATE_WINDOW = 60 * 1000; // 1 minute

    // Create a dedicated namespace for the relay
    this.nsp = io.of('/relay');
    this.nsp.use(async (socket, next) => {
      try {
        // Polyfill req.cookies for NextAuth (same as main Socket.io namespace)
        if (!socket.request.cookies) {
          const cookieHeader = socket.request.headers.cookie || '';
          socket.request.cookies = Object.fromEntries(
            cookieHeader.split('; ').filter(Boolean).map(c => {
              let [k, ...v] = c.split('=');
              return [k, decodeURIComponent(v.join('='))];
            })
          );
        }

        const { getToken } = require('next-auth/jwt');
        const token = await getToken({ req: socket.request, secret: process.env.NEXTAUTH_SECRET });
        if (!token) return next(new Error('Unauthorized'));
        
        // Rate limit check
        const userId = token.sub || token.dbId;
        const now = Date.now();
        const entry = this.rateLimiter.get(userId) || { count: 0, resetAt: now + this.RATE_WINDOW };
        if (now > entry.resetAt) {
          entry.count = 0;
          entry.resetAt = now + this.RATE_WINDOW;
        }
        entry.count++;
        this.rateLimiter.set(userId, entry);
        if (entry.count > this.RATE_LIMIT) {
          return next(new Error('Rate limit exceeded'));
        }
        
        socket.user = token;
        next();
      } catch (err) {
        console.error('[relay] Auth error:', err.message);
        next(new Error('Unauthorized'));
      }
    });

    this.nsp.on('connection', (socket) => this.handleConnection(socket));
    console.log(`[relay] Namespace /relay initialized (max: ${this.maxConnections})`);
  }

  handleConnection(socket) {
    const userId = socket.user?.sub || socket.user?.dbId || 'unknown';

    if (this.connections.size >= this.maxConnections) {
      socket.emit('relay:error', { message: 'Server at capacity. Try again later.' });
      socket.disconnect(true);
      return;
    }

    let sshClient = null;
    let sshStream = null;

    socket.on('relay:connect', async (opts) => {
      const { connectionId, connection, cols, rows } = opts;

      try {
        sshClient = new Client();

        // Fetch full connection from database (with credentials)
        // The browser doesn't have the password (API strips it for security)
        let fullConnection = connection;
        
        if (connectionId && !connectionId.startsWith('local-')) {
          try {
            // Use the same getModels approach as the old Socket.io handler
            const getModels = require('../../server').getModels;
            const repo = await getModels(null, userId);
            const { Connection: ConnectionModel } = repo;
            
            if (ConnectionModel) {
              const dbConn = await ConnectionModel.findById(connectionId);
              if (dbConn) {
                fullConnection = dbConn.toObject ? dbConn.toObject() : dbConn;
              }
            }
          } catch (dbErr) {
            // DB fetch failed, use browser data as fallback
          }
        }

        // Build SSH config from connection data
        const sshConfig = await this.buildSshConfig(fullConnection);

        sshClient.on('ready', () => {

          sshClient.shell({
            term: 'xterm-256color',
            cols: cols || 120,
            rows: rows || 30,
            modes: { VERASE: 127, 3: 127 }
          }, (err, stream) => {
            if (err) {
              socket.emit('relay:error', { message: err.message });
              return;
            }

            sshStream = stream;
            this.connections.set(socket.id, { sshClient, sshStream, userId });
            socket.emit('relay:connected', { host: sshConfig.host });

            // SSH → Browser
            stream.on('data', (data) => {
              if (socket.connected) {
                socket.emit('relay:data', data.toString('utf-8'));
              }
            });
            stream.stderr.on('data', (data) => {
              if (socket.connected) {
                socket.emit('relay:data', data.toString('utf-8'));
              }
            });

            stream.on('close', () => {
              socket.emit('relay:closed');
              this.cleanup(socket.id);
            });
          });
        });

        sshClient.on('error', (err) => {
          console.error(`[relay] ${socket.id} SSH error:`, err.message);
          socket.emit('relay:error', { message: err.message });
          this.cleanup(socket.id);
        });

        sshClient.on('end', () => {
          socket.emit('relay:closed');
          this.cleanup(socket.id);
        });

        sshClient.connect(sshConfig);

      } catch (err) {
        console.error(`[relay] ${socket.id} connect error:`, err.message);
        socket.emit('relay:error', { message: err.message });
      }
    });

    // Browser → SSH
    socket.on('relay:data', (data) => {
      if (sshStream && sshStream.writable) {
        sshStream.write(data);
      }
    });

    // Terminal resize
    socket.on('relay:resize', ({ cols, rows }) => {
      if (sshStream) {
        try {
          sshStream.setWindow(rows, cols, 0, 0);
        } catch (_) {}
      }
    });

    // Browser disconnect
    socket.on('relay:close', () => this.cleanup(socket.id));
    socket.on('disconnect', () => this.cleanup(socket.id));

    // Heartbeat ping through SSH session for accurate latency
    socket.on('relay:heartbeat', (timestamp) => {
      if (sshClient && sshClient._state !== 'closed') {
        sshClient.exec(':', (err, stream) => {
          if (err) {
            if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp);
            return;
          }
          stream.on('close', () => {
            if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp);
          });
          stream.on('error', () => {
            if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp);
          });
        });
      } else {
        if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp);
      }
    });
  }

  async buildSshConfig(connection) {
    const conn = connection || {};
    const config = {
      host: conn.host || 'localhost',
      port: parseInt(conn.port, 10) || 22,
      username: conn.username || 'root',
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    // Passwords are stored encrypted — use decryptWithMetadata for key rotation support
    if (conn.password) {
      const { text, success } = decryptWithMetadata(conn.password);
      if (success) {
        config.password = text;
      } else {
        console.error('[relay] Password decryption failed for', conn.host);
      }
    }
    if (conn.privateKey) {
      const { text, success } = decryptWithMetadata(conn.privateKey);
      if (success) {
        config.privateKey = text;
      } else {
        console.error('[relay] Private key decryption failed for', conn.host);
      }
      if (conn.passphrase) {
        const { text: ppText, success: ppSuccess } = decryptWithMetadata(conn.passphrase);
        if (ppSuccess) {
          config.passphrase = ppText;
        }
      }
    }

    return config;
  }

  cleanup(socketId) {
    const conn = this.connections.get(socketId);
    if (conn) {
      try { conn.sshStream?.close(); } catch (_) {}
      try { conn.sshClient?.end(); } catch (_) {}
      this.connections.delete(socketId);
      console.log(`[relay] ${socketId} cleaned up (active: ${this.connections.size})`);
    }
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      maxConnections: this.maxConnections,
    };
  }
}

module.exports = { WsTcpRelay };
