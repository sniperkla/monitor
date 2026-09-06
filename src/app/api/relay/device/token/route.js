import { getClientIp } from '@/lib/clientIp';
import { exchangeEnrollment, POLL_INTERVAL_SEC } from '@/lib/relayPairing';

/**
 * POST /api/relay/device/token — step 3 of relay pairing.
 *
 * Polled by the agent until the user approves. CSRF-exempt for the same reason
 * as ./code: the caller is a CLI with no cookie. Its only credential is the
 * 256-bit device code in the request body, which is single-use.
 *
 * Body: { deviceCode }
 * → 200 { token, expiresAt, scope, label }   approved
 * → 202 { status:'pending', expiresIn }      not approved yet
 * → 410 { status:'expired' }                 start over
 */
export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const result = await exchangeEnrollment({ deviceCode: body.deviceCode, ip });

    if (result.status === 'ok') {
      return Response.json({
        success: true,
        token: result.token,
        expiresAt: result.expiresAt,
        scope: result.scope,
        label: result.label,
      });
    }

    if (result.status === 'pending') {
      return Response.json(
        { success: false, status: 'pending', expiresIn: result.expiresIn, interval: POLL_INTERVAL_SEC },
        { status: 202 }
      );
    }

    if (result.status === 'slow_down') {
      return Response.json(
        { success: false, status: 'slow_down', error: result.error },
        { status: 429 }
      );
    }

    // 'expired' and 'invalid' are folded together so a wrong code cannot be
    // distinguished from a dead one.
    return Response.json(
      { success: false, status: result.status, error: result.error },
      { status: 410 }
    );
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
