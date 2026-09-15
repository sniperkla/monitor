/**
 * Read the OpenClaw gateway token from a remote host.
 *
 * WHY THIS EXISTS
 * ---------------
 * OpenClaw's Control UI gates its WebSocket handshake on a shared gateway
 * secret. With none configured, every connect fails and the UI renders
 *
 *   This Gateway expects its token
 *   … paste the token from `openclaw gateway auth-token --show` into Gateway secret
 *
 * which is a dead end for a user driving the dashboard through the monitor: the
 * secret lives on the gateway host and there is nothing on this side to paste.
 *
 * Measured on fc-fedora40 (2026-09-14), with the gateway configured by
 * `openclaw doctor --fix --generate-gateway-token`:
 *
 *   - the Control UI persists what you paste in **sessionStorage**, not
 *     localStorage, under a per-gateway key:
 *
 *       openclaw.control.token.v1:ws://<host>/api/agents/webui-proxy/m2/<cid>/<port>
 *
 *     (localStorage holds only `openclaw.control.settings.v1:<gw>` — gatewayUrl,
 *     theme, nav width — plus a bootRecord whose `credential` is a truncated
 *     fingerprint. Seeding either of those does nothing: the connect frame goes
 *     out with no `auth` object at all.)
 *   - because it is sessionStorage, the secret is per-TAB. That is why the
 *     prompt comes back on every new tab even after a successful login.
 *
 * So the proxy can hand it over by seeding that one key before the bundle boots.
 * Reading it back is the only hard part:
 *
 *   - `openclaw gateway auth-token --show` refuses to print outside an
 *     interactive terminal, so it is unusable from an SSH exec channel.
 *   - `openclaw config get gateway.auth.token` prints `__OPENCLAW_REDACTED__`.
 *   - the value IS in ~/.openclaw/openclaw.json in plaintext — the gateway's own
 *     `openclaw doctor --json` warns about exactly that
 *     ("openclaw.json contains plaintext secret-bearing config fields …
 *     Paths: gateway.auth.token").
 *
 * Hence a direct file read over SSH, which is the same thing the nanobot route
 * does for its bootstrap secret.
 *
 * WHY IT ALSO REPORTS *ABSENCE* (measured 2026-09-15, fresh install)
 * ------------------------------------------------------------------
 * A fresh `openclaw` install ships with NO gateway credential at all:
 *
 *   ~/.openclaw/openclaw.json   → {"gateway":{"mode":"local","bind":"loopback"}}
 *   openclaw dashboard --json   → "tokenIncluded": false
 *   openclaw gateway auth-token --show
 *     → "No configured Gateway token is available. Run `openclaw doctor
 *        --generate-gateway-token`, restart the Gateway, then try again."
 *
 * With nothing configured, *no* secret can match — the gateway rejects `none`
 * as `token_missing` and anything presented as `token_mismatch`. Reading the
 * config therefore yields '', and the seed writes nothing… which left the tab's
 * previously-seeded key in place. Because the Control UI auto-fills its
 * "Gateway secret" field from that key on every load, the user saw a secret
 * appear by itself, clicked Connect, and got
 *
 *   unauthorized: gateway token mismatch (open the dashboard URL and paste the
 *   token in Control UI settings)
 *
 * forever — a *stale* secret failing as a mismatch, which hides the real cause
 * (nothing is configured on the host). Hence `auth`, and hence the injected
 * script's ability to retract a seed it knows is its own.
 */

import { execCommand } from '@/app/api/server-backup/_ssh';

/**
 * Remote shell command. Prints two lines:
 *
 *   OCTOKEN_AUTH=<configured|unset|unknown>
 *   OCTOKEN=<token-or-empty>
 *
 * python3 reads it because the config is JSON, and a regex over JSON is one bad
 * key away from returning the wrong secret — which is not hypothetical: the
 * obvious awk fallback ("the first `"token"` after `"gateway"`") in fact matches
 * `"mode": "token"` and hands back the literal string `token`. A wrong value
 * fails authentication just as loudly as no value, but with a *mismatch* error
 * that hides the real cause, so there is deliberately no fallback here. If
 * python3 is missing the command yields '' and the user gets the token prompt,
 * which is the pre-existing behaviour. (The box ships python3; the zeroclaw
 * route already depends on it for its cfgPy scripts.)
 *
 * The AUTH line exists because "we read no token" and "there is no token to
 * read" are different facts and need different handling — see
 * `parseOpenClawTokenAuth`. `unset` is only claimed when the config file parsed
 * AND carries no truthy `gateway.auth` at all; a file we could not parse (or
 * read) is `unknown`, never `unset`.
 */
export const OPENCLAW_TOKEN_CMD = `F="$HOME/.openclaw/openclaw.json"; if [ -f "$F" ]; then python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print('OCTOKEN_AUTH=unknown')
    print('OCTOKEN=')
    sys.exit(0)
a = (d.get('gateway') or {}).get('auth')
if not isinstance(a, dict) or not any(v for v in a.values()):
    print('OCTOKEN_AUTH=unset')
    print('OCTOKEN=')
else:
    print('OCTOKEN_AUTH=configured')
    print('OCTOKEN=%s' % ((a.get('token') or ''),))
" "$F" 2>/dev/null || { echo "OCTOKEN_AUTH=unknown"; echo "OCTOKEN="; }; else echo "OCTOKEN_AUTH=unknown"; echo "OCTOKEN="; fi`;

