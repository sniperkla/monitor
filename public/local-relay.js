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
 * Pair:       node local-relay.js --pair --server URL
 * Uninstall:  node local-relay.js --uninstall
 *
 * --pair is the recommended path. The token is delivered out of band and never
 * appears in argv, the shell history, or the service definition.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const http = require('http');
const net  = require('net');
const { spawnSync, exec } = require('child_process');

const PLATFORM = os.platform();
/** Termux reports os.platform() as 'android' — detect the real environment. */
function isTermux() {
  return PLATFORM === 'android' ||
    /com\.termux/i.test(String(process.env.PREFIX || process.env.TERMUX_VERSION || ''));
}
if (isTermux()) {
  try { spawnSync('termux-wake-lock', { stdio: 'ignore' }); } catch (_) {}
}
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
//
// These capability notices are noise when the user only asked for --help, so
// they are suppressed in that case. (`local-relay --help` used to fall through
// and start the relay; it now exits, and printing "node-datachannel not found"
// above the usage text just made the help look broken.)
const WANTS_HELP = process.argv.includes('--help') || process.argv.includes('-h');
const say = (...a) => { if (!WANTS_HELP) console.log(...a); };

let ssh2;
try {
  ssh2 = tryRequire('ssh2');
  say('✅ ssh2 loaded — SSH/SFTP will run locally');
} catch {
  say('ℹ️  ssh2 not found — install with: npm install ssh2');
  say('   Falling back to TCP relay mode only');
}

// -- Try to load node-datachannel (WebRTC, optional) --
let ndc = null;
try {
  ndc = tryRequire('node-datachannel');
  ndc.initLogger('Error');
  say('✅ node-datachannel loaded — WebRTC P2P enabled');
} catch {
  say('ℹ️  node-datachannel not found — relay will operate in WebSocket-proxy mode');
  say('   Everything works over WebSocket; P2P is an optional optimization.');
  say('   For P2P mode (desktop): npm config set allow-scripts=node-datachannel --location=user');
  say('                           then: npm install -g node-datachannel');
  say('   (Termux/Android: skip this — no prebuilt binary, source build usually fails.)');
}

// crypto is built-in since Node 18
const crypto = require('crypto');

// Map: relayConnId → pre-provisioned SSH config (sent by server before WebRTC peer connects)
const preparedSessions = new Map();
// Map: relayConnId → active WebRTC peer
const activeRtcPeers   = new Map();

// -- Try to load ws --
let WS;
// Only the `ws` package can set handshake headers. The WHATWG global WebSocket
// silently ignores its second argument, so treating the two as interchangeable
// would make the token disappear from the request and every connect fail with
// "Invalid or expired token" — with no hint that headers were the cause.
let WS_CAN_SET_HEADERS = false;
try {
  WS = tryRequire('ws');
  WS_CAN_SET_HEADERS = true;
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

// ── Help ──────────────────────────────────────────────────────────────────
// Without this, `local-relay --help` (and any typo'd flag) fell straight
// through: the arg parser happily stored `help = true`, ignored it, and the
// relay started up and dialled the default server. The first thing an npm user
// types should not silently launch a daemon.
const KNOWN_FLAGS = ['server', 'token', 'pair', 'uninstall', 'install', 'name', 'label', 'scope', 'claim', 'help'];
if (args.help || args.h === true) {
  console.log(`
⚡ SSH Monitor — Local Relay

  Installed via npm:  npm install -g ssh-monitor-relay

USAGE
  local-relay --pair --server <URL>            pair this machine (interactive code)
  local-relay --pair --server <URL> --claim <CODE>
                                               pair with a pre-authorized claim
                                               code (QR transfer) — no typing
  local-relay --server <URL> --token <TOKEN>   run with a token you already have
  local-relay --uninstall                      remove the background service
  local-relay --help                           this message

OPTIONS
  --server <URL>   monitor server, e.g. https://monitor.eaqdragon.com
  --token <TOKEN>  relay token (normally written by --pair, not passed by hand)
  --claim <CODE>   pre-authorized install code from the web app (QR transfer)
  --name <NAME>    name this relay reports to the server (default: hostname)
  --label <LABEL>  human-readable label
  --scope <SCOPE>  relay | agent

Normally you run exactly one command:

  local-relay --pair --server https://monitor.eaqdragon.com

It prints a short code, you approve it in Settings → Local Relay, and the relay
installs itself as a background service that starts at login.

Config:   ~/.ssh-monitor-relay.json   (0600)
Install:  ~/.ssh-monitor-relay/
Logs:     ~/Library/Logs/ssh-monitor-relay.log   (macOS)
`);
  process.exit(0);
}

const unknown = Object.keys(args).filter(
  (k) => !KNOWN_FLAGS.includes(k) && !['length', 'map', 'slice'].includes(k)
);
if (unknown.length) {
  console.error(`❌ Unknown flag(s): ${unknown.map((k) => '--' + k).join(', ')}`);
  console.error('   Run `local-relay --help` for usage.');
  process.exit(1);
}

// -- Config persistence --
const CONFIG_PATH = path.join(os.homedir(), '.ssh-monitor-relay.json');
function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {};
}
function saveConfig(cfg) {
  try {
    // 0600 — this file holds the relay token. `mode` only applies when the file
    // is created, so chmod afterwards for configs written by older versions.
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
  } catch (e) { console.warn('⚠ Config save failed:', e.message); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Device pairing. Asks the server for a device code, prints a short code for
 * the user to approve in the browser, then polls until the token arrives.
 *
 * The point of this is that the install command carries no secret. Compare:
 *
 *   --install --token <365_DAY_TOKEN>   token in argv, shell history, ps output
 *   --pair                              token arrives over the wire, written 0600
 *
 * @param {object} o
 * @param {string} o.client  identifier reported to the server
 * @param {string} o.scope   'relay' (supporter-gated) | 'agent'
 * @returns {Promise<string>} the relay token
 */
async function pairAndGetToken({ client, scope }) {
  const base = String(SERVER || '').replace(/\/+$/, '');
  if (!base) throw new Error('No --server URL to pair against.');

  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
  };

  // -- Pre-authorized claim (QR transfer path) --
  // A claim code is minted by the web app (POST /api/relay/device/invite) for a
  // signed-in user and arrives pre-approved — no user code, no waiting. It is
  // exchanged here in one shot. Single-use and short-lived by design: if the
  // QR/photo leaks, the code is either already spent or expired.
  if (args.claim && typeof args.claim === 'string') {
    let r;
    try {
      r = await post('/api/relay/device/token', { deviceCode: args.claim.trim() });
    } catch (e) {
      throw new Error(`Could not reach ${base} — ${e.message}`);
    }
    if (r.status === 200 && r.data && r.data.token) {
      console.log('✅ Claim accepted — installing.');
      return r.data.token;
    }
    if (r.status === 410) {
      throw new Error((r.data && r.data.error) || 'Claim code expired — generate a new QR code.');
    }
    throw new Error((r.data && r.data.error) || `Claim failed (HTTP ${r.status}).`);
  }

  let init;
  try {
    init = await post('/api/relay/device/code', {
      client,
      label: args.label || os.hostname(),
      scope,
    });
  } catch (e) {
    throw new Error(`Could not reach ${base} — ${e.message}`);
  }

  if (!init.data || !init.data.deviceCode) {
    throw new Error((init.data && init.data.error) || `Pairing failed (HTTP ${init.status})`);
  }

  const { deviceCode, userCode, expiresIn, interval } = init.data;
  const mins = Math.max(1, Math.round((expiresIn || 600) / 60));

  const W = 46;
  const pad = (s) => String(s) + ' '.repeat(Math.max(0, W - String(s).length));
  const row = (s) => `  │${pad(s)}│`;

  console.log('');
  console.log(`  ┌${'─'.repeat(W)}┐`);
  console.log(row(''));
  console.log(row('    Approve this device in Settings'));
  console.log(row(''));
  console.log(row(`          >>>   ${userCode}   <<<`));
  console.log(row(''));
  console.log(`  └${'─'.repeat(W)}┘`);
  console.log('');
  console.log(`  Settings → Local Relay → enter the code above.`);
  console.log(`  Waiting for approval (this code expires in ${mins} min)`);

  const deadline = Date.now() + (expiresIn || 600) * 1000;
  const pollMs = Math.max(2000, (interval || 5) * 1000);

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let r;
    try {
      r = await post('/api/relay/device/token', { deviceCode });
    } catch (_) {
      process.stdout.write('.');
      continue; // transient network blip — keep waiting
    }
    if (r.status === 200 && r.data && r.data.token) {
      console.log('\n✅ Approved — installing.');
      return r.data.token;
    }
    if (r.status === 410) {
      throw new Error((r.data && r.data.error) || 'Pairing expired — run the command again.');
    }
    process.stdout.write('.');
  }
  throw new Error('Timed out waiting for approval. Run the command again.');
}

const savedConfig = loadConfig();
let SERVER = args.server || savedConfig.server || process.env.RELAY_SERVER || '';
let TOKEN  = args.token  || savedConfig.token  || process.env.RELAY_TOKEN  || '';
const RELAY_VERSION = '1.1.0';
const RELAY_NAME = args.name || savedConfig.name || os.hostname();

// -- Install/uninstall handling (unchanged from original) --
const SVC_ID = 'com.ssh-monitor.relay';
const SVC_NAME = 'SSH Monitor Local Relay';
const NODE_BIN = process.execPath;
const SCRIPT = path.resolve(__filename);
const INSTALLED_SCRIPT = path.join(INSTALL_DIR, 'local-relay.js');

/**
 * Should this file be deleted once install/uninstall finishes?
 *
 * The original rule was "delete the throwaway copy the user curled into
 * ~/Downloads". That is wrong for an npm install: there, the running file IS
 * the package's own dist/local-relay.js inside a global node_modules tree, so
 * deleting it bricks the `local-relay` command after its very first run. The
 * service keeps working (it runs the copy in ~/.ssh-monitor-relay), so the
 * breakage is silent and only shows up the next time you type the command.
 *
 * Rule: never delete anything inside a node_modules tree, and never delete the
 * copy the background service actually runs from.
 */
