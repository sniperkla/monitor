// ── Regression test: disconnecting one relay must not revoke every token ─────
//
// Runtime test against src/lib/relayRevoke.js, not a source-text assertion.
// The old test ("DELETE can revoke a single token...") checked that the handler
// *mentioned* a token-scoped branch, which it did — while the branch was gated
// on a `tokenId` query param that no client ever sends. Every call came through
// the Settings UI as `?relayId=<id>`, which ignored the guard and swept the
// user's entire token inventory.
//
// Relay tokens are 365-day bearer credentials baked into background services
// with no renewal handshake, so that sweep silently breaks every relay the user
// runs on every machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRevokeTarget, tokensToRevoke } from '../src/lib/relayRevoke.js';

const tok = (id, userId, tokenId) => [id, { userId, tokenId }];

const USER = 'user-1';
const OTHER = 'user-2';

function threeTokens() {
  return new Map([
    tok('aaaaaaaa-1111', USER, 'aaaaaaaa'),
    tok('bbbbbbbb-2222', USER, 'bbbbbbbb'),
    tok('cccccccc-3333', USER, 'cccccccc'),
    tok('dddddddd-4444', OTHER, 'dddddddd'),
  ]);
}

function relaysForUser() {
  return new Map([
    ['relay-laptop', { relayId: 'relay-laptop', relayName: 'Laptop', tokenId: 'aaaaaaaa' }],
    ['relay-nas', { relayId: 'relay-nas', relayName: 'NAS', tokenId: 'bbbbbbbb' }],
  ]);
}

test('disconnecting one relay revokes only that relay\'s token', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    relayId: 'relay-laptop',
    userRelays: relaysForUser(),
  });
  assert.deepEqual(doomed, ['aaaaaaaa-1111']);
});

test('a second relay can be disconnected without touching the first', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    relayId: 'relay-nas',
    userRelays: relaysForUser(),
  });
  assert.deepEqual(doomed, ['bbbbbbbb-2222']);
});

test('relayId matching falls back to the relay map key and the display name', () => {
  const relays = relaysForUser();
  const byName = tokensToRevoke({ tokens: threeTokens(), userId: USER, relayId: 'NAS', userRelays: relays });
  assert.deepEqual(byName, ['bbbbbbbb-2222']);
});

test('a scoped revocation never crosses user boundaries', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: OTHER,
    relayId: 'relay-laptop',
    userRelays: relaysForUser(),
  });
  // other user has no matching relay, so nothing is revoked — and crucially
  // the sweep must not spill onto their token either
  assert.deepEqual(doomed, []);
});

test('an explicit tokenId revokes just that token', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    tokenId: 'cccccccc',
    userRelays: relaysForUser(),
  });
  assert.deepEqual(doomed, ['cccccccc-3333']);
});

test('a scoped request that resolves to nothing revokes nothing, never everything', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    relayId: 'relay-that-does-not-exist',
    userRelays: relaysForUser(),
  });
  assert.deepEqual(doomed, [], 'unknown relayId fell back to sweeping every token');
});

test('bare DELETE still sweeps, which is the intended revoke-all action', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    tokenId: null,
    relayId: null,
    userRelays: relaysForUser(),
  });
  assert.deepEqual(doomed, ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333']);
  assert.ok(!doomed.includes('dddddddd-4444'), 'swept another user\'s token');
});

test('sweep is scoped to the calling user even with no active relays', () => {
  const doomed = tokensToRevoke({
    tokens: threeTokens(),
    userId: USER,
    tokenId: null,
    relayId: null,
    userRelays: undefined,
  });
  assert.deepEqual(doomed, ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333']);
});

test('resolveRevokeTarget reports scope and resolves relay -> token', () => {
  assert.deepEqual(
    resolveRevokeTarget({ tokenId: 'aaaaaaaa', relayId: null, userRelays: relaysForUser() }),
    { scoped: true, targetTokenId: 'aaaaaaaa' }
  );
  assert.deepEqual(
    resolveRevokeTarget({ tokenId: null, relayId: 'relay-nas', userRelays: relaysForUser() }),
    { scoped: true, targetTokenId: 'bbbbbbbb' }
  );
  assert.deepEqual(
    resolveRevokeTarget({ tokenId: null, relayId: 'nope', userRelays: relaysForUser() }),
    { scoped: true, targetTokenId: null }
  );
  assert.deepEqual(
    resolveRevokeTarget({ tokenId: null, relayId: null, userRelays: relaysForUser() }),
    { scoped: false, targetTokenId: null }
  );
});

test('an empty inventory is handled without throwing', () => {
  assert.deepEqual(
    tokensToRevoke({ tokens: new Map(), userId: USER, relayId: 'relay-laptop', userRelays: relaysForUser() }),
    []
  );
  assert.deepEqual(
    tokensToRevoke({ tokens: new Map(), userId: USER, tokenId: null, relayId: null, userRelays: undefined }),
    []
  );
});
