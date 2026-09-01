import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { getSupporterStatus } from '@/utils/supporter';
import { checkRateLimit } from '@/lib/serverGuard';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/me — account flags that were previously exposed on
 * /api/auth/session.
 *
 * Why this exists:
 *   /api/auth/session is fetched automatically on every page load, so anything
 *   in it is readable by any XSS on the page regardless of whether the feature
 *   needs it. Moving these values behind an explicit, purpose-built endpoint
 *   means they are only sent when a component actually asks for them, which
 *   shrinks the passive reconnaissance surface.
 *
 * This is NOT an authorization boundary — every API route re-checks the
 * database. It only reduces information disclosure.
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`user_me:${clientIP}`, 60);
    if (!rateCheck.allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    await connectDB();
    const dbUser = await User.findOne({ email: session.user.email })
      .select('role vault.isConfigured supporter')
      .lean();

    if (!dbUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const isAdminEmail =
      !!process.env.ADMIN_EMAIL && dbUser.email === process.env.ADMIN_EMAIL;

    const supporter = await getSupporterStatus(dbUser.email).catch(() => ({
      isSupporter: false,
      isAdmin: false,
      expiresAt: null,
    }));

    return NextResponse.json({
      success: true,
      role: dbUser.role || (isAdminEmail ? 'admin' : 'user'),
      isAdmin: (dbUser.role || (isAdminEmail ? 'admin' : 'user')) === 'admin',
      vaultConfigured: !!dbUser.vault?.isConfigured,
      isSupporter: !!supporter.isSupporter,
      supporterExpiresAt: supporter.expiresAt || null,
    });
  } catch (error) {
    logger.error('user/me API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
