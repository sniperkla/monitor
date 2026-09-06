# Security Audit Review — 2026-09-05

**Scope:** Independent verification of the nanobot-generated
"monitor.eaqdragon.com — Security Hardening Summary"
**Verdict:** **Mostly inaccurate.** 5 of 7 findings are already implemented, and 3 of the
proposed fixes would break the application if applied as written. One finding was valid
and has been fixed.

> Every row below was checked against the source, not taken from the source document.
> File:line references are to the state of the tree at the time of review.

---

## Claims that are ALREADY DONE (do not re-implement)

| Document claim | Reality | Evidence |
|---|---|---|
| Rate limiting on mutating endpoints — **missing** | **Already comprehensive.** Covers every endpoint the doc lists, plus more. | `src/lib/ratelimit.js` `ROUTE_RULES` (L63-103): `/api/connections`, `/api/skills/install`, `/api/user/api-keys`, `/api/server-backup`, `/api/admin`, vault recovery/reset, MFA, `/api/utils/decrypt`, `/api/rclone`, `/api/firewall`, `/api/deploy` |
| Hardened CSP — **weak** | **Already nonce-based.** Prod `script-src` has neither `unsafe-inline` nor `unsafe-eval`. | `src/proxy.js` `buildCsp()` (L125-168) |
| RBAC — **basic (isSupporter only)** | **Role check exists and is enforced.** All 5 admin routes call it. | `src/lib/requireAdmin.js`; `src/app/api/admin/**/route.js` |
| Audit logging — **not implemented** | **Implemented** and used in 28 route files. | `src/lib/auditLog.js`; e.g. `admin/seed-keys/route.js` L61 |
| Subresource Integrity — **not implemented** | **Moot.** There are no third-party `<script>` tags to attribute. | grep across `src/app`, `src/components` |
| Session cookie HttpOnly + Secure | Correct — NextAuth JWT defaults. | `src/lib/auth.js` L466 (`strategy: "jwt"`) |

The rate limiter is also **better than what the document proposes**: it keys on user ID
rather than IP (so rotating IPs buy an attacker nothing) and uses Upstash/Redis with an
in-memory fallback — exactly the design the doc recommends building.

---

## Claims that would BREAK the app — DO NOT APPLY

### 1. `monitor_csrf` → `httpOnly: true` (doc rates this HIGH priority)

**This is the most dangerous recommendation in the document.**

The CSRF implementation is a deliberate **double-submit** design, which *requires* the
cookie to be readable by JavaScript:

- `src/lib/csrf.js` L154 — `/** Cookie attributes. Readable by JS by design (double-submit requires it). */` → `httpOnly: false`
- `src/utils/csrfClient.js` L43 — `getCsrfToken()` reads `document.cookie` on **every** request

Setting `httpOnly: true` means `readCookie()` returns `null`, no `x-csrf-token` header is
sent, and **every POST / PUT / PATCH / DELETE returns 403**. The app stops working entirely.

It also does not deliver the claimed benefit. The doc's threat model is "XSS → steal CSRF
token + session cookie". But:
- An XSS payload can simply call `GET /api/csrf`, which is **CSRF-exempt by design**
  (`src/lib/csrf.js` L61) and returns the token in the **response body** — so it never
  needs to read the cookie.
- XSS already defeats CSRF by definition: the attacker is executing script in the origin
  and can issue authenticated requests directly.

**The existing design is sound:** HMAC-signed (`rand.HMAC(secret, rand + userId)`), bound
to the user ID so tokens cannot be replayed across accounts, verified as both a header/cookie
pair *and* a signature. See the threat model in `src/lib/csrf.js` L4-27.

**Action: none.** If defence-in-depth against token theft is later wanted, the correct
change is to move the client to the `/api/csrf` response body (already returned) instead of
the cookie — a coordinated client+server change, not a one-line flag flip.

### 2. The document's target CSP

The proposed policy omits two directives that are **load-bearing**:

| Omitted | Consequence |
|---|---|
| `frame-src 'self' blob: data: http://127.0.0.1:*` | `frame-src` does not fall back to `default-src`. Every same-origin iframe is blocked — including the agent Web UI (`AIAgentsApp`) and the file preview. |
| `connect-src … http://127.0.0.1:18790` | Breaks Local Relay WebUI reachability probes, forcing permanent fallback to the central proxy. |

