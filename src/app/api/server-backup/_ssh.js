import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';

const isLocalhost = (host) => /^(localhost|127\.0\.0\.1)$/.test(host);

function findActiveRelay() {
  const activeRelays = global.__activeRelays;
  if (!activeRelays || activeRelays.size === 0) return null;
  const userRelays = activeRelays.values().next().value;
  if (userRelays instanceof Map && userRelays.size > 0) {
    return userRelays.values().next().value;
  }
  return userRelays && !(userRelays instanceof Map) ? userRelays : null;
}

export async function resolveSshConfig(baseConfig, options = {}) {
  const sshConfig = { ...baseConfig };

  if (isLocalhost(sshConfig.host) || options.sshMode === 'local') {
    const relay = findActiveRelay();
    if (!relay || !relay.ws) {
      throw new Error('Local Relay Agent is not connected. Please start local-relay.js on your target machine.');
    }

    // Set the target host and port on the active relay instance
    relay.targetHost = (sshConfig.host && !isLocalhost(sshConfig.host)) ? sshConfig.host : 'localhost';
    relay.targetPort = parseInt(sshConfig.port, 10) || 22;

    // Connect ssh2 through local TCP proxy port managed by server's netServer
    sshConfig.host = '127.0.0.1';
    sshConfig.port = relay.localPort;
    delete sshConfig.sock;
  }

  return sshConfig;
}

export async function getSshConfig(connectionId, options = {}) {
  const db = await connectDB();
  const repo = new ConnectionRepository(db);
  await repo.init();
  const conn = await repo.findById(connectionId);
  if (!conn) throw new Error('Connection not found');

  // Ownership enforcement: if the connection has an owner, the caller must prove
  // they are that owner. Callers that don't pass userId (internal jobs/cron) can
  // only access unowned (legacy/global) connections.
  if (conn.userId && String(conn.userId) !== String(options.userId || '')) {
    throw new Error('Access denied: this connection belongs to another user');
  }

  const baseConfig = {
    host: conn.host,
    port: conn.port || 22,
    username: conn.username || 'root',
    readyTimeout: 20000,
    keepaliveInterval: 10000,
  };

  if (conn.authType === 'password' && conn.password) {
    let dec = decrypt(conn.password);
    if (dec && dec.includes(':') && dec.length > 40) { const t = decrypt(dec); if (t && !t.includes(':')) dec = t; }
    baseConfig.password = dec;
  } else if (conn.authType === 'privateKey' && conn.privateKey) {
    let dec = decrypt(conn.privateKey);
    if (dec && dec.includes(':') && dec.length > 40) { const t = decrypt(dec); if (t && !t.includes(':')) dec = t; }
    baseConfig.privateKey = dec;
    if (conn.passphrase) {
      let pdec = decrypt(conn.passphrase);
      if (pdec && pdec.includes(':') && pdec.length > 40) { const t = decrypt(pdec); if (t && !t.includes(':')) pdec = t; }
      baseConfig.passphrase = pdec;
    }
  }

  return resolveSshConfig(baseConfig, options);
}

// SSH Connection Pool for recurring commands and monitoring
global.__sshConnectionPool = global.__sshConnectionPool || new Map();

function getPoolKey(config) {
  return `${config.username || 'root'}@${config.host || '127.0.0.1'}:${config.port || 22}`;
}

