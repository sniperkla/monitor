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
    
    // Instead of connecting to localhost TCP port (which clashes with MongoDB), we use a custom stream
    const { Duplex } = require('stream');
    const connId = Math.random().toString(36).slice(2, 10);
    const duplex = new Duplex({
      write(chunk, encoding, callback) {
        if (relay.ws.readyState === 1) {
          relay.ws.send(JSON.stringify({ type: 'data', connId, data: chunk.toString('base64') }));
        }
        callback();
      },
      read(size) {}
    });
    duplex.isCustomRelayStream = true;

    // Wait for the relay agent to confirm the TCP connection is open before returning duplex
    await new Promise((resolve, reject) => {
      let isResolved = false;

      // 5-second fallback for older relay agents that don't send 'connected'
      const fallbackTimer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          relay.ws.off('message', messageHandler);
          relay.ws.on('message', dataHandler);
          resolve();
        }
      }, 600);

      const connTimeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(fallbackTimer);
          relay.ws.off('message', messageHandler);
          reject(new Error(`Local Relay Agent failed to connect to ${sshConfig.host}:${sshConfig.port || 22} (timeout)`));
        }
      }, 10000);

      const messageHandler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.connId !== connId) return;

          if (msg.type === 'connected') {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(fallbackTimer);
              clearTimeout(connTimeout);
              relay.ws.off('message', messageHandler);
              relay.ws.on('message', dataHandler);
              resolve();
            }
          } else if (msg.type === 'close') {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(fallbackTimer);
              clearTimeout(connTimeout);
              relay.ws.off('message', messageHandler);
              reject(new Error(`Local Relay Agent failed to connect to ${sshConfig.host}:${sshConfig.port || 22} (connection closed)`));
            }
          }
        } catch (err) {}
      };

      const dataHandler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.connId !== connId) return;

          if (msg.type === 'data') {
            duplex.push(Buffer.from(msg.data, 'base64'));
          } else if (msg.type === 'close') {
            duplex.push(null); // End of stream
            relay.ws.off('message', dataHandler);
          }
        } catch (err) {}
      };

      relay.ws.on('message', messageHandler);

      duplex.on('close', () => {
        clearTimeout(fallbackTimer);
        clearTimeout(connTimeout);
        relay.ws.off('message', messageHandler);
        relay.ws.off('message', dataHandler);
        if (relay.ws.readyState === 1) relay.ws.send(JSON.stringify({ type: 'close', connId }));
      });

      if (relay.ws.readyState === 1) {
        relay.ws.send(JSON.stringify({ type: 'open', connId, host: sshConfig.host, port: sshConfig.port || 22 }));
      } else {
        clearTimeout(fallbackTimer);
        clearTimeout(connTimeout);
        reject(new Error('Local Relay Agent WebSocket connection is not ready.'));
      }
    });

    sshConfig.sock = duplex;
  }

  return sshConfig;
}

export async function getSshConfig(connectionId, options = {}) {
  const db = await connectDB();
  const repo = new ConnectionRepository(db);
  await repo.init();
  const conn = await repo.findById(connectionId);
  if (!conn) throw new Error('Connection not found');

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

export function execCommand(sshConfig, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
        stream.on('close', (code) => { conn.end(); resolve({ code, stdout, stderr }); });
      });
    });
    conn.on('error', reject);
    conn.connect(sshConfig);
  });
}

export function sftpUpload(sshConfig, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);
        readStream.pipe(writeStream);
        writeStream.on('close', () => { conn.end(); resolve(); });
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
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        const readStream = sftp.createReadStream(filePath);
        readStream.on('close', () => conn.end());
        readStream.on('error', (e) => { conn.end(); reject(e); });
        resolve(readStream);
      });
    });
    conn.on('error', reject);
    conn.connect(sshConfig);
  });
}

export function sftpTransfer(sourceConfig, sourcePath, targetConfig, targetPath) {
  return new Promise((resolve, reject) => {
    let totalSize = 0;
    let transferred = 0;
    const srcConn = new Client();
    const tgtConn = new Client();
    let srcReady = false;
    let tgtReady = false;

    const cleanup = () => { try { srcConn.end(); } catch {} try { tgtConn.end(); } catch {} };

    srcConn.on('ready', () => { srcReady = true; if (tgtReady) doTransfer(); });
    tgtConn.on('ready', () => { tgtReady = true; if (srcReady) doTransfer(); });
    srcConn.on('error', (e) => { cleanup(); reject(e); });
    tgtConn.on('error', (e) => { cleanup(); reject(e); });

    const doTransfer = () => {
      srcConn.sftp((srcErr, srcSftp) => {
        if (srcErr) { cleanup(); return reject(srcErr); }
        tgtConn.sftp((tgtErr, tgtSftp) => {
          if (tgtErr) { cleanup(); return reject(tgtErr); }
          srcSftp.stat(sourcePath, (statErr, stats) => {
            if (statErr) { cleanup(); return reject(statErr); }
            totalSize = stats.size;
            const readStream = srcSftp.createReadStream(sourcePath);
            const writeStream = tgtSftp.createWriteStream(targetPath, { mode: 0o644 });
            readStream.on('data', (chunk) => { transferred += chunk.length; });
            readStream.pipe(writeStream);
            writeStream.on('close', () => { cleanup(); resolve({ transferred, totalSize }); });
            writeStream.on('error', (e) => { cleanup(); reject(e); });
            readStream.on('error', (e) => { cleanup(); reject(e); });
          });
        });
      });
    };

    srcConn.connect(sourceConfig);
    tgtConn.connect(targetConfig);
  });
}
