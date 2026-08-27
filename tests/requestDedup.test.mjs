import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupedFetch, clearDedupCache, _dedupStats } from '../src/utils/requestDedup.js';

// Helper: build a fake fetch that resolves with a Response-like object
function makeFakeFetch(impl) {
  return async (url, options) => {
    const body = await impl(url, options);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('in-flight coalescing: two concurrent identical GETs share one underlying call', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    // Slight delay to ensure both callers race on the same key
    await new Promise((r) => setTimeout(r, 10));
    return { hello: 'world', n: calls };
  });

  const [a, b] = await Promise.all([
    dedupedFetch('http://x.test/api/foo', {}, fakeFetch),
    dedupedFetch('http://x.test/api/foo', {}, fakeFetch),
  ]);

  assert.equal(calls, 1, 'underlying fetch should fire once for two coalesced callers');
  assert.deepEqual(await a.json(), { hello: 'world', n: 1 });
  assert.deepEqual(await b.json(), { hello: 'world', n: 1 });
});

test('short-window cache: sequential identical GETs within WINDOW_MS share one network call', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    return { ok: true, n: calls };
  });

  const a = await dedupedFetch('http://x.test/api/cached', {}, fakeFetch);
  const b = await dedupedFetch('http://x.test/api/cached', {}, fakeFetch);

  assert.equal(calls, 1, 'second GET within window should be served from cache');
  assert.equal((await a.json()).n, 1);
  assert.equal((await b.json()).n, 1);
});

test('non-GET methods are NOT short-circuited by the time window', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    return { ok: true, n: calls };
  });

  await dedupedFetch('http://x.test/api/post', { method: 'POST' }, fakeFetch);
  await dedupedFetch('http://x.test/api/post', { method: 'POST' }, fakeFetch);

  assert.equal(calls, 2, 'POSTs should always hit the network');
});

test('different methods to the same URL do not collide', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    return { ok: true, n: calls };
  });

  await dedupedFetch('http://x.test/api/x', {}, fakeFetch);
  await dedupedFetch('http://x.test/api/x', { method: 'POST' }, fakeFetch);

  assert.equal(calls, 2, 'GET and POST to the same URL should both fire');
});

test('dedup:false bypasses the dedup layer entirely', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    return { n: calls };
  });

  await dedupedFetch('http://x.test/api/bypass', { dedup: false }, fakeFetch);
  await dedupedFetch('http://x.test/api/bypass', { dedup: false }, fakeFetch);

  assert.equal(calls, 2, 'opt-out flag should hit the network every time');
});

test('clearDedupCache wipes both registries', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async () => {
    calls += 1;
    return { n: calls };
  });

  await dedupedFetch('http://x.test/api/clear', {}, fakeFetch);
  assert.equal(_dedupStats().recent, 1);

  clearDedupCache();
  assert.equal(_dedupStats().recent, 0);

  await dedupedFetch('http://x.test/api/clear', {}, fakeFetch);
  assert.equal(calls, 2, 'cache cleared → fresh fetch');
});

test('fetchMetrics, fetchApps, fetchProcesses survive across in-flight collisions', async () => {
  // Sanity test: this validates the in-flight + cache path works with
  // a fresh key each time (no cross-test leakage).
  clearDedupCache();
  let calls = 0;
  const fakeFetch = makeFakeFetch(async (url) => {
    calls += 1;
    return { url, n: calls };
  });

  const [r1, r2, r3] = await Promise.all([
    dedupedFetch('http://x.test/api/k1', {}, fakeFetch),
    dedupedFetch('http://x.test/api/k1', {}, fakeFetch),
    dedupedFetch('http://x.test/api/k2', {}, fakeFetch),
  ]);

  assert.equal(calls, 2, 'two distinct keys should not coalesce');
  assert.equal((await r1.json()).url, 'http://x.test/api/k1');
  assert.equal((await r2.json()).url, 'http://x.test/api/k1');
  assert.equal((await r3.json()).url, 'http://x.test/api/k2');
});

test('in-flight error: caller does not deadlock and falls through to a fresh request', async () => {
  clearDedupCache();
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return new Response('{"recovered":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  // First call throws, second call should still recover.
  await assert.rejects(
    dedupedFetch('http://x.test/api/err', {}, fakeFetch),
    /boom/,
  );

  const recovered = await dedupedFetch('http://x.test/api/err', {}, fakeFetch);
  assert.equal((await recovered.json()).recovered, true);
});
