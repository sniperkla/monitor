import NextAuth from "next-auth";
import { authOptions, sanitizeCallbackUrl } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/authRateLimit";
import { NextResponse } from "next/server";

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
 * Validate the callbackUrl query parameter BEFORE the request reaches NextAuth.
 *
 * NextAuth's built-in signin page renders callbackUrl as a hidden input in the
 * form. If an attacker sends `?callbackUrl=https://evil.com`, that value would
 * be embedded in the HTML. Instead of silently rewriting the URL (which can
 * cause 500 errors when NextAuth receives a plain Request instead of a
 * NextRequest), we reject invalid callback values with a clear HTTP 400.
 *
 * Valid callbackUrl values:
 *   - Relative paths starting with a single '/' (e.g. '/', '/dashboard')
 *   - Absolute URLs on the same origin as the request
 *   - Absolute URLs on the explicit allowlist (NEXTAUTH_URL, AUTH_URL,
 *     CALLBACK_URL_ALLOWLIST env vars)
 *
 * @param {Request} request
 * @returns {NextResponse|null} a 400 response if invalid, or null if OK
 */
function validateCallbackUrl(request) {
  const url = new URL(request.url);
  const cb = url.searchParams.get('callbackUrl');
  if (!cb) return null; // no callbackUrl — nothing to validate

  if (sanitizeCallbackUrl(cb, url.origin)) return null;

  // Invalid callbackUrl — return 400 with a clear error message instead of
  // letting NextAuth process a request that will either 500 or redirect
  // somewhere unexpected.
  return NextResponse.json(
    {
      error: 'Invalid callbackUrl. Only same-origin URLs or relative paths are allowed.',
    },
    { status: 400 }
  );
}

async function rateLimitedHandler(request, context) {
  const url = new URL(request.url);
  const isCsrfRequest = url.pathname.endsWith('/api/auth/csrf') && request.method === 'GET';
  if (isCsrfRequest) {
    const gate = checkRateLimit('csrf', getClientIp(request));
    if (!gate.allowed) {
      return NextResponse.json(
        { error: 'Too many CSRF token requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec), 'Cache-Control': 'no-store' } }
      );
    }
  }

  const isSigninRequest =
    (request.method === 'POST' && url.pathname.includes('/signin')) ||
    (request.method === 'POST' && url.pathname.includes('/credentials'));

  if (isSigninRequest && !checkSigninRateLimit(request)) {
    return NextResponse.json(
      { error: 'Too many signin attempts. Please try again later.' },
      { status: 429 }
    );
  }

  // Validate callbackUrl on GET (form rendering) and POST (form submission).
  // Returns 400 for invalid values — no 500, no open redirect, no hidden
  // input carrying an attacker URL.
  const validationError = validateCallbackUrl(request);
  if (validationError) return validationError;

  return handler(request, context);
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST };
