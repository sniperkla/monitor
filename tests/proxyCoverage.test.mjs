// ── Regression test: middleware coverage for state-changing API routes ───────
//
// F-04: the proxy matcher previously excluded /api/settings/database and
// /api/deploy/trigger. Exclusion removed auth-gate, CSP, and CSRF coverage.
// Both routes have in-route session checks, but trigger also supports external
// deploy hooks carrying a signed `token` / `webhook_token` without a session.
// That external path remains a narrow, explicit exception in the proxy and is
// validated by the route itself with timing-safe comparison.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const proxy = readSrc('src/proxy.js');
const trigger = readSrc('src/app/api/deploy/trigger/route.js');
const database = readSrc('src/app/api/settings/database/route.js');
const connections = readSrc('src/app/api/connections/route.js');
const appContext = readSrc('src/context/AppContext.js');

test('matcher includes settings/database', () => {
  const matcher = proxy.slice(proxy.indexOf('export const config'));
  // It is allowed in comments, but must not be in the negative lookahead.
  const negativeLookahead = matcher.match(/\/\(\(\?!([\s\S]*?)\)\.\*\)/)?.[1] || '';
  assert.ok(!negativeLookahead.includes('api/settings/database'),
    'settings/database must not be excluded from middleware');
});

test('matcher includes deploy/trigger', () => {
  const matcher = proxy.slice(proxy.indexOf('export const config'));
  // It is allowed in comments, but must not be in the negative lookahead.
  const negativeLookahead = matcher.match(/\/\(\(\?!([\s\S]*?)\)\.\*\)/)?.[1] || '';
  assert.ok(!negativeLookahead.includes('api/deploy/trigger'),
    'deploy/trigger must not be excluded from middleware');
});

test('proxy still authenticates protected API requests', () => {
  // Every term in the gate condition is a hole in the auth gate, so the
  // assertion names all of them. Adding a new bypass without updating this
  // line is exactly the regression this test exists to catch.
  //
  // Asserted term by term rather than as one literal string. The exact-match
  // version went stale three times in a single day — each time the line was
  // legitimately restructured, the assertion silently stopped describing the
  // gate until the suite went red. Matching the whole expression tests the
  // punctuation; matching the terms tests the security property.
  const gateStart = proxy.indexOf('const skipsSessionGate');
  const gateEnd = proxy.indexOf('pathname.startsWith("/api/")', gateStart);
  const gate = proxy.slice(gateStart, gateEnd);
  assert.ok(gate.length > 0, 'auth gate not found — test is stale if this fails');

  // The gate itself: every negative guard must still be there, and combined
  // with && so that no single bypass is enough on its own.
  for (const term of ['skipsSessionGate', 'authToken', 'externalDeployTrigger', 'apiKeyDeferred']) {
    assert.ok(new RegExp(`!${term}\\b`).test(gate), `auth gate no longer checks !${term}`);
  }
  assert.ok(/&&\s*!authToken/.test(gate), 'gate is conjunctive — no single bypass suffices');

  // And skipsSessionGate is a bounded disjunction of named allowlists, not a
  // catch-all. Adding a fourth way to skip the gate is a security decision and
  // must show up here.
  for (const term of [
    'isPublicPath(pathname)',
    'isSelfAuthenticating(pathname)',
    'isPreAuthPath(pathname)',
  ]) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(new RegExp(escaped).test(gate), `session-gate bypass no longer includes ${term}`);
  }
  assert.ok(!/\|\|\s*true\b/.test(gate), 'session-gate bypass must not be unconditionally true');
  assert.ok(proxy.includes('Content-Security-Policy'), 'protected responses receive CSP');
  assert.ok(proxy.includes('verifyCsrfPair'), 'unsafe requests receive CSRF validation');
});

