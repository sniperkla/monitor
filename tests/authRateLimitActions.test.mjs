// ── Regression test: action-based auth rate limits must be configured ──
//
// Background: a scanner report claimed "/api/auth/csrf has no rate limiting,
// 15 rapid unauthenticated requests, 0 rate-limited". That is a false positive —
// the endpoint IS limited, at 30 requests / 60s per IP, enforced in
// src/app/api/auth/[...nextauth]/route.js:
//
//     const gate = checkRateLimit('csrf', getClientIp(request));
//
// The scanner simply never exceeded the configured budget (15 < 30). Verified
// against production: 40 rapid requests -> exactly 30x200 then 10x429 with
// Retry-After.
//
// So why a test? Because the failure mode is silent. `checkRateLimit` in
// src/lib/authRateLimit.js does this:
//
//     const limit = LIMITS[action];
//     if (!limit) return { allowed: true, retryAfterSec: 0 };   // fails OPEN
//
// An action that is missing from LIMITS — or misspelled at the call site —
// does not throw and does not log. The endpoint simply becomes unlimited, and
// every response is a healthy 200. That is exactly the shape of the bug the
// scanner thought it had found, and it is invisible without this test.
//
// These assertions pin the action names on both sides so a rename on one side
// without the other fails the build instead of quietly disabling a limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const LIB = readFileSync(new URL('../src/lib/authRateLimit.js', import.meta.url), 'utf8');

/** Keys declared in the LIMITS map, e.g. `csrf: { max: 30, ... }`. */
function configuredActions() {
  const block = LIB.match(/const\s+LIMITS\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'could not locate the LIMITS map in src/lib/authRateLimit.js');
  return new Set([...block[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]));
}

/** Walk src/ for every .js file. */
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

/**
 * Call sites that pass an *action name* to the authRateLimit flavour of
 * checkRateLimit. Files importing it are detected by the import path; only
 * literal first arguments are checked (a computed key cannot be verified
 * statically, and none exist today).
 */
function actionCallSites() {
  const sites = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (!/checkRateLimit/.test(src)) continue;
    if (!/from\s+['"][^'"]*authRateLimit['"]/.test(src)) continue;
    for (const m of src.matchAll(/checkRateLimit\(\s*['"]([^'"]+)['"]/g)) {
      sites.push({ file: file.replace(ROOT, 'src/'), action: m[1] });
    }
  }
  return sites;
}

test('every action passed to authRateLimit.checkRateLimit is configured in LIMITS', () => {
  const declared = configuredActions();
  const sites = actionCallSites();

  // Sanity: if this ever drops to zero the regex stopped matching and the test
  // below would pass vacuously.
  assert.ok(sites.length > 0, 'found no action-based checkRateLimit call sites — has the import path changed?');

  const unknown = sites.filter((s) => !declared.has(s.action));
  assert.deepEqual(
    unknown,
    [],
    'These call sites pass an action that LIMITS does not define, so checkRateLimit ' +
      'fails OPEN (returns allowed:true) and the endpoint becomes unlimited:\n' +
      unknown.map((s) => `  ${s.file} -> '${s.action}'`).join('\n') +
      `\nDeclared actions: ${[...declared].sort().join(', ')}`
  );
});

test('csrf token issuance stays rate limited (scanner claim: "no rate limit")', () => {
  // Guards against the LIMITS.csrf entry being removed or renamed while the
  // call site in the NextAuth catch-all still asks for 'csrf'.
  const declared = configuredActions();
  assert.ok(declared.has('csrf'), "LIMITS is missing a 'csrf' entry — /api/auth/csrf would become unlimited");

  const nextauth = readFileSync(new URL('../src/app/api/auth/[...nextauth]/route.js', import.meta.url), 'utf8');
  assert.match(
    nextauth,
    /pathname\.endsWith\('\/api\/auth\/csrf'\)[\s\S]{0,200}checkRateLimit\('csrf',/,
    "expected the NextAuth catch-all to gate /api/auth/csrf through checkRateLimit('csrf', ...)"
  );
});

test('checkRateLimit fails open for unknown actions (documented footgun)', () => {
  // Not a bug to fix today — every call site is verified above — but this pins
  // the behaviour the other tests exist to defend against. If someone changes
  // this to fail CLOSED, this test should be updated alongside that decision.
  assert.match(LIB, /if\s*\(!limit\)\s*return\s*\{\s*allowed:\s*true/);
});
