import { getToken } from 'next-auth/jwt';
import { randomUUID } from 'crypto';
import { getSupporterStatus, supporterRequiredResponse } from '@/utils/supporter';
import { checkRateLimit } from '@/lib/serverGuard';
import { tokensToRevoke } from '@/lib/relayRevoke';

/**
 * Relay tokens are long-lived by necessity: public/local-relay.js bakes the
 * token into a background service and there is no renewal handshake, so
 * shortening the TTL would silently break every running relay.
 *
 * The TTL is therefore configurable rather than hardcoded, and the security
 * controls are the ones that do not break the product: throttled issuance, a
 * per-user cap, lastUsed tracking, and an auditable inventory.
 *
 * Override with RELAY_TOKEN_TTL_DAYS once a refresh path exists.
 */
const DEFAULT_TTL_DAYS = 365;
function tokenTtlMs() {
  const raw = Number(process.env.RELAY_TOKEN_TTL_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3650) : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/** Issuance cap — stops unbounded token accumulation from a script or a bug. */
const MAX_TOKENS_PER_USER = 10;

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

    // Optional human-readable label so a user can tell their tokens apart in
    // the inventory. Truncated and control characters stripped.
    const label = String(body.label ?? '')
      .replace(/[\r\n\t\x00-\x1f]/g, ' ')
      .trim()
      .slice(0, 60);

    global.__relayTokens = global.__relayTokens || new Map();

    // Clean up expired tokens for this user (but keep active ones)
    const now = Date.now();
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === userId && e.expiresAt < now) {
        global.__relayTokens.delete(t);
      }
    }

    // Enforce the cap by evicting the oldest tokens for this user first.
    const owned = [];
    for (const [t, e] of global.__relayTokens) {
      if (e.userId === userId) owned.push([t, e]);
    }
    if (owned.length >= MAX_TOKENS_PER_USER) {
      owned.sort((a, b) => (a[1].issuedAt || a[1].createdAt || 0) - (b[1].issuedAt || b[1].createdAt || 0));
      const evictCount = owned.length - MAX_TOKENS_PER_USER + 1;
      for (const [t] of owned.slice(0, evictCount)) {
        global.__relayTokens.delete(t);
      }
    }

    const relayToken = randomUUID();
    global.__relayTokens.set(relayToken, {
      userId,
      email: token.email || null, // lets the /relay-ws supporter gate resolve the account
      scope,
      tokenId: relayToken.slice(0, 8), // short handle for GET/DELETE, not a secret
      label: label || null,
      issuedAt: now,
      lastUsed: null,
      expiresAt: now + tokenTtlMs(),
    });

    if (typeof global.__persistRelayTokens === 'function') await global.__persistRelayTokens();
    return Response.json({
      success: true,
      token: relayToken,
      expiresAt: new Date(now + tokenTtlMs()).toISOString(),
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
    const userRelays = global.__activeRelays?.get(userId);

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
      if (e.userId !== userId) continue;
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