function isDisposableScript(p) {
  const resolved = path.resolve(p);
  if (resolved === path.resolve(INSTALLED_SCRIPT)) return false;

  // Allowlist, not a blocklist. Deleting your own executable is never
  // necessary — it is only tidiness for the curl workflow, where the file was
  // saved into Downloads/Desktop/a temp dir seconds ago. Anything not clearly
  // a scratch location is kept.
  //
  // Blocklists fail here in two ways we hit for real:
  //   - `npm install -g ./packages` SYMLINKS the package, so __filename's
  //     realpath has no node_modules segment and a node_modules check misses.
  //   - running from a source checkout would delete the source of truth.
  const home = os.homedir();
  const scratch = [
    os.tmpdir(),
    '/tmp',
    '/private/tmp',
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
  ];
  return scratch.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

if (args.install || args.pair) {
  // Async IIFE: pairing has to await network round trips. connect() is guarded
  // at the bottom of the file so it cannot start underneath this.
  (async () => {
    if (!SERVER) {
      console.error('❌ --server URL is required.');
      process.exit(1);
    }

    // Pairing delivers the token out of band, so it never reaches argv, the
    // shell history, or the service definition.
    //
    // `--pair` means "pair me", so it mints a fresh code even when a token is
    // already saved. This guard used to be just `if (!TOKEN)`, and TOKEN is
    // seeded from ~/.ssh-monitor-relay.json — so re-running --pair on an
    // already-paired machine skipped pairing entirely and printed NO code,
    // only "✅ Relay agent installed as service". Re-pairing is precisely what
    // you do after a token is revoked, after moving to another server, or
    // after missing the approval window, so that silent no-op removed the one
    // command that recovers a broken install. `--uninstall` appeared to fix it
    // only because it deletes the config file.
    //
    // An explicit --token still wins: if you hand us credentials, we use them
    // and do not go asking for new ones.
    //
    // Reusing a saved token remains correct for `--install` without `--pair`,
    // which means "re-provision the service", not "get new credentials".
    if (!TOKEN || (args.pair && !args.token)) {
      if (args.pair && !args.token && savedConfig.token) {
        console.log('\n↻ Already paired — replacing the existing token with a new one.');
        console.log('  The old one stops being used; revoke it in Settings → Local Relay.');
      }
      try {
        TOKEN = await pairAndGetToken({
          client: 'local-relay',
          scope: args.scope === 'agent' ? 'agent' : 'relay',
        });
      } catch (e) {
        console.error(`\n❌ Pairing failed: ${e.message}`);
        process.exit(1);
      }
    }

    // A token is only valid for the server that minted it. Pointing an install
    // at a new server while reusing the saved token produces a service that
    // starts, fails to authenticate, and reports nothing useful — so say so
    // rather than writing a config that cannot work.
    if (savedConfig.server && savedConfig.server !== SERVER && TOKEN === savedConfig.token) {
      console.log(`\n⚠ This token was issued by ${savedConfig.server}, not ${SERVER}.`);
      console.log('  If it fails to connect, re-run with --pair to get a fresh one.');
    }

    saveConfig({ server: SERVER, token: TOKEN, name: RELAY_NAME });
    ensureInstalledScript();
    if (PLATFORM === 'android' || isTermux()) {
      // Termux: os.platform() reports 'android', there is no launchd/systemd,
      // and exiting here would leave NOTHING running — the relay paired, saved
      // its token, and died before ever opening the WebSocket, so the dashboard
      // showed "Local Relay not detected" forever. Start it in this process
      // instead; the bottom-of-file guard does not run because this branch
      // connects explicitly.
      console.log('✅ Paired — Termux detected (no system service available).');
      console.log(`   The relay is now running in this terminal.`);
      console.log(`   Start it again later with:  node ${INSTALLED_SCRIPT}`);
      console.log('   Keep it alive in the background with:  termux-wake-lock');
      console.log('   (and consider tmux, or the termux-services add-on, so it');
      console.log('    survives closing the session).');
      try { spawnSync('termux-wake-lock', { stdio: 'ignore' }); } catch (_) {}
      connect();
      return;
    }
    if (PLATFORM === 'darwin') installMacOS();
    else if (PLATFORM === 'linux') installLinux();
    else if (PLATFORM === 'win32') installWindows();
    console.log('✅ Relay agent installed as service');

    // Self-cleanup: remove a throwaway installer copy if we were run from one.
    try {
      if (isDisposableScript(SCRIPT) && fs.existsSync(SCRIPT)) {
        fs.unlinkSync(SCRIPT);
      }
    } catch (_) {}

    process.exit(0);
  })();
} else if (args.uninstall) {
  if (PLATFORM === 'darwin') uninstallMacOS();
  else if (PLATFORM === 'linux') uninstallLinux();
  else if (PLATFORM === 'win32') uninstallWindows();
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  console.log('✅ Uninstalled');

  // Self-cleanup: remove a throwaway copy if we were run from one.
  try {
    if (isDisposableScript(SCRIPT) && fs.existsSync(SCRIPT)) {
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
    
    // Install dependencies into the installation folder.
    //
    // Why this is split in two and why both halves are bounded: this used to be
    // a single `npm install ssh2 ws node-datachannel` with no timeout.
    // node-datachannel is a NATIVE module and can compile from source, so on a
    // cold network the installer sat there for minutes with npm's own output
    // being the only sign of life — the opposite of what a trust-first
    // installer should feel like. Worse, a hang in the optional package took
    // the required ones down with it.
    //
    //   • ssh2 + ws are required — without ws the relay cannot connect at all.
    //   • node-datachannel is optional — the relay already falls back to
    //     WebSocket transport without it, so a timeout here is a warning.
    try {
      console.log('📦 Installing dependencies for the relay service (one-time step)...');
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

      const install = (pkgs, timeoutMs) => spawnSync(npmCmd, [
        'install', '--no-audit', '--no-fund', '--prefer-offline',
        '--cache', localCache,
        ...pkgs
      ], { cwd: INSTALL_DIR, stdio: 'inherit', timeout: timeoutMs });

      const CORE_TIMEOUT_MS = 5 * 60 * 1000;
      const OPTIONAL_TIMEOUT_MS = 3 * 60 * 1000;

      const core = install(['ssh2', 'ws'], CORE_TIMEOUT_MS);
      if (core.error && core.error.code === 'ETIMEDOUT') {
        console.warn(`⚠️  Dependency install timed out after ${CORE_TIMEOUT_MS / 1000}s.`);
        console.warn('   The relay needs ssh2 and ws. Run this once it has network access:');
        console.warn('   cd ' + INSTALL_DIR + ' && npm install ssh2 ws');
      } else if (core.status === 0) {
        console.log('✅ Core dependencies installed (ssh2, ws).');
      } else {
        console.warn('⚠️  npm install returned non-zero status code for ssh2/ws.');
        console.warn('   SSH features may be unavailable until it succeeds.');
      }

      // Optional, and the only one that can compile from source — so it gets
      // its own shorter leash and a failure here must not fail the install.
      console.log('📦 Installing optional WebRTC support (node-datachannel)...');
      const p2p = install(['node-datachannel'], OPTIONAL_TIMEOUT_MS);
      if (p2p.error && p2p.error.code === 'ETIMEDOUT') {
        console.warn(`⚠️  node-datachannel timed out after ${OPTIONAL_TIMEOUT_MS / 1000}s — continuing without WebRTC P2P.`);
        console.warn('   The relay works over WebSocket. Install it later if you want P2P.');
      } else if (p2p.status === 0) {
        console.log('✅ WebRTC P2P support installed.');
      } else {
        console.warn('⚠️  node-datachannel could not be installed — continuing without WebRTC P2P.');
        console.warn('   npm may have blocked its install script. To allow it:');
        console.warn('   npm config set allow-scripts=node-datachannel --location=user');
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

// ── Loopback web proxy (the in-app browser's client-side renderer) ────────
//
// WHY THIS IS ON THE RELAY AT ALL
// The in-app browser used to render ordinary websites through the monitor
// server's browser-proxy route, which serves a stranger's HTML from the
// MONITOR origin. That forces the frame to be sandboxed WITHOUT
// `allow-same-origin` — otherwise the target's JavaScript would run as
// monitor.eaqdragon.com — and an opaque origin cannot touch localStorage,
// indexedDB or serviceWorker. Measured: on youtube.com the frame paints its
// grey skeleton and stops, because `localStorage` throws SecurityError inside
// it. Google, which needs no storage, renders fine.
//
// Serving the same bytes from a DIFFERENT origin removes the need for the
// sandbox entirely: the frame is still cross-origin to the app (so it cannot
// reach it) but same-origin with itself, so storage works. The relay is the
// natural host — it already runs on the user's own machine, so the page bytes
// never pass through the monitor server.
//
// SHAPE:  /p/<base64url(origin)>/<path>?<query>  →  <origin><path>?<query>
//
// Encoding the ORIGIN (not the whole URL) is what makes this stateless, and it
// is why no click interception or injected bridge is needed: the document's
// `<base href>` is the same `/p/<enc>/` prefix, so every relative link,
// stylesheet, image and — the part that actually matters — every relative
// fetch/XHR the page makes comes back here and is forwarded. Nothing ever
// navigates off the proxy path, so there is nothing to intercept.
//
// Honest limits, because they are the reason this is not just "a browser":
//   • no cookie jar — upstream `Set-Cookie` is dropped and the frame's own
//     cookies would be shared by every proxied site on one loopback port, so
//     logged-in sites render logged-out;
//   • absolute URLs still go straight to the target (as in any browser), so a
//     site whose API lives on another host still needs its own CORS headers;
//   • WebSocket upgrades are not proxied.
const WEB_PROXY_PORT = 18780;
const WEB_PROXY_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WEB_PROXY_TIMEOUT_MS = 30000;
const WEB_PROXY_MAX_BODY = 8 * 1024 * 1024;

let webProxyServer = null;
let webProxyPort = 0;

// Hop-by-hop plus anything that must not cross a trust boundary. `cookie` and
// `authorization` are dropped on the way OUT: this proxy holds no jar for the
// target, and the frame's cookies live on 127.0.0.1:<port> shared by every
// proxied site, so forwarding them would leak one site's session to another.
const WEB_PROXY_DROP_REQ = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding',
  'content-length', 'accept-encoding', 'cookie', 'authorization', 'origin',
  'referer', 'upgrade-insecure-requests',
]);

// On the way IN, an ALLOWLIST rather than a drop list. A proxy that forwards
// headers it does not understand forwards bugs: YouTube's response carries
// `origin-trial`, `document-policy`, `reporting-endpoints`, `p3p` and a
// `permissions-policy` naming `ch-ua-*` client hints — and with those passed
// through, Chromium accepted the 200 and then refused to commit the document in
// a frame, leaving a `chrome-error` page and requesting no subresources at all.
// Forward only what a page needs to render, and drop the target's framing and
// isolation policy (it is being framed by us, deliberately).
const WEB_PROXY_ALLOW_RES = new Set([
  'content-type', 'content-language', 'cache-control', 'etag', 'last-modified',
  'expires', 'location', 'content-disposition', 'accept-ranges', 'content-range',
  'vary', 'link',
]);

/**
 * Headers every response that can BECOME a frame document must carry.
 *
 * The app shell embeds this loopback origin with `COEP: credentialless`, and
 * Chromium's nested-document rule cascades: a frame document must declare a
 * COEP at least as strict as its embedder, and a credentialless COEP defaults
 * CORP to `same-origin` — so the document must also state
 * `cross-origin-resource-policy: cross-origin` or it is refused with
 * `corp-not-same-origin-after-defaulted-to-same-origin-by-coep`.
 *
 * That is why this must cover EVERY branch that answers a frame navigation —
 * not just the `/p/` HTML. Measured 2026-09-12: the un-prefixed 302 repair
 * response lacked it, a root-relative link click on an embedded page was
 * refused in the browser exactly there, and the frame ended on a chrome-error
 * even though the redirect TARGET was served correctly.
 */
const WEB_PROXY_FRAME_HEADERS = {
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-resource-policy': 'cross-origin',
};

function webProxyEncode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function webProxyDecode(value) {
  try {
    return Buffer.from(String(value), 'base64url').toString('utf8');
  } catch (_) {
    return '';
  }
}

/** Name of the cookie remembering the last target this listener proxied. */
const WEB_PROXY_COOKIE = 'mp_proxy_target';

/** Read one cookie out of a raw Cookie header. */
function readCookie(header, name) {
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

/**
 * Recover the proxied target from a same-origin navigation's Referer.
 *
 * Used instead of the cookie when the cookie is unavailable — see the
 * root-absolute note in handleWebProxyHttp. Only the `/p/<enc>/` prefix is
 * read, so a referer pointing anywhere else yields nothing.
 */
function webProxyTargetFromReferer(referer) {
  if (!referer) return '';
  try {
    const url = new URL(String(referer));
    const match = /^\/p\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    return match ? webProxyDecode(match[1]) : '';
  } catch (_) {
    return '';
  }
}

function webProxyIndexHtml(proxyOrigin) {
  return `<!doctype html><meta charset="utf-8"><title>Relay web proxy</title>
<body style="font:13px/1.6 -apple-system,system-ui,sans-serif;padding:24px;color:#ddd;background:#18181b">
<p>Relay web proxy is running.</p>
<p>Address a page as <code>${proxyOrigin}/p/&lt;base64url(origin)&gt;/&lt;path&gt;</code>.</p>
<p style="color:#a1a1aa">This listener is bound to 127.0.0.1 and exists to render the in-app
browser inside monitor. It holds no cookie jar and is not a general-purpose proxy.</p>`;
}

async function handleWebProxyHttp(req, res) {
  const proxyOrigin = `http://${req.headers.host || `127.0.0.1:${webProxyPort}`}`;

  // Local/Private Network Access. The monitor app is a PUBLIC https origin and
  // this listener is on loopback, so Chrome can send a PNA preflight for
  // requests it initiates — exactly as it does for the WebUI gateway, which
  // answers the same way. Without this the frame is blocked before it loads.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }
  if (req.url === '/__web_proxy_ping') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('pong');
    return;
  }

  let parsed;
  try {
    parsed = new URL(req.url, proxyOrigin);
  } catch (_) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
    return;
  }

  const match = /^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(parsed.pathname);
  if (!match) {
    // ── the root-absolute problem ──────────────────────────────────────────
    // A page served at `/p/<enc>/` has a document URL that does NOT look like
    // the target's, and `location.href = '/watch'` resolves against the
    // document's URL — not against `<base href>`. So any script that navigates
    // with a root-absolute path lands on THIS origin's root and, without this,
    // gets the informational page instead of the site. Measured: that is
    // exactly how youtube.com died in-app — the document loaded fine, then
    // YouTube's own JS navigated to '/' and the frame ended on chrome-error.
    //
    // So remember the last target per listener and send un-prefixed paths back
    // through the proxy. Three sources, tried in order, because none is
    // reliable on its own:
    //   1. our own cookie — first choice, but this listener is a THIRD-PARTY
    //      origin relative to the app that frames it, and Chrome blocks (or
    //      partitions) third-party cookies, so it is often simply absent;
    //   2. the Referer header — stateless, and for a same-origin navigation the
    //      default referrer policy sends the FULL previous URL, which still
    //      carries the `/p/<enc>/` prefix. Survives cookie blocking; fails only
    //      if the page sets `no-referrer`.
    //
    // Known cost: all three are per listener, not per tab, so two tabs showing
    // different sites can redirect each other's un-prefixed paths. Prefixed
    // paths — everything a normally-behaving page uses — are unaffected.
    const remembered = webProxyDecode(readCookie(req.headers.cookie, WEB_PROXY_COOKIE))
      || webProxyTargetFromReferer(req.headers.referer)
      || req.socket?.____mpLastTarget || '';
    if (remembered && /^https?:\/\//.test(remembered)) {
      const back = `/p/${webProxyEncode(remembered)}${parsed.pathname}${parsed.search}`;
      console.log(`↪ [Relay WebProxy] un-prefixed ${parsed.pathname} → ${back.slice(0, 60)}…`);
      // FRAME-EMBEDDING headers: this redirect is itself the response to a
      // frame navigation, and the app shell embeds with COEP: credentialless.
      // Chromium then defaults CORP to same-origin, and ANY response missing
      // `cross-origin-resource-policy: cross-origin` is refused with
      // corp-not-same-origin-after-defaulted-to-same-origin-by-coep — measured
      // 2026-09-12 on a wikipedia relative link: the /p/ HTML that would have
      // rendered sat behind an un-prefixed 302 without these headers, and the
      // frame ended on a chrome-error even though the redirect target itself
      // was served correctly. See WEB_PROXY_FRAME_HEADERS.
      res.writeHead(302, { location: back, 'cache-control': 'no-store', ...WEB_PROXY_FRAME_HEADERS });
      res.end();
      return;
    }
    console.log(`✗ [Relay WebProxy] un-prefixed ${parsed.pathname} — no target known (cookie, referer and socket all empty); serving the info page`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...WEB_PROXY_FRAME_HEADERS });
    res.end(webProxyIndexHtml(proxyOrigin));
    return;
  }

  let target;
  try {
    target = new URL(webProxyDecode(match[1]));
  } catch (_) {
    target = null;
  }
  if (!target || !['http:', 'https:'].includes(target.protocol)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('target must be an absolute http(s) origin');
    return;
  }

  // Stamp the keep-alive connection with the target being served. This is the
  // third repair source for un-prefixed paths (see the repair branch above):
  // a same-origin navigation almost always reuses this connection, so its
  // stamp survives both cookie blocking AND a site suppressing the referer.
  if (req.socket) req.socket.____mpLastTarget = target.origin;

  const upstreamUrl = `${target.origin}${match[2] || '/'}${parsed.search}`;

  // Request body (POST/PUT/PATCH). Read it before fetching — the stream cannot
  // be replayed once fetch() has consumed it.
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > WEB_PROXY_MAX_BODY) {
        res.writeHead(413, { 'content-type': 'text/plain' });
        res.end('request body too large');
        return;
      }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (WEB_PROXY_DROP_REQ.has(k) || k.startsWith('sec-') || k.startsWith('proxy-')) continue;
    headers[k] = value;
  }
  headers['user-agent'] = WEB_PROXY_UA;
  headers['accept-language'] = headers['accept-language'] || 'en-US,en;q=0.9';
  // Let fetch negotiate its own compression; undici decompresses and we strip
  // the encoding headers on the way back out.
  headers['accept-encoding'] = 'gzip, deflate, br';
  // The frame's real referer names this loopback proxy and is dropped above —
  // but sending NO referer breaks subresources just as hard: media CDNs gate
  // playback on the referer naming the site that embedded the file (hotlink
  // checks), and some pages 403 any referer-less asset. Reconstruct what the
  // real site would have sent: the embedding page's origin, decoded from the
  // proxy-form referer when one exists, otherwise the target origin itself.
  // Only the origin is sent — never the proxy's own URL, and never a cookie.
  const embeddedFrom = webProxyTargetFromReferer(req.headers.referer);
  let upstreamReferer = '';
  if (embeddedFrom) {
    try { upstreamReferer = `${new URL(embeddedFrom).origin}/`; } catch (_) { upstreamReferer = ''; }
  }
  headers['referer'] = upstreamReferer || `${target.origin}/`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_PROXY_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    // undici reports every transport failure as the same opaque "fetch failed";
    // the reason that matters — DNS, TLS, connect timeout, reset — is on
    // `cause`. Logging only the wrapper made two unrelated failures look
    // identical in this log, so add the cause.
    const cause = error?.cause?.code || error?.cause?.message;
    const reason = error?.name === 'AbortError'
      ? `timed out after ${WEB_PROXY_TIMEOUT_MS / 1000}s`
      : `${error?.message || 'fetch failed'}${cause ? ` (${cause})` : ''}`;
    console.error(`⚠ [Relay WebProxy] ${upstreamUrl} → ${reason}`);
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', ...WEB_PROXY_FRAME_HEADERS });
    res.end(`<!doctype html><meta charset="utf-8"><title>Proxy error</title>
<body style="font:13px/1.6 -apple-system,system-ui,sans-serif;padding:24px;color:#ddd;background:#18181b">
<h2 style="font-size:15px">Could not load this page</h2>
<p style="color:#a1a1aa">${reason}</p></body>`);
    return;
  } finally {
    clearTimeout(timer);
  }

  const outHeaders = {};
  for (const [key, value] of upstream.headers) {
    const k = key.toLowerCase();
    if (!WEB_PROXY_ALLOW_RES.has(k)) continue;
    outHeaders[k] = value;
  }
  // A nested document under the app shell's `credentialless` embedder must
  // declare a COEP at least as strict, or Chromium refuses it outright
  // (`coep-frame-resource-needs-coep-header`). And because this document is
  // CROSS-origin to that embedder, COEP makes the default CORP `same-origin`,
  // so CORP must be stated explicitly or the frame is refused with
  // `corp-not-same-origin-after-defaulted-to-same-origin-by-coep`. Both were
  // measured; see MEMORY.md.
  outHeaders['cache-control'] = 'no-store';
  Object.assign(outHeaders, WEB_PROXY_FRAME_HEADERS);
  if (req.headers.origin) {
    outHeaders['access-control-allow-origin'] = req.headers.origin;
    outHeaders['access-control-allow-private-network'] = 'true';
  }

  const contentType = String(upstream.headers.get('content-type') || '');

  if (contentType.includes('text/html')) {
    let html = await upstream.text();
    if (html.length > WEB_PROXY_MAX_BODY) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('response too large to proxy');
      return;
    }

    // The base must be the FINAL URL — origin AND directory.
    //
    // Origin, because fetch followed redirects and a relative URL on the landed
    // page belongs to where it landed, not where we asked: without it a
    // bare-domain address that redirects to its www host resolves every
    // relative asset back to the pre-redirect host.
    //
    // Directory, because `<base href>` OVERRIDES the document URL for relative
    // resolution. Serving `…/p/<enc>/html/page.html` with a base of
    // `…/p/<enc>/` does not merely fail to help — it breaks what would
    // otherwise have worked, since the document URL already carries the right
    // path. Measured: a page at `/html/…` whose `<video>` used the relative
    // `mov_bbb.mp4` had it resolved to `/mov_bbb.mp4` upstream, a 404, and the
    // media element ended `NETWORK_NO_SOURCE` with `readyState: 0`. Sites built
    // on root-absolute paths are unaffected either way, which is why this
    // survived: the breakage is invisible until a page uses document-relative
    // URLs for an asset or a media source.
    //
    // Root-absolute URLs still resolve against this origin's root and take the
    // un-prefixed path below, so they are unaffected by the directory.
    // (Deliberately written without literal URLs: relay-install-audit.mjs scans
    // this source for them and would report them as calls the relay makes.)
    let finalOrigin = target.origin;
    let finalDir = (match[2] || '/').replace(/[^/]*$/, '');
    try {
      if (upstream.url) {
        const landed = new URL(upstream.url);
        finalOrigin = landed.origin;
        finalDir = landed.pathname.replace(/[^/]*$/, '');
      }
    } catch (_) { /* keep the requested origin and directory */ }
    if (!finalDir) finalDir = '/';

    const base = `${proxyOrigin}/p/${webProxyEncode(finalOrigin)}${finalDir}`;

    // Absolute media sources bypass `<base href>` entirely: `<video
    // src="https://cdn.other/v.mp4">` makes the browser fetch the CDN
    // DIRECTLY, from a document whose origin is this loopback proxy — exactly
    // the request those CDNs reject (measured 2026-09-12: a video CDN answered
    // 470 to every posture when the referer/origin was not the real site).
    // Route media through this proxy so the fetch happens here, with the
    // embedding site's referer (see the header assembly above). Same-origin
    // absolute URLs are rewritten too: they would otherwise leave the proxy
    // and lose the same referer treatment.
    const proxifyAbsolute = (u) => {
      try {
        const abs = new URL(u, finalOrigin);
        if (!['http:', 'https:'].includes(abs.protocol)) return u;
        if (abs.origin === proxyOrigin) return u;
        return `${proxyOrigin}/p/${webProxyEncode(abs.origin)}${abs.pathname}${abs.search}${abs.hash}`;
      } catch (_) { return u; }
    };
    html = html.replace(
      /(<(?:video|audio|source|track|img)\b[^>]*?\b(?:src|poster)=)(["'])(https?:\/\/[^"']+)\2/gi,
      (m, pre, q, u) => `${pre}${q}${proxifyAbsolute(u)}${q}`
    );
    // The only script injected. It exists because the parent frames a loopback
    // origin it cannot touch: `contentWindow` is cross-origin, so the toolbar
    // has no other way to drive or observe this document.
    //   • 'ready' — proof the frame actually rendered. Chrome can refuse the
    //     loopback load outright (Local/Private Network Access from a public
    //     origin) and a refused frame still fires `load` on the iframe, so the
    //     parent needs a signal from INSIDE the document before it can trust it.
    //   • 'alive' — a heartbeat, so the parent can tell a merely slow page from
    //     one whose document has been REPLACED (its own JS navigated to an
    //     origin that refuses framing, leaving a chrome-error page). 'ready'
    //     cannot distinguish those; it only proves the document parsed. The
    //     interval dies with the document, so the heartbeat stopping IS the
    //     signal — a cross-origin frame offers the parent no other one.
    //     Measured NOT to fire for youtube.com, which renders fine.
    //   • 'url'   — keeps the omnibox honest while the page navigates itself
    //     (relative links go back through this proxy, so the parent never sees
    //     them otherwise).
    //   • the command listener gives the toolbar working Back/Forward/Reload,
    //     which `contentWindow.history` cannot provide across origins.
    // ── bot-check pages deserve an explanation, not a mystery ────────────────
    // Google (and other engines) answer cookie-less automated-feeling searches
    // with their "unusual traffic" reCAPTCHA wall. The request SUCCEEDED — the
    // target simply refuses to serve results. Two things make the wall a dead
    // end here, and both are by design: the page carries no cookies (the relay
    // holds no jar — one shared loopback origin cannot leak one site's session
    // to another), and the reCAPTCHA widget is domain-bound to the target, so
    // it cannot render from this proxy origin at all (measured: "Localhost is
    // not in the list of supported domains for this site key"). Injecting an
    // explanation into the page beats leaving the user staring at a broken
    // captcha. Deliberately narrow (both markers) so a page that merely
    // MENTIONS captchas is not flagged.
    let botCheckBanner = '';
    if (/unusual traffic/i.test(html) && /recaptcha/i.test(html)) {
      botCheckBanner =
        '<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#1c1917;color:#fde68a;font:12px/1.5 system-ui,sans-serif;' +
        'padding:10px 14px;border-bottom:1px solid #78716c">' +
        '<strong>This is a bot-check page served by the site itself, not a proxy error.</strong> ' +
        'Proxied pages carry no cookies, and the captcha widget cannot run from ' +
        'the proxy origin. Use the <em>Tab</em> button in the toolbar to open this page in your ' +
        'real browser, or try a different search engine.</div>';
    }
    const injected = `<base href="${base}">` +
      botCheckBanner +
      `<script>(function(){` +
      `function post(m){try{parent.postMessage(m,'*')}catch(e){}}` +
      `function report(){post({__mpProxy:'url',href:location.href})}` +
      `post({__mpProxy:'ready'});` +
      `try{setInterval(function(){post({__mpProxy:'alive'})},2000)}catch(e){}` +
      `try{addEventListener('load',report);addEventListener('popstate',report)}catch(e){}` +
      `addEventListener('message',function(e){var d=e.data;if(!d||typeof d!=='object')return;` +
      `try{if(d.__mpProxyCmd==='back')history.back();` +
      `else if(d.__mpProxyCmd==='forward')history.forward();` +
      `else if(d.__mpProxyCmd==='reload')location.reload()}catch(e){}});` +
      // Some search result pages navigate with location.assign/replace or
      // window.open instead of a normal anchor click. Those navigations would
      // leave the relay origin and commonly become "127.0.0.1 refused to
      // connect" inside the iframe. Route same-frame programmatic navigation
      // through the parent just like absolute anchor clicks.
      `function go(u,k){try{post({__mpBrowser:k||'goto',url:new URL(String(u),document.baseURI).href})}catch(e){}}` +
      `try{Location.prototype.assign=function(u){go(u,'goto')};Location.prototype.replace=function(u){go(u,'goto')}}catch(e){}` +
      `try{window.open=function(u,t){if(u==null||u==='')return null;go(u,t==null||t===''||t==='_self'?'goto':'newtab');return null}}catch(e){}` +
      // GET forms (especially Google Search) must be parent-driven too. Native
      // submission resolves root-relative actions against the relay listener;
      // a fast redirect can then race the port repair and show a refused frame.
      // Serialize the form and send the final absolute URL through the parent.
      `try{addEventListener('submit',function(e){var f=e.target;if(!f||String(f.method||'get').toLowerCase()!=='get')return;` +
      `var u=new URL(f.action||location.href,document.baseURI),p=new URLSearchParams(u.search),d=new FormData(f);` +
      `for(var x of d.entries())p.append(x[0],x[1]);u.search=p.toString();e.preventDefault();go(u.href,'goto')},true)}catch(e){}` +
      // form.submit() fires NO submit event, so the listener above cannot see
      // it — and JS-heavy sites call exactly that (measured: Google's search
      // box does, which is how the user's GET escaped to the relay root as an
      // un-prefixed /search and hit the info page). Patch the method itself:
      // a GET form goes through the parent like every other navigation; a
      // non-GET form (or a top-level page with no parent to ask) falls back to
      // the native method.
      `try{var __mpOrigSubmit=HTMLFormElement.prototype.submit;HTMLFormElement.prototype.submit=function(){` +
      `if(parent===window||String(this.method||'get').toLowerCase()!=='get')return __mpOrigSubmit.apply(this,arguments);` +
      `try{var u=new URL(this.action||location.href,document.baseURI),p=new URLSearchParams(u.search),d=new FormData(this);` +
      `for(var x of d.entries())p.append(x[0],x[1]);u.search=p.toString();go(u.href,'goto')}catch(e){return __mpOrigSubmit.apply(this,arguments)}}}catch(e){}` +
      // ── the one case <base> cannot cover for SUBRESOURCES: absolute fetch/XHR ─
      // Video players rarely set <video src> directly any more: they FETCH the
      // media endpoint (often on the site's own origin, redirecting to a CDN)
      // and feed the bytes to MSE. An absolute URL ignores <base href>, so the
      // request leaves the proxy as a CROSS-ORIGIN fetch from this loopback
      // origin — and the target's CORS answer names ITS site, never ours, so
      // Chromium kills it and the player sticks on "loading" forever (measured
      // 2026-09-12 on a video site: "Access to fetch … blocked by CORS policy",
      // player logs "MP4 failed", video never starts). Rewrite absolute
      // http(s) URLs through this proxy: same-origin from the page's view, and
      // the relay fetches upstream with the site's own referer.
      `function mpRewrite(u){try{` +
      `var s=(u&&typeof u==='object'&&u.url)?String(u.url):String(u==null?'':u);` +
      `var abs=new URL(s,document.baseURI);` +
      // A protocol check avoids the fragile /^https?:\\/\\// escape dance inside
      // a template literal: [literal slash] and [+] in a CHARACTER CLASS need no
      // backslashes at all, so this survives the minifier and re-stringify.
      `if(abs.protocol!=='http:'&&abs.protocol!=='https:')return u;` +
      `if(abs.origin===location.origin)return u;` +
      `var b=btoa(abs.origin).replace(/[+]/g,'-').replace(/[/]/g,'_').replace(/=+$/,'');` +
      `return location.origin+'/p/'+b+abs.pathname+abs.search+abs.hash;` +

      `}catch(e){return u}}` +
      `try{var __mpFetch=window.fetch;window.fetch=function(u,o){try{` +
      `var s=(u&&typeof u==='object'&&u.url)?String(u.url):String(u);` +
      `var r=mpRewrite(s);` +
      `if(r===s)return __mpFetch.apply(window,arguments);` +
      `if(u&&typeof u==='object'&&u.url)return __mpFetch.call(window,new Request(r,u),o);` +
      `return __mpFetch.call(window,r,o);` +
      `}catch(e){return __mpFetch.apply(window,arguments)}}}catch(e){}` +
      `try{var __mpOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){` +
      `arguments[1]=mpRewrite(u);return __mpOpen.apply(this,arguments)}}catch(e){}` +
      // ── the last frontier: DYNAMIC element src ───────────────────────────
      // The MGP player does not put the video in HTML and does not use
      // fetch(): it assigns el.src = <absolute CDN url> at play time
      // (measured 2026-09-12 on the user's video site). A cross-origin media
      // element request dies on the CDN's hotlink check (referer/origin are
      // this loopback proxy, not the site). Route it through the relay like
      // fetch/XHR by shadowing the src setters — the value is rewritten the
      // same way, and a value already on this origin passes through.
      `try{var __mv=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');` +
      `if(__mv&&__mv.set){var __mvo=__mv.set;Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,` +
      `enumerable:__mv.enumerable,get:__mv.get,set:function(v){try{v=mpRewrite(v)}catch(e){}__mvo.call(this,v)}})}` +
      `}catch(e){}` +
      `try{var __ms=Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype,'src');` +
      `if(__ms&&__ms.set){var __mso=__ms.set;Object.defineProperty(HTMLSourceElement.prototype,'src',{configurable:true,` +
      `enumerable:__ms.enumerable,get:__ms.get,set:function(v){try{v=mpRewrite(v)}catch(e){}__mso.call(this,v)}})}` +
      `}catch(e){}` +
      // Some sites navigate with location.href = <absolute url> (JS, not a
      // link click and not .assign/.replace, so NONE of the hooks above see
      // it) — treat an external href write like any external navigation.
      `try{var __ml=Object.getOwnPropertyDescriptor(Location.prototype,'href');` +
      `if(__ml&&__ml.set){var __mlo=__ml.set;Object.defineProperty(Location.prototype,'href',{configurable:true,` +
      `enumerable:__ml.enumerable,get:__ml.get,set:function(v){try{` +
      `var u=new URL(String(v),document.baseURI);` +
      `if((u.protocol==='http:'||u.protocol==='https:')&&u.origin!==location.origin)return go(u.href,'goto')` +
      `}catch(e){}__mlo.call(this,v)}})}` +
      `}catch(e){}` +
      // ── the one case the base cannot cover: an ABSOLUTE link ──────────────
      // A relative href resolves through <base href> and stays inside the
      // proxy, which is why nothing else here intercepts clicks. An absolute
      // href does not: it resolves to the real origin, the frame navigates
      // there, and a site that refuses framing (x-frame-options,
      // frame-ancestors) turns the frame into a chrome error — one click and
      // the page is gone. Measured on a relay-rendered page: the frame ended on
      // the target's own help page, having left the proxy entirely.
      //
      // So intercept ONLY clicks that would leave the proxy, and hand the real
      // destination to the parent. The parent owns navigation (it re-points the
      // frame through the proxy and keeps the tab's history), and it already
      // handles these messages for the server-side proxy.
      //
      // Two deliberate bail-outs:
      //   • top level (parent === window) — there is no parent to ask, and
      //     swallowing the click would break the page for anyone who opened
      //     this URL directly;
      //   • anything already on the proxy origin — relative links, and the
      //     un-prefixed fallback's redirects. Passing one of those up would
      //     have the parent wrap a proxy URL in another proxy URL, i.e. point
      //     the relay at itself.
      `addEventListener('click',function(e){try{` +
      `if(parent===window)return;` +
      `if(e.defaultPrevented||e.button!==0)return;` +
      `var a=e.target;while(a&&a.tagName!=='A')a=a.parentElement;` +
      `if(!a||!a.href||a.hasAttribute('download'))return;` +
      `var u=new URL(a.href,document.baseURI);` +
      `if(u.protocol!=='http:'&&u.protocol!=='https:')return;` +
      `if(u.origin===location.origin)return;` +
      `e.preventDefault();` +
      `post({__mpBrowser:(a.target==='_blank'||e.metaKey||e.ctrlKey||e.shiftKey)?'newtab':'goto',url:u.href});` +
      `}catch(x){}},true);` +
      `})()</script>`;
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
    else html = injected + html;

    const buf = Buffer.from(html, 'utf8');
    outHeaders['content-length'] = String(buf.length);
    // Remember where this listener is currently pointed, so an un-prefixed
    // navigation (see the root-absolute note above) can be sent back through
    // the proxy instead of hitting the informational page. Our own cookie, not
    // the target's — upstream Set-Cookie is dropped above.
    outHeaders['set-cookie'] =
      `${WEB_PROXY_COOKIE}=${encodeURIComponent(webProxyEncode(finalOrigin))}; Path=/; SameSite=Lax`;
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
    return;
  }

  // ── everything that is not HTML: STREAM it, do not buffer ────────────────
  //
  // The HTML branch above buffers because it must (it rewrites the document),
  // and it is bounded by WEB_PROXY_MAX_BODY. Nothing bounded this branch, and
  // the case that matters is media: a `<video>` opens with `Range: bytes=0-`,
  // which a range-capable origin answers with the WHOLE file in a single 206.
  // So the relay held the entire video in memory and the player saw nothing
  // until all of it had arrived — a long video was slow to start, and a very
  // large one could take the relay down with it. That matters because a dead
  // listener is the one failure the app shows as a REFUSED CONNECTION rather
  // than as this proxy's own error page.
  //
  // `content-length` must not simply be forwarded. undici decodes the body
  // transparently but leaves `content-encoding` and the COMPRESSED length in
  // place (measured: 2667 gzip bytes against 8329 decoded), so a forwarded
  // length truncates the response. Forward it only when nothing was decoded;
  // otherwise omit it and let the response be chunked, which is honest.
  const decoded = upstream.headers.get('content-encoding');
  const upstreamLength = upstream.headers.get('content-length');
  if (!decoded && upstreamLength) outHeaders['content-length'] = upstreamLength;

  res.writeHead(upstream.status, outHeaders);

  if (!upstream.body) { res.end(); return; }

  // A player cancels range requests constantly — every seek abandons one. Stop
  // pulling from upstream the moment the frame stops listening, or the relay
  // keeps downloading a file nobody is waiting for.
  //
  // Aborting the FETCH is what works here, not cancelling the body: the body is
  // already locked by the iteration below, and `cancel()` on a locked stream
  // throws `ERR_INVALID_STATE` — which is unhandled inside a 'close' listener
  // and takes the whole relay process down. Measured, the hard way.
  let gone = false;
  res.on('close', () => {
    if (res.writableEnded) return;
    gone = true;
    try { controller.abort(); } catch (_) { /* already finished */ }
  });

  const waitDrain = () => new Promise((resolve) => {
    const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
    res.on('drain', done);
    res.on('close', done);
  });

  try {
    for await (const chunk of upstream.body) {
      if (gone || res.destroyed || res.writableEnded) break;
      if (!res.write(chunk)) await waitDrain();
    }
  } catch (_) {
    // The frame went away or upstream died mid-body. Both are normal for media;
    // the response simply ends, which is what a truncated range looks like to
    // the player, and the player retries.
  }
  if (!res.writableEnded && !res.destroyed) res.end();
}

