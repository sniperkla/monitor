import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES } from '../src/lib/passwordPolicy.js';

const ok = (pw, ctx) => validatePassword(pw, ctx).ok;

test('minimum length is enforced and is stronger than the old 6', () => {
  assert.ok(MIN_PASSWORD_LENGTH >= 10, `policy must be at least 10, got ${MIN_PASSWORD_LENGTH}`);
  assert.equal(ok('short1!'), false);
  assert.equal(ok('12345678'), false);
  assert.equal(ok('a'.repeat(MIN_PASSWORD_LENGTH - 1)), false);
  assert.equal(ok('a'.repeat(MIN_PASSWORD_LENGTH)), true);
});

test('rejects empty / non-string input', () => {
  for (const bad of ['', null, undefined, 12345, {}]) {
    assert.equal(ok(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test('enforces the bcrypt 72-byte limit', () => {
  // 73 ASCII characters — would be silently truncated by bcrypt.
  assert.equal(ok('a'.repeat(73)), false);
  assert.equal(ok('a'.repeat(72)), true);
  // A multibyte passphrase is measured in BYTES, not characters.
  assert.equal(ok('é'.repeat(40)), false, '80 bytes must be rejected even though it is 40 characters');
  assert.equal(ok('é'.repeat(36)), true, '72 bytes must be accepted');
  assert.equal(MAX_PASSWORD_BYTES, 72);
});

test('rejects common passwords, including separator variants', () => {
  for (const bad of ['password123', 'Passw0rd!', 'qwertyuiop', 'letmein123', 'admin123456', 'monkey1234']) {
    assert.equal(ok(bad), false, `${bad} must be rejected`);
  }
  // Obfuscation by inserting separators must not slip past.
  for (const bad of ['p a s s w o r d 1 2 3', 'pass-word-123', 'pass.word.123']) {
    assert.equal(ok(bad), false, `${bad} must be rejected`);
  }
});

test('rejects passwords derived from the user email', () => {
  const ctx = { email: 'katanyooang1000@gmail.com' };
  assert.equal(ok('katanyooang1000', ctx), false, 'local part must be rejected');
  // Derived rather than hardcoded, so an edit to the fixture cannot silently
  // turn this into a vacuous test.
  const reversed = [...'katanyooang1000'].reverse().join('');
  assert.equal(ok(reversed, ctx), false, `reversed local part (${reversed}) must be rejected`);
  assert.equal(ok('gmail', ctx), false, 'domain name must be rejected');
  assert.equal(ok('Tr0ub4dor&3xyz', ctx), true, 'unrelated password must pass');
});

test('accepts a strong passphrase', () => {
  const result = validatePassword('correct-horse-battery-staple-42');
  assert.equal(result.ok, true, result.error);
});

test('error messages are user-facing and do not echo the password', () => {
  const r = validatePassword('abc');
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes('abc'));
  assert.match(r.error, /at least 10 characters/);
});
