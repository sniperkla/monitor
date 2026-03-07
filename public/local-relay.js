#!/usr/bin/env node
/**
 * SSH Monitor - Local Relay Agent
 * Node.js 18+ required, zero npm dependencies.
 *
 * First run:  node local-relay.js --server URL --token TOKEN
 *             (saves config to ~/.ssh-monitor-relay.json, then stays running)
 *
 * Later runs: node local-relay.js
 *             (reads saved config, auto-reconnects whenever the site is open)
 *
 * Install:    node local-relay.js --install --server URL --token TOKEN
 * Uninstall:  node local-relay.js --uninstall
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const net  = require('net');
const { spawnSync } = require('child_process');

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

// -- Config file persistence (~/.ssh-monitor-relay.json) --
const CONFIG_PATH = path.join(os.homedir(), '.ssh-monitor-relay.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.warn('⚠  Could not save config:', e.message);
  }
}

// Merge CLI args with saved config (CLI wins)
const savedConfig = loadConfig();

let SERVER = args.server || savedConfig.server || process.env.RELAY_SERVER || '';
let TOKEN  = args.token  || savedConfig.token  || process.env.RELAY_TOKEN  || '';
const HOST     = args.host   || savedConfig.host   || 'localhost';
const PORT     = parseInt(args.port || savedConfig.port || '27017', 10);
const SCRIPT   = path.resolve(__filename);
const NODE_BIN = process.execPath;
const PLATFORM = os.platform();
const SVC_ID   = 'com.ssh-monitor.relay';
const SVC_NAME = 'SSH Monitor Local Relay';

// -- --install --
if (args.install) {
  if (!SERVER || !TOKEN) {
    console.error('  --server and --token are required with --install');
    process.exit(1);
  }
  saveConfig({ server: SERVER, token: TOKEN, host: HOST, port: PORT });
  console.log('  ✅ Config saved to', CONFIG_PATH);
  const cmdArgs = ['--server', SERVER, '--token', TOKEN, '--host', HOST, '--port', String(PORT)];
  if      (PLATFORM === 'darwin') installMacOS(cmdArgs);
  else if (PLATFORM === 'linux')  installLinux(cmdArgs);
  else if (PLATFORM === 'win32')  installWindows(cmdArgs);
  else { console.error('Auto-install not supported on ' + PLATFORM); process.exit(1); }
  process.exit(0);
}

// -- --uninstall --
if (args.uninstall) {
  if      (PLATFORM === 'darwin') uninstallMacOS();
  else if (PLATFORM === 'linux')  uninstallLinux();
  else if (PLATFORM === 'win32')  uninstallWindows();
  else { console.error('Uninstall not supported on ' + PLATFORM); process.exit(1); }
  process.exit(0);
}

// -- RUN MODE --
if (!SERVER || !TOKEN) {
  console.log([
    '',
    'SSH Monitor - Local Relay Agent',
    '-------------------------------',
    'No saved config found. First-time setup:',
    '  node local-relay.js --server URL --token TOKEN',
    '',
    '  Config is saved to ~/.ssh-monitor-relay.json after first run.',
    '  After that, just run:  node local-relay.js',
    '',
    'Install as auto-start background service:',
    '  node local-relay.js --install --server URL --token TOKEN',
    '',
    'Remove background service:',
    '  node local-relay.js --uninstall',
    '',
  ].join('\n'));
  process.exit(1);
}

// Save config on first run (or if args updated it)
if (args.server || args.token) {
  saveConfig({ server: SERVER, token: TOKEN, host: HOST, port: PORT });
  console.log('  ✅ Config saved to', CONFIG_PATH);
  console.log('  Next time just run: node local-relay.js\n');
}

// ── Resolve WebSocket class ─────────────────────────────────────────────────
let WS;
if (typeof WebSocket !== 'undefined') {
  WS = WebSocket;                     // Node.js 18.15+ native
} else {
  try {
    WS = require('ws');               // Fallback: npm install ws
    console.log('ℹ  Using ws package for WebSocket.');
  } catch {
    console.error('❌  Node.js 18.15+ is required, OR run: npm install ws');
    process.exit(1);
  }
}

// ── Connection logic ────────────────────────────────────────────────────────
const wsUrl = SERVER.replace(/^http/, 'ws') + `/relay-ws?token=${encodeURIComponent(TOKEN)}`;
const connections = new Map(); // connId → net.Socket

let retryDelay = 3000;

function connect() {
  console.log(`\n🔗  SSH Monitor Local Relay Agent`);
  console.log(`    Server : ${SERVER}`);
  console.log(`    Local  : ${HOST}:${PORT}`);
  console.log(`    Connecting... (will idle & auto-reconnect whenever you open the site)`);

  let ws;
  try {
    ws = new WS(wsUrl);
  } catch (err) {
    console.error('❌  Failed to create WebSocket:', err.message);
    setTimeout(connect, retryDelay);
    return;
  }

  ws.addEventListener('open', () => {
    retryDelay = 3000; // reset backoff on successful connect
    // Tell server which local port we're forwarding
    ws.send(JSON.stringify({ type: 'init', targetHost: HOST, targetPort: PORT }));
  });

  ws.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'ready') {
      console.log(`\n✅  Relay ready! Your local ${HOST}:${PORT} is now accessible through SSH Monitor.`);
      console.log(`    Keep this terminal open while using the app.\n`);
    }

    if (msg.type === 'error') {
      console.error(`\n❌  Server error: ${msg.message}`);
      ws.close();
    }

    if (msg.type === 'open') {
      // Server wants us to open a TCP connection to the target
      const { connId } = msg;
      const tcpHost = msg.host || HOST;
      const tcpPort = Number(msg.port) || PORT;

      const tcp = net.connect(tcpPort, tcpHost);

      tcp.on('connect', () => {
        // Connection established — nothing to announce, just relay
      });

      tcp.on('data', (chunk) => {
        if (ws.readyState === 1 /*OPEN*/) {
          ws.send(JSON.stringify({ type: 'data', connId, data: chunk.toString('base64') }));
        }
      });

      tcp.on('close', () => {
        try { ws.send(JSON.stringify({ type: 'close', connId })); } catch {}
        connections.delete(connId);
      });

      tcp.on('error', (err) => {
        console.error(`  ✗  [${connId}] TCP error: ${err.message} (is ${tcpHost}:${tcpPort} reachable?)`);
        tcp.destroy();
      });

      connections.set(connId, tcp);
    }

    if (msg.type === 'data') {
      const tcp = connections.get(msg.connId);
      if (tcp && !tcp.destroyed) {
        tcp.write(Buffer.from(msg.data, 'base64'));
      }
    }

    if (msg.type === 'close') {
      const tcp = connections.get(msg.connId);
      if (tcp) { tcp.destroy(); connections.delete(msg.connId); }
    }
  });

  ws.addEventListener('close', ({ reason }) => {
    console.log(`\n💤  Site closed or disconnected${reason ? ': ' + reason : ''}. Idling — will reconnect when you open the site (in ${retryDelay / 1000}s)...`);
    connections.forEach(t => t.destroy());
    connections.clear();
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 1.5, 30000); // exponential backoff, max 30s
  });

  ws.addEventListener('error', (err) => {
    console.error(`❌  WebSocket error: ${err.message || JSON.stringify(err)}`);
  });
}

connect();

// ==========================================================================
// macOS - LaunchAgent (~/Library/LaunchAgents/)
// ==========================================================================
function installMacOS(cmdArgs) {
  const plistDir  = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, SVC_ID + '.plist');
  const logFile   = path.join(os.homedir(), 'Library', 'Logs', 'ssh-monitor-relay.log');
  fs.mkdirSync(plistDir, { recursive: true });
  const LT = String.fromCharCode(60), GT = String.fromCharCode(62);
  const argTags = [NODE_BIN, SCRIPT].concat(cmdArgs)
    .map(function(a) { return '    ' + LT + 'string' + GT + xmlEscape(a) + LT + '/string' + GT; }).join('\n');
  const xml = [
    LT + '?xml version="1.0" encoding="UTF-8"?' + GT,
    LT + '!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"' + GT,
    LT + 'plist version="1.0"' + GT + LT + 'dict' + GT,
    '  ' + LT + 'key' + GT + 'Label' + LT + '/key' + GT + LT + 'string' + GT + SVC_ID + LT + '/string' + GT,
    '  ' + LT + 'key' + GT + 'ProgramArguments' + LT + '/key' + GT,
    '  ' + LT + 'array' + GT,
    argTags,
    '  ' + LT + '/array' + GT,
    '  ' + LT + 'key' + GT + 'RunAtLoad' + LT + '/key' + GT + LT + 'true/' + GT,
    '  ' + LT + 'key' + GT + 'KeepAlive' + LT + '/key' + GT + LT + 'true/' + GT,
    '  ' + LT + 'key' + GT + 'StandardOutPath' + LT + '/key' + GT + LT + 'string' + GT + logFile + LT + '/string' + GT,
    '  ' + LT + 'key' + GT + 'StandardErrorPath' + LT + '/key' + GT + LT + 'string' + GT + logFile + LT + '/string' + GT,
    LT + '/dict' + GT + LT + '/plist' + GT,
  ].join('\n');
  fs.writeFileSync(plistPath, xml);
  spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' });
  if (r.status === 0) {
    console.log('\n  Installed as macOS LaunchAgent (auto-starts at login)');
    console.log('  Logs:   tail -f "' + logFile + '"');
    console.log('  Remove: node "' + SCRIPT + '" --uninstall\n');
  } else {
    console.error('  launchctl load failed.');
  }
}

