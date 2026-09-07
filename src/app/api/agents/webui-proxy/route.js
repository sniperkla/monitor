/**
 * /api/agents/webui-proxy
 *
 * Server-side reverse-proxy that SSH-tunnels to a port on a remote server and
 * serves its HTTP response to an iframe in the browser — same-origin, so COEP
 * and X-Frame-Options restrictions are never triggered.
 *
 * Query params:
 *   connectionId  – DB id of the SSH connection
 *   port          – remote port to forward to (e.g. 8765, 7860, 42617)
 *   path          – URL path + query to request on the remote (default "/")
 *   _base         – internal: base path already stripped (for rewriting)
 *
 * All HTML responses have relative URLs rewritten to go back through this
 * proxy so navigation inside the iframe keeps working without JS patching.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig } from '@/app/api/server-backup/_ssh';
import { Client } from 'ssh2';
import http from 'http';
import net from 'net';

// ─── helpers ────────────────────────────────────────────────────────────────

// Marker segment for "path-keyed" asset URLs — see assetPathPrefix().
const ASSET_KEY = 'm';

/**
 * Base path for proxied sub-resources (JS chunks, CSS, images).
 *
 * The tunnel coordinates live HERE, in the path — never in the query string.
 * A bundler resolves a module's relative imports against `import.meta.url`,
 * and RFC 3986 relative resolution DROPS the base URL's query. With
 * `?connectionId=..&port=..` on the entry module, every lazily-imported chunk
 * therefore resolved to `/api/agents/webui-proxy/assets/<chunk>.js` with no
 * query at all → the proxy answered "400 connectionId required" → the module
 * graph never completed → the app sat on its static boot splash forever
 * ("Loading nanobot…", or a blank green screen for Hermes).
 *
 * Keying the path keeps the coordinates attached across any number of relative
 * hops, and also means the <link rel="modulepreload"> URL and the dynamic
 * import URL are byte-identical, so the browser dedupes them.
 */
function assetPathPrefix(connectionId, port) {
  return `/api/agents/webui-proxy/${ASSET_KEY}/${encodeURIComponent(String(connectionId))}/${encodeURIComponent(String(port))}`;
}

/** Percent-encode a path for safe use as real URL path segments. */
function encodeProxyPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

/**
 * Open an SSH-forwarded TCP socket to `remoteHost:remotePort` on the server
 * described by `sshConfig`.
 */
function sshForwardSocket(sshConfig, remoteHost, remotePort) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      try { conn.end(); } catch {}
      reject(new Error('SSH connect timeout'));
    }, 20000);

    conn.on('ready', () => {
      conn.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
        clearTimeout(timeout);
        if (err) { conn.end(); return reject(err); }
        // Attach a cleanup hook so the SSH session closes when the stream ends
        stream.on('close', () => { try { conn.end(); } catch {} });
        stream.on('error', () => { try { conn.end(); } catch {} });
        resolve({ stream, conn });
      });
    });

    conn.on('error', (err) => { clearTimeout(timeout); reject(err); });

    // Build the connect config — handle privateKey (Buffer / string)
    const cfg = {
      host:     sshConfig.host,
      port:     parseInt(sshConfig.port, 10) || 22,
      username: sshConfig.username,
      readyTimeout: 18000,
      keepaliveInterval: 0,
    };
    if (sshConfig.privateKey) cfg.privateKey = sshConfig.privateKey;
    if (sshConfig.password)   cfg.password   = sshConfig.password;
    if (sshConfig.passphrase) cfg.passphrase = sshConfig.passphrase;

    conn.connect(cfg);
  });
}

/**
 * Make an HTTP request through `socket` (already connected to remote host:port)
 * and return { status, headers, body }.
 */
function httpOverSocket(socket, remotePort, reqPath, reqMethod, reqHeaders, reqBody) {
  return new Promise((resolve, reject) => {
    const options = {
      createConnection: () => socket,
      hostname: '127.0.0.1',
      port: remotePort,
      path: reqPath,
      method: reqMethod,
      headers: {
        ...reqHeaders,
        host: `127.0.0.1:${remotePort}`,
        // Never forward the visitor's monitor-session cookie to the agent
        // service — it is this app's credential, not the agent's.
        cookie: undefined,
        // `authorization` MUST be forwarded. Agent Web UIs (nanobot especially)
        // mint a short-lived api_token from their own /webui/bootstrap endpoint
        // and send it back as `Authorization: Bearer …` on every /api/* call.
        // Dropping it here makes the gateway answer 401 "Unauthorized" to all
        // of them. The token is issued BY the agent service, so forwarding it
        // back to that same service leaks nothing.
      },
    };
    // Remove undefined
    for (const k of Object.keys(options.headers)) {
      if (options.headers[k] === undefined) delete options.headers[k];
    }

    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => settle(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => settle(reject, e));
    });

    req.on('error', (e) => settle(reject, e));
    const to = setTimeout(() => settle(reject, new Error('HTTP over SSH timeout')), 30000);
    req.on('close', () => clearTimeout(to));

    if (reqBody?.length) req.write(reqBody);
    req.end();
  });
}

/**
 * Rewrite URLs in HTML so that relative paths and AJAX/fetch calls continue
 * to go through this proxy endpoint rather than hitting the real domain.
 */
function rewriteHtml(html, proxyBase, currentPath, port, connectionId, agentId = 'nanobot') {
  // Folder for relative resolution (e.g. /app/ -> /app/, /index.html -> /)
  const folder = currentPath.substring(0, currentPath.lastIndexOf('/') + 1) || '/';

  // Inject helper script to monkey-patch fetch and XMLHttpRequest for SPAs
  const scriptTag = `
<script>
(function() {
  var PROXY_BASE = ${JSON.stringify(proxyBase)};
  var ASSET_PREFIX = ${JSON.stringify(assetPathPrefix(connectionId, port))};
  var CURRENT_FOLDER = ${JSON.stringify(folder)};
  var TUNNELED_PORT = ${JSON.stringify(String(port))};
  var TUNNEL_ID = ${JSON.stringify(String(connectionId || ''))};
  var WEBUI_AGENT = ${JSON.stringify(String(agentId || 'nanobot'))};
  function proxyWsUrl(p) {
    // Dedicated WS path (no Next.js route behind it): if the WS URL pointed at
    // /api/agents/webui-proxy, Next's upgradeHandler would treat the upgrade as
    // hitting an API route and socket.end() it mid-tunnel.
    return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/api/agents/webui-ws-proxy?connectionId=' + encodeURIComponent(TUNNEL_ID) + '&port=' + encodeURIComponent(TUNNELED_PORT) + '&path=' + encodeURIComponent(p);
  }
  function rewriteUrl(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.startsWith('//') || u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:')) return u;
    if (u.startsWith('/api/agents/webui-proxy')) return u;
    var p = u.startsWith('/') ? u : (CURRENT_FOLDER + u.replace(/^\\.\\//, ''));
    return PROXY_BASE + encodeURIComponent(p);
  }
  // Absolute URLs that point at the tunneled loopback service must be pulled
  // back inside the proxy — navigating to them would leave the SSH tunnel and
  // make the BROWSER dial localhost:<port> on the visitor's own machine
  // ("localhost refused to connect").
  var LOOPBACK_RE = new RegExp('^https?://(?:localhost|127\\\\.0\\\\.0\\\\.1|0\\\\.0\\\\.0\\\\.0|\\\\[::1\\\\])(:' + TUNNELED_PORT + ')?(/.*)?$', 'i');
  function rewriteLoopback(u) {
    if (!u || typeof u !== 'string') return null;
    var m = u.match(LOOPBACK_RE);
    if (!m) return null;
    return PROXY_BASE + encodeURIComponent(m[2] || '/');
  }
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      if (typeof input === 'string') {
        input = rewriteUrl(input);
      } else if (input && input.url && typeof input.url === 'string') {
        try {
          var target = rewriteUrl(input.url);
          if (target !== input.url) input = new Request(target, input);
        } catch(e) {}
      }
      return origFetch.call(this, input, init);
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  if (origOpen) {
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === 'string') {
        url = rewriteUrl(url);
      }
      return origOpen.apply(this, [method, url].concat(Array.prototype.slice.call(arguments, 2)));
    };
  }
  // Anchors: intercept clicks on links that point at the tunneled loopback
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document && !(el.tagName === 'A' && el.getAttribute('href'))) el = el.parentElement;
    if (!el || el === document) return;
    var proxied = rewriteLoopback(el.getAttribute('href'));
    if (proxied) { e.preventDefault(); window.location.href = proxied; }
  }, true);
  var origWindowOpen = window.open;
  window.open = function(u) {
    var proxied = rewriteLoopback(u);
    return origWindowOpen.apply(window, [proxied || u].concat(Array.prototype.slice.call(arguments, 1)));
  };
  // WebSocket: the hosted app commonly connects to ws://127.0.0.1:PORT or
  // ws://<this host>/ for its channel. Either would hit the visitor's own
  // machine / the bare monitor server, so route every socket through the
  // tunnel instead.
  var NativeWS = window.WebSocket;
  function tunnelWsUrl(u) {
    if (!u) return u;
    var str = String(u);
    var parsed = null;
    try { parsed = new URL(str, location.href); } catch(e) {}
    if (parsed && parsed.host === location.host && (parsed.pathname === '/api/agents/webui-proxy' || parsed.pathname === '/api/agents/webui-ws-proxy')) return str;
    var WS_LOOPBACK_RE = new RegExp('^(wss?):\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])(?::' + TUNNELED_PORT + ')?(\\/[^#]*)?');
    var wsMatch = str.match(WS_LOOPBACK_RE);
    if (wsMatch) return proxyWsUrl(wsMatch[2] || '/');
    if (parsed && parsed.host === location.host) return proxyWsUrl(parsed.pathname + parsed.search);
    return str;
  }
  window.WebSocket = function(url, protocols) {
    var n = tunnelWsUrl(url);
    return protocols === undefined ? new NativeWS(n) : new NativeWS(n, protocols);
  };
  window.WebSocket.prototype = NativeWS.prototype;
  ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){ window.WebSocket[k] = NativeWS[k]; });
  // Hide the proxy's own query params (connectionId/port/path) from the hosted
  // app — some apps parse the query string for their own settings and would
  // otherwise misread values like port=8765 and build URLs against it.
  //
  // They must not simply be dropped, though: the hosted SPA normalises the
  // address bar to location.pathname + location.hash, so a bare
  // /api/agents/webui-proxy#/chat/<id> is what the user ends up with once
  // they open a session — and what a reload, a new tab, or a bookmark then
  // requests. Without the tunnel coordinates that answer is
  // "connectionId required", so the session link only ever worked once.
  // Move them into the path instead (the form the catch-all route already
  // understands), which keeps the query clean AND the link replayable.
  try {
    if (location.search) {
      history.replaceState(
        null,
        '',
        ASSET_PREFIX + '/?agent=' + encodeURIComponent(WEBUI_AGENT) + location.hash
      );
    }
  } catch(e) {}

  // Sub-resources the app injects AFTER load (Vite modulepreload links, lazy
  // <script> tags, images, plugin bundles) are resolved against the DOCUMENT
  // base. A hosted router that pushState()s to a bare path — Hermes goes to
  // "/sessions" — moves that base off the proxy, so a root-absolute
  // "/assets/SessionsPage-*.js" escapes the SSH tunnel and 404s on the monitor
  // origin. Anything root-absolute here can only be meant for the tunneled app,
  // so rewrite it on the way in.
  var TUNNEL_PREFIX = '/api/agents/webui-proxy';
  function fixSubresource(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.indexOf('//') === 0 || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0 ||
        u.indexOf('javascript:') === 0 || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (u.indexOf(TUNNEL_PREFIX) === 0) return u;
    // A document that has escaped the proxy base makes even a relative URL
    // resolve against the wrong root, so anchor those at "/" too.
    var p = u.charAt(0) === '/' ? u : ('/' + u.replace(/^\\.\\//, ''));
    return ASSET_PREFIX + p;
  }
  // Same rewrite for markup injected as a STRING — insertAdjacentHTML /
  // innerHTML build elements through the HTML parser, which never touches the
  // attribute setters patched below.
  function fixMarkup(markup) {
    if (!markup || typeof markup !== 'string') return markup;
    if (markup.indexOf('=') < 0) return markup;
    return markup.replace(/(src|href)=(["'])\\/(?!\\/)([^"']*)\\2/gi, function(m, attr, q, path) {
      if (path.indexOf(TUNNEL_PREFIX.slice(1)) === 0) return m;
      return attr + '=' + q + ASSET_PREFIX + '/' + path + q;
    });
  }
  // A hosted router that pushState()s to a bare path — Hermes jumps straight to
  // "/sessions" — walks the document right out of the tunnel. The address bar
  // then reads http://monitor/sessions: a reload asks monitor for a route it
  // does not have, and the tunnel coordinates are gone for good. Keep every
  // same-origin navigation inside the proxy so the URL stays replayable.
  var origPushState = history.pushState.bind(history);
  var origReplaceState = history.replaceState.bind(history);
  function containInTunnel(u) {
    if (u == null) return u;
    try {
      var resolved = new URL(String(u), location.href);
      if (resolved.origin !== location.origin) return u;
      if (resolved.pathname.indexOf(TUNNEL_PREFIX) === 0) return u;
      var q = resolved.search || ('?agent=' + encodeURIComponent(WEBUI_AGENT));
      return ASSET_PREFIX + resolved.pathname + q + resolved.hash;
    } catch (e) { return u; }
  }
  history.pushState = function(state, title, url) {
    return arguments.length > 2 ? origPushState(state, title, containInTunnel(url)) : origPushState(state, title);
  };
  history.replaceState = function(state, title, url) {
    return arguments.length > 2 ? origReplaceState(state, title, containInTunnel(url)) : origReplaceState(state, title);
  };

  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'href' || name === 'data') && typeof value === 'string') {
      value = fixSubresource(value);
    }
    return origSetAttribute.call(this, name, value);
  };
  var origInsertAdjacent = Element.prototype.insertAdjacentHTML;
  if (origInsertAdjacent) {
    Element.prototype.insertAdjacentHTML = function(pos, html) {
      return origInsertAdjacent.call(this, pos, fixMarkup(html));
    };
  }
  var innerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerDesc && innerDesc.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true, enumerable: innerDesc.enumerable, get: innerDesc.get,
      set: function(v) { innerDesc.set.call(this, typeof v === 'string' ? fixMarkup(v) : v); }
    });
  }
  // Safety net: anything that still slips through with a bare root-absolute
  // URL gets rewritten as soon as it lands in the document.
  try {
    function fixNodeAttr(el, name) {
      if (!el || !el.getAttribute) return;
      var v = el.getAttribute(name);
      if (!v) return;
      var n = fixSubresource(v);
      if (n !== v) el.setAttribute(name, n);
    }
    new MutationObserver(function(records) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === 'attributes') { fixNodeAttr(rec.target, rec.attributeName); continue; }
        var added = rec.addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          fixNodeAttr(n, 'src'); fixNodeAttr(n, 'href'); fixNodeAttr(n, 'data');
          if (n.querySelectorAll) {
            var kids = n.querySelectorAll('[src],[href]');
            for (var k = 0; k < kids.length; k++) { fixNodeAttr(kids[k], 'src'); fixNodeAttr(kids[k], 'href'); }
          }
        }
      }
    }).observe(document.documentElement || document, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data']
    });
  } catch(e) {}
  [['HTMLScriptElement','src'],['HTMLLinkElement','href'],['HTMLImageElement','src'],
   ['HTMLIFrameElement','src'],['HTMLSourceElement','src'],['HTMLVideoElement','src'],
   ['HTMLAudioElement','src'],['HTMLEmbedElement','src'],['HTMLObjectElement','data']
  ].forEach(function(pair) {
    var Ctor = window[pair[0]];
    if (!Ctor || !Ctor.prototype) return;
    var prop = pair[1];
    var desc = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(Ctor.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function(v) { desc.set.call(this, typeof v === 'string' ? fixSubresource(v) : v); }
    });
  });
})();
</script>
`;

  let res = html;
  // NOTE: function replacement — the injected script contains `$'` (in the
  // LOOPBACK_RE regex), which String.replace would otherwise expand to "the
  // rest of the document", truncating the script and splicing the whole page
  // into the middle of it.
  if (res.includes('<head>')) {
    res = res.replace('<head>', () => '<head>' + scriptTag);
  } else if (res.includes('<HEAD>')) {
    res = res.replace('<HEAD>', () => '<HEAD>' + scriptTag);
  } else {
    res = scriptTag + res;
  }

  // Rewrite absolute src, href, action attributes to path-keyed proxy URLs
  // (/api/agents/webui-proxy/m/<cid>/<port>/assets/x.js) — handled by the
  // [...path] catch-all route. See assetPathPrefix() for why the coordinates
  // are carried in the path rather than the query.
  const pathProxyBase = assetPathPrefix(connectionId, port);
  res = res.replace(/(src|href|action)=(["'])\/((?!\/)[^"']*)(["'])/gi,
    (_, attr, q, path, q2) => `${attr}=${q}${pathProxyBase}${encodeProxyPath('/' + path)}${q2}`);

  // Rewrite url('/...') in style blocks
  res = res.replace(/url\((["']?)\/((?!\/)[^)]*?)(["']?)\)/gi,
    (_, q, path, q2) => `url(${q}${pathProxyBase}${encodeProxyPath('/' + path)}${q2})`);

  return res;
}

/**
 * Rewrite absolute URLs that point at the tunneled loopback service
 * (http://127.0.0.1:PORT, http://localhost:PORT, …) so they go back through
 * this proxy. Remote UIs often embed their own absolute URL in config/JSON
 * payloads or JS bundles; without this, any navigation to that URL escapes the
 * SSH tunnel and the BROWSER dials localhost:<port> on the visitor's machine
 * ("localhost refused to connect").
 */
function rewriteAbsoluteSelfUrls(text, proxyBase, port) {
  const re = new RegExp(
    '(https?:\\/\\/)(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])(?::' + port + ')?((?:\\/)[^\\s"\'`<>\\\\)\\]]*)?',
    'gi'
  );
  return text.replace(re, (_m, _scheme, path) => proxyBase + encodeURIComponent(path || '/'));
}

// ─── coordinate memory ───────────────────────────────────────────────────────

// The hosted SPA normalises the address bar and drops the proxy's query string,
// so links minted before the path-keyed form existed are bare
// `/api/agents/webui-proxy#/chat/<id>`: no coordinates, and nothing in the URL
// to recover them from. Remember the last tunnel this browser actually used so
// a refresh of one of those links still opens instead of 400-ing. It is only
// ever a hint — every lookup below is still scoped to the session's own
// connections, so the worst case is landing on a different server you own.
const COORD_COOKIE = 'mp_webui_coords';

function readCoordCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(COORD_COOKIE + '='));
  if (!hit) return null;
  const [connectionId, portStr, agentId] = decodeURIComponent(hit.slice(COORD_COOKIE.length + 1)).split('~');
  const port = parseInt(portStr, 10);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(connectionId || '')) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { connectionId, port, agentId: (agentId || 'nanobot').replace(/[^a-z0-9_-]/gi, '') };
}

