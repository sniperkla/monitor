/**
 * WebSocket-to-TCP Relay Server (Lightweight SSH Mode)
 *
 * Handles SSH shell + SFTP via a single ssh2 connection per socket.
 * The /relay namespace mirrors the main Socket.io SSH+SFTP event contract
 * so the FileManager and terminal work identically in relay mode.
 */

const { Client } = require('ssh2');
const path = require('path');
const { decryptWithMetadata } = require('../utils/encryption');
// Imported at module level — avoids repeated require() overhead per connection
const { getToken } = require('next-auth/jwt');

const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

class WsTcpRelay {
  constructor(io, options = {}) {
    this.io = io;
    this.connections = new Map();
    this.maxConnections = options.maxConnections || 200;
    this.rateLimiter = new Map();
    this.RATE_LIMIT = 50;
    this.RATE_WINDOW = 60 * 1000;

    this.nsp = io.of('/relay');
    this.nsp.use(async (socket, next) => {
      try {
        if (!socket.request.cookies) {
          const cookieHeader = socket.request.headers.cookie || '';
          socket.request.cookies = Object.fromEntries(
            cookieHeader.split('; ').filter(Boolean).map(c => {
              let [k, ...v] = c.split('=');
              return [k, decodeURIComponent(v.join('='))];
            })
          );
        }

        const token = await getToken({ req: socket.request, secret: process.env.NEXTAUTH_SECRET });
        if (!token) return next(new Error('Unauthorized'));
        
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

    // Prevent rate limiter Map from growing unboundedly — purge expired entries every 5 min
    setInterval(() => {
      const now = Date.now();
      for (const [uid, entry] of this.rateLimiter.entries()) {
        if (now > entry.resetAt) this.rateLimiter.delete(uid);
      }
    }, 5 * 60 * 1000).unref();
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
    let sftp = null;
    let connection = null;
    let isConnecting = false; // Track if a connection is currently being established

    const emitSftpError = (err, prefix = '') => {
      const msg = typeof err === 'string' ? err : (err?.message || 'Unknown SFTP error');
      socket.emit('sftp:error', { message: prefix ? `${prefix}: ${msg}` : msg });
    };

    const getSftp = (cb) => {
      if (sftp) return cb(null, sftp);
      if (!sshClient || sshClient._state === 'closed') return cb(new Error('SSH not connected'));
      sshClient.sftp((err, sftpInst) => {
        if (err) return cb(err);
        sftp = sftpInst;
        cb(null, sftp);
      });
    };

    const parseLsOutput = (output) => {
      const lines = output.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('total'));
      return lines.map(line => {
        const parts = line.split(/\s+/);
        if (parts.length < 9) return null;
        const isDir = parts[0].startsWith('d');
        const size = parseInt(parts[4]) || 0;
        const dateStr = `${parts[5]} ${parts[6]}`;
        const filename = parts.slice(8).join(' ');
        if (filename === '.' || filename === '..') return null;
        return {
          filename,
          longname: line,
          attrs: { size, mtime: new Date(dateStr).getTime() / 1000, mode: isDir ? 16877 : 33188 }
        };
      }).filter(f => f !== null);
    };

    const fallbackFileListing = (client, listPath) => {
      const target = listPath === '.' ? '.' : `"${listPath}"`;
      const cmd = `ls -la --full-time ${target}`;
      client.exec(cmd, (err, stream) => {
        if (err) return socket.emit('sftp:error', { message: 'Listing failed: ' + err.message });
        let output = '';
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          socket.emit('sftp:list', { path: listPath, files: parseLsOutput(output) });
        });
      });
    };

    let connectionInProgress = false;

    socket.on('relay:connect', async (opts) => {
      console.log(`[relay] ${socket.id} received relay:connect:`, {
        connectionId: opts.connectionId,
        hasConnection: !!opts.connection,
        cols: opts.cols,
        rows: opts.rows,
        isConnecting,
        hasSshClient: !!sshClient,
        hasSshStream: !!sshStream,
      });
      
      // Guard: prevent duplicate concurrent connection attempts
      if (isConnecting) {
        console.warn(`[relay] ${socket.id} connection already in progress - ignoring duplicate relay:connect`);
        return;
      }
      
      // Guard: if this socket already has an active SSH connection, clean it up first
      if (sshClient || sshStream) {
        console.warn(`[relay] ${socket.id} already has an active connection - cleaning up first`);
        this.cleanup(socket.id);
        sshClient = null;
        sshStream = null;
        sftp = null;
      }
      
      isConnecting = true;
      
      const { connectionId, connection: connectionData, cols, rows } = opts;

      try {
        sshClient = new Client();
        connection = connectionData;

        if (connectionId && !connectionId.startsWith('local-')) {
          console.log(`[relay] ${socket.id} fetching connection from database...`);
          try {
            const getModels = require('../../server').getModels;
            const repo = await getModels(null, userId);
            const { Connection: ConnectionModel } = repo;
            if (ConnectionModel) {
              const dbConn = await ConnectionModel.findById(connectionId);
              if (dbConn) {
                connection = dbConn.toObject ? dbConn.toObject() : dbConn;
                console.log(`[relay] ${socket.id} loaded connection from DB: ${connection.host}:${connection.port}`);
              } else {
                console.warn(`[relay] ${socket.id} connection ${connectionId} not found in DB`);
              }
            }
          } catch (dbErr) {
            console.error(`[relay] ${socket.id} DB error:`, dbErr.message);
          }
        }

        console.log(`[relay] ${socket.id} building SSH config...`);
        const sshConfig = await this.buildSshConfig(connection);
        console.log(`[relay] ${socket.id} SSH config built for ${sshConfig.host}:${sshConfig.port}`);

        sshClient.on('ready', () => {
          console.log(`[relay] ${socket.id} SSH client ready, opening SFTP subsystem...`);
          isConnecting = false; // Connection established successfully
          // Open SFTP subsystem
          sshClient.sftp((err, sftpInst) => {
            if (!err) {
              sftp = sftpInst;
              console.log(`[relay] ${socket.id} SFTP subsystem ready`);
              // Store sftp ref so cleanup() can end the channel properly
              const conn = this.connections.get(socket.id);
              if (conn) conn.sftp = sftpInst;
            } else {
              console.warn(`[relay] ${socket.id} SFTP init failed (will use exec fallback):`, err.message);
            }
          });

          sshClient.shell({
            term: 'xterm-256color',
            cols: cols || 120,
            rows: rows || 30,
            modes: { VERASE: 127, 3: 127 }
          }, (err, stream) => {
            if (err) {
              console.error(`[relay] ${socket.id} shell error:`, err.message);
              socket.emit('relay:error', { message: err.message });
              return;
            }

            console.log(`[relay] ${socket.id} shell stream opened, registering handlers...`);
            sshStream = stream;
            this.connections.set(socket.id, { sshClient, sshStream, userId });
            
            console.log(`[relay] ${socket.id} emitting relay:connected to client`);
            socket.emit('relay:connected', { host: sshConfig.host });

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
              console.log(`[relay] ${socket.id} stream closed`);
              socket.emit('relay:closed');
              this.cleanup(socket.id);
            });

            // ── Register all SFTP handlers ──

            socket.on('sftp:list', (listPath = '.') => {
              if (!sshClient || sshClient._state === 'closed') {
                return socket.emit('sftp:error', { message: 'SSH Connection Closed' });
              }
              getSftp((err, s) => {
                if (err) return fallbackFileListing(sshClient, listPath);
                const targetPath = listPath === '.' ? './' : listPath;
                s.readdir(targetPath, (readdirErr, list) => {
                  if (readdirErr) return fallbackFileListing(sshClient, listPath);
                  socket.emit('sftp:list', { path: listPath, files: list });
                });
              });
            });

            socket.on('sftp:search', ({ query } = {}) => {
              const q = String(query || '').trim();
              if (!q) return socket.emit('sftp:searchResult', { query: q, results: [], error: null });
              if (!sshClient || sshClient._state === 'closed') {
                return socket.emit('sftp:searchResult', { query: q, results: [], error: 'SSH not connected' });
              }
              const escapedQ = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
              const cmd = [
                `find $HOME -iname "*${escapedQ}*" 2>/dev/null | head -150`,
                `find / \\( -path "$HOME" -o -path /proc -o -path /sys -o -path /dev -o -path /run \\) -prune -o -iname "*${escapedQ}*" -print 2>/dev/null | head -100`,
              ].join(' ; ');
              let output = '';
              let done = false;
              const safetyTimer = setTimeout(() => { if (!done) { done = true; emitSearchResults(); } }, 8000);
              const emitSearchResults = () => {
                clearTimeout(safetyTimer);
                const seen = new Set();
                const results = output.split('\n').map(l => l.trim()).filter(l => l && !seen.has(l) && seen.add(l))
                  .map(absPath => ({ filename: absPath.split('/').pop(), absPath, dir: absPath.split('/').slice(0, -1).join('/') || '/' }));
                socket.emit('sftp:searchResult', { query: q, results, error: null });
              };
              sshClient.exec(cmd, (err, stream) => {
                if (err) { clearTimeout(safetyTimer); return socket.emit('sftp:searchResult', { query: q, results: [], error: err.message }); }
                stream.on('data', d => { output += d.toString(); });
                stream.stderr.on('data', () => {});
                stream.on('close', () => { if (!done) { done = true; emitSearchResults(); } });
              });
            });

            socket.on('sftp:getSize', ({ path: targetPath }) => {
              if (!sshClient || sshClient._state === 'closed') {
                return socket.emit('sftp:sizeResult', { path: targetPath, error: 'SSH not connected' });
              }
              const cmd = `du -sb ${shellQuote(targetPath)} 2>/dev/null | cut -f1`;
              sshClient.exec(cmd, (err, stream) => {
                if (err) return socket.emit('sftp:sizeResult', { path: targetPath, error: err.message });
                let output = '';
                let stderr = '';
                stream.on('data', (d) => { output += d.toString(); });
                stream.stderr.on('data', (d) => { stderr += d.toString(); });
                stream.on('close', (code) => {
                  const parsed = parseInt(output.trim(), 10);
                  if (code === 0 && !isNaN(parsed)) {
                    socket.emit('sftp:sizeResult', { path: targetPath, size: parsed });
                  } else {
                    socket.emit('sftp:sizeResult', { path: targetPath, error: stderr || 'Could not read size' });
                  }
                });
              });
            });

            socket.on('sftp:mkdir', (mkdirPath) => {
              const runMkdir = () => {
                sshClient.exec(`mkdir -p "${mkdirPath}"`, (err, stream) => {
                  if (err) return emitSftpError(err, 'Mkdir failed');
                  let stderr = '';
                  stream.on('data', () => {});
                  stream.stderr.on('data', d => stderr += d.toString());
                  stream.on('close', (code) => {
                    if (code === 0) socket.emit('sftp:action_success', { action: 'mkdir', path: mkdirPath });
                    else emitSftpError(stderr || `Exit code ${code}`, 'Mkdir failed');
                  });
                });
              };
              getSftp((err, s) => {
                if (err) return runMkdir();
                s.mkdir(mkdirPath, (mkdirErr) => {
                  if (mkdirErr) return runMkdir();
                  socket.emit('sftp:action_success', { action: 'mkdir', path: mkdirPath });
                });
              });
            });

            socket.on('sftp:delete', (deletePath) => {
              const runRm = () => {
                sshClient.exec(`rm -rf "${deletePath}"`, (err, stream) => {
                  if (err) return emitSftpError(err, 'Delete failed');
                  let stderr = '';
                  stream.on('data', () => {});
                  stream.stderr.on('data', d => stderr += d.toString());
                  stream.on('close', (code) => {
                    if (code === 0) socket.emit('sftp:action_success', { action: 'delete', path: deletePath });
                    else emitSftpError(stderr || `Exit code ${code}`, 'Delete failed');
                  });
                });
              };
              getSftp((err, s) => {
                if (err) return runRm();
                s.unlink(deletePath, (unlinkErr) => {
                  if (!unlinkErr) return socket.emit('sftp:action_success', { action: 'delete', path: deletePath });
                  s.rmdir(deletePath, (rmdirErr) => {
                    if (!rmdirErr) return socket.emit('sftp:action_success', { action: 'delete', path: deletePath });
                    runRm();
                  });
                });
              });
            });

            socket.on('sftp:readFile', (readPath) => {
              const runCat = () => {
                sshClient.exec(`cat "${readPath}"`, (err, stream) => {
                  if (err) return emitSftpError(err, 'Read failed');
                  let content = '';
                  let stderr = '';
                  stream.on('data', d => content += d.toString());
                  stream.stderr.on('data', d => stderr += d.toString());
                  stream.on('close', (code) => {
                    if (code !== 0) return emitSftpError(stderr || `Exit code ${code}`, 'Read failed');
                    socket.emit('sftp:file_content', { path: readPath, content });
                  });
                });
              };
              getSftp((err, s) => {
                if (err) return runCat();
                const rStream = s.createReadStream(readPath);
                let content = '';
                rStream.on('data', d => content += d.toString());
                rStream.on('end', () => socket.emit('sftp:file_content', { path: readPath, content }));
                rStream.on('error', () => runCat());
              });
            });

            socket.on('sftp:readFileBase64', (readPath) => {
              const escapedPath = readPath.replace(/"/g, '\\"');
              sshClient.exec(`base64 "${escapedPath}"`, (err, stream) => {
                if (err) return emitSftpError(err, 'Read failed');
                let content = '';
                let stderr = '';
                stream.on('data', d => content += d.toString());
                stream.stderr.on('data', d => stderr += d.toString());
                stream.on('close', (code) => {
                  if (code !== 0) return emitSftpError(stderr || `Exit code ${code}`, 'Read failed');
                  socket.emit('sftp:file_base64', { path: readPath, content: content.replace(/\s/g, '') });
                });
              });
            });

            socket.on('sftp:writeFile', ({ path: writePath, content }) => {
              const runWrite = () => {
                const b64 = Buffer.from(content).toString('base64');
                const cmd = content.length === 0
                  ? `touch "${writePath}"`
                  : `echo -n "${b64}" | base64 -d > "${writePath}"`;
                sshClient.exec(cmd, (err, stream) => {
                  if (err) return emitSftpError(err, 'Write failed');
                  let stderr = '';
                  stream.on('data', () => {});
                  stream.stderr.on('data', (d) => stderr += d.toString());
                  stream.on('close', (code) => {
                    if (code === 0) socket.emit('sftp:action_success', { action: 'write', path: writePath });
                    else emitSftpError(stderr || `Exit code ${code}`, 'Write failed');
                  });
                });
              };
              getSftp((err, s) => {
                if (err) return runWrite();
                const ws = s.createWriteStream(writePath);
                ws.on('close', () => socket.emit('sftp:action_success', { action: 'write', path: writePath }));
                ws.on('error', () => runWrite());
                ws.end(content);
              });
            });

            socket.on('sftp:copy', ({ src, dest, overwrite = false }) => {
              getSftp((err, s) => {
                if (err) return emitSftpError(err, 'SFTP Init');
                s.stat(src, (statErr, stats) => {
                  if (statErr) return emitSftpError(statErr, 'Stat failed');
                  if (src === dest) return emitSftpError('Source and destination are the same', 'Copy failed');

                  const doCopy = () => {
                    if (stats.isDirectory()) {
                      const srcBase = path.posix.basename(src);
                      const cmd = [
                        `rm -rf ${shellQuote(dest)}`,
                        `mkdir -p ${shellQuote(dest)}`,
                        `tar czf - -C ${shellQuote(src)} . | tar xzf - -C ${shellQuote(dest)}`,
                      ].join(' && ');
                      sshClient.exec(cmd, (execErr, stream) => {
                        if (execErr) return emitSftpError(execErr, 'Copy Init');
                        let stderr = '';
                        let dirDone = false;
                        const onDirComplete = (code) => {
                          if (dirDone) return;
                          dirDone = true;
                          clearTimeout(dirSafetyTimer);
                          if (code === 0) socket.emit('sftp:action_success', { action: 'copy', path: dest });
                          else emitSftpError(stderr || `Exit code ${code}`, 'Copy failed');
                        };
                        stream.on('data', () => {});
                        stream.stderr.on('data', (d) => { stderr += d.toString(); });
                        stream.on('close', (code) => onDirComplete(code));
                        const dirSafetyTimer = setTimeout(() => { onDirComplete(0); }, 300000);
                      });
                    } else {
                      const rStream = s.createReadStream(src);
                      const wStream = s.createWriteStream(dest);
                      let copyDone = false;
                      const onCopyComplete = () => {
                        if (copyDone) return;
                        copyDone = true;
                        clearTimeout(copySafetyTimer);
                        socket.emit('sftp:action_success', { action: 'copy', path: dest });
                      };
                      rStream.pipe(wStream);
                      wStream.on('finish', onCopyComplete);
                      wStream.on('close', onCopyComplete);
                      rStream.on('error', (e) => { clearTimeout(copySafetyTimer); emitSftpError(e, 'Read Source'); try { wStream.destroy(); } catch(_){} });
                      wStream.on('error', (e) => { clearTimeout(copySafetyTimer); emitSftpError(e, 'Write Dest'); try { rStream.destroy(); } catch(_){} });
                      const copySafetyTimer = setTimeout(() => { onCopyComplete(); }, 120000);
                    }
                  };

                  if (!overwrite) {
                    s.stat(dest, (destErr) => {
                      if (!destErr) return emitSftpError('Destination already exists', 'Copy failed');
                      doCopy();
                    });
                  } else {
                    doCopy();
                  }
                });
              });
            });

            socket.on('sftp:move', ({ src, dest, overwrite = false }) => {
              // In relay mode, skip the SFTP subsystem entirely.
              // SFTP channels frequently go stale after idle periods and calling
              // s.rename() or s.stat() on them hangs with no callback — causing the
              // UI to spin indefinitely. sshClient.exec() always opens a fresh
              // channel and is equally fast for a simple rename/mv.
              if (!sshClient || sshClient._state === 'closed') {
                return emitSftpError('SSH not connected', 'Move failed');
              }
              const cmd = overwrite
                ? `rm -rf ${shellQuote(dest)} && mv ${shellQuote(src)} ${shellQuote(dest)}`
                : `mv -n ${shellQuote(src)} ${shellQuote(dest)}`;
              sshClient.exec(cmd, (err, stream) => {
                if (err) return emitSftpError(err, 'Move failed');
                let stderr = '';
                let moveDone = false;
                const onMoveComplete = (code) => {
                  if (moveDone) return;
                  moveDone = true;
                  clearTimeout(moveSafetyTimer);
                  if (code === 0) socket.emit('sftp:action_success', { action: 'move', path: dest });
                  else emitSftpError(stderr || `Exit code ${code}`, 'Move failed');
                };
                stream.on('data', () => {});
                stream.stderr.on('data', (d) => { stderr += d.toString(); });
                stream.on('close', (code) => onMoveComplete(code));
                // Safety net: treat silence as success after 30s
                const moveSafetyTimer = setTimeout(() => { onMoveComplete(0); }, 30000);
              });
            });

            socket.on('sftp:extract', ({ path: archivePath, type, cleanupArchive = false }) => {
              if (!sshClient || sshClient._state === 'closed') return emitSftpError('SSH Connection Closed', 'Extract');
              const targetDir = path.posix.dirname(archivePath);
              const filename = path.posix.basename(archivePath);

              const removeArchive = () => {
                if (!cleanupArchive) return;
                sshClient.exec(`rm -f "${archivePath}"`, () => {});
              };

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
                      countCmd = `python3 -c "import zipfile; z = zipfile.ZipFile('${archivePath}'); print(len([f for f in z.namelist() if not f.endswith('/')]))"`;
                      extractCmd = `python3 -c "import zipfile; zipfile.ZipFile('${archivePath}').extractall('${targetDir}')"`;
                    } else if (hasUnzip) {
                      countCmd = `unzip -Z1 "${archivePath}" | wc -l`;
                      extractCmd = `unzip -o "${archivePath}" -d "${targetDir}"`;
                    } else {
                      return emitSftpError('Neither "unzip" nor "python3" found on server', 'Server Environment');
                    }
                  } else {
                    if (hasTar) {
                      const isGzip = archivePath.endsWith('.gz') || archivePath.endsWith('.tgz');
                      countCmd = `tar -t${isGzip ? 'z' : ''}f "${archivePath}" | wc -l`;
                      extractCmd = `tar -xv${isGzip ? 'z' : ''}f "${archivePath}" -C "${targetDir}"`;
                    } else {
                      return emitSftpError('"tar" not found on server', 'Server Environment');
                    }
                  }

                  sshClient.exec(countCmd, (countErr, countStream) => {
                    if (countErr) return emitSftpError(countErr, 'Extract Init');
                    let output = '';
                    countStream.on('data', (d) => output += d.toString());
                    countStream.on('close', () => {
                      const totalItems = parseInt(output.trim()) || 0;
                      sshClient.exec(extractCmd, (extractErr, stream) => {
                        if (extractErr) return emitSftpError(extractErr, 'Extract failed');
                        let extractedCount = 0;
                        let buffer = '';
                        stream.on('data', (data) => {
                          buffer += data.toString();
                          const lines = buffer.split('\n');
                          buffer = lines.pop() || '';
                          const validLines = lines.filter(l => l.trim().length > 0);
                          if (validLines.length > 0) {
                            extractedCount += validLines.length;
                            if (totalItems > 0) {
                              socket.emit('sftp:progress', { action: 'extract', filename, progress: Math.min(99, Math.round((extractedCount / totalItems) * 100)) });
                            }
                          }
                        });
                        let extractError = '';
                        stream.stderr.on('data', (d) => extractError += d.toString());
                        stream.on('close', (code) => {
                          removeArchive();
                          if (code === 0) {
                            socket.emit('sftp:progress', { action: 'extract', filename, progress: 100 });
                            socket.emit('sftp:action_success', { action: 'extract', path: targetDir });
                          } else {
                            emitSftpError(extractError || `Exit code ${code}`, 'Extraction failed');
                          }
                        });
                      });
                    });
                  });
                });
              });
            });

            socket.on('sftp:upload', ({ filename, path: destPath, size, offset = 0 }) => {
              if (!sshClient || sshClient._state === 'closed') {
                return socket.emit('sftp:error', { message: 'SSH session not ready', recoverable: true });
              }

              const transferId = `up_${Date.now()}`;
              const activeTransfers = new Set();
              activeTransfers.add(transferId);

              const cleanup = () => { activeTransfers.delete(transferId); };

              const setupHandlers = (wStream) => {
                let bytesReceived = 0;
                let settled = false;
                let inactivityTimer = null;

                const armInactivityTimer = () => {
                  clearTimeout(inactivityTimer);
                  inactivityTimer = setTimeout(() => {
                    if (!settled) failTransfer(new Error('Upload stalled'), 'Upload stalled');
                  }, 60000);
                };

                const finalize = (onFinish) => {
                  if (settled) return;
                  settled = true;
                  clearTimeout(inactivityTimer);
                  socket.off(`sftp:upload_chunk:${filename}`, chunkHandler);
                  socket.off(`sftp:upload_done:${filename}`, doneHandler);
                  socket.off(`sftp:upload_abort:${filename}`, abortHandler);
                  cleanup();
                  onFinish?.();
                };

                const failTransfer = (err, prefix) => {
                  finalize(() => {
                    try { if (typeof wStream.destroy === 'function') wStream.destroy(); else if (wStream.writable) wStream.end(); } catch (_) {}
                    sshClient.exec(`rm -f "${destPath}"`, () => {});
                    emitSftpError(err, `${prefix} (${filename})`);
                  });
                };

                const chunkHandler = (chunk) => {
                  if (settled) return;
                  armInactivityTimer();
                  wStream.write(chunk, (writeErr) => {
                    if (writeErr) return failTransfer(writeErr, 'Stream Write Error');
                    bytesReceived += chunk.length;
                    socket.emit(`sftp:upload_ack:${filename}`, {
                      received: chunk.length,
                      totalTransferred: offset + bytesReceived,
                      progress: Math.round(((offset + bytesReceived) / size) * 100)
                    });
                  });
                };

                const doneHandler = () => {
                  if (!settled && wStream.writable) wStream.end();
                };

                const abortHandler = () => {
                  finalize(() => {
                    try { if (typeof wStream.destroy === 'function') wStream.destroy(); else if (wStream.writable) wStream.end(); } catch (_) {}
                    sshClient.exec(`rm -f "${destPath}"`, () => {});
                  });
                };

                socket.removeAllListeners(`sftp:upload_chunk:${filename}`);
                socket.removeAllListeners(`sftp:upload_done:${filename}`);
                socket.removeAllListeners(`sftp:upload_abort:${filename}`);
                socket.on(`sftp:upload_chunk:${filename}`, chunkHandler);
                socket.once(`sftp:upload_done:${filename}`, doneHandler);
                socket.once(`sftp:upload_abort:${filename}`, abortHandler);
                socket.emit('sftp:can_upload', { filename, offset });
                armInactivityTimer();

                let completionSent = false;
                const sendCompletion = () => {
                  if (completionSent) return;
                  completionSent = true;
                  console.log(`📤 [wsRelay] Sending sftp:action_success for upload: ${destPath}`);
                  finalize(() => { socket.emit('sftp:action_success', { action: 'upload', path: destPath }); });
                };

                wStream.on('close', () => {
                  console.log(`📤 [wsRelay] Stream close event for: ${destPath}`);
                  sendCompletion();
                });
                // Fallback: 'finish' fires when stream.end() flushes all data to the SFTP subsystem.
                // In production, the 'close' event (file-handle release) can be delayed or lost;
                // 'finish' is reliable and sufficient for upload completion.
                wStream.on('finish', () => {
                  console.log(`📤 [wsRelay] Stream finish event for: ${destPath} (completionSent: ${completionSent})`);
                  if (!completionSent) {
                    setTimeout(() => {
                      if (!completionSent) {
                        console.log(`📤 [wsRelay] Finish fallback (2s) - sending completion for: ${destPath}`);
                        sendCompletion();
                      }
                    }, 2000);
                  }
                });
                wStream.on('error', (err) => { 
                  console.error(`❌ [wsRelay] Stream error for: ${destPath}:`, err.message);
                  failTransfer(err, 'Upload failed'); 
                });
              };

              getSftp((sftpErr, s) => {
                if (sftpErr || !s) {
                  const cmd = `cat > "${destPath}"`;
                  sshClient.exec(cmd, (execErr, stream) => {
                    if (execErr) { cleanup(); return emitSftpError(execErr, 'Upload exec failed'); }
                    setupHandlers(stream);
                  });
                } else {
                  const flags = offset > 0 ? 'r+' : 'w';
                  const writeStream = s.createWriteStream(destPath, { flags, start: offset });
                  setupHandlers(writeStream);
                }
              });
            });

            socket.on('sftp:download', ({ filePath, offset = 0 }) => {
              if (!sshClient || sshClient._state === 'closed') {
                return socket.emit('sftp:error', { message: 'SSH session not ready', recoverable: true });
              }

              const filename = path.posix.basename(filePath);

              const startDownload = (s, stats) => {
                const totalSize = stats?.size || 0;
                socket.emit('sftp:download_start', { filename, size: totalSize, offset });

                const setupHandlers = (rStream) => {
                  let bytesSent = 0;
                  rStream.on('data', (chunk) => {
                    bytesSent += chunk.length;
                    const progress = totalSize > 0 ? Math.round(((offset + bytesSent) / totalSize) * 100) : 0;
                    socket.emit('sftp:download_chunk', { filename, chunk, progress, offset: offset + bytesSent });
                  });
                  rStream.on('end', () => { socket.emit('sftp:download_done', { filename }); });
                  rStream.on('error', (err) => { emitSftpError(err, 'Download failed'); });
                };

                if (!s) {
                  sshClient.exec(`cat "${filePath}"`, (err, stream) => {
                    if (err) return emitSftpError(err, 'Download exec failed');
                    setupHandlers(stream);
                  });
                } else {
                  const readStream = s.createReadStream(filePath, { start: offset });
                  setupHandlers(readStream);
                }
              };

              getSftp((sftpErr, s) => {
                if (sftpErr || !s) {
                  sshClient.exec(`ls -nl "${filePath}" | awk '{print $5}'`, (err, stream) => {
                    let output = '';
                    if (!err) {
                      stream.on('data', (d) => output += d.toString());
                      stream.on('close', () => { startDownload(null, { size: parseInt(output.trim()) || 0 }); });
                    } else {
                      startDownload(null, { size: 0 });
                    }
                  });
                } else {
                  s.stat(filePath, (statErr, stats) => {
                    if (statErr) return emitSftpError(statErr, 'Download stat failed');
                    startDownload(s, stats);
                  });
                }
              });
            });

            socket.on('sftp:download_folder', ({ folderPath, paths: multiPaths }) => {
              if (!sshClient || sshClient._state === 'closed') return;
              const sq = (v) => `'${String(v).replace(/'/g, "'\\''")}' `;
              let archiveName, tarCmd;
              if (folderPath) {
                const folderName = path.posix.basename(folderPath);
                const parentDir = path.posix.dirname(folderPath);
                archiveName = folderName + '.tar.gz';
                tarCmd = `tar czf - -C ${sq(parentDir)} ${sq(folderName)}`;
              } else {
                if (!multiPaths || multiPaths.length === 0) return socket.emit('sftp:error', { message: 'No paths specified' });
                archiveName = 'selection.tar.gz';
                const parentDir = path.posix.dirname(multiPaths[0].filePath);
                const items = multiPaths.map(p => sq(path.posix.basename(p.filePath))).join(' ');
                tarCmd = `tar czf - -C ${sq(parentDir)} ${items}`;
              }
              sshClient.exec(tarCmd, (execErr, stream) => {
                if (execErr) return socket.emit('sftp:error', { message: `Archive failed: ${execErr.message}` });
                let headerSent = false;
                let totalSent = 0;
                let stderrBuf = '';
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
                  if (code === 0) {
                    if (!headerSent) socket.emit('sftp:download_start', { filename: archiveName, size: 0, offset: 0 });
                    socket.emit('sftp:download_done', { filename: archiveName });
                  } else {
                    socket.emit('sftp:error', { message: stderrBuf.trim() || `tar exited with code ${code}` });
                  }
                });
              });
            });

            socket.on('sftp:applyPatch', ({ diffText, backupId }) => {
              try {
                const diff_match_patch = require('diff-match-patch');
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
                        if (filePath.startsWith('a/')) filePath = filePath.slice(2);
                        current = { filePath, diffLines: [] };
                        i++;
                        const destLine = nextLine;
                        let destPath = destLine.slice(4).split('\t')[0].trim();
                        if (destPath.startsWith('b/')) destPath = destPath.slice(2);
                        if (!current.filePath || current.filePath === '/dev/null') current.filePath = destPath;
                        continue;
                      }
                    }
                    if (current) current.diffLines.push(line);
                  }
                  if (current) sections.push(current);
                  return sections;
                };

                const dmp = new diff_match_patch();
                const sections = parseDiffIntoFiles(diffText);
                if (sections.length === 0) {
                  return socket.emit('sftp:error', { message: 'No valid diff sections found' });
                }

                let appliedCount = 0;
                let failedCount = 0;

                const applyNext = (idx) => {
                  if (idx >= sections.length) {
                    socket.emit('sftp:action_success', { action: 'applyPatch', path: `${appliedCount} files patched` });
                    return;
                  }
                  const section = sections[idx];
                  const filePath = section.filePath;
                  const diffTextForFile = section.diffLines.join('\n');

                  sshClient.exec(`cat "${filePath}"`, (err, stream) => {
                    if (err) { failedCount++; return applyNext(idx + 1); }
                    let content = '';
                    stream.on('data', d => content += d.toString());
                    stream.on('close', () => {
                      const patches = dmp.patch_make(content, diffTextForFile);
                      const [newText, results] = dmp.patch_apply(patches, content);
                      const allApplied = results.every(r => r === true);
                      if (!allApplied) { failedCount++; return applyNext(idx + 1); }

                      const b64 = Buffer.from(newText).toString('base64');
                      sshClient.exec(`echo -n "${b64}" | base64 -d > "${filePath}"`, (writeErr, wStream) => {
                        if (writeErr) { failedCount++; }
                        else {
                          wStream.on('close', (code) => {
                            if (code === 0) appliedCount++;
                            else failedCount++;
                            applyNext(idx + 1);
                          });
                        }
                      });
                    });
                  });
                };
                applyNext(0);
              } catch (e) {
                emitSftpError(e, 'Patch failed');
              }
            });

            socket.on('sftp:cross_server_transfer', ({ srcConnId, srcPath, destPath, action, overwrite = false }) => {
              emitSftpError('Cross-server transfer not supported in relay mode. Use the direct SSH connection for cross-server transfers.', 'Cross Transfer');
            });

          });
        });

        sshClient.on('error', (err) => {
          console.error(`[relay] ${socket.id} SSH error:`, err.message);
          isConnecting = false; // Reset on error
          socket.emit('relay:error', { message: err.message });
          this.cleanup(socket.id);
        });

        sshClient.on('end', () => {
          console.log(`[relay] ${socket.id} SSH ended`);
          isConnecting = false; // Reset on end
          socket.emit('relay:closed');
          this.cleanup(socket.id);
        });

        console.log(`[relay] ${socket.id} calling sshClient.connect()...`);
        sshClient.connect(sshConfig);
        console.log(`[relay] ${socket.id} sshClient.connect() called`);

      } catch (err) {
        console.error(`[relay] ${socket.id} connect error:`, err.message);
        isConnecting = false; // Reset on catch
        socket.emit('relay:error', { message: err.message });
      }
    });

    // Browser → SSH terminal
    socket.on('relay:data', (data) => {
      if (sshStream && sshStream.writable) {
        sshStream.write(data);
      }
    });

    socket.on('relay:resize', ({ cols, rows }) => {
      if (sshStream) {
        try { sshStream.setWindow(rows, cols, 0, 0); } catch (_) {}
      }
    });

    socket.on('relay:close', () => this.cleanup(socket.id));
    socket.on('disconnect', () => this.cleanup(socket.id));

    socket.on('relay:heartbeat', (timestamp) => {
      if (sshClient && sshClient._state !== 'closed') {
        sshClient.exec(':', (err, stream) => {
          if (err) { if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp); return; }
          stream.on('close', () => { if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp); });
          stream.on('error', () => { if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp); });
        });
      } else {
        if (socket.connected) socket.emit('relay:heartbeat:pong', timestamp);
      }
    });
  }

  async buildSshConfig(connection) {
    const conn = connection || {};
    console.log('[relay] buildSshConfig input:', {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      hasPassword: !!conn.password,
      hasPrivateKey: !!conn.privateKey,
      hasPassphrase: !!conn.passphrase,
    });
    
    const config = {
      host: conn.host || 'localhost',
      port: parseInt(conn.port, 10) || 22,
      username: conn.username || 'root',
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    if (conn.password) {
      const { text, success } = decryptWithMetadata(conn.password);
      if (success) {
        config.password = text;
        console.log('[relay] Password decrypted successfully');
      } else {
        console.error('[relay] Password decryption failed for', conn.host);
      }
    }
    if (conn.privateKey) {
      const { text, success } = decryptWithMetadata(conn.privateKey);
      if (success) {
        config.privateKey = text;
        console.log('[relay] Private key decrypted successfully');
      } else {
        console.error('[relay] Private key decryption failed for', conn.host);
      }
      if (conn.passphrase) {
        const { text: ppText, success: ppSuccess } = decryptWithMetadata(conn.passphrase);
        if (ppSuccess) {
          config.passphrase = ppText;
          console.log('[relay] Passphrase decrypted successfully');
        }
      }
    }

    console.log('[relay] buildSshConfig output:', {
      host: config.host,
      port: config.port,
      username: config.username,
      hasPassword: !!config.password,
      hasPrivateKey: !!config.privateKey,
      hasPassphrase: !!config.passphrase,
    });

    return config;
  }

  cleanup(socketId) {
    const conn = this.connections.get(socketId);
    if (conn) {
      try { conn.sshStream?.close(); } catch (_) {}
      try { conn.sftp?.end(); } catch (_) {}        // end SFTP channel before SSH client
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
