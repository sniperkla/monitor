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
let ssh2;
try {
  ssh2 = require('ssh2');
  console.log('✅ ssh2 loaded — SSH/SFTP will run locally');
} catch {
  console.log('ℹ️  ssh2 not found — install with: npm install ssh2');
  console.log('   Falling back to TCP relay mode only');
}

// -- Try to load ws --
let WS;
try {
  WS = require('ws');
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
  try { ws = new WS(wsUrl); } catch (err) {
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

    // ── TCP relay (existing functionality) ──
    if (msg.type === 'ready') {
      // Now send init with capabilities (relay is registered on server)
      ws.send(JSON.stringify({ type: 'init', relayName: RELAY_NAME, capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true } }));
      console.log(`\n✅ Relay ready! Name: ${RELAY_NAME}, Capabilities: SSH=${!!ssh2}, SFTP=${!!ssh2}, Docker=true`);

      // Start local discovery server so browser can auto-detect this relay
      startDiscoveryServer(RELAY_NAME);
    }

    if (msg.type === 'open') {
      const { connId } = msg;
      const tcpHost = msg.host || 'localhost';
      const tcpPort = Number(msg.port) || 22;
      const tcp = net.connect(tcpPort, tcpHost);
      tcp.on('data', (chunk) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', connId, data: chunk.toString('base64') }));
      });
      tcp.on('close', () => { try { ws.send(JSON.stringify({ type: 'close', connId })); } catch {} tcpConnections.delete(connId); });
      tcp.on('error', (err) => { console.error(`✗ [${connId}] TCP error: ${err.message}`); tcp.destroy(); });
      tcpConnections.set(connId, tcp);
    }

    if (msg.type === 'data') {
      const tcp = tcpConnections.get(msg.connId);
      if (tcp && !tcp.destroyed) tcp.write(Buffer.from(msg.data, 'base64'));
    }

    if (msg.type === 'close') {
      const tcp = tcpConnections.get(msg.connId);
      if (tcp) { tcp.destroy(); tcpConnections.delete(msg.connId); }
    }

    // ── SSH session (NEW) ──
    if (msg.type === 'ssh:connect') {
      handleSshConnect(ws, msg);
    }

    if (msg.type === 'ssh:input') {
      const session = sshSessions.get(msg.connId);
      if (session?.stream?.writable) session.stream.write(msg.data);
    }

    if (msg.type === 'ssh:resize') {
      const session = sshSessions.get(msg.connId);
      if (session?.stream) {
        try { session.stream.setWindow(msg.rows, msg.cols, 0, 0); } catch {}
      }
    }

    if (msg.type === 'ssh:exec') {
      handleSshExec(ws, msg);
    }

    if (msg.type === 'ssh:disconnect') {
      cleanupSsh(msg.connId);
    }

    // Server asks relay to stop (user disconnected/revoked from dashboard)
    if (msg.type === 'disconnect') {
      console.log(`\n🛑 Disconnected by server: ${msg.reason || 'Relay disconnected'}`);
      console.log('   Exiting. Run with a new token to reconnect.');
      ws.close(4000, 'disconnect');
      process.exit(0);
    }

    // ── SFTP (NEW) ──
    if (msg.type === 'sftp:list') {
      handleSftpList(ws, msg);
    }

    if (msg.type === 'sftp:readFile') {
      handleSftpRead(ws, msg);
    }

    if (msg.type === 'sftp:writeFile') {
      handleSftpWrite(ws, msg);
    }

    if (msg.type === 'sftp:mkdir') {
      handleSftpMkdir(ws, msg);
    }

    if (msg.type === 'sftp:delete') {
      handleSftpDelete(ws, msg);
    }

    if (msg.type === 'sftp:upload') {
      handleSftpUpload(ws, msg);
    }

    if (msg.type === 'sftp:download') {
      handleSftpDownload(ws, msg);
    }

    if (msg.type === 'sftp:download_folder') {
      handleSftpDownloadFolder(ws, msg);
    }

    if (msg.type === 'sftp:search') {
      handleSftpSearch(ws, msg);
    }

    if (msg.type === 'sftp:getSize') {
      handleSftpGetSize(ws, msg);
    }

    if (msg.type === 'sftp:copy') {
      handleSftpCopy(ws, msg);
    }

    if (msg.type === 'sftp:move') {
      handleSftpMove(ws, msg);
    }

    if (msg.type === 'sftp:readFileBase64') {
      handleSftpReadBase64(ws, msg);
    }

    if (msg.type === 'sftp:extract') {
      handleSftpExtract(ws, msg);
    }

    // ── Docker (NEW) ──
    if (msg.type === 'docker:command') {
      handleDockerCommand(ws, msg);
    }

    if (msg.type === 'pong') return;
    if (msg.type === 'error') {
      console.error(`❌ Server error: ${msg.message}`);
    }
  });

  ws.addEventListener('close', ({ code, reason }) => {
    clearInterval(keepAlive);
    tcpConnections.forEach(t => t.destroy());
    tcpConnections.clear();
    sshSessions.forEach((s, id) => cleanupSsh(id));

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
    console.error(`❌ WebSocket error: ${err.message || err}`);
  });
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

      sshSessions.set(connId, { sshClient, stream });

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
    const chunks = [];
    const stream = sftp.createReadStream(msg.path);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.on('end', () => {
      ws.send(JSON.stringify({ type: 'sftp:fileData', connId: msg.connId, path: msg.path, content: Buffer.concat(chunks).toString('utf-8') }));
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

  const onSuccess = () => {
    ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'delete', path: msg.path }));
  };

  const onError = (err) => {
    sendSftpError(ws, msg.connId, err);
  };

  session.sshClient.sftp((sftpErr, sftp) => {
    if (sftpErr) return onError(sftpErr);

    sftp.unlink(msg.path, (unlinkErr) => {
      if (!unlinkErr) { sftp.end(); return onSuccess(); }
      sftp.rmdir(msg.path, (rmdirErr) => {
        sftp.end();
        if (!rmdirErr) return onSuccess();
        onError(rmdirErr);
      });
    });
  });
}

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
    const chunks = [];
    const stream = sftp.createReadStream(filePath);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.on('end', () => {
      ws.send(JSON.stringify({
        type: 'sftp:download_data',
        connId: msg.connId,
        path: filePath,
        data: Buffer.concat(chunks).toString('base64'),
      }));
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

      const chunks = [];
      let stderrBuf = '';

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.stderr.on('data', (d) => { stderrBuf += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) {
          return sendSftpError(ws, msg.connId, new Error(`tar failed (exit ${code}): ${stderrBuf}`));
        }
        ws.send(JSON.stringify({
          type: 'sftp:download_data',
          connId: msg.connId,
          path: archiveName,
          data: Buffer.concat(chunks).toString('base64'),
        }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpSearch(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const query = (msg.query || '').toLowerCase();
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
          results.push({ filename: item.filename, path: fullPath, isDirectory: item.attrs.isDirectory() });
        }
        if (item.attrs.isDirectory() && !item.filename.startsWith('.')) {
          await walk(fullPath);
        }
      }
    }

    await walk(msg.path || '.');
    ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'sftp:searchResult', connId: msg.connId, query: msg.query, results: [], error: err?.message }));
  }
}

