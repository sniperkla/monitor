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

test('cloneDefaultHome: creates parent dirs for nested files + isolates .env', async () => {
  const orig = (await import(`file://${modPath}`)).cloneDefaultHome;
  const modSrc = src;
  assert.match(modSrc, /mkdir -p "\$HOME\/\.\$\{agentId\}-\$\{tag\}\/\$\{f\.slice/, 'nested parent dirs must be created before cp');
  // .env must NEVER be cloned — instances get a fresh empty .env instead
  assert.match(modSrc, /identityFiles = files\.filter/, 'must filter out .env from cloned files');
  assert.match(modSrc, /: > "\$HOME\/\.\$\{agentId\}-\$\{tag\}\/\.env"/, 'must create a fresh empty .env');
  assert.doesNotMatch(modSrc, /TOKEN_SAME|cmp -s/, 'token-same guard is gone — no .env clone means no conflict check needed');
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

test('tagged instance uninstall disables its systemd unit before removing its home', () => {
  for (const agent of ['hermes', 'openclaw', 'nanobot', 'zeroclaw']) {
    const route = readFileSync(`src/app/api/agents/${agent}/route.js`, 'utf8');
    const uninstall = route.slice(route.indexOf("if (action === 'uninstall')"), route.indexOf("if (action === 'install')"));
    assert.match(uninstall, new RegExp(`sdInstanceCtl\\(sshConfig, '${agent}', inst, 'stop'\\)`), `${agent} must disable its tagged systemd unit`);
    assert.match(uninstall, /stop instance \(pidfile-scoped\)|const stopCmd = inst/, `${agent} keeps legacy pidfile cleanup`);
    assert.match(uninstall, /INSTANCE_HOME_REMAINS/, `${agent} must fail when its tagged home survives removal`);
  }
});

test('hermes route: spawned instances isolate credentials and wait for configuration', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  assert.match(route, /stop instance \(pidfile-scoped\)/);
  const spawn = route.slice(route.indexOf("if (action === 'spawn-instance')"), route.indexOf("if (action === 'status')"));
  // Spawn builds a FRESH home instead of cloning the default's files, so there
  // must be no copy of anything out of ~/.hermes — no config.yaml, prompts,
  // memories, skills, workspace or .env. This supersedes the old
  // `for f in config.yaml SOUL.md` clone list, which still copied non-secret
  // files (and whose assertion no longer matched the implementation).
  assert.doesNotMatch(spawn, /cp\s+[^;"]*\$HOME\/\.hermes\//, 'spawn must not copy anything out of the default home');
  assert.match(spawn, /echo CLONED_FRESH/, 'spawn must report a fresh home');
  assert.match(route, /: > "\$HOME\/\.hermes-\$\{tag\}\/\.env"/, 'spawn creates a fresh empty .env');
  assert.doesNotMatch(route, /TOKEN_SAME=1/, 'token-same spawn guard removed');
  // Never boot a credential-less spawned gateway; the wizard configures it first.
  assert.doesNotMatch(spawn, /gwCtl\('start'\)/, 'spawn must not start before credentials are saved');
  assert.match(spawn, /needsConfiguration: true/, 'UI must be told to configure the instance');
  // systemd units must load the per-instance .env after it is configured.
  assert.match(route, /EnvironmentFile=-%h\/\.hermes-%i\/\.env/, 'systemd must load instance .env');
  // pidScan verifies cmdline via ps
  assert.match(route, /ps -p "\$pid" -o args=/);
});

test('hermes install preserves every submitted provider credential', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const install = route.slice(route.indexOf('// ── INSTALL'), route.indexOf('// 6. Gateway service'));
  // Install persists credentials via the shared Python env writer (runEnvUpsert)
  // — not the legacy awk/shell loop — plus a pre-purge backup that it restores
  // so a reinstall with an empty/stale form never drops a working provider key.
  assert.match(install, /runEnvUpsert/, 'install must use the shared Python .env writer');
  assert.match(install, /ENV_UPDATED/, 'failed env writes must stop installation');
  assert.match(install, /env\.bak/, 'install must back up .env before purge and restore it');
  assert.match(install, /BACKUP_RESTORED/, 'install must restore credentials from the backup');
  assert.match(install, /chmod 600 "\$\{HH\}\/\.env"/, 'saved credentials must remain private');
  assert.doesNotMatch(install, /upsert_env\(\) \{/, 'the broken shell upsert helper must stay removed');
  assert.match(route, /openrouter: 'OPENROUTER_API_KEY'/, 'server validates the OpenRouter credential name');
  assert.match(route, /requiredProviderKey/, 'server rejects a new credential-less gateway');
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
  // resource caps protect the host when instances are shared with others
  assert.match(unit, /MemoryMax=2G/, 'default memory cap');
  assert.match(unit, /CPUQuota=200%/, 'default cpu cap');
  const capped = gatewayUnit('hermes', {
    description: 'x', envLines: [], execStart: 'x', logFile: 'x', memoryMax: '512M', cpuQuota: '50%',
  });
  assert.match(capped, /MemoryMax=512M/);
  assert.match(capped, /CPUQuota=50%/);
  const uncapped = gatewayUnit('hermes', {
    description: 'x', envLines: [], execStart: 'x', logFile: 'x', memoryMax: 'none', cpuQuota: 'none',
  });
  assert.doesNotMatch(uncapped, /MemoryMax|CPUQuota/, "'none' disables caps");
});

// ── Strict mode: one Linux user per friend ────────────────────────────────
test('sanitizeUsername: lowercase, safe chars, no leading digit, reserved names', async () => {
  const m = await import(`file://${modPath}`);
  assert.equal(m.sanitizeUsername('  Friend-2 X! '), 'friend-2x');
  assert.equal(m.sanitizeUsername('9bad'), 'bad', 'leading digit stripped');
  assert.equal(m.sanitizeUsername('!!!'), '');
  assert.equal(m.sanitizeUsername('MyBot_01').startsWith('mybot'), true);
});

test('provisionUserScript: idempotent user creation, linger, 700 home, pubkey', async () => {
  const m = await import(`file://${modPath}`);
  const s = m.provisionUserScript('friend1', { publicKey: 'ssh-ed25519 AAAA test' });
  assert.match(s, /useradd -m -s \/bin\/bash/, 'creates user with home');
  assert.match(s, /loginctl enable-linger/, 'linger so units run without login');
  assert.match(s, /chmod 700/, 'private home dir');
  assert.match(s, /authorized_keys/, 'installs the friend pubkey');
  assert.match(s, /root\|daemon\|bin\|sys/, 'blocks reserved usernames');
  assert.match(s, /PROVISIONED/, 'success marker');
  // reserved-name block must actually trigger
  const bad = m.provisionUserScript('root');
  assert.match(bad, /BAD_USER/, 'root must be rejected');
});

test('provision-user route exists with auth + strict mode docs', () => {
  const route = readFileSync('src/app/api/agents/provision-user/route.js', 'utf8');
  assert.match(route, /getServerSession/, 'must require auth');
  assert.match(route, /sanitizeUsername/, 'must sanitize username');
  assert.match(route, /provisionUser/, 'must call the provision helper');
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

// ── Complete instance isolation (ports + shared-state pinning) ────────────
test('instancePorts: distinct per-instance ports, none for the default install', async () => {
  const m = await import(`file://${modPath}`);
  assert.deepEqual(m.instancePorts('hermes', ''), [], 'default install keeps hermes defaults');
  const [api, hook] = m.instancePorts('hermes', 'bot2');
  assert.ok(api && hook, 'two ports must be allocated');
  assert.notEqual(api, hook, 'API and webhook ports must differ');
  for (const p of [api, hook]) {
    assert.ok(p >= 18000 && p <= 18999, `port ${p} out of range`);
    assert.ok(!(p >= 18780 && p <= 18799), `port ${p} collides with the Hermes default gateway band`);
  }
  // Different instances must not be handed the same API server port, or the
  // second gateway can never bind and only the first instance ever runs.
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(m.instancePorts('hermes', `t${i}`)[0]);
  assert.ok(seen.size > 150, `port allocation too collision-prone: ${seen.size}/200 unique`);
});

test('instanceIsolationEnv pins every shared-state path inside the instance home', async () => {
  const m = await import(`file://${modPath}`);
  assert.deepEqual(m.instanceIsolationEnv('hermes', '', '$HOME/.hermes'), {}, 'default keeps shipped defaults');
  const home = '$HOME/.hermes-bot2';
  const env = m.instanceIsolationEnv('hermes', 'bot2', home);
  assert.equal(env.HERMES_HOME, home);
  // Hermes defaults ALL of these to SHARED absolute paths outside the home, so
  // two instances with different HERMES_HOME values would still share them.
  for (const k of [
    'HERMES_KANBAN_HOME', 'HERMES_KANBAN_DB', 'HERMES_KANBAN_WORKSPACES_ROOT',
    'TERMINAL_SANDBOX_DIR', 'HERMES_OAUTH_FILE', 'CODEX_HOME',
  ]) {
    assert.ok(env[k], `${k} must be set`);
    assert.ok(env[k].startsWith(`${home}/`), `${k}=${env[k]} escapes the instance home`);
  }
  // The board slug pins this instance's workers to its own tasks.
  assert.equal(env.HERMES_KANBAN_BOARD, 'bot2');
  assert.match(m.instanceIsolationEnv('hermes', 'Bot_2 X!', home).HERMES_KANBAN_BOARD, /^[a-z0-9_-]{1,64}$/, 'board must be a legal hermes slug');
  // Write guard: every allowed root stays inside the instance home.
  for (const root of env.HERMES_WRITE_SAFE_ROOT.split(':')) {
    assert.ok(root === home || root.startsWith(`${home}/`), `write root ${root} escapes the instance home`);
  }
  assert.ok(Number(env.API_SERVER_PORT) > 0 && Number(env.WEBHOOK_PORT) > 0, 'own listening ports');
  assert.notEqual(env.API_SERVER_PORT, env.WEBHOOK_PORT);
});

test('writeInstanceEnv: expand writes an unquoted heredoc so $HOME resolves', async () => {
  // systemd does NOT expand $HOME inside an EnvironmentFile, so instance.env
  // must be written with the home already resolved to an absolute path.
  const src2 = readFileSync('src/app/api/agents/_multi-instance.js', 'utf8')
    .replace(/^import .*_ssh';$/m, "const execCommand = async (c, cmd) => { globalThis.__cmd = cmd; return { stdout: 'ENV_OK' }; };");
  const p2 = path.join(tmp, 'wiev.mjs');
  writeFileSync(p2, src2);
  const m2 = await import(`file://${p2}`);
  await m2.writeInstanceEnv({}, '$HOME/.hermes-bot2', { HERMES_HOME: '$HOME/.hermes-bot2' });
  assert.match(globalThis.__cmd, /<<'ENV_EOF'/, 'default keeps the quoted heredoc');
  await m2.writeInstanceEnv({}, '$HOME/.hermes-bot2', { HERMES_HOME: '$HOME/.hermes-bot2' }, { expand: true });
  assert.match(globalThis.__cmd, /<<ENV_EOF/, 'expand must use an unquoted heredoc');
  assert.doesNotMatch(globalThis.__cmd, /<<'ENV_EOF'/, 'expand must not quote the heredoc');
  // A newline in a value must NOT be able to start a new KEY=value line.
  await m2.writeInstanceEnv({}, '$HOME/.hermes-bot2', { A: 'x\nEVIL=1', 'B AD': 'y' }, { expand: true });
  assert.doesNotMatch(globalThis.__cmd, /^EVIL=/m, 'newlines in values must not inject env lines');
  assert.doesNotMatch(globalThis.__cmd, /^B AD=/m, 'invalid keys must be dropped');
});

test('hermes route imports every helper it calls (listInstances was a ReferenceError)', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const m = route.match(/import \{([^}]*)\} from '\.\.\/_multi-instance';/);
  assert.ok(m, 'multi-instance import must exist');
  for (const fn of ['listInstances', 'instancePorts', 'instanceIsolationEnv', 'writeInstanceEnv']) {
    assert.match(m[1], new RegExp(`\\b${fn}\\b`), `${fn} must be imported`);
  }
  // listInstances decides whether a default uninstall may delete the SHARED
  // binary — an unimported symbol silently reported "no instances remain".
  assert.match(route, /listInstances\(sshConfig, 'hermes'\)/, 'default uninstall must detect surviving instances');
});

test('hermes install never runs `hermes gateway install` without HERMES_HOME', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const install = route.slice(route.indexOf('// 6. Gateway service'), route.indexOf('// 7. Verify'));
  const tagged = install.slice(install.indexOf('if (inst && !dockerMode)'), install.indexOf("} else if (startMethod === 'system'"));
  assert.ok(tagged.length > 0, 'tagged-instance install branch must exist');
  // Hermes derives the pidfile AND the systemd unit name from HERMES_HOME, so an
  // unqualified install rewrites and starts the DEFAULT instance's unit.
  const calls = [...tagged.matchAll(/\$\{HB\} gateway install/g)];
  assert.ok(calls.length > 0, 'expected a gateway install call in the instance branch');
  for (const c of calls) {
    assert.match(tagged.slice(Math.max(0, c.index - 15), c.index), /\$\{HERMES_ENV\} $/,
      'instance gateway install must export HERMES_HOME first');
  }
});

test('hermes status probe: tagged instances resolve hermes from their OWN venv', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const start = route.indexOf('const statusScript = (tag');
  const ss = route.slice(start, route.indexOf('export async function POST', start));
  const tagged = ss.slice(ss.indexOf('if [ -n "${tag}" ]; then'), ss.indexOf('else'));
  assert.match(tagged, /\\\$\{HH\}\/hermes-agent\/venv\/bin/, 'tagged PATH must lead with the instance venv');
  assert.doesNotMatch(tagged, /\$HOME\/\.hermes\/hermes-agent/, 'tagged PATH must not contain the default home venv');
});

test('hermes process scan: tagged instances ignore unattributable gateways', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const ps = route.slice(route.indexOf('const procScan = (tag'), route.indexOf('// POSIX sh probe'));
  // A gateway with no HERMES_HOME marker must not make a TAGGED instance report
  // itself as running — it belongs to a sibling or to the default install.
  assert.match(ps, /if \[ -z "\$HME" \]; then \$\{tag \? 'continue' : 'PROC=1; break'\}; fi/,
    'unattributable processes may only count for the default install');
});

test('hermes spawn: private home + per-instance session and kanban state dirs', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  const spawn = route.slice(route.indexOf("if (action === 'spawn-instance')"), route.indexOf("if (action === 'status')"));
  // sessions/ holds gateway conversation state — shared, it is one memory for
  // every instance. kanban/ anchors the instance's own board + workspaces.
  assert.match(spawn, /\$\{tag\}\/sessions/, 'spawn must create a per-instance sessions dir');
  assert.match(spawn, /\$\{tag\}\/kanban/, 'spawn must create a per-instance kanban dir');
  assert.match(spawn, /chmod 700 "\$HOME\/\.hermes-\$\{tag\}"/, 'instance home must be 0700');
  assert.match(spawn, /chmod 600 "\$HOME\/\.hermes-\$\{tag\}\/\.env"/, '.env must be 0600');
  // The isolation contract is persisted before the instance can ever start.
  assert.match(spawn, /syncInstanceEnv\('spawn'\)/, 'spawn must persist instance.env');
});

test('hermes: every start path loads the per-instance isolation env', () => {
  const route = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');
  // Both nohup start paths (gateway restart/start + the install daemon) must
  // source instance.env, otherwise those instances never get their own ports
  // or their pinned shared-state paths.
  const sources = [...route.matchAll(/\[ -f "\$\{HH\}\/instance\.env" \] && \. "\$\{HH\}\/instance\.env"/g)];
  assert.equal(sources.length, 2, `expected 2 nohup starts to source instance.env, found ${sources.length}`);
  assert.match(route, /EnvironmentFile=-%h\/\.hermes-%i\/instance\.env/, 'systemd unit must load instance.env');
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

