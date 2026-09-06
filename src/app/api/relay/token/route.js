import { getToken } from 'next-auth/jwt';
import { getSupporterStatus, supporterRequiredResponse } from '@/utils/supporter';
import { checkRateLimit } from '@/lib/serverGuard';
import { tokensToRevoke } from '@/lib/relayRevoke';
import { issueRelayToken, persistRelayTokens, sanitizeLabel } from '@/lib/relayTokens';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

/**
 * Issuance lives in lib/relayTokens.js so this endpoint and the device-pairing
 * exchange enforce identical TTL and per-user caps. See that file for why the
 * TTL is long and configurable rather than short.
 */

/** Issuance throttle. Legitimate use is a handful of tokens, not hundreds. */
const ISSUE_RATE_LIMIT = 20;

/**
 * POST /api/relay/token — generate a relay token for the current user
 * Body (optional): { scope: 'relay' | 'agent', label: string }
 *   - 'relay' (Local Relay) requires an active supporter membership
 *   - 'agent' (monitor agent) is free and the default for backward compatibility
 *
 * NOTE: `scope` does not by itself gate Local Relay access. server.js re-checks
 * supporter status on every relay-ws connection regardless of scope, so an
 * 'agent' token cannot be used to reach the relay without membership. Scope is
 * retained for reporting and for agent-sync, which does not require supporter.
 */
export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = token.sub;

    const rateCheck = checkRateLimit(`relay-token:${userId}`, ISSUE_RATE_LIMIT);
    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: `Too many relay tokens requested. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const scope = body.scope === 'relay' ? 'relay' : 'agent';

    if (scope === 'relay') {
      const status = await getSupporterStatus(token.email);
      if (!status.isSupporter) return supporterRequiredResponse('relay');
    }

    const { token: relayToken, expiresAt } = issueRelayToken({
      userId,
      email: token.email || null,
      scope,
      label: sanitizeLabel(body.label),
    });

    await persistRelayTokens();
    return Response.json({
      success: true,
      token: relayToken,
      expiresAt: new Date(expiresAt).toISOString(),
    });
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
    // Relay tokens are keyed by token.sub. Credentials sessions often use the
    // same DB id, but OAuth-linked sessions expose the provider subject in the
    // JWT and the database id in session.user.id. Include both keys so the
    // dashboard status matches the relay lookup used by SSH routes.
    let relayUserIds = [userId];
    try {
      await connectDB(null, true);
      let dbUser = await User.findOne({ googleId: userId }).select('_id googleId').lean();
      if (!dbUser && /^[a-f\d]{24}$/i.test(String(userId))) {
        dbUser = await User.findById(userId).select('_id googleId').lean();
      }
      if (dbUser?._id) relayUserIds.push(String(dbUser._id));
      if (dbUser?.googleId) relayUserIds.push(String(dbUser.googleId));
    } catch (_) {}
    relayUserIds = [...new Set(relayUserIds.filter(Boolean))];
    const userRelays = relayUserIds.map((id) => global.__activeRelays?.get(id)).find(Boolean) || null;

    // Piggyback supporter status on this poll so the UI never needs extra requests
    let supporter = { isSupporter: false, expiresAt: null };
    try {
      const status = await getSupporterStatus(token.email);
      supporter = { isSupporter: status.isSupporter, expiresAt: status.expiresAt };
    } catch (_) {}

    // Token inventory. Lets a user see what credentials exist for their account
    // and when each was last used — a dormant token that suddenly shows activity
    // is the signal that one leaked. The token itself is never returned; only a
    // short non-secret handle that can be passed to DELETE.
    const now = Date.now();
    const tokens = [];
    for (const [t, e] of global.__relayTokens || new Map()) {
      if (!relayUserIds.includes(String(e.userId))) continue;
      if (e.expiresAt < now) continue;
      tokens.push({
        tokenId: e.tokenId || t.slice(0, 8),
        masked: `…${String(t).slice(-4)}`,
        scope: e.scope || 'agent',
        label: e.label || null,
        issuedAt: e.issuedAt ? new Date(e.issuedAt).toISOString() : null,
        lastUsed: e.lastUsed ? new Date(e.lastUsed).toISOString() : null,
        expiresAt: new Date(e.expiresAt).toISOString(),
      });
    }
    tokens.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));

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
      return Response.json({ success: true, connected: relays.length > 0, relays, supporter, tokens });
    }

    const relay = userRelays;
    return Response.json({
      success: true,
      connected: !!relay,
      relays: relay ? [{ relayId: relay.relayName || 'default', connected: true, localPort: relay.localPort, capabilities: relay.capabilities || { ssh: false, sftp: false, docker: false }, relayName: relay.relayName || 'default' }] : [],
      supporter,
      tokens,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/relay/token — revoke tokens and disconnect relays
 * Query params:
 *   - tokenId: revoke ONLY this token (and disconnect whatever is using it)
 *   - relayId: disconnect that relay and revoke only the token it holds
 *   - neither: revoke all tokens and disconnect all relays (revoke-all action)
 *
 * Scoping is not cosmetic. A relay token is a 365-day bearer credential baked
 * into a background service with no renewal handshake, so revoking one
 * silently breaks that relay until a human reinstalls it. `relayId` used to
 * fall through to the unconditional sweep — the Settings "Disconnect this
 * relay" action revoked every token the user owned, on every machine. Revoking
 * the disconnected relay's own token still stops it reconnecting, which was
 * the original rationale, without taking the user's other relays with it.
 *
 * Targeting lives in lib/relayRevoke.js. A scoped request that resolves to
 * nothing revokes nothing rather than everything.
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
    const tokenId = url.searchParams.get('tokenId');

    global.__relayTokens = global.__relayTokens || new Map();
    const userRelays = global.__activeRelays?.get(userId);

    // Which tokens to revoke is decided in lib/relayRevoke.js — see the header
    // there for why a single-relay disconnect must not sweep the inventory.
    const doomed = tokensToRevoke({
      tokens: global.__relayTokens,
      userId,
      tokenId,
      relayId,
      userRelays,
    });
    for (const t of doomed) global.__relayTokens.delete(t);
    const revoked = doomed.length;

    if (userRelays instanceof Map) {
      if (tokenId && !relayId) {
        // A token-specific revocation must not disconnect unrelated relays.
        // Active relay entries carry the short token handle from server.js.
        for (const [targetKey, relay] of userRelays.entries()) {
          if (relay.tokenId !== tokenId) continue;
          try {
            if (relay.ws?.readyState === 1) {
              relay.ws.send(JSON.stringify({ type: 'disconnect', reason: 'Token revoked' }));
              try { relay.ws.close(4000, 'Token revoked'); } catch {}
            }
          } catch {}
          try { relay.netServer?.close(); } catch {}
          userRelays.delete(targetKey);
        }
        if (userRelays.size === 0) global.__activeRelays.delete(userId);
      } else if (relayId) {
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
    return Response.json({
      success: true,
      disconnected: relayId || 'all',
      revokedTokens: revoked,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
