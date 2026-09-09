import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * AI Agents must be able to reach the user's Local Relay.
 *
 * Three defects in a row all had the same shape — the app looked wired up but
 * silently took a different path than every other app in the codebase:
 *
 *   1. `AIAgentsApp` was the only app to take `apiFetch` as a PROP, and the
 *      window manager mounts apps with no props, so it fell back to bare
 *      `fetch()`. That dropped `x-ssh-mode` / `x-preferred-relay`, and because
 *      the Connection model has no `sshMode` field, agent commands could then
 *      only ever use the relay when the host was literally 127.0.0.1.
 *   2. The "cloud server or phone? continue with direct connection" bypass
 *      only flipped React state, so requests kept going through the relay the
 *      user had just bypassed — and it reset on every remount.
 *   3. AppContext force-pins mode back to 'local' on every poll where it sees
 *      a relay, which undid (2) within seconds.
 *
 * These are invisible at runtime until a device has no relay of its own, so
 * they are pinned here at the source level.
 */

const app = readFileSync('src/apps/AIAgentsApp.js', 'utf8');
const ctx = readFileSync('src/context/AppContext.js', 'utf8');
const ssh = readFileSync('src/app/api/server-backup/_ssh.js', 'utf8');
const nanobot = readFileSync('src/app/api/agents/nanobot/route.js', 'utf8');
const hermes = readFileSync('src/app/api/agents/hermes/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

test('AI Agents resolves apiFetch from context, not from a prop that is never passed', () => {
  // The window manager renders `<Component windowId={...} {...w.props} />`, so
  // a prop-only apiFetch is always undefined.
  assert.match(app, /const \{[^}]*apiFetch: ctxApiFetch[^}]*\} = useApp\(\)/);
  assert.match(app, /const doFetch = apiFetch \|\| ctxApiFetch \|\| fetch/);
});

test('the direct-connection bypass switches MODE, not just the UI flag', () => {
  const bypass = section(app, 'const bypassRelay = useCallback', '}, []);');
  // apiFetch reads this key on every call — without it the header still says
  // 'local' and every request keeps trying the relay the user bypassed.
  assert.match(bypass, /localStorage\.setItem\('ssh_monitor_ssh_mode', 'server'\)/);
  // Stops AppContext's relay poll from pinning the browser straight back.
  assert.match(bypass, /localStorage\.setItem\('ssh_monitor_relay_optout', '1'\)/);
  // Announced the same way AppContext does it, so other consumers react.
  assert.match(bypass, /dispatchEvent\(new Event\('ssh-mode-changed'\)\)/);
});

test('every bypass entry point goes through bypassRelay', () => {
  assert.doesNotMatch(app, /onClick=\{\(\) => setForceBypassRelay\(true\)\}/);
  assert.match(app, /onClick=\{bypassRelay\}/);
  assert.match(app, /onClick=\{\(\) => \{ bypassRelay\(\);/);
});

test('relay auto-pin respects an explicit direct-connection opt-out', () => {
  const pin = section(ctx, 'let changed = false;', 'if (relayDownRef.current)');
  assert.match(pin, /ssh_monitor_relay_optout/);
  // The guard must wrap the write, not sit next to it.
  assert.match(pin, /if \(!relayOptedOut && localStorage\.getItem\('ssh_monitor_ssh_mode'\) !== 'local'\)/);
});

test('relay auto-pin preserves an explicitly preferred connected relay', () => {
  const pin = section(ctx, 'const savedPreferred = localStorage.getItem(\'ssh_monitor_preferred_relay\');', 'if (relayDownRef.current)');
  // Poll order is not a stable identity. Prefer the saved relay when it is
  // still present, and only fall back to the first result when it disappeared.
  assert.match(pin, /const preferred = savedPreferred\s*\n\s*\? relays\.find\(\(relay\) => \(relay\.relayName \|\| relay\.relayId\) === savedPreferred\)/);
  assert.match(pin, /const selected = preferred \|\| relays\[0\] \|\| null/);
  assert.match(pin, /const relayName = selected \? \(selected\.relayName \|\| selected\.relayId\) : null/);
});

test('relay-start sends the original connection target to the local relay', () => {
  for (const [name, src] of [['nanobot', nanobot], ['hermes', hermes]]) {
    const block = section(src, "if (op === 'relay-start') {", "if (op === 'start' || op === 'restart')");
    // Local mode may rewrite sshConfig to the monitor-side relay listener. The
    // browser relay must instead receive the untouched connection coordinates.
    assert.match(block, /const relayConnection = await getSshConfig\(connectionId, \{/,
      `${name} must resolve an unmodified relay target`);
    assert.match(block, /connection:\s*\{\s*host: relayConnection\.host,\s*port: relayConnection\.port,/,
      `${name} must forward relayConnection, not rewritten sshConfig`);
    assert.match(block, /skipRelayResolution: true/,
      `${name} must bypass relay rewriting while recovering the target`);
  }
});

test('pairing a relay on the device clears the opt-out so it is not a one-way door', () => {
  assert.match(app, /localStorage\.removeItem\('ssh_monitor_relay_optout'\)/);
});

/**
 * Defect 4 — the one that produced the actual "works on my MacBook, not on my
 * phone" symptom.
 *
 * `ssh_monitor_ssh_mode` is pinned per ACCOUNT, not per device: AppContext sets
 * 'local' for any browser that sees the user's relay. A phone therefore sends
 * `x-ssh-mode: local` even though it can never run a relay, and
 * `resolveSshConfig` treated that as a hard requirement — so every agent call
 * 500'd with "Local Relay Agent is not connected" for public-IP targets the
 * server could have reached directly. Measured side by side: same connection,
 * same request, only the header differed — `server` → 200, `local` → 500.
 */
test('a missing relay does not hard-fail targets the server can reach directly', () => {
  const branch = section(ssh, 'if (!relay || !relay.ws)', '// Resolve the actual dial target');
  // Must return the untouched config (direct connect) instead of throwing.
  assert.match(branch, /return sshConfig;/);
  assert.match(branch, /logger\.warn\(/);
});

test('the direct-connect fallback is gated on the host NOT being localhost', () => {
  const branch = section(ssh, 'if (!relay || !relay.ws)', '// Resolve the actual dial target');
  // `hostIsLocal` must be derived from the real host, not from sshMode.
  assert.match(ssh, /const hostIsLocal = isLocalhost\(sshConfig\.host\)/);
  // The early return must sit inside that guard, before the throw.
  assert.match(branch, /if \(!hostIsLocal\)/);
  const guardAt = branch.indexOf('if (!hostIsLocal)');
  const throwAt = branch.indexOf('throw new Error');
  assert.ok(guardAt >= 0 && throwAt > guardAt, 'the localhost guard must precede the throw');
});

test('localhost targets still require a live relay — no SSRF fallback', () => {
  // Falling back here would make the server dial its own loopback.
  assert.match(ssh, /throw new Error\('Local Relay Agent is not connected\./);
  // The branch is still entered for localhost hosts.
  assert.match(ssh, /if \(hostIsLocal \|\| options\.sshMode === 'local'\)/);
});
