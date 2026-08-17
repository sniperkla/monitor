import { getToken } from 'next-auth/jwt';
import { randomUUID } from 'crypto';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';

const TOKEN_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year — relay is a permanent background service
const RELAY_TOKENS_DB_KEY = 'relay_tokens';

/**
 * POST /api/relay/token — generate a relay token for the current user
 */
export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub;

    global.__relayTokens = global.__relayTokens || new Map();

    const relayToken = randomUUID();
    const entry = {
      userId,
      expiresAt: Date.now() + TOKEN_TTL,
    };

    global.__relayTokens.set(relayToken, entry);

    // Save directly to MongoDB so tokens survive rebuilds & multi-process setups
    try {
      await connectDB();
      const existing = await SystemSetting.findOne({ key: RELAY_TOKENS_DB_KEY });
      const tokensObj = existing?.value || {};
      // Purge expired tokens
      const now = Date.now();
      const cleaned = {};
      for (const [k, v] of Object.entries(tokensObj)) {
        if (v && v.expiresAt > now) cleaned[k] = v;
      }
      cleaned[relayToken] = entry;
      await SystemSetting.findOneAndUpdate(
        { key: RELAY_TOKENS_DB_KEY },
        { $set: { value: cleaned } },
        { upsert: true }
      );
    } catch (dbErr) {
      console.warn('⚠️ [Relay] Could not persist token to MongoDB in API route:', dbErr.message);
    }

    if (typeof global.__persistRelayTokens === 'function') {
      try { await global.__persistRelayTokens(); } catch {}
    }

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
    const userRelays = global.__activeRelays?.get(userId);

    if (userRelays instanceof Map) {
      const relays = [];
      for (const [relayId, relay] of userRelays) {
        relays.push({
          relayId,
          connected: true,
          localPort: relay.localPort,
          capabilities: relay.capabilities || { ssh: false, sftp: false, docker: false },
          relayName: relay.relayName || relayId,
        });
      }
      return Response.json({ success: true, connected: relays.length > 0, relays });
    }

    const relay = userRelays;
    return Response.json({
      success: true,
      connected: !!relay,
      relays: relay ? [{ relayId: relay.relayName || 'default', connected: true, localPort: relay.localPort, capabilities: relay.capabilities || { ssh: false, sftp: false, docker: false }, relayName: relay.relayName || 'default' }] : [],
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/relay/token — revoke token and disconnect relay
 * Query params:
 *   - relayId: disconnect only this relay (keep token for others)
 *   - no relayId: revoke all tokens and disconnect all relays
 */
export async function DELETE(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub;
    const url = new URL(request.url);
    const relayId = url.searchParams.get('relayId');

    // Always revoke tokens for this user so auto-restarting background processes are rejected
    global.__relayTokens = global.__relayTokens || new Map();
    for (const [t, e] of global.__relayTokens.entries()) {
      if (e.userId === userId) global.__relayTokens.delete(t);
    }

    const userRelays = global.__activeRelays?.get(userId);
    if (userRelays instanceof Map) {
      if (relayId) {
        let targetKey = relayId;
        let relay = userRelays.get(relayId);
        if (!relay) {
          for (const [key, r] of userRelays.entries()) {
            if (key === relayId || r.relayId === relayId || r.relayName === relayId) {
              relay = r;
              targetKey = key;
              break;
            }
          }
        }
        if (relay) {
          try {
            if (relay.ws?.readyState === 1) {
              relay.ws.send(JSON.stringify({ type: 'disconnect', reason: 'Disconnected by user' }));
              try { relay.ws.close(4000, 'Disconnected by user'); } catch {}
            }
          } catch {}
          try { relay.netServer?.close(); } catch {}
          userRelays.delete(targetKey);
          if (userRelays.size === 0) global.__activeRelays.delete(userId);
        }
      } else {
        for (const [rid, relay] of userRelays.entries()) {
          try {
            if (relay.ws?.readyState === 1) {
              relay.ws.send(JSON.stringify({ type: 'disconnect', reason: 'Token revoked' }));
              try { relay.ws.close(4000, 'Token revoked'); } catch {}
            }
          } catch {}
          try { relay.netServer?.close(); } catch {}
        }
        global.__activeRelays.delete(userId);
      }
    }

    if (typeof global.__persistRelayTokens === 'function') await global.__persistRelayTokens();
    return Response.json({ success: true, disconnected: relayId || 'all' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
