import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSupporterStatus } from '@/utils/supporter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/supporter — current supporter status + expiry.
 * Source of truth for the UI (the session flag is only a sign-in-time hint).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const status = await getSupporterStatus(session.user.email);
    return NextResponse.json({
      success: true,
      isSupporter: status.isSupporter,
      isAdmin: status.isAdmin,
      expiresAt: status.expiresAt,
      features: ['local-relay', 'turbo-speed', 'auto-cool', 'cross-server-transfer', 'ai-assistant'],
    });
  } catch (error) {
    console.error('Supporter status API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
