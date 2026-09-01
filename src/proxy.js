import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  createCsrfToken,
  verifyCsrfPair,
  csrfCookieOptions,
  isCsrfEnforced,
  hasNonCookieCredential,
  isCsrfExemptPath,
  UNSAFE_METHODS,
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_ERROR,
} from "@/lib/csrf";

// AI training / scraping bots — blocked hard at the edge (403).
// These bots often ignore robots.txt, so we enforce it in code as well.
const AI_BOT_PATTERNS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "Applebot-Extended",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Diffbot",
  "ImagesiftBot",
  "YouBot",
];

function isAiBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return AI_BOT_PATTERNS.some((bot) => ua.includes(bot.toLowerCase()));
}

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------

/** CSP3 nonce charset: A-Z a-z 0-9 + / _ - with optional trailing padding. */
function generateNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Build the Content-Security-Policy for a request.
 *
 * Hardening vs. the previous policy:
 *  - `script-src` no longer has 'unsafe-eval' (arbitrary JS execution via
 *    eval / new Function) or 'unsafe-inline'. A per-request nonce is used
 *    instead; when a nonce is present browsers ignore 'unsafe-inline'.
 *  - 'wasm-unsafe-eval' is retained deliberately: src/utils/clientCrypto.js
 *    derives keys with Argon2id via hash-wasm, and Chrome refuses to compile
 *    WebAssembly without it. It permits WASM only — not JS eval.
 *  - `connect-src` no longer allows bare `https:` / `ws:` / `wss:` (which let
 *    injected script exfiltrate to ANY host). Only same-origin, the user's own
 *    local relay, and the one external API the browser calls directly.
 */
function buildCsp(nonce) {
  const isProd = process.env.NODE_ENV === "production";

  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`
    : // Dev needs eval/inline for HMR and the React devtools bridge.
      `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`;

  return [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' styles are required by Next.js styled-jsx / inline styles.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://images.unsplash.com https://ui-avatars.com https://avatars.githubusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // The browser only connects to the local relay's discovery endpoint
    // (fetch http://127.0.0.1:48923). The relay's WebSocket runs in the
    // Node relay process — not the browser — so ws://localhost:* was never
    // needed in the browser CSP. Wildcard localhost ports (http://127.0.0.1:*)
    // were removed because, if an XSS is ever found, they let it exfiltrate
    // to any service on the victim's machine. A non-default relay port must
    // be opted in via CSP_LOCAL_RELAY (e.g. "http://127.0.0.1:51234").
    `connect-src 'self' blob: data: https://api.ipify.org http://127.0.0.1:48923${process.env.CSP_LOCAL_RELAY ? ` ${process.env.CSP_LOCAL_RELAY}` : ''}`,
    // File preview renders documents in a data:/blob: iframe.
    "frame-src blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    "block-all-mixed-content",
  ].join("; ");
}

/**
 * Pages that must stay reachable while signed out.
 *
 * The old matcher used `(...|$)` purely to keep the app shell off the auth
 * gate. That also stopped the middleware from running at all, which silently
 * left `/` without a Content-Security-Policy once CSP moved into the
 * middleware. The path is now matched (so it gets a CSP) and simply exempted
 * from the gate instead.
 */
const PUBLIC_PATHS = new Set(["/"]);

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

export default async function wrappedProxy(req) {
  // Hard-block known AI scrapers before anything else runs.
  if (isAiBot(req.headers.get("user-agent"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Generate the nonce up front so EVERY response from this middleware carries
  // the CSP — including the sign-in page and 401s. The login page is exactly
  // where credentials are typed, so it must not be the one response left bare.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  const pathname = req.nextUrl.pathname;
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.ENCRYPTION_KEY;

  // Resolve the session user so both auth and CSRF checks use the same token.
  let userId = null;
  let authToken = null;
  if (secret) {
    try {
      authToken = await getToken({ req, secret });
      userId = authToken?.dbId || authToken?.sub || null;
    } catch {
      authToken = null;
      userId = null;
    }
  }

  // Public pages skip the auth gate but still receive every security header.
  // For protected requests, enforce auth explicitly. The previous
  // `authorized` callback returned a Response object, which NextAuth treats as
  // truthy; that could let an unauthenticated request fall through to CSRF and
  // receive 403 instead of the documented 401 / sign-in redirect.
  if (!isPublicPath(pathname) && !authToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: {
        "Content-Security-Policy": csp,
      } });
    }

    const signInUrl = new URL("/api/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    const redirect = NextResponse.redirect(signInUrl);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  // -----------------------------------------------------------------------
  // CSRF enforcement — state-changing API requests only
  // -----------------------------------------------------------------------
  if (
    UNSAFE_METHODS.has(req.method) &&
    pathname.startsWith("/api/") &&
    !isCsrfExemptPath(pathname) &&
    !hasNonCookieCredential(req)
  ) {
    const headerToken = req.headers.get(CSRF_HEADER);
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value || null;

    const valid = await verifyCsrfPair(headerToken, cookieToken, userId);

    if (!valid) {
      if (isCsrfEnforced()) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[csrf] rejected ${req.method} ${pathname} (cookie:${!!cookieToken} header:${!!headerToken})`
          );
        }
        return NextResponse.json(
          { success: false, error: CSRF_ERROR },
          { status: 403 }
        );
      }
      // CSRF_ENFORCE=false — log and allow (emergency rollback only).
      console.warn(`[csrf] ALLOWED (enforcement off) ${req.method} ${pathname}`);
    }
  }

  // -----------------------------------------------------------------------
  // Response: per-request CSP nonce + CSRF cookie issuance
  // -----------------------------------------------------------------------
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the nonce for its own inline scripts from this request header.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // Mint the CSRF cookie lazily: on first visit, and whenever the existing
  // token no longer matches the current user (login / logout / user switch).
  const existing = req.cookies.get(CSRF_COOKIE)?.value || null;
  if (secret) {
    const stillValid = existing
      ? await verifyCsrfPair(existing, existing, userId)
      : false;
    if (!stillValid) {
      const fresh = await createCsrfToken(userId);
      if (fresh) {
        response.cookies.set(CSRF_COOKIE, fresh, csrfCookieOptions());
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/api/connections/:path*",
    "/api/admin/:path*",
    "/api/user/:path*",
    "/api/wiki/:path*",
    // NOTE: the trailing `$` was removed from this lookahead. It previously
    // excluded `/` from the middleware entirely (to keep the app shell public),
    // which also meant `/` received no security headers. `/` is now matched and
    // exempted from the auth gate via PUBLIC_PATHS instead.
    //
    // The auth gate exclusion is narrowed from `api/auth` to the specific
    // NextAuth framework paths (signin, callback, session, signout, csrf,
    // providers). Custom app routes under /api/auth/ — register,
    // forgot-password, reset-password, verify-email — are NOT excluded, so
    // they now receive both the CSRF check and CSP headers. Previously the
    // broad `api/auth` exclusion let POST /api/auth/register bypass CSRF
    // enforcement entirely.
    "/((?!api/auth/signin|api/auth/callback|api/auth/session|api/auth/signout|api/auth/csrf|api/auth/providers|api/csrf|api/health|api/settings/database|api/deploy/webhook|api/deploy/trigger|_next/static|_next/image|favicon.ico|manifest\\.json|icon\\.svg|sw\\.js|monitor-agent\\.min\\.js|monitor-agent\\.js|local-relay\\.min\\.js|local-relay\\.js|agents/.*).*)"
  ],
};
