import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPermanentAuthError } from '../src/utils/authErrors.js';

// The exact error string the user saw in the production log: MongoServerError
// with `code: 18, codeName: 'AuthenticationFailed'`. This MUST be detected so
// the polling loop stops hammering the server when credentials are bad.
test('detects MongoServerError: Authentication failed (the production bug)', () => {
  const msg = `Schema fetch error: MongoServerError: Authentication failed.
    at ignore-listed frames {
  errorLabelSet: Set(2) { 'HandshakeError', 'ResetPool' },
  errorResponse: { ok: 0, errmsg: 'Authentication failed.', code: 18, codeName: 'AuthenticationFailed' },
  ok: 0, code: 18, codeName: 'AuthenticationFailed',
}`;
  assert.equal(isPermanentAuthError(msg), true);
});

test('detects code: 18 even when the text is minimal', () => {
  assert.equal(isPermanentAuthError('code 18, AuthenticationFailed'), true);
});

test('detects Mongo bad auth / SCRAM failure messages', () => {
  assert.equal(isPermanentAuthError('MongoServerError: bad auth: Authentication failed'), true);
});

test('detects MySQL "Access denied"', () => {
  assert.equal(isPermanentAuthError('ERROR 1045 (28000): Access denied for user'), true);
});

test('detects Postgres "password authentication failed"', () => {
  assert.equal(isPermanentAuthError('FATAL: password authentication failed for user "app"'), true);
});

test('detects generic "Unauthorized" / "Invalid credentials"', () => {
  assert.equal(isPermanentAuthError('401 Unauthorized'), true);
  assert.equal(isPermanentAuthError('Invalid credentials supplied'), true);
});

test('accepts Error objects, not just strings', () => {
  assert.equal(isPermanentAuthError(new Error('Authentication failed')), true);
});

test('accepts unknown objects (defensive)', () => {
  assert.equal(isPermanentAuthError({ message: 'Authentication failed' }), true);
  assert.equal(isPermanentAuthError({ message: 'some other error' }), false);
  assert.equal(isPermanentAuthError({}), false);
});

test('does NOT flag transient network errors', () => {
  // These should keep retrying.
  assert.equal(isPermanentAuthError('ECONNREFUSED 127.0.0.1:27017'), false);
  assert.equal(isPermanentAuthError('ETIMEDOUT'), false);
  assert.equal(isPermanentAuthError('getaddrinfo ENOTFOUND db.example.com'), false);
  assert.equal(isPermanentAuthError('socket hang up'), false);
  assert.equal(isPermanentAuthError('Server selection timed out'), false);
});

test('does NOT flag empty / null / undefined', () => {
  assert.equal(isPermanentAuthError(''), false);
  assert.equal(isPermanentAuthError(null), false);
  assert.equal(isPermanentAuthError(undefined), false);
  assert.equal(isPermanentAuthError(0), false);
});

test('is case-insensitive', () => {
  assert.equal(isPermanentAuthError('AUTHENTICATION FAILED'), true);
  assert.equal(isPermanentAuthError('UnAuthorized'), true);
  assert.equal(isPermanentAuthError('ACCESS DENIED'), true);
});
