// ── Regression tests for final F-08/F-09 findings ───────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const rclone = readSrc('src/app/api/rclone/exec/route.js');
const testUri = readSrc('src/app/api/connections/test-uri/route.js');
const deploy = readSrc('src/app/api/deploy/config/route.js');

test('rclone execution asserts session in-route', () => {
  assert.ok(rclone.includes("from 'next-auth/next'"));
  assert.ok(rclone.includes("from '@/lib/auth'"));
  assert.match(rclone, /const session = await getServerSession\(authOptions\)/);
  assert.match(rclone, /if \(!session\)[\s\S]{0,140}status: 401/);
});

test('raw database URI testing asserts session in-route', () => {
  assert.ok(testUri.includes("from 'next-auth/next'"));
  assert.ok(testUri.includes("from '@/lib/auth'"));
  assert.match(testUri, /const session = await getServerSession\(authOptions\)/);
  assert.match(testUri, /if \(!session\)[\s\S]{0,140}status: 401/);
});

test('deploy config validates project identifiers', () => {
  assert.ok(deploy.includes('PROJECT_ID_PATTERN'));
  assert.match(deploy, /\^\[a-zA-Z0-9_\-\]\{1,64\}\$/);
  assert.ok(deploy.includes('validateProjectId'));
  assert.ok(deploy.includes('Invalid project id'));
});

test('deploy config validates request shape and target type', () => {
  assert.ok(deploy.includes('Request body must be an object'));
  assert.ok(deploy.includes("['local', 'ssh'].includes(targetType)"));
  assert.ok(deploy.includes('Invalid target type'));
  assert.ok(deploy.includes('SAFE_TEXT_MAX'));
});

test('deploy config sanitizes duplicate-key errors', () => {
  assert.ok(deploy.includes('safeErrorMessage'));
  assert.ok(deploy.includes('error?.code === 11000'));
  assert.ok(deploy.includes('status: duplicate ? 409 : 500'));
  assert.ok(deploy.includes('A deployment configuration with this project already exists.'));
  // Raw driver text must not be returned from either catch path.
  assert.ok(!deploy.includes('error: error.message'), 'raw error message must not reach clients');
});

test('GET /api/connections/[id] withholds secret fields and returns sanitized indicators', () => {
  const connDetail = readSrc('src/app/api/connections/[id]/route.js');
  assert.match(connDetail, /hasPassword:\s*!!connection\.password/);
  assert.match(connDetail, /hasPrivateKey:\s*!!connection\.privateKey/);
  assert.match(connDetail, /hasPassphrase:\s*!!connection\.passphrase/);
  assert.ok(!connDetail.includes('data: connection'), 'raw connection object must not be returned directly in GET');
});

test('POST /api/connections/[id]/reveal route enforces session, rate limits, and audits disclosure', () => {
  const reveal = readSrc('src/app/api/connections/[id]/reveal/route.js');
  assert.match(reveal, /const session = await getServerSession\(authOptions\)/);
  assert.match(reveal, /if \(!session\?\.user\?\.id\)/);
  assert.match(reveal, /rateLimit\(`reveal:u:\${session\.user\.id}`/);
  assert.match(reveal, /action:\s*['"]connection\.reveal['"]/);
});

test('/api/health withholds internal mongo readyState, relay count, and memory telemetry', () => {
  const health = readSrc('src/app/api/health/route.js');
  assert.ok(!health.includes('readyState:'), 'health route must not disclose mongo readyState');
  assert.ok(!health.includes('count: relayCount'), 'health route must not disclose relay count');
  assert.ok(!health.includes('memory: {'), 'health route must not disclose memory safe status');
});

test('test-uri requires explicit allowRelay before relay routing, preventing loopback SSRF bypass', () => {
  const testUriCode = readSrc('src/app/api/connections/test-uri/route.js');
  assert.match(testUriCode, /allowRelay/);
  assert.match(testUriCode, /isLocalhost\s*&&\s*allowRelay/);

  const sshTunnelCode = readSrc('src/lib/sshTunnel.js');
  assert.ok(!sshTunnelCode.includes("'0.0.0.0'"), '0.0.0.0 must not be listed in LOCAL_HOSTNAMES');
});