The document is also wrong that `style-src 'unsafe-inline'` is an oversight. It is a
**documented, accepted trade-off** (`src/proxy.js` L111-124): under CSP3 both
`style-src-elem` and `style-src-attr` fall back to `style-src`, and neither styled-jsx nor
React's `style={{}}` prop receives the nonce — so removing the token strips the styling of
essentially every screen. Residual risk is limited (CSS injection cannot execute script);
the `script-src` nonce is the control that matters.

Likewise `wasm-unsafe-eval` is required for the Argon2id vault KDF (`src/utils/clientCrypto.js`).

---

## VALID — fixed in this pass

### `X-XSS-Protection` was set to `1; mode=block`

Genuinely deprecated, and the auditor is itself an attack surface (it can be induced to
block legitimate scripts, and its heuristics have leaked data).

**Changed to `0` rather than deleting the header.** Omitting a header is not the same as
disabling a feature: a few older browsers still default the auditor **on**, so removal
leaves them running it. `0` explicitly switches it off. All current Chrome/Edge/Firefox/
Safari builds have removed the auditor, so this is a no-op for them either way.

Set in **two independent places** — they are separate code paths and must stay in sync:

- `server.js` L574 → `res.setHeader('X-XSS-Protection', '0')`
- `next.config.mjs` L33 → `{ key: 'X-XSS-Protection', value: '0' }`

### Permissions-Policy

Added `interest-cohort=()` (blocks FLoC participation) in both of the same two places.

> Note: `scripts/wikiPart4.js` L116 also contains `1; mode=block`, but that is wiki
> *article content* (a sample nginx config), not application configuration. Left as-is.

---

## Open items from the first pass — now RESOLVED (updated later the same day)

### A. `connect-src` localhost inconsistency — FIXED

The relay entry `http://127.0.0.1:48923` was gated
(`!isProd || CSP_ALLOW_LOCAL_RELAY === '1'`), but `http://127.0.0.1:18790` and
`http://localhost:18790` were appended **unconditionally**, including in production.

Fixed in `buildCsp()` (`src/proxy.js`):

- All localhost entries are now gated behind the same `CSP_ALLOW_LOCAL_RELAY=1` flag in
  production, so the default prod posture no longer opens loopback ports. Dev is unchanged.
- The Web UI range is now **18790–18799** for both `127.0.0.1` and `localhost`.

That second part also fixes a functional bug: `handleWebuiForward` walks up one port at a
time on `EADDRINUSE`, so once a second gateway landed on 18791 it was **not** in
`connect-src` and got silently CSP-blocked — breaking the very case the port handshake
(`webui:ready`) was added to support.

The range is enumerated rather than wildcarded on purpose. `http://127.0.0.1:*` would also
work for the app, but would let a client-side XSS probe every port on the victim's machine
— the exact risk the 48923 entry is narrowed to avoid.

> **Operator action:** production deployments that rely on Local Relay direct transfer must
> set `CSP_ALLOW_LOCAL_RELAY=1`. Without it the reachability probe fails closed and the app
> falls back to the central proxy (works, but traffic routes through the server).

### B. `/api/rclone/*` had no per-route auth check — FIXED

Nine routes under `src/app/api/rclone/` relied solely on the middleware matcher. They were
protected, but that made the matcher a single point of failure: narrowing it would have
turned all nine into unauthenticated remote-command endpoints at once.

Added `src/lib/requireSession.js` (modelled on the existing `requireAdmin.js`, including the
IP/user-agent warn log and a 503 rather than 401 when the session *store* is unreachable, so
users aren't bounced to sign-in and don't lose work). Applied to all **16 handlers** across
the nine routes.

Note: `exec/route.js` already had its own `getServerSession` check, so its guard is
redundant — kept anyway for uniformity, and the earlier claim that "none of the rclone
routes authenticate" was inaccurate for that one file.

Verified:

```
unauthenticated: /api/rclone/{status,browse,cron,history,install,kill,oauth,remote,exec} -> 401
authenticated  : /api/rclone/{status,browse,history}                                     -> 200
```