function getOrCreatePooledClient(sshConfig) {
  const pool = global.__sshConnectionPool;
  const key = getPoolKey(sshConfig);
  
  const existing = pool.get(key);
  if (existing && existing.ready && existing.client && existing.client._sock && !existing.client._sock.destroyed) {
    // Reset idle timer
    if (existing.idleTimeout) clearTimeout(existing.idleTimeout);
    existing.idleTimeout = setTimeout(() => {
      try { existing.client.end(); } catch {}
      pool.delete(key);
    }, 30000); // 30s idle timeout
    return Promise.resolve(existing.client);
  }

  // Cleanup broken existing entry
  if (existing) {
    try { existing.client.end(); } catch {}
    pool.delete(key);
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let isSettled = false;

    const entry = {
      client: conn,
      ready: false,
      idleTimeout: null,
    };

    const cleanup = () => {
      if (entry.idleTimeout) clearTimeout(entry.idleTimeout);
      pool.delete(key);
      try { conn.end(); } catch {}
    };

    conn.on('ready', () => {
      entry.ready = true;
      entry.idleTimeout = setTimeout(() => {
        cleanup();
      }, 30000);
      pool.set(key, entry);
      if (!isSettled) {
        isSettled = true;
        resolve(conn);
      }
    });

    conn.on('error', (err) => {
      cleanup();
      if (!isSettled) {
        isSettled = true;
        reject(err);
      }
    });

    conn.on('close', () => {
      cleanup();
    });

    conn.on('end', () => {
      cleanup();
    });

    conn.connect(sshConfig);
  });
}

// Attach a hard timeout to an SSH exec stream. On expiry the remote process is
// killed (SIGKILL via channel signal), the channel is closed, and the connection
// torn down — so nothing keeps running or holding sockets after the caller gives up.
function attachExecTimeout(stream, conn, options, onTimeout) {
  if (!options.timeoutMs) return null;
  return setTimeout(() => {
    try { stream.signal('KILL'); } catch {}
    try { stream.close(); } catch {}
    try { conn.end(); } catch {}
    onTimeout();
  }, options.timeoutMs);
}

export function execCommand(sshConfig, command, options = {}) {
  const usePool = options.pool !== false;

  if (usePool) {
    return new Promise((resolve, reject) => {
      getOrCreatePooledClient(sshConfig)
        .then((conn) => {
          let stdout = '';
          let stderr = '';
          conn.exec(command, (err, stream) => {
            if (err) {
              // On exec channel failure, evict and retry once with fresh connection
              const pool = global.__sshConnectionPool;
              const key = getPoolKey(sshConfig);
              pool.delete(key);
              try { conn.end(); } catch {}
              
              // Fallback non-pooled execution
              return execCommand(sshConfig, command, { ...options, pool: false }).then(resolve).catch(reject);
            }
            stream.on('data', (d) => {
              const chunk = d.toString();
              stdout += chunk;
              options.onStdout?.(chunk);
            });
            let timedOut = false;
            const timer = attachExecTimeout(stream, conn, options, () => { timedOut = true; });
            stream.stderr.on('data', (d) => {
              const chunk = d.toString();
              stderr += chunk;
              options.onStderr?.(chunk);
            });
            stream.on('close', (code) => {
              if (timer) clearTimeout(timer);
              if (timedOut) {
                return reject(new Error(`Command timed out after ${Math.round(options.timeoutMs / 1000)}s`));
              }
              const exitCode = typeof code === 'number' ? code : (stderr.trim() && !stdout.trim() ? 1 : 0);
              resolve({ code: exitCode, stdout, stderr });
            });
          });
        })
        .catch((err) => {
          // If pool creation failed, try direct connection once
          execCommand(sshConfig, command, { ...options, pool: false }).then(resolve).catch(reject);
        });
    });
  }

  // Non-pooled fallback
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let timedOut = false;
        const timer = attachExecTimeout(stream, conn, options, () => { timedOut = true; });
        stream.on('data', (d) => {
          const chunk = d.toString();
          stdout += chunk;
          options.onStdout?.(chunk);
        });
        stream.stderr.on('data', (d) => {
          const chunk = d.toString();
          stderr += chunk;
          options.onStderr?.(chunk);
        });
        stream.on('close', (code) => {
          if (timer) clearTimeout(timer);
          conn.end();
          if (timedOut) {
            return reject(new Error(`Command timed out after ${Math.round(options.timeoutMs / 1000)}s`));
          }
          const exitCode = typeof code === 'number' ? code : (stderr.trim() && !stdout.trim() ? 1 : 0);
          resolve({ code: exitCode, stdout, stderr });
        });
      });
    });
    conn.on('error', reject);
    conn.connect(sshConfig);
  });
}

