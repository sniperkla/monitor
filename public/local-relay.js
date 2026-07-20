#!/usr/bin/env node
/**
 * SSH Monitor - Enhanced Local Relay Agent
 * 
 * Runs on the user's machine. Handles:
 * - TCP relay (existing functionality)
 * - SSH connections (NEW - uses ssh2 locally)
 * - SFTP file operations (NEW - uses ssh2 SFTP subsystem)
 * - Docker commands (NEW - uses local Docker CLI/socket)
 * 
 * Requirements: Node.js 18+, optional: npm install ssh2
 * 
 * First run:  node local-relay.js --server URL --token TOKEN
 * Install:    node local-relay.js --install --server URL --token TOKEN
 * Uninstall:  node local-relay.js --uninstall
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const http = require('http');
const net  = require('net');
const { spawnSync, exec } = require('child_process');

// -- Try to load ssh2 (optional dependency) --
// Resolve from script's own directory first (handles tmux/installed-service cwd mismatch)
let ssh2;
try {
  ssh2 = require(require.resolve('ssh2', { paths: [__dirname, ...module.paths] }));
  console.log('✅ ssh2 loaded — SSH/SFTP will run locally');
} catch {
  console.log('ℹ️  ssh2 not found — install with: npm install ssh2');
  console.log('   Falling back to TCP relay mode only');
}

// -- Try to load ws --
let WS;
try {
  WS = require(require.resolve('ws', { paths: [__dirname, ...module.paths] }));
} catch {
  try {
    WS = globalThis.WebSocket;
  } catch {
    console.error('❌ Node.js 18+ required, or: npm install ws');
    process.exit(1);
  }
}

// -- Parse CLI args --
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const nxt = argv[i + 1];
    if (nxt && !nxt.startsWith('--')) { args[key] = nxt; i++; }
    else args[key] = true;
  }
}

// -- Config persistence --
const CONFIG_PATH = path.join(os.homedir(), '.ssh-monitor-relay.json');
function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {};
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) { console.warn('⚠ Config save failed:', e.message); }
}

const savedConfig = loadConfig();
let SERVER = args.server || savedConfig.server || process.env.RELAY_SERVER || '';
let TOKEN  = args.token  || savedConfig.token  || process.env.RELAY_TOKEN  || '';
const RELAY_NAME = args.name || savedConfig.name || os.hostname();

// -- Install/uninstall handling (unchanged from original) --
const SVC_ID = 'com.ssh-monitor.relay';
const SVC_NAME = 'SSH Monitor Local Relay';
const PLATFORM = os.platform();
const NODE_BIN = process.execPath;
const SCRIPT = path.resolve(__filename);
const INSTALL_DIR = PLATFORM === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SSH Monitor Relay')
  : path.join(os.homedir(), '.ssh-monitor-relay');
const INSTALLED_SCRIPT = path.join(INSTALL_DIR, 'local-relay.js');

if (args.install) {
  if (!SERVER || !TOKEN) { console.error('--server and --token required'); process.exit(1); }
  saveConfig({ server: SERVER, token: TOKEN, name: RELAY_NAME });
  ensureInstalledScript();
  if (PLATFORM === 'darwin') installMacOS();
  else if (PLATFORM === 'linux') installLinux();
  console.log('✅ Relay agent installed as service');
  process.exit(0);
}
if (args.uninstall) {
  if (PLATFORM === 'darwin') uninstallMacOS();
  else if (PLATFORM === 'linux') uninstallLinux();
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  console.log('✅ Uninstalled');
  process.exit(0);
}

function ensureInstalledScript() {
  try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    if (path.resolve(SCRIPT) !== path.resolve(INSTALLED_SCRIPT)) {
      fs.copyFileSync(SCRIPT, INSTALLED_SCRIPT);
      if (PLATFORM !== 'win32') try { fs.chmodSync(INSTALLED_SCRIPT, 0o755); } catch {}
    }
    
    // Automatically initialize package.json and install ssh2 + ws in the installation folder
    try {
      console.log('📦 Installing dependencies (ssh2, ws) for relay agent service...');
      if (!fs.existsSync(path.join(INSTALL_DIR, 'package.json'))) {
        fs.writeFileSync(path.join(INSTALL_DIR, 'package.json'), JSON.stringify({
          name: 'ssh-monitor-relay-agent',
          version: '1.0.0',
          private: true
        }));
      }
      const npmCmd = PLATFORM === 'win32' ? 'npm.cmd' : 'npm';
      // Use a local cache inside INSTALL_DIR to avoid EACCES errors from root-owned global npm cache
      const localCache = path.join(INSTALL_DIR, '.npm-cache');
      const result = spawnSync(npmCmd, [
        'install', '--no-audit', '--no-fund', '--prefer-offline',
        '--cache', localCache,
        'ssh2', 'ws'
      ], { cwd: INSTALL_DIR, stdio: 'inherit' });
      if (result.status === 0) {
        console.log('✅ Dependencies installed successfully.');
      } else {
        console.warn('⚠️  npm install returned non-zero status code. Some features might not be available.');
      }
    } catch (npmErr) {
      console.warn('⚠️  Could not automatically install dependencies:', npmErr.message);
      console.warn('   You can install them manually by running: cd ' + INSTALL_DIR + ' && npm install ssh2 ws');
    }

    return INSTALLED_SCRIPT;
  } catch (e) { console.error('Install failed:', e.message); process.exit(1); }
}

// -- Connection state --
const tcpConnections = new Map();  // connId → net.Socket
const sshSessions = new Map();    // connId → { sshClient, stream, sftpClient, sftpPending }
let retryDelay = 3000;

// ── Local discovery server (browser auto-detect) ───────────────────────
let discoveryServer = null;
const DISCOVERY_PORT = 48923;

function startDiscoveryServer(relayName) {
  if (discoveryServer) return;
  try {
    discoveryServer = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ relayName, hostname: os.hostname() }));
    });
    discoveryServer.listen(DISCOVERY_PORT, '127.0.0.1', () => {
      console.log(`🔍 Discovery server on http://127.0.0.1:${DISCOVERY_PORT}`);
    });
    discoveryServer.on('error', () => {}); // Port in use — ignore
  } catch (_) {}
}

// ── Main connection loop ──────────────────────────────────────────────────
let activeWs = null;
function connect() {
  if (!SERVER || !TOKEN) {
    console.error('❌ Server and token required. Run with: --server URL --token TOKEN');
    process.exit(1);
  }

  const wsUrl = SERVER.replace(/^http/, 'ws') + `/relay-ws?token=${encodeURIComponent(TOKEN)}`;
  console.log(`\n🔗 SSH Monitor Enhanced Local Relay`);
  console.log(`   Server: ${SERVER}`);
  console.log(`   SSH2:   ${ssh2 ? 'available' : 'not installed'}`);
  console.log(`   Connecting...`);

  let ws;
  try {
    ws = new WS(wsUrl);
    activeWs = ws;
  } catch (err) {
    console.error('❌ WebSocket failed:', err.message);
    setTimeout(connect, retryDelay);
    return;
  }

  let keepAlive = null;

  ws.addEventListener('open', () => {
    retryDelay = 3000;
    // Don't send init here — wait for 'ready' from server
    keepAlive = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 30000);
  });

  ws.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // O(1) dispatch — switch is faster than 27 linear if-checks for every message
    switch (msg.type) {
      // ── TCP relay ──
      case 'ready':
        ws.send(JSON.stringify({ type: 'init', relayName: RELAY_NAME, capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true } }));
        console.log(`\n✅ Relay ready! Name: ${RELAY_NAME}, Capabilities: SSH=${!!ssh2}, SFTP=${!!ssh2}, Docker=true`);
        startDiscoveryServer(RELAY_NAME);
        break;

      case 'open': {
        const { connId } = msg;
        const tcpHost = msg.host || 'localhost';
        const tcpPort = Number(msg.port) || 22;
        const tcp = net.connect(tcpPort, tcpHost);
        tcp.on('data', (chunk) => {
          if (ws.readyState !== 1) return;
          ws.send(JSON.stringify({ type: 'data', connId, data: chunk.toString('base64') }), (err) => {
            if (err) { tcp.destroy(); return; }
          });
          // Backpressure: pause TCP if WS buffer is full, resume on drain
          if (ws.bufferedAmount > 512 * 1024) {
            tcp.pause();
            const resume = () => {
              if (ws.readyState !== 1) { tcp.destroy(); return; }
              tcp.resume();
            };
            // Poll until drained (ws package doesn't emit drain on client sockets)
            const poll = () => {
              if (ws.bufferedAmount === 0) resume();
              else if (ws.readyState === 1) setTimeout(poll, 32);
            };
            setTimeout(poll, 32);
          }
        });
        tcp.on('close', () => { try { ws.send(JSON.stringify({ type: 'close', connId })); } catch {} tcpConnections.delete(connId); });
        tcp.on('error', (err) => { console.error(`✗ [${connId}] TCP error: ${err.message}`); tcp.destroy(); });
        tcpConnections.set(connId, tcp);
        break;
      }

      case 'data': {
        const tcp = tcpConnections.get(msg.connId);
        if (tcp && !tcp.destroyed) tcp.write(Buffer.from(msg.data, 'base64'));
        break;
      }

      case 'close': {
        const tcp = tcpConnections.get(msg.connId);
        if (tcp) { tcp.destroy(); tcpConnections.delete(msg.connId); }
        break;
      }

      // ── SSH ──
      case 'ssh:connect':     handleSshConnect(ws, msg); break;
      case 'ssh:exec':        handleSshExec(ws, msg);    break;
      case 'ssh:disconnect':  cleanupSsh(msg.connId);    break;

      case 'ssh:input': {
        const session = sshSessions.get(msg.connId);
        if (session?.stream?.writable) session.stream.write(msg.data);
        break;
      }

      case 'ssh:resize': {
        const session = sshSessions.get(msg.connId);
        if (session?.stream) try { session.stream.setWindow(msg.rows, msg.cols, 0, 0); } catch {}
        break;
      }

      // ── SFTP ──
      case 'sftp:list':           handleSftpList(ws, msg);           break;
      case 'sftp:readFile':       handleSftpRead(ws, msg);           break;
      case 'sftp:writeFile':      handleSftpWrite(ws, msg);          break;
      case 'sftp:mkdir':          handleSftpMkdir(ws, msg);          break;
      case 'sftp:delete':         handleSftpDelete(ws, msg);         break;
      case 'sftp:upload':         handleSftpUpload(ws, msg);         break;
      case 'sftp:upload_start':   console.log(`📤 [relay] received sftp:upload_start for ${msg.remotePath} (connId=${msg.connId})`); handleSftpUploadStart(ws, msg);    break;
      case 'sftp:upload_chunk':   handleSftpUploadChunk(ws, msg);    break;
      case 'sftp:upload_done':    console.log(`📤 [relay] received sftp:upload_done for ${msg.remotePath}`); handleSftpUploadDone(ws, msg);     break;
      case 'sftp:upload_abort':   handleSftpUploadAbort(ws, msg);    break;
      case 'sftp:download':       handleSftpDownload(ws, msg);       break;
      case 'sftp:download_folder':handleSftpDownloadFolder(ws, msg); break;
      case 'sftp:search':         handleSftpSearch(ws, msg);         break;
      case 'sftp:getSize':        handleSftpGetSize(ws, msg);        break;
      case 'sftp:copy':           handleSftpCopy(ws, msg);           break;
      case 'sftp:move':           handleSftpMove(ws, msg);           break;
      case 'sftp:readFileBase64': handleSftpReadBase64(ws, msg);     break;
      case 'sftp:extract':        handleSftpExtract(ws, msg);        break;

      // ── Docker ──
      case 'docker:command': handleDockerCommand(ws, msg); break;

      // ── Control ──
      case 'disconnect':
        console.log(`\n🛑 Disconnected by server: ${msg.reason || 'Relay disconnected'}`);
        console.log('   Exiting. Run with a new token to reconnect.');
        ws.close(4000, 'disconnect');
        process.exit(0);
        break;

      case 'pong': break; // keepalive reply — no-op

      case 'error':
        console.error(`❌ Server error: ${msg.message}`);
        break;
    }
  });

  ws.addEventListener('close', ({ code, reason }) => {
    if (ws !== activeWs) return;
    clearInterval(keepAlive);
    tcpConnections.forEach(t => t.destroy());
    tcpConnections.clear();
    sshSessions.forEach((s, id) => cleanupSsh(id));

    // Cleanup any active upload streams
    activeUploads.forEach((upload, key) => {
      try { upload.stream.destroy(); } catch {}
    });
    activeUploads.clear();

    // Code 4000 = intentional disconnect (user revoked/disconnected from dashboard)
    if (code === 4000) {
      console.log(`\n🛑 Disconnected by server: ${reason || 'Token revoked or relay disconnected'}`);
      console.log('   Run with a new token to reconnect. Exiting.');
      process.exit(0);
    }

    console.log(`\n💤 Disconnected (code: ${code}). Reconnecting in ${retryDelay / 1000}s...`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 1.5, 30000);
  });

  ws.addEventListener('error', (err) => {
    if (ws !== activeWs) return;
    console.error(`❌ WebSocket error: ${err.message || err}`);
  });
}

// Helper to safely check if SFTP attributes represent a directory (handles raw objects as well as Stats objects)
function isDir(attrs) {
  if (!attrs) return false;
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory();
  return typeof attrs.mode === 'number' && (attrs.mode & 0o170000) === 0o040000;
}

// ── SSH handlers ──────────────────────────────────────────────────────────
function handleSshConnect(ws, msg) {
  if (!ssh2) {
    ws.send(JSON.stringify({ type: 'ssh:error', connId: msg.connId, error: 'ssh2 not installed on relay agent' }));
    return;
  }

  const { connId, connection, cols, rows } = msg;
  const config = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username || 'root',
    readyTimeout: 15000,
    keepaliveInterval: 10000,
  };

  if (connection.password) config.password = connection.password;
  if (connection.privateKey) config.privateKey = connection.privateKey;
  if (connection.passphrase) config.passphrase = connection.passphrase;

  const sshClient = new ssh2.Client();

  sshClient.on('ready', () => {
    console.log(`✅ [${connId}] SSH connected to ${config.host}:${config.port}`);

    sshClient.shell({ term: 'xterm-256color', cols: cols || 120, rows: rows || 30 }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'ssh:error', connId, error: err.message }));
        return;
      }

      sshSessions.set(connId, { sshClient, stream, connection });

      ws.send(JSON.stringify({ type: 'ssh:connected', connId }));

      stream.on('data', (data) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ssh:data', connId, data: data.toString('utf-8') }));
      });

      stream.stderr.on('data', (data) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ssh:data', connId, data: data.toString('utf-8') }));
      });

      stream.on('close', () => {
        ws.send(JSON.stringify({ type: 'ssh:closed', connId }));
        cleanupSsh(connId);
      });
    });
  });

  sshClient.on('error', (err) => {
    console.error(`✗ [${connId}] SSH error: ${err.message}`);
    ws.send(JSON.stringify({ type: 'ssh:error', connId, error: err.message }));
    cleanupSsh(connId);
  });

  sshClient.on('close', () => {
    cleanupSsh(connId);
  });

  sshClient.connect(config);
}

function handleSshExec(ws, msg) {
  const session = sshSessions.get(msg.connId);
  if (!session?.sshClient) {
    ws.send(JSON.stringify({ type: 'ssh:exec_error', connId: msg.connId, error: 'No SSH session' }));
    return;
  }

  session.sshClient.exec(msg.command, (err, stream) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'ssh:exec_error', connId: msg.connId, error: err.message }));
      return;
    }

    let stdout = '', stderr = '';
    stream.on('data', (d) => { stdout += d.toString(); });
    stream.stderr.on('data', (d) => { stderr += d.toString(); });
    stream.on('close', (code) => {
      ws.send(JSON.stringify({ type: 'ssh:exec_result', connId: msg.connId, stdout, stderr, code }));
    });
  });
}

function cleanupSsh(connId) {
  const session = sshSessions.get(connId);
  if (session) {
    try { session.stream?.close(); } catch {}
    try { session.sftpClient?.end(); } catch {}
    try { session.sshClient?.end(); } catch {}
    sshSessions.delete(connId);
  }

  // Cleanup any active uploads for this connection
  for (const [key, upload] of activeUploads.entries()) {
    if (key.startsWith(`${connId}:`)) {
      try { upload.stream.destroy(); } catch {}
      activeUploads.delete(key);
    }
  }
}

// ── SFTP helpers ──────────────────────────────────────────────────────────
/**
 * Returns a cached SFTP client for the given connId.
 * Opens a new SFTP channel only if one is not already open.
 * This avoids exhausting SSH channel limits (max ~10 concurrent channels).
 */
