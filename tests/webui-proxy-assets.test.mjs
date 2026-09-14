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
  // React Router's preload helper prepends '/' to every map dep
  // (`Xt = e => "/" + e`). A rewritten map entry that KEEPS its leading slash
  // becomes '//api/agents/...' — a protocol-relative URL with host "api" —
  // and every lazy ChatPage/xterm chunk dies with net::ERR_NAME_NOT_RESOLVED.
  // The relative-branch rewrite must therefore emit the keyed prefix WITHOUT
  // the leading slash.
  assert.ok(proxy.includes("const relPrefix = prefix.replace(/^\\//, '')"));
  assert.ok(proxy.includes('`${quote}${relPrefix}/assets/`'));
  // Root-absolute refs consumed directly keep the leading-slash keyed form.
  assert.ok(proxy.includes('`${quote}${prefix}/assets/`'));
  // NO cache-epoch query anywhere: Hermes' Rolldown runtime builds lazy-chunk
  // URLs from numeric ids without `?v=`, so any suffix on the preload links
  // would split the module into two instances and crash the app.
  assert.ok(!proxy.includes('ASSET_EPOCH'));
  assert.ok(!proxy.includes('assetCacheBustSuffix'));
  // Defensive heal inside the injected helper for any producer of the
  // double-slash form (e.g. a stale cached bundle served by the remote).
  assert.ok(proxy.includes("u.indexOf('//' + TUNNEL_PREFIX) === 0) u = u.slice(1)"));
  // The heal regex MUST be the RegExp-constructor string form. A regex literal
  // inside the server template literal has `\/` collapsed to `/`, so
  // `/^https?:\/\/api/` arrives as `/^https?://api/` — the unescaped `//` ends
  // the literal and the ENTIRE injected helper fails to parse
  // ("Unexpected token '?'"), silently disabling every client-side patch.
  assert.ok(proxy.includes("new RegExp('^https?://api(?=/agents/webui-proxy(/|$))', 'i')"));
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

test('the injected helper contains no backticks', () => {
  // The helper is itself inside a server-side template literal. A backtick in
  // an injected comment turns `/chat-run` into a server interpolation and
  // produces the exact Proxy Error: "chat is not defined".
  const start = proxy.indexOf('const scriptTag = `');
  const end = proxy.indexOf('\n`;\n', start);
  assert.ok(start >= 0 && end > start);
  assert.equal(proxy.slice(start + 'const scriptTag = `'.length, end).includes('`'), false);
});

test('Hermes API requests are rewritten into the HTTP tunnel', () => {
  // Hermes uses root-relative API URLs such as /api/hermes/v1/... and its
  // chat Socket.IO connection uses /chat-run. In an external tab those hit the
  // Hermes server directly; in the embed they hit the monitor origin unless
  // rewritten, producing the screenshot's failed ChatPage and helper chunks.
  assert.match(proxy, /function proxyHttpUrl/);
  assert.match(proxy, /Route root-relative requests/);
  assert.match(proxy, /window\.fetch = function/);
  assert.match(proxy, /XMLHttpRequest\.prototype\.open = function/);
  assert.match(proxy, /origEventSource/);
  // The dedicated WS proxy is already used by the WebSocket wrapper.
  assert.match(proxy, /function proxyWsUrl/);
  assert.match(proxy, /window\.WebSocket = function/);
});

