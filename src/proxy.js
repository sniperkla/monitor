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
import {
  rateLimit,
  ruleForPath,
  bucketKey,
  getClientIp,
  isRateLimitExempt,
  RATE_LIMIT_DISABLED,
} from "@/lib/ratelimit";

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
// Cross-origin isolation headers
// ---------------------------------------------------------------------------
//
// next.config.mjs also emits these, but `headers()` is compiled into
// .next/routes-manifest.json at build time AND it is not applied at all to
// responses the middleware produces itself (the 401 and the sign-in redirect
// below). So a middleware-generated response has to set them explicitly or it
// ships bare — and the sign-in page is exactly where credentials get typed.
//
// COOP is 'same-origin-allow-popups' rather than 'same-origin' because the
// Google Drive and rclone OAuth flows return their result through
// window.opener.postMessage(); plain 'same-origin' severs that link.
const CROSS_ORIGIN_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Embedder-Policy":
    process.env.COEP === "unsafe-none" ? "unsafe-none" : "credentialless",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
};

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
 *  - `connect-src` no longer allows bare `https:` / `ws:` / `wss:` (which let
 *    injected script exfiltrate to ANY host). Only same-origin, the user's own
 *    local relay, and the one external API the browser calls directly.
 *
 * Two directives are deliberately left open. Both are flagged by scanners, so
 * the reasoning is spelled out rather than left implicit:
 *
 *  - 'wasm-unsafe-eval' (script-src): src/utils/clientCrypto.js derives the
 *    vault key with Argon2id via hash-wasm (see deriveKeyFromPassword and
 *    hashMasterPassword). Chrome refuses to instantiate WebAssembly without
 *    this token, so dropping it breaks vault unlock outright. Note it permits
 *    WASM compilation only — it does NOT re-enable eval() or new Function(),
 *    and no application input reaches the WASM pipeline (the Argon2id inputs
 *    are a password and a server-issued salt). Removing it requires moving
 *    key derivation off WASM, e.g. to a native SubtleCrypto-based KDF.
 *
 *  - 'unsafe-inline' (style-src): the UI renders several dozen <style> blocks,
 *    both styled-jsx (`<style jsx global>` in the onboarding flows) and plain
 *    template-literal ones, alongside React's inline `style={{}}` props. CSP3
 *    governs element styles via style-src-elem and attribute styles via
 *    style-src-attr, and BOTH fall back to style-src — so removing this token
 *    would strip the styling of essentially every screen. A nonce would not
 *    help: browsers ignore 'unsafe-inline' once a nonce is present, and
 *    neither styled-jsx nor React's style prop receives this nonce. A real fix
 *    means migrating inline styles to nonced stylesheets / CSS classes.
 *
 *    Residual risk is limited: CSS injection can exfiltrate data through
 *    attribute selectors (e.g. input[value^="a"] { background: url(...) }) but
 *    cannot execute script. The script-src nonce is the control that matters.
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
    // 'unsafe-inline' is unavoidable here — see the style-src note above.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://images.unsplash.com https://ui-avatars.com https://avatars.githubusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // The browser auto-detects the local relay by fetching
    // http://127.0.0.1:48923. This is a localhost-only connection — the
    // relay runs on the user's own machine, not a remote host — so it
    // cannot be used for SSRF or data exfiltration to an external server.
    //
    // However, if a client-side XSS is ever found, an attacker could use
    // this CSP entry to probe which ports are open on the victim's machine.
    // To eliminate even that residual risk, the localhost relay entry is
    // excluded from production builds unless explicitly enabled via
    // CSP_ALLOW_LOCAL_RELAY=1. In development it is always included so the
    // relay auto-detection feature works out of the box.
    `connect-src 'self' blob: data: https://api.ipify.org${!isProd || process.env.CSP_ALLOW_LOCAL_RELAY === '1' ? ' http://127.0.0.1:48923' : ''}${process.env.CSP_LOCAL_RELAY ? ` ${process.env.CSP_LOCAL_RELAY}` : ''} http://127.0.0.1:18790 http://localhost:18790`,
    // File preview renders documents in a data:/blob: iframe. 'self' is
    // required for the agent Web UI embedded browser (AIAgentsApp), which frames
    // the same-origin /api/agents/webui-proxy route. Local Relay WebUI
    // gateways (http://127.0.0.1:<port>) serve agent UIs on the user's own
    // machine in direct-transfer mode. When frame-src is present it does NOT
    // fall back to default-src, so a list without 'self' blocks every
    // same-origin iframe with "This content is blocked. Contact the site
    // owner to fix the issue." in Chromium.
    "frame-src 'self' blob: data: http://127.0.0.1:* http://localhost:*",
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