function getSftpClient(connId) {
  return new Promise((resolve, reject) => {
    const session = sshSessions.get(connId);
    if (!session?.sshClient) return reject(new Error('No SSH session'));

    // Return cached client if still alive
    if (session.sftpClient && !session.sftpClient._ending) {
      return resolve(session.sftpClient);
    }

    // If a pending promise already exists, wait for it
    if (session.sftpPending) {
      return session.sftpPending.then(resolve, reject);
    }

    // Open a new SFTP channel and cache it
    const pending = new Promise((res, rej) => {
      session.sshClient.sftp((err, sftp) => {
        session.sftpPending = null;
        if (err) {
          session.sftpClient = null;
          return rej(err);
        }
        session.sftpClient = sftp;
        // Clean up cache when the SFTP channel closes
        sftp.on('close', () => {
          if (session.sftpClient === sftp) session.sftpClient = null;
        });
        sftp.on('error', () => {
          if (session.sftpClient === sftp) session.sftpClient = null;
        });
        res(sftp);
      });
    });
    session.sftpPending = pending;
    pending.then(resolve, reject);
  });
}

function sendSftpError(ws, connId, err) {
  ws.send(JSON.stringify({ type: 'sftp:error', connId, error: err?.message || String(err) }));
}

// ── SFTP handlers ─────────────────────────────────────────────────────────
async function handleSftpList(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const listPath = msg.path || '.';
    // Use readdir() — NOT createReadStream() which is for file bytes
    sftp.readdir(listPath, (err, list) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      const files = list.map(entry => ({
        filename: entry.filename,
        longname: entry.longname,
        attrs: {
          size:  entry.attrs.size,
          mode:  entry.attrs.mode,
          atime: entry.attrs.atime,
          mtime: entry.attrs.mtime,
          uid:   entry.attrs.uid,
          gid:   entry.attrs.gid,
        },
      }));
      ws.send(JSON.stringify({ type: 'sftp:list', connId: msg.connId, path: listPath, files }));
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpRead(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    sftp.stat(msg.path, (statErr, stat) => {
      if (statErr) return sendSftpError(ws, msg.connId, statErr);
      
      const MAX_SIZE = 10 * 1024 * 1024; // 10 MB limit
      if (stat.size > MAX_SIZE) {
        return sendSftpError(ws, msg.connId, new Error(`File is too large to open in editor (${(stat.size / 1024 / 1024).toFixed(1)}MB). Please download it instead.`));
      }

      const chunks = [];
      const stream = sftp.createReadStream(msg.path);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
      stream.on('end', () => {
        ws.send(JSON.stringify({ type: 'sftp:fileData', connId: msg.connId, path: msg.path, content: Buffer.concat(chunks).toString('utf-8') }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpWrite(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const stream = sftp.createWriteStream(msg.path);
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.end(msg.content, () => {
      ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'write', path: msg.path }));
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpMkdir(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    sftp.mkdir(msg.path, (err) => {
      if (err) sendSftpError(ws, msg.connId, err);
      else ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'mkdir', path: msg.path }));
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

function handleSftpDelete(ws, msg) {
  const session = sshSessions.get(msg.connId);
  if (!session?.sshClient) {
    return sendSftpError(ws, msg.connId, new Error('No SSH session'));
  }

  const filePath = msg.path;

  const doDelete = (isRetry = false) => {
    // Use rm -rf directly — handles both files and directories without opening a new SFTP subsystem
    const cmd = `rm -rf "${filePath.replace(/"/g, '\\"')}"`;

    session.sshClient.exec(cmd, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      let stderr = '';
      stream.on('data', () => {});
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (code === 0) {
          ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'delete', path: filePath }));
        } else {
          sendSftpError(ws, msg.connId, new Error(stderr.trim() || `Delete failed (exit ${code})`));
        }
      });
    });
  };

  doDelete();
}

// Active upload streams: key = `${connId}:${remotePath}`
// Each entry: { stream, ws, bytesWritten, initialOffset, ready, pendingChunks, pendingDone }
const activeUploads = new Map();

function writeChunk(ws, connId, key, buf, filename) {
  const upload = activeUploads.get(key);
  if (!upload) return;

  let settled = false;
  const writeTimeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error(`⏰ [relay] SFTP write timeout for ${filename} (${buf.length} bytes) — write callback never fired`);
    sendSftpError(ws, connId, new Error('SFTP write timeout — server did not acknowledge write'));
    // Clean up the stuck upload
    try { upload.stream.destroy(); } catch (_) {}
    activeUploads.delete(key);
  }, 30000);

  upload.stream.write(buf, (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(writeTimeout);
    if (err) {
      sendSftpError(ws, connId, err);
      return;
    }
    upload.bytesWritten += buf.length;
    const currentOffset = upload.initialOffset + upload.bytesWritten;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'sftp:upload_ack',
        connId: connId,
        filename: filename,
        offset: currentOffset
      }));
    }
  });
}

