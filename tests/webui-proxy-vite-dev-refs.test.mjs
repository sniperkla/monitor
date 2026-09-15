// ── Regression: root-absolute module specifiers inside a tunneled bundle ─────
//
// Reported: `localhost:3076` on fc-fedora40 (a Vite DEV server) opens through the
// SSH-tunnel proxy at a SUB-PATH and renders a blank page. Measured:
//
//   #root childElementCount = 0, console full of
//     [http 404] /@react-refresh
//     [http 404] /node_modules/.vite/deps/react.js
//     [http 404] /src/App.tsx
//     [http 404] /node_modules/vite/dist/client/env.mjs
//
// The document and its entry chunk load fine. The imports INSIDE the chunks are
// root-absolute, so the browser resolves them against the monitor origin instead
// of the proxy sub-path. Markup rewriting cannot see them and a <base> tag does
// not help (a root-absolute ref takes the base's ORIGIN but ignores its path).
//
// These tests pin `rewriteRootAssetRefs`, which now rewrites them in bundle text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The route pulls in Next request context + mongoose at module scope, so lift the
// pure function out of the source instead of importing the module.
const ROUTE = 'src/app/api/agents/webui-proxy/route.js';
const src = readFileSync(ROUTE, 'utf8');

function extract(startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  assert.ok(from >= 0, `missing: ${startMarker}`);
  const to = src.indexOf(endMarker, from);
  assert.ok(to > from, `unterminated: ${startMarker}`);
  return src.slice(from, to + endMarker.length);
}

// Strip the route's own `export` — this copy is re-exported at the bottom.
const FUNC = extract('export function rewriteRootAssetRefs(', '\n}').replace(/^export /, '');
const CONSTS = src.slice(
  src.indexOf('const DEV_ROOT_RE ='),
  src.indexOf('export function rewriteInlineScriptRefs(')
);
const INLINE = extract('export function rewriteInlineScriptRefs(', '\n}').replace(/^export /, '');
const NEEDS = extract('function needsProxyPrefix(', '\n}');
const PREFIX_FN = extract('function assetPathPrefix(', '\n}');

// ASSET_KEY is duplicated in files that cannot import each other (pinned by
// tests/webui-proxy-key.test.mjs); the lifted copy needs it in scope.
const ASSET_KEY_LINE = src.match(/^const ASSET_KEY = .*$/m)?.[0];
assert.ok(ASSET_KEY_LINE, 'ASSET_KEY must exist in the route');

const modPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'vite-refs-')), 'refs.mjs');
writeFileSync(modPath, [
  ASSET_KEY_LINE, PREFIX_FN, CONSTS, INLINE, NEEDS, FUNC,
  'export { rewriteRootAssetRefs, rewriteInlineScriptRefs, needsProxyPrefix, assetPathPrefix };',
].join('\n'));
const { rewriteRootAssetRefs, rewriteInlineScriptRefs, needsProxyPrefix, assetPathPrefix } = await import(`file://${modPath}`);

