import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { sanitizeCallbackUrl } from "@/lib/auth";

const handler = NextAuth(authOptions);

// Rate limiting for signin attempts
const signinAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkSigninRateLimit(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const entry = signinAttempts.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  signinAttempts.set(ip, entry);

  return entry.count <= MAX_ATTEMPTS;
}

/**
 * Sanitize the callbackUrl query parameter BEFORE the request reaches NextAuth.
 *
 * NextAuth's built-in signin page renders callbackUrl as a hidden input in the
 * form. If an attacker sends `?callbackUrl=https://evil.com`, that value is
 * embedded in the HTML. The `redirect` callback later rejects external origins,
 * but we should never let the malicious value reach the rendered form in the
 * first place — defence in depth.
 *
 * For GET requests to the signin page: if callbackUrl is an external URL not
 * on the allowlist, rewrite the request URL so callbackUrl is replaced with
 * '/' (safe relative path).
 */
function sanitizeSigninCallbackUrl(request) {
  const url = new URL(request.url);
  const cb = url.searchParams.get('callbackUrl');
  if (!cb) return request; // nothing to sanitize

  // Allow relative paths (already validated by the redirect callback).
  // Strip protocol-relative and backslash tricks.
  if (cb.startsWith('/') && !cb.startsWith('//') && !cb.startsWith('\\')) {
    return request;
  }

  // Absolute URL — check against the allowlist. If it passes, leave it.
  try {
    const cbOrigin = new URL(cb).origin;
    if (sanitizeCallbackUrl(cb, url.origin)) {
      return request; // same-origin or explicitly allowlisted
    }
  } catch {
    // Malformed URL — fall through to sanitization.
  }

  // External or malformed — replace callbackUrl with '/' so the form's
  // hidden input carries a safe value. NextAuth will redirect to baseUrl
  // after login, which is the app root.
  url.searchParams.set('callbackUrl', '/');
  // Build a fresh Request with the sanitized URL. Preserve method and headers;
  // GET has no body so we don't need to pass it through.
  const sanitizedRequest = new Request(url, {
    method: request.method,
    headers: request.headers,
  });
  return sanitizedRequest;
}

async function rateLimitedHandler(request, context) {
  const url = new URL(request.url);
  const isSigninRequest =
    (request.method === 'POST' && url.pathname.includes('/signin')) ||
    (request.method === 'POST' && url.pathname.includes('/credentials'));

  if (isSigninRequest && !checkSigninRateLimit(request)) {
    return NextResponse.json(
      { error: 'Too many signin attempts. Please try again later.' },
      { status: 429 }
    );
  }

  // Sanitize callbackUrl on GET (form rendering) — prevent the attacker value
  // from being embedded in the hidden input before NextAuth renders the page.
  if (request.method === 'GET' && url.pathname.includes('/signin')) {
    request = sanitizeSigninCallbackUrl(request);
  }

  return handler(request, context);
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST };
