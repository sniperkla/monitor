// Regression tests for F-05: client-IP spoofing.
//
// The old getClientIp() took the LEFTMOST x-forwarded-for entry, which the
// client controls outright. That let an attacker choose their own rate-limit
// bucket and forge their own IP in the audit trail.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Build a minimal Request-like object carrying the given headers. */
function req(headers = {}) {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  return { headers: { get: (name) => (map.has(name.toLowerCase()) ? map.get(name.toLowerCase()) : null) } };
}

/**
 * Load the module with a given TRUSTED_PROXY_HOPS. The value is read at import
 * time, so the query string busts the ESM cache to get a fresh instance.
 */
async function load(hops) {
  const prev = process.env.TRUSTED_PROXY_HOPS;
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = String(hops);
  const mod = await import(`../src/lib/clientIp.js?hops=${hops ?? 'default'}`);
  if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = prev;
  return mod;
}

test('spoofed leftmost XFF is not accepted (the F-05 bypass)', async () => {
  // The exact attack: client sets their own XFF header. Cloudflare appends the
  // real IP, nginx appends its peer. Leftmost-wins returns the attacker value.
  const { getClientIp } = await load(2);
  const spoofed = '9.9.9.9';
  const real = '203.0.113.50';
  const ip = getClientIp(req({
    'x-forwarded-for': `${spoofed}, ${real}, 198.51.100.7`,
  }));
  assert.notEqual(ip, spoofed, 'attacker-supplied leftmost entry must never win');
  assert.equal(ip, real);
});

test('CF-Connecting-IP wins and defeats a spoofed XFF chain', async () => {
  const { getClientIp, getClientIpInfo } = await load(2);
  const info = getClientIpInfo(req({
    'cf-connecting-ip': '203.0.113.50',
    'x-forwarded-for': '9.9.9.9, 8.8.8.8, 198.51.100.7',
    'x-real-ip': '198.51.100.7',
  }));
  assert.equal(info.ip, '203.0.113.50');
  assert.equal(info.source, 'cf-connecting-ip');
});

test('True-Client-IP is used when CF-Connecting-IP is absent', async () => {
  const { getClientIpInfo } = await load(2);
  const info = getClientIpInfo(req({
    'true-client-ip': '203.0.113.50',
    'x-forwarded-for': '9.9.9.9, 198.51.100.7',
  }));
  assert.equal(info.ip, '203.0.113.50');
  assert.equal(info.source, 'true-client-ip');
});

test('trusted-hop index is len-N, not len-N-1', async () => {
  // The previous implementation was off by one and landed on an attacker-
  // controlled entry even with trusted hops enabled.
  const { getClientIp } = await load(2);
  const chain = '9.9.9.9, 8.8.8.8, 203.0.113.50, 198.51.100.7';
  // len=4, N=2 -> idx=2 -> 203.0.113.50 (real). Off-by-one would give 8.8.8.8.
  assert.equal(getClientIp(req({ 'x-forwarded-for': chain })), '203.0.113.50');

  const one = await load(1);
  // Single nginx: it appends the real client, so the real IP is last.
  assert.equal(
    one.getClientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.50' })),
    '203.0.113.50'
  );
});

test('client that sends no XFF still resolves', async () => {
  // Single nginx that appends the real client: the chain has one entry and
  // idx = len - N = 0, so the trusted slot itself holds the real client.
  const one = await load(1);
  const viaTrusted = one.getClientIpInfo(req({ 'x-forwarded-for': '203.0.113.50' }));
  assert.equal(viaTrusted.ip, '203.0.113.50');
  assert.equal(viaTrusted.source, 'x-forwarded-for[trusted]');

  // Shorter chain than the declared hop count: the only entry was written by
  // our own edge, so it is the real client. Covers the idx < 0 branch.
  const two = await load(2);
  const viaEdge = two.getClientIpInfo(req({ 'x-forwarded-for': '203.0.113.50' }));
  assert.equal(viaEdge.ip, '203.0.113.50');
  assert.equal(viaEdge.source, 'x-forwarded-for[edge]');
});

test('with zero trusted hops, XFF is not read at all', async () => {
  const { getClientIp } = await load(0);
  // No proxy declared: XFF is entirely client-supplied, so it must be ignored.
  assert.equal(getClientIp(req({ 'x-forwarded-for': '9.9.9.9' })), 'unknown');
  // X-Real-IP is still trusted because nginx overwrites it.
  assert.equal(
    getClientIp(req({ 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '203.0.113.50' })),
    '203.0.113.50'
  );
});

test('rotating spoofed XFF cannot mint unlimited buckets', async () => {
  // Mirrors the live differential: rotating the spoofed header used to mean
  // every request landed in a fresh bucket. Now the bucket is stable because
  // the identity comes from a position the client cannot control.
  const { getClientIp } = await load(2);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    seen.add(getClientIp(req({ 'x-forwarded-for': `10.1.${i}.${i + 1}, 203.0.113.50, 198.51.100.7` })));
  }
  assert.deepEqual([...seen], ['203.0.113.50'],
    'every spoof attempt must collapse onto the real client bucket');
});

test('malformed and hostile header values are rejected', async () => {
  const { getClientIp } = await load(2);
  for (const bad of [
    '999.999.999.999',
    'not-an-ip',
    '1.2.3.4, 5.6.7.8',          // a whole chain smuggled into a single-IP header
    'x'.repeat(300),
    '',
    ' ',
  ]) {
    const ip = getClientIp(req({ 'cf-connecting-ip': bad, 'x-real-ip': '203.0.113.50' }));
    assert.equal(ip, '203.0.113.50', `hostile CF value ${JSON.stringify(bad.slice(0, 24))} must fall through`);
  }
  // Nothing at all -> honest 'unknown', never a fabricated value.
  assert.equal(getClientIp(req({})), 'unknown');
});

test('zone index is stripped so it cannot split a bucket', async () => {
  // fe80::1%eth0 and fe80::1 are the same host; treating them as distinct
  // would double a client's effective rate limit.
  const { getClientIp } = await load(2);
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '1.2.3.4%eth0' })), '1.2.3.4');
  assert.equal(getClientIp(req({ 'cf-connecting-ip': 'fe80::1%eth0' })), 'fe80::1');
});

test('getClientIp tolerates a missing/null request', async () => {
  const { getClientIp } = await load(2);
  assert.equal(getClientIp(null), 'unknown');
  assert.equal(getClientIp(undefined), 'unknown');
  assert.equal(getClientIp({}), 'unknown');
});

test('IPv6 addresses are accepted and normalised', async () => {
  const { getClientIp } = await load(2);
  assert.equal(
    getClientIp(req({ 'cf-connecting-ip': '2001:DB8::1' })),
    '2001:db8::1'
  );
  assert.equal(
    getClientIp(req({ 'cf-connecting-ip': '[2001:db8::1]' })),
    '2001:db8::1'
  );
});