export function sftpUpload(sshConfig, localPath, remotePath, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    let totalBytes = 0;
    try { totalBytes = fs.statSync(localPath).size; } catch {}
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);
        let lastReported = -1;
        const reportProgress = () => {
          const transferred = Number.isFinite(writeStream.bytesWritten) ? writeStream.bytesWritten : (readStream.bytesRead || 0);
          if (transferred === lastReported && transferred !== totalBytes) return;
          lastReported = transferred;
          onProgress?.(transferred, totalBytes);
        };
        // ssh2 advances bytesWritten only as its SFTP stream drains, so this
        // represents remote upload progress rather than merely local file reads.
        writeStream.on('drain', reportProgress);
        readStream.on('data', () => {
          if (!Number.isFinite(writeStream.bytesWritten)) reportProgress();
        });
        readStream.pipe(writeStream);
        writeStream.on('close', () => { onProgress?.(totalBytes, totalBytes); conn.end(); resolve(); });
        writeStream.on('error', (e) => { conn.end(); reject(e); });
        readStream.on('error', (e) => { conn.end(); reject(e); });
      });
    });
    conn.on('error', reject);
    conn.connect(sshConfig);
  });
}

export function sftpReadStream(sshConfig, filePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      // Use raw cat stream for max throughput
      conn.exec(`cat ${JSON.stringify(filePath)}`, (err, stream) => {
        if (err) {
          // Fallback to SFTP if exec channel fails
          return conn.sftp((sftpErr, sftp) => {
            if (sftpErr) { conn.end(); return reject(sftpErr); }
            const readStream = sftp.createReadStream(filePath);
            readStream.on('close', () => conn.end());
            readStream.on('error', (e) => { conn.end(); reject(e); });
            resolve(readStream);
          });
        }
        stream.stderr?.on('data', () => {});
        stream.on('close', () => conn.end());
        stream.on('error', (e) => { conn.end(); reject(e); });
        resolve(stream);
      });
    });
    conn.on('error', reject);
    conn.connect(sshConfig);
  });
}