const CONN = '6a8ed8c5e27dead077074d2b';
const PORT = 3076;
const P = assetPathPrefix(CONN, PORT);
assert.match(P, /^\/api\/agents\/webui-proxy\/m2\//, 'prefix must be the path-keyed form');

const rw = (s) => rewriteRootAssetRefs(s, CONN, PORT);

test('Vite dev imports are re-prefixed — this is the blank screen', () => {
  // The exact shapes that 404'd on fc-fedora40.
  const out = rw('import "/node_modules/vite/dist/client/env.mjs";');
  assert.equal(out, `import "${P}/node_modules/vite/dist/client/env.mjs";`);

  assert.equal(rw('import "/@vite/client";'), `import "${P}/@vite/client";`);
  // No trailing slash and no extension — the shape a naive `.ext` rule misses.
  assert.equal(rw('import "/@react-refresh";'), `import "${P}/@react-refresh";`);
  assert.equal(rw('import "/src/App.tsx";'), `import "${P}/src/App.tsx";`);
  assert.equal(rw('import "/src/index.css";'), `import "${P}/src/index.css";`);
  // Vite's dep-optimizer cache, with its version query, must survive intact.
  assert.equal(
    rw('import "/node_modules/.vite/deps/react.js?v=4a384d2a";'),
    `import "${P}/node_modules/.vite/deps/react.js?v=4a384d2a";`
  );
});

test('single- and double-quoted specifiers are both rewritten', () => {
  assert.equal(rw("import '/src/main.tsx';"), `import '${P}/src/main.tsx';`);
  assert.equal(rw('import `/src/main.tsx`;'), `import \`${P}/src/main.tsx\`;`);
});

test('CRA-style bundles are covered by the extension rule', () => {
  assert.equal(rw('"/static/js/main.chunk.js"'), `"${P}/static/js/main.chunk.js"`);
  assert.equal(rw('"/static/css/2.1c0f3f21.chunk.css"'), `"${P}/static/css/2.1c0f3f21.chunk.css"`);
});

test('absolute URLs, protocol-relative URLs and already-prefixed refs are untouched', () => {
  // Rewriting these would break the page in a different way.
  assert.equal(rw('"https://cdn.example.com/x.js"'), '"https://cdn.example.com/x.js"');
  assert.equal(rw('"//cdn.example.com/x.js"'), '"//cdn.example.com/x.js"');
  // Double-prefixing is unrecoverable, and the first two passes legitimately
  // produce refs that already carry the prefix.
  const once = `${P}/assets/foo.js`;
  assert.equal(rw(`"${once}"`), `"${once}"`);
  assert.equal(needsProxyPrefix(once, P), false);
});

test('client-side ROUTE strings are not rewritten', () => {
  // A router path is compared in JS, never fetched. Prefixing "/settings" would
  // silently break in-app navigation for the tunneled SPA.
  for (const p of ['/settings', '/', '/chat', '/dashboard', '/login']) {
    assert.equal(rw(`"${p}"`), `"${p}"`, `${p} must stay a route`);
  }
});

test('the legacy assets/ rules still behave exactly as before', () => {
  // Hermes' Vite preload map depends on these two forms being DIFFERENT:
  // relative entries keep NO leading slash (React Router prepends its own),
  // root-absolute entries keep one.
  assert.equal(rw('"assets/foo.js"'), `"${P.slice(1)}/assets/foo.js"`);
  assert.equal(rw('"/assets/foo.js"'), `"${P}/assets/foo.js"`);
  // No cache-epoch query is added: a preload and a lazy import must be the SAME
  // URL or the module graph splits (documented: "green splash").
  assert.doesNotMatch(rw('"/assets/foo.js"'), /\?/);
});

test('a bare "/name.ext" is left alone — it is usually a suffix, not an asset', () => {
  // @monaco-editor/loader does "".concat(state.config.paths.vs, "/loader.js")
  // where `vs` is a jsdelivr CDN base. Prefixing that produced a URL on the CDN's
  // origin with our path bolted on, which is blocked (net::ERR_BLOCKED_BY_ORB)
  // and leaves the editor pane stuck on "Loading...".
  assert.equal(rw('"".concat(state.config.paths.vs, "/loader.js")'),
    '"".concat(state.config.paths.vs, "/loader.js")');
  assert.equal(rw('"/favicon.ico"'), '"/favicon.ico"');
  // …but a dev-server marker is still a marker even with no directory segment.
  assert.equal(rw('"/@react-refresh"'), `"${P}/@react-refresh"`);
});

test('the React preamble inside index.html is rewritten too', () => {
  // @vitejs/plugin-react inlines the preamble into the document; attribute
  // rewriting cannot see it, so without this the preamble 404s and React aborts
  // with "can't detect preamble. Something is wrong." on an otherwise-loading page.
  const html = '<script type="module">import RefreshRuntime from "/@react-refresh";\nRefreshRuntime.injectIntoGlobalHook(window);</script>'
    + '<script src="/src/main.tsx"></script>';
  const out = rewriteInlineScriptRefs(html, P);
  assert.match(out, /"\/api\/agents\/webui-proxy\/m2\/[^"]+\/@react-refresh"/);
  // An inline body is the ONLY thing touched — an src attribute belongs to the
  // attribute pass, and rewriting it here would double-prefix it.
  assert.doesNotMatch(out, /src="\/api\/agents\/webui-proxy[^"]*\/api\/agents\/webui-proxy/);
  // Non-script text is untouched.
  assert.equal(rewriteInlineScriptRefs('<link rel="icon" href="/favicon.ico">', P),
    '<link rel="icon" href="/favicon.ico">');
});

test('a realistic Vite entry chunk comes out fully prefixed', () => {
  const chunk = [
    'import { injectIntoGlobalHook } from "/@react-refresh";',
    'injectIntoGlobalHook(window);',
    'import "/@vite/client";',
    'import App from "/src/App.tsx";',
    'const dep = () => import("/node_modules/.vite/deps/react-dom_client.js?v=4a384d2a");',
    'const route = "/settings";',
  ].join('\n');
  const out = rw(chunk);
  assert.doesNotMatch(out, /"\/@react-refresh"/);
  assert.doesNotMatch(out, /"\/@vite\/client"/);
  assert.doesNotMatch(out, /"\/src\/App\.tsx"/);
  assert.doesNotMatch(out, /"\/node_modules\//);
  assert.match(out, /"\/settings"/, 'the route string must survive');
});