/**
 * API routes that deliberately manage their own authentication and must stay
 * reachable while signed out. Passkey login is the obvious case: the whole
 * point of the flow is to authenticate a user who has no session yet.
 *
 * They still receive CSP, rate limiting and CSRF — only the session gate is
 * skipped. Each handler performs its own verification.
 */
const SELF_AUTHENTICATING_PATHS = new Set([
  "/api/auth/webauthn/authenticate/options",
  "/api/auth/webauthn/authenticate/verify",
]);

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

function isSelfAuthenticating(pathname) {
  return SELF_AUTHENTICATING_PATHS.has(pathname);
}

/**
 * Account-lifecycle endpoints that must work BEFORE a session exists.
 *
 * Registration, password reset and email verification are the front door: the
 * caller cannot have a session yet, by definition. They used to skip the
 * middleware entirely while the matcher excluded all of /api/auth; narrowing
 * that exclusion to the NextAuth framework routes left them behind the session
 * gate, which answered 401 for every one of them — no signups, no password
 * resets, and every verification link in every email dead.
 *
 * They still receive CSP, rate limiting and CSRF (register and
 * forgot-password sit in deliberately tight rate-limit buckets). Only the
 * session gate is skipped; each handler validates its own input.
 */
const PRE_AUTH_PATHS = new Set([
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
]);

function isPreAuthPath(pathname) {
  return PRE_AUTH_PATHS.has(pathname);
}

/**
 * Direct deployment triggers have two supported callers:
 *
 * - a signed-in user invoking the route from the UI (cookie + CSRF), and
 * - an external deploy hook carrying `token` or `webhook_token` in the URL.
 *
 * The latter cannot carry a browser CSRF token and intentionally has no
 * session. The route performs its own timing-safe credential validation before
 * starting a deployment. We still run this middleware path so the request gets
 * CSP and the rest of the normal response handling.
 */
/**
 * Routes permitted to authenticate with a scoped API key instead of a session
 * cookie.
 *
 * This is an allowlist, and a deliberately short one, because the direction of
 * failure here is the opposite of rate limiting. Rate limiting is enforced
 * centrally, so a new route is protected by default. Authentication cannot be:
 * verifying a key needs the database, which the middleware does not have, so
 * all it can do is *defer* verification to the route. Deferring for a route
 * that then forgets to verify would be an authentication bypass.
 *
 * Therefore: every pattern added here must correspond to a handler that calls
 * requireApiAuth() from @/lib/apiAuth as its first statement.
 */
const API_KEY_ROUTES = [
  /^\/api\/connections(\/|$)/,
];

function hasApiKeyCredential(req) {
  if (req.headers.get("x-api-key")) return true;
  const auth = req.headers.get("authorization");
  return !!auth && /^Bearer\s+/i.test(auth);
}

function isApiKeyRoute(pathname) {
  return API_KEY_ROUTES.some((re) => re.test(pathname));
}

/** Short, non-reversible bucket id for a key-authenticated caller. */
async function credentialBucketId(raw) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return `key:${hex}`;
  } catch {
    return "key:unknown";
  }
}

function isExternalDeployTrigger(req) {
  if (req.nextUrl.pathname !== "/api/deploy/trigger") return false;
  return ["token", "webhook_token"].some((key) => {
    const value = req.nextUrl.searchParams.get(key);
    return typeof value === "string" && value.length > 0 && value.length <= 4096;
  });
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
  const externalDeployTrigger = isExternalDeployTrigger(req);
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

  // A scoped API key is a credential too, but the middleware cannot validate it
  // (no database). Two things happen here and the real check happens later:
  //   1. The auth gate is deferred for allowlisted routes only — the route MUST
  //      call requireApiAuth(), which does the actual verification.
  //   2. The rate-limit bucket is keyed on a hash of the credential rather than
  //      the IP, so a key holder rotating source addresses does not get a fresh
  //      bucket each time.
  const apiKeyDeferred =
    !authToken && hasApiKeyCredential(req) && isApiKeyRoute(pathname);

  if (apiKeyDeferred) {
    const raw =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";
    userId = await credentialBucketId(raw);
  }

  // -----------------------------------------------------------------------
  // Rate limiting — state-changing API requests
  // -----------------------------------------------------------------------
  //
  // Enforced here rather than inside each handler for two reasons:
  //   1. Coverage. ~104 of ~150 routes mutate state. Central enforcement means
  //      a newly added route is limited by default instead of shipping bare.
  //   2. Cost. Rejecting before the auth gate and before route code means a
  //      flood never reaches mongoose or the SSH layer.
  //
  // Only unsafe methods are limited. Read endpoints are deliberately left
  // alone: this app polls (log streaming, server monitor, connection status)
  // and an IP-wide read cap would lock out every user behind one NAT.
  let rateLimitInfo = null;
  if (
    UNSAFE_METHODS.has(req.method) &&
    pathname.startsWith("/api/") &&
    !isRateLimitExempt(pathname) &&
    !RATE_LIMIT_DISABLED
  ) {
    const rule = ruleForPath(pathname);
    const result = await rateLimit(
      bucketKey({ userId, ip: getClientIp(req), rule, pathname }),
      rule
    );
    rateLimitInfo = result;

    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil(result.reset / 1000));
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[ratelimit] rejected ${req.method} ${pathname} (${result.source}, key user:${userId || "anon"})`
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: "Too many requests. Please slow down and try again shortly.",
        },
        {
          status: 429,
          headers: {
            "Content-Security-Policy": csp,
            ...CROSS_ORIGIN_HEADERS,
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(retryAfter),
          },
        }
      );
    }
  }

  // Public pages skip the auth gate but still receive every security header.
  // For protected requests, enforce auth explicitly. The previous
  // `authorized` callback returned a Response object, which NextAuth treats as
  // truthy; that could let an unauthenticated request fall through to CSRF and
  // receive 403 instead of the documented 401 / sign-in redirect.
  const skipsSessionGate =
    isPublicPath(pathname) ||
    isSelfAuthenticating(pathname) ||
    isPreAuthPath(pathname);

  if (!skipsSessionGate && !authToken && !externalDeployTrigger && !apiKeyDeferred) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: {
        "Content-Security-Policy": csp,
        ...CROSS_ORIGIN_HEADERS,
      } });
    }

    const signInUrl = new URL("/api/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    const redirect = NextResponse.redirect(signInUrl);
    redirect.headers.set("Content-Security-Policy", csp);
    for (const [key, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
      redirect.headers.set(key, value);
    }
    return redirect;
  }

  // -----------------------------------------------------------------------
  // CSRF enforcement — state-changing API requests only
  // -----------------------------------------------------------------------
  if (
    UNSAFE_METHODS.has(req.method) &&
    pathname.startsWith("/api/") &&
    !isCsrfExemptPath(pathname) &&
    !externalDeployTrigger
  ) {
    // Defense-in-depth: If the browser provides an Origin header on mutating requests,
    // ensure it matches this origin or configured allowlist.
    const origin = req.headers.get("origin");
    if (origin) {
      const allowedOrigins = new Set([req.nextUrl.origin]);
      if (process.env.NEXTAUTH_URL) {
        try { allowedOrigins.add(new URL(process.env.NEXTAUTH_URL).origin); } catch {}
      }
      if (process.env.AUTH_URL) {
        try { allowedOrigins.add(new URL(process.env.AUTH_URL).origin); } catch {}
      }
      if (!allowedOrigins.has(origin)) {
        return NextResponse.json(
          { success: false, error: "Cross-origin request forbidden" },
          { status: 403, headers: { "Content-Security-Policy": csp, ...CROSS_ORIGIN_HEADERS } }
        );
      }
    }
  }

  if (
    UNSAFE_METHODS.has(req.method) &&
    pathname.startsWith("/api/") &&
    !isCsrfExemptPath(pathname) &&
    !hasNonCookieCredential(req) &&
    !externalDeployTrigger
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

  // Surface the bucket state so clients can back off before being rejected.
  if (rateLimitInfo) {
    response.headers.set("X-RateLimit-Limit", String(rateLimitInfo.limit));
    response.headers.set("X-RateLimit-Remaining", String(rateLimitInfo.remaining));
    response.headers.set(
      "X-RateLimit-Reset",
      String(Math.max(0, Math.ceil(rateLimitInfo.reset / 1000)))
    );
  }

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
    //
    // settings/database and deploy/trigger are intentionally NOT excluded:
    // both now receive the middleware auth gate, CSP, and CSRF. External deploy
    // hooks with a signed token/webhook_token are handled by the narrow
    // isExternalDeployTrigger() exception above, then validated in-route.
    "/((?!api/auth/signin|api/auth/callback|api/auth/session|api/auth/signout|api/auth/csrf|api/auth/providers|api/csrf|api/health|api/deploy/webhook|api/agents/webui-proxy|_next/static|_next/image|favicon.ico|manifest\\.json|icon\\.svg|sw\\.js|monitor-agent\\.min\\.js|monitor-agent\\.js|local-relay\\.min\\.js|local-relay\\.js|agents/.*).*)"
  ],
};
