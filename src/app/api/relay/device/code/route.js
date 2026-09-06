import { getClientIp } from '@/lib/clientIp';
import { createEnrollment } from '@/lib/relayPairing';

/**
 * POST /api/relay/device/code — step 1 of relay pairing.
 *
 * Called by the agent (local-relay.js --pair / monitor-agent.js --pair) with no
 * credentials at all. It is deliberately CSRF-exempt: the caller is a CLI that
 * has never seen a cookie. That is safe here because this endpoint mints
 * nothing — the returned device code is inert until a signed-in user approves
 * the matching short code in Settings.
 *
 * Body: { client?: 'local-relay' | 'server-agent', label?: string, scope?: 'relay' | 'agent' }
 * → { deviceCode, userCode, expiresIn, interval }
 */
export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const result = createEnrollment({
      client: body.client,
      label: body.label,
      scope: body.scope === 'relay' ? 'relay' : 'agent',
      ip,
    });

    if (result.error) {
      return Response.json({ error: result.error }, { status: 429 });
    }

    return Response.json({
      success: true,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      expiresIn: result.expiresIn,
      interval: result.interval,
      instructions: 'Enter this code in Settings > Local Relay to approve this device.',
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
