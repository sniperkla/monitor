// ── Regression test: bucket keys survive every rule shape ───────────────────
//
// This is a runtime test, not a source-text assertion, because the bug it locks
// down was a runtime crash: DEFAULT_RULE has no `pattern`, and bucketKey used to
// read `rule.pattern.source` unconditionally. Any POST/PUT/PATCH/DELETE to an
// API route absent from ROUTE_RULES therefore threw inside the middleware —
// which broke the whole request, not just the rate limiter. Relay token
// issuance, activity posting and settings saves were all dead until it was
// fixed. Grepping the file would never have caught it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleForPath, bucketKey } from '../src/lib/ratelimit.js';

// Routes deliberately absent from ROUTE_RULES — these take the DEFAULT_RULE
// branch, which is the one that used to crash.
const UNMATCHED = ['/api/relay/token', '/api/activity', '/api/user/settings'];

test('ruleForPath falls back to DEFAULT_RULE for routes with no rule', () => {
  for (const p of UNMATCHED) {
    const rule = ruleForPath(p);
    assert.ok(rule, `no rule returned for ${p}`);
    assert.equal(typeof rule.limit, 'number', `no numeric limit for ${p}`);
    assert.equal(typeof rule.window, 'string', `no window for ${p}`);
  }
});

test('bucketKey does not throw for routes that fall back to DEFAULT_RULE', () => {
  for (const p of UNMATCHED) {
    const rule = ruleForPath(p);
    assert.doesNotThrow(
      () => bucketKey({ userId: 'user-1', ip: '203.0.113.7', rule, pathname: p }),
      `bucketKey threw for ${p}`
    );
  }
});

test('bucketKey is stable across repeated calls', () => {
  const rule = ruleForPath('/api/relay/token');
  const a = bucketKey({ userId: 'user-1', ip: '203.0.113.7', rule, pathname: '/api/relay/token' });
  const b = bucketKey({ userId: 'user-1', ip: '203.0.113.7', rule, pathname: '/api/relay/token' });
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test('unmatched routes get their own buckets, not one shared bucket', () => {
  const keys = UNMATCHED.map((p) =>
    bucketKey({ userId: 'user-1', ip: '203.0.113.7', rule: ruleForPath(p), pathname: p })
  );
  assert.equal(new Set(keys).size, UNMATCHED.length, 'all unmatched routes collapsed into one bucket');
});

test('a matched rule still buckets by rule, not by pathname', () => {
  // /api/connections has an explicit rule, so every path under it shares one
  // bucket per user — that is the intended rule-scoped behaviour.
  const a = bucketKey({
    userId: 'user-1',
    ip: '203.0.113.7',
    rule: ruleForPath('/api/connections'),
    pathname: '/api/connections',
  });
  const b = bucketKey({
    userId: 'user-1',
    ip: '203.0.113.7',
    rule: ruleForPath('/api/connections/abc123'),
    pathname: '/api/connections/abc123',
  });
  assert.equal(a, b);
});

test('buckets separate by identity', () => {
  const p = '/api/relay/token';
  const rule = ruleForPath(p);
  const byUser = bucketKey({ userId: 'user-1', ip: '203.0.113.7', rule, pathname: p });
  const byIp = bucketKey({ userId: null, ip: '203.0.113.7', rule, pathname: p });
  const otherUser = bucketKey({ userId: 'user-2', ip: '203.0.113.7', rule, pathname: p });
  assert.equal(byIp, bucketKey({ userId: null, ip: '203.0.113.7', rule, pathname: p }));
  assert.notEqual(byUser, otherUser);
  assert.notEqual(byUser, byIp);
  assert.match(byUser, /^.*:u:user-1$/);
  assert.match(byIp, /^.*:ip:203\.0\.113\.7$/);
});

test('unauthenticated requests with no IP still produce a usable key', () => {
  const p = '/api/relay/token';
  const key = bucketKey({ userId: null, ip: undefined, rule: ruleForPath(p), pathname: p });
  assert.match(key, /:ip:unknown$/);
});
