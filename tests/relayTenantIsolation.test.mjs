// ── Regression test: a relay must never be handed to another tenant ──
//
// A Local Relay terminates on a real person's machine: it dials out from the
// user's computer to the server, and the server exposes a local TCP port that
// tunnels back to that computer. Owning that port means reaching the user's
// localhost — their MongoDB, MySQL, SSH, anything listening.
//
// findActiveRelay(userId, relayId) had a fallback intended for single-user
// setups — "if there is only one relay on the box, use it" — but it fired on
// ANY caller who did not themselves own a relay, not only on callers with no
// identity. With exactly one relay connected server-wide, another
// authenticated user's request fell through to it.
//
// Confirmed exploitable against production before the fix: a freshly
// registered account with no relay of its own POSTed
// mongodb://localhost:27017 to /api/connections/test-uri and got
// {"success":true,"message":"Successfully connected to MongoDB 7.0.31"} —
// the relay owner's database, on the relay owner's machine.
//
// These are runtime tests, not source-text assertions: findActiveRelay is a
// pure function over global.__activeRelays, so the behaviour can be exercised
// directly. The pre-fix version passes the single-user case and fails the
// cross-tenant ones, which is exactly the distinction that matters.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { findActiveRelay } from '../src/lib/sshTunnel.js';

/** Map<userId, Map<relayId, relay>> — the shape server.js maintains. */
function install(entries) {
  global.__activeRelays = new Map(
    Object.entries(entries).map(([uid, relays]) => [uid, new Map(Object.entries(relays))])
  );
}

const ALICE = 'user-alice';
const BOB = 'user-bob';

beforeEach(() => {
  global.__activeRelays = new Map();
});

test('a known user with no relay must NOT receive another tenant\'s relay', () => {
  // The exploited case: exactly one relay on the box, owned by someone else.
  install({ [ALICE]: { 'relay-1': { localPort: 40001, ws: {} } } });

  const found = findActiveRelay(BOB, undefined);

  assert.equal(
    found,
    null,
    "Bob owns no relay, so he must get null — returning Alice's relay tunnels " +
      "Bob's connection to Alice's machine"
  );
});

test('the single-relay fallback still works when the caller has no identity', () => {
  // Preserved deliberately: internal callers and single-user deployments have
  // no userId to scope by. Only the unauthenticated-by-omission case may use it.
  install({ [ALICE]: { 'relay-1': { localPort: 40001, ws: {} } } });

  const found = findActiveRelay(null, undefined);

  assert.ok(found?.relay, 'a caller with unknown identity should still get the only relay');
  assert.equal(found.relay.localPort, 40001);
});

test('a user with relays gets their own, never another tenant\'s', () => {
  install({
    [ALICE]: { 'relay-a': { localPort: 41000, ws: {} } },
    [BOB]: { 'relay-b': { localPort: 42000, ws: {} } },
  });

  const alice = findActiveRelay(ALICE, undefined);
  const bob = findActiveRelay(BOB, undefined);

  assert.equal(alice.relay.localPort, 41000, 'Alice must get her own relay');
  assert.equal(bob.relay.localPort, 42000, 'Bob must get his own relay');
  assert.equal(alice.userId, ALICE);
  assert.equal(bob.userId, BOB);
});

test('a known user with no relay gets null even when several relays exist', () => {
  install({
    [ALICE]: { 'relay-a': { localPort: 41000, ws: {} } },
    [BOB]: { 'relay-b': { localPort: 42000, ws: {} } },
  });

  assert.equal(findActiveRelay('user-carol', undefined), null);
});

test('a specific relayId is respected within the caller\'s own relays', () => {
  install({
    [ALICE]: {
      'relay-1': { localPort: 41000, ws: {} },
      'relay-2': { localPort: 41001, ws: {} },
    },
  });

  const found = findActiveRelay(ALICE, 'relay-2');
  assert.equal(found.relay.localPort, 41001);
  assert.equal(found.relayId, 'relay-2');
});

test('a known user whose relay map is empty gets null, not a fallback', () => {
  // Registered but no connected agent — must not fall through to anyone else.
  install({
    [ALICE]: {},
    [BOB]: { 'relay-b': { localPort: 42000, ws: {} } },
  });

  assert.equal(findActiveRelay(ALICE, undefined), null);
});
