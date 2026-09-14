import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('package.json is valid and has required scripts', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const s of ['dev', 'build', 'start', 'lint', 'test']) {
    assert.ok(pkg.scripts[s], `missing script: ${s}`);
  }
});

test('key entry files exist', () => {
  for (const f of ['server.js', 'next.config.mjs', 'src/app/layout.js', 'src/lib/logger.js']) {
    assert.ok(existsSync(f), `missing file: ${f}`);
  }
});

test('desktop window content constrains app height for internal scrolling', () => {
  const windowSrc = readFileSync('src/components/Desktop/Window.js', 'utf8');
  const settingsSrc = readFileSync('src/apps/SettingsApp.js', 'utf8');
  const css = readFileSync('src/app/globals.css', 'utf8');

  assert.match(windowSrc, /flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto/,
    'window content must be shrinkable so child apps scroll instead of expanding it');
  assert.match(settingsSrc, /flex h-full min-h-0 w-full/,
    'Settings root must participate in the constrained flex height chain');
  assert.match(settingsSrc, /flex-1 min-h-0 min-w-0 overflow-y-auto/,
    'Settings pane must scroll within the desktop window');
  assert.match(css, /\.window-container > \.title-bar \+ div \{\s*min-width: 0;\s*min-height: 0;/,
    'shared window CSS must preserve the constrained viewport contract');
});

test('SSH config resolves session identity before scoped connection lookup', () => {
  const src = readFileSync('src/app/api/server-backup/_ssh.js', 'utf8');
  const sessionIndex = src.indexOf('actingUserId = session?.user?.id');
  const repoIndex = src.indexOf('new ConnectionRepository(db, actingUserId || null)');
  assert.ok(sessionIndex >= 0, 'SSH config must resolve the session user id');
  assert.ok(repoIndex > sessionIndex, 'repository lookup must use the resolved session identity');
  assert.doesNotMatch(src, /new ConnectionRepository\\(db, options\\.userId \\|\\| null\\)/,
    'SSH config must not construct an unscoped repository before session resolution');
});

test('SSH config resolves relay identity separately from database ownership identity', () => {
  const src = readFileSync('src/app/api/server-backup/_ssh.js', 'utf8');
  assert.match(src, /relayUserId = dbUser\?\.googleId \|\| actingUserId/,
    'OAuth-linked accounts must resolve the provider subject used by relay tokens');
  assert.match(src, /const relayLookup = options\.relayUserId \|\| options\.userId/,
    'relay lookup must resolve the separate relay identity');
  assert.match(src, /findActiveRelay\(relayLookup/,
    'relay lookup must use the resolved relay identity, not only the database id');
  assert.match(src, /new ConnectionRepository\(db, actingUserId \|\| null\)/,
    'connection lookup must remain scoped to the database ownership identity');
});

test('every SSH client in _ssh.js releases itself when it fails before ready', () => {
  const src = readFileSync('src/app/api/server-backup/_ssh.js', 'utf8');
  // A bare `conn.on('error', reject)` leaks the client. Each of these functions
  // closes its connection on every OTHER failure path — in `stream.on('close')`,
  // in attachExecTimeout(), or in the individual stream error handlers — so a
  // PRE-READY error (handshake timeout, auth refused, connection reset) was the
  // only way to reject with the socket still open. Routes that probe with
  // `{ pool: false }` on every request hit that path whenever the target is
  // briefly unreachable; observed 2026-09-14 as accumulating dead clients while
  // probing agent Web UIs against a loaded box.
  // 1. The defect itself, in its many spellings — a handler that only rejects.
  assert.doesNotMatch(src, /\.on\('error', reject\)/,
    'no SSH client may reject without ending its connection');

  // 2. Check every client site, not just the one we came here for: this leak was
  // copy-pasted across several functions, and a new one would reintroduce it.
  // Match the ASSIGNMENT form (`= new Client()`) so the prose in the comments
  // above — which names `new Client()` — is not mistaken for a site.
  const sites = [...src.matchAll(/=\s*new Client\(\)/g)].map((m) => m.index);
  assert.ok(sites.length >= 4, `expected several SSH clients, found ${sites.length}`);
  for (let i = 0; i < sites.length; i++) {
    // Slice to the END OF THE ENCLOSING FUNCTION, not to the next client:
    // sftpTransfer declares two clients on consecutive lines, so a
    // between-clients slice is empty for the first of them.
    const fnEnd = src.indexOf('\nexport function', sites[i] + 1);
    const block = src.slice(sites[i], fnEnd === -1 ? src.length : fnEnd);
    // Each function releases its connection somewhere in scope: directly via
    // `conn.end()`, or through a `cleanup()` helper (the pooled client and
    // sftpTransfer, which drives two connections from one `onErr`).
    assert.match(block, /\.end\(\)|cleanup\(/,
      `client #${i + 1} of ${sites.length} has no connection release in scope`);
  }
});

test('relay status checks both provider and database identities', () => {
  const src = readFileSync('src/app/api/relay/token/route.js', 'utf8');
  assert.match(src, /User\.findOne\(\{ googleId: userId \}\)/,
    'relay status must resolve OAuth provider identity');
  assert.match(src, /User\.findById\(userId\)/,
    'relay status must also support credentials/database identities');
  assert.match(src, /relayUserIds\.map\(\(id\) => global\.__activeRelays\?\.get\(id\)\)/,
    'relay status must inspect all equivalent identity keys');
  assert.match(src, /relayUserIds\.includes\(String\(e\.userId\)\)/,
    'relay token inventory must include tokens under either identity');
});

test('logger module source defines all levels', () => {
  const src = readFileSync('src/lib/logger.js', 'utf8');
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.ok(src.includes(`${level}(...args)`), `logger missing ${level}()`);
  }
});
