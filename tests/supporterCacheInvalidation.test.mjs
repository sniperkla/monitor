// ── Regression test: granting supporter must invalidate BOTH caches ─────────
//
// Two independent 5-minute caches resolve supporter status:
//   1. the module-level Map in src/utils/supporter.js, which backs
//      /api/user/supporter and therefore every UI gate.
//   2. global.__relaySupporterCache in server.js, which independently gates
//      every /relay-ws connection. server.js is CommonJS and queries the users
//      collection directly, so it cannot reuse cache #1.
//
// Originally only some paths cleared #2: admin *revoke* and the Ko-fi webhook
// did, but admin *grant* and user *redeem* did not. A user granted by an admin
// therefore saw the UI unlock immediately (cache #1 cleared) while their relay
// agent was still rejected with 4003 SUPPORTER_REQUIRED — until cache #2's TTL
// happened to expire, at which point it started working with no explanation.
//
// The fix centralises both clears inside invalidateSupporter(), so the bug
// class (a new grant path forgetting one of the two) cannot recur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const supporterSrc = read('../src/utils/supporter.js');

// Every route that can change supporter status.
const MUTATORS = [
  '../src/app/api/admin/supporters/route.js',
  '../src/app/api/user/supporter/redeem/route.js',
  '../src/app/api/webhooks/kofi/route.js',
];

test('invalidateSupporter clears the /relay-ws gate cache as well as its own', () => {
  assert.match(
    supporterSrc,
    /__relaySupporterCache\s*instanceof\s*Map[^\n]*\.clear\(\)/,
    'invalidateSupporter() must clear server.js\'s global.__relaySupporterCache, ' +
      'otherwise a granted supporter stays locked out of /relay-ws until the 5-minute TTL expires'
  );
});

test('invalidateSupporter still clears its own per-email cache', () => {
  assert.match(supporterSrc, /function\s+invalidateSupporter\s*\(\s*email\s*\)/);
  assert.match(supporterSrc, /cache\.delete\(cacheKey\(email\)\)/);
  assert.match(supporterSrc, /cache\.clear\(\)/);
});

test('admin supporters route imports its audit logger before error handling', () => {
  const src = read('../src/app/api/admin/supporters/route.js');
  assert.match(src, /import \{ auditLog \} from ['"]@\/lib\/auditLog['"]/,
    'admin supporters route must import auditLog before calling it in GET error handling');
  assert.match(src, /await auditLog\(\{[\s\S]*action: ['"]admin\.supporters\.list['"]/,
    'admin supporters GET must retain its audit event');
});

test('every supporter-mutating route calls invalidateSupporter', () => {
  for (const rel of MUTATORS) {
    const src = read(rel);
    assert.match(
      src,
      /invalidateSupporter\(/,
      `${rel} mutates supporter status but never calls invalidateSupporter(); ` +
        'the change will not take effect for up to 5 minutes'
    );
  }
});

test('no route hand-rolls the relay cache clear any more', () => {
  // Keeps a single source of truth. A route reaching into
  // global.__relaySupporterCache directly means invalidateSupporter() has a gap.
  for (const rel of MUTATORS) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /__relaySupporterCache/,
      `${rel} clears global.__relaySupporterCache directly; that now belongs in ` +
        'invalidateSupporter() so every path behaves identically'
    );
  }
});
