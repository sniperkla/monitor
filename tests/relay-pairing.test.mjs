import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEnrollment,
  createInvite,
  approveEnrollment,
  exchangeEnrollment,
  normalizeUserCode,
  DEVICE_CODE_TTL_MS,
} from '@/lib/relayPairing';
import { issueRelayToken, MAX_TOKENS_PER_USER } from '@/lib/relayTokens';
import { state as supporterState } from '@/utils/supporter';

/** Distinct IPs keep the per-IP issuance throttle out of the assertions. */
let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter}`;

const enroll = (overrides = {}) =>
  createEnrollment({ client: 'local-relay', label: 'mbp', ip: nextIp(), ...overrides });

beforeEach(() => {
  global.__relayDeviceCodes = new Map();
  global.__relayPairingFailures = new Map();
  global.__relayTokens = new Map();
  supporterState.isSupporter = true;
});

describe('createEnrollment', () => {
  test('returns a device code and a human-transcribable user code', () => {
    const e = enroll();
    assert.ok(e.deviceCode, 'device code must be minted');
    assert.match(e.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(e.expiresIn, Math.floor(DEVICE_CODE_TTL_MS / 1000));
  });

  test('user code alphabet excludes glyphs humans confuse', () => {
    for (let i = 0; i < 60; i++) {
      const { userCode } = enroll();
      // I, L, O, 0 and 1 are the classic misreads when copying from a terminal.
      assert.ok(!/[ILO01]/.test(userCode), `ambiguous glyph in ${userCode}`);
    }
  });

  test('device code is 256-bit — too large to enumerate', () => {
    const { deviceCode } = enroll();
    const bytes = Buffer.from(deviceCode, 'base64url');
    assert.equal(bytes.length, 32);
  });

  test('mints nothing: the store holds a pending entry with no user bound', () => {
    const e = enroll();
    const entry = global.__relayDeviceCodes.get(e.deviceCode);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.userId, null);
  });

  test('user codes do not collide across enrollments', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(enroll().userCode);
    assert.equal(seen.size, 200);
  });
});

describe('normalizeUserCode', () => {
  test('accepts lowercase, missing dash and stray whitespace', () => {
    assert.equal(normalizeUserCode('k7qp2m4x'), 'K7QP-2M4X');
    assert.equal(normalizeUserCode(' k7qp-2m4x '), 'K7QP-2M4X');
  });

  test('rejects wrong-length input', () => {
    assert.equal(normalizeUserCode('K7QP'), null);
    assert.equal(normalizeUserCode('K7QP-2M4X-9999'), null);
    assert.equal(normalizeUserCode(''), null);
  });
});

describe('approveEnrollment', () => {
  test('binds the enrollment to the signed-in user', async () => {
    const e = enroll();
    const res = await approveEnrollment({ userCode: e.userCode, userId: 'user-1', email: 'a@b.c' });
    assert.ok(res.ok);
    assert.equal(res.entry.userId, 'user-1');
    assert.equal(res.entry.status, 'approved');

    const stored = global.__relayDeviceCodes.get(e.deviceCode);
    assert.equal(stored.userId, 'user-1');
    assert.equal(stored.email, 'a@b.c');
  });

  test('rejects an unknown code', async () => {
    enroll();
    const res = await approveEnrollment({ userCode: 'ZZZZ-ZZZZ', userId: 'user-1' });
    assert.equal(res.ok, false);
    assert.match(res.error, /No pending setup request/);
  });

  test('accepts a code typed in lowercase without the dash', async () => {
    const e = enroll();
    const res = await approveEnrollment({
      userCode: e.userCode.replace('-', '').toLowerCase(),
      userId: 'user-1',
    });
    assert.ok(res.ok);
  });

  test('relay scope is gated on supporter membership', async () => {
    supporterState.isSupporter = false;
    const e = enroll({ scope: 'relay' });
    const res = await approveEnrollment({ userCode: e.userCode, userId: 'user-1', email: 'a@b.c' });
    assert.equal(res.ok, false);
    assert.equal(res.requiresSupporter, true);
    // Must stay pending so the user can upgrade and retry with the same code.
    assert.equal(global.__relayDeviceCodes.get(e.deviceCode).status, 'pending');
  });

  test('agent scope is not gated', async () => {
    supporterState.isSupporter = false;
    const e = enroll({ scope: 'agent' });
    const res = await approveEnrollment({ userCode: e.userCode, userId: 'user-1' });
    assert.ok(res.ok);
  });

  test('repeated wrong codes lock the user out', async () => {
    enroll();
    for (let i = 0; i < 8; i++) {
      const r = await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'brute' });
      assert.equal(r.ok, false);
      assert.match(r.error, /No pending setup request/);
    }
    const locked = await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'brute' });
    assert.equal(locked.ok, false);
    assert.match(locked.error, /Too many incorrect codes/);
  });

  test('the lockout is per user — one attacker cannot block another install', async () => {
    enroll();
    for (let i = 0; i < 8; i++) {
      await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'brute' });
    }
    const victim = enroll();
    const res = await approveEnrollment({ userCode: victim.userCode, userId: 'innocent' });
    assert.ok(res.ok, 'an unrelated user must still be able to approve');
  });

  test('a malformed code is a likely typo, so it does not count toward lockout', async () => {
    enroll();
    for (let i = 0; i < 12; i++) {
      const r = await approveEnrollment({ userCode: 'nope', userId: 'fumbler' });
      assert.match(r.error, /not valid/);
    }
    const e = enroll();
    const res = await approveEnrollment({ userCode: e.userCode, userId: 'fumbler' });
    assert.ok(res.ok, 'bad formatting must not burn the lockout budget');
  });

  test('a successful approval clears the failure counter', async () => {
    enroll();
    for (let i = 0; i < 7; i++) {
      await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'recover' });
    }
    const good = enroll();
    assert.ok((await approveEnrollment({ userCode: good.userCode, userId: 'recover' })).ok);

    // Back to a clean budget rather than sitting one strike from lockout.
    const other = enroll();
    await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'recover' });
    assert.ok((await approveEnrollment({ userCode: other.userCode, userId: 'recover' })).ok);
  });
});

describe('exchangeEnrollment', () => {
  test('reports pending until a user approves', async () => {
    const e = enroll();
    const pending = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });
    assert.equal(pending.status, 'pending');
    assert.ok(pending.expiresIn > 0);
  });

  test('returns a real relay token once approved', async () => {
    const e = enroll({ scope: 'agent' });
    await approveEnrollment({ userCode: e.userCode, userId: 'user-1', email: 'a@b.c' });

    const got = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });
    assert.equal(got.status, 'ok');
    assert.ok(got.token);

    const entry = global.__relayTokens.get(got.token);
    assert.ok(entry, 'token must land in the same inventory /api/relay/token uses');
    assert.equal(entry.userId, 'user-1');
    assert.equal(entry.email, 'a@b.c');
    assert.equal(entry.scope, 'agent');
    // Provenance — lets the inventory tell paired installs from hand-pasted ones.
    assert.equal(entry.pairingId, e.userCode);
  });

  test('is single use: a replay cannot mint a second token', async () => {
    const e = enroll();
    await approveEnrollment({ userCode: e.userCode, userId: 'user-1' });

    const first = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });
    assert.equal(first.status, 'ok');

    const replay = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });
    assert.equal(replay.status, 'expired');
    assert.equal(global.__relayTokens.size, 1, 'replay must not mint again');
  });

  test('a wrong device code is indistinguishable from an expired one', async () => {
    enroll();
    const bogus = await exchangeEnrollment({ deviceCode: 'not-a-real-code', ip: nextIp() });
    assert.equal(bogus.status, 'expired');

    const e = enroll();
    global.__relayDeviceCodes.get(e.deviceCode).expiresAt = Date.now() - 1;
    const stale = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });
    assert.equal(stale.status, 'expired');
    // Same status either way — no oracle for "did this code ever exist".
    assert.equal(bogus.status, stale.status);
  });

  test('an expired enrollment cannot be approved after the fact', async () => {
    const e = enroll();
    global.__relayDeviceCodes.get(e.deviceCode).expiresAt = Date.now() - 1;
    const res = await approveEnrollment({ userCode: e.userCode, userId: 'user-1' });
    assert.equal(res.ok, false);
  });
});

describe('end-to-end pairing', () => {
  test('a fresh install produces exactly one token and no leftovers', async () => {
    const e = enroll({ label: 'prod-edge-01', scope: 'agent' });
    await approveEnrollment({ userCode: e.userCode, userId: 'user-42', email: 'ops@x.dev' });
    const got = await exchangeEnrollment({ deviceCode: e.deviceCode, ip: nextIp() });

    assert.equal(global.__relayTokens.size, 1);
    assert.equal(global.__relayDeviceCodes.size, 0, 'enrollment must be consumed');
    assert.equal(global.__relayTokens.get(got.token).label, 'prod-edge-01');
  });

  test('two machines pair independently for the same user', async () => {
    const a = enroll({ label: 'laptop' });
    const b = enroll({ label: 'desktop' });
    await approveEnrollment({ userCode: a.userCode, userId: 'user-1' });
    await approveEnrollment({ userCode: b.userCode, userId: 'user-1' });
    const ta = await exchangeEnrollment({ deviceCode: a.deviceCode, ip: nextIp() });
    const tb = await exchangeEnrollment({ deviceCode: b.deviceCode, ip: nextIp() });

    assert.equal(ta.status, 'ok');
    assert.equal(tb.status, 'ok');
    assert.notEqual(ta.token, tb.token);
    assert.equal(global.__relayTokens.size, 2);
  });
});

describe('createInvite (browser-driven install over SSH)', () => {
  test('returns a claim code already bound to the signed-in user', () => {
    const r = createInvite({ userId: 'user-1', email: 'a@b.c', scope: 'agent', ip: nextIp() });
    assert.ok(r.claimCode);
    assert.equal(r.expiresIn, Math.floor(DEVICE_CODE_TTL_MS / 1000));

    const entry = global.__relayDeviceCodes.get(r.claimCode);
    assert.equal(entry.status, 'approved');
    assert.equal(entry.userId, 'user-1');
    assert.equal(entry.userCode, null, 'nothing to type — already authorized');
  });

  test('the agent exchanges it immediately with no approval step', async () => {
    const r = createInvite({ userId: 'user-1', email: 'a@b.c', ip: nextIp() });
    const got = await exchangeEnrollment({ deviceCode: r.claimCode, ip: nextIp() });
    assert.equal(got.status, 'ok');
    assert.equal(global.__relayTokens.get(got.token).userId, 'user-1');
  });

  test('is single use', async () => {
    const r = createInvite({ userId: 'user-1', ip: nextIp() });
    assert.equal((await exchangeEnrollment({ deviceCode: r.claimCode, ip: nextIp() })).status, 'ok');
    assert.equal(
      (await exchangeEnrollment({ deviceCode: r.claimCode, ip: nextIp() })).status,
      'expired'
    );
    assert.equal(global.__relayTokens.size, 1);
  });

  test('has no typable user code, so nobody else can claim it by guessing', async () => {
    const r = createInvite({ userId: 'victim', ip: nextIp() });
    const entry = global.__relayDeviceCodes.get(r.claimCode);

    const attack = await approveEnrollment({ userCode: 'AAAA-AAAA', userId: 'attacker' });
    assert.equal(attack.ok, false);
    assert.equal(entry.userId, 'victim', 'the pre-authorized owner must not change');
  });
});

describe('issueRelayToken cap (shared by both issuance paths)', () => {
  test('evicts the oldest token rather than growing without bound', () => {
    const issued = [];
    for (let i = 0; i < MAX_TOKENS_PER_USER + 4; i++) {
      issued.push(issueRelayToken({ userId: 'user-1', label: `t${i}` }));
    }
    assert.equal(global.__relayTokens.size, MAX_TOKENS_PER_USER);

    // The oldest four are gone; the newest survived.
    for (let i = 0; i < 4; i++) {
      assert.equal(global.__relayTokens.has(issued[i].token), false, `t${i} should be evicted`);
    }
    assert.equal(global.__relayTokens.has(issued[issued.length - 1].token), true);
  });

  test('the cap is per user, not global', () => {
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) issueRelayToken({ userId: 'user-a' });
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) issueRelayToken({ userId: 'user-b' });
    assert.equal(global.__relayTokens.size, MAX_TOKENS_PER_USER * 2);
  });
});
