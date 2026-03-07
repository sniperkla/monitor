import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { randomUUID } from 'crypto';

const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * POST /api/relay/token — generate a relay token for the current user
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Revoke any existing tokens for this user
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === session.user.id) global.__relayTokens.delete(t);
    }

    const token = randomUUID();
    global.__relayTokens.set(token, {
      userId: session.user.id,
      expiresAt: Date.now() + TOKEN_TTL,
    });

    return Response.json({ success: true, token });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/relay/token — check if relay is currently connected
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const relay = global.__activeRelays?.get(session.user.id);
    return Response.json({
      success: true,
      connected: !!relay,
      localPort: relay?.localPort || null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/relay/token — revoke token and disconnect relay
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Revoke tokens
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === session.user.id) global.__relayTokens.delete(t);
    }

    // Close active relay if present
    const relay = global.__activeRelays?.get(session.user.id);
    if (relay) {
      try { relay.netServer?.close(); } catch {}
      global.__activeRelays.delete(session.user.id);
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
