#!/usr/bin/env node
/**
 * relay-install-audit.mjs — independent, third-party pre-flight audit for the
 * SSH Monitor Local Relay installer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LICENSE / USAGE TERMS
 * ─────────────────────────────────────────────────────────────────────────────
 * Copyright (c) 2026. All rights reserved. Private, non-public source.
 *
 * Permission is hereby granted to READ, COPY and RUN this file for the sole
 * purpose of auditing, verifying or reviewing an installer before executing it.
 * Redistribution, sublicensing, and incorporation into any product or service
 * are NOT granted. You may not alter this file and present the result as this
 * auditor.
 *
 * NO WARRANTY. This auditor reports what it observes. It is not a signature,
 * not an endorsement, and not a guarantee of safety.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS PLAIN, READABLE JAVASCRIPT
 * ─────────────────────────────────────────────────────────────────────────────
 * There is deliberately no obfuscation, minification, bundling or embedded
 * payload here, and none in the installer it audits. You are expected to read
 * this file in full before trusting its output. If you cannot read it, do not
 * run it. Protection against unauthorized reuse is provided by integrity
 * checksums, this license header and the documented terms above — NOT by hiding
 * the logic. Hiding logic from a user is itself the vulnerability.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIDE-EFFECT CONTRACT  (the important part)
 * ─────────────────────────────────────────────────────────────────────────────
 * By default this script is STRICTLY READ-ONLY:
 *
 *   - it reads files and never writes, moves, deletes or chmods anything
 *   - it makes ZERO network requests
 *
 * It performs a write or a network request only when you pass an explicit,
 * opt-in flag:
 *
 *   --emit-report <path>   write the audit as markdown to <path>
 *   --check-served <url>   fetch <url> and compare its SHA-256 to the local file
 *
 * Nothing else can make it touch the network or the disk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   node relay-install-audit.mjs --script ../public/local-relay.min.js
 *   node relay-install-audit.mjs --script ../public/local-relay.min.js --json
 *   node relay-install-audit.mjs --script ../public/local-relay.min.js --server https://monitor.eaqdragon.com
 *   node relay-install-audit.mjs --script ../public/local-relay.min.js --emit-report audit.md
 *
 * Exit codes:  0 = clean / informational   2 = drift detected   3 = read error
 *
 * Audit reference date: 2026-09-06
 * Pinned subject:       public/local-relay.min.js @ 195,544 bytes
 *                       built from public/local-relay.js (also pinned)
 *
 * The subject is the ARTIFACT because that is what a user receives. Behaviour
 * is still read from the readable source sitting beside it — the artifact is
 * deliberately not greppable, so scanning it directly would find nothing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/* ═══════════════════════════════════════════════════════════════════════════
 * PINNED EXPECTATIONS
 *
 * These are the facts established by hand-auditing public/local-relay.js on
 * 2026-09-06. The auditor compares live observations against them so that a
 * future change to the installer shows up as drift instead of passing silently.
 *
 * If you are reading this after that date and the subject file legitimately
 * changed, refresh these values — but re-read the diff first.
 *
 * Two digests are pinned on purpose. `sha256` is the artifact users download;
 * `sourceSha256` is the source it must have been built from. Pinning only the
 * artifact would let someone rebuild from edited source and ship it silently —
 * pinning both means a change to either one shows up here.
 * ═════════════════════════════════════════════════════════════════════════ */