async function handleSftpUploadStart(ws, msg) {
  const key = `${msg.connId}:${msg.remotePath}`;
  console.log(`📤 [relay] handleSftpUploadStart: ${msg.remotePath} (connId=${msg.connId}, hasSession=${sshSessions.has(msg.connId)})`);

  // Placeholder entry with initialOffset
  activeUploads.set(key, {
    stream: null,
    ws,
    bytesWritten: 0,
    initialOffset: msg.offset || 0,
    ready: false,
    pendingChunks: [],
    pendingDone: null
  });

  try {
    console.log(`📤 [relay] getting SFTP client for connId=${msg.connId}`);
    // Add a timeout for getSftpClient — if the SFTP channel can't open, don't hang forever
    const sftp = await Promise.race([
      getSftpClient(msg.connId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SFTP channel open timeout')), 15000)),
    ]);
    console.log(`📤 [relay] SFTP client obtained, creating write stream for ${msg.remotePath}`);
    const offset = msg.offset || 0;
    const flags = offset > 0 ? 'r+' : 'w';
    const stream = sftp.createWriteStream(msg.remotePath, { flags, start: offset, autoClose: true });
    console.log(`📤 [relay] write stream created for ${msg.remotePath}, waiting for 'open' event...`);

    stream.on('error', (err) => {
      console.error(`Upload stream error for ${msg.remotePath}:`, err.message);
      activeUploads.delete(key);
      sendSftpError(ws, msg.connId, err);
    });

    let completionSent = false;
    const sendCompletion = () => {
      if (completionSent) return;
      completionSent = true;
      if (!activeUploads.has(key)) {
        console.log(`⚠️ [relay] Upload completion skipped - entry not found for: ${msg.remotePath}`);
        return;
      }
      activeUploads.delete(key);
      if (ws.readyState === 1) {
        console.log(`📤 [relay] Sending sftp:upload_complete for: ${msg.remotePath}`);
        ws.send(JSON.stringify({ type: 'sftp:upload_complete', connId: msg.connId, path: msg.remotePath }));
      } else {
        console.warn(`⚠️ [relay] WebSocket not open (state: ${ws.readyState}) - cannot send completion for: ${msg.remotePath}`);
      }
    };

    stream.on('close', () => {
      console.log(`📤 [relay] Stream close event for: ${msg.remotePath}`);
      sendCompletion();
    });
    // Fallback: 'finish' fires when stream.end() flushes all data to the SFTP subsystem.
    // In production, the 'close' event (file-handle release) can be delayed or lost;
    // 'finish' is reliable and sufficient for upload completion.
    stream.on('finish', () => {
      console.log(`📤 [relay] Stream finish event for: ${msg.remotePath} (completionSent: ${completionSent})`);
      if (!completionSent) {
        setTimeout(() => {
          if (!completionSent) {
            console.log(`📤 [relay] Finish fallback (2s) - sending completion for: ${msg.remotePath}`);
            sendCompletion();
          }
        }, 2000);
      }
    });

    const entry = activeUploads.get(key);
    if (!entry) return; // was aborted while we were awaiting

    entry.stream = stream;
    entry.ready = true;
    console.log(`📤 [relay] stream ready for ${msg.remotePath}, pendingChunks=${entry.pendingChunks.length}`);

    // Flush any chunks that arrived before the stream was ready
    for (const buf of entry.pendingChunks) {
      writeChunk(ws, msg.connId, key, buf, msg.filename || 'file');
    }
    entry.pendingChunks = [];

    // If 'done' arrived before we were ready, handle it now
    if (entry.pendingDone) {
      entry.pendingDone = null;
      stream.end();
    }
  } catch (err) {
    activeUploads.delete(key);
    sendSftpError(ws, msg.connId, err);
  }
}

function handleSftpUploadChunk(ws, msg) {
  const key = `${msg.connId}:${msg.remotePath}`;
  const upload = activeUploads.get(key);
  if (!upload) {
    sendSftpError(ws, msg.connId, new Error('No active upload session'));
    return;
  }

  const buf = Buffer.from(msg.data, 'base64');

  if (!upload.ready) {
    // Stream not open yet — queue the chunk
    upload.pendingChunks.push(buf);
    return;
  }

  writeChunk(ws, msg.connId, key, buf, msg.filename);
}

function handleSftpUploadDone(ws, msg) {
  const key = `${msg.connId}:${msg.remotePath}`;
  const upload = activeUploads.get(key);
  if (!upload) {
    sendSftpError(ws, msg.connId, new Error('No active upload session'));
    return;
  }

  if (!upload.ready) {
    // Stream not open yet — defer the done signal
    upload.pendingDone = msg;
    return;
  }

  upload.stream.end();
}

function handleSftpUploadAbort(ws, msg) {
  const key = `${msg.connId}:${msg.remotePath}`;
  const upload = activeUploads.get(key);
  if (upload) {
    upload.stream.destroy();
    activeUploads.delete(key);
  }
}

// Legacy single-message upload (kept for backward compatibility)
async function handleSftpUpload(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const stream = sftp.createWriteStream(msg.remotePath);
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.end(Buffer.from(msg.data, 'base64'), () => {
      ws.send(JSON.stringify({ type: 'sftp:upload_complete', connId: msg.connId, path: msg.remotePath }));
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpDownload(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const filePath = msg.filePath || msg.remotePath;
    const filename = path.posix.basename(filePath);

    // Get file size for progress calculation
    sftp.stat(filePath, (statErr, stat) => {
      if (statErr) return sendSftpError(ws, msg.connId, statErr);

      const size = stat.size;
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'sftp:download_start',
          connId: msg.connId,
          filename,
          size,
          offset: 0
        }));
      }

      const stream = sftp.createReadStream(filePath, {
        highWaterMark: 256 * 1024 // 256 KB chunks
      });

      let bytesSent = 0;
      stream.on('data', (chunk) => {
        bytesSent += chunk.length;
        const progress = size > 0 ? Math.round((bytesSent / size) * 100) : 0;
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'sftp:download_chunk',
            connId: msg.connId,
            filename,
            chunk: chunk.toString('base64'),
            progress,
            offset: bytesSent
          }));

          if (ws.bufferedAmount && ws.bufferedAmount > 1024 * 1024) {
            stream.pause();
            const checkBuffer = () => {
              if (ws.readyState !== 1) {
                stream.destroy();
                return;
              }
              if (ws.bufferedAmount === 0) {
                stream.resume();
              } else {
                setTimeout(checkBuffer, 50);
              }
            };
            setTimeout(checkBuffer, 50);
          }
        }
      });

      stream.on('error', (err) => {
        sendSftpError(ws, msg.connId, err);
      });

      stream.on('end', () => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'sftp:download_done',
            connId: msg.connId,
            filename
          }));
        }
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpDownloadFolder(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) {
      return sendSftpError(ws, msg.connId, new Error('No SSH session'));
    }

    const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}' `;

    let archiveName, tarCmd;
    if (msg.folderPath) {
      const folderName = path.posix.basename(msg.folderPath);
      const parentDir = path.posix.dirname(msg.folderPath);
      archiveName = folderName + '.tar.gz';
      tarCmd = `tar czf - -C ${sq(parentDir)} ${sq(folderName)}`;
    } else if (msg.paths && msg.paths.length > 0) {
      archiveName = 'selection.tar.gz';
      const parentDir = path.posix.dirname(msg.paths[0].filePath);
      const items = msg.paths.map(p => sq(path.posix.basename(p.filePath))).join(' ');
      tarCmd = `tar czf - -C ${sq(parentDir)} ${items}`;
    } else {
      return sendSftpError(ws, msg.connId, new Error('No paths specified'));
    }

    session.sshClient.exec(tarCmd, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'sftp:download_start',
          connId: msg.connId,
          filename: archiveName,
          size: -1,
          offset: 0
        }));
      }

      let totalSent = 0;
      let stderrBuf = '';

      stream.on('data', (chunk) => {
        totalSent += chunk.length;
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'sftp:download_chunk',
            connId: msg.connId,
            filename: archiveName,
            chunk: chunk.toString('base64'),
            progress: -1,
            offset: totalSent
          }));

          if (ws.bufferedAmount && ws.bufferedAmount > 1024 * 1024) {
            stream.pause();
            const checkBuffer = () => {
              if (ws.readyState !== 1) {
                stream.destroy();
                return;
              }
              if (ws.bufferedAmount === 0) {
                stream.resume();
              } else {
                setTimeout(checkBuffer, 50);
              }
            };
            setTimeout(checkBuffer, 50);
          }
        }
      });

      stream.stderr.on('data', (d) => { stderrBuf += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) {
          return sendSftpError(ws, msg.connId, new Error(`tar failed (exit ${code}): ${stderrBuf}`));
        }
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'sftp:download_done',
            connId: msg.connId,
            filename: archiveName
          }));
        }
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpSearch(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    const q = String(msg.query || '').trim();
    if (!q) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results: [] }));
      }
      return;
    }

    const startDir = msg.path || '.';

    const runManualWalk = async () => {
      try {
        const sftp = await getSftpClient(msg.connId);
        const query = q.toLowerCase();
        const results = [];
        const MAX_RESULTS = 200;

        async function walk(dir) {
          if (results.length >= MAX_RESULTS) return;
          const list = await new Promise((resolve, reject) => {
            sftp.readdir(dir, (err, list) => err ? reject(err) : resolve(list || []));
          });
          for (const item of list) {
            if (results.length >= MAX_RESULTS) break;
            const fullPath = dir === '/' ? `/${item.filename}` : `${dir}/${item.filename}`;
            if (item.filename.toLowerCase().includes(query)) {
              results.push({
                filename: item.filename,
                path: fullPath,
                absPath: fullPath,
                dir: dir,
                isDirectory: isDir(item.attrs)
              });
            }
            if (isDir(item.attrs) && !item.filename.startsWith('.')) {
              await walk(fullPath);
            }
          }
        }

        await walk(startDir);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results }));
        }
      } catch (err) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results: [], error: err?.message }));
        }
      }
    };

    if (session?.sshClient) {
      const escapedQ = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      const findCmd = `find "${startDir}" -iname "*${escapedQ}*" 2>/dev/null | head -200`;

      session.sshClient.exec(findCmd, (err, stream) => {
        if (err) return runManualWalk();

        let output = '';
        stream.on('data', (d) => { output += d.toString(); });
        stream.on('close', (code) => {
          if (code !== 0) return runManualWalk();

          const seen = new Set();
          const results = output
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !seen.has(l) && seen.add(l))
            .map(absPath => {
              const filename = absPath.split('/').pop();
              const dir = absPath.split('/').slice(0, -1).join('/') || '/';
              return {
                filename,
                path: absPath,
                absPath,
                dir,
                isDirectory: !filename.includes('.')
              };
            });

          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results }));
          }
        });
      });
    } else {
      await runManualWalk();
    }
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results: [], error: err?.message }));
    }
  }
}

