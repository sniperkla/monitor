// ── Regression test: relay token lifecycle controls (F-03) ──────────────────
//
// /api/relay/token mints a bearer credential that grants SSH/SFTP/docker access
// to the owner's machine via the Local Relay. It previously had:
//   • no throttle on issuance
//   • no cap on how many tokens one account can hold
//   • no metadata — nothing to audit, no way to spot a leaked token
//   • no way to revoke one token without revoking all of them
//
// NOTE on scope: an earlier draft of the audit claimed `scope: 'agent'` bypasses
// the supporter gate. That is wrong — server.js re-checks supporter status on
// every relay-ws connection regardless of scope, so an agent-scope token cannot
// reach the relay without membership. Scope is retained for reporting and for
// agent-sync, which does not require supporter. The tests below guard that
// understanding so it does not silently regress into a real bypass.
//
// TTL was deliberately NOT shortened: public/local-relay.js bakes the token into
// a background service with no renewal handshake, so a short TTL would silently
// break every running relay. It is now configurable (RELAY_TOKEN_TTL_DAYS)
// instead. These tests assert configurability, not a specific number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const routeSrc = readSrc('src/app/api/relay/token/route.js');
const relayTokensSrc = readSrc('src/lib/relayTokens.js');
const serverSrc = readSrc('server.js');
const agentSyncSrc = readSrc('src/app/api/firewall/agent-sync/route.js');

// Issuance rules (cap, eviction, audit metadata, TTL) live in lib/relayTokens.js,
// deliberately extracted so /api/relay/token and the device-pairing exchange
// can't drift. The tests below check features against both files so a regression
// in either place fails loudly — the file comments document the split.

test('issuance is throttled', () => {
  assert.ok(routeSrc.includes('checkRateLimit'), 'rate limit helper imported');
  assert.match(routeSrc, /checkRateLimit\(`relay-token:\$\{userId\}`/,
    'throttle keyed per user, not globally');
  assert.ok(/status:\s*429/.test(routeSrc), 'returns 429 when throttled');
});

test('per-user token cap exists and evicts the oldest', () => {
  // Cap and eviction are in lib/relayTokens.js (route.js delegates via
  // `issueRelayToken`). The route still owns the per-call bookkeeping for
  // DELETE so `__relayTokens.delete(t)` is checked across both files.
  const capSrc = relayTokensSrc;
  assert.ok(capSrc.includes('MAX_TOKENS_PER_USER'), 'cap constant present');
  // Pin the direction, not just the presence: ascending (a - b) means the
  // OLDEST token lands at index 0 and is what gets evicted. A descending sort
  // would silently evict the newest token, so it must not match here.
  assert.match(capSrc,
    /owned\.sort\(\s*\(a,\s*b\)\s*=>\s*\(a\[1\]\.issuedAt[\s\S]{0,140}?\)\s*-\s*\(b\[1\]\.issuedAt/,
    'eviction orders by issue time so the OLDEST token goes first');
  assert.ok(
    capSrc.includes('tokens.delete(t)') || routeSrc.includes('global.__relayTokens.delete(t)'),
    'eviction actually deletes'
  );
});

test('tokens carry audit metadata', () => {
  assert.ok(relayTokensSrc.includes('tokenId:'), 'short handle for GET/DELETE');
  assert.ok(relayTokensSrc.includes('issuedAt: now'), 'issue timestamp');
  assert.ok(relayTokensSrc.includes('lastUsed: null'), 'lastUsed initialised');
  assert.ok(relayTokensSrc.includes('label:'), 'optional human label');
});

test('TTL is configurable rather than hardcoded', () => {
  assert.ok(relayTokensSrc.includes('RELAY_TOKEN_TTL_DAYS'), 'env override present');
  assert.ok(relayTokensSrc.includes('tokenTtlMs'), 'computed per call');
  // The old code was a module-level 365-day const used blindly. Check both files
  // because the constant has lived in different places over time.
  assert.ok(!/^const TOKEN_TTL = 365/m.test(relayTokensSrc),
    'hardcoded 365-day const must not come back');
  assert.ok(!/^const TOKEN_TTL = 365/m.test(routeSrc),
    'route file must not reintroduce a hardcoded TTL');
});

test('GET returns a masked token, never the credential itself', () => {
  assert.ok(routeSrc.includes('masked:'), 'inventory exposes a masked form');
  assert.match(routeSrc, /slice\(-4\)/, 'only the last 4 characters are shown');
  // The full token must not be echoed anywhere in the inventory construction.
  const inventory = routeSrc.slice(routeSrc.indexOf('const tokens = []'), routeSrc.indexOf('tokens.sort'));
  assert.ok(!inventory.includes('token: t'), 'raw token value not included in inventory');
});

test('DELETE revokes a scoped target, never the whole inventory', () => {
  // The targeting decision lives in src/lib/relayRevoke.js and is covered by
  // runtime tests in tests/relayRevoke.test.mjs. This test only asserts the
  // route still delegates to it instead of hand-rolling a loop.
  //
  // The previous version of this test asserted that an inline `tokenId`-only
  // guard existed — and it passed, while the bug was live. The guard was real
  // but gated on a query param no client ever sends; every call from the
  // Settings UI arrives as `?relayId=<id>`, which ignored the guard and swept
  // every token the user owned. A source-text assertion cannot tell "guarded"
  // from "guarded only on the branch that is never taken", which is why the
  // behaviour is now a pure function with real tests.
  assert.ok(routeSrc.includes("from '@/lib/relayRevoke'"), 'delegates to the revocation helper');
  assert.ok(routeSrc.includes('tokensToRevoke('), 'uses the shared targeting logic');
  assert.ok(
    !/if \(tokenId && e\.tokenId !== tokenId/.test(routeSrc),
    'no inline tokenId-only guard left behind — it silently missed the relayId path'
  );
  assert.ok(routeSrc.includes("url.searchParams.get('tokenId')"), 'tokenId param supported');
  assert.ok(routeSrc.includes('if (tokenId && !relayId)'),
    'token-specific relay handling precedes relayId/all handling');
  assert.ok(routeSrc.includes('relay.tokenId !== tokenId'),
    'only the matching active relay is disconnected');
  assert.ok(routeSrc.includes('revokedTokens'), 'reports how many were revoked');
});

test('relay-ws and agent-sync both record lastUsed', () => {
  assert.match(serverSrc, /relayWss\.on\('connection'[\s\S]{0,700}entry\.lastUsed = Date\.now\(\)/,
    'relay WebSocket records usage');
  assert.match(agentSyncSrc, /entry\.lastUsed = Date\.now\(\)/,
    'agent-sync records usage');
});

test('supporter gate is enforced at the relay WebSocket, not by scope', () => {
  // Guards the corrected understanding: if this check ever moves to depending on
  // entry.scope, an agent-scope token becomes a supporter bypass.
  assert.match(serverSrc, /relayWss\.on\('connection'[\s\S]{0,900}isRelaySupporter\(entry\)/,
    'relay-ws re-checks supporter status on every connect');
  assert.ok(routeSrc.includes('does not by itself gate Local Relay access'),
    'the route documents that scope is not the gate');
});
