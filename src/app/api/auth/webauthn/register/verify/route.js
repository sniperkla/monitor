import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import {
  completeRegistration,
  consumeChallenge,
  WEBAUTHN_CHALLENGE_COOKIE,
} from '@/lib/webauthn';
import { auditLog } from '@/lib/auditLog';

/**
 * POST /api/auth/webauthn/register/verify
 *
 * Step 2 of adding a passkey. Verifies the attestation the authenticator
 * produced and stores the public key. The private key never leaves the device,
 * so nothing secret is transmitted here.
 */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (!body?.response) {
      return NextResponse.json({ success: false, error: 'Missing attestation response' }, { status: 400 });
    }

    const challengeId = request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
    const record = await consumeChallenge(challengeId, 'register');
    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Registration session expired. Start again.' },
        { status: 400 }
      );
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email }).lean();
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Guard against a challenge minted for one account being redeemed by
    // another: issueChallenge() records the owner, so compare explicitly.
    if (record.userId && String(record.userId) !== String(user._id)) {
      return NextResponse.json({ success: false, error: 'Challenge mismatch' }, { status: 403 });
    }

    const credential = await completeRegistration({
      user,
      response: body.response,
      challenge: record.challenge,
    });

    const res = NextResponse.json({
      success: true,
      message: 'Passkey registered',
      data: { id: String(credential._id), createdAt: credential.createdAt },
    });
    // Single-use challenge cookie — clear it either way.
    res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, '', { path: '/api/auth/webauthn', maxAge: 0 });

    await auditLog({
      req: request,
      action: 'webauthn.register',
      userId: String(user._id),
      userEmail: user.email,
      detail: { credentialId: String(credential._id) },
      status: 'success',
    });

    return res;
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
