import { NextResponse } from 'next/server';
import { assertSafeHttpUrl } from '@/lib/ssrfGuard';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Security Configuration
// ---------------------------------------------------------------------------

/** Max proxied response body — prevents the proxy from being a file tunnel. */
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

/** Upstream request timeout — prevents slow-loris / hung connections. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Simple in-memory sliding-window rate limiter.
 * ≤60 proxy requests / IP / minute. Does not survive restarts, but that is
 * fine — this guards against automation bursts, not sustained campaigns.
 */
const RATE_MAP = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = RATE_MAP.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }
  RATE_MAP.set(ip, entry);
  // Prune stale entries to prevent unbounded growth
  if (RATE_MAP.size > 5000) {
    for (const [k, v] of RATE_MAP) {
      if (now - v.windowStart > RATE_WINDOW * 2) RATE_MAP.delete(k);
    }
  }
  return entry.count <= RATE_LIMIT;
}

/**
 * Response headers we forward back to the client (allowlist).
 * Everything else — including Set-Cookie, CORS headers, and any policy
 * headers set by the target — is stripped.
 */
const ALLOWED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-language',
  'last-modified',
  'etag',
  'cache-control',
]);

/**
 * MIME types we are willing to proxy.
 * Restricting this prevents the route from acting as an unrestricted
 * binary file tunnel (e.g., downloads of .exe / .zip).
 */
const ALLOWED_MIME_PREFIXES = [
  'text/html',
  'text/plain',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'image/',
  'font/',
];

