import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * WebUI proxy sub-resource rewriting.
 *
 * The proxy serves an agent's SPA from a sub-path of the monitor origin, so
 * every URL the hosted app emits has to be pulled back through the tunnel.
 * The trap this file exists for: a bundler resolves a module's relative
 * imports against `import.meta.url`, and RFC 3986 relative resolution DROPS
 * the base URL's QUERY STRING. Carrying `connectionId`/`port` as query params
 * on the entry module therefore evaporated the instant the app lazily imported
 * its first chunk — the request landed on the proxy with no coordinates, got
 * "400 connectionId required", the module graph never completed, and the app
 * sat on its static boot splash forever ("Loading nanobot…", blank green
 * Hermes screen). Coordinates belong in the PATH.
 */

const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const catchAll = readFileSync('src/app/api/agents/webui-proxy/[...path]/route.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

test('asset URLs are keyed by path, never by query string', () => {
  assert.match(proxy, /function assetPathPrefix\(connectionId, port\)/);
  assert.match(proxy, /\/api\/agents\/webui-proxy\/\$\{ASSET_KEY\}\//);

  const rewrites = section(proxy, 'Rewrite absolute src, href, action attributes', 'return res;');
  // The rewritten attribute must carry the prefix and must NOT tack the
  // coordinates back on as a query — a query here is exactly what gets lost.
  assert.match(rewrites, /pathProxyBase/);
  assert.doesNotMatch(rewrites, /\?connectionId=/);
});

test('CSS url(/...) is rewritten to the same path-keyed prefix', () => {
  // Both the inline <style> pass and the standalone .css pass must agree, or
  // fonts/backgrounds silently 404 while the JS loads fine.
  const PREFIX = '(?:\\$\\{pathProxyBase\\}|\\$\\{assetPathPrefix\\(connectionId, port\\)\\})';
  const cssPasses = proxy.match(new RegExp('url\\(\\$\\{q\\}' + PREFIX + '\\$\\{encodeProxyPath', 'g')) || [];
  assert.equal(cssPasses.length, 2, 'both HTML-inline and .css url() rewrites must be path-keyed');
});

test('the catch-all route reads the coordinates back out of the path', () => {
  assert.match(catchAll, /segments\[0\] === ASSET_KEY/);
  assert.match(catchAll, /url\.searchParams\.set\('connectionId', segments\[1\]\)/);
  assert.match(catchAll, /url\.searchParams\.set\('port', segments\[2\]\)/);
  // Only claim the marker form when the query is empty — an old page whose
  // remote path genuinely starts with the marker must not be mis-parsed.
  assert.match(catchAll, /hasQueryCoords/);
  // A non-numeric port means this is not a keyed URL.
  assert.match(catchAll, /\/\^\\d\+\$\/\.test\(segments\[2\]\)/);
});

test('Vite lazy assets stay under the keyed tunnel', () => {
  assert.match(proxy, /rewriteRootAssetRefs/);
  assert.ok(proxy.includes('assets/'));
});

test('the address bar keeps the tunnel coordinates after the query is hidden', () => {
  // The proxy used to hide its own query params with
  //   replaceState(null, '', location.pathname + location.hash)
  // which threw the coordinates away. The hosted SPA then normalises the bar
  // to pathname + hash, so every session link the user could copy, refresh or
  // bookmark was a bare /api/agents/webui-proxy#/chat/<id> — and that answers
  // "400 connectionId required". The coordinates have to move into the PATH,
  // not evaporate.
  assert.doesNotMatch(proxy, /history\.replaceState\(null, '', location\.pathname \+ location\.hash\)/);
  assert.match(proxy, /ASSET_PREFIX \+ '\/\?agent=' \+ encodeURIComponent\(WEBUI_AGENT\) \+ location\.hash/);
});

test('client-side navigation is kept inside the tunnel', () => {
  // Hermes pushState()s to a bare "/sessions" on load. Unpatched, the document
  // walks out of the proxy: a reload asks monitor for a route it does not have
  // and the tunnel coordinates are gone for good.
  assert.match(proxy, /history\.pushState = function/);
  assert.match(proxy, /history\.replaceState = function/);
  assert.match(proxy, /function containInTunnel/);
  // Already-tunnelled URLs must be returned untouched, or /m/<cid>/<port>
  // gets doubled up on every hash-only navigation.
  assert.match(proxy, /resolved\.pathname\.indexOf\(TUNNEL_PREFIX\) === 0\) return u;/);
});

test('a stripped URL falls back to the last tunnel this browser used', () => {
  // Links minted before the path-keyed form exist in the wild (address bars,
  // bookmarks). Recover them instead of 400-ing.
  assert.match(proxy, /const COORD_COOKIE = 'mp_webui_coords'/);
  assert.match(proxy, /function readCoordCookie/);
  assert.match(proxy, /if \(!connectionId\) \{/);
  // The cookie is only a hint: the port must still be validated, and the
  // connection is still resolved through the session-scoped repository.
  assert.match(proxy, /port < 1 \|\| port > 65535\) return null/);
  assert.match(proxy, /response\.cookies\.set/);
});

test('sub-resources injected after load are pulled back into the tunnel', () => {
  // A hosted router that pushState()s to a bare path (Hermes goes to
  // "/sessions") moves the document base off the proxy, so a root-absolute
  // "/assets/x.js" escapes the SSH tunnel and 404s on the monitor origin.
  assert.match(proxy, /function fixSubresource/);
  // Attribute setters, markup strings (innerHTML / insertAdjacentHTML) and a
  // MutationObserver net — the parser never touches the property setters.
  assert.match(proxy, /Element\.prototype\.setAttribute = function/);
  assert.match(proxy, /Element\.prototype\.insertAdjacentHTML = function/);
  assert.match(proxy, /getOwnPropertyDescriptor\(Element\.prototype, 'innerHTML'\)/);
  assert.match(proxy, /new MutationObserver/);
  // Already-proxied URLs must be left alone, or the rewrite loops.
  assert.match(proxy, /u\.indexOf\(TUNNEL_PREFIX\) === 0\) return u;/);
});
