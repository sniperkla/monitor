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
  // Every term in this condition is a hole in the auth gate, so the assertion
  // names all of them. Adding a new bypass without updating this line is
  // exactly the regression this test exists to catch.
  assert.match(proxy,
    /if \(!isPublicPath\(pathname\) && !isSelfAuthenticating\(pathname\) && !authToken && !externalDeployTrigger && !apiKeyDeferred\)/,
    'missing auth returns through the normal 401 API path');
  assert.ok(proxy.includes('Content-Security-Policy'), 'protected responses receive CSP');
  assert.ok(proxy.includes('verifyCsrfPair'), 'unsafe requests receive CSRF validation');
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

test('database route retains defence-in-depth session checks', () => {
  assert.ok(database.includes('getServerSession'), 'route checks session itself');
  assert.match(database, /if \(!session\)[\s\S]{0,180}status: 401/, 'GET/POST reject unauthenticated access');
});
