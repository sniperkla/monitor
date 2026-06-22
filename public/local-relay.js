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
  saveConfig({ server: SERVER, token: TOKEN });
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
    return INSTALLED_SCRIPT;
  } catch (e) { console.error('Install failed:', e.message); process.exit(1); }
}

// -- Connection state --
const tcpConnections = new Map();  // connId → net.Socket
const sshSessions = new Map();    // connId → { sshClient, stream, sftpClient, sftpPending }
let retryDelay = 3000;

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
      ws.send(JSON.stringify({ type: 'init', capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true } }));
      console.log(`\n✅ Relay ready! Capabilities: SSH=${!!ssh2}, SFTP=${!!ssh2}, Docker=true`);
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

    // ── Docker (NEW) ──
    if (msg.type === 'docker:command') {
      handleDockerCommand(ws, msg);
    }

    if (msg.type === 'pong') return;
    if (msg.type === 'error') {
      console.error(`❌ Server error: ${msg.message}`);
    }
  });

  ws.addEventListener('close', ({ reason }) => {
    clearInterval(keepAlive);
    console.log(`\n💤 Disconnected. Reconnecting in ${retryDelay / 1000}s...`);
    tcpConnections.forEach(t => t.destroy());
    tcpConnections.clear();
    sshSessions.forEach((s, id) => cleanupSsh(id));
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

async function handleSftpDelete(ws, msg) {
  try {
    const sftp = await getSftpClient(msg.connId);
    const deleteFn = msg.isDirectory ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);
    deleteFn(msg.path, (err) => {
      if (err) sendSftpError(ws, msg.connId, err);
      else ws.send(JSON.stringify({ type: 'sftp:action_success', connId: msg.connId, action: 'delete', path: msg.path }));
    });
  } catch (err) {
    sendSftpError(ws, msg.connId, err);
  }
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
    const chunks = [];
    const stream = sftp.createReadStream(msg.remotePath);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => sendSftpError(ws, msg.connId, err));
    stream.on('end', () => {
      ws.send(JSON.stringify({
        type: 'sftp:download_data',
        connId: msg.connId,
        path: msg.remotePath,
        data: Buffer.concat(chunks).toString('base64'),
      }));
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
