import { test } from 'node:test';
import assert from 'node:assert';
import dns from 'node:dns/promises';
import { readFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// Legacy / non-standard IP notations
//
// glibc's inet_aton accepts decimal, octal and hex forms alongside dotted-quad,
// and Node's net.connect inherits that parsing. Verified empirically on this
// platform: net.connect(port, '2130706433'), '0x7f000001' and '017700000001'
// all open a real socket to 127.0.0.1.
//
// dns.resolve4/resolve6 return ENODATA/ENOTFOUND for these notations, so they
// are caught ONLY by the dns.lookup fallback inside resolveHost(). These tests
// are the regression guard for that fallback: with it removed, all of the
// "encoded" cases below flip from blocked to allowed.
// ---------------------------------------------------------------------------

async function resolvesLocally(host) {
  try {
    const r = await dns.lookup(host, { all: true });
    return Array.isArray(r) && r.length > 0;
  } catch {
    return false;
  }
}

/** Skip instead of failing when the sandbox has no working resolver. */
async function skipUnlessResolvable(t, host) {
  if (!(await resolvesLocally(host))) {
    t.skip(`no local resolver for ${host} — cannot evaluate`);
    return true;
  }
  return false;
}

const ENCODED_INTERNAL = [
  ['mongodb://2130706433:27017', 'decimal-encoded loopback (2130706433 = 127.0.0.1)'],
  ['mongodb://0x7f000001:27017', 'hex-encoded loopback (0x7f000001)'],
  ['mongodb://017700000001:27017', 'octal-encoded loopback (017700000001)'],
  ['mongodb://0x7f.0.0.1:27017', 'mixed hex loopback (0x7f.0.0.1)'],
  ['mongodb://167772161:27017', 'decimal-encoded RFC1918 (167772161 = 10.0.0.1)'],
  ['mongodb://2852039166:80', 'decimal-encoded AWS metadata (2852039166 = 169.254.169.254)'],
];

for (const [uri, label] of ENCODED_INTERNAL) {
  const host = extractHost(uri)[0];
  test(`assertSafeUri: blocks ${label}`, async (t) => {
    if (await skipUnlessResolvable(t, host)) return;
    const result = await assertSafeUri(uri);
    assert.strictEqual(result.safe, false, `${uri} must be blocked`);
  });
}

test('assertSafeUri: blocks IPv4-mapped IPv6 loopback ([::ffff:127.0.0.1])', async () => {
  const result = await assertSafeUri('mongodb://[::ffff:127.0.0.1]:27017');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks IPv4-mapped IPv6 metadata ([::ffff:169.254.169.254])', async () => {
  const result = await assertSafeUri('mongodb://[::ffff:169.254.169.254]:80');
  assert.strictEqual(result.safe, false);
});

test('assertSafeUri: blocks case-varied localhost (LOCALHOST)', async (t) => {
  if (await skipUnlessResolvable(t, 'LOCALHOST')) return;
  const result = await assertSafeUri('mongodb://LOCALHOST:27017');
  assert.strictEqual(result.safe, false, 'case variation must not bypass the localhost rule');
});

test("assertSafeUri: does not over-block 0177.0.0.1 (genuinely public 177.0.0.1)", async (t) => {
  // Counter-case: the leading zero here is NOT an octal prefix to the socket
  // layer in dotted form — this host really is 177.0.0.1, which is public.
  // Guards against a future "fix" that rejects anything starting with 0.
  if (await skipUnlessResolvable(t, '0177.0.0.1')) return;
  const local = (await dns.lookup('0177.0.0.1', { all: true })).map((e) => e.address);
  if (local.includes('127.0.0.1')) {
    t.skip('platform parses 0177.0.0.1 as loopback — block is correct here');
    return;
  }
  const result = await assertSafeUri('mongodb://0177.0.0.1:27017');
  assert.strictEqual(result.safe, true, 'public 177.0.0.1 must stay reachable');
});

test('ssrfGuard keeps the dns.lookup fallback in resolveHost', () => {
  // Structural guard. dns.resolve4/resolve6 alone return ENODATA for the
  // encoded notations above; without the dns.lookup fallback the runtime
  // tests above would pass vacuously (nothing resolves -> allowed). This
  // asserts the fallback still exists even on a host with no resolver.
  const src = readFileSync(new URL('../src/lib/ssrfGuard.js', import.meta.url), 'utf8');
  assert.ok(
    /dns\.lookup\s*\(/.test(src),
    'ssrfGuard.js must retain a dns.lookup() fallback — encoded IP notations depend on it'
  );
});