test('Hermes hash-router base marker is not overwritten with a path prefix', () => {
  // Hermes uses createWebHashHistory() with routes like /hermes/chat. Its
  // routes live after the hash and must not receive the asset tunnel prefix.
  // Overwriting a dashboard marker with /api/agents/webui-proxy/m2/... leaves
  // the shell visible but makes the chat view fail to resolve.
  assert.match(proxy, /uses a hash router/);
  assert.match(proxy, /window\\.__HERMES_BASE_PATH__/);
  assert.match(proxy, /explicitly empty marker/);
  assert.doesNotMatch(proxy, /\[\^'"\\\\\]\*\\1\/g/);
});

test('real Hermes link clicks are kept inside the tunnel too', () => {
  // This is the regression that explains the user's report. pushState patching
  // only catches the router API; a real <a href="/chat/<id>"> click performs a
  // browser navigation and never calls pushState. In an embed that hits the
  // monitor's own root; in an external tab the app is rooted at the remote
  // service, so it appears to work there.
  const click = proxy.slice(proxy.indexOf("document.addEventListener('click'"), proxy.indexOf('var origWindowOpen'));
  assert.match(click, /var contained = containInTunnel\(href\)/);
  assert.match(click, /e\.preventDefault\(\); window\.location\.href = contained/);
  // Do not hijack modifier clicks or links deliberately targeted elsewhere.
  assert.match(click, /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
  assert.match(click, /el\.target && el\.target !== '_self'\) return/);
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

test('WebSocket proxy upgrade in server.js handles path-keyed URLs and auth credentials', () => {
  const server = readFileSync('server.js', 'utf8');
  const wsHandler = section(server, 'async function handleWebUIProxyUpgrade', '// Intercept HTTP upgrades');
  // Path-keyed URL support. The marker is VERSIONED — it is ASSET_KEY in
  // webui-proxy/route.js and went `m` → `m2` on 2026-09-13. This assertion used
  // to pin `m\/`, so it kept passing while the pattern silently stopped matching
  // the URLs the app generates: every path-keyed WS upgrade parsed to no
  // coordinates and was destroyed. Assert the version suffix is tolerated, and
  // see tests/webui-ws-path-key.test.mjs, which pins the pattern against the
  // live ASSET_KEY value instead of against a literal.
  assert.match(wsHandler, /pathname\.match\(\/\^\\\/api\\\/agents\\\/webui-\(\?:ws-\)\?proxy\\\/m\\d\*\\\//);
  // Robust NextAuth secret and secureCookie fallback
  assert.match(wsHandler, /process\.env\.NEXTAUTH_SECRET \|\| process\.env\.AUTH_SECRET \|\| process\.env\.ENCRYPTION_KEY/);
  assert.match(wsHandler, /secureCookie: true/);
  assert.match(wsHandler, /secureCookie: false/);
  // SSH config resolution — native inline (avoids ESM @/lib crash in CJS server.js).
  // Credentials are read directly from mongoose.connection.db.collection('connections').
  assert.match(wsHandler, /mongoose\.connection\.db\.collection\('connections'\)/);
  // Forwards non-monitor cookies and authorization
  assert.match(wsHandler, /clientCookies/);
  assert.match(wsHandler, /Cookie: \$\{clientCookies\}/);
  assert.doesNotMatch(wsHandler, /skip\.has\('authorization'\)/);
  // TCP socket timeout cleared and keepalive enabled
  assert.match(wsHandler, /sock\.setTimeout\(0\)/);
  assert.match(wsHandler, /sock\.setKeepAlive\(true/);
});

test('route.js forwards relay/ssh options to proxyWsUrl and inherits WebSocket prototype', () => {
  assert.match(proxy, /EXTRA_WS_PARAMS/);
  assert.match(proxy, /Object\.setPrototypeOf\(window\.WebSocket, NativeWS\)/);
});


test('Cloudflare /cdn-cgi/* must NEVER be tunneled to the agent (RUM beacon 405 + module MIME fix)', () => {
  // The client-side bridge guards every rewrite path that touches /cdn-cgi/*.
  // Cloudflare injects its RUM analytics (a script + a POST beacon to
  // /cdn-cgi/rum) into HTML responses at the edge. Tunneling those paths made
  // the agent server answer 405/HTML, which the browser then reported as
  // "Failed to load module script: … MIME text/html" (green screen) plus a
  // "POST …/cdn-cgi/rum 405" console error — only on production, which is
  // behind Cloudflare. They must resolve to the CDN directly, never the tunnel.
  assert.ok(proxy.includes("function isCloudflareInfra(u)"));
  assert.match(proxy, /if \(isCloudflareInfra\(u\)\) return u;/);            // rewriteUrl()
  assert.match(proxy, /if \(isCloudflareInfra\(resolved\.pathname\)\) return u;/); // containInTunnel()
  assert.match(proxy, /if \(isCloudflareInfra\('\/' \+ path\)\) return m;/);        // fixMarkup()
  // Server-side attribute & url() rewrites must leave /cdn-cgi alone too.
  assert.match(proxy, /path === 'cdn-cgi' \|\| path\.startsWith\('cdn-cgi\/'\)/);
  // handleProxy must short-circuit a stale /cdn-cgi/ request at the origin
  // instead of forwarding it into the SSH tunnel (302 back to the CDN edge).
  assert.match(proxy, /\/\^\\\/cdn-cgi\\\/\/\.test\(remotePath\)/);
  assert.match(proxy, /NextResponse\.redirect\(new URL\(remotePath, request\.url\), 302\)/);
});

test('immutable cache only when the tunnel REALLY returned a JS/CSS binary', () => {
  // Stamping Cache-Control: immutable from the requested PATH alone is wrong:
  // if a relay restart made the first request for a hashed chunk come back as
  // an HTML error page, a shared cache (Cloudflare in front of production)
  // would store that HTML under the .js URL for a year — "module script served
  // MIME text/html" on every later load. Cache-control must describe the
  // actual status + content-type of the response.
  const cacheSection = section(proxy, 'Cache-control must describe the response', 'let body = resp.body;');
  assert.match(cacheSection, /statusOk = resp\.status === 200 \|\| resp\.status === 206/);
  assert.match(cacheSection, /isJsCss = \/\(\?:javascript\|wasm\|css\)\/\.test\(contentType\)/);
  assert.match(cacheSection, /statusOk && \/\\\/assets\\\/\[\^\?\]\*-\[A-Za-z0-9_-\]\{8,\}\D\.\(\?:js\|mjs\|css\)\$\/i\.test\(assetPath\) && isJsCss/);
  assert.match(cacheSection, /isBinary = /);
});

test('asset URLs carry NO cache-epoch suffix so modulepreload and dynamic import stay the same module', () => {
  // REGRESSION (2026-09-13): adding `?v=<epoch>` to modulepreload links made
  // the browser treat the preloaded copy and the lazily-imported copy (which
  // Hermes' Rolldown runtime builds WITHOUT any query) as two different
  // modules. `SystemActionsProvider` was registered on one instance while the
  // consumer read the other — "useSystemActions must be used within a
  // SystemActionsProvider" and the whole dashboard crashed back to the green
  // splash ~6-12s after mount. Any cache-poisoning mitigation must keep the
  // preload URL and the import URL byte-identical.
  assert.ok(!proxy.includes('ASSET_EPOCH'));
  assert.ok(!proxy.includes('assetCacheBustSuffix'));
  assert.ok(!proxy.includes('?v='));
});
