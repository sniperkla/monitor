import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The WebSocket upgrade parser must accept the path-keyed URLs the app mints.
 *
 * Why this exists: path-keyed proxy URLs carry a VERSIONED marker segment —
 * ASSET_KEY in `src/app/api/agents/webui-proxy/route.js`, bumped `m` → `m2` on
 * 2026-09-13 to evict a poisoned asset cache. The HTTP catch-all imports that
 * constant, so it can never drift. `server.js` is CommonJS and cannot, so its
 * upgrade handler hardcoded the marker — and was not bumped with it.
 *
 * The consequence was silent: a WS upgrade on `/m2/…` parsed to no
 * connectionId/port and hit `destroy()`, with no HTTP status for the client to
 * report. A hosted dashboard turns that into an auth error. Measured before the
 * fix, with only the marker varying:
 *
 *   /api/agents/webui-ws-proxy?connectionId=…&port=…&path=%2F   → 101 OPEN
 *   /api/agents/webui-proxy/m2/<cid>/18789/                     → socket hang up
 *   /api/agents/webui-proxy/m/…                                 → 101 OPEN
 *
 * So the assertion is not "the regex looks right" — it is that the pattern
 * actually written in server.js matches a URL built from the ASSET_KEY actually
 * in the route. Bump ASSET_KEY without the regex and this fails.
 */

const route = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const server = readFileSync('server.js', 'utf8');

const ASSET_KEY = (route.match(/const ASSET_KEY = '([^']+)'/) || [])[1];
// Grab the pattern text between `match(/` and `/)` — the pattern itself contains
// escaped slashes, so splitting on '/' would be wrong. `.+` is greedy and stops
// at the last slash before `);`, which is the pattern's closing delimiter.
const patternSrc = (server.match(/const pathMatch = u\.pathname\.match\(\/(.+)\/\);/) || [])[1];

test('both files expose the values this test depends on', () => {
  assert.ok(ASSET_KEY, 'ASSET_KEY not found in webui-proxy/route.js');
  assert.ok(patternSrc, 'the WS upgrade path regex was not found in server.js');
});

test('the upgrade parser accepts the marker the app actually generates', () => {
  const re = new RegExp(patternSrc);
  const cid = '6a8ed8c5e27dead077074d2b';
  const url = `/api/agents/webui-proxy/${ASSET_KEY}/${cid}/18789/`;

  const m = url.match(re);
  assert.ok(m, `server.js's upgrade regex must match the app's own URL form — no match for ${url}`);
  assert.equal(m[1], cid, 'connectionId must be captured from the marker form');
  assert.equal(m[2], '18789', 'port must be captured from the marker form');
});

test('the ws-proxy variant and a subpath both parse', () => {
  const re = new RegExp(patternSrc);
  const cid = '6a8ed8c5e27dead077074d2b';
  assert.ok(`/api/agents/webui-ws-proxy/${ASSET_KEY}/${cid}/42617/ws`.match(re), 'ws- variant must parse');
  const m = `/api/agents/webui-proxy/${ASSET_KEY}/${cid}/18789/chat/room`.match(re);
  assert.ok(m, 'a subpath must parse');
  assert.equal(m[3], 'chat/room', 'the remote subpath must survive');
});

test('the legacy unversioned marker still parses', () => {
  // URLs minted before the m → m2 bump may still be in flight (a page held open
  // across a deploy). Accepting `m` costs nothing and keeps those links alive.
  const re = new RegExp(patternSrc);
  assert.ok(`/api/agents/webui-proxy/m/6a8ed8c5e27dead077074d2b/18789/`.match(re));
});

test('a non-marker first segment is NOT treated as one', () => {
  // The regex must not swallow arbitrary paths — the HTTP catch-all relies on the
  // same distinction when it decides whether to consume the marker.
  const re = new RegExp(patternSrc);
  assert.equal(`/api/agents/webui-proxy/assets/index-abc.js`.match(re), null);
  assert.equal(`/api/agents/webui-proxy/${ASSET_KEY}/not-a-port/x/`.match(re), null);
});
