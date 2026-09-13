import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The WebUI proxy's path key must be the SAME string in two places that cannot
 * import each other: the server route (`ASSET_KEY`) and the client components,
 * which hand-build the entry URL because they run in the browser.
 *
 * A drift is not subtle. The client would ask for
 * `/api/agents/webui-proxy/<old>/<cid>/<port>`, the catch-all would decline to
 * consume the marker segment, the coordinates would never reach the route, and
 * every agent Web UI would answer 400 "connectionId required". One authority —
 * the server constant — and this test proves every copy agrees with it.
 *
 * It also pins the key's SHAPE: a static path segment, never a query suffix and
 * never a per-process value. RFC 3986 relative resolution DROPS the base query
 * when a module resolves its own lazy imports, while the
 * `<link rel="modulepreload">` href (built as `"/" + dep`) KEEPS it — so a
 * query-suffixed key makes the preloaded and the dynamically imported copies of
 * a chunk two distinct module instances, splitting the app's React context and
 * crashing it back to its boot splash. That regression shipped twice (4680c2d7
 * added a `?v=` epoch, 8e4f604d removed it), so it is pinned here.
 */

const proxy = readFileSync('src/app/api/agents/webui-proxy/route.js', 'utf8');
const catchAll = readFileSync('src/app/api/agents/webui-proxy/[...path]/route.js', 'utf8');

const keyMatch = /const ASSET_KEY = '([^']*)'/.exec(proxy);
assert.ok(keyMatch, 'ASSET_KEY must be declared as a single-quoted string literal');
const ASSET_KEY = keyMatch[1];

// `webui-proxy/<key>/<connectionId…>` — the key is written plainly in template
// literals and with escaped slashes inside regex literals, so allow an optional
// backslash before each slash.
//
// The segment AFTER the key has to look like a connection id, otherwise this
// would also match prose that names the proxy's own sub-path — the route's doc
// comment legitimately contains `/api/agents/webui-proxy/assets/<chunk>.js`
// when explaining the historical failure, and `assets` is not a key.
const KEY_SITE_RE =
  /webui-proxy\\?\/([A-Za-z0-9_-]+)\\?\/(?:\$\{encodeURIComponent\([A-Za-z]+\)\}|[0-9a-f]{24}|\[|<(?:connectionId|cid)>)/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('the path key is a static path segment, not a query suffix', () => {
  assert.match(ASSET_KEY, /^[A-Za-z0-9_-]+$/, `unexpected key shape: ${ASSET_KEY}`);
  assert.doesNotMatch(ASSET_KEY, /\$\{|[?&#]/, 'the key must be a literal, not interpolated or query-like');

  // The key's whole job: it lives in the PATH, where relative resolution keeps it.
  assert.match(proxy, /\/api\/agents\/webui-proxy\/\$\{ASSET_KEY\}\//);

  // ...and no query-string cache epoch has crept back in.
  assert.doesNotMatch(proxy, /ASSET_EPOCH|assetCacheBustSuffix/);
});

test('every client copy of the path key matches the server constant', () => {
  const offenders = [];
  let sites = 0;
  for (const file of walk('src')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(KEY_SITE_RE)) {
      sites += 1;
      if (m[1] !== ASSET_KEY) offenders.push(`${file}: found '${m[1]}'`);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `path key drifted from ASSET_KEY='${ASSET_KEY}':\n  ${offenders.join('\n  ')}`,
  );
  assert.ok(sites >= 4, `expected the key at >=4 sites (proxy + client builders), found ${sites}`);
});

test('the catch-all consumes the key instead of hardcoding it', () => {
  assert.match(catchAll, /import \{[^}]*ASSET_KEY[^}]*\} from '\.\.\/route\.js'/);
  assert.match(catchAll, /segments\[0\] === ASSET_KEY/);
  assert.doesNotMatch(catchAll, /segments\[0\] === '/);
});

test('server.js and next.config.mjs route the proxy by prefix, never by key', () => {
  // server.js decides whether a request is the WebUI proxy (HTTP + the WS
  // upgrade) from the path PREFIX, and next.config.mjs scopes its framing
  // headers with a `:path*` wildcard. Both must stay key-agnostic: if either
  // hardcoded the marker segment, bumping the key would silently stop the
  // WebSocket proxy from upgrading — the HTTP side would keep working, so the
  // failure would look like "the agent UI loads but nothing streams".
  for (const file of ['server.js', 'next.config.mjs']) {
    const src = readFileSync(file, 'utf8');
    const hardcoded = [...src.matchAll(KEY_SITE_RE)].map((m) => m[1]);
    assert.equal(
      hardcoded.length,
      0,
      `${file} must not name the key (found ${hardcoded.join(', ')}); use the prefix or a :path* wildcard`,
    );
    assert.match(src, /webui-proxy/, `${file} should still route the proxy by prefix`);
  }
});