const PINNED = {
  auditDate: '2026-09-07',
  // Bumped 2026-09-06 three times:
  //   1. F7 — the relay deleted its own executable. Adds isDisposableScript().
  //   2. F1–F6 — the relay token moved to an Authorization header with a
  //      query-string fallback; the dependency install was split and given
  //      timeouts; the served bytes are the single source of truth.
  //   3. `--help` (and any unknown flag) now exits instead of starting the relay.
  //   4. The distribution model changed: /local-relay.js now serves a built
  //      artifact (public/local-relay.min.js) instead of the readable source.
  //      `sha256` is the artifact, `sourceSha256` is what it must be built from.
  //   5. `--pair` no longer skips pairing when a token is already saved. It
  //      was gated on `if (!TOKEN)`, and TOKEN is seeded from the saved
  //      config, so re-pairing printed no code at all — only the success
  //      line. `--uninstall` "fixed" it by deleting the config.
  // The shipped artifact: public/local-relay.min.js
  bytes: 196386,
  sha256: '4f18eb0514dcaf2deeaa14ac6db85240969f853f976bdf652cd91597a3bf4a42',
  // The readable source it must be built from: public/local-relay.js
  sourceSha256: 'e0300da481d545f86f81c306cfb7aef29f8338b98a4dd3ffb60df09407f61c43',

  /** Every outbound network call the relay makes. {server} = the --server URL. */
  network: [
    'POST {server}/api/relay/device/code   — mint a pairing code (no secret sent)',
    'POST {server}/api/relay/device/token  — poll until approved, receive token',
    'WS   {server}/relay-ws?token=<TOKEN>  — the relay control channel',
  ],

  /** Filesystem paths the installer creates, writes or deletes. */
  fileChanges: [
    { op: 'write',  path: '~/.ssh-monitor-relay.json', mode: '0600', why: 'relay token + server URL' },
    { op: 'mkdir',  path: '~/.ssh-monitor-relay/',     mode: '',     why: 'install directory' },
    { op: 'write',  path: '~/.ssh-monitor-relay/local-relay.js', mode: '0755', why: 'copy of the script the service runs' },
    { op: 'write',  path: '~/.ssh-monitor-relay/package.json',   mode: '',     why: 'created only if absent' },
    { op: 'write',  path: '~/.ssh-monitor-relay/node_modules/**', mode: '',    why: 'npm install of 3 packages' },
    { op: 'write',  path: '~/.ssh-monitor-relay/.npm-cache/**',   mode: '',    why: 'local npm cache' },
    { op: 'write',  path: '~/Library/LaunchAgents/com.ssh-monitor.relay.plist', mode: '', why: 'macOS only' },
    { op: 'write',  path: '~/Library/Logs/ssh-monitor-relay.log', mode: '',     why: 'macOS only, stdout+stderr' },
    { op: 'write',  path: '~/.config/systemd/user/com.ssh-monitor.relay.service', mode: '', why: 'Linux only' },
    { op: 'write',  path: '%APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/ssh-monitor-relay.vbs', mode: '', why: 'Windows only' },
    { op: 'delete', path: './local-relay.js', mode: '', why: 'self-cleanup of the downloaded copy, only if run outside the install dir' },
  ],

  /** External processes the installer spawns. */
  spawns: ['npm', 'launchctl', 'pkill', 'systemctl', 'powershell'],

  /** Packages fetched from the public npm registry during install. */
  npmPackages: ['ssh2', 'ws', 'node-datachannel'],

  /** Endpoints that must be reachable without a session (device pairing). */
  unauthenticatedEndpoints: ['/api/relay/device/code', '/api/relay/device/token'],

  /**
   * Endpoint that must NEVER be reachable without a session: it is the only
   * step that binds a device to an account.
   */
  mustRequireSession: ['/api/relay/device/approve'],
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ARGUMENT PARSING
 * ═════════════════════════════════════════════════════════════════════════ */

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) { flags[key] = next; i++; }
  else flags[key] = true;
}

// The SUBJECT is the file a user actually receives — the built artifact.
// Behavioural greps run against the readable source next to it, because the
// artifact is deliberately not greppable; that is the point of building it.
const SCRIPT_PATH = path.resolve(flags.script || 'public/local-relay.min.js');
const SOURCE_PATH = SCRIPT_PATH.replace(/local-relay\.min\.js$/, 'local-relay.js');
const SERVER = flags.server || 'https://monitor.eaqdragon.com';
const WANT_JSON = Boolean(flags.json);