test('pre-auth bypass is limited to account lifecycle routes', () => {
  // Registration and password reset have to work while signed out, but this is
  // the same "skip the session gate" escape hatch as SELF_AUTHENTICATING_PATHS,
  // so it must stay a short literal list. Widening it would disable
  // authentication for anything it matched.
  const block = proxy.slice(
    proxy.indexOf('const PRE_AUTH_PATHS'),
    proxy.indexOf('function isPreAuthPath')
  );
  const entries = [...block.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(entries.length > 0, 'the allowlist must not be empty (test is stale if it is)');
  assert.ok(entries.length <= 6, `allowlist grew unexpectedly: ${entries.join(', ')}`);
  for (const p of entries) {
    assert.ok(p.startsWith('/api/auth/'), `non-auth path in the pre-auth allowlist: ${p}`);
    assert.ok(
      /register|forgot-password|reset-password|verify-email/.test(p),
      `unexpected pre-auth path: ${p}`
    );
  }
  // The front door specifically: signed-out users must be able to sign up.
  // The matcher used to exclude all of /api/auth, so this was reachable
  // implicitly; narrowing it left register behind the gate returning 401.
  assert.ok(entries.includes('/api/auth/register'),
    'registration would 401 for every signed-out user');
  assert.ok(entries.includes('/api/auth/forgot-password'),
    'password reset would 401 for every signed-out user');
});

test('self-authenticating bypass is limited to passkey login', () => {
  // Passkey auth must reach its own handler while signed out — but "signed out
  // route that skips the gate" is a dangerous thing to leave unbounded. The
  // list must stay a short literal of WebAuthn paths.
  const block = proxy.slice(
    proxy.indexOf('const SELF_AUTHENTICATING_PATHS'),
    proxy.indexOf('function isPublicPath')
  );
  const entries = [...block.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(entries.length > 0, 'the allowlist must not be empty (test is stale if it is)');
  assert.ok(entries.length <= 4, `allowlist grew unexpectedly: ${entries.join(', ')}`);
  for (const p of entries) {
    assert.ok(p.startsWith('/api/auth/webauthn/authenticate'),
      `non-passkey path in the self-authenticating allowlist: ${p}`);
  }
});

test('API-key deferral is allowlisted and closed by the route', () => {
  // The middleware cannot validate an API key (no database), so it defers the
  // auth gate to the handler. That is only safe if (a) the deferral is scoped
  // to a short route allowlist, (b) it requires an actual credential header,
  // and (c) every allowlisted handler really calls requireApiAuth().
  const block = proxy.slice(
    proxy.indexOf('const API_KEY_ROUTES'),
    proxy.indexOf('function hasApiKeyCredential')
  );
  const patterns = [...block.matchAll(/\/\^([^/]+)\/\s*,?/g)].map((m) => m[1]);
  assert.ok(patterns.length > 0, 'the route allowlist must not be empty');
  assert.ok(patterns.length <= 3, `API-key route allowlist grew unexpectedly: ${patterns.join(', ')}`);

  // (b) deferral requires a credential, not merely a matching path
  assert.match(proxy, /!authToken && hasApiKeyCredential\(req\) && isApiKeyRoute\(pathname\)/,
    'API-key deferral must require a credential header on the request');

  // (c) the allowlisted handler closes the loop
  assert.ok(connections.includes('requireApiAuth'),
    'connections route must call requireApiAuth() to verify the deferred credential');
});

test('external deploy exception is narrow and explicit', () => {
  assert.ok(proxy.includes('function isExternalDeployTrigger'), 'named exception helper present');
  assert.ok(proxy.includes('req.nextUrl.pathname !== "/api/deploy/trigger"'),
    'exception is limited to deploy/trigger');
  assert.ok(proxy.includes('"token", "webhook_token"'),
    'only documented external credentials qualify');
  assert.ok(proxy.includes('value.length <= 4096'), 'credential query values are bounded');
  assert.match(proxy, /!hasNonCookieCredential\(req\) &&\n\s*!externalDeployTrigger/,
    'external exception is limited to the CSRF/auth branch, not global');
});

test('trigger validates external credentials in-route', () => {
  assert.ok(trigger.includes('timingSafeCompare'), 'timing-safe comparison exists');
  assert.ok(trigger.includes('config.secret'), 'project secret is checked');
  assert.ok(trigger.includes('webhookToken'), 'webhook token lookup exists');
  assert.ok(trigger.includes('Invalid or missing secret token'), 'invalid secret is rejected');
});

test('database route retains defence-in-depth auth checks', () => {
  // The point of this guard is that the route must NOT rely on middleware for
  // authorization — middleware only proves "some session exists", not that the
  // caller is allowed to repoint the server's database.
  //
  // The route now delegates to requireAdmin(), which is strictly stronger than
  // a bare getServerSession(): it re-reads the role from the database instead
  // of trusting the session object (which deliberately omits `role`), and
  // writes an audit entry on every denial. So the assertion is that the route
  // goes through requireAdmin AND that requireAdmin really authenticates.
  const requireAdminSrc = readSrc('src/lib/requireAdmin.js');
  const migrate = readSrc('src/app/api/settings/database/migrate/route.js');

  for (const [name, src] of [['database', database], ['migrate', migrate]]) {
    assert.ok(src.includes('requireAdmin'), `${name} route must call requireAdmin()`);
    assert.ok(!src.includes('getServerSession('),
      `${name} route must not hand-roll a session check; use requireAdmin() so the role is re-checked against the DB`);
    // Both handlers must bail out on the helper's error response.
    const gates = [...src.matchAll(/const \{[^}]*\} = await requireAdmin\(request\);\s*\n\s*if \(error\) return error;/g)];
    assert.ok(gates.length >= 1, `${name} route must return requireAdmin's error response immediately`);
  }

  // Delegation is only as good as the helper.
  assert.ok(requireAdminSrc.includes('getServerSession(authOptions)'),
    'requireAdmin must establish a session with the app authOptions');
  assert.match(requireAdminSrc, /if \(!session\?\.user\?\.id\)[\s\S]{0,300}status: 401/,
    'requireAdmin must 401 when there is no session');
  assert.match(requireAdminSrc, /if \(!isAdminByRole\)[\s\S]{0,600}status: 403/,
    'requireAdmin must 403 when the authenticated user is not an admin');
  assert.ok(requireAdminSrc.includes("await User.findById(session.user.id)"),
    'requireAdmin must re-read the role from the database, not from the session');
});

test('shared connection inventory waits for session resolution', () => {
  // Connection-aware apps consume `connectionsReady` on their first render.
  // The provider must never publish an empty inventory that was fetched before
  // NextAuth finished resolving the signed-in session; navigating to SSH
  // Manager must not be required to force a retry.
  assert.match(appContext, /sessionStatus === 'loading'\) return;/,
    'AppContext must defer the initial connection fetch while the session loads');
  assert.match(appContext, /Fetching connections after session ready/,
    'AppContext must bootstrap the shared inventory after authentication resolves');
  assert.match(appContext, /SET_CONNECTIONS_READY', payload: false/,
    'a refresh must mark the inventory pending so apps do not consume stale data');
});