No server errors, no regression for signed-in users.

---

## Verification method

`/tmp/scan-auth.mjs` walks every `src/app/api/**/route.js` and flags handlers with no
authentication signal (`getServerSession`, `requireAdmin`, `x-agent-token`, HMAC
verification, etc.).

- **168** route files scanned
- **23** with no per-route auth signal — all explained: pre-auth account lifecycle
  (register / forgot-password / reset-password / verify-email, listed in `PRE_AUTH_PATHS`),
  `health`, public wiki, the Ko-fi webhook (verifies its own token in constant time), and
  the middleware-gated families.

---

## Corrected rating

The document's own trajectory rates the app **B** and treats CSRF-cookie, rate limiting,
CSP, RBAC and audit logging as outstanding. Since all five are already in place — several
in better form than the document proposes — the app is closer to **A-** on its own scale,
with the remaining gap being the medium-priority items (API key scoping, PKCE, dependency
automation) rather than the "high priority" list.

---

## Later pass — additional checklist items verified

| Doc checklist item | Status | Evidence |
|---|---|---|
| `X-Frame-Options: DENY` | ✅ | live response header |
| `Strict-Transport-Security` | ✅ | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options: nosniff` | ✅ | live response header |
| `Referrer-Policy` | ✅ | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | ✅ | includes `interest-cohort=()` |
| `X-XSS-Protection` removed/neutralised | ✅ | set to `0` (both code paths) |
| Remove `Server` / `X-Powered-By` | ✅ | neither header is emitted |
| `.env` not in repo | ✅ | `.gitignore:34 (.env*)`, and untracked |

**Not applicable / not changed:**

- **SRI** — there are no third-party `<script>` tags to attribute. Nothing to do.
- **MongoDB TLS + auth** — the local dev URI is `mongodb://127.0.0.1:27017/ssh-monitor`
  (loopback, no credentials). Acceptable for a workstation; production must use a
  separate authenticated, TLS-enabled cluster. Worth confirming on the prod host.
- **API key scoping, OAuth PKCE, WebAuthn, Cloudflare WAF, dependency scanning** — real
  work, but each is a feature-sized change well outside a hardening pass. Left for a
  dedicated task.

**Items deliberately NOT done** (documented above under "would BREAK the app"):
`monitor_csrf` HttpOnly, and the document's target CSP (it omits `frame-src` and the
`connect-src` localhost entries, which are load-bearing).

---

## Pass 3 — full-document re-verification (2026-09-05, evening)

Re-read every claim in the hardening doc against current code, including the Medium
and Production Checklist sections that earlier passes only spot-checked. Method and
result below.

### Scoreboard

| Doc item | Doc says | Reality | Action |
|---|---|---|---|
| 1. `monitor_csrf` HttpOnly | HIGH priority, missing | Would break double-submit CSRF | **Refused** (see above) |
| 2. Rate limiting on mutating endpoints | Missing | Already enforced centrally | **No change** |
| 3. Hardened CSP | Weak — `unsafe-inline` in style-src | Misdiagnosed; `style-src` inline is required by Next.js styling | **Refused** |
| 4. Remove `X-XSS-Protection` | Present | Was `1; mode=block` | **Fixed** (now `0`) |
| 5. RBAC | Basic | `role` + `requireAdmin.js` | **No change** |
| 6. Audit logging | Not implemented | `src/lib/auditLog.js`, 28 route files | **No change** |
| 7. Subresource Integrity | Not implemented | **No third-party scripts exist** | **N/A** |
| 8. Security headers | Incomplete | All present, verified live | **No change** |
| 9. API key scoping | Good to have | scopes + prefix + keyHash + `expiresAt` + `lastUsedAt` | **Already done** |
| 10. OAuth PKCE | Enforce it | `state` yes (NextAuth default), **PKCE no** | **Open — see below** |
| 11. Vault crypto | Argon2id + AES-GCM | `clientCrypto.js`: Argon2id (hash-wasm) → AES-256-GCM | **Already done** |
| 12. WebAuthn replay | Test it | Challenges single-use (deleted on read); **sign counter verified** by `@simplewebauthn/server` | **Already done** |
| Dependencies | Run `npm audit` in CI | 4 vulns (2 high) | **Fixed → 0** |

