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
 */

import { execCommand } from '@/app/api/server-backup/_ssh';

/**
 * Remote shell command. Prints exactly one line: `OCTOKEN=<token-or-empty>`.
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
 */
export const OPENCLAW_TOKEN_CMD = `F="$HOME/.openclaw/openclaw.json"; T=""; if [ -f "$F" ]; then T=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));a=(d.get('gateway') or {}).get('auth') or {};print(a.get('token') or '')" "$F" 2>/dev/null); fi; printf "OCTOKEN=%s\\n" "$T"`;

/**
 * Pull the token out of the command's stdout. Pure, so it can be tested without
 * a host. Returns '' when nothing usable was printed.
 */
export function parseOpenClawToken(stdout) {
  const m = String(stdout || '').match(/OCTOKEN=(.*)/);
  if (!m) return '';
  const token = m[1].trim();
  // Guard against a shell that echoed the marker without a value, and against
  // the redaction placeholder leaking in from a CLI-based reader.
  if (!token || token === '__OPENCLAW_REDACTED__') return '';
  return token;
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

const TTL_MS = 30_000;
const cache = new Map(); // connectionId -> { token, at }

/** Test seam. */
export function clearOpenClawTokenCache() {
  cache.clear();
}

/**
 * Read the token for a connection, memoised briefly.
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
  if (hit && now - hit.at < ttlMs) return hit.token;

  let token = '';
  try {
    const r = await exec(sshConfig, OPENCLAW_TOKEN_CMD, { pool: true, timeoutMs: 15000 });
    token = parseOpenClawToken(r?.stdout);
  } catch {
    // A gateway we cannot read is not an error worth failing the page over —
    // the user just gets the token prompt, which is the pre-existing behaviour.
    token = '';
  }
  cache.set(key, { token, at: now });
  return token;
}