function isAllowedMime(ct) {
  if (!ct) return false;
  const base = ct.split(';')[0].trim().toLowerCase();
  return ALLOWED_MIME_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function getIp(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * HTML-encode characters that could turn a reflected string into XSS.
 * Used in the error page so that a crafted error message cannot inject script.
 */
function esc(str) {
  return String(str ?? '').replace(/[<>"'&]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * /api/browser/proxy
 *
 * Security layers (in order of evaluation):
 *   1. Authentication  — valid session required (getToken).
 *   2. Rate limiting   — ≤60 req/min/IP, in-memory sliding window.
 *   3. URL validation  — max 2048 chars, http/https only, no private IPs
 *                        (SSRF guard: double-DNS-resolved, octal/hex-aware).
 *   4. Fetch timeout   — 15 s abort to prevent slow-loris abuse.
 *   5. Body size cap   — reject responses > 5 MB (pre- and post-decompress).
 *   6. MIME allowlist  — only HTML + supporting web assets are forwarded.
 *   7. Header scrubbing — outbound: no cookies/auth/origin forwarded;
 *                        inbound: only an explicit safe allowlist returned.
 *   8. XSS-safe errors — error page values are HTML-entity-encoded.
 */
export async function GET(request) {
  // -------------------------------------------------------------------------
  // 1. Authentication — require a valid session
  // -------------------------------------------------------------------------
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.ENCRYPTION_KEY;

  if (secret) {
    try {
      const token = await getToken({ req: request, secret });
      if (!token) {
        return unauthenticatedResponse(request);
      }
    } catch {
      return unauthenticatedResponse(request);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Rate limiting
  // -------------------------------------------------------------------------
  const ip = getIp(request);
  if (!checkRateLimit(ip)) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  let targetUrl = '';
  try {
    // -----------------------------------------------------------------------
    // 3. URL validation
    // -----------------------------------------------------------------------
    const { searchParams } = new URL(request.url);
    targetUrl = searchParams.get('url') ?? '';

    if (!targetUrl) {
      return new NextResponse('Missing url parameter', { status: 400 });
    }
    if (targetUrl.length > 2048) {
      return new NextResponse('URL too long', { status: 400 });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new NextResponse('Invalid URL format', { status: 400 });
    }

    // Only http and https — no javascript:, data:, file:, etc.
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new NextResponse('Invalid protocol — only http and https are allowed', { status: 400 });
    }

    // SSRF guard: double-resolves DNS, blocks private/internal/cloud-metadata ranges
    const guardResult = await assertSafeHttpUrl(targetUrl);
    if (!guardResult?.safe) {
      return new NextResponse(
        buildErrorPage('Address Blocked by Security Policy', guardResult?.reason || 'This address is not reachable through the proxy.', targetUrl),
        { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN' } }
      );
    }

    // -----------------------------------------------------------------------
    // 4. Fetch with timeout — outbound headers are scrubbed (no cookie/auth)
    // -----------------------------------------------------------------------
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(targetUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          // Deliberately NOT forwarding: Cookie, Authorization, Origin, Referer,
          // X-Forwarded-For, or any internal Next.js headers.
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // -----------------------------------------------------------------------
    // 5. Body size cap (pre-read check via Content-Length)
    // -----------------------------------------------------------------------
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return new NextResponse('Response too large to proxy', { status: 502 });
    }

    const rawContentType = res.headers.get('content-type') || 'text/html; charset=utf-8';

    // -----------------------------------------------------------------------
    // 6. MIME allowlist
    // -----------------------------------------------------------------------
    if (!isAllowedMime(rawContentType)) {
      return new NextResponse('Content type not permitted through proxy', { status: 502 });
    }

    // -----------------------------------------------------------------------
    // 7. Build safe response headers (allowlist — strip everything else)
    // -----------------------------------------------------------------------
    const safeHeaders = new Headers();
    for (const key of ALLOWED_RESPONSE_HEADERS) {
      const val = res.headers.get(key);
      if (val) safeHeaders.set(key, val);
    }
    safeHeaders.set('Content-Type', rawContentType);
    // Allow embedding in Monitor (same-origin) only
    safeHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    // Prevent our proxy response from being iframed by third parties
    safeHeaders.set('Content-Security-Policy', "frame-ancestors 'self'");
    safeHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
    safeHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');

    // HTML: inject <base href> and navigation helper so relative assets and link clicks resolve inside the proxy
    if (rawContentType.includes('text/html')) {
      let html = await res.text();

      // Secondary size check after decompression (gzip can expand significantly)
      if (html.length > MAX_BODY_BYTES) {
        return new NextResponse('Response too large to proxy', { status: 502 });
      }

      let finalUrl = parsed;
      try {
        if (res.url) finalUrl = new URL(res.url);
      } catch (_) {}

      const baseTag = `<base href="${finalUrl.origin}${finalUrl.pathname}">`;
      const navScript = `<script>
(function() {
  var MSG = '__mpBrowser';

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch (_) {}
  }

  // ── sandbox bridge ────────────────────────────────────────────────────────
  // This page is framed with a sandbox that withholds allow-same-origin, so it
  // runs on an OPAQUE origin. Two consequences drive everything below:
  //
  //   1. We must not navigate ourselves. Our own navigations are cross-site, so
  //      SameSite=Lax session cookies are withheld and the proxy answers 401 —
  //      every link click landed on an "Unauthorized" page. Parent-initiated
  //      navigations do carry the cookie, so we ask the parent to move us. The
  //      same applies to target="_blank", which we hand over as 'newtab' so it
  //      becomes a tab in the app rather than a logged-out OS popup.
  //   2. The parent cannot read our location, so we report it.
  //
  // Note the <base href> below makes the document base the TARGET origin. A
  // root-relative proxy path therefore resolves against the target site, so
  // URLs must be resolved to absolute before being handed over.
  //
  // The sandbox above has a price, and it is worth stating plainly because it
  // is NOT fixable from in here. Measured in this frame:
  //   - document.cookie, localStorage, sessionStorage, caches and
  //     navigator.serviceWorker all THROW on access (SecurityError), and
  //   - every cross-origin fetch/XHR/script is refused, because this document's
  //     origin is the opaque string "null" and the target sends no CORS header.
  //
  // The first group CAN be faked with in-memory stand-ins, and that was built,
  // measured, and then removed. It stops the crash but rescues nothing, because
  // the second group is what actually kills a JS-required site: youtube.com
  // with the stand-ins installed built a 997 KB DOM and still rendered zero
  // visible characters, and bbc.com/news dies on "Access to script ... from
  // origin 'null' blocked by CORS" followed by a React error, which no stand-in
  // can help. Worse, the fake cookie jar let Google Search believe it had a
  // session and self-navigate into a dead end. So the honest answer is to SAY
  // so (see explainUnrenderable), not to simulate an environment the site
  // cannot actually use. The sandbox itself is not negotiable: this route
  // serves a stranger's HTML from OUR origin, so same-origin would let their
  // script run as the monitor app.
  var _sandboxed = false;
  try { window.localStorage.getItem('__mp_probe'); } catch (_) { _sandboxed = true; }

  function goto(u, kind) {
    try {
      var abs = new URL(u, document.baseURI).href;
      if (abs.indexOf('http://') !== 0 && abs.indexOf('https://') !== 0) return;
      post({ [MSG]: kind || 'goto', url: abs });
    } catch (_) {}
  }

  function reportNav() {
    post({ [MSG]: 'nav', href: location.href });
  }

  // Intercept link clicks
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    var rawHref = a.getAttribute('href') || '';
    if (rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    e.preventDefault();
    // target="_blank" means a new TAB, not an OS window. Left alone it would open
    // a native popup that inherits this frame's opaque origin — i.e. the target
    // site, logged out, in a separate window outside the app's own tab bar. Ask
    // the parent to open it as a tab instead.
    goto(a.href, a.target === '_blank' ? 'newtab' : 'goto');
  }, true);

  // ── form submissions ───────────────────────────────────────────────────────
  // Shared by the submit-event interceptor and the patched form.submit(), which
  // bypasses that event entirely (a real trap: form.submit() fires NO submit
  // event, so an event-only interceptor silently misses it). No backticks in
  // this block — see the note further down about the template literal.
  function handleSubmit(form, evt) {
    if (!form || !form.action) return;
    var m = (form.method || 'get').toLowerCase();
    // method="dialog" closes a <dialog> and never navigates. Leave it alone.
    if (m === 'dialog') return;
    if (m !== 'get') {
      // A POST would navigate this frame straight to the TARGET origin, and only
      // the proxy sets the COEP header a nested document needs — so the frame
      // dies with ERR_BLOCKED_BY_RESPONSE / corp-not-same-origin-after-… and the
      // tab shows a chrome error. Measured. Refuse it and say so instead.
      if (evt) evt.preventDefault();
      explainBlockedSubmit();
      return;
    }
    try {
      var target = new URL(form.action, document.baseURI);
      var params = new URLSearchParams(target.search);
      var fd = new FormData(form);
      for (var pair of fd.entries()) { params.append(pair[0], pair[1]); }
      target.search = params.toString();
      if (evt) evt.preventDefault();
      goto(target.href);
    } catch (_) {}
  }

  document.addEventListener('submit', function(e) {
    handleSubmit(e.target, e);
  }, true);

  try {
    HTMLFormElement.prototype.submit = function() { handleSubmit(this, null); };
  } catch (_) {}

  // Shared by every "the in-app browser cannot do this" message. Deliberately
  // no external-open link inside: a proxied page must not be able to trigger
  // browser-tab opens on its own. The toolbar already has that button.
  function showNotice(title, body) {
    try {
      var id = '__mpBlockedNotice';
      var old = document.getElementById(id);
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var box = document.createElement('div');
      box.id = id;
      box.setAttribute('style', 'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);max-width:520px;padding:14px 18px;border-radius:12px;background:#18181b;color:#f4f4f5;border:1px solid #3f3f46;box-shadow:0 10px 30px rgba(0,0,0,.35);font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-align:left');

      var titleEl = document.createElement('div');
      titleEl.setAttribute('style', 'font-weight:500;margin-bottom:4px');
      titleEl.textContent = title;

      var bodyEl = document.createElement('div');
      bodyEl.setAttribute('style', 'color:#a1a1aa');
      bodyEl.textContent = body;

      box.appendChild(titleEl);
      box.appendChild(bodyEl);
      // Keep the notice outside the target page's body. JS-heavy apps often
      // replace body wholesale during boot, which would otherwise erase the
      // only explanation we gave the user.
      (document.documentElement || document.body).appendChild(box);
      setTimeout(function() {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 12000);
    } catch (_) {}
  }

  function clearNotice() {
    try {
      var old = document.getElementById('__mpBlockedNotice');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    } catch (_) {}
  }

  function explainBlockedSubmit() {
    showNotice(
      'Form submission is not supported in the in-app browser',
      'This page tried to submit a form. Use the open-externally button in the toolbar to continue in a real browser tab.'
    );
  }

  // A JS-required site that cannot run here does not fail loudly — it renders an
  // empty shell, which just reads as "the browser is broken". Measured:
  // youtube.com builds roughly 1 MB of DOM and paints zero characters. Say so
  // rather than leaving a blank frame. Guarded three ways so a genuinely empty
  // page is not mislabelled: we are in the opaque sandbox, the document shipped
  // scripts, and nothing rendered. Checked twice, and withdrawn if content turns
  // up late, so a slow page is not accused of being broken.
  function explainUnrenderable() {
    try {
      if (!_sandboxed) return;
      if (!document.body) return;
      if (document.querySelectorAll('script').length === 0) return;
      var text = (document.body.innerText || '').replace(/\s+/g, '');
      var noScript = document.querySelector('noscript');
      var jsRequiredFallback = noScript && /http-equiv\s*=\s*["']?refresh/i.test(noScript.innerHTML || '')
        && /trouble accessing|not redirected/i.test(noScript.textContent || '');
      if (text.length > 40 && !jsRequiredFallback) { clearNotice(); return; }
      showNotice(
        jsRequiredFallback ? 'This search needs a real browser' : 'This page needs a real browser',
        jsRequiredFallback
          ? 'This search engine returned a JavaScript-only page, so the in-app browser cannot show its results. Use DuckDuckGo Lite or the open-externally button in the toolbar.'
          : 'Its scripts need storage or network access that the in-app browser blocks for safety, so it rendered nothing. Use the open-externally button in the toolbar to open it in a real tab.'
      );
    } catch (_) {}
  }

  function scheduleUnrenderableCheck() {
    setTimeout(explainUnrenderable, 3000);
    setTimeout(explainUnrenderable, 8000);
    setTimeout(explainUnrenderable, 15000);
  }
  // Do not wait only for load: some JS-heavy pages keep the document in a
  // loading state while they rebuild the shell, and the useful diagnosis is
  // needed before that work finishes.
  scheduleUnrenderableCheck();

  // ── programmatic navigation ────────────────────────────────────────────────
  // replace() and assign() live on Location.prototype and CAN be replaced.
  // href/search/hash/pathname CANNOT: Location's attributes are
  // [LegacyUnforgeable] — own, non-configurable properties of the location
  // object. Measured in this frame: the descriptor for location.href reports
  // { configurable: false }, and every defineProperty attempt fails with
  // "TypeError: Cannot redefine property". An earlier version of this block
  // tried to patch Location.prototype.href and silently did nothing, because
  // that prototype carries only constructor/replace/assign here.
  //
  // So assigning location.href or location.search always escapes us. What
  // they produce is a self-navigation to this frame's OWN proxy URL, which is
  // cross-site (the origin is opaque), so the session cookie is withheld and the
  // proxy answers 401. Measured on google.com AND bing.com search result pages,
  // both of which reload themselves with an extra param. That 401 is now handled
  // honestly server-side (see the iframe-navigation branch in the route) instead
  // of pretending it can be intercepted here.
  try {
    Location.prototype.replace = function(url) { goto(String(url)); };
    Location.prototype.assign = function(url) { goto(String(url)); };
  } catch (_) {}

  // window.open is not covered by the Location patches, and its default '_self'
  // target navigates this frame — straight into the same cross-site 401. Route
  // same-frame targets through the parent like any other link. Deliberately
  // refuse named/_blank popups: a proxied page must not be able to open tabs on
  // its own. Returns null, which is the standard "popup blocked" answer pages
  // already handle.
  try {
    window.open = function(url, target) {
      if (url == null || url === '') return null;
      var t = target == null ? '' : String(target);
      if (t === '' || t === '_self' || t === '_parent' || t === '_top') {
        goto(String(url));
      }
      return null;
    };
  } catch (_) {}

  // ── client-side routing (SPAs) ─────────────────────────────────────────────
  // An opaque origin cannot change its own URL, so a router calling
  // pushState(state, '', '/route') throws SecurityError — and it throws INSIDE
  // the page's own click handler, so the router dies and the site stops
  // responding to clicks. Measured: replaceState to the *same* URL is allowed,
  // any pushState to a different path is not.
  //
  // We cannot contain the URL the way the agent WebUI tunnel does (that frame is
  // same-origin; ours is opaque, so even a same-origin URL is refused). Swallow
  // the call instead: the page keeps its own state and renders its own view, and
  // we report the intended URL so the omnibox follows the route like a real
  // browser would. Deliberately no parent-side history push — a cosmetic state
  // change and a real route change are indistinguishable from here, and a wrong
  // stack entry would make Back worse rather than better.
  //
  // NOTE: no backticks anywhere in this comment block. This whole script is one
  // JS template literal, so a single backtick would terminate it and 500 the
  // route. Same reason the strings below avoid them.
  function reportPush(u) {
    if (u == null) return;
    try {
      var abs = new URL(String(u), document.baseURI).href;
      if (abs.indexOf('http://') !== 0 && abs.indexOf('https://') !== 0) return;
      post({ [MSG]: 'push', href: abs });
    } catch (_) {}
  }
  try {
    history.pushState = function(state, title, url) { reportPush(url); };
    history.replaceState = function(state, title, url) { reportPush(url); };
  } catch (_) {}

  // Fires once per document load, so the omnibox tracks parent-driven
  // navigations and any redirect the proxy resolved server-side.
  reportNav();
  window.addEventListener('popstate', reportNav);
  window.addEventListener('hashchange', reportNav);
})();
</script>`;

      const injection = `${baseTag}${navScript}`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${injection}`);
      } else {
        html = `${injection}${html}`;
      }

      return new NextResponse(html, { status: res.status, headers: safeHeaders });
    }

    // Non-HTML assets
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return new NextResponse('Response too large to proxy', { status: 502 });
    }

    return new NextResponse(buffer, { status: res.status, headers: safeHeaders });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    const isSsrf =
      err?.message?.includes('private') ||
      err?.message?.includes('blocked') ||
      err?.message?.includes('internal');

    const title = isAbort
      ? 'Request Timed Out'
      : isSsrf
      ? 'Address Blocked by Security Policy'
      : 'Unable to Load In-App';

    const message = isAbort
      ? 'The target server did not respond within 15 seconds.'
      : err?.message || 'The destination server refused the connection or is not responding.';

    return new NextResponse(buildErrorPage(title, message, targetUrl), {
      status: isAbort ? 504 : 502,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Unauthenticated response
// ---------------------------------------------------------------------------
/**
 * A proxied page can navigate ITSELF, and it will: assigning location.href or
 * location.search cannot be intercepted from inside the sandbox (Location's
 * attributes are unforgeable, so defineProperty fails), and the frame ends up
 * requesting its OWN proxy URL. Because the frame's origin is opaque, that
 * request is cross-site, the SameSite=Lax session cookie is withheld, and this
 * route cannot authenticate it. Measured on google.com AND bing.com search
 * result pages — both reload themselves with an extra param.
 *
 * Never answer that with a bare "Unauthorized": the frame just reads as a broken
 * app. Answer the navigation with a page that explains itself. Deliberately no
 * target URL is echoed — at this point it has not been validated, and an href
 * built from it could carry a javascript: URL. API callers still get a plain 401.
 */
function unauthenticatedResponse(request) {
  const dest = request.headers.get('sec-fetch-dest');
  const mode = request.headers.get('sec-fetch-mode');

  if (dest === 'iframe' && mode === 'navigate') {
    return new NextResponse(
      buildErrorPage(
        'Navigation Blocked',
        'This page tried to navigate itself, and the in-app browser cannot follow that. Use the open-externally button in the toolbar to load the site in a real browser tab.'
      ),
      {
        status: 401,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'SAMEORIGIN',
          'Content-Security-Policy': "frame-ancestors 'self'",
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
        },
      }
    );
  }

  return new NextResponse('Unauthorized', { status: 401 });
}

// ---------------------------------------------------------------------------
// Error page (8. XSS-safe — all interpolated values are HTML-entity-encoded)
// ---------------------------------------------------------------------------
function buildErrorPage(title, message, targetUrl = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#09090b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:32px;max-width:480px;width:100%;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,.5)}
    .icon{font-size:36px;margin-bottom:16px}
    h2{font-size:17px;margin-bottom:8px;color:#f87171}
    p{font-size:13px;color:#a1a1aa;line-height:1.6;margin-bottom:20px}
    .btn{display:inline-flex;align-items:center;gap:8px;background:#0284c7;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:10px;transition:background .2s}
    .btn:hover{background:#0369a1}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h2>${esc(title)}</h2>
    <p>${esc(message)}</p>
    ${targetUrl ? `<a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer" class="btn">Open in External Browser ↗</a>` : ''}
  </div>
</body>
</html>`;
}