async function handleSftpGetSize(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const targetPath = msg.path;

    const stat = await new Promise((resolve, reject) => {
      sftp.stat(targetPath, (err, stats) => err ? reject(err) : resolve(stats));
    });

    const runManualGetSize = async () => {
      try {
        if (stat.isDirectory()) {
          let totalSize = 0;
          async function walk(dir) {
            const list = await new Promise((resolve, reject) => {
              sftp.readdir(dir, (err, list) => err ? reject(err) : resolve(list || []));
            });
            for (const item of list) {
              const fullPath = `${dir}/${item.filename}`;
              if (isDir(item.attrs)) {
                await walk(fullPath);
              } else {
                totalSize += item.attrs.size || 0;
              }
            }
          }
          await walk(targetPath);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: totalSize }));
          }
        } else {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: stat.size }));
          }
        }
      } catch (err) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: msg.path, size: 0, error: err?.message }));
        }
      }
    };

    if (stat.isDirectory()) {
      const session = sshSessions.get(msg.connId);
      if (session?.sshClient) {
        // Run remote du command (much faster)
        const cmd = `du -sb ${shellQuote(targetPath)} 2>/dev/null | cut -f1`;
        session.sshClient.exec(cmd, (err, stream) => {
          if (err) return runManualGetSize();

          let output = '';
          stream.on('data', (d) => { output += d.toString(); });
          stream.on('close', (code) => {
            const parsed = parseInt(output.trim(), 10);
            if (code === 0 && !isNaN(parsed)) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: parsed }));
              }
            } else {
              runManualGetSize();
            }
          });
        });
      } else {
        await runManualGetSize();
      }
    } else {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: stat.size }));
      }
    }
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: msg.path, size: 0, error: err?.message }));
    }
  }
}