function startWebProxy() {
  if (webProxyServer) return;
  const server = http.createServer((req, res) => {
    handleWebProxyHttp(req, res).catch((error) => {
      console.error(`✗ [Relay WebProxy] ${error.message}`);
      try { res.writeHead(502); res.end('proxy error'); } catch (_) {}
    });
  });
  // WebSocket upgrades are not proxied: a relative `ws://` inside a proxied page
  // would otherwise hang. Refuse loudly rather than half-open.
  server.on('upgrade', (req, socket) => {
    try { socket.destroy(); } catch (_) {}
  });

  let port = WEB_PROXY_PORT;
  let attempts = 0;
  const tryListen = () => {
    server.once('error', (error) => {
      if (attempts < 10 && error.code === 'EADDRINUSE') {
        attempts += 1;
        port += 1;
        tryListen();
        return;
      }
      console.error(`✗ [Relay WebProxy] ${error.message}`);
    });
    server.listen(port, '127.0.0.1', () => {
      webProxyServer = server;
      webProxyPort = port;
      console.log(`🌐 [Relay WebProxy] in-app browser proxy on http://127.0.0.1:${port}`);
      // Tell the monitor where it landed. The requested port is only a hint —
      // another listener may already own it, which is why the real one is
      // reported rather than assumed.
      try {
        if (activeWs && activeWs.readyState === 1) {
          activeWs.send(JSON.stringify({ type: 'webproxy:ready', port }));
        }
      } catch (_) { /* best effort */ }
    });
  };
  tryListen();
}

