import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import {
  buildAuthenticationOptions,
  issueChallenge,
  WEBAUTHN_CHALLENGE_COOKIE,
  challengeCookieOptions,
} from '@/lib/webauthn';

/**
 * POST /api/auth/webauthn/authenticate/options
 *
 * Step 1 of passkey login. Deliberately reachable while signed out — that is
 * the entire point of the flow. It leaks nothing useful: the options contain a
 * random challenge and no user-specific data, because we intentionally omit
 * `allowCredentials` so the browser can offer any discoverable credential
 * without the user having to identify themselves first.
 */
export async function POST() {
  try {
    await connectDB(process.env.MONGODB_URI, true);

    const { id, challenge } = await issueChallenge('authenticate', null);
    const options = await buildAuthenticationOptions(challenge);

    const res = NextResponse.json({ success: true, data: options });
    res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, id, challengeCookieOptions());
    return res;
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
