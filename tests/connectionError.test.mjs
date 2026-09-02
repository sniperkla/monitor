import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeConnectionError, CONNECTION_ERROR_MESSAGES as M } from '../src/lib/connectionError.js';

// The leak this module exists to close: the MongoDB driver embeds topology
// detail in its error text. Observed verbatim in production:
//   "connection <monitor> to 127.0.0.1:33653 closed"
// That string discloses an internal hostname and an ephemeral relay port to
// any authenticated caller who submits a malformed URI.

const LEAKY = 'connection <monitor> to 127.0.0.1:33653 closed';

test('safeConnectionError: withholds internal host and port from the client', () => {
  const out = safeConnectionError(new Error(LEAKY));
  assert.ok(!out.includes('127.0.0.1'), 'must not echo the internal address');
  assert.ok(!out.includes('33653'), 'must not echo the internal port');
  assert.ok(!out.includes('monitor'), 'must not echo the internal hostname');
});

test('safeConnectionError: hands the withheld detail to the caller, not the client', () => {
  let withheld = null;
  const out = safeConnectionError(new Error(LEAKY), { onWithheld: (raw) => { withheld = raw; } });
  assert.equal(withheld, LEAKY, 'operator should still get the raw text for debugging');
  assert.notEqual(out, LEAKY, 'client should not');
});

test('safeConnectionError: never returns an empty string', () => {
  for (const err of [undefined, null, {}, new Error(''), { message: null }]) {
    const out = safeConnectionError(err);
    assert.ok(out && out.length > 0, 'must always produce a message');
  }
});

// --- recognised errors still give a useful answer -------------------------

const RECOGNISED = [
  [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.1.2.3:27017' }, M.refused, 'mongo ECONNREFUSED'],
  [{ code: 'ETIMEDOUT', message: 'timed out' }, M.timeout, 'ETIMEDOUT'],
  [{ code: 'ESOCKETTIMEDOUT', message: 'socket hang up' }, M.timeout, 'ESOCKETTIMEDOUT'],
  [{ message: 'Authentication failed.' }, M.auth, 'mongo auth failure (message-only)'],
  [{ code: 'ER_ACCESS_DENIED_ERROR', message: 'access denied' }, M.auth, 'mysql access denied'],
  [{ code: '28P01', message: 'password authentication failed' }, M.auth, 'pg bad password'],
  [{ code: '3D000', message: 'database "x" does not exist' }, M.missingDb, 'pg missing database'],
  [{ code: 'ER_BAD_DB_ERROR', message: 'unknown database' }, M.missingDb, 'mysql unknown database'],
  [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND db.internal' }, M.dns, 'DNS failure'],
  [{ code: 'EAI_AGAIN', message: 'temporary failure' }, M.dns, 'DNS temporary failure'],
];

for (const [err, expected, label] of RECOGNISED) {
  test(`safeConnectionError: ${label}`, () => {
    assert.equal(safeConnectionError(err), expected);
  });
}

// --- the route must actually use it ---------------------------------------

test('test-uri routes every failure path through safeConnectionError', () => {
  const src = readFileSync(new URL('../src/app/api/connections/test-uri/route.js', import.meta.url), 'utf8');

  assert.ok(
    src.includes("from '@/lib/connectionError'"),
    'test-uri must import the shared error mapper'
  );

  // Every handler catch block plus the outer catch should call it. We count
  // only `catch (error)` — the named handler form — because the file also has
  // inline `catch (e)` blocks that just close sockets.
  const callCount = src.split('safeConnectionError(').length - 1;
  const catchCount = src.split('} catch (error').length - 1;
  assert.ok(
    callCount >= catchCount,
    `expected a safeConnectionError call for every catch block (calls=${callCount}, catches=${catchCount})`
  );
});

test('test-uri no longer returns raw driver error text', () => {
  const src = readFileSync(new URL('../src/app/api/connections/test-uri/route.js', import.meta.url), 'utf8');
  // The old fall-through: `let errorMessage = error.message;` in each driver.
  assert.ok(
    !/let\s+errorMessage\s*=\s*error\.message/.test(src),
    'raw error.message must not be the default for any driver error path'
  );
  assert.ok(
    !/error:\s*error\.message/.test(src),
    'raw error.message must not be returned in any response body'
  );
});
