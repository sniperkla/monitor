import { handleProxy } from '../route.js';

// Path-style variant of the WebUI proxy:
//   /api/agents/webui-proxy/<remote-path>?connectionId=..&port=..
// This exists so the hosted SPA's RELATIVE chunk URLs keep working: Vite
// resolves lazy chunks against import.meta.url, whose path is the proxied
// module URL (/api/agents/webui-proxy/assets/index-*.js). With the query-style
// proxy URL, relative resolution broke (chunks 404'd at /api/agents/*.js).
async function handler(request, ctx) {
  let segments = [];
  try {
    const p = typeof ctx?.params?.then === 'function' ? await ctx.params : ctx?.params;
    segments = p?.path || [];
  } catch (_) {}
  const suffix = segments.length ? '/' + segments.join('/') : '/';
  const url = new URL(request.url);
  url.searchParams.set('path', suffix);
  return handleProxy(new Request(url.toString(), request));
}

export { handler as GET, handler as POST };