test('database route does not echo credentials and gates SSRF', () => {
  // Regression guards for F-07 (production DB URI disclosed to any session)
  // and F-10 (repoint the app DB at an attacker-chosen host with no SSRF check).
  // Scope this to the GET handler's response body: `uri` legitimately appears
  // elsewhere in the file (as a POST parameter, and inside describeUri(uri)).
  const getFn = database.slice(database.indexOf('export async function GET'));
  const getBody = getFn.slice(0, getFn.indexOf('\nexport async function POST'));
  const returnedKeys = [...getBody.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1]);
  assert.ok(!returnedKeys.includes('uri') && !returnedKeys.includes('currentUri'),
    'GET must not return the raw URI or currentUri (they embed production credentials)');
  assert.ok(getBody.includes('describeUri'), 'GET should return a redacted descriptor instead');
  // The descriptor itself must not leak the userinfo section.
  const describeFn = database.slice(database.indexOf('function describeUri'));
  assert.ok(!/\burl\.(username|password)\b/.test(describeFn.slice(0, describeFn.indexOf('\n}'))),
    'describeUri must not expose credentials');

  assert.ok(database.includes('assertSafeUri'), 'POST must run the supplied URI through the SSRF guard');
  assert.ok(database.includes('auditLog'), 'repointing the server database must be audited');
  // Migration moves stored credentials to another database: opt-in only.
  assert.ok(database.includes('body.migrate === true'),
    'auto-migration must be opt-in, not the default');
});