### Rate limiting — the doc is describing a solution that already exists

`src/lib/ratelimit.js` enforces it centrally from `src/proxy.js` (Edge runtime),
Upstash sliding window with in-memory fallback — which is *exactly* what the doc
recommends. Buckets are keyed on **user id when authenticated, IP otherwise**, so a
rotating IP pool buys an attacker nothing. Every endpoint the doc lists is covered,
and tighter than the doc asked for:

```
/api/user/api-keys      20 / 5 min     (doc asked 10/hr for create)
/api/skills/install     10 / 1 min     (doc asked 5/hr)
/api/server-backup      40 / 1 min     (doc asked 10/hr)
/api/connections       120 / 1 min     (doc asked 20/15min)
```

Gotcha that misled a first grep: grepping for `rateLimit` in `src/app/api/**` finds
only ~30 files. Those are *hand-tuned* buckets. The central middleware covers the rest,
so absence from that list does **not** mean unprotected.

### SRI is not applicable, not missing

`src/app/layout.js` loads **zero external scripts** — only Google Fonts
(`preconnect` + one `css2` stylesheet). There is nothing to attach an `integrity`
attribute to. The doc's "not implemented" is a false positive from a generic checklist.

### WebAuthn sign counter — checked, I was wrong at first

`WebAuthnCredential.counter` exists in the model with a comment about clone detection,
and a grep for `counter` across `src/app/api/auth/webauthn/**` returned nothing — which
looks like dead schema. It is not: the logic lives in `src/lib/webauthn.js`, which
passes `counter` into `verifyAuthenticationResponse()` (line 213) and persists
`newCounter` (line 225). `@simplewebauthn/server` performs the comparison internally.
**Clone detection is wired.** (Recorded here because the near-miss is a good argument
for grepping the whole tree, not just the route folder.)

### Dependencies — FIXED, 4 vulns (2 high) → 0

| Package | From → To | Advisory |
|---|---|---|
| `mysql2` (direct) | 3.18.2 → 3.24.3 | GHSA-3f6p-5ww8-9rcr auth-plugin downgrade leaks plaintext creds; GHSA-rgwj-5xj2-c3m3 zlib decompression bomb |
| `browserslist` (transitive) | 4.28.2 → 4.28.9 | Unbounded memory growth; prototype write via untrusted stats file |
| `fflate` (direct, unused in code) | 0.8.2 → 0.8.3 | `unzipSync` infinite loop on malformed ZIP64 |
| `@humanfs/node` (via eslint) | 0.16.7 → 0.16.8 | Recursive copy follows symlinks |

All four were **inside existing semver ranges**, so this was `npm update <pkg>`, not
`npm audit fix` — no manifest edit, `package.json` untouched, only `package-lock.json`
changed. Deliberately avoided a blanket `npm audit fix` to keep churn minimal.

Post-change smoke test: server HTTP 200, eslint 0 errors, `mysql2/promise` loads,
authenticated `/api/rclone/{status,browse,history}` → 200.

### Remaining open item — OAuth PKCE (the only one left from the doc)

`GoogleProvider` is configured with only `clientId`/`clientSecret` (`src/lib/auth.js:89`).
NextAuth v4 defaults that to `checks: ['state']` — so one-time, server-validated state
**is** in place. **PKCE is not.** Enabling it is a one-line addition
(`checks: ['pkce', 'state']`), but it changes the live Google login flow and I cannot
test it here without real OAuth credentials. Shipping an untested change to the only
sign-in path would be a bad trade, so it is **documented, not applied**.

Also still open, unchanged and previously noted: MongoDB TLS + auth for production
(dev URI is unauthenticated loopback); Cloudflare WAF/Bot Management (infra, not code);
no re-push of `webui:forward` on relay reconnect.

### Corrected rating

The doc rates the app **B**, with B+ requiring the CSRF and rate-limit items and A-
requiring CSP + RBAC + audit logging. On the evidence above the app already sits at
**A- on the code side**: everything the doc lists for B+, A- and most of A is either
already implemented or N/A. The gap to A is operational — MongoDB TLS, WAF, and
PKCE — not application code.
