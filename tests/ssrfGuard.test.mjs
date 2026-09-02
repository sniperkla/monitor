import { test } from 'node:test';
import assert from 'node:assert';
import { extractHost, assertSafeUri } from '../src/lib/ssrfGuard.js';

test('extractHost: parses mongodb URI with single host', () => {
  const hosts = extractHost('mongodb://user:pass@cluster.example.com:27017/db');
  assert.deepStrictEqual(hosts, ['cluster.example.com']);
});

test('extractHost: parses mongodb+srv URI', () => {
  const hosts = extractHost('mongodb+srv://user:pass@cluster.example.com/db');
  assert.deepStrictEqual(hosts, ['cluster.example.com']);
});

test('extractHost: parses mysql URI', () => {
  const hosts = extractHost('mysql://root:pw@db.host.com:3306/mydb');
  assert.deepStrictEqual(hosts, ['db.host.com']);
});

test('extractHost: parses postgres URI', () => {
  const hosts = extractHost('postgres://user:pass@pg.example.com:5432/db');
  assert.deepStrictEqual(hosts, ['pg.example.com']);
});

test('extractHost: parses comma-separated hosts (mongo replica set)', () => {
  const hosts = extractHost('mongodb://user:pass@host1.com:27017,host2.com:27017,host3.com:27017/db');
  assert.deepStrictEqual(hosts, ['host1.com', 'host2.com', 'host3.com']);
});

test('extractHost: strips credentials with special chars', () => {
  // When the password contains @, the regex strips up to the LAST @ before
  // the host. This test verifies the host is correctly extracted.
  const hosts = extractHost('mongodb://user@host.com:pass@db.example.com:27017/db');
  assert.ok(hosts.includes('db.example.com'));
});

test('extractHost: returns empty for empty or null input', () => {
  assert.deepStrictEqual(extractHost(''), []);
  assert.deepStrictEqual(extractHost(null), []);
  assert.deepStrictEqual(extractHost(undefined), []);
});

test('extractHost: returns host for string without protocol', () => {
  // A string without a protocol is treated as a hostname — it will fail
  // protocol validation upstream, but extractHost itself is protocol-agnostic.
  const hosts = extractHost('not-a-uri');
  assert.deepStrictEqual(hosts, ['not-a-uri']);
});

test('assertSafeUri: blocks 127.0.0.1', async () => {
  const result = await assertSafeUri('mongodb://user:pass@127.0.0.1:27017/db');
  assert.strictEqual(result.safe, false);
  assert.match(result.reason, /blocked|private|internal/i);
});

test('assertSafeUri: blocks localhost', async () => {
  const result = await assertSafeUri('mongodb://user:pass@localhost:27017/db');
  assert.strictEqual(result.safe, false);
  assert.match(result.reason, /localhost|blocked/i);
});

test('assertSafeUri: blocks 10.x address', async () => {
  const result = await assertSafeUri('mongodb://user:pass@10.0.0.1:27017/db');
  assert.strictEqual(result.safe, false);
  assert.match(result.reason, /10\.0\.0\.1|private/i);
});

test('assertSafeUri: blocks 192.168.x address', async () => {
  const result = await assertSafeUri('mysql://root:pw@192.168.1.100:3306/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 172.16.x address', async () => {
  const result = await assertSafeUri('postgres://user:pass@172.16.0.1:5432/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 169.254.x (link-local / cloud metadata)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@169.254.169.254:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 100.64.x (CGNAT)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@100.64.0.1:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks ::1 (IPv6 loopback)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@[::1]:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks fe80:: (IPv6 link-local)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@[fe80::1]:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks fc00:: (IPv6 unique-local)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@[fc00::1]:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: allows public IP literal (8.8.8.8)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@8.8.8.8:27017/db');
  assert.strictEqual(result.safe, true);
});

test('assertSafeUri: allows public hostname (dns test)', async () => {
  // dns.google resolves to public IPs
  const result = await assertSafeUri('mongodb://user:pass@dns.google:27017/db');
  assert.strictEqual(result.safe, true);
});

test('assertSafeUri: rejects URI with no host', async () => {
  const result = await assertSafeUri('mongodb://user:pass@/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 0.0.0.0', async () => {
  const result = await assertSafeUri('mongodb://user:pass@0.0.0.0:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 224.x (multicast)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@224.0.0.1:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 240.x (reserved)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@240.0.0.1:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 198.51.100.x (documentation range)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@198.51.100.1:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 203.0.113.x (documentation range)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@203.0.113.1:27017/db');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks 198.18.x (benchmarking)', async () => {
  const result = await assertSafeUri('mongodb://user:pass@198.18.0.1:27017/db');
  assert.strictEqual(result.safe, false);
});