function uninstallMacOS() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', SVC_ID + '.plist');
  if (!fs.existsSync(plistPath)) { console.log('No LaunchAgent found.'); return; }
  spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  fs.unlinkSync(plistPath);
  console.log('  Removed macOS LaunchAgent.');
}

// ==========================================================================
// Linux - systemd user service (~/.config/systemd/user/)
// ==========================================================================
function installLinux(cmdArgs) {
  const unitDir  = path.join(os.homedir(), '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, SVC_ID + '.service');
  const logDir   = path.join(os.homedir(), '.local', 'share', 'ssh-monitor');
  fs.mkdirSync(unitDir, { recursive: true });
  fs.mkdirSync(logDir,  { recursive: true });
  const execStart = [NODE_BIN, SCRIPT].concat(cmdArgs).map(shellQuote).join(' ');
  const logFile   = path.join(logDir, 'relay.log');
  const unit = [
    '[Unit]', 'Description=' + SVC_NAME, 'After=network.target', '',
    '[Service]', 'Type=simple', 'ExecStart=' + execStart,
    'Restart=always', 'RestartSec=5',
    'StandardOutput=append:' + logFile,
    'StandardError=append:' + logFile, '',
    '[Install]', 'WantedBy=default.target',
  ].join('\n') + '\n';
  fs.writeFileSync(unitPath, unit);
  let ok = spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' }).status === 0;
  ok = ok && spawnSync('systemctl', ['--user', 'enable', '--now', SVC_ID + '.service'], { stdio: 'inherit' }).status === 0;
  spawnSync('loginctl', ['enable-linger', os.userInfo().username], { stdio: 'ignore' });
  if (ok) {
    console.log('\n  Installed as systemd user service (auto-starts at login)');
    console.log('  Logs:   journalctl --user -u ' + SVC_ID + ' -f');
    console.log('  Remove: node "' + SCRIPT + '" --uninstall\n');
  } else {
    console.error('  systemctl failed. Try: export XDG_RUNTIME_DIR=/run/user/$(id -u)');
  }
}

function uninstallLinux() {
  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SVC_ID + '.service');
  if (!fs.existsSync(unitPath)) { console.log('No systemd unit found.'); return; }
  spawnSync('systemctl', ['--user', 'disable', '--now', SVC_ID + '.service'], { stdio: 'ignore' });
  fs.unlinkSync(unitPath);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  console.log('  Removed systemd service.');
}

// ==========================================================================
// Windows - Task Scheduler
// ==========================================================================
function installWindows(cmdArgs) {
  const allArgs = cmdArgs.map(function(a) { return a.indexOf(' ') !== -1 ? '"' + a + '"' : a; }).join(' ');
  const action  = '"' + NODE_BIN + '" "' + SCRIPT + '" ' + allArgs;
  const r = spawnSync('schtasks',
    ['/Create', '/F', '/TN', SVC_NAME, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/TR', action],
    { stdio: 'inherit', shell: true });
  if (r.status === 0) {
    spawnSync('schtasks', ['/Run', '/TN', SVC_NAME], { stdio: 'ignore', shell: true });
    console.log('\n  Installed as Windows Scheduled Task (auto-starts at login)');
    console.log('  Stop:   schtasks /End /TN "' + SVC_NAME + '"');
    console.log('  Remove: node "' + SCRIPT + '" --uninstall\n');
  } else {
    console.error('  schtasks failed. Try running as Administrator.');
  }
}

function uninstallWindows() {
  const r = spawnSync('schtasks', ['/Delete', '/F', '/TN', SVC_NAME], { stdio: 'inherit', shell: true });
  if (r.status === 0) console.log('  Removed Windows Scheduled Task.');
  else console.log('  Task not found.');
}

// -- Utilities --
function xmlEscape(s) {
  const AMP = String.fromCharCode(38);
  return String(s)
    .split(AMP).join(AMP + 'amp;')
    .split(String.fromCharCode(60)).join(AMP + 'lt;')
    .split(String.fromCharCode(62)).join(AMP + 'gt;')
    .split(String.fromCharCode(34)).join(AMP + 'quot;');
}
function shellQuote(s) {
  const Q = String.fromCharCode(39);
  return Q + String(s).split(Q).join(Q + String.fromCharCode(92) + Q + Q) + Q;
}
