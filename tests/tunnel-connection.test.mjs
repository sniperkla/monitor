import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveTunnelConnectionId, isPlausibleConnectionId } from '../src/utils/tunnelConnection.js';

/**
 * The in-app browser must never address the WebUI proxy with an invented
 * connection id.
 *
 * The bug, measured end to end: the agent-shortcut branch in
 * `AgentWebUIBrowserApp.navigateAddress` resolved its target as
 * `connectionId || 'local'`. `local` is the `sshMode` sentinel, not a database
 * id, so `getSshConfig()` threw "Connection not found" and the route answered
 * 500 — surfaced to the user as a "Web UI Unreachable" card quoting the raw 500
 * body. The desktop mounts that app with no connection at all
 * (`DesktopEnvironment`: `<AgentWebUIBrowserApp initialMode="explore" />`), so
 * every agent bookmark on the Explore page hit it, every time:
 *
 *     500 GET /api/agents/webui-proxy/m2/local/9119
 *
 * The resolver is a plain module rather than component state so these tests
 * exercise it for real — a source regex can only prove a string is absent, not
 * that the value is right.
 */

const APP = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

/**
 * Source with whole-line comments removed.
 *
 * The negative assertion below must not be satisfied — or broken — by prose.
 * The file explains this very bug in a comment that quotes the old
 * `connectionId || 'local'` expression, so matching raw source would fail on a
 * correct file. Only whole-line comments are dropped, never trailing ones: the
 * file contains string literals like `'https://…'`, and a naive `//` strip
 * would eat the code after them and turn a real violation into a pass.
 */
function codeOnly(src) {
  return src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
}

test('the tab’s own connection wins over the mount-time prop', () => {
  // The server selector writes the new choice onto the tab; the prop keeps
  // pointing at the server the window was opened with. Preferring the prop
  // would tunnel to the wrong host after a switch.
  const id = resolveTunnelConnectionId({
    tabConnectionId: '6a8ed8c5e27dead077074d2b',
    propConnectionId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    selectedConnectionId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(id, '6a8ed8c5e27dead077074d2b');
});

test('falls back to the prop, then to the app-level selection', () => {
  assert.equal(
    resolveTunnelConnectionId({ propConnectionId: 'aaaaaaaaaaaaaaaaaaaaaaaa', selectedConnectionId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }),
    'aaaaaaaaaaaaaaaaaaaaaaaa'
  );
  assert.equal(
    resolveTunnelConnectionId({ selectedConnectionId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }),
    'bbbbbbbbbbbbbbbbbbbbbbbb'
  );
});

test('no connection known resolves to empty, never to a placeholder', () => {
  // The regression itself. An empty string makes the caller tell the user to
  // pick a server; any non-empty placeholder makes it fire a doomed request.
  assert.equal(resolveTunnelConnectionId({}), '');
  assert.equal(resolveTunnelConnectionId(), '');
  assert.equal(resolveTunnelConnectionId({ tabConnectionId: '', propConnectionId: '', selectedConnectionId: '' }), '');
});

test('the historical placeholder is rejected for every empty input', () => {
  // Guards the exact string that caused the 500, so a future "convenience"
  // fallback cannot quietly reintroduce it.
  const empties = [{}, { tabConnectionId: '' }, { propConnectionId: null }, { selectedConnectionId: undefined }];
  for (const input of empties) {
    assert.notEqual(resolveTunnelConnectionId(input), 'local');
  }
  assert.equal(isPlausibleConnectionId('local'), false);
});

test('plausibility matches the shape the proxy route accepts', () => {
  // The route's own path-key parser uses /^[A-Za-z0-9_-]{6,64}$/ — a value it
  // would reject cannot be a connection id.
  assert.equal(isPlausibleConnectionId('6a8ed8c5e27dead077074d2b'), true);
  assert.equal(isPlausibleConnectionId('local'), false, '5 chars — the bug');
  assert.equal(isPlausibleConnectionId(''), false);
  assert.equal(isPlausibleConnectionId('a'.repeat(65)), false);
  assert.equal(isPlausibleConnectionId('has spaces'), false);
});

test('the component routes BOTH tunnel branches through the resolver', () => {
  // The resolver being correct does not prove the component calls it. Pin the
  // wiring: no inline placeholder may remain, and both branches (agent shortcut
  // and localhost tunnel) must resolve through the shared helper.
  assert.ok(
    !/\|\|\s*'local'/.test(codeOnly(APP)),
    "AgentWebUIBrowserApp must not fall back to the literal connection id 'local'"
  );
  assert.match(APP, /import \{ resolveTunnelConnectionId \} from '@\/utils\/tunnelConnection'/);

  const callSites = APP.match(/const targetConn = resolveTunnelConnectionId\(/g) || [];
  assert.equal(callSites.length, 2, `expected the agent and localhost branches to both resolve; found ${callSites.length}`);
});
