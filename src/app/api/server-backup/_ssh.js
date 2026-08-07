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

export function sftpTransfer(sourceConfig, sourcePath, targetConfig, targetPath, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    let totalSize = 0;
    let transferred = 0;
    const srcConn = new Client();
    const tgtConn = new Client();
    let srcReady = false;
    let tgtReady = false;
    let aborted = false;

    const cleanup = () => { try { srcConn.end(); } catch {} try { tgtConn.end(); } catch {} };

    // Support abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        aborted = true;
        cleanup();
        reject(new Error('Transfer cancelled by user'));
      });
    }

    srcConn.on('ready', () => { srcReady = true; if (tgtReady) doTransfer(); });
    tgtConn.on('ready', () => { tgtReady = true; if (srcReady) doTransfer(); });
    srcConn.on('error', (e) => { cleanup(); reject(e); });
    tgtConn.on('error', (e) => { cleanup(); reject(e); });

    const doTransfer = () => {
      if (aborted) return;
      srcConn.sftp((srcErr, srcSftp) => {
        if (srcErr) { cleanup(); return reject(srcErr); }
        tgtConn.sftp((tgtErr, tgtSftp) => {
          if (tgtErr) { cleanup(); return reject(tgtErr); }
          srcSftp.stat(sourcePath, (statErr, stats) => {
            if (statErr) { cleanup(); return reject(statErr); }
            totalSize = stats.size;
            if (onProgress) onProgress({ transferred: 0, totalSize, percent: 0 });
            const readStream = srcSftp.createReadStream(sourcePath);
            const writeStream = tgtSftp.createWriteStream(targetPath, { mode: 0o644 });
            readStream.on('data', (chunk) => {
              transferred += chunk.length;
              if (onProgress) onProgress({ transferred, totalSize, percent: totalSize > 0 ? Math.round((transferred / totalSize) * 100) : 0 });
            });
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
