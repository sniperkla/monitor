/**
 * Relay token revocation targeting.
 *
 * Extracted from DELETE /api/relay/token so the decision can be unit tested.
 * Everything here is pure — no next-auth, no database, no globals — because the
 * bug it exists to prevent was a data-loss bug that a source-text assertion
 * could not have caught.
 *
 * Why this matters
 * ----------------
 * A relay token is a long-lived bearer credential (365 days by default) that
 * public/local-relay.js bakes into a background service. There is no renewal
 * handshake, so revoking one silently breaks that relay until a human
 * reinstalls it. Revoking all of them at once takes down every relay the user
 * runs on every machine.
 *
 * The Settings UI has two distinct actions:
 *   • "Disconnect this relay"  -> DELETE ?relayId=<id>   (must be scoped)
 *   • "Revoke all relays"      -> DELETE with no params  (sweep is intended)
 *
 * Those must not collapse into the same behaviour.
 */

/**
 * Work out which single token, if any, a revocation should target.
 *
 * @param {object}  args
 * @param {string|null} args.tokenId    explicit token handle from the query string
 * @param {string|null} args.relayId    relay key / relayId / relayName to resolve
 * @param {Map|undefined} args.userRelays  active relays for this user
 * @returns {{ scoped: boolean, targetTokenId: string|null }}
 */
export function resolveRevokeTarget({ tokenId, relayId, userRelays }) {
  let targetTokenId = tokenId || null;

  if (!targetTokenId && relayId && userRelays instanceof Map) {
    for (const [key, relay] of userRelays.entries()) {
      if (
        key === relayId ||
        relay?.relayId === relayId ||
        relay?.relayName === relayId
      ) {
        targetTokenId = relay?.tokenId || null;
        break;
      }
    }
  }

  return { scoped: Boolean(tokenId || relayId), targetTokenId };
}

/**
 * Keys of the tokens a revocation should delete.
 *
 * A scoped request that resolves to nothing revokes nothing. It must not fall
 * back to sweeping the user's whole inventory — that fallback is how
 * "disconnect this one relay" used to revoke every token the user owned.
 *
 * @param {object} args
 * @param {Map}    args.tokens      full token map (token -> entry)
 * @param {string} args.userId      owner to filter by
 * @param {string|null} args.tokenId
 * @param {string|null} args.relayId
 * @param {Map|undefined} args.userRelays
 * @returns {string[]} token keys to delete
 */
export function tokensToRevoke({ tokens, userId, tokenId, relayId, userRelays }) {
  const { scoped, targetTokenId } = resolveRevokeTarget({ tokenId, relayId, userRelays });
  const doomed = [];

  for (const [t, entry] of tokens.entries()) {
    if (entry.userId !== userId) continue;
    if (scoped) {
      if (!targetTokenId) continue;
      if (entry.tokenId !== targetTokenId && t.slice(0, 8) !== targetTokenId) continue;
    }
    doomed.push(t);
  }

  return doomed;
}