/* ═══════════════════════════════════════════════════════════════════════════
 * HELPERS
 * ═════════════════════════════════════════════════════════════════════════ */

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Count non-overlapping literal occurrences. */
function count(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/** Pull unique matches for a global regex. */
function uniqMatches(src, re) {
  const out = new Set();
  for (const m of src.matchAll(re)) out.add(m[1] ?? m[0]);
  return [...out].sort();
}

function bullet(lines, indent = '  ') {
  return lines.map((l) => `${indent}- ${l}`).join('\n');
}

function table(rows) {
  // Widths derived from the widest row, not a fixed arity — a short header row
  // must not leave phantom columns in the border.
  const cols = Math.max(...rows.map((r) => r.length));
  const w = Array.from({ length: cols }, () => 0);
  for (const r of rows) r.forEach((c, i) => { w[i] = Math.max(w[i] ?? 0, String(c).length); });
  const line = `  +${w.map((x) => '-'.repeat(x + 2)).join('+')}+`;
  const body = rows.map((r) => `  | ${r.map((c, i) => String(c).padEnd(w[i])).join(' | ')} |`);
  return [line, ...body, line].join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * OBSERVATION — everything below is derived from the file on disk, not assumed
 * ═════════════════════════════════════════════════════════════════════════ */

let src;
let stat;
let artifactText;
try {
  artifactText = fs.readFileSync(SCRIPT_PATH, 'utf8');
  stat = fs.statSync(SCRIPT_PATH);
  // Fall back to the artifact itself when auditing a standalone copy with no
  // source beside it — the checks still run, they just read built code.
  src =
    SOURCE_PATH !== SCRIPT_PATH && fs.existsSync(SOURCE_PATH)
      ? fs.readFileSync(SOURCE_PATH, 'utf8')
      : artifactText;
} catch (err) {
  process.stderr.write(`\n  Could not read ${SCRIPT_PATH}: ${err.message}\n\n`);
  process.exit(3);
}

const digest = sha256(Buffer.from(artifactText, 'utf8'));
const sourceDigest = sha256(Buffer.from(src, 'utf8'));
// Line count belongs to the ARTIFACT (the subject), not to the source — the
// source is only read for behaviour and its shape is not what a user receives.
const lineCount = artifactText.split('\n').length;

/** The source the artifact claims to have been built from. */
const declaredSource = (artifactText.match(/source-sha256:\s*([0-9a-f]{64})/) || [])[1] || null;

/** Network: API paths, the websocket upgrade path, and absolute URLs. */
const observed = {
  apiPaths: uniqMatches(src, /['"`](\/api\/[A-Za-z0-9/_.-]+)['"`]/g),
  wsPaths: uniqMatches(src, /`(\/relay-ws[^`]*)`/g),
  httpUrls: uniqMatches(src, /['"`](https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+)['"`]/g)
    .filter((u) => !u.includes('www.apple.com') && !u.includes('w3.org')),

  /** Filesystem mutation calls actually present in the source. */
  fsOps: uniqMatches(src, /\bfs\.([a-zA-Z]+Sync|[a-zA-Z]+)\(/g)
    .filter((op) => /write|mkdir|unlink|copy|chmod|rm|append|rename/i.test(op)),

  /** External binaries spawned. */
  spawned: uniqMatches(src, /spawnSync\(\s*'([^']+)'/g),

  /** npm install packages. */
  npmPkgs: uniqMatches(src, /'(ssh2|ws|node-datachannel)'/g),

  /** Mode bits applied to files (e.g. 0o600, 0o755). */
  modes: uniqMatches(src, /0o([0-7]{3,4})/g).map((m) => `0${m}`),

  /** Whether the script writes a service definition for each platform. */
  platforms: {
    darwin: /function installMacOS/.test(src),
    linux: /function installLinux/.test(src),
    win32: /function installWindows/.test(src),
  },
};

// spawnSync is called through a variable alias in one place:
//   const npmCmd = PLATFORM === 'win32' ? 'npm.cmd' : 'npm';
// A literal-only regex silently misses that call, and it is the single most
// surprising side effect of the whole installer (an unattended, blocking
// third-party package fetch). Resolve the alias explicitly so it cannot hide.
const npmAlias = /const\s+npmCmd\s*=\s*[^;]*?:\s*'(npm[^']*)'/.exec(src);
if (npmAlias && !observed.spawned.includes(npmAlias[1])) observed.spawned.push(npmAlias[1]);
observed.spawned.sort();

/** Does the token ever appear in a URL query string? */
const tokenInQuery = /\?token=/.test(src);

/**
 * Is it ALSO sent as a bearer header? A ?token= in the source is not
 * automatically a finding: the WHATWG global WebSocket cannot set handshake
 * headers, so a header-first client still needs a query fallback or it would
 * authenticate as nothing. What matters is which path is primary.
 */
const tokenInHeader = /headers:\s*\{\s*authorization:/i.test(src);

/** Is the npm install bounded, or can it hang forever? */
const npmInstallBounded = /stdio:\s*'inherit'\s*,\s*timeout:/.test(src);

/* ═══════════════════════════════════════════════════════════════════════════
 * DRIFT CHECK
 * ═════════════════════════════════════════════════════════════════════════ */

const findings = [];
let drift = false;

if (digest !== PINNED.sha256) {
  drift = true;
  findings.push({
    severity: 'REVIEW',
    title: 'Installer bytes differ from the audited version',
    detail:
      `Pinned ${PINNED.sha256.slice(0, 16)}… (${PINNED.bytes} bytes, ${PINNED.auditDate}); ` +
      `found ${digest.slice(0, 16)}… (${stat.size} bytes). Re-read the diff before running it. ` +
      `This is expected whenever the relay is legitimately updated — it is a prompt to re-audit, ` +
      `not proof of tampering.`,
  });
}

if (sourceDigest !== PINNED.sourceSha256) {
  drift = true;
  findings.push({
    severity: 'REVIEW',
    title: 'Relay source differs from the audited version',
    detail:
      `Pinned source ${PINNED.sourceSha256.slice(0, 16)}…; found ${sourceDigest.slice(0, 16)}…. ` +
      `The readable source changed, so the behavioural findings below may no longer ` +
      `describe what the artifact does. Re-audit, then rebuild.`,
  });
}

// The failure mode that made maintaining a built artifact dangerous: a stale
// copy silently outranks newer source. The artifact declares its source digest,
// so staleness is a checkable error instead of a mystery downgrade.
if (SOURCE_PATH !== SCRIPT_PATH && fs.existsSync(SOURCE_PATH)) {
  if (!declaredSource) {
    drift = true;
    findings.push({
      severity: 'DRIFT',
      title: 'Artifact has no source-sha256 header',
      detail:
        'The built relay must declare which source it came from, otherwise a stale copy ' +
        'is indistinguishable from a current one. Rebuild with scripts/build-relay.mjs.',
    });
  } else if (declaredSource !== sourceDigest) {
    drift = true;
    findings.push({
      severity: 'DRIFT',
      title: 'Artifact is stale — built from an older source',
      detail:
        `Artifact was built from ${declaredSource.slice(0, 16)}… but the current source is ` +
        `${sourceDigest.slice(0, 16)}…. Serving it would ship old behaviour. ` +
        `Run: npm run build:relay`,
    });
  }
}

for (const p of PINNED.unauthenticatedEndpoints) {
  if (observed.apiPaths.includes(p)) continue;
  // Absence is only a problem if the script pairs at all.
  if (!/device\/code|device\/token/.test(src)) continue;
  findings.push({
    severity: 'DRIFT',
    title: `Expected unauthenticated pairing endpoint missing: ${p}`,
    detail: 'The device-pairing flow appears to have changed. Re-audit the network surface.',
  });
  drift = true;
}

const missingPkgs = PINNED.npmPackages.filter((p) => !observed.npmPkgs.includes(p));
if (missingPkgs.length && observed.spawned.includes('npm')) {
  findings.push({
    severity: 'DRIFT',
    title: `npm install package list changed: missing ${missingPkgs.join(', ')}`,
    detail: 'The set of third-party packages pulled from the public registry changed.',
  });
  drift = true;
}

if (tokenInQuery && !tokenInHeader) {
  findings.push({
    severity: 'NOTICE',
    title: 'Relay token is sent as a URL query parameter',
    detail:
      'The websocket is opened as /relay-ws?token=<TOKEN>. TLS protects it in transit, but ' +
      'query strings are routinely written to server access logs, so the token persists in ' +
      'log storage even though pairing kept it out of argv and shell history. Send it in a ' +
      'handshake header or subprotocol instead.',
  });
} else if (tokenInQuery && tokenInHeader) {
  findings.push({
    severity: 'INFO',
    title: 'Relay token goes in a header; a query-string fallback remains',
    detail:
      'The primary path sends `authorization: Bearer <token>`, which access logs do not ' +
      'record. The ?token= form is still in the source as a fallback, used only when the ' +
      'relay is running without the `ws` package — the WHATWG global WebSocket silently ' +
      'ignores handshake headers, so without a fallback it would send no token at all. ' +
      'On a default install (`ws` present) the query string is never used.',
  });
}

if (observed.spawned.includes('npm') && !npmInstallBounded) {
  findings.push({
    severity: 'NOTICE',
    title: 'Installer runs a blocking npm install of third-party packages',
    detail:
      `It runs \`npm install ${PINNED.npmPackages.join(' ')}\` synchronously into ` +
      '~/.ssh-monitor-relay/ with no timeout. node-datachannel is a native module and may ' +
      'compile from source. On a cold network this can block the installer for minutes.',
  });
} else if (observed.spawned.includes('npm')) {
  findings.push({
    severity: 'INFO',
    title: 'Installer runs npm install — bounded, and optional packages cannot stall it',
    detail:
      'It installs ssh2 and ws first (required), then node-datachannel separately ' +
      '(optional — the relay falls back to WebSocket transport without it). Each call ' +
      'carries a timeout, so a compile-from-source native build can no longer hang the ' +
      'terminal indefinitely. It is still synchronous and still fetches from the public ' +
      'npm registry, so expect the first run to take a while on a cold network.',
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * OPTIONAL: compare the served bytes against the local file
 *
 * Off by default. Requires --check-served <url>.
 * ═════════════════════════════════════════════════════════════════════════ */

async function checkServed(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${url}` };
  const served = sha256(Buffer.from(await res.arrayBuffer()));
  const match = served === digest;
  return {
    ok: match,
    served,
    detail: match
      ? `Served bytes match the local file (${served.slice(0, 16)}…).`
      : `MISMATCH. Local ${digest.slice(0, 16)}… but ${url} serves ${served.slice(0, 16)}… — ` +
        `the SHA-256 shown in the installer will fail verification. Do not bypass the check; ` +
        `ask why the bytes differ.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REPORT RENDERING
 * ═════════════════════════════════════════════════════════════════════════ */

function buildReport(extra = {}) {
  const L = [];
  // The relay derives its websocket URL with SERVER.replace(/^http/, 'ws'), so
  // http:// becomes ws:// and https:// becomes wss://. Mirror that here or the
  // report would advertise a plaintext URL the installer never uses.
  const WS_SERVER = SERVER.replace(/^http/, 'ws');
  const fill = (s, ws) => s.replace(/\{server\}/g, ws ? WS_SERVER : SERVER);
  const h = (s) => L.push(s);
  const h1 = (s) => { h(''); h('═'.repeat(76)); h(`  ${s}`); h('═'.repeat(76)); };
  const h2 = (s) => { h(''); h(`── ${s} ${'─'.repeat(Math.max(0, 72 - s.length))}`); };

  h1('LOCAL RELAY INSTALLER — INDEPENDENT PRE-FLIGHT AUDIT');
  h(`  Subject : ${SCRIPT_PATH}`);
  h(`  Server  : ${SERVER}`);
  h(`  Auditor : relay-install-audit.mjs (this file)`);
  h(`  Pinned  : ${PINNED.auditDate}`);
  h('');
  h('  This report is derived by static analysis of the file above. It lists what');
  h('  the installer WILL do. It does not vouch for the author — it exists so you');
  h('  can decide for yourself before running anything.');

  h2('1. INTEGRITY');
  h(table([
    ['ITEM', 'VALUE'],
    ['SHA-256', digest],
    ['bytes', String(stat.size)],
    ['lines', String(lineCount)],
    ['pinned SHA-256', PINNED.sha256],
    ['pinned bytes', String(PINNED.bytes)],
    ['match', digest === PINNED.sha256 ? 'yes' : 'NO — re-audit'],
  ]));
  h('');
  h('  Verify this yourself, independently of this script:');
  h(`      shasum -a 256 "${SCRIPT_PATH}"`);
  h(`      sha256sum "${SCRIPT_PATH}"            # Linux`);

  h2('2. WHAT THE INSTALLER WILL RUN');
  h('  The command shown in Settings → Local Relay resolves to:');
  h('');
  h(`      curl -fsSL -H 'Cache-Control: no-cache' "${SERVER}/local-relay.js" -o local-relay.js`);
  h(`      echo "${digest}  local-relay.js" | shasum -a 256 -c -`);
  h(`      node local-relay.js --pair --server '${SERVER}'`);
  h('');
  h('  Each stage is gated by && — a checksum mismatch aborts before node runs.');

  h2('3. NETWORK CALLS');
  h(bullet(PINNED.network.map((n) => fill(n, n.startsWith('WS')))));
  h('');
  h('  Observed in source:');
  h(bullet(observed.apiPaths.map((p) => `POST ${SERVER}${p}`)));
  h(bullet(observed.wsPaths.map((p) => `WS   ${WS_SERVER}${p.replace('${TOKEN}', '<TOKEN>')}`)));
  if (observed.httpUrls.length) h(bullet(observed.httpUrls.map((u) => `GET  ${u}`)));
  h('');
  h(`  Unauthenticated by design: ${PINNED.unauthenticatedEndpoints.join(', ')}`);
  h(`  Must require a session   : ${PINNED.mustRequireSession.join(', ')}`);
  h('  The first two carry no secret and mint nothing usable; only /approve can');
  h('  bind a device to an account, and it is session- and CSRF-protected.');

  h2('4. FILESYSTEM CHANGES');
  h(table(
    [['OP', 'PATH', 'MODE', 'WHY']].concat(
      PINNED.fileChanges.map((f) => [f.op.toUpperCase(), f.path, f.mode || '—', f.why])
    )
  ));
  h('');
  h('  Observed filesystem calls in source: ' + (observed.fsOps.join(', ') || 'none'));
  h('  Mode bits applied: ' + (observed.modes.join(', ') || 'none'));

  h2('5. SYSTEM / SERVICE CHANGES');
  h('  External processes spawned:');
  h(bullet(observed.spawned.map((s) => s)));
  h('');
  h('  Platform service definitions written:');
  h(bullet([
    `macOS   ${observed.platforms.darwin ? 'yes — LaunchAgent com.ssh-monitor.relay' : 'no'}`,
    `Linux   ${observed.platforms.linux ? 'yes — systemd user unit com.ssh-monitor.relay.service' : 'no'}`,
    `Windows ${observed.platforms.win32 ? 'yes — Startup folder VBS launcher' : 'no'}`,
  ]));
  h('');
  h('  Packages fetched from the public npm registry:');
  h(bullet(observed.npmPkgs.length ? observed.npmPkgs : ['(none detected)']));

  h2('6. FINDINGS');
  if (!findings.length) {
    h('  None. No drift and no notices.');
  } else {
    for (const f of findings) {
      h(`  [${f.severity}] ${f.title}`);
      for (const line of f.detail.match(/.{1,70}(\s|$)/g) || [f.detail]) {
        h(`      ${line.trim()}`);
      }
      h('');
    }
  }

  if (extra.served) {
    h2('7. SERVED-BYTE COMPARISON (--check-served)');
    h(`  ${extra.served.detail}`);
    if (extra.served.served) h(`  served SHA-256: ${extra.served.served}`);
  }

  h2(extra.served ? '8. BEFORE YOU RUN IT' : '7. BEFORE YOU RUN IT');
  h(bullet([
    'Confirm the checksum above matches the one shown in Settings before you run it.',
    'The file is a build, not readable source — this report is how you inspect it.',
    'Note that install writes a token to ~/.ssh-monitor-relay.json (0600) and',
    'registers a background service that starts at login.',
    'Uninstall: node ~/.ssh-monitor-relay/local-relay.js --uninstall',
  ]));
  h('');
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MAIN
 * ═════════════════════════════════════════════════════════════════════════ */

const extra = {};

if (flags['check-served']) {
  try {
    extra.served = await checkServed(String(flags['check-served']));
  } catch (err) {
    extra.served = { ok: false, detail: `Request failed: ${err.message}` };
  }
  if (!extra.served.ok) drift = true;
}

if (WANT_JSON) {
  process.stdout.write(
    JSON.stringify(
      { subject: SCRIPT_PATH, server: SERVER, bytes: stat.size, lines: lineCount, sha256: digest,
        pinned: PINNED, observed, findings, served: extra.served || null, drift },
      null,
      2
    ) + '\n'
  );
} else {
  process.stdout.write(buildReport(extra) + '\n');
}

// The single explicit write path. Nothing above this line mutates anything.
if (flags['emit-report']) {
  const out = path.resolve(String(flags['emit-report']));
  fs.writeFileSync(out, buildReport(extra) + '\n', 'utf8');
  process.stderr.write(`\n  Report written to ${out}\n`);
}

process.exit(drift ? 2 : 0);