// ─── route handler ───────────────────────────────────────────────────────────

export async function GET(request) {
  return handleProxy(request);
}
export async function POST(request) {
  return handleProxy(request);
}
// Re-exported for the catch-all path route ([...path]/route.js) which serves
// the same proxy under /api/agents/webui-proxy/... so that the hosted SPA's
// relative chunk URLs (Vite import.meta.url resolution) resolve correctly.
export { handleProxy, ASSET_KEY, assetPathPrefix };

async function handleProxy(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse('Unauthorized', { status: 401 });

    const { searchParams } = new URL(request.url);
    let connectionId = searchParams.get('connectionId');
    let port         = searchParams.has('port') ? parseInt(searchParams.get('port'), 10) : 8765;
    let remotePath     = searchParams.get('path') || '/';
    // Which agent owns this Web UI. The "service not running" rescue screen
    // below has to call that agent's `webui-ctl` to start it, and different
    // agents ship different UIs (nanobot's webui vs Hermes' dashboard).
    let agentId      = (searchParams.get('agent') || 'nanobot').replace(/[^a-z0-9_-]/gi, '');
    // Strip hash fragment from remote HTTP request (fragments are client-side only per RFC 7230)
    if (remotePath.includes('#')) {
      remotePath = remotePath.split('#')[0] || '/';
    }

    if (!connectionId) {
      // Bare URL — the hosted app already rewrote the address bar and threw the
      // coordinates away. Fall back to the last tunnel this browser used.
      const remembered = readCoordCookie(request);
      if (remembered) {
        connectionId = remembered.connectionId;
        port = remembered.port;
        agentId = remembered.agentId;
      }
    }
    if (!connectionId) return new NextResponse('connectionId required', { status: 400 });
    if (!port || port < 1 || port > 65535) return new NextResponse('invalid port', { status: 400 });

    // Append any extra query parameters that aren't proxy parameters
    const extraParams = new URLSearchParams();
    for (const [k, v] of searchParams.entries()) {
      if (!['connectionId', 'port', 'path', '_base'].includes(k)) {
        extraParams.append(k, v);
      }
    }
    const extraStr = extraParams.toString();
    if (extraStr) {
      remotePath += (remotePath.includes('?') ? '&' : '?') + extraStr;
    }

    const frameHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    };

    const sshConfig = await getSshConfig(connectionId);

    // Open SSH tunnel
    let tunnel;
    try {
      tunnel = await sshForwardSocket(sshConfig, '127.0.0.1', port);
    } catch (e) {
      return new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          body { background: #0b0f19; color: #f1f5f9; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 2rem; margin: 0; line-height: 1.5; display: flex; align-items: center; justify-content: center; min-height: 80vh; }
          .card { background: #151c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 1.75rem; max-width: 520px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-family: system-ui, -apple-system, sans-serif; }
          .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 11px; font-weight: bold; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); margin-bottom: 0.75rem; font-family: monospace; }
          h2 { margin: 0 0 0.5rem 0; font-size: 16px; color: #fff; }
          p { font-size: 13px; color: #94a3b8; margin: 0.5rem 0; }
          pre { background: #080c14; padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid #1e293b; color: #f87171; font-size: 11px; font-family: monospace; overflow-x: auto; white-space: pre-wrap; }
          .help { background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 0.75rem; margin-top: 1rem; font-size: 12px; color: #7dd3fc; }
          .actions { display: flex; gap: 8px; margin-top: 1.25rem; flex-wrap: wrap; }
          .btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 12px; font-weight: bold; cursor: pointer; border: none; transition: 0.2s; }
          .btn-primary { background: #0284c7; color: white; }
          .btn-primary:hover { background: #0369a1; }
          .btn-secondary { background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15); }
          .btn-secondary:hover { background: rgba(255,255,255,0.15); }
        </style></head><body>
          <div class="card">
            <div class="badge">SSH Port Forward Failed</div>
            <h2>⚡ Port ${port} Unreachable</h2>
            <p>Could not establish an SSH tunnel to port <strong>${port}</strong> on this server.</p>
            <pre>${String(e?.message || e).replace(/</g,'&lt;')}</pre>
            <div class="actions">
              <button class="btn btn-secondary" onclick="location.reload()">🔄 Retry</button>
            </div>
          </div>
        </body></html>`,
        { status: 200, headers: frameHeaders }
      );
    }

    // Forward the HTTP request
    let resp;
    try {
      const method = request.method;
      const body   = method !== 'GET' && method !== 'HEAD'
        ? Buffer.from(await request.arrayBuffer())
        : null;

      const fwdHeaders = {};
      for (const [k, v] of request.headers.entries()) {
        const kl = k.toLowerCase();
        // `authorization` is intentionally NOT stripped — see the note in
        // httpOverSocket(). Only this app's own session credentials (cookie)
        // and upstream-supplied client IPs are withheld.
        if (['host','cookie','x-forwarded-for','cf-connecting-ip','accept-encoding'].includes(kl)) continue;
        fwdHeaders[k] = v;
      }
      // Request uncompressed so we can reliably inspect & rewrite HTML / CSS
      fwdHeaders['accept-encoding'] = 'identity';

      resp = await httpOverSocket(tunnel.stream, port, remotePath, method, fwdHeaders, body);
    } catch (e) {
      try { tunnel.conn.end(); } catch {}
      return new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          body { background: #0b0f19; color: #f1f5f9; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 2rem; margin: 0; line-height: 1.5; display: flex; align-items: center; justify-content: center; min-height: 80vh; }
          .card { background: #151c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 1.75rem; max-width: 520px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-family: system-ui, -apple-system, sans-serif; }
          .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 11px; font-weight: bold; background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); margin-bottom: 0.75rem; font-family: monospace; }
          h2 { margin: 0 0 0.5rem 0; font-size: 16px; color: #fff; }
          p { font-size: 13px; color: #94a3b8; margin: 0.5rem 0; }
          pre { background: #080c14; padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid #1e293b; color: #f87171; font-size: 11px; font-family: monospace; overflow-x: auto; white-space: pre-wrap; }
          .help { background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 0.75rem; margin-top: 1rem; font-size: 12px; color: #7dd3fc; }
          .actions { display: flex; gap: 8px; margin-top: 1.25rem; flex-wrap: wrap; }
          .btn { padding: 0.5rem 1rem; border-radius: 8px; font-size: 12px; font-weight: bold; cursor: pointer; border: none; transition: 0.2s; }
          .btn-primary { background: #0284c7; color: white; }
          .btn-primary:hover { background: #0369a1; }
          .btn-secondary { background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15); }
          .btn-secondary:hover { background: rgba(255,255,255,0.15); }
          .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        </style></head><body>
          <div class="card">
            <div class="badge">Connection Refused (port ${port})</div>
            <h2>🔌 Web UI Service Not Running</h2>
            <p>The SSH tunnel opened successfully, but the agent's Web UI process is not responding on <strong>localhost:${port}</strong>.</p>
            <pre>${String(e?.message || e).replace(/</g,'&lt;')}</pre>
            <div class="help">
              💡 <strong>Tip:</strong> The daemon running is likely the headless gateway. You can start the Web UI service right now:
            </div>
            <div class="actions">
              <button id="start-btn" class="btn btn-primary" onclick="startWebUI()">⚡ Start Web UI Service</button>
              <button class="btn btn-secondary" onclick="location.reload()">🔄 Retry</button>
            </div>
          </div>
          <script>
            function startWebUI() {
              const btn = document.getElementById('start-btn');
              btn.disabled = true;
              btn.innerText = 'Opening Live Terminal...';
              // Trigger parent window live log terminal
              try {
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'START_WEBUI' }, '*');
                  btn.innerText = 'Starting via Live Terminal...';
                  return;
                }
              } catch(e) {}
              // Direct fallback if opened as standalone tab
              fetch('/api/agents/${agentId}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  connectionId: ${JSON.stringify(connectionId)},
                  action: 'webui-ctl',
                  config: { op: 'start', port: ${port} }
                })
              }).then(r => r.json()).then(d => {
                if (d.active || d.success) {
                  btn.innerText = 'Started! Connecting...';
                  setTimeout(() => location.reload(), 2500);
                } else {
                  btn.innerText = 'Failed: ' + (d.output || d.error || 'Check logs');
                  btn.disabled = false;
                }
              }).catch(err => {
                btn.innerText = 'Error: ' + err.message;
                btn.disabled = false;
              });
            }
          </script>
        </body></html>`,
        { status: 200, headers: frameHeaders }
      );
    }

    // Build proxy base URL for HTML rewriting
    const proxyBase = `/api/agents/webui-proxy?connectionId=${encodeURIComponent(connectionId)}&port=${port}&path=`;

    // Build response headers — strip headers that block iframe embedding
    const outHeaders = {};
    const skipHeaders = new Set([
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'cross-origin-resource-policy',
      'transfer-encoding',
      'connection',
      'keep-alive',
    ]);
    for (const [k, v] of Object.entries(resp.headers)) {
      if (skipHeaders.has(k.toLowerCase())) continue;
      outHeaders[k] = v;
    }
    outHeaders['x-frame-options'] = 'SAMEORIGIN';
    outHeaders['content-security-policy'] = "frame-ancestors 'self'";
    outHeaders['cross-origin-resource-policy'] = 'cross-origin';
    outHeaders['cross-origin-embedder-policy'] = 'unsafe-none';
    // Never let the browser reuse a stale copy of the tunneled page — an old
    // copy can carry pre-fix helper scripts or stale absolute URLs.
    outHeaders['cache-control'] = 'no-store, max-age=0';

    const contentType = (resp.headers['content-type'] || '').toLowerCase();
    let body = resp.body;

    // Rewrite HTML to keep navigation inside the proxy. ORDER MATTERS: the
    // absolute-URL rewrite must run on the clean remote HTML BEFORE the helper
    // script is injected — the helper itself contains `http://` literals (in
    // its loopback regex), which the absolute rewriter would otherwise match
    // and mangle, truncating the script mid-line.
    if (contentType.includes('text/html')) {
      let html = body.toString('utf8');
      html = rewriteAbsoluteSelfUrls(html, proxyBase, port);
      html = rewriteHtml(html, proxyBase, remotePath, port, connectionId, agentId);
      body = Buffer.from(html, 'utf8');
      outHeaders['content-length'] = String(body.length);
    } else if (contentType.includes('text/css')) {
      let css = body.toString('utf8');
      css = css.replace(/url\((["']?)\/((?!\/)[^)]*?)(["']?)\)/gi,
        (_, q, path, q2) => `url(${q}${assetPathPrefix(connectionId, port)}${encodeProxyPath('/' + path)}${q2})`);
      body = Buffer.from(css, 'utf8');
      outHeaders['content-length'] = String(body.length);
    } else if (
      contentType.includes('javascript') ||
      contentType.includes('json') ||
      contentType.startsWith('text/')
    ) {
      // JS bundles / JSON payloads may embed the service's own absolute
      // loopback URL (config endpoints, bootstrap URLs). Pull those back
      // through the proxy so the app can never navigate out of the tunnel.
      let text = body.toString('utf8');
      const rewritten = rewriteAbsoluteSelfUrls(text, proxyBase, port);
      if (rewritten !== text) {
        body = Buffer.from(rewritten, 'utf8');
        outHeaders['content-length'] = String(body.length);
      }
    }

    try { tunnel.conn.end(); } catch {}

    const response = new NextResponse(body, {
      status: resp.status,
      headers: outHeaders,
    });
    // Only documents need to seed the fallback: they are the responses a user
    // can meaningfully refresh or bookmark.
    if (contentType.includes('text/html')) {
      response.cookies.set({
        name: COORD_COOKIE,
        value: `${connectionId}~${port}~${agentId}`,
        path: '/api/agents/webui-proxy',
        maxAge: 60 * 60 * 24 * 7,
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
      });
    }
    return response;
  } catch (e) {
    console.error('[webui-proxy] error:', e);
    return new NextResponse(
      `<html><body style="background:#111;color:#f87171;font-family:monospace;padding:2rem">
        <h2>💥 Proxy Error</h2><pre>${String(e?.message || e).replace(/</g,'&lt;')}</pre>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

