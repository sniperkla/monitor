// ── Regression test: local relay connection detection ───────────────────────
//
// Symptom: after a local relay was installed successfully, the SSH Monitor
// still showed "Relay not connected" / "Local relay agent is offline." It only
// cleared after manually clicking the retry button.
//
// Three independent defects caused it, all in src/context/AppContext.js:
//
//   1. Relay status was fetched with a bare `fetch('/api/relay/token')` in a
//      mount-only useEffect. The install runs in a terminal on the user's own
//      machine — the browser is never told it finished — so relayInfo was
//      frozen at whatever it was when the page loaded.
//   2. The health effect claimed "every 20 seconds" in its comment but had no
//      setInterval at all, so relayDown was also computed exactly once.
//   3. relayDown came from /api/health, whose relay.up is
//      `global.__activeRelays?.size > 0` — whether ANY tenant on the server has
//      a relay attached. Wrong for a single user in both directions.
//
// The fix moves relay liveness onto a user-scoped poller with an event bus so
// the install flow can force an immediate re-read. These tests keep that from
// quietly regressing back to a one-shot check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const appContextSrc = readSrc('src/context/AppContext.js');
const relayStatusSrc = readSrc('src/utils/relayStatus.js');
const bannerSrc = readSrc('src/components/MongoDeadBanner.js');
const pairingSrc = readSrc('src/components/RelayPairingPanel.js');
const settingsSrc = readSrc('src/apps/SettingsApp.js');

// ── Behaviour of the shared status module ──────────────────────────────────

test('fetchRelayStatus reads the user-scoped endpoint and normalises the shape', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ success: true, connected: true, relays: [{ relayId: 'a', relayName: 'studio' }] }),
    };
  };

  const { fetchRelayStatus } = await import('../src/utils/relayStatus.js');
  const status = await fetchRelayStatus();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/relay/token');
  // Must never be served from the HTTP cache, or a poller reads the same
  // "not connected" answer forever.
  assert.equal(calls[0].opts.cache, 'no-store');
  assert.equal(calls[0].opts.credentials, 'include');
  assert.deepEqual(status, {
    connected: true,
    relays: [{ relayId: 'a', relayName: 'studio' }],
    // No relay advertised a web proxy, so there is none — and 0 (not null,
    // not undefined) is what every caller tests against.
    webProxyPort: 0,
  });
});

test('fetchRelayStatus surfaces the relay web proxy port the in-app browser needs', async () => {
  // The Browser app frames ordinary sites through the relay's own loopback
  // proxy when one exists, so the port has to survive the trip from the relay
  // row to the client. Without it every navigation silently falls back to the
  // server proxy — and its sandbox breaks storage-dependent sites.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      connected: true,
      relays: [
        { relayId: 'old', relayName: 'pre-upgrade' },
        { relayId: 'new', relayName: 'upgraded', webProxyPort: 18780 },
      ],
    }),
  });

  const { fetchRelayStatus } = await import('../src/utils/relayStatus.js');
  const status = await fetchRelayStatus();
  assert.equal(status.webProxyPort, 18780, 'a relay that reports a port must be used');

  // An older relay reports null and must not be mistaken for port 0 meaning
  // "use it" — the fallback stays on the server proxy.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      connected: true,
      relays: [{ relayId: 'old', relayName: 'pre-upgrade', webProxyPort: null }],
    }),
  });
  const older = await fetchRelayStatus();
  assert.equal(older.webProxyPort, 0, 'a pre-upgrade relay must yield no port, not a bogus one');
});

test('fetchRelayStatus throws on a non-ok response so callers can avoid flapping', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

  const { fetchRelayStatus } = await import('../src/utils/relayStatus.js');
  await assert.rejects(() => fetchRelayStatus(), /relay status 401/);
});

test('fetchRelayStatus tolerates a body that is missing relays', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, connected: false }) });

  const { fetchRelayStatus } = await import('../src/utils/relayStatus.js');
  assert.deepEqual(await fetchRelayStatus(), { connected: false, relays: [], webProxyPort: 0 });
});

