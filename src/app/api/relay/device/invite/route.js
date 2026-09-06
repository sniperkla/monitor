import { getToken } from 'next-auth/jwt';
import { getClientIp } from '@/lib/clientIp';
import { getSupporterStatus, supporterRequiredResponse } from '@/utils/supporter';
import { createInvite } from '@/lib/relayPairing';

/**
 * POST /api/relay/device/invite — mint a pre-authorized install code.
 *
 * Used by the Agent Setup Wizard, which installs the server agent over SSH and
 * therefore has no terminal to show the user. The caller is already signed in,
 * so there is nothing to approve — this returns a single-use code the agent
 * exchanges for a token during the install.
 *
 * Stays behind the normal CSRF double-submit check: it mints a credential for
 * the caller's own account, so a cross-site POST must not be able to trigger it.
 *
 * Body: { scope?: 'relay'|'agent', label?: string }
 * → { success: true, claimCode, expiresIn }
 */
export async function POST(request) {
  try {
    const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!session?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));
    const scope = body.scope === 'relay' ? 'relay' : 'agent';

    if (scope === 'relay') {
      const status = await getSupporterStatus(session.email);
      if (!status.isSupporter) return supporterRequiredResponse('relay');
    }

    const result = createInvite({
      userId: session.sub,
      email: session.email || null,
      scope,
      label: body.label,
      client: 'server-agent',
      ip,
    });

    if (result.error) {
      return Response.json({ error: result.error }, { status: 429 });
    }

    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
