import { handleProxy, ASSET_KEY } from '../route.js';

// Path-keyed variant of the WebUI proxy:
//   /api/agents/webui-proxy/m/<connectionId>/<port>/<remote-path>
//
// This is the form every sub-resource URL is rewritten to (see
// assetPathPrefix() in ../route.js). The tunnel coordinates have to travel in
// the PATH because a bundler resolves a chunk's relative imports against
// import.meta.url, and RFC 3986 relative resolution drops the base URL's query
// string — so `?connectionId=..&port=..` on the entry module evaporates the
// moment the app lazily imports its first chunk.
//
// The legacy query form (`/api/agents/webui-proxy/<remote-path>?connectionId=..
// &port=..`) is still accepted for URLs minted before this change.
async function handler(request, ctx) {
  let segments = [];
  try {
    const p = typeof ctx?.params?.then === 'function' ? await ctx.params : ctx?.params;
    segments = p?.path || [];
  } catch (_) {}

  const url = new URL(request.url);

  // Only consume the marker form when the request does not already carry the
  // coordinates in its query — an old page whose remote path genuinely starts
  // with the marker segment must not be mis-parsed as a keyed URL.
  const hasQueryCoords = url.searchParams.has('connectionId') || url.searchParams.has('port');
  if (
    !hasQueryCoords &&
    segments[0] === ASSET_KEY &&
    segments.length >= 3 &&
    /^\d+$/.test(segments[2])
  ) {
    url.searchParams.set('connectionId', segments[1]);
    url.searchParams.set('port', segments[2]);
    segments = segments.slice(3);
  }

  const suffix = segments.length ? '/' + segments.join('/') : '/';
  url.searchParams.set('path', suffix);
  return handleProxy(new Request(url.toString(), request));
}

export { handler as GET, handler as POST };