async function handleSftpCopy(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));
    let done = false;
    const sendSuccess = () => {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      try { ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'copy', path: msg.dest })); } catch {}
    };
    session.sshClient.exec(`cp -r "${msg.src}" "${msg.dest}"`, (err, stream) => {
      if (err) { clearTimeout(safetyTimer); return sendSftpError(ws, msg.connId, err); }
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('error', (streamErr) => { clearTimeout(safetyTimer); sendSftpError(ws, msg.connId, streamErr); });
      stream.on('close', (code) => {
        if (code !== 0) { clearTimeout(safetyTimer); return sendSftpError(ws, msg.connId, new Error(`Copy failed: ${stderr}`)); }
        sendSuccess();
      });
    });
    const safetyTimer = setTimeout(() => { sendSuccess(); }, 120000);
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpMove(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));
    const overwriteFlag = msg.overwrite ? '-f' : '';
    let done = false;
    const sendSuccess = () => {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      try { ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'move', path: msg.dest })); } catch {}
    };
    session.sshClient.exec(`mv ${overwriteFlag} "${msg.src}" "${msg.dest}"`, (err, stream) => {
      if (err) { clearTimeout(safetyTimer); return sendSftpError(ws, msg.connId, err); }
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('error', (streamErr) => { clearTimeout(safetyTimer); sendSftpError(ws, msg.connId, streamErr); });
      stream.on('close', (code) => {
        if (code !== 0) { clearTimeout(safetyTimer); return sendSftpError(ws, msg.connId, new Error(`Move failed: ${stderr}`)); }
        sendSuccess();
      });
    });
    const safetyTimer = setTimeout(() => { sendSuccess(); }, 120000);
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpReadBase64(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    sftp.stat(msg.path, (statErr, stat) => {
      if (statErr) return sendSftpError(ws, msg.connId, statErr);

      const MAX_SIZE = 10 * 1024 * 1024; // 10 MB limit
      if (stat.size > MAX_SIZE) {
        return sendSftpError(ws, msg.connId, new Error(`File is too large to open in editor (${(stat.size / 1024 / 1024).toFixed(1)}MB). Please download it instead.`));
      }

      const chunks = [];
      const stream = sftp.createReadStream(msg.path);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
      stream.on('end', () => {
        ws.send(JSON.stringify({ type: 'sftp:fileData', connId: msg.connId, path: msg.path, content: Buffer.concat(chunks).toString('base64') }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpExtract(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));

    const archivePath = msg.path;
    const type = msg.archiveType || msg.type; // use archiveType passed from server.js to avoid overriding message type
    const targetDir = path.posix.dirname(archivePath);
    const filename = path.posix.basename(archivePath);
    const cleanupArchive = msg.cleanupArchive;

    // Build the single command that performs detection, execution, and fallbacks at shell level
    let extractCmd;
    if (type === 'zip') {
      extractCmd = `if command -v unzip >/dev/null; then unzip -o "${archivePath}" -d "${targetDir}"; elif command -v python3 >/dev/null; then python3 -c "import zipfile; zipfile.ZipFile('${archivePath}').extractall('${targetDir}')"; else echo "Neither 'unzip' nor 'python3' command found on the remote server." >&2; exit 127; fi`;
    } else {
      const isGzip = archivePath.endsWith('.gz') || archivePath.endsWith('.tgz');
      extractCmd = `if command -v tar >/dev/null; then tar -xv${isGzip ? 'z' : ''}f "${archivePath}" -C "${targetDir}"; else echo "'tar' command not found on the remote server." >&2; exit 127; fi`;
    }

    // Start progress
    ws.send(JSON.stringify({
      type: 'sftp:progress',
      connId: msg.connId,
      action: 'extract',
      filename,
      progress: -1,
      status: 'Starting extraction...'
    }));

    session.sshClient.exec(extractCmd, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      
      let extractedCount = 0;
      let buffer = '';
      let lastEmitTime = 0;
      let stderr = '';

      stream.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        const validLines = lines.filter(l => l.trim().length > 0);
        if (validLines.length > 0) {
          extractedCount += validLines.length;
          const lastLine = validLines[validLines.length - 1];
          const currentFile = lastLine.replace(/^(extracting:|  inflating:|inflating:|creating:|  creating:)/i, '').trim();

          const now = Date.now();
          if (now - lastEmitTime > 250) {
            ws.send(JSON.stringify({
              type: 'sftp:progress',
              connId: msg.connId,
              action: 'extract',
              filename,
              progress: -1,
              status: `${currentFile} (${extractedCount} files)`
            }));
            lastEmitTime = now;
          }
        }
      });

      stream.stderr.on('data', (d) => { stderr += d.toString(); });

      stream.on('close', (code) => {
        if (cleanupArchive) {
          session.sshClient.exec(`rm -f "${archivePath}"`, (rmErr, rmStream) => {
            if (!rmErr && rmStream) rmStream.resume();
          });
        }
        // Exit code 0, 1, or 2 are treated as success if stdout was produced (indicating some extraction happened)
        // unzip returns 1 for warnings (e.g. success with minor warnings). tar returns 1 or 2 on some warnings.
        const wasSuccessful = code === 0 || ((code === 1 || code === 2) && extractedCount > 0);

        if (!wasSuccessful) {
          return sendSftpError(ws, msg.connId, new Error(`Extract failed: ${stderr || `Exit code ${code}`}`));
        }

        // Final 100% progress update
        ws.send(JSON.stringify({
          type: 'sftp:progress',
          connId: msg.connId,
          action: 'extract',
          filename,
          progress: 100
        }));

        ws.send(JSON.stringify({
          type: 'sftp:action_success',
          connId: msg.connId,
          action: 'extract',
          path: targetDir
        }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

// ── Docker handlers ───────────────────────────────────────────────────────
function handleDockerCommand(ws, msg) {
  const { connId } = msg;
  const session = sshSessions.get(connId);
  if (!session?.sshClient) {
    ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'No SSH session. Connect to SSH first.' }));
    return;
  }

  const connection = session.connection || {};
  const dockerSudo = session.dockerSudo || '';

  let action = msg.action;
  let args = msg.args || [];
  let command = msg.command;

  const runRawCmd = (cmd) => {
    session.sshClient.exec(cmd, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'docker:error', connId, error: err.message }));
        return;
      }
      let stdout = '';
      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', (code) => {
        ws.send(JSON.stringify({ type: 'docker:result', connId, action, output: stdout.trim(), code, args }));
      });
    });
  };

  const runWithSudoDetection = (cmdSuffix, attemptWithSudo = false) => {
    const escapedPass = (connection.password || '').replace(/'/g, "'\\''");
    const prefix = attemptWithSudo ? `echo '${escapedPass}' | sudo -S su root -c ` : '';
    const finalCmd = attemptWithSudo
      ? `${prefix} 'docker ${cmdSuffix.replace(/'/g, "'\\''")}'`
      : `docker ${cmdSuffix}`;

    session.sshClient.exec(finalCmd, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'docker:error', connId, error: err.message }));
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => {
        stdout += d.toString().replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '');
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString().replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '');
      });
      stream.on('close', (code) => {
        stdout = stdout.replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '').trim();
        stderr = stderr.replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '').trim();

        const combined = (stdout + stderr).toLowerCase();
        if (action === 'info' && code !== 0 && combined.includes('permission denied') && !attemptWithSudo) {
          console.warn('⚠️ Docker info failed, retrying with sudo...');
          session.dockerSudo = 'sudo '; // Cache it for pull/build
          runWithSudoDetection(cmdSuffix, true);
          return;
        }

        if (attemptWithSudo && code === 0) {
          session.dockerSudo = 'sudo ';
        }

        if (action === 'pull' || action === 'pull:status') {
          ws.send(JSON.stringify({ type: 'docker:result', connId, action, output: stdout, code, args }));
        } else if (code !== 0) {
          const errText = stderr || `Docker ${action || 'command'} failed (code ${code})`;
          ws.send(JSON.stringify({ type: 'docker:error', connId, error: errText }));
        } else {
          ws.send(JSON.stringify({ type: 'docker:result', connId, action, output: stdout, code, args }));
        }
      });
    });
  };

  if (action) {
    const sudoPrefix = dockerSudo;
    let cmdSuffix = '';

    if (action === 'list') {
      cmdSuffix = `ps -a --format "{{json .}}"`;
    } else if (action === 'images') {
      cmdSuffix = `image ls -a --format "{{json .}}"`;
    } else if (action === 'vol-assoc') {
      cmdSuffix = `ids=$(docker ps -aq); [ -z "$ids" ] || docker inspect --format 'assoc:{{.ID}}\t{{.Name}}\t{{range .Mounts}}{{.Name}} {{end}}' $ids`;
    } else if (action === 'search' && args.length > 0) {
      const query = String(args[0] || '').replace(/[^a-zA-Z0-9._\- ]/g, '').trim();
      if (!query) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Search Query' }));
      cmdSuffix = `search --format "{{json .}}" "${query}"`;
    } else if (action === 'volumes') {
      cmdSuffix = `volume ls --format "{{json .}}"`;
    } else if (action === 'networks') {
      cmdSuffix = `network ls --format "{{json .}}"`;
    } else if (action === 'rmi' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Image ID' }));
      cmdSuffix = `rmi ${targetId}`;
    } else if (action === 'info') {
      cmdSuffix = `info --format "{{json .}}"`;
    } else if (action === 'logs' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Container ID' }));
      cmdSuffix = `logs --tail 200 ${targetId}`;
    } else if (action === 'run' && args.length >= 2) {
      const name = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const image = String(args[1] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      const rawPorts = String(args[2] || '');
      const rawEnv = String(args[3] || '');
      const rawVolumes = String(args[4] || '');
      if (!image) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Image' }));

      let runArgs = ['-d'];
      if (name) runArgs.push(`--name ${name}`);
      if (rawPorts) {
        rawPorts.split(',').forEach(p => {
          const pair = p.trim().replace(/[^0-9:]/g, '');
          if (pair) runArgs.push(`-p ${pair}`);
        });
      }
      if (rawEnv) {
        rawEnv.split(',').forEach(e => {
          const kv = e.trim().replace(/[^a-zA-Z0-9._=\-]/g, '');
          if (kv.includes('=')) runArgs.push(`-e "${kv}"`);
        });
      }
      if (rawVolumes) {
        rawVolumes.split(',').forEach(v => {
          const pair = v.trim().replace(/[^a-zA-Z0-9._/:-]/g, '');
          if (pair && pair.includes(':')) runArgs.push(`-v ${pair}`);
        });
      }
      cmdSuffix = `run ${runArgs.join(' ')} ${image}`;
    } else if (action === 'pull' && args.length > 0) {
      const image = String(args[0] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      if (!image) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Image Name' }));
      const safeName = image.replace(/[^a-z0-9]/gi, '_');
      const pullCmd = `rm -f /tmp/pull_${safeName}.log; touch /tmp/pull_${safeName}.log; nohup sh -c '${sudoPrefix}docker pull ${image} 2>&1 | tee /tmp/pull_${safeName}.log; echo "---FINISHED---" >> /tmp/pull_${safeName}.log' >/dev/null 2>&1 & echo STARTED`;
      return runRawCmd(pullCmd);
    } else if (action === 'pull:status' && args.length > 0) {
      const image = String(args[0] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      if (!image) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Image Name' }));
      const safeName = image.replace(/[^a-z0-9]/gi, '_');
      const statusCmd = `(if [ -f "/tmp/pull_${safeName}.log" ]; then RUNNING=$(ps aux 2>/dev/null | grep -v grep | grep "${sudoPrefix}docker pull ${image}" | wc -l); if [ "$RUNNING" = "0" ] && ! grep -q "---FINISHED---" "/tmp/pull_${safeName}.log"; then echo "---FINISHED---" >> /tmp/pull_${safeName}.log; fi; tr '\\r' '\\n' < "/tmp/pull_${safeName}.log" | tail -n 20; else echo "INITIALIZING..."; fi); exit 0`;
      return runRawCmd(statusCmd);
    } else if (action === 'build' && args.length >= 2) {
      const tag = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const dockerfileBase64 = String(args[1] || '').replace(/[^a-zA-Z0-9+/=]/g, '');
      if (!tag || !dockerfileBase64) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Build Parameters' }));
      const safeTag = tag.replace(/[^a-z0-9]/gi, '_');
      const buildCmd = `rm -f /tmp/build_${safeTag}.log; touch /tmp/build_${safeTag}.log; nohup sh -c 'echo "${dockerfileBase64}" | base64 -d > /tmp/Dockerfile_${safeTag} && ${sudoPrefix}docker build -t ${tag} -f /tmp/Dockerfile_${safeTag} . 2>&1 | tee /tmp/build_${safeTag}.log; echo "---FINISHED---" >> /tmp/build_${safeTag}.log; rm -f /tmp/Dockerfile_${safeTag}' >/dev/null 2>&1 & echo STARTED`;
      return runRawCmd(buildCmd);
    } else if (action === 'build:status' && args.length > 0) {
      const tag = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!tag) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Tag Name' }));
      const safeTag = tag.replace(/[^a-z0-9]/gi, '_');
      const statusCmd = `(if [ -f "/tmp/build_${safeTag}.log" ]; then RUNNING=$(ps aux 2>/dev/null | grep -v grep | grep "docker build -t ${tag}" | wc -l); if [ "$RUNNING" = "0" ] && ! grep -q "---FINISHED---" "/tmp/build_${safeTag}.log"; then echo "---FINISHED---" >> /tmp/build_${safeTag}.log; fi; tr '\\r' '\\n' < "/tmp/build_${safeTag}.log" | tail -n 20; else echo "INITIALIZING..."; fi); exit 0`;
      return runRawCmd(statusCmd);
    } else if (['start', 'stop', 'restart', 'rm'].includes(action) && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Target ID' }));
      cmdSuffix = action === 'rm' ? `rm -f ${targetId}` : `${action} ${targetId}`;
    } else if (action === 'inspect' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Target ID' }));
      cmdSuffix = `inspect ${targetId}`;
    } else if (action === 'backup' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid ID for backup' }));
      const safeId = targetId.substring(0, 12);
      const backupCmd = `rm -f /tmp/backup_${safeId}.log; touch /tmp/backup_${safeId}.log; nohup sh -c '
        ROOT=$(${sudoPrefix}docker inspect ${targetId} --format "{{ index .Config.Labels \\"com.docker.compose.project.working_dir\\" }}"); 
        if [ -z "$ROOT" ]; then 
            ROOT=$(${sudoPrefix}docker inspect ${targetId} --format "{{ index .Config.Labels \\"com.docker.compose.project.config_files\\" }}" | xargs dirname | head -n 1); 
        fi; 
        if [ -z "$ROOT" ]; then
            BIND=$(${sudoPrefix}docker inspect ${targetId} --format "{{ range .Mounts }}{{ if eq .Type \\"bind\\" }}{{ .Source }}{{ break }}{{ end }}{{ end }}");
            if [ -n "$BIND" ]; then 
                ROOT=$(dirname "$BIND"); 
            fi;
        fi;
        if [ -n "$ROOT" ] && [ -d "$ROOT" ]; then 
            echo "Found project root: $ROOT" >> /tmp/backup_${safeId}.log;
            cd "$ROOT" && ${sudoPrefix}tar -czf /tmp/project_backup_${safeId}.tar.gz . 2>&1 | tee -a /tmp/backup_${safeId}.log; 
            echo "---FINISHED---" >> /tmp/backup_${safeId}.log; 
            echo "BACKUP_PATH:/tmp/project_backup_${safeId}.tar.gz" >> /tmp/backup_${safeId}.log; 
        else 
            echo "ERROR: Could not find project source directory." > /tmp/backup_${safeId}.log; 
            echo "---FINISHED---" >> /tmp/backup_${safeId}.log; 
        fi' >/dev/null 2>&1 & echo STARTED`;
      return runRawCmd(backupCmd);
    } else if (action === 'backup:status' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      const safeId = targetId.substring(0, 12);
      const statusCmd = `(if [ -f "/tmp/backup_${safeId}.log" ]; then RUNNING=$(ps aux 2>/dev/null | grep -v grep | grep "tar -czf /tmp/project_backup_${safeId}.tar.gz" | wc -l); if [ "$RUNNING" = "0" ] && ! grep -q "---FINISHED---" "/tmp/backup_${safeId}.log"; then echo "---FINISHED---" >> /tmp/backup_${safeId}.log; fi; tail -n 20 "/tmp/backup_${safeId}.log"; else echo "INITIALIZING..."; fi); exit 0`;
      return runRawCmd(statusCmd);
    } else if (action === 'read-config' && args.length >= 2) {
      const containerId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      const filePath = String(args[1] || '').replace(/[`$]/g, '');
      if (!containerId || !filePath) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid read-config args' }));
      return runRawCmd(`${sudoPrefix}docker exec ${containerId} cat "${filePath}"`);
    } else if (action === 'write-config' && args.length >= 3) {
      const containerId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      const filePath = String(args[1] || '').replace(/[`$]/g, '');
      const b64Content = String(args[2] || '');
      if (!containerId || !filePath) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid write-config args' }));
      return runRawCmd(`echo "${b64Content}" | base64 -d | ${sudoPrefix}docker exec -i ${containerId} sh -c "cat > '${filePath}'"`);
    } else if (action === 'find-config' && args.length >= 2) {
      const containerId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!containerId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid find-config args' }));
      const paths = args.slice(1).map(p => String(p).replace(/[`$]/g, ''));
      const checks = paths.map(p => `if [ -f '${p}' ]; then echo "FILE:${p}"; exit 0; fi; if [ -d '${p}' ]; then echo "DIR:${p}"; exit 0; fi`).join('; ');
      return runRawCmd(`${sudoPrefix}docker exec ${containerId} sh -c "${checks}; echo 'NONE'"`);
    } else if (action === 'prune-volumes') {
      cmdSuffix = `volume prune -f`;
    } else if (action === 'prune-images') {
      const pruneAll = args && (args[0] === true || args[0] === 'all');
      cmdSuffix = `image prune ${pruneAll ? '-a ' : ''}-f`;
    } else if (action === 'prune-system') {
      const pruneAll = args && (args[0] === true || args[0] === 'all');
      cmdSuffix = `system prune ${pruneAll ? '-a ' : ''}-f --volumes`;
    } else if (action === 'prune-custom') {
      const targets = args[0] || {};
      const pruneAll = args[1] === true;
      const cmds = [];
      if (targets.containers) cmds.push('container prune -f');
      if (targets.images) cmds.push(`image prune ${pruneAll ? '-a ' : ''}-f`);
      if (targets.volumes) cmds.push('volume prune -f');
      if (targets.networks) cmds.push('network prune -f');
      if (targets.cache) cmds.push('builder prune -f');
      if (cmds.length === 0) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'No targets selected' }));
      cmdSuffix = cmds.join(' && ');
    } else if (action === 'remove-selected') {
      const sel = args[0] || {};
      const cmds = [];
      if (sel.containers && sel.containers.length > 0) {
        const ids = sel.containers.map(id => String(id).replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean);
        if (ids.length > 0) cmds.push(`rm ${ids.join(' ')}`);
      }
      if (sel.images && sel.images.length > 0) {
        const tags = sel.images.map(t => String(t).replace(/[^a-zA-Z0-9._:@/-]/g, '')).filter(Boolean);
        if (tags.length > 0) cmds.push(`rmi ${tags.join(' ')}`);
      }
      if (sel.volumes && sel.volumes.length > 0) {
        const names = sel.volumes.map(n => String(n).replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean);
        if (names.length > 0) cmds.push(`volume rm ${names.join(' ')}`);
      }
      if (sel.networks && sel.networks.length > 0) {
        const names = sel.networks.map(n => String(n).replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean);
        if (names.length > 0) cmds.push(`network rm ${names.join(' ')}`);
      }
      if (sel.cache) cmds.push('builder prune -f');
      if (cmds.length === 0) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Nothing selected to remove' }));
      cmdSuffix = cmds.join(' && ');
    } else if (action === 'rm-volumes' && args.length > 0) {
      const volumeIds = args.map(id => String(id).replace(/[^a-zA-Z0-9._/:-]/g, '')).filter(Boolean);
      if (volumeIds.length === 0) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'No valid volume IDs' }));
      cmdSuffix = `volume rm ${volumeIds.join(' ')}`;
    } else if (action === 'check-port' && args.length > 0) {
      const port = String(args[0]).replace(/[^0-9]/g, '');
      if (!port) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Port' }));
      return runRawCmd(`sh -c "(ss -tuln 2>/dev/null || netstat -tuln) | grep -q -w ':${port}' && echo 'IN_USE' || echo 'FREE'"`);
    } else if (action === 'start-all') {
      // Start ALL stopped/exited/created/paused containers in one shot
      const startAllCmd = `sh -c "STOPPED=$(${sudoPrefix}docker ps -a --filter status=exited --filter status=created --filter status=paused -q 2>/dev/null); if [ -z \\"$STOPPED\\" ]; then echo 'NONE_STOPPED'; else ${sudoPrefix}docker start $STOPPED 2>&1; echo '---FINISHED---'; fi"`;
      return runRawCmd(startAllCmd);
    }

    runWithSudoDetection(cmdSuffix);
    return;
  }

  // Sanitize Docker command - only allow safe commands
  const safeCommands = [
    'ps', 'images', 'volumes', 'networks', 'info', 'version',
    'stats', 'top', 'logs', 'inspect', 'port', 'diff',
    'start', 'stop', 'restart', 'pause', 'unpause',
    'rm', 'rmi', 'pull', 'push', 'build', 'run',
    'exec', 'cp', 'rename', 'update', 'wait',
    'compose', 'stack', 'service', 'node', 'secret', 'config'
  ];
  
  const cmdParts = (command || '').trim().split(/\s+/);
  const baseCmd = cmdParts[0]?.split('=')[0]; // Handle --flag=value
  
  if (!baseCmd || !safeCommands.some(sc => baseCmd === sc || baseCmd.startsWith(sc + '-'))) {
    ws.send(JSON.stringify({ type: 'docker:error', connId, error: `Command not allowed: ${baseCmd}` }));
    return;
  }

  // Block potentially dangerous patterns
  const dangerous = /[;&|`$(){}!#<>]/;
  if (dangerous.test(command)) {
    ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Command contains unsafe characters' }));
    return;
  }

  session.sshClient.exec(`docker ${command}`, (err, stream) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'docker:error', connId, error: err.message }));
      return;
    }

    let stdout = '';
    let stderr = '';

    stream.on('data', (data) => {
      stdout += data.toString();
    });

    stream.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    stream.on('close', (code) => {
      if (code !== 0) {
        ws.send(JSON.stringify({ type: 'docker:error', connId, error: `Exit code ${code}`, stderr }));
      } else {
        ws.send(JSON.stringify({ type: 'docker:result', connId, stdout, stderr }));
      }
    });
  });
}

// ── Service install helpers (unchanged) ───────────────────────────────────
function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function xmlEscape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function installMacOS() {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, SVC_ID + '.plist');
  const logFile = path.join(os.homedir(), 'Library', 'Logs', 'ssh-monitor-relay.log');
  fs.mkdirSync(plistDir, { recursive: true });
  const LT = '<', GT = '>';
  const argTags = [NODE_BIN, INSTALLED_SCRIPT, '--server', SERVER, '--token', TOKEN]
    .map(a => `    ${LT}string${GT}${xmlEscape(a)}${LT}/string${GT}`).join('\n');
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `${LT}plist version="1.0"${GT}${LT}dict${GT}`,
    `  ${LT}key${GT}Label${LT}/key${GT}${LT}string${GT}${SVC_ID}${LT}/string${GT}`,
    `  ${LT}key${GT}ProgramArguments${LT}/key${GT}`,
    `  ${LT}array${GT}`, argTags, `  ${LT}/array${GT}`,
    `  ${LT}key${GT}RunAtLoad${LT}/key${GT}${LT}true/${GT}`,
    `  ${LT}key${GT}KeepAlive${LT}/key${GT}${LT}true/${GT}`,
    `  ${LT}key${GT}StandardOutPath${LT}/key${GT}${LT}string${GT}${logFile}${LT}/string${GT}`,
    `  ${LT}key${GT}StandardErrorPath${LT}/key${GT}${LT}string${GT}${logFile}${LT}/string${GT}`,
    `${LT}/dict${GT}${LT}/plist${GT}`,
  ].join('\n');
  fs.writeFileSync(plistPath, xml);
  spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  spawnSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' });
  console.log(`✅ Installed as macOS LaunchAgent. Logs: tail -f "${logFile}"`);
}

