import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The WebUI proxy must not leak the *upstream* hop's identity headers to the
 * agent it tunnels to.
 *
 * The monitor sits behind Cloudflare, so every request that reaches it carries
 * `x-forwarded-*` describing the Cloudflare→monitor hop. The proxy then opens
 * an SSH tunnel and speaks to the agent on the agent's own loopback — the
 * monitor IS the client of that second hop. Forwarding the first hop's headers
 * onto the second is not merely useless, it is a false statement, and OpenClaw
 * acts on it: its Control UI classifies any request carrying `forwarded`,
 * `x-real-ip` or `x-forwarded-*` from a peer it does not trust as an
 * unattributable proxy and answers
 *
 *   403 {"type":"proxy_attribution_required"}
 *
 * for every gateway-authenticated route — the dashboard HTML, its chunks, and
 * its API calls. The Control UI rendered as a blank 212-byte JSON error while
 * ZeroClaw's dashboard (which ignores those headers) loaded fine, which is what
 * made this look like an OpenClaw problem instead of a proxy problem.
 *
 * Measured against a live openclaw gateway on 127.0.0.1:18789, sending one
 * header at a time (raw curl, HTTP route vs WebSocket upgrade):
 *
 *     <none>                  HTTP=200  WS=101
 *     X-Forwarded-Proto       HTTP=403  WS=403
 *     X-Forwarded-Host        HTTP=403  WS=403
 *     X-Forwarded-For         HTTP=403  WS=403
 *     X-Real-IP               HTTP=403  WS=403
 *     Forwarded               HTTP=403  WS=403
 *     CF-Connecting-IP        HTTP=200  WS=101   <-- tolerated
 *
 * Two things that table settles. First, the ORIGINAL filter was inverted: it
 * dropped `x-forwarded-for` and `cf-connecting-ip` — the latter being the one
 * header OpenClaw ignores — while forwarding `x-forwarded-host`, `-port` and
 * `-proto`, which are exactly what it rejects. The leak was the whole
 * `x-forwarded-*` family minus the one member already stripped. Second, the WS
 * upgrade gate is the same gate, so fixing only the HTTP route would have left
 * the dashboard rendering and its live socket refused.
 *
 * The filter is written twice — once in the HTTP route and once in the WS
 * upgrade handler in server.js, which cannot import from each other. The
 * failure mode of duplicated policy is drift, so this file pins BOTH copies and
 * asserts they agree.
 */

const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const server = readFileSync('server.js', 'utf8');

// Every header shape OpenClaw's hasForwardedRequestHeaders() reacts to, plus
// the Cloudflare client-IP headers that describe the same upstream hop.
const MUST_DROP = [
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port',
  'x-forwarded-proto', 'x-forwarded-server', 'x-real-ip',
  'forwarded', 'cf-connecting-ip',
];

/**
 * Parse a `new Set([...])` literal into lowercase members.
 *
 * Extract the single-quoted tokens rather than splitting on commas: the first
 * member sits on the same line as `new Set([`, so a comma split hands back
 * `new Set([\n  'host'` for it and the `^[a-z0-9-]+$` filter then drops `host`
 * entirely — a silent hole that made the agreement check below look clean.
 */
function parseHeaderSet(src, startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  assert.ok(from >= 0, `missing header set: ${startMarker}`);
  const to = src.indexOf(endMarker, from);
  assert.ok(to > from, `missing terminator ${endMarker} after ${startMarker}`);
  const members = [...src.slice(from, to).matchAll(/'([a-z0-9-]+)'/gi)].map((m) => m[1].toLowerCase());
  assert.ok(members.length > 0, `no header literals found in ${startMarker}`);
  return members;
}

const httpDrops = parseHeaderSet(proxy, 'const DROP_HEADERS = new Set([', ']);');
const wsDrops = parseHeaderSet(server, 'const skip = new Set([', ']);');

test('the HTTP proxy drops every forwarded-identity header', () => {
  for (const h of MUST_DROP) {
    assert.ok(httpDrops.includes(h), `webui-proxy must drop ${h}`);
  }
});

test('the WS upgrade handler drops the same forwarded-identity headers', () => {
  // The Control UI keeps a live socket open; if the handshake leaks these the
  // HTTP fix alone would leave the dashboard half-working (HTML loads, the
  // socket is refused).
  for (const h of MUST_DROP) {
    assert.ok(wsDrops.includes(h), `server.js WS upgrade must drop ${h}`);
  }
});

test('both copies agree on the forwarded family', () => {
  // Drift guard: the two lists are independent, so compare the subset that
  // matters. A header dropped in one path and not the other is a bug that only
  // shows up on one transport.
  const httpOnly = httpDrops.filter((h) => !wsDrops.includes(h));
  const wsOnly = wsDrops.filter((h) => !httpDrops.includes(h));
  // Two asymmetries are intentional, and both are about mechanics rather than
  // policy — neither is a client-identity header:
  //   • connection / upgrade / origin — protocol-level handshake fields, which
  //     the WS writer rebuilds by hand (`Origin` is rewritten to the tunneled
  //     origin because some WS servers reject a foreign one).
  //   • accept-encoding — the HTTP path forces `identity` so it can rewrite the
  //     HTML/CSS bodies it streams; the WS path has no body to rewrite, so
  //     there is nothing to force.
  const expectedAsymmetry = ['connection', 'upgrade', 'origin', 'accept-encoding'];
  assert.deepEqual(
    httpOnly.filter((h) => !expectedAsymmetry.includes(h)), [],
    'HTTP drops headers the WS path forwards',
  );
  assert.deepEqual(
    wsOnly.filter((h) => !expectedAsymmetry.includes(h)), [],
    'WS drops headers the HTTP path forwards',
  );
  // Guard the guard: the two lists must actually share the forwarded family,
  // or the assertions above would pass on two unrelated sets.
  const shared = httpDrops.filter((h) => wsDrops.includes(h));
  for (const h of MUST_DROP) {
    assert.ok(shared.includes(h), `${h} must be dropped on BOTH transports`);
  }
});

test('both paths also drop the whole x-forwarded-* family by prefix', () => {
  // An exact list can never be complete — any new `x-forwarded-<anything>` a
  // fronting proxy invents would slip through. The prefix rule is what makes
  // this robust, so pin it in both places.
  assert.match(proxy, /DROP_HEADERS\.has\(kl\) \|\| kl\.startsWith\('x-forwarded-'\)/,
    'HTTP proxy must drop x-forwarded-* by prefix, not only by exact name');
  assert.match(server, /skip\.has\(kl\) \|\| kl\.startsWith\('x-forwarded-'\)/,
    'WS upgrade must drop x-forwarded-* by prefix, not only by exact name');
});

test('the monitor never forwards its own session cookie to the agent', () => {
  // Same reasoning as the forwarded headers, different credential: the cookie
  // is the monitor's, not the agent's.
  assert.ok(httpDrops.includes('cookie'), 'HTTP proxy must not forward the monitor cookie');
  assert.ok(wsDrops.includes('cookie'), 'WS upgrade must not forward the monitor cookie');
});
