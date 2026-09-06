import { randomUUID } from 'crypto';

/**
 * Single source of truth for relay token issuance.
 *
 * Extracted from /api/relay/token so the device-pairing flow and the legacy
 * token endpoint cannot drift. Drift here is a security bug, not a cosmetic
 * one: if one issuance path enforces the per-user cap and the other does not,
 * the unenforced path is an unbounded credential faucet.
 *
 * Relay tokens are long-lived by necessity: public/local-relay.js bakes the
 * token into a background service and there is no renewal handshake, so
 * shortening the TTL would silently break every running relay. The TTL is
 * therefore configurable rather than hardcoded, and the controls that do not
 * break the product are the ones we enforce: throttled issuance, a per-user
 * cap, lastUsed tracking, and an auditable inventory.
 *
 * Override with RELAY_TOKEN_TTL_DAYS once a refresh path exists.
 */

export const DEFAULT_TTL_DAYS = 365;

/** Issuance cap — stops unbounded token accumulation from a script or a bug. */
export const MAX_TOKENS_PER_USER = 10;

export function tokenTtlMs() {
  const raw = Number(process.env.RELAY_TOKEN_TTL_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3650) : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/** Control characters stripped so a label cannot forge log or header lines. */
export function sanitizeLabel(label) {
  return String(label ?? '')
    .replace(/[\r\n\t\x00-\x1f]/g, ' ')
    .trim()
    .slice(0, 60);
}

function tokenStore() {
  global.__relayTokens = global.__relayTokens || new Map();
  return global.__relayTokens;
}

/**
 * Mint a relay token for a user, evicting the oldest token if they are at cap.
 *
 * Evicting the oldest is deliberate: it keeps a runaway script from
 * accumulating credentials indefinitely, and an evicted relay fails loudly
 * (the user just reinstalls) rather than silently degrading.
 *
 * @param {object}  args
 * @param {string}  args.userId
 * @param {string|null} [args.email]  lets the /relay-ws supporter gate resolve the account
 * @param {'relay'|'agent'} [args.scope]
 * @param {string|null} [args.label]  human-readable, sanitized here
 * @param {string|null} [args.pairingId]  device enrollment this token came from, for audit
 * @returns {{ token: string, expiresAt: number, entry: object }}
 */
export function issueRelayToken({ userId, email = null, scope = 'agent', label = null, pairingId = null }) {
  const tokens = tokenStore();
  const now = Date.now();

  // Clean up expired tokens for this user (but keep active ones).
  for (const [t, e] of tokens) {
    if (e.userId === userId && e.expiresAt < now) tokens.delete(t);
  }

  // Enforce the cap by evicting the oldest tokens for this user first.
  const owned = [];
  for (const [t, e] of tokens) {
    if (e.userId === userId) owned.push([t, e]);
  }
  if (owned.length >= MAX_TOKENS_PER_USER) {
    owned.sort(
      (a, b) => (a[1].issuedAt || a[1].createdAt || 0) - (b[1].issuedAt || b[1].createdAt || 0)
    );
    const evictCount = owned.length - MAX_TOKENS_PER_USER + 1;
    for (const [t] of owned.slice(0, evictCount)) tokens.delete(t);
  }

  const token = randomUUID();
  const expiresAt = now + tokenTtlMs();
  const entry = {
    userId,
    email: email || null,
    scope,
    tokenId: token.slice(0, 8), // short handle for GET/DELETE, not a secret
    label: sanitizeLabel(label) || null,
    issuedAt: now,
    lastUsed: null,
    expiresAt,
    // Provenance. Lets the inventory distinguish "pasted by hand" from
    // "installed via pairing" — a token minted by a device flow with no
    // pairingId is the interesting one.
    ...(pairingId ? { pairingId } : {}),
  };
  tokens.set(token, entry);

  return { token, expiresAt, entry };
}

/**
 * Drop a token from the live store.
 *
 * Exists for rollback: if a caller mints a token and then fails to persist it,
 * the credential is live in memory but unrecorded — invisible to the inventory
 * and to revocation, and it would survive until the next restart. Callers must
 * be able to undo their own mint.
 */
export function revokeRelayToken(token) {
  if (!token) return false;
  return tokenStore().delete(token);
}

/** Persist to disk if the running server has a persistence hook registered. */
export async function persistRelayTokens() {
  if (typeof global.__persistRelayTokens === 'function') {
    await global.__persistRelayTokens();
  }
}
