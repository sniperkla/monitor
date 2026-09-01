// ── Regression tests: cross-tenant isolation ───────────────────────────────
//
// ConnectionRepository is constructed with a userId in most routes, which
// scopes every query to that owner. Four call sites omitted it, leaving the
// repo in legacy unscoped mode where findById() ignores ownership entirely.
// These tests keep the resulting fixes from being refactored away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '../src', rel), 'utf8');

const cronSource = read('app/api/mongo-sync/cron/route.js');
const compatSource = read('app/api/ssh/compat/route.js');
const webhookSource = read('app/api/deploy/webhook/route.js');

test('mongo-sync/cron: enforces connection ownership before building the URI', () => {
  // Without this an authenticated caller could pass another tenant's
  // connectionId and have that tenant's MongoDB credentials baked into the
  // generated cron script.
  assert.ok(
    cronSource.includes("Access denied: this connection belongs to another user"),
    'cron route must reject connections owned by another user'
  );
  // The check must actually compare against the session user.
  assert.ok(
    cronSource.includes('String(conn.userId) !== String(userId)'),
    'ownership check must compare conn.userId against the session userId'
  );
  // Unowned (pre-multi-tenancy) connections remain readable, matching
  // getSshConfig's convention.
  assert.ok(
    cronSource.includes('if (conn.userId && String(conn.userId) !== String(userId))'),
    'unowned legacy connections must stay accessible'
  );
});

test('ssh/compat: does not disclose the owning account email', () => {
  // The 403 body previously interpolated row.email, letting an authenticated
  // caller enumerate connection IDs and harvest other tenants' addresses.
  assert.equal(
    /\$\{row\.email/.test(compatSource),
    false,
    'owner email must not be interpolated into the error message'
  );
  // The message must be a plain literal, with no interpolation of any kind.
  const message = "error: 'This server belongs to another account. Log in as the owner to run checks on it.'";
  assert.ok(
    compatSource.includes(message),
    'the 403 error must be a static string with no owner data interpolated'
  );
});

test('deploy/webhook: project identifier is validated at the entry point', () => {
  // projectId feeds the settings key, a remote script path and a tmux session
  // name; the latter two are interpolated into shell commands.
  assert.equal(
    /searchParams\.get\('project'\)\s*\|\|\s*'default'/.test(webhookSource),
    false,
    'raw searchParams project value must not be used directly'
  );
  assert.ok(
    webhookSource.includes('/^[a-zA-Z0-9_-]{1,60}$/'),
    'project id must be matched against the restricted character class'
  );
  assert.ok(
    webhookSource.includes('Invalid project identifier'),
    'an invalid project id must be rejected with a 400'
  );
  // Must not silently fall back to 'default', which would deploy the wrong
  // project instead of the one that was named.
  assert.ok(
    webhookSource.includes('return NextResponse.json({ success: false, error: \'Invalid project identifier\' }, { status: 400 })'),
    'rejection must be an explicit 400, not a fallback to default'
  );
});

test('project id rules accept every id shape currently in use', () => {
  const re = /^[a-zA-Z0-9_-]{1,60}$/;
  // Real values observed in the settings collection.
  for (const id of ['default', 'aut', 'monitor', 'test', 'expense-backend', 'expense-frontend']) {
    assert.ok(re.test(id), 'expected ' + id + ' to remain valid');
  }
});

test('project id rules reject shell metacharacters', () => {
  const re = /^[a-zA-Z0-9_-]{1,60}$/;
  for (const id of ['x;rm -rf /', '$(id)', 'a`id`b', 'a/b', 'a b', 'a"b', "a'b", 'a&b', '']) {
    assert.equal(re.test(id), false, 'expected ' + JSON.stringify(id) + ' to be rejected');
  }
});
