import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { buildRegistrationOptions, issueChallenge, WEBAUTHN_CHALLENGE_COOKIE, challengeCookieOptions } from '@/lib/webauthn';

/**
 * POST /api/auth/webauthn/register/options
 *
 * Step 1 of adding a passkey to an existing account. Requires a session —
 * this endpoint can never be used to create an account, only to attach a
 * credential to one that already exists.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email }).lean();
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const { id, challenge } = await issueChallenge('register', String(user._id));
    const { options } = await buildRegistrationOptions(user, challenge);

    // The challenge itself is returned to the browser (it is public); the
    // *expected* value is remembered server-side via this cookie's id.
    const res = NextResponse.json({ success: true, data: options });
    res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, id, challengeCookieOptions());
    return res;
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