// ── Main connection loop ──────────────────────────────────────────────────
let activeWs = null;
function connect() {
  if (!SERVER || !TOKEN) {
    console.error('❌ Server and token required. Run with: --server URL --token TOKEN');
    process.exit(1);
  }

  // The token travels in a handshake header, NOT the query string.
  //
  // Pairing exists to keep the token out of argv and shell history, and it
  // succeeds at that — but a `?token=` URL is routinely written to server
  // access logs, so the secret ended up persisted in log storage anyway.
  // A WebSocket client (unlike a browser) can set handshake headers, so send
  // it as a bearer credential where logs do not record it.
  //
  // server.js accepts the header and still falls back to ?token= so relays
  // installed before this change keep working until they update.
  //
  // The same fallback covers the no-`ws`-package case: with the global
  // WebSocket we cannot set headers at all, so the query string is the only
  // way to authenticate. Degraded, but better than a relay that cannot connect.
  const wsBase = SERVER.replace(/^http/, 'ws');
  const wsUrl = WS_CAN_SET_HEADERS
    ? wsBase + '/relay-ws'
    : wsBase + `/relay-ws?token=${encodeURIComponent(TOKEN)}`;
  console.log(`\n🔗 SSH Monitor Enhanced Local Relay`);
  console.log(`   Server: ${SERVER}`);
  console.log(`   SSH2:   ${ssh2 ? 'available' : 'not installed'}`);
  console.log(`   Connecting...`);

  let ws;
  try {
    ws = WS_CAN_SET_HEADERS
      ? new WS(wsUrl, { headers: { authorization: `Bearer ${TOKEN}` } })
      : new WS(wsUrl);
    activeWs = ws;
  } catch (err) {
    console.error('❌ WebSocket failed:', err.message);
    setTimeout(connect, retryDelay);
    return;
  }

  let keepAlive = null;
  let lastPongAt = Date.now();

  ws.addEventListener('open', () => {
    retryDelay = 3000;
    lastPongAt = Date.now();
    // Don't send init here — wait for 'ready' from server
    // Shorter ping interval (12s) prevents mobile/carrier NAT drops.
    // Watchdog: If no pong received within 28s, force-reconnect the dead socket.
    keepAlive = setInterval(() => {
      if (ws.readyState === 1) {
        if (Date.now() - lastPongAt > 28000) {
          console.log('\n⚠ Mobile/Network timeout: missed keepalive replies. Reconnecting...');
          try { if (ws.terminate) ws.terminate(); else ws.close(4008, 'Keepalive watchdog timeout'); } catch (_) {}
          return;
        }
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 12000);
  });

  ws.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // O(1) dispatch — switch is faster than 27 linear if-checks for every message
    switch (msg.type) {
      // ── TCP relay ──
      case 'ready':
        ws.send(JSON.stringify({ type: 'init', relayName: RELAY_NAME, version: RELAY_VERSION, capabilities: { ssh: !!ssh2, sftp: !!ssh2, docker: true, ai: true }, webProxyPort: webProxyPort || null }));
        console.log(`\n✅ Relay ready! Name: ${RELAY_NAME}, Capabilities: SSH=${!!ssh2}, SFTP=${!!ssh2}, Docker=true, AI=true`);
        startDiscoveryServer(RELAY_NAME);
        // The in-app browser's client-side renderer. Started on every (re)connect
        // because a reconnect is exactly when the monitor has forgotten the port:
        // `startWebProxy` is a no-op once bound, and the announce below re-sends
        // the port for the new socket instead of waiting for a rebind.
        startWebProxy();
        try {
          if (webProxyPort && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'webproxy:ready', port: webProxyPort }));
          }
        } catch (_) { /* best effort */ }
        break;

      case 'open': {
        const { connId } = msg;
        const tcpHost = msg.host || 'localhost';
        const tcpPort = Number(msg.port) || 22;
        console.log(`📡 [relay] open ${connId} → ${tcpHost}:${tcpPort}`);
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
      case 'webui:forward':   handleWebuiForward(msg).catch(err => reportWebuiFailure(msg, err)); break;
      case 'ssh:exec':        handleSshExec(ws, msg);    break;
      case 'ssh:disconnect':  cleanupSsh(msg.connId);    break;
      case 'ai:chat':         handleAiChat(ws, msg);     break;

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

      case 'pong':
        lastPongAt = Date.now();
        break;

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
// ── WebUI direct gateway ─────────────────────────────────────────────────────
// Browser → http://127.0.0.1:<localPort> (this relay) → SSH direct-tcpip →
// target's WebUI port. The central server stays out of the data path entirely;
// it only sends this control message. The WebSocket the hosted app opens is
// same-origin (the gateway rewrites the bootstrap ws_url), so it tunnels here too.
const webuiGateways = new Map(); // forwardId → { server, ssh, port, remotePort }

function webuiSshConnect(gw) {
  return new Promise((resolve, reject) => {
    const ssh = new ssh2.Client();
    ssh.on('ready', () => resolve(ssh));
    ssh.on('error', reject);
    ssh.on('close', () => { try { gw.sshDead = true; } catch {} });
    const cfg = {
      host: gw.sshCfg.host,
      port: gw.sshCfg.port || 22,
      username: gw.sshCfg.username || 'root',
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    };
    if (gw.sshCfg.privateKey) cfg.privateKey = gw.sshCfg.privateKey;
    if (gw.sshCfg.password) cfg.password = gw.sshCfg.password;
    if (gw.sshCfg.passphrase) cfg.passphrase = gw.sshCfg.passphrase;
    ssh.connect(cfg);
  });
}

// Reconnect on demand — the SSH connection can drop (network hiccup, target
// restart); without this every request would 502 forever after one drop.
async function webuiEnsureSsh(gw) {
  if (gw.ssh && !gw.sshDead) return gw.ssh;
  console.log(`🔁 [Relay WebUI] SSH connection stale — reconnecting...`);
  gw.sshDead = false;
  gw.ssh = await webuiSshConnect(gw);
  return gw.ssh;
}

/**
 * Tell the monitor that a `webui:forward` failed, instead of only logging it here.
 *
 * Without this the server cannot distinguish "no relay is connected" from "the
 * relay is connected but the tunnel failed". It therefore sits out its full ack
 * timeout (~20 s) and then reports the former — which is wrong and unactionable
 * when the real cause was, say, SSH auth or a dead agent port. The user is told
 * to check that Local Relay is running while it is running perfectly well.
 *
 * Best-effort by design: if the socket is gone the server's timeout still
 * covers us, so a throw here must never mask the original error.
 */
function reportWebuiFailure(msg, err) {
  const forwardId = msg && msg.forwardId;
  const message = (err && err.message) ? err.message : String(err);
  console.error(`✗ [Relay WebUI] ${message}`);
  if (!forwardId) return;
  try {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify({ type: 'webui:fail', forwardId, error: message }));
    }
  } catch (_) { /* best effort */ }
}

