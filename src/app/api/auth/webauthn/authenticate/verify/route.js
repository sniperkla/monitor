import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import {
  completeAuthentication,
  consumeChallenge,
  issueLoginTicket,
  WEBAUTHN_CHALLENGE_COOKIE,
} from '@/lib/webauthn';
import { checkLoginAllowed } from '@/lib/loginRateLimit';
import { auditLog } from '@/lib/auditLog';
import { getClientIp } from '@/lib/ratelimit';

/**
 * POST /api/auth/webauthn/authenticate/verify
 *
 * Step 2 of passkey login. Verifies the assertion and, on success, returns a
 * single-use ticket that the client exchanges for a real NextAuth session by
 * calling signIn('webauthn', { ticket }).
 *
 * The indirection exists because NextAuth v4 only mints sessions from inside a
 * provider's authorize(). We cannot create a session from an arbitrary route,
 * so we hand back a short-lived proof that authorize() can redeem.
 *
 * Passkeys are still subject to the same login throttle as passwords. They are
 * far less abusable (an attacker cannot guess a signature), but the endpoint
 * would otherwise be an unthrottled oracle for "is this credential id valid".
 */
export async function POST(request) {
  const ip = getClientIp(request);

  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.response) {
      return NextResponse.json({ success: false, error: 'Missing assertion' }, { status: 400 });
    }

    const challengeId = request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
    const record = await consumeChallenge(challengeId, 'authenticate');
    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Login session expired. Try again.' },
        { status: 400 }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);

    const { userId } = await completeAuthentication({
      response: body.response,
      challenge: record.challenge,
    });

    const user = await User.findById(userId).lean();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
    }

    // Same per-identity throttle the password path uses, so a locked-out
    // account cannot be reached by switching to its passkey.
    const gate = await checkLoginAllowed({ email: user.email, ip });
    if (!gate.allowed) {
      await auditLog({
        req: request,
        action: 'auth.login.blocked',
        userId: String(user._id),
        userEmail: user.email,
        detail: { method: 'webauthn', reason: gate.reason, ip },
        status: 'failure',
      });
      return NextResponse.json(
        { success: false, error: `Account temporarily locked. Try again in ${gate.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    const ticket = await issueLoginTicket(user._id);

    await auditLog({
      req: request,
      action: 'auth.login.success',
      userId: String(user._id),
      userEmail: user.email,
      detail: { method: 'webauthn', ip },
      status: 'success',
    });

    const res = NextResponse.json({
      success: true,
      // Short-lived, single-use. The client must exchange it immediately.
      data: { ticket, expiresInMs: 60_000 },
    });
    res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/api/auth/webauthn', maxAge: 0 });
    return res;
  } catch (error) {
    // Do not distinguish "unknown credential" from "bad signature" — that
    // difference is exactly what turns an endpoint into an enumeration oracle.
    await auditLog({
      req: request,
      action: 'auth.login.failure',
      detail: { method: 'webauthn', reason: 'verification_failed', ip },
      status: 'failure',
    }).catch(() => {});

    return NextResponse.json(
      { success: false, error: 'Passkey sign-in failed' },
      { status: 401 }
    );
  }
}
