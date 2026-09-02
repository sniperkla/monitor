// ── Regression test: resource-consuming and email-sending routes are throttled

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

const routes = {
  rclone: readSrc('src/app/api/rclone/exec/route.js'),
  backup: readSrc('src/app/api/server-backup/create/route.js'),
  scan: readSrc('src/app/api/virus-scan/route.js'),
  recovery: readSrc('src/app/api/user/vault/recovery/route.js'),
};

test('rclone execution has per-IP and connection rate limiting', () => {
  assert.ok(routes.rclone.includes("from '@/lib/serverGuard'"));
  assert.ok(routes.rclone.includes('RCLONE_RATE_LIMIT'));
  assert.match(routes.rclone, /rclone-exec:\$\{clientIp\}:\$\{connectionId\}/);
  assert.match(routes.rclone, /status:\s*429/);
  assert.ok(routes.rclone.includes("'Retry-After'"));
});

test('backup creation has per-user and connection rate limiting', () => {
  assert.ok(routes.backup.includes("from '@/lib/serverGuard'"));
  assert.ok(routes.backup.includes('BACKUP_RATE_LIMIT'));
  assert.match(routes.backup, /server-backup-create:\$\{userId\}:\$\{connectionId\}/);
  assert.match(routes.backup, /status:\s*429/);
  assert.ok(routes.backup.includes("'Retry-After'"));
});

test('virus scans have per-user and connection rate limiting', () => {
  assert.ok(routes.scan.includes("from '@/lib/serverGuard'"));
  assert.ok(routes.scan.includes('SCAN_RATE_LIMIT'));
  assert.match(routes.scan, /virus-scan:\$\{userId\}:\$\{connectionId\}/);
  assert.match(routes.scan, /status:\s*429/);
  assert.ok(routes.scan.includes("'Retry-After'"));
  assert.ok(routes.scan.includes('MAX_CONCURRENT_PER_USER'), 'concurrency guard remains');
});

test('recovery email requests have an IP plus user rate limit', () => {
  assert.ok(routes.recovery.includes("from '@/lib/serverGuard'"));
  assert.ok(routes.recovery.includes('RECOVERY_RATE_LIMIT'));
  assert.match(routes.recovery, /vault-recovery:\$\{userKey\}:\$\{clientIp\}/);
  assert.match(routes.recovery, /status:\s*429/);
  assert.ok(routes.recovery.includes("'Retry-After'"));
  assert.ok(routes.recovery.includes('lastRequestAt'), 'existing database cooldown remains');
});

test('route-local limits run after route authentication where present', () => {
  // rclone/exec currently relies on proxy authentication (F-08 tracks adding
  // an in-route assertion), so its limit is intentionally checked after input
  // validation but before the remote command is constructed.
  for (const name of ['backup', 'scan', 'recovery']) {
    const source = routes[name];
    const authAt = source.indexOf('getServerSession');
    const limiterAt = source.indexOf('checkRateLimit');
    assert.ok(authAt >= 0 && limiterAt > authAt, `${name}: limiter must run after route auth`);
  }
  assert.ok(routes.rclone.indexOf('checkRateLimit(`rclone-exec') > routes.rclone.indexOf("connectionId, source, and target are required"),
    'rclone: limit runs after input validation and before remote execution');
});
