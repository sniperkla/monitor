import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Integration tests for the relay agents' secret-free install paths.
 *
 * Verifies the property that matters: the token arrives over the wire and is
 * written to a 0600 config file, and it is NOT mirrored into the service
 * definition (LaunchAgent plist / systemd unit), which is world-readable.
 *
 * SAFETY — read before editing:
 *  • Each script is COPIED to a temp dir before running. Both agents delete
 *    their own __filename on a successful install, so running them in place
 *    would delete public/local-relay.js / public/monitor-agent.js from the repo.
 *  • HOME is redirected to a temp dir, so install dirs and service definitions
 *    are written there, never into the real home directory.
 *  • `npm`, `launchctl`, `pkill` and `systemctl` are shadowed by no-op stubs on
 *    PATH, so nothing is installed and no real service is registered.
 */

const REPO_ROOT = process.cwd();
const TOKEN_VALUE = 'TEST-RELAY-TOKEN-0123456789abcdef';
const USER_CODE = 'K7QP-2M4X';
const CLAIM_CODE = 'CLAIMCODE'.repeat(8);

let tmpRoot;
let stubsDir;
let server;
let port;
let pollCount = 0;

function writeStub(name, body) {
  const p = path.join(stubsDir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-agent-'));
  stubsDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(stubsDir, { recursive: true });

  writeStub('npm', 'echo "[stub npm] $*"');
  writeStub('launchctl', 'exit 0');
  writeStub('pkill', 'exit 0');
  writeStub('systemctl', 'exit 0');

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/relay/device/code') {
        return send(200, {
          deviceCode: 'DEVCODE'.repeat(8),
          userCode: USER_CODE,
          expiresIn: 600,
          interval: 1,
        });
      }
      if (req.url === '/api/relay/device/token') {
        let deviceCode = '';
        try {
          deviceCode = JSON.parse(body || '{}').deviceCode || '';
        } catch (_) {}
        // A pre-authorized claim code is redeemed on the first call.
        if (deviceCode === CLAIM_CODE) {
          return send(200, { token: TOKEN_VALUE, expiresAt: new Date().toISOString() });
        }
        pollCount += 1;
        if (pollCount < 2) return send(202, { status: 'pending', expiresIn: 600 });
        return send(200, { token: TOKEN_VALUE, expiresAt: new Date().toISOString() });
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => {
  server?.close();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

/**
 * Run one of the agent scripts in a fully sandboxed HOME.
 * @param {string} script  filename under public/
 * @param {string[]} extraArgs
 */
function runAgent(script, extraArgs = []) {
  const id = `${path.basename(script, '.js')}-${Math.random().toString(36).slice(2, 8)}`;
  const home = path.join(tmpRoot, id, 'home');
  const work = path.join(tmpRoot, id, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  // Run a COPY — the agents delete their own file on a successful install.
  const scriptPath = path.join(work, path.basename(script));
  fs.copyFileSync(path.join(REPO_ROOT, 'public', script), scriptPath);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${stubsDir}:${process.env.PATH}`,
        RELAY_SERVER: '',
        RELAY_TOKEN: '',
        MONITOR_SERVER: '',
        MONITOR_TOKEN: '',
        MONITOR_CLAIM: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const kill = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.on('close', (code) => {
      clearTimeout(kill);
      resolve({ code, out, err, home, scriptPath });
    });
  });
}

/* ────────────────────────── local-relay.js ────────────────────────── */

test('local-relay --pair stores the token 0600 and prints the user code', async () => {
  const { code, out, home } = await runAgent('local-relay.js', [
    '--pair',
    '--server',
    `http://127.0.0.1:${port}`,
  ]);

  assert.equal(code, 0, `exited ${code}\n${out}`);
  assert.match(out, new RegExp(USER_CODE), 'must print the code for the user to approve');
  assert.match(out, /Approved/, 'must confirm approval');

  const cfgPath = path.join(home, '.ssh-monitor-relay.json');
  assert.ok(fs.existsSync(cfgPath), 'config must be written');
  assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600, 'token file must be 0600');

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.token, TOKEN_VALUE);
  assert.equal(cfg.server, `http://127.0.0.1:${port}`);
});

