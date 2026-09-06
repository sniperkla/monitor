import { getToken } from 'next-auth/jwt';
import { getClientIp } from '@/lib/clientIp';
import { approveEnrollment } from '@/lib/relayPairing';
import { supporterRequiredResponse } from '@/utils/supporter';

/**
 * POST /api/relay/device/approve — step 2 of relay pairing.
 *
 * Requires a signed-in session and stays behind the normal CSRF double-submit
 * check. This is the only step that can bind a device to an account, so it must
 * not be reachable by a cross-site POST — an attacker who could approve their
 * own device code from a victim's browser would own that victim's relay.
 *
 * Body: { userCode: 'K7QP-2M4X' }
 * → { success: true, client, label }
 */
export async function POST(request) {
  try {
    const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!session?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const result = await approveEnrollment({
      userCode: body.userCode,
      userId: session.sub,
      email: session.email || null,
      ip,
    });

    if (!result.ok) {
      if (result.requiresSupporter) return supporterRequiredResponse('relay');
      const status = result.error === 'Too many attempts for that code. Start the setup again.'
        ? 429
        : 400;
      return Response.json({ error: result.error }, { status });
    }

    return Response.json({
      success: true,
      client: result.entry.client,
      label: result.entry.label,
      scope: result.entry.scope,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
