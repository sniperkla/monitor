import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * ALLOW_UNVERIFIED_LOGIN is read at import time, so each scenario loads a
 * fresh instance via a cache-busting query string.
 */
async function load(bypass) {
  const prev = process.env.ALLOW_UNVERIFIED_LOGIN;
  if (bypass) process.env.ALLOW_UNVERIFIED_LOGIN = 'true';
  else delete process.env.ALLOW_UNVERIFIED_LOGIN;
  const mod = await import(`../src/lib/emailVerificationGate.js?bypass=${bypass ? 1 : 0}`);
  if (prev === undefined) delete process.env.ALLOW_UNVERIFIED_LOGIN;
  else process.env.ALLOW_UNVERIFIED_LOGIN = prev;
  return mod;
}

const verified = { emailVerified: true };
const pending = { emailVerified: false, emailVerification: { codeHash: 'deadbeef', expiresAt: new Date() } };
const legacy = { emailVerified: false };

test('a verified account is always allowed', async () => {
  const { evaluateEmailVerification } = await load(false);
  const r = evaluateEmailVerification(verified);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'verified');
});

test('an account issued a code that never confirmed it is blocked', async () => {
  // This is the actual threat: register with an address you do not control,
  // ignore the code, and use the account anyway.
  const { evaluateEmailVerification } = await load(false);
  const r = evaluateEmailVerification(pending);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unverified');
  assert.match(r.error, /verify your email/i);
});

test('accounts predating verification are grandfathered, not locked out', async () => {
  // Requiring emailVerified outright would lock out every existing account,
  // including the operators. A record only exists when a code was issued.
  const { evaluateEmailVerification } = await load(false);
  const r = evaluateEmailVerification(legacy);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'grandfathered');
});

test('verification survives a stale record once the flag is set', async () => {
  // The record is left in place after confirmation; the flag must win.
  const { evaluateEmailVerification } = await load(false);
  const r = evaluateEmailVerification({ emailVerified: true, emailVerification: { codeHash: 'x' } });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'verified');
});

test('ALLOW_UNVERIFIED_LOGIN bypasses the gate for incident response', async () => {
  const off = await load(false);
  assert.equal(off.evaluateEmailVerification(pending).allowed, false);
  assert.equal(off.isVerificationBypassed(), false);

  const on = await load(true);
  const r = on.evaluateEmailVerification(pending);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'bypassed');
  assert.equal(on.isVerificationBypassed(), true);
});

test('a missing user is a generic failure, not a crash', async () => {
  const { evaluateEmailVerification } = await load(false);
  const r = evaluateEmailVerification(null);
  assert.equal(r.allowed, false);
  // Must not leak which emails exist.
  assert.equal(r.error, 'Invalid email or password');
});

test('the module is importable without side effects on missing fields', async () => {
  const { evaluateEmailVerification } = await load(false);
  // An object with only an _id (a very old row shape) must not throw.
  assert.equal(evaluateEmailVerification({ _id: '1' }).allowed, true);
});
