import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user/supporter/request — user subscribed on Ko-fi and asks for access.
 * Stored on the User doc as a pending request for the admin to grant.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const email = String(session.user.email).trim().toLowerCase();

    const body = await request.json().catch(() => ({}));
    const kofiName = String(body.kofiName || '').trim().slice(0, 120);
    const kofiEmail = String(body.kofiEmail || '').trim().slice(0, 200);
    const note = String(body.note || '').trim().slice(0, 500);

    if (!kofiName && !kofiEmail) {
      return NextResponse.json({ success: false, error: 'Please provide your Ko-fi name or email.' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
    }

    user.supporter = {
      status: user.supporter?.status || false,
      expiresAt: user.supporter?.expiresAt || null,
      source: user.supporter?.source || 'admin',
      grantedAt: user.supporter?.grantedAt || null,
      grantedBy: user.supporter?.grantedBy || '',
      note: user.supporter?.note || '',
      request: {
        kofiName,
        kofiEmail,
        note,
        requestedAt: new Date(),
        status: 'pending',
      },
    };
    await user.save();

    return NextResponse.json({ success: true, message: 'Request submitted — an admin will review it shortly.' });
  } catch (error) {
    console.error('Supporter request API error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
