// ── Regression test: /api/user/me must not silently report isSupporter:false ──
//
// The bug: the route projects `User.findOne(...).select('role vault.isConfigured
// supporter')` — no `email` — then calls getSupporterStatus(dbUser.email).
// dbUser.email was therefore undefined, and getSupporterStatus short-circuits on
// `if (!email) return { isSupporter: false, ... }`.
//
// Two properties made this invisible:
//   1. It is not an error. Nothing throws and nothing logs, so the route returns
//      200 with a wrong value. The `.catch()` around the call never fires.
//   2. The UI does not read isSupporter from here (it uses /api/user/supporter),
//      so the wrong value had no visible symptom — it was a trap waiting for the
//      next consumer.
//
// The test below is deliberately a source contract rather than a runtime import:
// running the route needs a Next request context and a live database. It asserts
// the *coupling* (call site uses dbUser.email) alongside the *projection*
// (email must be selected), which is what actually broke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/api/user/me/route.js', import.meta.url), 'utf8');

test('/api/user/me selects email because it resolves supporter status from dbUser.email', () => {
  // The call site must pass the DB document's email...
  assert.match(
    src,
    /getSupporterStatus\(\s*dbUser\.email\s*\)/,
    'expected getSupporterStatus(dbUser.email); if this changed to session.user.email, ' +
      'the projection requirement below no longer applies and should be updated deliberately'
  );

  // ...which means the projection must actually include email.
  const select = src.match(/\.select\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  assert.ok(select, 'could not find a .select() projection in /api/user/me');
  const fields = select[1].split(/\s+/).filter(Boolean);
  assert.ok(
    fields.includes('email'),
    `projection must include 'email' — dbUser.email is passed to getSupporterStatus(), ` +
      `which returns isSupporter:false for an undefined email. Got: ${select[1]}`
  );
});

test('/api/user/me still reports isSupporter from the resolver, not a literal', () => {
  // Guards against "fixing" the symptom by hardcoding true/false.
  assert.match(src, /isSupporter:\s*!!supporter\.isSupporter/);
  assert.match(src, /supporterExpiresAt:\s*supporter\.expiresAt/);
});

test('getSupporterStatus short-circuits to false for a missing email', () => {
  // Documents the behaviour that made the projection bug silent rather than loud.
  const supporterSrc = readFileSync(new URL('../src/utils/supporter.js', import.meta.url), 'utf8');
  assert.match(
    supporterSrc,
    /if\s*\(!email\)\s*return\s*\{\s*isSupporter:\s*false/,
    'getSupporterStatus is expected to return isSupporter:false when email is falsy; ' +
      'if that guard was removed, callers passing undefined would hit the database instead'
  );
});
