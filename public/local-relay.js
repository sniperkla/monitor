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

const PLATFORM = os.platform();
const INSTALL_DIR = PLATFORM === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SSH Monitor Relay')
  : path.join(os.homedir(), '.ssh-monitor-relay');
const searchPaths = [__dirname, INSTALL_DIR, path.join(INSTALL_DIR, 'node_modules'), ...module.paths];

function tryRequire(moduleName) {
  try { return require(moduleName); } catch (_) {}
  try { return require(path.join(INSTALL_DIR, 'node_modules', moduleName)); } catch (_) {}
  for (const p of searchPaths) {
    try { return require(require.resolve(moduleName, { paths: [p] })); } catch (_) {}
  }
  throw new Error(`Module ${moduleName} not found`);
}

// -- Try to load ssh2 (optional dependency) --
let ssh2;
try {
  ssh2 = tryRequire('ssh2');
  console.log('✅ ssh2 loaded — SSH/SFTP will run locally');
} catch {
  console.log('ℹ️  ssh2 not found — install with: npm install ssh2');
  console.log('   Falling back to TCP relay mode only');
}

// -- Try to load node-datachannel (WebRTC, optional) --
let ndc = null;
try {
  ndc = tryRequire('node-datachannel');
  ndc.initLogger('Error');
  console.log('✅ node-datachannel loaded — WebRTC P2P enabled');
} catch {
  console.log('ℹ️  node-datachannel not found — relay will operate in WebSocket-proxy mode');
  console.log('   For P2P mode: npm install node-datachannel  (in relay directory)');
}

// crypto is built-in since Node 18
const crypto = require('crypto');

// Map: relayConnId → pre-provisioned SSH config (sent by server before WebRTC peer connects)
const preparedSessions = new Map();
// Map: relayConnId → active WebRTC peer
const activeRtcPeers   = new Map();

