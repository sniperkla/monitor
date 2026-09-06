/**
 * Server-side session guard for API routes.
 *
 * A group of routes (`/api/rclone/*`) historically had no authentication of
 * their own. They are reached only through the middleware's session gate
 * (`src/proxy.js`), which means they work today — but that makes the matcher a
 * single point of failure: narrowing it even slightly would turn all nine into
 * unauthenticated remote-command endpoints at once.
 *
 * They also call `getSshConfig()`, which resolves the session internally. That
 * is *not* equivalent to an auth check: it only enforces ownership when the
 * connection record has a `userId`, so legacy unowned connections are reachable
 * by anyone who gets past the middleware.
 *
 * This helper restores defence in depth — an explicit, local check that does
 * not depend on where the matcher happens to point.
 *
 * Usage:
 *   import { requireSession } from '@/lib/requireSession';
 *   const { session, error } = await requireSession(req);
 *   if (error) return error;
 *
 * The request is passed so denials can be logged with an IP and user-agent,
 * matching requireAdmin()'s behaviour.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

/**
 * @param {Request} [req] - optional; enables client metadata in the log line.
 * @returns {Promise<{ session: object|null, error: NextResponse|null }>}
 */
export async function requireSession(req) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    // A failure to *reach* the session store is not a login failure. Return
    // 503 rather than 401 so clients can retry instead of bouncing the user
    // to the sign-in page and losing their work.
    console.error('[requireSession] session lookup failed:', err?.message);
    return {
      session: null,
      error: NextResponse.json(
        { success: false, error: 'Session service unavailable — please retry' },
        { status: 503 },
      ),
    };
  }

  if (!session?.user?.id) {
    const ip = req?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
      || req?.headers?.get?.('x-real-ip')
      || 'unknown';
    const ua = (req?.headers?.get?.('user-agent') || '').slice(0, 120);
    console.warn(`[requireSession] unauthenticated request blocked ip=${ip} ua=${ua}`);
    return {
      session: null,
      error: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { session, error: null };
}

export default requireSession;