async function handleWebuiForward(msg) {
  if (!ssh2) throw new Error('ssh2 not installed on relay agent');
  const { forwardId, connection, remotePort, monitorOrigin, bootstrapSecret } = msg;
  if (!forwardId || !connection) throw new Error('webui:forward missing fields');
  if (webuiGateways.has(forwardId)) {
    console.log(`🔁 [Relay WebUI] gateway already running for ${forwardId}`);
    // Still ack: the monitor is waiting for the port before it answers the
    // browser, and "already running" is the common case (second click, or a
    // page reload). Without this the request would sit until it timed out.
    try {
      const existing = webuiGateways.get(forwardId);
      if (activeWs && activeWs.readyState === 1) {
        activeWs.send(JSON.stringify({ type: 'webui:ready', forwardId, localPort: existing.port, remotePort: existing.remotePort }));
      }
    } catch (_) { /* best effort */ }
    return;
  }
  const gw = {
    forwardId,
    remotePort: Number(remotePort) || 8765,
    port: Number(msg.localPort) || 18790,
    monitorOrigin: monitorOrigin || '',
    bootstrapSecret: (typeof bootstrapSecret === 'string' && bootstrapSecret) ? bootstrapSecret : '',
    ssh: null,
    sshCfg: {
      host: connection.host,
      port: connection.port || 22,
      username: connection.username || 'root',
    },
  };
  if (connection.privateKey) gw.sshCfg.privateKey = connection.privateKey;
  if (connection.password) gw.sshCfg.password = connection.password;
  if (connection.passphrase) gw.sshCfg.passphrase = connection.passphrase;

  gw.ssh = await webuiSshConnect(gw);
  console.log(`✅ [Relay WebUI] SSH ready → forwarding 127.0.0.1:${gw.port} → 127.0.0.1:${gw.remotePort}`);

  const server = http.createServer((req, res) => {
    handleWebuiHttp(gw, req, res).catch(() => { try { res.end(); } catch {} });
  });
  server.on('upgrade', (req, sock, head) => handleWebuiUpgrade(gw, req, sock, head));

  await new Promise((resolve, reject) => {
    let attempts = 0;
    const tryListen = () => {
      server.once('error', (e) => {
        if (attempts < 10 && e.code === 'EADDRINUSE') { gw.port += 1; attempts += 1; tryListen(); }
        else reject(e);
      });
      server.listen(gw.port, '127.0.0.1', resolve);
    };
    tryListen();
  });
  webuiGateways.set(forwardId, gw);
  // End-to-end verification BEFORE acking. The monitor navigates a browser
  // tab the moment we report the port, so "listening" is not enough — the
  // SSH tunnel to the agent must already carry traffic. The browser cannot
  // verify this itself (its fetch() to 127.0.0.1 is blocked on production by
  // the app's CSP connect-src and by Private Network Access), so the relay
  // probes its own loopback listener instead. A request to '/' exercises the
  // FULL chain: local listener → gateway handler → SSH forwardOut → agent
  // Web UI. Any 2xx/3xx/4xx proves the agent is serving (401/403 = auth on,
  // still alive); only a transport failure counts as not-ready.
  try {
    const PROBE_ROUNDS = 6;
    const PROBE_WAIT_MS = 1000;
    let verified = false;
    for (let i = 0; i < PROBE_ROUNDS && !verified; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, PROBE_WAIT_MS));
      verified = await new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        const rq = http.get({ host: '127.0.0.1', port: gw.port, path: '/', timeout: 4000 }, (rs) => {
          rs.resume();
          done(!!rs.statusCode && rs.statusCode < 500);
        });
        rq.on('error', () => done(false));
        rq.on('timeout', () => { try { rq.destroy(); } catch {} done(false); });
      });
    }
    if (verified) {
      console.log(`✅ [Relay WebUI] end-to-end check passed → http://127.0.0.1:${gw.port} reaches the agent`);
    } else {
      // Non-fatal: ack anyway. The tab will surface the real error (or the
      // gateway may simply have been slow); silence here would hang the monitor.
      console.log(`⚠️ [Relay WebUI] end-to-end check inconclusive after ${PROBE_ROUNDS} attempts — acking anyway`);
    }
  } catch (_) { /* verification is best-effort; never block the ack */ }
  console.log(`🌐 [Relay WebUI] gateway live at http://127.0.0.1:${gw.port} (direct transfer, no central middleman)`);
  // Report the port we ACTUALLY bound. The monitor asks for 18790, but if a
  // gateway for another connection already holds it we silently walk up to
  // 18791, 18792… Without this ack the monitor keeps telling the browser
  // "18790", so opening connection B's Web UI would show connection A's
  // gateway — wrong nanobot instance, and usually a 401 because that
  // instance's bootstrap secret doesn't match. Always send, even when the
  // port matches, so the monitor never has to time out waiting.
  try {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify({ type: 'webui:ready', forwardId, localPort: gw.port, remotePort: gw.remotePort }));
    }
  } catch (_) { /* best effort */ }
}