// -- Try to load ws --
let WS;
try {
  WS = tryRequire('ws');
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
const NODE_BIN = process.execPath;
const SCRIPT = path.resolve(__filename);
const INSTALLED_SCRIPT = path.join(INSTALL_DIR, 'local-relay.js');

if (args.install) {
  if (!SERVER || !TOKEN) { console.error('--server and --token required'); process.exit(1); }
  saveConfig({ server: SERVER, token: TOKEN, name: RELAY_NAME });
  ensureInstalledScript();
  if (PLATFORM === 'darwin') installMacOS();
  else if (PLATFORM === 'linux') installLinux();
  else if (PLATFORM === 'win32') installWindows();
  console.log('✅ Relay agent installed as service');

  // Self-cleanup: remove temporary installer script if running outside INSTALL_DIR
  try {
    if (path.resolve(SCRIPT) !== path.resolve(INSTALLED_SCRIPT) && fs.existsSync(SCRIPT)) {
      fs.unlinkSync(SCRIPT);
    }
  } catch (_) {}

  process.exit(0);
}
if (args.uninstall) {
  if (PLATFORM === 'darwin') uninstallMacOS();
  else if (PLATFORM === 'linux') uninstallLinux();
  else if (PLATFORM === 'win32') uninstallWindows();
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  console.log('✅ Uninstalled');

  // Self-cleanup temporary script if running outside INSTALL_DIR
  try {
    if (path.resolve(SCRIPT) !== path.resolve(INSTALLED_SCRIPT) && fs.existsSync(SCRIPT)) {
      fs.unlinkSync(SCRIPT);
    }
  } catch (_) {}

  process.exit(0);
}

function ensureInstalledScript() {
  try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    // Always copy latest script over INSTALLED_SCRIPT to overwrite old versions
    try {
      if (path.resolve(SCRIPT) !== path.resolve(INSTALLED_SCRIPT)) {
        fs.copyFileSync(SCRIPT, INSTALLED_SCRIPT);
      }
    } catch (_) {
      try { fs.writeFileSync(INSTALLED_SCRIPT, fs.readFileSync(SCRIPT)); } catch (_) {}
    }
    if (PLATFORM !== 'win32') try { fs.chmodSync(INSTALLED_SCRIPT, 0o755); } catch {}
    
    // Automatically initialize package.json and install ssh2, ws, node-datachannel in the installation folder
    try {
      console.log('📦 Installing dependencies (ssh2, ws, node-datachannel) for relay agent service...');
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
        'ssh2', 'ws', 'node-datachannel'
      ], { cwd: INSTALL_DIR, stdio: 'inherit' });
      if (result.status === 0) {
        console.log('✅ Dependencies installed successfully.');
      } else {
        console.warn('⚠️  npm install returned non-zero status code. WebRTC P2P fallback to WebSocket mode will be used.');
      }
    } catch (npmErr) {
      console.warn('⚠️  Could not automatically install dependencies:', npmErr.message);
      console.warn('   You can install them manually by running: cd ' + INSTALL_DIR + ' && npm install ssh2 ws node-datachannel');
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
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
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
        tcp.on('connect', () => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'connected', connId }));
          }
        });
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
      case 'sftp:cross_server_transfer': handleCrossServerTransfer(ws, msg); break;

      // ── WebRTC Signaling & Relay SSH Provisioning ──
      // ssh:prepare: server sends plaintext SSH config before WebRTC offer arrives or for WebSocket relay apps
      case 'ssh:prepare': {
        preparedSessions.set(msg.connId, msg.sshConfig);
        console.log(`🔐 [Relay SSH] SSH config pre-provisioned for connId=${msg.connId}`);
        if (msg.connId && msg.sshConfig && !sshSessions.has(msg.connId)) {
          handleSshConnect(ws, {
            connId: msg.connId,
            connection: msg.sshConfig,
            cols: msg.sshConfig.cols,
            rows: msg.sshConfig.rows
          });
        }
        break;
      }
      case 'webrtc:offer':         handleWebRtcOffer(ws, msg);         break;
      case 'webrtc:ice-candidate': handleWebRtcCandidate(ws, msg);     break;

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

  if (sshSessions.has(connId)) {
    console.log(`⚠️ [Relay SSH] Session already exists or connecting for connId=${connId}`);
    return;
  }

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

  let resolveReady;
  const readyPromise = new Promise((res) => { resolveReady = res; });
  const sessionEntry = { status: 'connecting', sshClient, connection, readyPromise, stream: null };
  sshSessions.set(connId, sessionEntry);

  sshClient.on('ready', () => {
    console.log(`✅ [${connId}] SSH connected to ${config.host}:${config.port}`);

    sshClient.shell({ term: 'xterm-256color', cols: cols || 120, rows: rows || 30 }, (err, stream) => {
      if (err) {
        sshSessions.delete(connId);
        resolveReady(null);
        ws.send(JSON.stringify({ type: 'ssh:error', connId, error: err.message }));
        return;
      }

      sessionEntry.status = 'ready';
      sessionEntry.stream = stream;
      resolveReady(sessionEntry);

      ws.send(JSON.stringify({ type: 'ssh:connected', connId }));

      const writeOutput = (data) => {
        const str = typeof data === 'string' ? data : data.toString('utf-8');
        const dc = sessionEntry.rtcSshDc;
        if (dc && typeof dc.isOpen === 'function' && dc.isOpen()) {
          try { dc.sendMessage(str); return; } catch (_) {}
        }
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'ssh:data', connId, data: str }));
        }
      };

      stream.on('data', writeOutput);
      if (stream.stderr) stream.stderr.on('data', writeOutput);

      stream.on('close', () => {
        ws.send(JSON.stringify({ type: 'ssh:closed', connId }));
        cleanupSsh(connId);
      });
    });
  });

  sshClient.on('error', (err) => {
    console.error(`✗ [${connId}] SSH error: ${err.message}`);
    sshSessions.delete(connId);
    resolveReady(null);
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

function getSshSession(connId) {
  let session = sshSessions.get(connId);
  if (session?.sshClient) return session;
  if (sshSessions.size === 1) return sshSessions.values().next().value;
  if (sshSessions.size > 1) return Array.from(sshSessions.values()).pop();
  return null;
}

function getUploadEntry(connId, remotePath) {
  const exactKey = `${connId}:${remotePath}`;
  if (activeUploads.has(exactKey)) return { key: exactKey, upload: activeUploads.get(exactKey) };
  for (const [k, v] of activeUploads.entries()) {
    if (k.endsWith(`:${remotePath}`)) return { key: k, upload: v };
  }
  return { key: exactKey, upload: null };
}

// ── SFTP helpers ──────────────────────────────────────────────────────────
/**
 * Returns a cached SFTP client for the given connId.
 * Opens a new SFTP channel only if one is not already open.
 * This avoids exhausting SSH channel limits (max ~10 concurrent channels).
 */
function getSftpClient(connId) {
  return new Promise((resolve, reject) => {
    const session = getSshSession(connId);
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
  const session = getSshSession(msg.connId);
  if (!session?.sshClient) {
    return sendSftpError(ws, msg.connId, new Error('No SSH session'));
  }

  const filePath = msg.path;
  const connId = msg.connId;

  // Batch rapid deletes into a single rm -rf to prevent SSH channel exhaustion
  if (!session.__deleteQueue) {
    session.__deleteQueue = [];
    session.__deleteTimer = null;
  }
  session.__deleteQueue.push(filePath);

  const flushDeletes = (isRetry = false) => {
    const paths = session.__deleteQueue.splice(0);
    if (!paths.length) return;
    const quoted = paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
    const cmd = `rm -rf ${quoted}`;
    session.sshClient.exec(cmd, (err, stream) => {
      if (err) return sendSftpError(ws, connId, err);
      let stderr = '';
      stream.on('data', () => {});
      stream.stderr.on('data', d => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (code === 0) {
          paths.forEach(p => ws.send(JSON.stringify({ type: 'sftp:action_success', connId, action: 'delete', path: p })));
        } else {
          sendSftpError(ws, connId, new Error(stderr.trim() || `Delete failed (exit ${code})`));
        }
      });
    });
  };

  clearTimeout(session.__deleteTimer);
  session.__deleteTimer = setTimeout(flushDeletes, 50);
}

// Active upload streams: key = `${connId}:${remotePath}`
// Each entry: { stream, ws, bytesWritten, initialOffset, ready, pendingChunks, pendingDone }
const activeUploads = new Map();

function writeChunk(ws, connId, key, buf, filename) {
  const upload = activeUploads.get(key);
  if (!upload) return;
  const targetFilename = filename || upload.filename;

  let settled = false;
  const writeTimeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error(`⏰ [relay] SFTP write timeout for ${targetFilename} (${buf.length} bytes) — write callback never fired`);
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
        filename: targetFilename,
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
    filename: msg.filename,
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
    let offset = msg.offset || 0;
    const flags = offset > 0 ? 'r+' : 'w';
    let stream;
    try {
      stream = sftp.createWriteStream(msg.remotePath, { flags, start: offset, autoClose: true });
    } catch (_) {
      offset = 0;
      stream = sftp.createWriteStream(msg.remotePath, { flags: 'w', start: 0, autoClose: true });
    }

    console.log(`📤 [relay] write stream created for ${msg.remotePath}, waiting for 'open' event...`);

    stream.on('error', (err) => {
      if (offset > 0 && (err?.code === 'ENOENT' || err?.code === 2 || err?.message?.toLowerCase().includes('no such file'))) {
        console.warn(`⚠️ [relay] Resume target gone for ${msg.remotePath}, restarting write from byte 0`);
        offset = 0;
        try {
          const freshStream = sftp.createWriteStream(msg.remotePath, { flags: 'w', start: 0, autoClose: true });
          const entry = activeUploads.get(key);
          if (entry) {
            entry.stream = freshStream;
            entry.initialOffset = 0;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'sftp:can_upload', connId: msg.connId, filename: msg.filename, offset: 0 }));
          }
          return;
        } catch (_) {}
      }
      console.error(`Upload stream error for ${msg.remotePath}:`, err.message);
      activeUploads.delete(key);
      sendSftpError(ws, msg.connId, err);
    });

    let completionSent = false;
    let completionTimer = null;
    const sendCompletion = () => {
      if (completionSent) return;
      completionSent = true;
      clearTimeout(completionTimer);
      const currentEntry = activeUploads.get(key);
      if (currentEntry && (currentEntry.stream === stream || !currentEntry.stream)) {
        activeUploads.delete(key);
      }
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

    stream.on('finish', () => {
      console.log(`📤 [relay] Stream finish event for: ${msg.remotePath}`);
      // Set a short timer to give close event a chance to fire first
      if (!completionSent) {
        completionTimer = setTimeout(() => {
          if (!completionSent) {
            console.log(`📤 [relay] Finish fallback (500ms) - sending completion for: ${msg.remotePath}`);
            sendCompletion();
          }
        }, 500);
      }
    });

    const entry = activeUploads.get(key);
    if (!entry) return; // was aborted while we were awaiting

    entry.stream = stream;
    entry.ready = true;
    console.log(`📤 [relay] stream ready for ${msg.remotePath}, pendingChunks=${entry.pendingChunks.length}`);

    // Signal server/browser that relay is ready to receive chunks
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'sftp:can_upload',
        connId: msg.connId,
        filename: msg.filename,
        offset: offset
      }));
    }

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
  const { key, upload } = getUploadEntry(msg.connId, msg.remotePath);
  if (!upload) {
    console.warn(`⚠️ [relay] sftp:upload_chunk — No active upload session for ${msg.remotePath}`);
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
  const { key, upload } = getUploadEntry(msg.connId, msg.remotePath);
  if (!upload) {
    console.warn(`⚠️ [relay] sftp:upload_done — No active upload session for ${msg.remotePath}`);
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
  const { key, upload } = getUploadEntry(msg.connId, msg.remotePath);
  if (upload) {
    if (upload.stream) try { upload.stream.destroy(); } catch (_) {}
    activeUploads.delete(key);
    console.log(`🛑 [relay] Upload aborted and stream destroyed for ${msg.remotePath}`);
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

async function handleCrossServerTransfer(ws, msg) {
  // msg: { connId (dest), srcConnId, srcPath, destPath, action }
  const { connId, srcConnId, srcPath, destPath, action = 'copy' } = msg;
  console.log(`🌐 [relay agent] cross_server_transfer: srcConnId=${srcConnId} destConnId=${connId} srcPath=${srcPath} destPath=${destPath}`);
  console.log(`   sshSessions keys: ${[...sshSessions.keys()].join(', ')}`);
  const srcSession = sshSessions.get(srcConnId);
  const destSession = sshSessions.get(connId);
  console.log(`   srcSession found: ${!!srcSession?.sshClient}  destSession found: ${!!destSession?.sshClient}`);

  if (!srcSession?.sshClient) {
    return ws.send(JSON.stringify({ type: 'sftp:error', connId, message: 'Source connection not active. Please ensure the source server tab is open.' }));
  }
  if (!destSession?.sshClient) {
    return ws.send(JSON.stringify({ type: 'sftp:error', connId, message: 'Destination connection not active.' }));
  }

  const sendProgress = (progress, filename) => {
    try { ws.send(JSON.stringify({ type: 'sftp:progress', connId, action: action === 'cut' ? 'move' : 'copy', filename, progress })); } catch {}
  };
  const sendError = (err) => {
    try { ws.send(JSON.stringify({ type: 'sftp:error', connId, message: typeof err === 'string' ? err : err.message })); } catch {}
  };
  const sendSuccess = () => {
    try {
      ws.send(JSON.stringify({ type: 'sftp:progress', connId, action: action === 'cut' ? 'move' : 'copy', filename: require('path').posix.basename(srcPath), progress: 100 }));
      ws.send(JSON.stringify({ type: 'sftp:action_success', connId, action: action === 'cut' ? 'move' : 'copy', path: destPath }));
    } catch {}
  };

  const filename = require('path').posix.basename(srcPath);
  sendProgress(1, filename);

  // Check if source is a directory
  const isDir = await new Promise((resolve) => {
    srcSession.sshClient.exec(`[ -d ${JSON.stringify(srcPath)} ] && echo DIR || echo FILE`, (err, stream) => {
      if (err) return resolve(false);
      let out = '';
      stream.on('data', d => out += d.toString());
      stream.on('close', () => resolve(out.trim() === 'DIR'));
    });
  });

  const formatMB = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  };

  // Get accurate source size upfront before starting stream (5s timeout — never block transfer)
  const totalBytes = await new Promise((resolve) => {
    const sizeCmd = isDir
      ? `du -sb "${srcPath}" 2>/dev/null | cut -f1`
      : `stat -c%s "${srcPath}" 2>/dev/null || echo 0`;
    const safetyTimeout = setTimeout(() => {
      console.warn('[relay] totalBytes detection timed out — proceeding without size');
      resolve(0);
    }, 5000);
    try {
      srcSession.sshClient.exec(sizeCmd, (err, stream) => {
        if (err) { clearTimeout(safetyTimeout); return resolve(0); }
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.stderr?.on('data', () => {}); // drain stderr so channel can close
        stream.on('close', () => {
          clearTimeout(safetyTimeout);
          const n = parseInt(out.trim(), 10);
          resolve(!isNaN(n) && n > 0 ? n : 0);
        });
        stream.on('error', () => { clearTimeout(safetyTimeout); resolve(0); });
      });
    } catch (e) {
      clearTimeout(safetyTimeout);
      resolve(0);
    }
  });

  let lastProgressTime = 0;
  let lastProgressVal = 0;
  const sendThrottledProgress = (bytesSent, isDone = false) => {
    const now = Date.now();
    const pct = isDone ? 100 : (totalBytes > 0 ? Math.min(98, Math.max(1, Math.round((bytesSent / totalBytes) * 100))) : 50);
    const statusText = totalBytes > 0
      ? `🚀 ${formatMB(bytesSent)} / ${formatMB(totalBytes)}`
      : `🚀 ${formatMB(bytesSent)} transferred`;

    if (isDone || now - lastProgressTime > 250 || Math.abs(pct - lastProgressVal) >= 2) {
      lastProgressTime = now;
      lastProgressVal = pct;
      try {
        ws.send(JSON.stringify({
          type: 'sftp:progress',
          connId,
          action: action === 'cut' ? 'move' : 'copy',
          filename,
          progress: pct,
          status: statusText,
          bytes: bytesSent,
          totalBytes
        }));
      } catch {}
    }
  };

  if (isDir) {
    const cmdSrc = `tar cf - -C ${JSON.stringify(srcPath)} . 2>/dev/null`;
    const cmdDest = `rm -rf ${JSON.stringify(destPath)} && mkdir -p ${JSON.stringify(destPath)} && tar xf - -C ${JSON.stringify(destPath)} 2>/dev/null`;

    srcSession.sshClient.exec(cmdSrc, (err, srcStream) => {
      if (err) return sendError(err);
      destSession.sshClient.exec(cmdDest, (err2, destStream) => {
        if (err2) { srcStream.destroy(); return sendError(err2); }

        // Drain stderr on both sides to avoid buffer deadlocks
        srcStream.stderr?.on('data', () => {});
        destStream.stderr?.on('data', () => {});

        srcStream.pipe(destStream);
        sendThrottledProgress(0);

        let bytesSent = 0;
        srcStream.on('data', chunk => {
          bytesSent += chunk.length;
          sendThrottledProgress(bytesSent);
        });

        let finished = false;
        let completionTimer = null;

        const doFinish = (isSuccess, errMsg) => {
          if (finished) return;
          finished = true;
          if (completionTimer) clearTimeout(completionTimer);
          try { srcStream.destroy(); } catch {}
          try { destStream.destroy(); } catch {}

          if (isSuccess) {
            sendThrottledProgress(totalBytes > 0 ? totalBytes : bytesSent, true);
            if (action === 'cut') {
              srcSession.sshClient.exec(`rm -rf ${JSON.stringify(srcPath)}`, () => {});
            }
            sendSuccess();
          } else {
            sendError(errMsg || 'Transfer failed');
          }
        };

        // When source finishes reading all tar data, signal EOF to dest and start safety timer
        srcStream.on('end', () => {
          try { destStream.end(); } catch {}
          if (!completionTimer) {
            completionTimer = setTimeout(() => {
              // 4 seconds after source EOF, dest extraction should be complete
              doFinish(true);
            }, 4000);
          }
        });

        srcStream.on('exit', (code) => {
          if (code !== null && code !== undefined && code > 1) {
            doFinish(false, `Source tar exited with code ${code}`);
          }
        });

        destStream.on('exit', (code) => {
          if (code === null || code === undefined || code <= 1) {
            doFinish(true);
          } else {
            doFinish(false, `Destination tar exited with code ${code}`);
          }
        });

        destStream.on('close', () => doFinish(true));
        srcStream.on('error', err => doFinish(false, err));
        destStream.on('error', err => doFinish(false, err));
      });
    });
  } else {
    // File: ensure parent dir exists, then pipe raw bytes
    const cmdSrc = `cat ${JSON.stringify(srcPath)}`;
    const destDir = require('path').posix.dirname(destPath);
    const cmdDest = `mkdir -p ${JSON.stringify(destDir)} && cat > ${JSON.stringify(destPath)}`;

    srcSession.sshClient.exec(cmdSrc, (err, srcStream) => {
      if (err) return sendError(err);
      destSession.sshClient.exec(cmdDest, (err2, destStream) => {
        if (err2) { srcStream.destroy(); return sendError(err2); }

        srcStream.stderr?.on('data', () => {});
        destStream.stderr?.on('data', () => {});

        srcStream.pipe(destStream);
        sendThrottledProgress(0);

        let bytesSent = 0;
        srcStream.on('data', chunk => {
          bytesSent += chunk.length;
          sendThrottledProgress(bytesSent);
        });

        let finished = false;
        let completionTimer = null;

        const doFinish = (isSuccess, errMsg) => {
          if (finished) return;
          finished = true;
          if (completionTimer) clearTimeout(completionTimer);
          try { srcStream.destroy(); } catch {}
          try { destStream.destroy(); } catch {}

          if (isSuccess) {
            sendThrottledProgress(totalBytes > 0 ? totalBytes : bytesSent, true);
            if (action === 'cut') {
              srcSession.sshClient.exec(`rm -f ${JSON.stringify(srcPath)}`, () => {});
            }
            sendSuccess();
          } else {
            sendError(errMsg || 'File transfer failed');
          }
        };

        srcStream.on('end', () => {
          try { destStream.end(); } catch {}
          if (!completionTimer) {
            completionTimer = setTimeout(() => {
              doFinish(true);
            }, 3000);
          }
        });

        destStream.on('exit', (code) => {
          if (code === null || code === undefined || code === 0) {
            doFinish(true);
          } else {
            doFinish(false, `File write exited with code ${code}`);
          }
        });

        destStream.on('close', () => doFinish(true));
        srcStream.on('error', err => doFinish(false, err));
        destStream.on('error', err => doFinish(false, err));
      });
    });
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
        ws.send(JSON.stringify({ type: 'sftp:file_base64', connId: msg.connId, path: msg.path, content: Buffer.concat(chunks).toString('base64') }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpExtract(ws, msg) {
  try {
    const session = getSshSession(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));

    const archivePath = msg.path;
    const type = msg.archiveType || msg.type; // use archiveType passed from server.js to avoid overriding message type
    const targetDir = path.posix.dirname(archivePath);
    const filename = path.posix.basename(archivePath);
    const cleanupArchive = msg.cleanupArchive;

    // Build the single command that performs detection, execution, and fallbacks at shell level
    let extractCmd;
    if (type === 'zip') {
      extractCmd = `if command -v unzip >/dev/null; then unzip -o "${archivePath}" -d "${targetDir}" </dev/null; elif command -v python3 >/dev/null; then python3 -c "import zipfile; zipfile.ZipFile('${archivePath}').extractall('${targetDir}')"; else echo "Neither 'unzip' nor 'python3' command found on the remote server." >&2; exit 127; fi`;
    } else {
      const isGzip = archivePath.endsWith('.gz') || archivePath.endsWith('.tgz');
      extractCmd = `if command -v tar >/dev/null; then tar -xv${isGzip ? 'z' : ''}f "${archivePath}" -C "${targetDir}" </dev/null; else echo "'tar' command not found on the remote server." >&2; exit 127; fi`;
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

    const runExtraction = (attempt = 1) => {
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
          // Exit code 0, 1, or 2 are treated as success if stdout was produced (indicating some extraction happened)
          // unzip returns 1 for warnings (e.g. success with minor warnings). tar returns 1 or 2 on some warnings.
          const wasSuccessful = code === 0 || ((code === 1 || code === 2) && extractedCount > 0);

          if (!wasSuccessful && attempt === 1) {
            console.warn(`⚠️ [relay] Extract attempt 1 failed (${stderr.trim() || `Exit code ${code}`}). Retrying in 400ms after file flush...`);
            setTimeout(() => runExtraction(2), 400);
            return;
          }

          if (!wasSuccessful) {
            return sendSftpError(ws, msg.connId, new Error(`Extract failed: ${stderr.trim() || `Exit code ${code}`}`));
          }

          if (cleanupArchive) {
            session.sshClient.exec(`rm -f "${archivePath}"`, (rmErr, rmStream) => {
              if (!rmErr && rmStream) rmStream.resume();
            });
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
    };

    runExtraction(1);
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

// ── WebRTC Signaling & P2P Handlers ─────────────────────────────────────
// ── WebRTC P2P handlers ──────────────────────────────────────────────────

function handleWebRtcOffer(ws, msg) {
  if (!ndc) {
    console.log('ℹ️ [WebRTC] node-datachannel not available — WebSocket relay transport will be used');
    return;
  }
  const { connId, sdp } = msg;
  if (!preparedSessions.has(connId) && !sshSessions.has(connId)) {
    console.warn(`⚠️ [WebRTC] Rejected unauthorized WebRTC P2P offer for unknown connId=${connId}`);
    try { ws.send(JSON.stringify({ type: 'webrtc:answer', connId, error: 'Unauthorized session' })); } catch {}
    return;
  }
  console.log(`📡 [WebRTC] Received P2P offer for connId=${connId}`);

  try {
    const peer = new ndc.PeerConnection(connId, {
      iceServers: [
        { hostname: 'stun.l.google.com',  port: 19302 },
        { hostname: 'stun1.l.google.com', port: 19302 },
      ],
    });

    activeRtcPeers.set(connId, peer);

    // Relay → browser: forward local SDP (answer) via server WebSocket
    peer.onLocalDescription((localSdp, type) => {
      try {
        ws.send(JSON.stringify({ type: 'webrtc:answer', connId, sdp: { type, sdp: localSdp } }));
        console.log(`📡 [WebRTC] Sent answer for connId=${connId}`);
      } catch {}
    });

    // Relay → browser: forward ICE candidates via server WebSocket
    peer.onLocalCandidate((candidate, sdpMid) => {
      try {
        ws.send(JSON.stringify({ type: 'webrtc:ice-candidate', connId, candidate: { candidate, sdpMid, sdpMLineIndex: 0 } }));
      } catch {}
    });

    // Handle DataChannels opened by the browser
    peer.onDataChannel((dc) => {
      const label = dc.getLabel();
      console.log(`📡 [WebRTC] DataChannel opened: '${label}' for connId=${connId}`);
      if      (label === 'control') setupControlChannel(ws, connId, peer, dc);
      else if (label === 'ssh')     setupSshChannel(connId, dc);
      else if (label === 'sftp')    setupSftpChannel(connId, dc);
      else if (label === 'file')    setupFileChannel(connId, dc);
    });

    // Set remote offer — triggers local answer generation
    peer.setRemoteDescription(sdp.sdp, sdp.type);

  } catch (err) {
    console.error(`❌ [WebRTC] handleWebRtcOffer error: ${err.message}`);
    // Notify browser to fallback
    try { ws.send(JSON.stringify({ type: 'webrtc:answer', connId, error: err.message })); } catch {}
  }
}

function handleWebRtcCandidate(ws, msg) {
  const peer = activeRtcPeers.get(msg.connId);
  if (!peer) return;
  try {
    const c = msg.candidate;
    if (c?.candidate) {
      peer.addRemoteCandidate(c.candidate, c.sdpMid || '0');
    }
  } catch (err) {
    console.warn(`⚠️ [WebRTC] addRemoteCandidate error: ${err.message}`);
  }
}

// ── Control DataChannel ───────────────────────────────────────────────────
function setupControlChannel(ws, connId, peer, dc) {
  const sendControl = (obj) => {
    try { if (dc.isOpen()) dc.sendMessage(JSON.stringify(obj)); } catch {}
  };

  dc.onMessage(async (raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'ssh:start': {
        // Use pre-provisioned SSH config (credentials never sent over DataChannel)
        const sshConfig = preparedSessions.get(connId) || msg.sshConfig;
        if (!sshConfig && !sshSessions.has(connId)) {
          sendControl({ type: 'ssh:error', connId, error: 'No SSH config provisioned for this session' });
          return;
        }
        if (sshConfig) preparedSessions.delete(connId);

        let existingSession = sshSessions.get(connId);
        if (existingSession?.status === 'connecting' && existingSession.readyPromise) {
          console.log(`⏳ [WebRTC][${connId}] Awaiting in-flight SSH connection for P2P DataChannel...`);
          existingSession = await existingSession.readyPromise;
        }

        if (existingSession?.stream) {
          console.log(`♻️ [WebRTC][${connId}] Reusing existing WebSocket relay SSH session for P2P DataChannel`);

          // Attach the WebRTC ssh DataChannel as the output target
          const rtcPeer = activeRtcPeers.get(connId);
          const sshDc = rtcPeer?._sshDc;
          existingSession.rtcSshDc = sshDc || existingSession.rtcSshDc;

          // Re-wire output: clear old WebSocket listeners, route SSH data → DataChannel
          existingSession.stream.removeAllListeners('data');
          if (existingSession.stream.stderr) existingSession.stream.stderr.removeAllListeners('data');

          const writeToRtc = (data) => {
            const session = sshSessions.get(connId);
            const str = typeof data === 'string' ? data : data.toString('utf-8');
            const dc = session?.rtcSshDc;
            if (dc && typeof dc.isOpen === 'function' && dc.isOpen()) {
              try { dc.sendMessage(str); return; } catch (_) {}
            }
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'ssh:data', connId, data: str }));
            }
          };
          existingSession.stream.on('data', writeToRtc);
          if (existingSession.stream.stderr) existingSession.stream.stderr.on('data', writeToRtc);

          existingSession.stream.once('close', () => {
            sendControl({ type: 'ssh:closed', connId });
            cleanupSsh(connId);
          });

          sendControl({ type: 'ssh:connected', connId });
        } else if (!existingSession) {
          // No existing session — open a fresh P2P SSH connection
          startSshP2P(connId, sshConfig, sendControl);
        }
        break;
      }
      case 'ssh:resize': {
        const session = sshSessions.get(connId);
        if (session?.stream) {
          try { session.stream.setWindow(msg.rows || 24, msg.cols || 80, 0, 0); } catch {}
        }
        break;
      }
      case 'ssh:disconnect': {
        cleanupSsh(connId);
        break;
      }
      case 'sftp:cmd': {
        // Route SFTP command to the SFTP session for this connId
        handleSftpP2PCommand(connId, msg, sendControl);
        break;
      }
      case 'docker:command': {
        handleDockerCommand({ send: (dataStr) => {
          try {
            const parsed = JSON.parse(dataStr);
            sendControl(parsed);
          } catch {}
        }}, { ...msg, connId });
        break;
      }
      case 'file:upload:start': {
        handleFileUploadStart(connId, msg, sendControl);
        break;
      }
      case 'file:upload:done': {
        handleFileUploadDone(connId, msg, sendControl);
        break;
      }
      case 'file:upload:cancel': {
        const up = activeUploads.get(`rtc:${connId}`);
        if (up) { try { up.stream.destroy(); } catch {} activeUploads.delete(`rtc:${connId}`); }
        break;
      }
      case 'file:download:start': {
        handleFileDownloadStart(connId, msg, sendControl);
        break;
      }
      case 'file:download:cancel': {
        const dl = activeDownloads.get(`rtc:${connId}`);
        if (dl) { try { dl.stream.destroy(); } catch {} activeDownloads.delete(`rtc:${connId}`); }
        break;
      }
    }
  });

  dc.onClosed(() => {
    console.log(`📡 [WebRTC] control channel closed for connId=${connId}`);
    cleanupSsh(connId);
    const rtcPeer = activeRtcPeers.get(connId);
    if (rtcPeer) { try { rtcPeer.close(); } catch {} activeRtcPeers.delete(connId); }
    preparedSessions.delete(connId);
  });
}

// ── SSH DataChannel ───────────────────────────────────────────────────────
function setupSshChannel(connId, dc) {
  const rtcPeer = activeRtcPeers.get(connId);
  if (rtcPeer) rtcPeer._sshDc = dc;

  // SSH channel carries raw terminal I/O
  dc.onMessage((raw) => {
    const session = sshSessions.get(connId);
    if (session?.stream?.writable) {
      const data = typeof raw === 'string' ? raw : raw.toString('utf-8');
      session.stream.write(data);
    }
  });

  dc.onClosed(() => {
    console.log(`📡 [WebRTC] ssh channel closed for connId=${connId}`);
  });

  // Attach this DataChannel as output target for SSH data from remote if session already exists
  const session = sshSessions.get(connId);
  if (session) session.rtcSshDc = dc;
}

// Start SSH session that writes output to WebRTC DataChannel instead of WebSocket
function startSshP2P(connId, connection, sendControl) {
  if (!ssh2) {
    sendControl({ type: 'ssh:error', connId, error: 'ssh2 not installed on relay agent' });
    return;
  }
  if (sshSessions.has(connId) && sshSessions.get(connId)?.stream) {
    console.log(`⚠️ [P2P SSH] Active session already exists for connId=${connId}`);
    return;
  }

  const config = {
    host:              connection.host,
    port:              connection.port || 22,
    username:          connection.username || 'root',
    readyTimeout:      15000,
    keepaliveInterval: 10000,
  };
  if (connection.password)   config.password   = connection.password;
  if (connection.privateKey) config.privateKey = connection.privateKey;
  if (connection.passphrase) config.passphrase = connection.passphrase;

  const sshClient = new ssh2.Client();

  sshClient.on('ready', () => {
    console.log(`✅ [P2P SSH][${connId}] Connected to ${config.host}:${config.port}`);

    sshClient.shell(
      { term: 'xterm-256color', cols: connection.cols || 80, rows: connection.rows || 24 },
      (err, stream) => {
        if (err) {
          sendControl({ type: 'ssh:error', connId, error: err.message });
          return;
        }

        const rtcPeer = activeRtcPeers.get(connId);
        // Store session (same map as WebSocket path)
        sshSessions.set(connId, { sshClient, stream, connection, rtcSshDc: rtcPeer?._sshDc || null });
        sendControl({ type: 'ssh:connected', connId });

        // SSH output → WebRTC ssh DataChannel (or WebSocket fallback)
        const writeToRtc = (data) => {
          const session = sshSessions.get(connId);
          const str = typeof data === 'string' ? data : data.toString('utf-8');
          const dc = session?.rtcSshDc;
          if (dc && typeof dc.isOpen === 'function' && dc.isOpen()) {
            try { dc.sendMessage(str); return; } catch (_) {}
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'ssh:data', connId, data: str }));
          }
        };

        stream.on('data', writeToRtc);
        stream.stderr.on('data', writeToRtc);
        stream.on('close', () => {
          sendControl({ type: 'ssh:closed', connId });
          cleanupSsh(connId);
        });
      }
    );
  });

  sshClient.on('error', (err) => {
    console.error(`✗ [P2P SSH][${connId}] Error: ${err.message}`);
    sendControl({ type: 'ssh:error', connId, error: err.message });
    cleanupSsh(connId);
  });

  sshClient.on('close', () => cleanupSsh(connId));
  sshClient.connect(config);
}

// ── SFTP DataChannel ──────────────────────────────────────────────────────
// Map: connId → { sftp, sshClient }
const sftpP2PSessions = new Map();

function setupSftpChannel(connId, dc) {
  // SFTP channel carries JSON request/response
  dc.onMessage((raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
    handleSftpP2PCommand(connId, msg, (resp) => {
      try { if (dc.isOpen()) dc.sendMessage(JSON.stringify(resp)); } catch {}
    });
  });
}

function handleSftpP2PCommand(connId, msg, reply) {
  // Reuse existing SSH session's SFTP subsystem
  const session = sshSessions.get(connId);
  if (!session?.sshClient) {
    reply({ type: 'sftp:error', connId, id: msg.id, error: 'SSH not connected' });
    return;
  }

  const sftpCached = sftpP2PSessions.get(connId);
  const doSftp = (sftp) => {
    const { id, cmd } = msg;
    switch (cmd) {
      case 'list':
        sftp.readdir(msg.path || '.', (err, list) => {
          if (err) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
          const files = list.map(f => ({
            filename: f.filename,
            longname: f.longname,
            attrs: f.attrs,
          }));
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path, files } });
        });
        break;
      case 'readFile':
        sftp.readFile(msg.path, (err, data) => {
          if (err) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path, content: data.toString('utf-8') } });
        });
        break;
      case 'writeFile':
        sftp.writeFile(msg.path, Buffer.from(msg.content || ''), (err) => {
          if (err) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path } });
        });
        break;
      case 'mkdir':
        sftp.mkdir(msg.path, (err) => {
          if (err && err.code !== 4 /* FAILURE = already exists */) {
            reply({ type: 'sftp:error', connId, id, error: err.message }); return;
          }
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path } });
        });
        break;
      case 'delete':
        sftp.unlink(msg.path, (err) => {
          if (err) sftp.rmdir(msg.path, (e2) => {
            if (e2) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
            reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path } });
          }); else
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path } });
        });
        break;
      case 'rename':
        sftp.rename(msg.src, msg.dest, (err) => {
          if (err) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
          reply({ type: 'sftp:result', connId, id, cmd, data: { src: msg.src, dest: msg.dest } });
        });
        break;
      case 'stat':
        sftp.stat(msg.path, (err, attrs) => {
          if (err) { reply({ type: 'sftp:error', connId, id, error: err.message }); return; }
          reply({ type: 'sftp:result', connId, id, cmd, data: { path: msg.path, attrs } });
        });
        break;
      default:
        reply({ type: 'sftp:error', connId, id, error: `Unknown SFTP command: ${cmd}` });
    }
  };

  if (sftpCached) {
    doSftp(sftpCached);
  } else {
    session.sshClient.sftp((err, sftp) => {
      if (err) { reply({ type: 'sftp:error', connId, id: msg.id, error: err.message }); return; }
      sftpP2PSessions.set(connId, sftp);
      sftp.on('close', () => sftpP2PSessions.delete(connId));
      doSftp(sftp);
    });
  }
}

