/**
 * Pure URL-rewriting helpers for the same-origin agent Web UI proxy.
 *
 * Split out of `webui-proxy/route.js` so they can be exercised directly by
 * tests. The route module pulls in next-auth, mongoose and ssh2, so importing
 * it from `node --test` is heavy and slow; these two functions are pure string
 * transforms with no dependencies, and they are exactly where the subtle bugs
 * live. Behaviour is far better pinned by calling them than by regex-matching
 * their source.
 */

/**
 * Re-point an agent's own absolute loopback URL at the proxy.
 *
 * Any `http://127.0.0.1:<port>/…` (or localhost / 0.0.0.0 / [::1]) inside an
 * HTML page or a JS bundle describes the AGENT, not the browser. Left alone it
 * makes the browser dial its own machine and the tunnel is bypassed, so every
 * occurrence is pulled back through the proxy.
 *
 * @param {string} text         HTML or JS/CSS source
 * @param {string} proxyBase    Query-form base, ending in `path=` — the form to
 *                              use for a reference that HAS a path.
 * @param {number|string} port  The agent's port, so `:1234` only matches the
 *                              port actually being tunneled.
 * @param {string} keyedPrefix  Path-keyed base, e.g.
 *                              `/api/agents/webui-proxy/m2/<cid>/<port>`.
 * @returns {string}
 */
export function rewriteAbsoluteSelfUrls(text, proxyBase, port, keyedPrefix) {
  const re = new RegExp(
    // The port is optional (bundles write `http://127.0.0.1/…` too) but it must
    // not PARTIALLY match: without the trailing lookahead, `127.0.0.1:9999`
    // matched as bare `127.0.0.1` and left `:9999` dangling, turning a
    // reference to a different local service into a corrupted path segment.
    '(https?:\\/\\/)(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])(?::' + port + ')?(?!:\\d)((?:\\/)[^\\s"\'`<>\\\\)\\]]*)?',
    'gi'
  );
  return text.replace(re, (_m, _scheme, path) => {
    // A reference with NO path (or a bare `/`) is a BASE that bundles
    // concatenate onto, not a URL they fetch. ZeroClaw builds its live-data
    // address as `${gatewayBase}/api/events`, where the gateway base defaults
    // to `http://127.0.0.1:42617`. The query form ends in `path=%2F`, so the
    // concatenation produced `…&path=%2F/api/events` — a remote path of
    // `//api/events`, which matches no gateway route and therefore fell through
    // to the SPA's index.html under a **200**. The client checked only `res.ok`
    // and `res.body`, saw both, consumed HTML as an event stream, received zero
    // events and — because the stream ended cleanly — never errored and never
    // retried. Result: ZeroClaw's chrome rendered, its content pane stayed
    // empty forever.
    //
    // The path-keyed prefix carries no trailing separator, so appending a path
    // to it lands on the remote path the bundle actually meant.
    if (!path || path === '/') return keyedPrefix;
    return proxyBase + encodeURIComponent(path);
  });
}

/**
 * Collapse a doubled (or tripled…) leading slash on a remote path.
 *
 * A bundle that builds a URL by concatenating a base which already ends in `/`
 * onto a path that starts with one produces `//api/events`. The agent's server
 * has no such route and answers with its SPA index.html under a **200**, so the
 * caller gets a successful response full of HTML instead of the resource it
 * asked for — and a client that only checks `res.ok` never notices.
 *
 * Normalising here also rescues browsers still holding an already-cached
 * bundle that composes the bad URL: hashed assets are served `immutable`, so a
 * client can keep the old bytes for a year.
 *
 * @param {string} p
 * @returns {string}
 */
export function collapseLeadingSlashes(p) {
  return String(p).replace(/^\/{2,}/, '/');
}