async function handleWebuiHttp(gw, req, res) {
  // ── Private Network Access preflight (MUST be answered here) ──
  // The hosted monitor is a PUBLIC https site, while this gateway runs on the
  // user's LOCAL device. Every app-initiated request or tab navigation from
  // the monitor to http://127.0.0.1:<port> makes Chrome send a CORS preflight
  // that must carry `Access-Control-Allow-Private-Network: true`. Forwarding
  // OPTIONS to the agent gateway can never add that header, so Chrome silently
  // blocks the navigation and the opened Web UI tab hangs on "Opening Web
  // UI…". (Pasting the URL into the address bar has no initiator website, so
  // it skips the check — which is why paste-in-browser always worked.)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }
  if (req.url === '/__relay_ping') {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'access-control-allow-origin': '*',
      'access-control-allow-private-network': 'true',
    });
    res.end('pong');
    return;
  }
  if (!gw.ssh) { res.writeHead(503); res.end('gateway connecting'); return; }
  const ssh = await webuiEnsureSsh(gw);
  const stream = await new Promise((resolve, reject) =>
    ssh.forwardOut('127.0.0.1', 0, '127.0.0.1', gw.remotePort, (e, s) => e ? reject(e) : resolve(s)));
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: `127.0.0.1:${gw.remotePort}` };
    // Drop cookies: the browser shares one cookie jar across every 127.0.0.1
    // port, so this jar also holds the monitor app's session cookie — it must
    // not leak to the agent gateway.
    delete headers.cookie;
    // NEVER drop `authorization`. The nanobot SPA mints an api_token from
    // GET /webui/bootstrap and then sends it as `Authorization: Bearer nbwt_…`
    // on every /api/* call. Stripping it here makes the gateway answer
    // 401 "Unauthorized" to all of them (settings/sessions/workspaces), while
    // the token still works if passed as ?token= — which is why the failure
    // looks like "the Web UI loaded but can't load settings".
    const upstream = http.request({
      createConnection: () => stream,
      hostname: '127.0.0.1', port: gw.remotePort, path: req.url, method: req.method, headers,
    }, (ur) => {
      const out = [];
      ur.on('data', (c) => out.push(c));
      ur.on('end', () => {
        let buf = Buffer.concat(out);
        const ct = (ur.headers['content-type'] || '').toLowerCase();
        // Point the hosted app's WebSocket at this gateway (same origin)
        if (ct.includes('application/json') || ct.includes('javascript') || ct.includes('text/')) {
          const re = new RegExp('(wss?://)(?:localhost|127\\.0\\.0\\.1)(?::' + gw.remotePort + ')?(/[^\\s"\'`]*)?', 'gi');
          const nt = buf.toString('utf8').replace(re, (_m, sch, p) => `${sch}127.0.0.1:${gw.port}${p || '/'}`);
          if (nt !== buf.toString('utf8')) {
            buf = Buffer.from(nt, 'utf8');
          }
        }
        // Auto-pair the SPA on ANY page load: nanobot authenticates the browser via
        // the bootstrap secret, which it only reads from the entry URL hash
        // (#/?bootstrapSecret=…) or localStorage. A deep link opened directly
        // (e.g. /#/settings?section=models) carries neither → the app bootstraps
        // with no secret → no api_token → settings/API calls answer 401
        // "Unauthorized" → "Could not load settings". The relay knows the secret
        // (sent by the monitor route), so inject it like the entry URL does.
        if (ct.includes('text/html') && gw.bootstrapSecret) {
          const reactKey = 'nanobot-webui.bootstrap-secret';
          const secJson = JSON.stringify(gw.bootstrapSecret);
          const pairScript =
            `<script>(function(){try{var k=${JSON.stringify(reactKey)};` +
            `if(!window.localStorage.getItem(k))window.localStorage.setItem(k,${secJson});` +
            `var h=window.location.hash||"";` +
            `if(h.indexOf("bootstrapSecret=")<0){` +
            `var qi=h.indexOf("?"),b=qi<0?h:h.slice(0,qi),q=qi<0?"":h.slice(qi+1);` +
            `var p=new URLSearchParams(q);p.set("bootstrapSecret",${secJson});` +
            `var ns=b+"?"+p.toString();window.history.replaceState(null,"",ns);` +
            `}}catch(e){}})();</script>`;
          const html = buf.toString('utf8');
          if (html.includes('</head>') || html.includes('<head>')) {
            const injected = html.includes('</head>')
              ? html.replace('</head>', pairScript + '</head>')
              : html.replace('<head>', '<head>' + pairScript);
            if (injected !== html && !html.includes('nanobot-webui.bootstrap-secret')) {
              buf = Buffer.from(injected, 'utf8');
            }
          }
        }
        const h = { ...ur.headers };
        delete h['x-frame-options']; delete h['content-security-policy'];
        h['cross-origin-resource-policy'] = 'cross-origin';
        h['cache-control'] = 'no-store, max-age=0';
        // Mirror the preflight answer on real responses too: the monitor page
        // (public https) is the initiator for every request it triggers, so
        // Chrome's Private Network Access check applies to all of them.
        h['access-control-allow-origin'] = req.headers.origin || '*';
        h['access-control-allow-private-network'] = 'true';
        // A rewrite changed the body length — content-length must match or
        // clients truncate the body (JSON parse errors / clipped scripts).
        delete h['transfer-encoding'];
        h['content-length'] = String(buf.length);
        try { res.writeHead(ur.statusCode || 502, h); } catch {}
        try { res.end(buf); } catch {}
      });
    });
    upstream.on('error', () => { try { res.writeHead(502); res.end('tunnel error'); } catch {} });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

