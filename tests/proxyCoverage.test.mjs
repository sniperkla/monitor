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
  assert.match(proxy, /if \(!isPublicPath\(pathname\) && !authToken && !externalDeployTrigger\)/,
    'missing auth returns through the normal 401 API path');
  assert.ok(proxy.includes('Content-Security-Policy'), 'protected responses receive CSP');
  assert.ok(proxy.includes('verifyCsrfPair'), 'unsafe requests receive CSRF validation');
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
