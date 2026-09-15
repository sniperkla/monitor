// ── Regression tests: GitHub OAuth state binding ───────────────────────────
//
// The GitHub deploy integration is the only real OAuth flow in the app, and it
// spans two requests with no shared session:
//
//   GET /api/deploy/github/connect   (authenticated — mints state, redirects)
//   GET /api/deploy/github/callback  (a redirect FROM github.com — no session
//                                     of its own to trust)
//
// The callback therefore has to recover "whose project is this?" from the state
// record. It used to recover only the project name, and to write the token with
// `findOneAndUpdate({ key: dbKey })` — no userId filter. SystemSetting is unique
// on (userId, key), so every tenant with a `default` project owns a document
// under the same key, and the write landed on whichever one Mongo returned
// first. That is a cross-tenant account-linking primitive: the victim's deploys
// then pull the attacker's repository.
//
// These tests keep the binding from being refactored away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '../src', rel), 'utf8');

const connectSource = read('app/api/deploy/github/connect/route.js');
const callbackSource = read('app/api/deploy/github/callback/route.js');
const ghDisconnectSource = read('app/api/deploy/github/disconnect/route.js');
const bbDisconnectSource = read('app/api/deploy/bitbucket/disconnect/route.js');
const bbConnectSource = read('app/api/deploy/bitbucket/connect/route.js');
const sharedSource = read('lib/deployUserQuery.js');

test('connect: the OAuth state record carries the initiating userId', () => {
  // Without this the callback has nothing to attribute the token to, which is
  // the root cause of the cross-tenant write.
  assert.ok(
    connectSource.includes('userId: String(userId)'),
    'the state record must persist the initiating userId'
  );
  // The state write must itself be scoped, not just the payload.
  assert.ok(
    connectSource.includes('{ userId, key: `auto_deploy_oauth_state_${state}` }'),
    'the state upsert filter must include userId'
  );
  // connect is an authenticated route; the userId has to come from the session.
  assert.ok(
    connectSource.includes('normalizeUserId(session.user?.id'),
    'connect must derive the owner from the session'
  );
});

test('callback: consumes the state atomically, as a single-use token', () => {
  // findOne() + deleteOne() left a replay window: two concurrent callbacks
  // carrying the same state both pass the lookup before either deletes it.
  assert.ok(
    callbackSource.includes('SystemSetting.findOneAndDelete({ key: stateKey })'),
    'the state must be consumed with findOneAndDelete'
  );
  assert.equal(
    /SystemSetting\.findOne\(\{ key: stateKey \}\)/.test(callbackSource),
    false,
    'the non-atomic findOne() lookup must not come back'
  );
});

test('callback: refuses a state record that names no user', () => {
  assert.ok(
    callbackSource.includes("stateRecord.value?.userId || stateRecord.userId"),
    'the callback must read the owner out of the state record'
  );
  assert.ok(
    callbackSource.includes('state record carries no userId'),
    'a state without an owner must be rejected, not written unscoped'
  );
});

test('callback: scopes BOTH the config read and the config write by userId', () => {
  // The read leaked the wrong tenant's config into `existing`, and the write
  // overwrote it. Both must be scoped.
  assert.ok(
    callbackSource.includes('SystemSetting.findOne({ ...userIdQuery, key: dbKey })'),
    'the config read must be scoped by userId'
  );
  assert.ok(
    callbackSource.includes('{ ...userIdQuery, key: dbKey }'),
    'the config write must be scoped by userId'
  );
  // The exact shape of the old vulnerability — a key-only filter.
  assert.equal(
    /findOneAndUpdate\(\s*\{\s*key: dbKey\s*\}/.test(callbackSource),
    false,
    'an unscoped key-only config write must never come back'
  );
  assert.equal(
    /findOne\(\{\s*key:\s*dbKey\s*\}\)/.test(callbackSource),
    false,
    'an unscoped key-only config read must never come back'
  );
});

test('callback: rejects a session that does not own the state', () => {
  // OAuth CSRF: an attacker hands their state+code to a logged-in victim. The
  // state binding already covers it; this is the second, independent check.
  assert.ok(
    callbackSource.includes('String(sessionUserId) !== String(userId)'),
    'a session/state owner mismatch must be rejected'
  );
  assert.ok(
    callbackSource.includes("status: 403"),
    'the mismatch must be a 403'
  );
});

test('both flows validate the project id before it reaches a settings key', () => {
  // project is interpolated into `auto_deploy_config_<project>`.
  assert.ok(
    sharedSource.includes('export function validateProjectId'),
    'the shared validator must exist'
  );
  assert.ok(
    connectSource.includes('validateProjectId(url.searchParams.get('),
    'connect must validate the project id'
  );
  assert.ok(
    callbackSource.includes('validateProjectId(stateRecord.value?.project)'),
    'the callback must validate the project id from the state record'
  );
  assert.ok(
    bbConnectSource.includes('validateProjectId(searchParams.get('),
    'bitbucket connect must validate the project id'
  );
});

test('validateProjectId: preserves the `|| default` contract, rejects junk', async () => {
  const { validateProjectId } = await import('@/lib/deployUserQuery');

  // Absent / explicitly-empty must still mean "the default project" — this is
  // what `?project=` produces, and the routes resolved it via `|| 'default'`.
  // If this regressed to null, connecting GitHub without an explicit project
  // would start returning 400.
  for (const absent of [undefined, null, '']) {
    assert.equal(validateProjectId(absent), 'default', `${JSON.stringify(absent)} -> default`);
  }

  // Legitimate ids pass through, trimmed.
  assert.equal(validateProjectId('default'), 'default');
  assert.equal(validateProjectId('my-proj_1'), 'my-proj_1');
  assert.equal(validateProjectId(' padded '), 'padded');
  assert.equal(validateProjectId('a'.repeat(64)), 'a'.repeat(64));

  // Everything that would land in a settings key unescaped is rejected.
  for (const junk of ['a'.repeat(65), '   ', 'has space', 'a/b', 'a.b', 'a$b', 'a:b', '../../etc/passwd']) {
    assert.equal(validateProjectId(junk), null, `${JSON.stringify(junk)} must be rejected`);
  }
});

test('disconnect routes match both userId storage forms', () => {
  // A raw `{ userId }` filter (ObjectId) silently no-ops on legacy rows that
  // stored the id as a string — the user thinks the token was revoked.
  //
  // Assert on the UPDATE specifically: `{ ...userIdQuery, key: dbKey }` also
  // appears in the preceding read, so a plain substring check would pass even
  // with the revoke itself left unscoped.
  for (const [name, source] of [
    ['github/disconnect', ghDisconnectSource],
    ['bitbucket/disconnect', bbDisconnectSource],
  ]) {
    assert.ok(
      /findOneAndUpdate\(\{\s*\.\.\.userIdQuery,\s*key:\s*dbKey\s*\}/.test(source),
      `${name} must scope the revoke UPDATE with resolveUserIdQuery`
    );
    assert.equal(
      /findOneAndUpdate\(\{\s*userId,\s*key:\s*dbKey\s*\}/.test(source),
      false,
      `${name} must not match the revoke UPDATE on the raw userId alone`
    );
  }
});