test('local-relay --pair keeps the token out of the service definition', async () => {
  const { home, out } = await runAgent('local-relay.js', [
    '--pair',
    '--server',
    `http://127.0.0.1:${port}`,
  ]);

  if (os.platform() === 'darwin') {
    const plist = path.join(home, 'Library', 'LaunchAgents', 'com.ssh-monitor.relay.plist');
    assert.ok(fs.existsSync(plist), 'LaunchAgent plist must be written');
    const xml = fs.readFileSync(plist, 'utf8');
    assert.ok(!xml.includes(TOKEN_VALUE), 'token must NOT be mirrored into the plist');
    assert.ok(!xml.includes('--token'), 'no --token argument in the plist');
    assert.match(xml, /local-relay\.js/, 'plist must still point at the installed script');
  } else if (os.platform() === 'linux') {
    const unit = path.join(home, '.config', 'systemd', 'user', 'com.ssh-monitor.relay.service');
    if (fs.existsSync(unit)) {
      assert.ok(!fs.readFileSync(unit, 'utf8').includes(TOKEN_VALUE), 'token must not be in the unit');
    }
  }

  assert.ok(!out.includes(TOKEN_VALUE), 'token must never be printed to stdout');
});

/* ───────────────────────── monitor-agent.js ───────────────────────── */

test('monitor-agent --pair stores the token 0600 and prints the user code', async () => {
  const { code, out, home } = await runAgent('monitor-agent.js', [
    '--pair',
    '--server',
    `http://127.0.0.1:${port}`,
  ]);

  assert.equal(code, 0, `exited ${code}\n${out}`);
  assert.match(out, new RegExp(USER_CODE));

  const cfgPath = path.join(home, '.config', 'server-monitor-agent', 'config.json');
  assert.ok(fs.existsSync(cfgPath), 'config must be written');
  assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600, 'token file must be 0600');

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.token, TOKEN_VALUE);
});

test('monitor-agent --claim installs with no interaction and leaks no token', async () => {
  const { code, out, home } = await runAgent('monitor-agent.js', [
    '--claim',
    CLAIM_CODE,
    '--server',
    `http://127.0.0.1:${port}`,
  ]);

  assert.equal(code, 0, `exited ${code}\n${out}`);
  assert.ok(!out.includes(USER_CODE), 'a pre-authorized install must print no approval code');
  assert.ok(!out.includes(TOKEN_VALUE), 'token must never be printed');

  const cfgPath = path.join(home, '.config', 'server-monitor-agent', 'config.json');
  assert.ok(fs.existsSync(cfgPath), 'config must be written');
  assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).token, TOKEN_VALUE);

  const agentCopy = path.join(home, '.config', 'server-monitor-agent', '.agent.js');
  assert.ok(fs.existsSync(agentCopy), 'script must be copied to the install dir');
});

test('monitor-agent service definition has no token and no undefined path', async () => {
  const { home } = await runAgent('monitor-agent.js', [
    '--claim',
    CLAIM_CODE,
    '--server',
    `http://127.0.0.1:${port}`,
  ]);

  if (os.platform() === 'darwin') {
    const plist = path.join(
      home,
      'Library',
      'LaunchAgents',
      'com.monitor.server-monitor-agent.plist'
    );
    assert.ok(fs.existsSync(plist), 'plist must be written');
    const xml = fs.readFileSync(plist, 'utf8');

    // Regression: this used to embed the literal string "undefined" because the
    // template referenced a variable that was never defined, so the agent could
    // never start on macOS.
    assert.ok(!xml.includes('undefined'), 'plist must not contain "undefined"');
    assert.ok(!xml.includes(TOKEN_VALUE), 'token must NOT be in the plist');
    assert.match(xml, /\.agent\.js/, 'plist must point at the installed script');
  } else if (os.platform() === 'linux') {
    const unit = path.join(home, '.config', 'systemd', 'user', 'server-monitor-agent.service');
    assert.ok(fs.existsSync(unit), 'unit must be written');
    const txt = fs.readFileSync(unit, 'utf8');
    assert.ok(!txt.includes(TOKEN_VALUE), 'token must NOT be in the unit');
    assert.ok(!txt.includes('undefined'), 'unit must not contain "undefined"');
  }
});

test('monitor-agent: an explicit --token still behaves as before', async () => {
  // Backwards compatibility for existing one-liners and scripts.
  const { code, out, home } = await runAgent('monitor-agent.js', [
    '--install',
    '--server',
    `http://127.0.0.1:${port}`,
    '--token',
    TOKEN_VALUE,
  ]);

  assert.equal(code, 0, `exited ${code}\n${out}`);
  const cfgPath = path.join(home, '.config', 'server-monitor-agent', 'config.json');
  assert.ok(!fs.existsSync(cfgPath), 'explicit --token must not create a config file');
});