test('the status event bus notifies subscribers and can be unsubscribed', async () => {
  // The module is authored for the browser; give it the minimum window it needs.
  globalThis.window = new EventTarget();

  const { requestRelayStatusRefresh, onRelayStatusRefresh } = await import('../src/utils/relayStatus.js');

  const seen = [];
  const off = onRelayStatusRefresh((detail) => seen.push(detail.reason));

  requestRelayStatusRefresh('pairing-approved');
  assert.deepEqual(seen, ['pairing-approved']);

  off();
  requestRelayStatusRefresh('after-unsubscribe');
  assert.deepEqual(seen, ['pairing-approved'], 'unsubscribe must stop delivery');

  delete globalThis.window;
});

// ── AppContext wiring ──────────────────────────────────────────────────────

test('AppContext polls relay status instead of checking it once on mount', () => {
  // The old code had no timer at all — this is the whole bug.
  assert.match(appContextSrc, /setTimeout\(tick, delay\)/, 'relay status must be on a timer');
  assert.match(appContextSrc, /RELAY_POLL_WAITING_MS/, 'fast cadence while the relay is missing');
  assert.match(appContextSrc, /RELAY_POLL_CONNECTED_MS/, 'relaxed cadence once attached');
  assert.match(appContextSrc, /fetchRelayStatus\(\)/, 'must read the user-scoped endpoint');
});

test('relay liveness no longer comes from the global /api/health relay count', () => {
  // relayDown used to be `data.relay?.up`, i.e. global.__activeRelays.size > 0.
  assert.doesNotMatch(
    appContextSrc,
    /relayUp\s*=\s*data\.relay\?\.up/,
    '/api/health reports whether ANY tenant has a relay — not this user',
  );
  // Mongo still legitimately comes from /api/health.
  assert.match(appContextSrc, /mongoUp\s*=\s*data\.mongo\?\.up/);
});

test('the tab-visibility path forces an immediate re-check', () => {
  // Coming back from the terminal where the installer ran is the moment that
  // must not wait for the next tick.
  assert.match(appContextSrc, /visibilitychange/);
  assert.match(appContextSrc, /window\.addEventListener\('focus', onVisible\)/);
});

test('a relay recovery re-pins local mode and preferred relay BEFORE refetching', () => {
  // apiFetch reads both keys from localStorage at call time. Writing them
  // after the refetch routes the request through the old relay, or none.
  const start = appContextSrc.indexOf('const applyStatus =');
  assert.notEqual(start, -1, 'applyStatus should exist');
  const body = appContextSrc.slice(start, start + 5000);

  const modeWrite = body.indexOf("setItem('ssh_monitor_ssh_mode', 'local')");
  const relayWrite = body.indexOf("setItem('ssh_monitor_preferred_relay'");
  const refetch = body.indexOf('fetchConnectionsRef.current()');

  assert.notEqual(modeWrite, -1);
  assert.notEqual(refetch, -1);
  assert.ok(modeWrite < refetch, 'mode must be pinned before the refetch');
  if (relayWrite !== -1) {
    assert.ok(relayWrite < refetch, 'preferred relay must be pinned before the refetch');
  }
});

test('relayDown only nags browsers that actually want a relay', () => {
  // Now that the flag is per-user and correct, setting it unconditionally
  // would show "Relay not connected" to every server-mode user who never
  // installed one.
  assert.match(appContextSrc, /const wantsRelay =/);
  assert.match(appContextSrc, /ssh_monitor_local_relay/);
});

// ── Consumers ──────────────────────────────────────────────────────────────

test('the install flow nudges the poller so no manual retry is needed', () => {
  assert.match(
    pairingSrc,
    /requestRelayStatusRefresh\('pairing-approved'\)/,
    'approving a pairing code must trigger an immediate status re-read',
  );
  assert.match(
    settingsSrc,
    /requestRelayStatusRefresh\('relay-installed'\)/,
    'the install wizard must trigger an immediate status re-read',
  );
});

test('the banner retry uses the user-scoped relay check, not /api/health', () => {
  assert.match(bannerSrc, /fetchRelayStatus\(\)/);
  assert.doesNotMatch(bannerSrc, /data\.relay\?\.up/);
});

test('a dismissed banner re-arms on a later outage', () => {
  // Dismissal covers one outage, not every future one — and now that relay
  // status is polled, it can genuinely go down again mid-session.
  assert.match(bannerSrc, /wasDownRef/);
});
