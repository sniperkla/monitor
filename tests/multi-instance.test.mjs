import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// _multi-instance.js imports an aliased module ('@/...') that plain node cannot
// resolve — load a copy with the SSH import stripped so the pure helpers are
// testable without a bundler.
const src = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8').replace(
  /^import .*;$/m,
  ''
);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'multi-instance-'));
const modPath = path.join(tmp, '_multi-instance.mjs');
writeFileSync(modPath, src);
const { parseInst, homeDir, instancePort, pidAliveCmd, cloneDefaultHome } = await import(
  `file://${modPath}`
);

test('parseInst sanitizes instance tags', () => {
  assert.equal(parseInst({ instance: 'bot/2 x!' }), 'bot2x');
  assert.equal(parseInst({ config: { tag: 'ab-9_z' } }), 'ab-9_z');
  assert.equal(parseInst({}), '');
  assert.equal(parseInst({ instance: 'x'.repeat(50) }).length, 24);
});

test('homeDir: tagged vs default', () => {
  assert.equal(homeDir('hermes', ''), '$HOME/.hermes');
  assert.equal(homeDir('hermes', 'bot2'), '$HOME/.hermes-bot2');
});

test('instancePort: deterministic and null for default', () => {
  assert.equal(instancePort('hermes', ''), null);
  assert.equal(instancePort('hermes', 'bot2'), instancePort('hermes', 'bot2'));
});

test('instancePort: same tag on different agents never collides', () => {
  const agents = ['hermes', 'openclaw', 'nanobot', 'zeroclaw'];
  const seen = new Set();
  for (const a of agents) seen.add(instancePort(a, 'bot2'));
  assert.equal(seen.size, agents.length, 'same tag across agents must yield distinct ports');
});

test('instancePort: stays in range and avoids Hermes default band (18780-18799)', () => {
  for (let i = 0; i < 500; i++) {
    const tag = `t${i}`;
    const p = instancePort('hermes', tag);
    assert.ok(p >= 18000 && p <= 18999, `port ${p} out of range for tag ${tag}`);
    assert.ok(!(p >= 18780 && p <= 18799), `port ${p} collides with Hermes default gateway band`);
  }
});

test('pidAliveCmd verifies process cmdline against the home marker', () => {
  const cmd = pidAliveCmd('$HOME/.hermes-bot2');
  assert.match(cmd, /ps -p "\$pid" -o args=/, 'must verify cmdline, not just kill -0');
  assert.match(cmd, /grep -qF "\.hermes-bot2"/, 'must grep for the instance home marker');
  assert.equal(pidAliveCmd('$HOME/.openclaw').includes('.openclaw'), true);
});

test('cloneDefaultHome: creates parent dirs for nested files + token check', async () => {
  // Stub execCommand capturing the remote script, simulating a fresh clone.
  let captured = '';
  const fakeSsh = {};
  const orig = (await import(`file://${modPath}`)).cloneDefaultHome;
  // cloneDefaultHome uses the module-level execCommand import which we stripped;
  // verify the generated script shape instead by checking source of the module.
  const modSrc = src;
  assert.match(modSrc, /mkdir -p "\$HOME\/\.\$\{agentId\}-\$\{tag\}\/\$\{f\.slice/, 'nested parent dirs must be created before cp');
  assert.match(modSrc, /TOKEN_SAME=\$TS/, 'token-identity check must be emitted');
  assert.match(modSrc, /cmp -s/, 'must compare .env with cmp');
  // sanity: exported symbol exists
  assert.equal(typeof orig, 'function');
  assert.equal(typeof cloneDefaultHome, 'function');
});

test('route callers pass their agentId into instancePort', () => {
  for (const agent of ['openclaw', 'nanobot', 'zeroclaw']) {
    const route = readFileSync(`src/app/api/agents/${agent}/route.js`, 'utf8');
    assert.match(route, new RegExp(`instancePort\\('${agent}', inst\\)`), `${agent} must salt its port hash`);
  }
});

test('hermes route: instance uninstall is pidfile-scoped and token guard exists', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  assert.match(route, /stop instance \(pidfile-scoped\)/);
  assert.match(route, /TOKEN_SAME=1/);
  // pidScan verifies cmdline via ps
  assert.match(route, /ps -p "\$pid" -o args=/);
});

// ── Per-instance systemd template units ────────────────────────────────────
const { gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl } =
  await import(`file://${modPath}`);

test('gatewayUnit: hardening + supervision + instance relocation', () => {
  const unit = gatewayUnit('hermes', {
    description: 'Hermes gateway',
    envLines: ['Environment=HERMES_HOME=%h/.hermes-%i'],
    execStart: `/bin/sh -c 'exec hermes gateway run'`,
    logFile: '%h/.hermes-%i/logs/gateway.log',
  });
  assert.match(unit, /Restart=on-failure/, 'supervision');
  assert.match(unit, /NoNewPrivileges=true/, 'hardening');
  assert.match(unit, /PrivateTmp=true/, 'hardening');
  assert.match(unit, /HERMES_HOME=%h\/\.hermes-%i/, 'per-instance home via %i');
  assert.match(unit, /%h\/\.hermes-%i\/logs\/gateway\.log/, 'per-instance log');
  assert.match(unit, /WantedBy=default\.target/);
});

test('template unit name avoids bare "gateway" via gatew""ay split', async () => {
  const src2 = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8');
  assert.match(src2, /gatew""ay@/, 'unit name must be split to dodge pkill self-match');
  for (const agent of ['hermes', 'openclaw', 'nanobot', 'zeroclaw']) {
    const route = readFileSync(`src/app/api/agents/${agent}/route.js`, 'utf8');
    assert.match(route, /sdInstanceCtl/, `${agent} must use the systemd instance path`);
    assert.match(route, /sdAvailable/, `${agent} must probe for a systemd user session`);
  }
});

test('listInstances detects systemd-managed instances', () => {
  const src2 = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8');
  assert.match(src2, /systemctl --user is-active "\$\{agentId\}-gatew""ay@/, 'TAGRUN loop must check the template unit');
});

test('sdInstanceCtl: start failure returns null (fallback), status always returns', async () => {
  // execCommand import was stripped — the module will throw on call; instead
  // verify behaviour by re-loading a copy with a stubbed execCommand.
  const src2 = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8')
    .replace(/^import .*_ssh';$/m, "const execCommand = async () => ({ stdout: 'SD_DOWN' });");
  const p2 = path.join(tmp, 'mi2.mjs');
  writeFileSync(p2, src2);
  const m2 = await import(`file://${p2}`);
  assert.equal(await m2.sdInstanceCtl({}, 'hermes', 'bot2', 'start'), null, 'failed start → null');
  const down = await m2.sdInstanceCtl({}, 'hermes', 'bot2', 'status');
  assert.equal(down.active, false, 'status must return a result even when inactive');

  const src3 = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8')
    .replace(/^import .*_ssh';$/m, "const execCommand = async (c, cmd) => ({ stdout: /SD_UP/.test(cmd) ? 'SD_UP' : 'active\\n' });");
  const p3 = path.join(tmp, 'mi3.mjs');
  writeFileSync(p3, src3);
  const m3 = await import(`file://${p3}`);
  const up = await m3.sdInstanceCtl({}, 'hermes', 'bot2', 'start');
  assert.equal(up.ok, true);
  assert.equal(up.via, 'systemd');
});