export function sftpTransfer(sourceConfig, sourcePath, targetConfig, targetPath, { onProgress, signal } = {}) {
  return new Promise(async (resolve, reject) => {
    const srcConn = new Client();
    const tgtConn = new Client();
    let aborted = false;
    let finished = false;

    const cleanup = () => {
      try { srcConn.end(); } catch {}
      try { tgtConn.end(); } catch {}
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        aborted = true;
        cleanup();
        reject(new Error('Transfer cancelled by user'));
      });
    }

    const onErr = (e) => {
      if (finished || aborted) return;
      finished = true;
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    srcConn.on('error', onErr);
    tgtConn.on('error', onErr);

    const connectBoth = Promise.all([
      new Promise((res, rej) => { srcConn.on('ready', res); srcConn.on('error', rej); srcConn.connect(sourceConfig); }),
      new Promise((res, rej) => { tgtConn.on('ready', res); tgtConn.on('error', rej); tgtConn.connect(targetConfig); }),
    ]);

    try {
      await connectBoth;
      if (aborted) return;

      // Check if source is directory or single file
      const isDir = await new Promise((res) => {
        srcConn.exec(`[ -d ${JSON.stringify(sourcePath)} ] && echo DIR || echo FILE`, (err, stream) => {
          if (err) return res(false);
          let out = '';
          stream.on('data', d => out += d.toString());
          stream.stderr?.on('data', () => {});
          stream.on('close', () => res(out.trim() === 'DIR'));
        });
      });

      // Upfront accurate total size detection (5s timeout max)
      const totalSize = await new Promise((res) => {
        const sizeCmd = isDir
          ? `du -sb "${sourcePath}" 2>/dev/null | cut -f1`
          : `stat -c%s "${sourcePath}" 2>/dev/null || wc -c < "${sourcePath}" 2>/dev/null || echo 0`;
        const timer = setTimeout(() => res(0), 5000);
        try {
          srcConn.exec(sizeCmd, (err, stream) => {
            if (err) { clearTimeout(timer); return res(0); }
            let out = '';
            stream.on('data', d => out += d.toString());
            stream.stderr?.on('data', () => {});
            stream.on('close', () => {
              clearTimeout(timer);
              const n = parseInt(out.trim(), 10);
              res(!isNaN(n) && n > 0 ? n : 0);
            });
            stream.on('error', () => { clearTimeout(timer); res(0); });
          });
        } catch {
          clearTimeout(timer);
          res(0);
        }
      });

      if (onProgress) onProgress({ transferred: 0, totalSize, percent: 0 });

      let transferred = 0;
      let lastProgressTime = 0;
      const sendThrottledProgress = (bytes, isDone = false) => {
        const now = Date.now();
        const pct = isDone ? 100 : (totalSize > 0 ? Math.min(99, Math.round((bytes / totalSize) * 100)) : 50);
        if (isDone || now - lastProgressTime > 250) {
          lastProgressTime = now;
          if (onProgress) onProgress({ transferred: bytes, totalSize, percent: pct });
        }
      };

      const path = require('path');
      const targetDir = path.posix.dirname(targetPath);

      const cmdSrc = isDir
        ? `tar cf - -C ${JSON.stringify(sourcePath)} . 2>/dev/null`
        : `cat ${JSON.stringify(sourcePath)}`;
      const cmdDest = isDir
        ? `rm -rf ${JSON.stringify(targetPath)} && mkdir -p ${JSON.stringify(targetPath)} && tar xf - -C ${JSON.stringify(targetPath)} 2>/dev/null`
        : `mkdir -p ${JSON.stringify(targetDir)} && cat > ${JSON.stringify(targetPath)}`;

      srcConn.exec(cmdSrc, (err, srcStream) => {
        if (err) return onErr(err);
        tgtConn.exec(cmdDest, (err2, tgtStream) => {
          if (err2) { srcStream.destroy(); return onErr(err2); }

          // Drain stderr to prevent pipe deadlocks
          srcStream.stderr?.on('data', () => {});
          tgtStream.stderr?.on('data', () => {});

          srcStream.pipe(tgtStream);
          sendThrottledProgress(0);

          srcStream.on('data', (chunk) => {
            transferred += chunk.length;
            sendThrottledProgress(transferred);
          });

          let safetyTimer = null;
          const doFinish = (success, errMsg) => {
            if (finished || aborted) return;
            finished = true;
            if (safetyTimer) clearTimeout(safetyTimer);
            try { srcStream.destroy(); } catch {}
            try { tgtStream.destroy(); } catch {}
            cleanup();

            if (success) {
              sendThrottledProgress(totalSize > 0 ? totalSize : transferred, true);
              resolve({ transferred: totalSize > 0 ? totalSize : transferred, totalSize });
            } else {
              reject(new Error(errMsg || 'Direct transfer failed'));
            }
          };

          srcStream.on('end', () => {
            try { tgtStream.end(); } catch {}
            if (!safetyTimer) {
              safetyTimer = setTimeout(() => {
                doFinish(true);
              }, 4000);
            }
          });

          srcStream.on('exit', (code) => {
            if (code !== null && code !== undefined && code > 1) {
              doFinish(false, `Source stream exited with code ${code}`);
            }
          });

          tgtStream.on('exit', (code) => {
            if (code === null || code === undefined || code <= 1) {
              doFinish(true);
            } else {
              doFinish(false, `Target stream exited with code ${code}`);
            }
          });

          tgtStream.on('close', () => doFinish(true));
          srcStream.on('error', (e) => doFinish(false, e?.message));
          tgtStream.on('error', (e) => doFinish(false, e?.message));
        });
      });
    } catch (e) {
      onErr(e);
    }
  });
}
