import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { checkGlobalDailyLimit } from '@/lib/globalRateLimit';

/**
 * GET /api/user/rate-limit-status
 *
 * Returns the calling user's current global daily request usage.
 * This route is exempt from the rate limit middleware so the banner
 * can always fetch fresh data even when the user is near their cap.
 *
 * Response shape:
 *   {
 *     success: true,
 *     used: 142,
 *     limit: 2000,
 *     remaining: 1858,
 *     percentage: 7,
 *     resetsInSeconds: 28800,
 *     isAdmin: false
 *   }
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const isAdmin = session.user.role === 'admin';

    // Peek without incrementing (increment = false)
    const status = checkGlobalDailyLimit(session.user.email, false);

    return NextResponse.json(
      {
        success: true,
        used:            isAdmin ? 0          : status.used,
        limit:           status.limit,
        remaining:       isAdmin ? status.limit : status.remaining,
        percentage:      isAdmin ? 0           : status.percentage,
        resetsInSeconds: status.resetsInSeconds,
        isAdmin,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=20',
        },
      }
    );
  } catch (error) {
    console.error('[rate-limit-status]', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
