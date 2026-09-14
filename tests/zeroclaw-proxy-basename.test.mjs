import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ZeroClaw's dashboard through the WebUI proxy.
 *
 * The trap this file exists for: ZeroClaw's dashboard derives BOTH its router
 * basename and its API base from one global —
 *
 *   api-*.js:  s = (window.__ZEROCLAW_BASE__ ?? '').replace(/\/+$/, '')
 *              export { s as Ft }
 *   index.js:  import { Ft as l } … <BrowserRouter basename={l || '/'}>
 *
 * Left unset it falls back to '/', and a document served at the proxy's deep
 * path matches no route. React Router then renders nothing, so the dashboard
 * chrome painted while the content pane stayed empty — every API call 200, no
 * console error, and a screenshot that looks like a layout bug.
 *
 * Measured with one variable at a time: raw tunnel renders 890 chars into
 * <main>, proxied was 0, and forcing the pathname to '/' rendered 889 again.
 *
 * Setting the global fixed the router — and immediately exposed two defects
 * that the empty pane had been hiding (nothing inside it ever ran):
 *   1. chunk URLs came out as '/_app' + ASSET_PREFIX + '/assets/…', so the
 *      proxy's prepend produced a SECOND copy of the coordinates (28 chunks
 *      404'd);
 *   2. the app's own ?path= was eaten by the proxy's `path` transport param,
 *      so /api/config/map-keys?path=agents reached the gateway with no `path`
 *      and got "API 400: Failed to deserialize query string: missing field".
 */

const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const catchAll = readFileSync('src/app/api/agents/webui-proxy/[...path]/route.js', 'utf8');
const app = readFileSync('src/apps/AgentWebUIBrowserApp.js', 'utf8');

function section(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = end ? src.indexOf(end, from) : src.length;
  return src.slice(from, to < 0 ? src.length : to);
}

test('the proxy publishes the tunnel prefix as the ZeroClaw base', () => {
  // It must be the keyed ASSET_PREFIX, not location.pathname: the app is also
  // loaded from the legacy query form, where the pathname carries no
  // coordinates at all and the router would still fail to match.
  assert.match(proxy, /window\.__ZEROCLAW_BASE__\s*=\s*ASSET_PREFIX;/);
  assert.doesNotMatch(proxy, /window\.__ZEROCLAW_BASE__\s*=\s*location\.pathname/);
  // Trailing slashes are stripped by the app itself
  // ((window.__ZEROCLAW_BASE__ ?? '').replace(/\/+$/, '')), so a trailing slash
  // here would be harmless but a MISSING leading slash would make the value
  // relative — assert the shape we actually depend on. (Asserted against the
  // whole file: slicing on '}' would cut inside ${ASSET_KEY}.)
  assert.match(proxy, /return `\/api\/agents\/webui-proxy\/\$\{ASSET_KEY\}\/\$\{encodeURIComponent\(String\(connectionId\)\)\}/);
});

test('the base is published before any code that could read it', () => {
  // It has to be assigned inside the same head script and ahead of the
  // WebSocket patch / history shims, so it is set before the app bundle
  // (a deferred module) evaluates.
  const injected = section(proxy, 'const scriptTag = `', '</script>');
  const assignAt = injected.indexOf('window.__ZEROCLAW_BASE__ = ASSET_PREFIX;');
  const wsPatchAt = injected.indexOf('window.WebSocket = function ProxiedWebSocket');
  const pushStateAt = injected.indexOf('history.pushState = function');
  assert.ok(assignAt >= 0, 'the assignment must live in the injected script');
  assert.ok(assignAt < wsPatchAt, 'must be set before the WebSocket patch');
  assert.ok(assignAt < pushStateAt, 'must be set before the history shims');
});

test('a tunnel prefix buried inside a chunk URL is lifted, not duplicated', () => {
  const fn = section(proxy, 'function fixSubresource(u) {', '// Same rewrite for markup');
  // The app composes '/_app' + ASSET_PREFIX + '/assets/<chunk>.js'. Prepending
  // the prefix again produced
  //   ASSET_PREFIX + '/_app' + ASSET_PREFIX + '/assets/<chunk>.js'
  assert.match(fn, /var at = u\.indexOf\(ASSET_PREFIX\);/);
  assert.match(fn, /if \(at > 0\) \{/);
  assert.match(fn, /u = ASSET_PREFIX \+ u\.slice\(0, at\) \+ u\.slice\(at \+ ASSET_PREFIX\.length\);/);
  // The lift must run BEFORE the generic prepend, or it can never take effect.
  const liftAt = fn.indexOf('var at = u.indexOf(ASSET_PREFIX);');
  const prependAt = fn.indexOf('return ASSET_PREFIX + p;');
  assert.ok(prependAt > liftAt, 'the lift has to happen before the prepend');
  // at === 0 means the URL is already anchored — must be left exactly as it was.
  assert.doesNotMatch(fn, /if \(at >= 0\) \{/);
});

test('the app tells the proxy which agent it is opening', () => {
  // Without this the proxy fell back to 'nanobot': the injected script echoed
  // ?agent=nanobot into a ZeroClaw tab's address bar, and the "start the Web
  // UI" fallback button POSTed /api/agents/nanobot — a different agent.
  assert.match(
    app,
    /const proxyUrl = `\/api\/agents\/webui-proxy\/m2\/\$\{encodeURIComponent\(targetConn\)\}\/\$\{agPort\}\?agent=\$\{encodeURIComponent\(agId\)\}`;/
  );
});

test('the keyed form carries the remote path as _path, never path', () => {
  // `path` in the keyed form belongs to the HOSTED APP. Writing our own remote
  // path into it overwrote the app's, and handleProxy then dropped the key.
  assert.match(catchAll, /url\.searchParams\.set\('_path', suffix\);/);
  assert.doesNotMatch(catchAll, /url\.searchParams\.set\('path', suffix\);/);
});

test('handleProxy accepts both forms and only eats `path` for the legacy one', () => {
  assert.match(proxy, /searchParams\.get\('_path'\) \?\? \(searchParams\.get\('path'\) \|\| '\/'\)/);
  assert.match(proxy, /const remotePathFromKeyedForm = searchParams\.has\('_path'\);/);
  assert.match(proxy, /if \(!remotePathFromKeyedForm\) transportParams\.push\('path'\);/);
  // `_path` itself is a transport param in both forms.
  assert.match(proxy, /'connectionId', 'port', '_path', '_base'/);
});