function uninstallMacOS() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', SVC_ID + '.plist');
  if (fs.existsSync(plistPath)) {
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    fs.unlinkSync(plistPath);
    console.log('✅ Removed macOS LaunchAgent');
  }
}

function installLinux() {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, SVC_ID + '.service');
  fs.mkdirSync(unitDir, { recursive: true });
  const unit = [
    '[Unit]', `Description=${SVC_NAME}`, 'After=network.target', '',
    '[Service]', 'Type=simple',
    `ExecStart=${shellQuote(NODE_BIN)} ${shellQuote(INSTALLED_SCRIPT)} --server ${shellQuote(SERVER)} --token ${shellQuote(TOKEN)}`,
    'Restart=always', 'RestartSec=5', '',
    '[Install]', 'WantedBy=default.target',
  ].join('\n') + '\n';
  fs.writeFileSync(unitPath, unit);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
  spawnSync('systemctl', ['--user', 'enable', '--now', SVC_ID + '.service'], { stdio: 'inherit' });
  console.log('✅ Installed as systemd user service');
}

function uninstallLinux() {
  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SVC_ID + '.service');
  if (fs.existsSync(unitPath)) {
    spawnSync('systemctl', ['--user', 'disable', '--now', SVC_ID + '.service'], { stdio: 'ignore' });
    fs.unlinkSync(unitPath);
    console.log('✅ Removed systemd service');
  }
}

// ── Start ─────────────────────────────────────────────────────────────────
connect();