/**
 * Pull the token out of the command's stdout. Pure, so it can be tested without
 * a host. Returns '' when nothing usable was printed.
 *
 * Anchored to a line start: `OCTOKEN_AUTH=…` must never be mistaken for a token
 * line (`OCTOKEN_AUTH=` does not contain `OCTOKEN=`, but pinning the anchor
 * keeps that true by construction rather than by inspection).
 */
export function parseOpenClawToken(stdout) {
  const m = String(stdout || '').match(/^OCTOKEN=(.*)$/m);
  if (!m) return '';
  const token = m[1].trim();
  // Guard against a shell that echoed the marker without a value, and against
  // the redaction placeholder leaking in from a CLI-based reader.
  if (!token || token === '__OPENCLAW_REDACTED__') return '';
  return token;
}

/**
 * Whether the gateway has *any* credential configured, from the same stdout.
 *
 *   'configured' — `gateway.auth` carries at least one truthy value
 *   'unset'      — the config parsed and `gateway.auth` is missing or empty, so
 *                  no secret can match. The gateway itself says so: "No
 *                  configured Gateway token is available. Run `openclaw doctor
 *                  --generate-gateway-token`".
 *   'unknown'    — anything else (no file, no python3, unparseable JSON, exec
 *                  error). Never assume `unset` here: the caller *destroys*
 *                  state on `unset`, and guessing wrong would throw away a
 *                  credential that was in fact valid.
 */
export function parseOpenClawTokenAuth(stdout) {
  const m = String(stdout || '').match(/^OCTOKEN_AUTH=(\w+)$/m);
  const v = m ? m[1] : '';
  return v === 'configured' || v === 'unset' ? v : 'unknown';
}

/**
 * The sessionStorage key the Control UI reads its gateway secret from.
 *
 * Kept here (not inline in the injected script) so the shape is pinned by a
 * test: getting this string wrong is a silent no-op — the UI simply shows the
 * prompt as if nothing had been injected.
 *
 * The injected script needs the PREFIX rather than a whole key, because the
 * gateway URL it has to concatenate is only known in the browser (it embeds
 * location.host).
 */
export const OPENCLAW_TOKEN_KEY_PREFIX = 'openclaw.control.token.v1:';

export function openClawTokenStorageKey(gatewayUrl) {
  return `${OPENCLAW_TOKEN_KEY_PREFIX}${gatewayUrl}`;
}

/**
 * Our own bookkeeping key, holding the value WE last seeded into the UI's key.
 *
 * It exists so a seed can be retracted safely. When the gateway turns out to
 * have no credential configured, a secret this proxy injected earlier is
 * provably dead and must not be left in the tab (the UI auto-fills its
 * "Gateway secret" field from it, so the user gets a phantom mismatch instead
 * of the honest prompt).
 *
 * The marker is what distinguishes the one case we must not touch — the
 * operator pasted over our seed, so the marker and the stored value disagree —
 * from the two we retract: our seed unchanged, and a value with no marker at
 * all (which is what a seed written by the version before markers existed looks
 * like; with no credential on the host it cannot authenticate either way).
 *
 * Namespaced under the UI's own prefix so it reads as related, but suffixed
 * with our own name: no version of the Control UI looks at it.
 */
export const OPENCLAW_SEED_MARK_PREFIX = 'openclaw.control.monitorSeed.v1:';

export function openClawSeedMarkKey(gatewayUrl) {
  return `${OPENCLAW_SEED_MARK_PREFIX}${gatewayUrl}`;
}

const TTL_MS = 30_000;
const cache = new Map(); // connectionId -> { token, auth, at }

/** Test seam. */
export function clearOpenClawTokenCache() {
  cache.clear();
}

/**
 * Read the gateway credential state for a connection, memoised briefly.
 *
 * Returns `{ token, auth }` — see `parseOpenClawTokenAuth` for what `auth`
 * means and why the caller needs it.
 *
 * The TTL exists because the document path can be hit repeatedly (reloads,
 * opening several tabs) and each miss costs a remote exec. It is short on
 * purpose: if the operator regenerates the token, a stale value would be
 * injected for at most TTL_MS and then self-correct.
 */
export async function readOpenClawGatewayToken(sshConfig, connectionId, { exec = execCommand, ttlMs = TTL_MS } = {}) {
  const key = String(connectionId || '');
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return { token: hit.token, auth: hit.auth };

  let token = '';
  let auth = 'unknown';
  try {
    const r = await exec(sshConfig, OPENCLAW_TOKEN_CMD, { pool: true, timeoutMs: 15000 });
    token = parseOpenClawToken(r?.stdout);
    auth = parseOpenClawTokenAuth(r?.stdout);
  } catch {
    // A gateway we cannot read is not an error worth failing the page over —
    // the user just gets the token prompt, which is the pre-existing behaviour.
    token = '';
    auth = 'unknown';
  }
  cache.set(key, { token, auth, at: now });
  return { token, auth };
}