// ── File DataChannel ──────────────────────────────────────────────────────
// Map: rtc:connId → { writeStream, hash, filename, destPath, received }
const activeDownloads = activeUploads instanceof Map ? new Map() : new Map(); // separate from sftp uploads
// (activeUploads is already declared above for WebSocket uploads)

function setupFileChannel(connId, dc) {
  // File channel carries raw binary upload chunks from browser
  // Store reference on peer so downloads can write back via this channel
  const rtcPeer = activeRtcPeers.get(connId);
  if (rtcPeer) rtcPeer._fileDc = dc;
  dc.onMessage((raw) => {
    const upload = activeUploads.get(`rtc:${connId}`);
    if (!upload) return; // no active upload for this connId

    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(
      raw instanceof ArrayBuffer ? new Uint8Array(raw) :
      typeof raw === 'string'     ? raw : new Uint8Array(raw)
    );

    upload.stream.write(chunk);
    upload.hash.update(chunk);
    upload.received += chunk.length;

    // Acknowledge progress back over control channel
    if (upload.sendControl) {
      upload.sendControl({
        type: 'file:upload:progress',
        connId,
        filename: upload.filename,
        received: upload.received,
        total: upload.size,
      });
    }
  });

  dc.onClosed(() => {
    console.log(`📡 [WebRTC] file channel closed for connId=${connId}`);
    const upload = activeUploads.get(`rtc:${connId}`);
    if (upload) { try { upload.stream.destroy(); } catch {} activeUploads.delete(`rtc:${connId}`); }
  });
}

