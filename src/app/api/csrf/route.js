import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { createCsrfToken, csrfCookieOptions, CSRF_COOKIE } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

/**
 * GET /api/csrf — mint a CSRF token for the current session.
 *
 * Returns the token in the body AND sets it as a JS-readable cookie. The
 * client reads the cookie (or this response) and echoes the value back in the
 * `x-csrf-token` header on every state-changing request.
 *
 * Works for signed-out users too (token is bound to "anon"), so the client can
 * bootstrap before the session has finished loading.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const userId = session?.user?.id || null;

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
