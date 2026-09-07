import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  createCsrfToken,
  verifyCsrfToken,
  csrfCookieOptions,
  CSRF_COOKIE,
} from '@/lib/csrf';
import { checkRateLimit, getClientIp } from '@/lib/authRateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/csrf — mint a CSRF token for the current session.
 *
 * Returns the token in the body AND sets it as an HttpOnly cookie. The client
 * caches the body token and echoes it back in the `x-csrf-token` header on
 * every state-changing request; it never reads the cookie (it can't — HttpOnly).
 *
 * Works for signed-out users too (token is bound to "anon"), so the client can
 * bootstrap before the session has finished loading.
 */
export async function GET(request) {
  try {
    // Rate limit BEFORE doing any work: unauthenticated token bootstrap is
    // free request volume plus Set-Cookie churn. Shares the 'csrf' bucket
    // with the NextAuth /api/auth/csrf route (same limiter, same window).
    const gate = checkRateLimit('csrf', getClientIp(request));
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many CSRF token requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(gate.retryAfterSec),
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const session = await getServerSession(authOptions).catch(() => null);
    const userId = session?.user?.id || null;

    // Idempotent bootstrap: if the cookie already carries a token that is
    // valid for the current user, hand THAT one back instead of minting a new
    // random token. Minting on every call would invalidate the token another
    // open tab just cached, making each tab thrash 403 → refresh → mint again
    // in a race. With an HttpOnly cookie this endpoint is the only way the
    // client can (re)learn the token, so it must not churn it.
    const existing = request?.cookies?.get(CSRF_COOKIE)?.value || null;
    if (existing && (await verifyCsrfToken(existing, userId))) {
      const res = NextResponse.json(
        { success: true, csrfToken: existing },
        { headers: { 'Cache-Control': 'no-store' } }
      );
      // Re-set with current attributes so flag changes propagate on the next
      // response without invalidating anything.
      res.cookies.set(CSRF_COOKIE, existing, csrfCookieOptions());
      return res;
    }

    const token = await createCsrfToken(userId);
    if (!token) {
      // Misconfiguration, not an attack — no fallback token is ever minted.
      return NextResponse.json(
        { success: false, error: 'CSRF secret not configured' },
        { status: 500 }
      );
    }

    const res = NextResponse.json(
      { success: true, csrfToken: token },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    res.cookies.set(CSRF_COOKIE, token, csrfCookieOptions());
    return res;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