function handleFileUploadStart(connId, msg, sendControl) {
  const { filename, destPath, size, offset = 0 } = msg;
  console.log(`📤 [P2P] Upload start: ${filename} → ${destPath} (${size} bytes, offset=${offset})`);

  // Clean up any previous upload for this connId
  const prev = activeUploads.get(`rtc:${connId}`);
  if (prev) { try { prev.stream.destroy(); } catch {} }

  let writeStream;
  try {
    // Ensure directory exists
    const dir = require('path').dirname(destPath);
    require('fs').mkdirSync(dir, { recursive: true });
    writeStream = require('fs').createWriteStream(destPath, { flags: offset > 0 ? 'r+' : 'w', start: offset });
  } catch (err) {
    sendControl({ type: 'file:upload:error', connId, filename, error: err.message });
    return;
  }

  const hash = crypto.createHash('sha256');
  activeUploads.set(`rtc:${connId}`, { stream: writeStream, hash, filename, destPath, size, received: offset, sendControl });

  writeStream.on('error', (err) => {
    sendControl({ type: 'file:upload:error', connId, filename, error: err.message });
    activeUploads.delete(`rtc:${connId}`);
  });

  sendControl({ type: 'file:upload:ready', connId, filename, offset });
}

function handleFileUploadDone(connId, msg, sendControl) {
  const upload = activeUploads.get(`rtc:${connId}`);
  if (!upload) {
    sendControl({ type: 'file:upload:error', connId, filename: msg.filename, error: 'No active upload' });
    return;
  }

  upload.stream.end(() => {
    const sha256 = upload.hash.digest('hex');
    console.log(`✅ [P2P] Upload complete: ${upload.filename} sha256=${sha256}`);
    sendControl({ type: 'file:upload:complete', connId, filename: upload.filename, sha256 });
    activeUploads.delete(`rtc:${connId}`);
  });
}

function handleFileDownloadStart(connId, msg, sendControl) {
  const { path: remotePath } = msg;
  console.log(`📥 [P2P] Download start: ${remotePath}`);

  // We need the ssh/sftp DataChannel to write binary to — get it from the peer
  const rtcPeer = activeRtcPeers.get(connId);
  if (!rtcPeer) {
    sendControl({ type: 'file:download:error', connId, error: 'No active WebRTC peer' });
    return;
  }

  let fileStat;
  try { fileStat = require('fs').statSync(remotePath); } catch {
    // Try SFTP session path
    const sftpSession = sftpP2PSessions.get(connId);
    if (sftpSession) {
      sftpSession.stat(remotePath, (err, attrs) => {
        if (err) { sendControl({ type: 'file:download:error', connId, error: err.message }); return; }
        const size = attrs.size;
        const filename = require('path').basename(remotePath);
        sendControl({ type: 'file:download:meta', connId, path: remotePath, filename, size });
        streamFileToRtcPeer(connId, remotePath, size, rtcPeer, sendControl, sftpSession);
      });
    } else {
      sendControl({ type: 'file:download:error', connId, error: `Cannot stat: ${remotePath}` });
    }
    return;
  }

  const size = fileStat.size;
  const filename = require('path').basename(remotePath);
  sendControl({ type: 'file:download:meta', connId, path: remotePath, filename, size });
  streamFileToRtcPeer(connId, remotePath, size, rtcPeer, sendControl, null);
}

function streamFileToRtcPeer(connId, remotePath, size, rtcPeer, sendControl, sftpSession) {
  const hash = crypto.createHash('sha256');
  let sent = 0;

  // Get the file DataChannel from the peer
  // node-datachannel doesn't expose channels by label after creation,
  // so we store a reference when setupFileChannel is called
  // Instead, we use a stored reference in rtcPeer._fileDc set by setupFileChannel
  const fileDc = rtcPeer._fileDc;
  if (!fileDc || !fileDc.isOpen()) {
    sendControl({ type: 'file:download:error', connId, error: 'File DataChannel not open' });
    return;
  }

  const readStream = sftpSession
    ? sftpSession.createReadStream(remotePath, { highWaterMark: 512 * 1024 })
    : require('fs').createReadStream(remotePath, { highWaterMark: 512 * 1024 });

  activeDownloads.set(`rtc:${connId}`, { stream: readStream });

  readStream.on('data', (chunk) => {
    hash.update(chunk);
    sent += chunk.length;
    // Backpressure: if buffered amount is high, pause and wait
    try {
      fileDc.sendMessageBinary(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    } catch (err) {
      console.error(`❌ [P2P] file download send error: ${err.message}`);
      readStream.destroy();
    }
  });

  readStream.on('end', () => {
    const sha256 = hash.digest('hex');
    console.log(`✅ [P2P] Download complete: ${remotePath} sha256=${sha256}`);
    sendControl({ type: 'file:download:done', connId, path: remotePath, sha256 });
    activeDownloads.delete(`rtc:${connId}`);
  });

  readStream.on('error', (err) => {
    sendControl({ type: 'file:download:error', connId, error: err.message });
    activeDownloads.delete(`rtc:${connId}`);
  });
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
    const isRaw = cmdSuffix.startsWith('sh -c') || cmdSuffix.startsWith('(');
    const escapedPass = (connection.password || '').replace(/'/g, "'\\''");
    const prefix = attemptWithSudo ? `echo '${escapedPass}' | sudo -S su root -c ` : '';
    const finalCmd = attemptWithSudo
      ? (isRaw ? `${prefix} '${cmdSuffix.replace(/'/g, "'\\''")}'` : `${prefix} 'docker ${cmdSuffix.replace(/'/g, "'\\''")}'`)
      : (isRaw ? cmdSuffix : `docker ${cmdSuffix}`);

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
    } else if (action === 'swarm:services') {
      cmdSuffix = `service ls --format "{{json .}}" 2>/dev/null || echo ""`;
    } else if (action === 'swarm:inspect' && args.length >= 1) {
      const svcNameI = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!svcNameI) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Service Name' }));
      cmdSuffix = `service inspect ${svcNameI} --format "{{json .}}"`;
    } else if (action === 'swarm:nodes') {
      cmdSuffix = `node ls --format "{{json .}}" 2>/dev/null || echo ""`;
    } else if (action === 'swarm:orphans') {
      // List all containers + listening ports for conflict detection before swarm leave
      return runRawCmd(`sh -c 'echo "CONTAINERS:"; docker ps -a --format "{{json .}}" 2>/dev/null; echo "PORTS:"; { ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null; } | grep -oE "[0-9]+\\$" | sort -un'`);
    } else if (action === 'swarm:leave') {
      return runRawCmd(`sh -c 'docker swarm leave --force 2>&1; docker compose down --remove-orphans 2>/dev/null || true; docker container prune -f 2>/dev/null || true; docker network create proxy-net 2>/dev/null || true; echo "LEFT_SWARM"'`);
    } else if (action === 'swarm:init') {
      // args[0] = optional advertise-addr (e.g. "192.168.1.10" or "eth0")
      const advertiseAddr = args && args[0] ? String(args[0]).replace(/[^a-zA-Z0-9.:_/-]/g, '') : '';
      const advertiseFlag = advertiseAddr ? `--advertise-addr ${advertiseAddr}` : '';
      // Use sh -c so shell operators work; always exits 0 (already-in-swarm is OK)
      return runRawCmd(`sh -c 'docker swarm init ${advertiseFlag} 2>&1; STATUS=$?; if [ $STATUS -eq 0 ]; then docker swarm update --task-history-limit 1 2>/dev/null || true; fi; exit 0'`);
    } else if (action === 'swarm:create') {
      const svcName      = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const image        = String(args[1] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      const replicas     = parseInt(args[2], 10) || 2;
      const port         = String(args[3] || '').replace(/[^0-9:]/g, '');
      const network      = String(args[4] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const rawEnv       = String(args[5] || '');
      const rawMounts    = String(args[6] || '');
      const oldContId    = String(args[7] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const composeProj  = String(args[8] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!svcName || !image)
        return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid service name or image' }));

      let flags = [`--name ${svcName}`, `--replicas ${replicas}`, `--update-order start-first`, `--update-delay 5s`];
      const baseAlias = svcName.toLowerCase();
      if (baseAlias) {
        flags.push(`--network-alias ${baseAlias}`);
        if (baseAlias.includes('_')) flags.push(`--network-alias ${baseAlias.replace(/_/g, '-')}`);
        if (baseAlias.includes('-')) flags.push(`--network-alias ${baseAlias.replace(/-/g, '_')}`);
      }
      if (port) {
        const p = port.includes(':') ? port : `${port}:${port}`;
        flags.push(`--publish ${p}`);
      }
      if (network) {
        flags.push(`--network $target_net`);
      }
      if (rawEnv) {
        flags.push(...parseEnvFlags(rawEnv, '--env'));
      }
      if (rawMounts) {
        rawMounts.split(',').forEach(m => {
          const parts = m.trim().split(':');
          if (parts.length >= 2) {
            const src = parts[0].trim().replace(/[^a-zA-Z0-9._/:-]/g, '');
            const target = parts[1].trim().replace(/[^a-zA-Z0-9._/:-]/g, '');
            if (src && target) {
              const type = src.startsWith('/') ? 'bind' : 'volume';
              flags.push(`--mount type=${type},source=${src},target=${target}`);
            }
          }
        });
      }
      const effectiveNetwork = network || 'swarm-net';
      if (!network) {
        flags.push(`--network $target_net`);
      }
      const createCmd = `docker service create ${flags.join(' ')} ${image}`;
      // Stop+rm old container first (frees the name for the Swarm service)
      const stopRmCmd = oldContId
        ? `echo "Stopping old container ${oldContId}..."; docker stop ${oldContId} 2>/dev/null || true; echo "Removing old container ${oldContId}..."; docker rm ${oldContId} 2>/dev/null || true; `
        : '';
      // Auto-convert all compose siblings and database containers into Swarm services (databases always --replicas 1)
      const siblingCmd = `for c in $(docker ps -aq 2>/dev/null); do cp=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' $c 2>/dev/null); cs=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' $c 2>/dev/null); cn=$(docker inspect --format "{{.Name}}" $c 2>/dev/null | sed 's/^\\///'); c_img=$(docker inspect --format "{{.Config.Image}}" $c 2>/dev/null); c_mounts=$(docker inspect --format '{{range .Mounts}}--mount type={{.Type}},source={{.Source}},target={{.Destination}} {{end}}' $c 2>/dev/null); c_envs=$(docker inspect --format '{{range .Config.Env}}--env "{{.}}" {{end}}' $c 2>/dev/null); svc_target="\${cs:-\$cn}"; [ -z "$svc_target" ] || [ -z "$c_img" ] && continue; is_db=false; echo "$cn $c_img $svc_target" | grep -qiE "mongo|redis|postgres|mysql|mariadb|memcached" && is_db=true; svc_replicas=1; [ "$is_db" = "false" ] && svc_replicas=2; is_match=false; [ -n "${composeProj}" ] && [ "$cp" = "${composeProj}" ] && [ "$cn" != "${oldContId}" ] && [ "$cn" != "${svcName}" ] && is_match=true; [ "$is_db" = "true" ] && [ "$cn" != "${oldContId}" ] && [ "$cn" != "${svcName}" ] && is_match=true; if [ "$is_match" = "true" ]; then if ! docker service inspect "$svc_target" >/dev/null 2>&1 && ! docker service inspect "$cn" >/dev/null 2>&1; then echo "Converting sibling $cn into Swarm service $svc_target (replicas=$svc_replicas)..."; alias_flags="--network-alias $svc_target"; [ -n "$cn" ] && [ "$cn" != "$svc_target" ] && alias_flags="$alias_flags --network-alias $cn"; [ -n "$cs" ] && [ "$cs" != "$svc_target" ] && alias_flags="$alias_flags --network-alias $cs"; echo "$cn $svc_target" | grep -qi "mongo" && alias_flags="$alias_flags --network-alias mongo --network-alias mongodb"; echo "$cn $svc_target" | grep -qi "redis" && alias_flags="$alias_flags --network-alias redis"; echo "$cn $svc_target" | grep -qi "postgres" && alias_flags="$alias_flags --network-alias postgres --network-alias postgresql"; echo "$cn $svc_target" | grep -qiE "mysql|mariadb" && alias_flags="$alias_flags --network-alias mysql --network-alias mariadb"; extra_nets=""; for net in $(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $c 2>/dev/null); do if [ "$net" != "bridge" ] && [ "$net" != "host" ] && [ "$net" != "none" ] && [ "$net" != "$target_net" ]; then driver=$(docker network inspect "$net" --format "{{.Driver}}" 2>/dev/null); if [ "$driver" = "overlay" ]; then extra_nets="$extra_nets --network $net"; fi; fi; done; docker stop $c 2>/dev/null || true; docker rm $c 2>/dev/null || true; docker service create --name "$svc_target" --replicas $svc_replicas --network "$target_net" $extra_nets $alias_flags $c_mounts $c_envs "$c_img" 2>/dev/null || true; fi; fi; done; `;
      return runRawCmd(`sh -c '${stopRmCmd}target_net="${effectiveNetwork}"; driver=$(docker network inspect ${effectiveNetwork} --format "{{.Driver}}" 2>/dev/null); if [ "$driver" = "overlay" ]; then echo "Using overlay network ${effectiveNetwork}"; elif [ -z "$driver" ]; then echo "Creating overlay network ${effectiveNetwork}..."; docker network create --driver overlay --attachable ${effectiveNetwork}; elif [ "$driver" = "bridge" ]; then count=$(docker network inspect ${effectiveNetwork} --format "{{len .Containers}}" 2>/dev/null); if [ "$count" = "0" ] || [ -z "$count" ]; then echo "Converting unused bridge to overlay..."; docker network rm ${effectiveNetwork} >/dev/null 2>&1 && docker network create --driver overlay --attachable ${effectiveNetwork}; else target_net="${effectiveNetwork}-overlay"; echo "Auto-creating overlay network $target_net..."; docker network inspect $target_net >/dev/null 2>&1 || docker network create --driver overlay --attachable $target_net; fi; fi; ${siblingCmd}${createCmd} && (docker network connect $target_net global-nginx 2>/dev/null || docker network connect $target_net nginx 2>/dev/null || true) && (docker restart global-nginx 2>/dev/null || docker exec global-nginx nginx -s reload 2>/dev/null || true) && (docker container prune -f 2>/dev/null || true)'`);
    } else if (action === 'swarm:update' && args.length >= 2) {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const image = String(args[1] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      if (!serviceName || !image) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Swarm Service or Image' }));
      return runRawCmd(`sh -c 'docker service update --image ${image} --update-order start-first --update-parallelism 1 --update-delay 5s --update-monitor 15s --update-failure-action rollback --update-max-failure-ratio 0 --rollback-order start-first --rollback-parallelism 1 --rollback-delay 5s --rollback-monitor 15s ${serviceName} && (docker container prune -f 2>/dev/null || true)'`);
    } else if (action === 'swarm:rollback' && args.length >= 1) {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!serviceName) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Service Name' }));
      cmdSuffix = `service rollback ${serviceName}`;
    } else if (action === 'swarm:scale' && args.length >= 2) {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const count = parseInt(args[1], 10);
      if (!serviceName || isNaN(count) || count < 0) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Scale Parameters' }));
      cmdSuffix = `service scale ${serviceName}=${count}`;
    } else if (action === 'swarm:remove' && args.length >= 1) {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!serviceName) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Service Name' }));
      return runRawCmd(`sh -c 'docker service rm ${serviceName} 2>&1; docker compose down --remove-orphans 2>/dev/null || true; docker container prune -f 2>/dev/null || true'`);
    } else if (action === 'swarm:configure' && args.length >= 1) {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const image       = String(args[1] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      const replicas    = parseInt(args[2], 10);
      const port        = String(args[3] || '').replace(/[^0-9:]/g, '');
      const network     = String(args[4] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const rawEnv      = String(args[5] || '');
      const rawMounts   = String(args[6] || '');
      if (!serviceName) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Service Name' }));

      let updateFlags = ['--update-order start-first'];
      if (image) updateFlags.push(`--image ${image}`);
      if (!isNaN(replicas) && replicas >= 0) updateFlags.push(`--replicas ${replicas}`);
      if (port) {
        const p = port.includes(':') ? port : `${port}:${port}`;
        updateFlags.push(`--publish-add ${p}`);
      }
      if (network) {
        updateFlags.push(`--network-add ${network}`);
      }
      if (rawEnv) {
        rawEnv.split(',').forEach(e => {
          const kv = e.trim().replace(/[^a-zA-Z0-9._=\-]/g, '');
          if (kv.includes('=')) updateFlags.push(`--env-add "${kv}"`);
        });
      }
      if (rawMounts) {
        rawMounts.split(',').forEach(m => {
          const parts = m.trim().split(':');
          if (parts.length >= 2) {
            const src = parts[0].trim().replace(/[^a-zA-Z0-9._/:-]/g, '');
            const target = parts[1].trim().replace(/[^a-zA-Z0-9._/:-]/g, '');
            if (src && target) {
              const type = src.startsWith('/') ? 'bind' : 'volume';
              updateFlags.push(`--mount-add type=${type},source=${src},target=${target}`);
            }
          }
        });
      }
      return runRawCmd(`sh -c 'docker service update ${updateFlags.join(' ')} ${serviceName} && (docker container prune -f 2>/dev/null || true)'`);
    } else if (action === 'rmi' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Image ID' }));
      cmdSuffix = `rmi ${targetId}`;
    } else if (action === 'info') {
      cmdSuffix = `info --format "{{json .}}"`;
    } else if (action === 'logs' && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Container ID' }));
      // docker logs writes to both stdout and stderr — merge with 2>&1 so all output is captured
      cmdSuffix = `logs --tail 200 --timestamps ${targetId} 2>&1`;
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
    } else if (action === 'swarm:build-deploy') {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const image = String(args[1] || '').replace(/[^a-zA-Z0-9.@/:-]/g, '');
      const dir = String(args[2] || '.').replace(/['"$`\\]/g, '');
      const doPull = args[3] !== false;
      if (!serviceName || !image) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Service Name or Image' }));

      const pullStep = doPull ? 'git pull && ' : '';
      const cmd = `cd "${dir}" && ${pullStep}${sudoPrefix}docker build -t ${image} . && ${sudoPrefix}docker service update --image ${image} --update-order start-first --update-parallelism 1 --update-delay 5s --update-monitor 15s --update-failure-action rollback --update-max-failure-ratio 0 --rollback-order start-first --rollback-parallelism 1 --rollback-delay 5s --rollback-monitor 15s ${serviceName}`;
      const safeName = serviceName.replace(/[^a-z0-9]/gi, '_');
      const deployCmd = `sh -c 'rm -f /tmp/deploy_${safeName}.log; touch /tmp/deploy_${safeName}.log; nohup sh -c "(${cmd}) > /tmp/deploy_${safeName}.log 2>&1; echo \\"---FINISHED---\\" >> /tmp/deploy_${safeName}.log" >/dev/null 2>&1 & echo STARTED'`;
      return runRawCmd(deployCmd);
    } else if (action === 'swarm:build-deploy:status') {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const safeName = serviceName.replace(/[^a-z0-9]/gi, '_');
      const statusCmd = `sh -c '(if [ -f "/tmp/deploy_${safeName}.log" ]; then RUNNING=$(ps aux 2>/dev/null | grep -v grep | grep "docker.*${serviceName}" | wc -l); if [ "$RUNNING" = "0" ] && ! grep -q "---FINISHED---" "/tmp/deploy_${safeName}.log"; then echo "---FINISHED---" >> /tmp/deploy_${safeName}.log; fi; tr "\\r" "\\n" < "/tmp/deploy_${safeName}.log" | tail -n 150; else echo "INITIALIZING..."; fi); exit 0'`;
      return runRawCmd(statusCmd);
    } else if (action === 'swarm:get-workdir') {
      const serviceName = String(args[0] || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const getWorkDirCmd = "sh -c 'sName=\"" + serviceName + "\"; cleanName=$(echo \"$sName\" | tr -d \"_-\"); svc_dir=\"\"; if [ -n \"$sName\" ]; then svc_dir=$(docker service inspect \"$sName\" --format \"{{index .Spec.Labels \\\"com.docker.compose.project.working_dir\\\"}}\" 2>/dev/null); [ -z \"$svc_dir\" ] && svc_dir=$(docker service inspect \"$sName\" --format \"{{index .Spec.Labels \\\"project.directory\\\"}}\" 2>/dev/null); if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ]; then cfg=$(docker service inspect \"$sName\" --format \"{{index .Spec.Labels \\\"com.docker.compose.project.config_files\\\"}}\" 2>/dev/null); [ -n \"$cfg\" ] && svc_dir=$(dirname \"$cfg\" 2>/dev/null); fi; if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ]; then for cid in $(docker ps -aq 2>/dev/null); do c_proj=$(docker inspect --format \"{{index .Config.Labels \\\"com.docker.compose.project\\\"}}\" \"$cid\" 2>/dev/null); c_name=$(docker inspect --format \"{{.Name}}\" \"$cid\" 2>/dev/null | sed \"s/^\\///\"); if [ \"$c_name\" = \"$sName\" ] || [ \"$c_proj\" = \"$sName\" ] || [ \"$c_name\" = \"$sName-1\" ] || [ \"$c_name\" = \"$sName.1\" ] || echo \"$c_name\" | grep -qi \"$sName\"; then svc_dir=$(docker inspect --format \"{{index .Config.Labels \\\"com.docker.compose.project.working_dir\\\"}}\" \"$cid\" 2>/dev/null); if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ]; then cfg=$(docker inspect --format \"{{index .Config.Labels \\\"com.docker.compose.project.config_files\\\"}}\" \"$cid\" 2>/dev/null); [ -n \"$cfg\" ] && svc_dir=$(dirname \"$cfg\" 2>/dev/null); fi; if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ]; then b_src=$(docker inspect --format \"{{range .Mounts}}{{if eq .Type \\\"bind\\\"}}{{.Source}} {{end}}{{end}}\" \"$cid\" 2>/dev/null | grep -v \"/var/run\" | cut -d\" \" -f1); if [ -n \"$b_src\" ] && [ -d \"$b_src\" ]; then if [ -f \"$b_src/Dockerfile\" ] || [ -f \"$b_src/package.json\" ]; then svc_dir=\"$b_src\"; elif [ -f \"$(dirname \"$b_src\")/Dockerfile\" ]; then svc_dir=\"$(dirname \"$b_src\")\"; fi; fi; fi; [ -n \"$svc_dir\" ] && [ -d \"$svc_dir\" ] && break; fi; done; fi; if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ] || [ \"$svc_dir\" = \"$HOME\" ]; then found=$(find \"$HOME\" /home /var/www /opt . -maxdepth 4 -type d \\( -iname \"$sName\" -o -iname \"${sName//-/_}\" -o -iname \"${sName//_/-}\" -o -iname \"*$sName*\" \\) 2>/dev/null | head -1); [ -n \"$found\" ] && [ -d \"$found\" ] && svc_dir=$(cd \"$found\" 2>/dev/null && pwd); fi; if [ -z \"$svc_dir\" ] || [ ! -d \"$svc_dir\" ] || [ \"$svc_dir\" = \"$HOME\" ]; then for df in $(find \"$HOME\" /home /var/www /opt . -maxdepth 4 -name \"Dockerfile\" 2>/dev/null); do dir_candidate=$(dirname \"$df\"); c_lower=$(echo \"$dir_candidate\" | tr \"[:upper:]\" \"[:lower:]\" | tr -d \"_-\"); if echo \"$c_lower\" | grep -q \"$cleanName\" || echo \"$cleanName\" | grep -q \"$(basename \"$dir_candidate\" | tr -d \"_-\")\"; then svc_dir=$(cd \"$dir_candidate\" 2>/dev/null && pwd); break; fi; done; fi; fi; if [ \"$svc_dir\" = \"$HOME\" ] && [ ! -f \"$HOME/Dockerfile\" ]; then first_df=$(find \"$HOME\" -maxdepth 3 -name \"Dockerfile\" 2>/dev/null | head -1); [ -n \"$first_df\" ] && svc_dir=$(dirname \"$first_df\"); fi; echo \"WORKDIR:${svc_dir:-$(pwd)}\"'";
      return runRawCmd(getWorkDirCmd);
    } else if (['start', 'stop', 'restart', 'rm'].includes(action) && args.length > 0) {
      const targetId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      if (!targetId) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid Target ID' }));
      cmdSuffix = action === 'rm' ? `rm -f ${targetId}` : `${action} ${targetId}`;
    } else if ((action === 'inspect' || action === 'inspect-for-swarm') && args.length > 0) {
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
      const filePath = String(args[1] || '').replace(/["'`$\\]/g, '');
      if (!containerId || !filePath) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'Invalid read-config args' }));
      return runRawCmd(`${sudoPrefix}docker exec ${containerId} cat "${filePath}"`);
    } else if (action === 'write-config' && args.length >= 3) {
      const containerId = String(args[0] || '').replace(/[^a-zA-Z0-9._/:-]/g, '');
      const filePath = String(args[1] || '').replace(/["'`$\\]/g, '');
      const b64Content = String(args[2] || '').replace(/[^a-zA-Z0-9+/=]/g, '');
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
      if (targets.containers) { cmds.push('container prune -f'); cmds.push('rm -f $(docker ps -a --filter status=exited -q 2>/dev/null)'); }
      if (targets.images) cmds.push(`image prune ${pruneAll ? '-a ' : ''}-f`);
      if (targets.volumes) cmds.push('volume prune -f');
      if (targets.networks) cmds.push('network prune -f');
      if (targets.cache) cmds.push('builder prune -f');
      if (cmds.length === 0) return ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'No targets selected' }));
      cmdSuffix = cmds.join(' && ');
      return runRawCmd(`sh -c '${cmds.map(c => `docker ${c}`).join(' && ')}'`);
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
    } else if (action === 'prune-networks') {
      return runRawCmd(`docker network prune -f`);
    } else if (action === 'clean-exited-swarm') {
      return runRawCmd(`sh -c 'EXITED=$(docker ps -a --filter status=exited -q 2>/dev/null); if [ -n "$EXITED" ]; then echo "Removing exited task containers..."; docker rm -f $EXITED 2>&1; else echo "No exited containers found"; fi; docker container prune -f 2>/dev/null || true'`);
    } else if (action === 'connect-nginx-swarm') {
      return runRawCmd(`sh -c 'NETS=$(docker network ls --filter driver=overlay --format "{{.Name}}"); for net in $NETS; do echo "Connecting Nginx and Database containers to $net..."; docker network connect $net global-nginx 2>/dev/null || docker network connect $net nginx 2>/dev/null || true; docker network connect $net mongo 2>/dev/null || docker network connect $net mongodb 2>/dev/null || true; docker network connect $net redis 2>/dev/null || true; docker network connect $net postgres 2>/dev/null || true; docker network connect $net mysql 2>/dev/null || true; done; docker restart global-nginx 2>/dev/null || docker exec global-nginx nginx -s reload 2>/dev/null || docker exec nginx nginx -s reload 2>/dev/null || true; echo "✅ Connected all containers to Swarm overlay networks!"'`);
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
  // Kill any running old background process and reload launchctl daemon
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
  spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  spawnSync('pkill', ['-f', '[l]ocal-relay'], { stdio: 'ignore' });
  spawnSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' });
  console.log(`✅ Installed as macOS LaunchAgent. Logs: tail -f "${logFile}"`);
}

function uninstallMacOS() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', SVC_ID + '.plist');
  if (fs.existsSync(plistPath)) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    spawnSync('pkill', ['-f', '[l]ocal-relay'], { stdio: 'ignore' });
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
  spawnSync('systemctl', ['--user', 'stop', SVC_ID + '.service'], { stdio: 'ignore' });
  spawnSync('pkill', ['-f', '[l]ocal-relay'], { stdio: 'ignore' });
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
  spawnSync('systemctl', ['--user', 'enable', '--now', SVC_ID + '.service'], { stdio: 'inherit' });
  console.log('✅ Installed as systemd user service');
}

function uninstallLinux() {
  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SVC_ID + '.service');
  spawnSync('systemctl', ['--user', 'stop', SVC_ID + '.service'], { stdio: 'ignore' });
  spawnSync('systemctl', ['--user', 'disable', SVC_ID + '.service'], { stdio: 'ignore' });
  if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  spawnSync('systemctl', ['--user', 'reset-failed'], { stdio: 'ignore' });
  spawnSync('pkill', ['-f', '[l]ocal-relay'], { stdio: 'ignore' });
  console.log('✅ Removed systemd user service');
}

function installWindows() {
  const startupDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const batPath = path.join(startupDir, 'ssh-monitor-relay.bat');
  const vbsPath = path.join(startupDir, 'ssh-monitor-relay.vbs');
  
  // Kill any existing background relay processes on Windows
  try {
    spawnSync('powershell', ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*local-relay.js*' -and $_.ProcessId -ne " + process.pid + " } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' });
  } catch (_) {}

  const vbsContent = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run """" & "${NODE_BIN.replace(/"/g, '""')}" & """ """" & "${INSTALLED_SCRIPT.replace(/"/g, '""')}" & """ --server """ & "${SERVER.replace(/"/g, '""')}" & """ --token """ & "${TOKEN.replace(/"/g, '""')}" & """", 0, False`,
  ].join('\r\n');

  try {
    fs.mkdirSync(startupDir, { recursive: true });
    if (fs.existsSync(batPath)) try { fs.unlinkSync(batPath); } catch (_) {}
    fs.writeFileSync(vbsPath, vbsContent);
    console.log('✅ Installed as Windows Startup background task');
  } catch (e) {
    console.warn('⚠️ Could not write to Startup folder:', e.message);
  }
}

function uninstallWindows() {
  const startupDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const batPath = path.join(startupDir, 'ssh-monitor-relay.bat');
  const vbsPath = path.join(startupDir, 'ssh-monitor-relay.vbs');
  
  try {
    spawnSync('powershell', ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*local-relay.js*' -and $_.ProcessId -ne " + process.pid + " } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' });
  } catch (_) {}

  if (fs.existsSync(batPath)) try { fs.unlinkSync(batPath); } catch (_) {}
  if (fs.existsSync(vbsPath)) try { fs.unlinkSync(vbsPath); } catch (_) {}
  console.log('✅ Removed Windows Startup task');
}

// ── Start ─────────────────────────────────────────────────────────────────
connect();
