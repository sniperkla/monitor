import { getToken } from 'next-auth/jwt';
import { randomUUID } from 'crypto';

const TOKEN_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year — relay is a permanent background service

/**
 * POST /api/relay/token — generate a relay token for the current user
 */
export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub; // Google's stable OAuth sub — no DB call needed

    // Revoke any existing tokens for this user
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === userId) global.__relayTokens.delete(t);
    }

    const relayToken = randomUUID();
    global.__relayTokens.set(relayToken, {
      userId,
      expiresAt: Date.now() + TOKEN_TTL,
    });

    // Persist tokens to disk so relay survives server restarts
    if (typeof global.__persistRelayTokens === 'function') global.__persistRelayTokens();
    return Response.json({ success: true, token: relayToken });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/relay/token — check if relay is currently connected
 */
export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = token.sub;
    const relay = global.__activeRelays?.get(userId);
    
    return Response.json({
      success: true,
      connected: !!relay,
      localPort: relay?.localPort || null,
      capabilities: relay?.capabilities || { ssh: false, sftp: false, docker: false },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/relay/token — revoke token and disconnect relay
 */
export async function DELETE(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub;

    // Revoke tokens
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === userId) global.__relayTokens.delete(t);
    }

    // Close active relay if present
    const relay = global.__activeRelays?.get(userId);
    if (relay) {
      try { relay.netServer?.close(); } catch {}
      global.__activeRelays.delete(userId);
    }

    if (typeof global.__persistRelayTokens === 'function') global.__persistRelayTokens();
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