function handleWebuiUpgrade(gw, req, sock, head) {
  webuiEnsureSsh(gw).then(ssh => {
    ssh.forwardOut('127.0.0.1', 0, '127.0.0.1', gw.remotePort, (err, stream) => {
    if (err) { try { sock.destroy(); } catch {} return; }
    // Replay the handshake to the remote (rewrite loopback origin so the
    // remote's own origin checks pass).
    const skip = new Set(['host', 'connection', 'upgrade', 'cookie', 'authorization', 'origin']);
    let raw = `${req.method} ${req.url} HTTP/1.1\r\nHost: 127.0.0.1:${gw.remotePort}\r\nOrigin: http://127.0.0.1:${gw.remotePort}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (skip.has(k)) continue;
      raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
    }
    raw += 'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n';
    stream.write(raw);
    if (head && head.length) stream.write(head);
    stream.on('data', (d) => { try { sock.write(d); } catch {} });
    sock.on('data', (d) => { try { stream.write(d); } catch {} });
    const cleanup = () => { try { stream.end(); } catch {} try { sock.destroy(); } catch {} };
    sock.on('close', cleanup); sock.on('error', cleanup);
    stream.on('close', cleanup); stream.on('error', cleanup);
    });
  }).catch(() => { try { sock.destroy(); } catch {} });
}

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
    compress: true,  // enable SSH compression — helps significantly on text/code files
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

// ── AI chat proxy ───────────────────────────────────────────────────────────
// Performs the LLM provider call LOCALLY on this machine so the server never
// makes outbound AI requests (saves server bandwidth/egress and keeps the
// server IP out of provider logs). The server passes endpoint + key + body per
// request — nothing is stored here. Always replies exactly once with
// { type:'ai:chat:result', id, ok, status, body } or ok:false + error.
async function handleAiChat(ws, msg) {
  const reply = (m) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch (_) {} };
  const { id, endpoint, apiKey, body } = msg;
  console.log(`📡 [relay] AI chat proxy request → ${endpoint} (id=${id})`);
  if (!id || !endpoint || !body) {
    return reply({ type: 'ai:chat:result', id: id || '', ok: false, status: 0, error: 'Missing id/endpoint/body' });
  }
  const timeoutMs = Math.min(Number(msg.timeoutMs) || 180000, 300000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    clearTimeout(timer);
    // Cap stored payload to keep the WS frame sane (~8 MB)
    reply({ type: 'ai:chat:result', id, ok: res.ok, status: res.status, body: text.length > 8 * 1024 * 1024 ? text.slice(0, 8 * 1024 * 1024) : text });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    reply({ type: 'ai:chat:result', id, ok: false, status: aborted ? 408 : 0, error: aborted ? 'Relay AI request timed out' : (err?.message || 'Relay AI request failed') });
  }
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
      stream = sftp.createWriteStream(msg.remotePath, { flags, start: offset, autoClose: true, highWaterMark: 8 * 1024 * 1024 });
    } catch (_) {
      offset = 0;
      stream = sftp.createWriteStream(msg.remotePath, { flags: 'w', start: 0, autoClose: true, highWaterMark: 8 * 1024 * 1024 });
    }

    console.log(`📤 [relay] write stream created for ${msg.remotePath}, waiting for 'open' event...`);

    stream.on('error', (err) => {
      if (offset > 0 && (err?.code === 'ENOENT' || err?.code === 2 || err?.message?.toLowerCase().includes('no such file'))) {
        console.warn(`⚠️ [relay] Resume target gone for ${msg.remotePath}, restarting write from byte 0`);
        offset = 0;
        try {
          const freshStream = sftp.createWriteStream(msg.remotePath, { flags: 'w', start: 0, autoClose: true, highWaterMark: 8 * 1024 * 1024 });
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
    if (!upload) {
      console.warn(`[FILE DC] Received chunk but no active upload for connId=${connId}`);
      return;
    }

    // Zero-copy: Buffer.from(ArrayBuffer) shares memory, no copy
    const chunk = raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(typeof raw === 'string' ? raw : new Uint8Array(raw));

    upload.chunkCount = (upload.chunkCount || 0) + 1;

    // SFTP stream may still be opening — queue chunks until it's ready
    if (!upload.stream) {
      upload.pendingChunks = upload.pendingChunks || [];
      upload.pendingChunks.push(chunk);
      upload.received += chunk.length;
      if (upload.chunkCount % 100 === 0)
        console.log(`[FILE DC] Stream not ready, queued ${upload.pendingChunks.length} chunks (${upload.received} bytes total)`);
      return;
    }

    // Guard against writing to a stream that was already ended/destroyed
    if (upload.streamEnded) {
      console.warn(`[FILE DC] Ignoring chunk #${upload.chunkCount} — stream already ended`);
      return;
    }

    // Write, hash, and track byte count
    upload.hash.update(chunk);
    upload.received += chunk.length;

    // Backpressure: if write returns false, pause the DataChannel until 'drain' fires
    const canContinue = upload.stream.write(chunk);
    if (!canContinue && !upload.dcPaused) {
      upload.dcPaused = true;
      if (typeof dc.pause === 'function') {
        try { dc.pause(); } catch (_) {}
      }
      upload.stream.once('drain', () => {
        upload.dcPaused = false;
        if (typeof dc.resume === 'function') {
          try { dc.resume(); } catch (_) {}
        }
      });
    }

    if (upload.chunkCount % 500 === 0 || upload.received >= upload.size) {
      console.log(`[FILE DC] Progress: ${upload.filename} — ${upload.received}/${upload.size} bytes (${(upload.received / upload.size * 100).toFixed(1)}%)`);
    }

    // Throttle progress messages to ~4 fps (every 250ms) to avoid control-channel congestion
    const now = Date.now();
    if (upload.sendControl && (now - (upload.lastProgressAt || 0) >= 250 || upload.received >= upload.size)) {
      upload.lastProgressAt = now;
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

// Cache of verified directories to avoid redundant sftp.stat/mkdir calls
const verifiedDirCache = new Set();

async function handleFileUploadStart(connId, msg, sendControl) {
  const { filename, destPath, size, offset = 0 } = msg;
  console.log(`📤 [P2P] Upload start: ${filename} → ${destPath} (${size} bytes, offset=${offset})`);

  // Clean up any previous upload for this connId
  const prev = activeUploads.get(`rtc:${connId}`);
  if (prev) {
    prev.streamEnded = true; // prevent any in-flight writes to the old stream
    try { prev.stream?.destroy(); } catch {}
  }

  // Place a placeholder so incoming chunks can be queued while we open the SFTP stream
  const hash = crypto.createHash('sha256');
  activeUploads.set(`rtc:${connId}`, { stream: null, hash, filename, destPath, size, received: offset, sendControl, pendingChunks: [] });

  let sftp;
  try {
    sftp = await Promise.race([
      getSftpClient(connId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SFTP channel open timeout')), 15000)),
    ]);
  } catch (err) {
    sendControl({ type: 'file:upload:error', connId, filename, error: err.message });
    activeUploads.delete(`rtc:${connId}`);
    return;
  }

  // Extract parent directory and ensure it exists
  const path = require('path');
  const parentDir = path.posix.dirname(destPath);
  
  // Helper to create directory recursively with cache
  const ensureDir = async (dir) => {
    if (dir === '.' || dir === '/' || !dir) return;
    const cacheKey = `${connId}:${dir}`;
    if (verifiedDirCache.has(cacheKey)) return;

    try {
      await sftp.stat(dir);
      verifiedDirCache.add(cacheKey);
    } catch (statErr) {
      // Directory doesn't exist, create parent first
      const parentPath = path.posix.dirname(dir);
      if (parentPath !== '.' && parentPath !== '/' && parentPath !== dir) {
        await ensureDir(parentPath);
      }
      try {
        await sftp.mkdir(dir);
        verifiedDirCache.add(cacheKey);
        console.log(`[P2P] Created directory: ${dir}`);
      } catch (mkdirErr) {
        // Ignore if already exists (code 4 = Failure, e.g. already exists)
        verifiedDirCache.add(cacheKey);
      }
    }
  };

  // Ensure parent directory exists before creating write stream
  if (parentDir && parentDir !== '.' && parentDir !== '/') {
    try {
      await ensureDir(parentDir);
    } catch (dirErr) {
      console.error(`[P2P] Failed to ensure directory ${parentDir}:`, dirErr);
      sendControl({ type: 'file:upload:error', connId, filename, error: `Failed to create directory: ${dirErr.message}` });
      activeUploads.delete(`rtc:${connId}`);
      return;
    }
  }

  const flags = offset > 0 ? 'r+' : 'w';
  let writeStream;
  try {
    writeStream = sftp.createWriteStream(destPath, { flags, start: offset, autoClose: true, highWaterMark: 8 * 1024 * 1024 });
  } catch (_) {
    try {
      writeStream = sftp.createWriteStream(destPath, { flags: 'w', start: 0, autoClose: true, highWaterMark: 8 * 1024 * 1024 });
    } catch (err2) {
      sendControl({ type: 'file:upload:error', connId, filename, error: err2.message });
      activeUploads.delete(`rtc:${connId}`);
      return;
    }
  }

  writeStream.on('error', (err) => {
    console.error(`❌ [P2P] Upload stream error for ${destPath}:`, err.message);
    sendControl({ type: 'file:upload:error', connId, filename, error: err.message });
    activeUploads.delete(`rtc:${connId}`);
  });

  // Attach the real stream and flush any chunks that arrived while we were opening SFTP
  const entry = activeUploads.get(`rtc:${connId}`);
  if (!entry) { try { writeStream.destroy(); } catch {} return; } // upload was cancelled

  entry.stream = writeStream;
  entry.streamEnded = false;
  const queued = entry.pendingChunks.splice(0);
  console.log(`[FILE DC] Stream ready, flushing ${queued.length} pending chunks`);
  for (const c of queued) {
    if (entry.streamEnded) break;
    writeStream.write(c);
    hash.update(c);
    entry.received += c.length;
    console.log(`[FILE DC] Flushed queued chunk: ${c.length} bytes`);
  }
  console.log(`[FILE DC] Total after flush: ${entry.received}/${entry.size} bytes`);
  // Send one progress update for the entire queued batch (throttle applies from here on)
  if (queued.length > 0 && entry.received > 0) {
    entry.lastProgressAt = Date.now();
    sendControl({
      type: 'file:upload:progress',
      connId,
      filename,
      received: entry.received,
      total: entry.size,
    });
  }

  sendControl({ type: 'file:upload:ready', connId, filename, offset });
  console.log(`[FILE DC] Upload session ready for ${filename}`);
}

function handleFileUploadDone(connId, msg, sendControl) {
  const upload = activeUploads.get(`rtc:${connId}`);
  if (!upload) {
    sendControl({ type: 'file:upload:error', connId, filename: msg.filename, error: 'No active upload' });
    return;
  }

  const finish = () => {
    if (upload.streamEnded) {
      // Already ended (e.g. retry started a new upload for this connId) — send error to avoid hang
      sendControl({ type: 'file:upload:error', connId, filename: upload.filename, error: 'write after end' });
      return;
    }
    upload.streamEnded = true;
    upload.stream.end(() => {
      const sha256 = upload.hash.digest('hex');
      console.log(`✅ [P2P] Upload complete: ${upload.filename}, received ${upload.received}/${upload.size} bytes, sha256=${sha256}`);
      
      // Verify size matches
      if (upload.received !== upload.size) {
        console.error(`❌ [P2P] SIZE MISMATCH: received ${upload.received} bytes but expected ${upload.size} bytes!`);
        sendControl({ 
          type: 'file:upload:error', 
          connId, 
          filename: upload.filename, 
          error: `Size mismatch: received ${upload.received}/${upload.size} bytes` 
        });
      } else {
        sendControl({ type: 'file:upload:complete', connId, filename: upload.filename, sha256 });
      }
      
      activeUploads.delete(`rtc:${connId}`);
    });
  };

  if (!upload.stream) {
    // SFTP stream still opening — wait for it
    const waited = Date.now();
    const poll = setInterval(() => {
      const u = activeUploads.get(`rtc:${connId}`);
      if (!u) { clearInterval(poll); return; }
      if (u.stream) { clearInterval(poll); finish(); return; }
      if (Date.now() - waited > 15000) {
        clearInterval(poll);
        sendControl({ type: 'file:upload:error', connId, filename: msg.filename, error: 'SFTP stream open timeout' });
        activeUploads.delete(`rtc:${connId}`);
      }
    }, 100);
  } else {
    finish();
  }
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

  // Adaptive chunk size: larger for fast local P2P, respects node-datachannel's internal buffer
  const READ_HWM = 256 * 1024; // 256 KB chunks
  const DC_BUFFER_HIGH = 4 * 1024 * 1024;  // 4 MB — pause reads when DC buffer exceeds this
  const DC_BUFFER_LOW  = 1 * 1024 * 1024;  // 1 MB — resume reads when DC buffer drops below

  const readStream = sftpSession
    ? sftpSession.createReadStream(remotePath, { highWaterMark: READ_HWM })
    : require('fs').createReadStream(remotePath, { highWaterMark: READ_HWM });

  activeDownloads.set(`rtc:${connId}`, { stream: readStream });

  readStream.on('data', (chunk) => {
    hash.update(chunk);
    sent += chunk.length;
    try {
      fileDc.sendMessageBinary(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    } catch (err) {
      console.error(`❌ [P2P] file download send error: ${err.message}`);
      readStream.destroy();
      return;
    }
    // Backpressure: pause stream if DataChannel buffer is filling up
    try {
      const buffered = typeof fileDc.bufferedAmount === 'function'
        ? fileDc.bufferedAmount()
        : (fileDc.bufferedAmount ?? 0);
      if (buffered > DC_BUFFER_HIGH) {
        readStream.pause();
        const poll = setInterval(() => {
          try {
            const b = typeof fileDc.bufferedAmount === 'function'
              ? fileDc.bufferedAmount()
              : (fileDc.bufferedAmount ?? 0);
            if (b < DC_BUFFER_LOW) { clearInterval(poll); readStream.resume(); }
          } catch { clearInterval(poll); }
        }, 20);
      }
    } catch (_) {}
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
      stream.on('data', (d) => {
        stdout += d.toString();
        ws.send(JSON.stringify({ type: 'docker:stream', connId, action, chunk: d.toString(), args }));
      });
      stream.stderr.on('data', (d) => {
        ws.send(JSON.stringify({ type: 'docker:stream', connId, action, chunk: d.toString(), args }));
      });
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
        const cleaned = d.toString().replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '');
        stdout += cleaned;
        if (cleaned) ws.send(JSON.stringify({ type: 'docker:stream', connId, action, chunk: cleaned, args }));
      });
      stream.stderr.on('data', (d) => {
        const cleaned = d.toString().replace(/\/home\/.+?\.bashrc: line \d+: .+?: No such file or directory\n?/g, '');
        stderr += cleaned;
        if (cleaned) ws.send(JSON.stringify({ type: 'docker:stream', connId, action, chunk: cleaned, args }));
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
      return runRawCmd(`sh -c 'docker swarm leave --force 2>&1; (docker compose down --remove-orphans 2>/dev/null || docker-compose down --remove-orphans 2>/dev/null || true); docker container prune -f 2>/dev/null || true; docker network create proxy-net 2>/dev/null || true; echo "LEFT_SWARM"'`);
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
      const siblingCmd = `for c in $(docker ps -aq 2>/dev/null); do cp=$(docker inspect --format "{{index .Config.Labels \\"com.docker.compose.project\\"}}" $c 2>/dev/null); cs=$(docker inspect --format "{{index .Config.Labels \\"com.docker.compose.service\\"}}" $c 2>/dev/null); cn=$(docker inspect --format "{{.Name}}" $c 2>/dev/null | sed "s|^/||"); c_img=$(docker inspect --format "{{.Config.Image}}" $c 2>/dev/null); c_mounts=$(docker inspect --format "{{range .Mounts}}{{if and .Destination (ne .Destination \\"/var/run/docker.sock\\")}}{{if eq .Type \\"volume\\"\\"--mount type=volume,source={{.Name}},target={{.Destination}} \\"}}{{else if eq .Type \\"bind\\"\\"--mount type=bind,source={{.Source}},target={{.Destination}} \\"}}{{end}}{{end}}{{end}}" $c 2>/dev/null); c_envs=""; for e in $(docker inspect --format "{{range .Config.Env}}{{.}} {{end}}" $c 2>/dev/null); do [ -n "$e" ] && c_envs="$c_envs --env $e"; done; svc_target="\${cs:-\$cn}"; [ -z "$svc_target" ] || [ -z "$c_img" ] && continue; is_db=false; echo "$cn $c_img $svc_target $cs" | grep -qiE "mongo|redis|postgres|mysql|mariadb|memcached" && is_db=true; svc_replicas=1; [ "$is_db" = "false" ] && svc_replicas=2; is_match=false; [ -n "${composeProj}" ] && [ "$cp" = "${composeProj}" ] && [ "$cn" != "${oldContId}" ] && [ "$cn" != "${svcName}" ] && is_match=true; [ "$is_db" = "true" ] && [ "$cn" != "${oldContId}" ] && [ "$cn" != "${svcName}" ] && is_match=true; if [ "$is_match" = "true" ]; then if ! docker service inspect "$svc_target" >/dev/null 2>&1 && ! docker service inspect "$cn" >/dev/null 2>&1; then echo "Converting sibling container $cn into Swarm service $svc_target (replicas=$svc_replicas)..."; aliases="$svc_target"; for a in "$cn" "$cs" mongo mongodb redis postgres mysql mariadb; do [ -z "$a" ] && continue; if ! echo "$aliases" | tr "," "\\n" | grep -qx "$a"; then if echo "$cn $c_img $svc_target $cs" | grep -qi "$a"; then aliases="$aliases,$a"; fi; fi; done; net_flag="--network name=$target_net"; for a in $(echo "$aliases" | tr "," " "); do net_flag="$net_flag,alias=$a"; done; extra_nets=""; for net in $(docker inspect --format "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}" $c 2>/dev/null); do if [ "$net" != "bridge" ] && [ "$net" != "host" ] && [ "$net" != "none" ] && [ "$net" != "$target_net" ]; then driver=$(docker network inspect "$net" --format "{{.Driver}}" 2>/dev/null); if [ "$driver" = "overlay" ]; then extra_nets="$extra_nets --network $net"; fi; fi; done; docker stop $c 2>/dev/null || true; docker rm $c 2>/dev/null || true; echo "Creating Swarm service $svc_target ($c_img)..."; docker service create --name "$svc_target" --replicas $svc_replicas $net_flag $extra_nets $c_mounts $c_envs "$c_img" 2>&1; fi; fi; done; if [ -n "${composeProj}" ] || echo "${svcName}" | grep -qi "monitor"; then if ! docker service inspect monitor-mongo >/dev/null 2>&1 && ! docker service inspect mongo >/dev/null 2>&1; then vol_flag="--mount type=volume,source=mongo_data,target=/data/db"; docker volume inspect monitor_mongo_data >/dev/null 2>&1 && vol_flag="--mount type=volume,source=monitor_mongo_data,target=/data/db"; echo "Auto-deploying Swarm database service monitor-mongo (replicas=1)..."; docker service create --name monitor-mongo --replicas 1 --network name=$target_net,alias=monitor-mongo,alias=mongo,alias=mongodb $vol_flag --env MONGO_INITDB_ROOT_USERNAME=monitor --env MONGO_INITDB_ROOT_PASSWORD=$MONGO_PASSWORD --env MONGO_INITDB_DATABASE=monitor mongo:7.0 2>&1 || true; fi; fi; `;
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
      return runRawCmd(`sh -c 'docker service rm ${serviceName} 2>&1; (docker compose down --remove-orphans 2>/dev/null || docker-compose down --remove-orphans 2>/dev/null || true); docker container prune -f 2>/dev/null || true'`);
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

/**
 * Arguments baked into the service definition (plist / unit / startup launcher).
 *
 * When the token came from --pair it lives only in CONFIG_PATH at 0600, so the
 * service starts with no arguments and reads the config at boot. Copying the
 * token into a LaunchAgent plist, a systemd unit, or a VBS launcher would park
 * it in a world-readable file — exactly the leak pairing exists to close.
 *
 * With an explicit --token on the command line we keep the previous behaviour,
 * so existing one-liners and scripts are unaffected.
 */
function serviceArgs() {
  if (args.token) return [NODE_BIN, INSTALLED_SCRIPT, '--server', SERVER, '--token', TOKEN];
  return [NODE_BIN, INSTALLED_SCRIPT];
}

function installMacOS() {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, SVC_ID + '.plist');
  const logFile = path.join(os.homedir(), 'Library', 'Logs', 'ssh-monitor-relay.log');
  fs.mkdirSync(plistDir, { recursive: true });
  const LT = '<', GT = '>';
  const argTags = serviceArgs()
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
    `ExecStart=${serviceArgs().map(shellQuote).join(' ')}`,
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

  // Each argument is emitted inside its own pair of quotes. Inside a VBS string
  // literal a doubled quote means one literal quote.
  const vbsCmd = serviceArgs()
    .map((s) => '""' + String(s).replace(/"/g, '""') + '""')
    .join(' ');
  const vbsContent = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run "${vbsCmd}", 0, False`,
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
// --install / --pair run an async IIFE above. Without this guard the module
// would fall through and open a relay connection while pairing is still
// waiting for the user to approve.
if (!args.install && !args.pair) connect();
