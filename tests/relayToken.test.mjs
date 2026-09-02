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
const serverSrc = readSrc('server.js');
const agentSyncSrc = readSrc('src/app/api/firewall/agent-sync/route.js');

test('issuance is throttled', () => {
  assert.ok(routeSrc.includes('checkRateLimit'), 'rate limit helper imported');
  assert.match(routeSrc, /checkRateLimit\(`relay-token:\$\{userId\}`/,
    'throttle keyed per user, not globally');
  assert.ok(/status:\s*429/.test(routeSrc), 'returns 429 when throttled');
});

test('per-user token cap exists and evicts the oldest', () => {
  assert.ok(routeSrc.includes('MAX_TOKENS_PER_USER'), 'cap constant present');
  assert.match(routeSrc, /owned\.sort\(\(a, b\) =>[\s\S]{0,120}issuedAt/,
    'eviction orders by issue time so the OLDEST token goes first');
  assert.ok(routeSrc.includes('global.__relayTokens.delete(t)'), 'eviction actually deletes');
});

test('tokens carry audit metadata', () => {
  assert.ok(routeSrc.includes('tokenId:'), 'short handle for GET/DELETE');
  assert.ok(routeSrc.includes('issuedAt: now'), 'issue timestamp');
  assert.ok(routeSrc.includes('lastUsed: null'), 'lastUsed initialised');
  assert.ok(routeSrc.includes('label:'), 'optional human label');
});

test('TTL is configurable rather than hardcoded', () => {
  assert.ok(routeSrc.includes('RELAY_TOKEN_TTL_DAYS'), 'env override present');
  assert.ok(routeSrc.includes('tokenTtlMs'), 'computed per call');
  // The old code was a module-level 365-day const used blindly.
  assert.ok(!/^const TOKEN_TTL = 365/m.test(routeSrc),
    'hardcoded 365-day const must not come back');
});

test('GET returns a masked token, never the credential itself', () => {
  assert.ok(routeSrc.includes('masked:'), 'inventory exposes a masked form');
  assert.match(routeSrc, /slice\(-4\)/, 'only the last 4 characters are shown');
  // The full token must not be echoed anywhere in the inventory construction.
  const inventory = routeSrc.slice(routeSrc.indexOf('const tokens = []'), routeSrc.indexOf('tokens.sort'));
  assert.ok(!inventory.includes('token: t'), 'raw token value not included in inventory');
});

test('DELETE can revoke a single token without disconnecting unrelated relays', () => {
  assert.ok(routeSrc.includes("url.searchParams.get('tokenId')"), 'tokenId param supported');
  assert.match(routeSrc, /if \(tokenId && e\.tokenId !== tokenId && t\.slice\(0, 8\) !== tokenId\) continue;/,
    'non-targeted tokens are skipped');
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