async function handleSftpGetSize(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const targetPath = msg.path;

    const stat = await new Promise((resolve, reject) => {
      sftp.stat(targetPath, (err, stats) => err ? reject(err) : resolve(stats));
    });

    if (stat.isDirectory()) {
      let totalSize = 0;
      async function walk(dir) {
        const list = await new Promise((resolve, reject) => {
          sftp.readdir(dir, (err, list) => err ? reject(err) : resolve(list || []));
        });
        for (const item of list) {
          const fullPath = `${dir}/${item.filename}`;
          if (item.attrs.isDirectory()) {
            await walk(fullPath);
          } else {
            totalSize += item.attrs.size || 0;
          }
        }
      }
      await walk(targetPath);
      ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: totalSize }));
    } else {
      ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: targetPath, size: stat.size }));
    }
  } catch (err) {
    ws.send(JSON.stringify({ type: 'sftp:sizeResult', connId: msg.connId, path: msg.path, size: 0, error: err?.message }));
  }
}

async function handleSftpCopy(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));
    session.sshClient.exec(`cp -r "${msg.src}" "${msg.dest}"`, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) return sendSftpError(ws, msg.connId, new Error(`Copy failed: ${stderr}`));
        ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'copy', path: msg.dest }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpMove(ws, msg) {
  try {
    const session = sshSessions.get(msg.connId);
    if (!session?.sshClient) return sendSftpError(ws, msg.connId, new Error('No SSH session'));
    const overwriteFlag = msg.overwrite ? '-f' : '';
    session.sshClient.exec(`mv ${overwriteFlag} "${msg.src}" "${msg.dest}"`, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) return sendSftpError(ws, msg.connId, new Error(`Move failed: ${stderr}`));
        ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'move', path: msg.dest }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

async function handleSftpReadBase64(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const chunks = [];
    const stream = sftp.createReadStream(msg.path);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.on('end', () => {
      ws.send(JSON.stringify({ type: 'sftp:fileData', connId: msg.connId, path: msg.path, content: Buffer.concat(chunks).toString('base64') }));
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
    const type = msg.type;
    const targetDir = path.posix.dirname(archivePath);
    const cleanupArchive = msg.cleanupArchive;

    let extractCmd;
    if (type === 'zip') {
      extractCmd = `unzip -o "${archivePath}" -d "${targetDir}" 2>/dev/null || python3 -c "import zipfile; zipfile.ZipFile('${archivePath}').extractall('${targetDir}')"`;
    } else {
      extractCmd = `tar xf "${archivePath}" -C "${targetDir}"`;
    }

    session.sshClient.exec(extractCmd, (err, stream) => {
      if (err) return sendSftpError(ws, msg.connId, err);
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) return sendSftpError(ws, msg.connId, new Error(`Extract failed: ${stderr}`));

        if (cleanupArchive) {
          session.sshClient.exec(`rm -f "${archivePath}"`, () => {});
        }

        ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'extract', path: archivePath }));
      });
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
}

// ── Docker handlers ───────────────────────────────────────────────────────
function handleDockerCommand(ws, msg) {
  const { connId, command } = msg;

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

  // รัน docker ผ่าน SSH ไปยัง Target (ไม่ใช่บนเครื่องผู้ใช้)
  const session = sshSessions.get(connId);
  if (!session?.sshClient) {
    ws.send(JSON.stringify({ type: 'docker:error', connId, error: 'No SSH session. Connect to SSH first.' }));
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
