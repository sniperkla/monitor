import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewriteAbsoluteSelfUrls, collapseLeadingSlashes } from '../src/app/api/agents/_webui-rewrite.js';

/**
 * ZeroClaw's dashboard takes ALL of its live data from a Server-Sent Events
 * stream, and it builds that stream's address by CONCATENATION:
 *
 *     this.path = `${gatewayBase}/api/events`
 *
 * `gatewayBase` is the bundle's own `window.__ZEROCLAW_GATEWAY__ ??
 * "http://127.0.0.1:42617"`, which the proxy rewrites. The original rewrite
 * mapped a bare origin to the QUERY form ending in `path=%2F`, so the
 * concatenation produced `…&path=%2F/api/events` — a remote path of
 * `//api/events`. The gateway has no such route and answered with its SPA
 * index.html under a **200**.
 *
 * That failure is silent by construction. The client only checks `res.ok` and
 * `res.body`:
 *
 *     if (!e.ok) throw Error(`SSE connection failed: ${e.status}`);
 *     if (!e.body) throw Error(`SSE response has no body`);
 *     return this.consumeStream(e.body)
 *
 * Both pass for an HTML error page, so it consumed HTML as an event stream,
 * got zero events, and — because the stream ended cleanly — never errored and
 * never retried. The dashboard rendered its chrome and left the content pane
 * empty forever.
 *
 * These tests call the real function. Regex-matching the source would have
 * happily passed a rewrite that produced the broken URL.
 */

const KEYED = '/api/agents/webui-proxy/m2/6a8ed8c5e27dead077074d2b/42617';
const QUERY_BASE = '/api/agents/webui-proxy?connectionId=6a8ed8c5e27dead077074d2b&port=42617&path=';
const port = 42617;

test('a bare self-origin rewrites to a base you can CONCATENATE onto', () => {
  const out = rewriteAbsoluteSelfUrls('const g=`http://127.0.0.1:42617`;', QUERY_BASE, port, KEYED);
  assert.equal(out, 'const g=`' + KEYED + '`;');

  // The whole point: appending the bundle's own path must land on that path.
  const gatewayBase = out.slice(out.indexOf('`') + 1, out.lastIndexOf('`'));
  const resolved = gatewayBase + '/api/events';
  assert.equal(resolved, `${KEYED}/api/events`);
  // The remote path the proxy will forward is everything after the key.
  const forwarded = resolved.slice(KEYED.length);
  assert.equal(forwarded, '/api/events');
  assert.ok(!forwarded.startsWith('//'), `remote path must not be doubled: ${forwarded}`);
});

test('a bare trailing slash is a base too, not a resource', () => {
  const out = rewriteAbsoluteSelfUrls('x = "http://127.0.0.1:42617/";', QUERY_BASE, port, KEYED);
  assert.equal(out, 'x = "' + KEYED + '";');
});

test('a reference WITH a path still uses the query form, path-encoded', () => {
  const out = rewriteAbsoluteSelfUrls('u = "http://127.0.0.1:42617/api/events";', QUERY_BASE, port, KEYED);
  assert.equal(out, 'u = "' + QUERY_BASE + '%2Fapi%2Fevents";');
});

test('other loopback spellings are rewritten the same way', () => {
  for (const origin of ['http://localhost:42617', 'http://0.0.0.0:42617', 'http://[::1]:42617']) {
    const out = rewriteAbsoluteSelfUrls(`"${origin}"`, QUERY_BASE, port, KEYED);
    assert.equal(out, `"${KEYED}"`, `failed for ${origin}`);
  }
});

test('a DIFFERENT port is left alone — it is not this tunnel', () => {
  const src = '"http://127.0.0.1:9999"';
  assert.equal(rewriteAbsoluteSelfUrls(src, QUERY_BASE, port, KEYED), src);
  // The port group is optional, so without a guard it matched `127.0.0.1` and
  // left `:9999` dangling — a corrupted path segment on the proxy URL.
  assert.equal(rewriteAbsoluteSelfUrls('"http://127.0.0.1:9999/x"', QUERY_BASE, port, KEYED), '"http://127.0.0.1:9999/x"');
});

test('the proxy collapses a doubled leading slash before forwarding', () => {
  // Belt and braces: assets are served `immutable`, so a browser can keep an
  // already-cached bundle that still composes the old, doubled URL. Normalising
  // the remote path rescues those clients without a cache purge.
  assert.equal(collapseLeadingSlashes('//api/events'), '/api/events');
  assert.equal(collapseLeadingSlashes('///api/events'), '/api/events');
  assert.equal(collapseLeadingSlashes('/api/events'), '/api/events');
  assert.equal(collapseLeadingSlashes('/'), '/');
  assert.equal(collapseLeadingSlashes(''), '');
  // A slash in the MIDDLE is a real path segment, not a composition mistake.
  assert.equal(collapseLeadingSlashes('/a//b'), '/a//b');

  // And the route must actually use it.
  const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
  assert.match(proxy, /remotePath = collapseLeadingSlashes\(remotePath\)/);
});

test('event streams are STREAMED, not buffered', () => {
  const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');

  // The buffered path waits for `end`, which an event stream never sends. The
  // proxy must branch on the client's Accept header BEFORE that call.
  const branch = proxy.indexOf("text\\/event-stream");
  const bufferedCall = proxy.indexOf('resp = await httpOverSocket(');
  const streamingCall = proxy.indexOf('httpOverSocketStreaming(');
  assert.ok(branch >= 0, 'expected an Accept: text/event-stream branch');
  assert.ok(streamingCall >= 0, 'expected a streaming fetch helper');
  assert.ok(branch < bufferedCall, 'the stream branch must come before the buffered call');
  assert.ok(streamingCall < bufferedCall, 'the streaming helper must be reached first');

  // The streaming helper must resolve on HEADERS, never wait for the body.
  const helper = proxy.slice(proxy.indexOf('function httpOverSocketStreaming'), proxy.indexOf('function eventStreamResponse'));
  assert.match(helper, /settle\(resolve, \{ status: res\.statusCode, headers: res\.headers, upstream: res \}\)/);
  assert.doesNotMatch(helper, /res\.on\('end'/, 'the streaming helper must not wait for the body to end');

  // And the response must be a live ReadableStream, with the two headers that
  // keep intermediaries from re-buffering it.
  const es = proxy.slice(proxy.indexOf('function eventStreamResponse'));
  assert.match(es, /new ReadableStream\(/);
  assert.match(es, /controller\.enqueue/);
  assert.match(es, /x-accel-buffering/);
  assert.match(es, /cancel\(\)/, 'must tear the tunnel down when the client goes away');
  // content-length is unknown for a stream and must not be relayed.
  assert.match(es, /'content-length'/);
});
