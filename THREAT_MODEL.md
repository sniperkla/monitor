# Threat Model — monitor.eaqdragon.com

> Derived from the code, not from a template. Every asset and boundary below was
> read out of this repository.
> Last updated: 2026-09-05

---

## 1. What we are actually protecting

The instinct is to say "the database". It isn't. **The monitored servers are the
crown jewels.** This application holds live SSH credentials and a working shell on
every host a user has connected. A full compromise does not leak rows — it hands an
attacker root on machines the user owns. Every control below is judged against that.

| # | Asset | Where it lives | Blast radius if lost |
|---|---|---|---|
| A1 | SSH credentials for monitored servers | MongoDB, encrypted `iv:ciphertext` | **Total** — root on every connected host |
| A2 | Live SSH sessions | `server.js` connection pool | **Total** |
| A3 | Monitor session cookie | Browser, NextAuth JWT (HttpOnly+Secure) | High — inherits A1 for that user |
| A4 | MongoDB | `MONGODB_URI` | **Total, all users** — also lets attacker edit audit trail |
| A5 | `ENCRYPTION_KEY` / `NEXTAUTH_SECRET` | `.env`, or shell env | **Total** — decrypts A1 for every user |
| A6 | Vault secrets | Client-side, Argon2id → AES-256-GCM | High — but server never sees the key |
| A7 | Local Relay tokens | MongoDB `systemsettings.relay_tokens` | High — tunnels to that user's agents |
| A8 | API keys | Hashed (`keyHash`), prefix shown once | Medium — scoped + expiring |
| A9 | R2 backup objects | Cloudflare R2 | High — full server backups |
| A10 | Agent (nanobot) config / bootstrap secret | Remote host | Medium — agent takeover |

---

## 2. Trust boundaries

```
      ┌────────────┐   B1   ┌──────────────┐   B3   ┌──────────────────┐
      │  Browser   │───────▶│   Monitor    │───────▶│  Target server   │
      └─────┬──────┘ HTTPS  │  (Next.js +  │  SSH   │  (user's box —   │
            │               │  socket.io)  │        │   the prize)     │
            │  B6           └──┬───┬───┬───┘        └──────────────────┘
            │ 127.0.0.1:       │   │   │
            │ 18790-99         │B2 │B4 │B7/B8
            ▼                  ▼   ▼   ▼          ▼
      ┌────────────┐      ┌────────┐ ┌──────┐ ┌─────────────────────┐
      │Local Relay │◀────▶│MongoDB │ │Relay │ │Google / Upstash /   │
      │ (user's    │  B5  └────────┘ └──────┘ │R2 / GitHub / ipify  │
      │  machine)  │─SSH─▶ agent gateway       └─────────────────────┘
      └────────────┘
```

| ID | Boundary | Existing controls |
|---|---|---|
| B1 | Browser → Monitor | HTTPS, HSTS+preload, CSP with per-request nonce, double-submit CSRF (HMAC-bound to user id), session cookie HttpOnly+Secure+SameSite, `X-Frame-Options: DENY`, rate limiting keyed on user id |
| B2 | Monitor → MongoDB | **Nothing in dev** (unauthenticated loopback). Prod needs TLS + auth. |
| B3 | Monitor → target server | SSH with the user's own credentials; ownership scoped by `session.user.id` |
| B4 | Monitor → Local Relay | WebSocket + per-user token; relay registrations keyed on JWT `sub` |
| B5 | Local Relay → agent gateway | SSH tunnel opened by the relay on the user's machine |
| B6 | Browser → `127.0.0.1:18790–18799` | **Effectively nothing.** See T5. |
| B7 | Monitor → Google OAuth | NextAuth; `state` enforced, **PKCE not enabled** |
| B8 | Monitor → third-party APIs | TLS; HMAC-verified deploy webhooks |

---

## 3. Threats, ranked

### T1 — `ENCRYPTION_KEY` compromise → every SSH credential · **Critical**

One symmetric key decrypts A1 for every user. Key is `sha256(ENCRYPTION_KEY || NEXTAUTH_SECRET)`.
Aggravating factors found in the code:

- A shell-exported `ENCRYPTION_KEY` **overrides** `.env` (`server.js`), so the effective
  key may not be the one in the file you're auditing.
- There is no rotation runbook in the repo. `ENCRYPTION_KEY_OLD` exists as a decrypt
  fallback, which is the right primitive, but nothing drives rotation.
- `.env` is gitignored (verified: `.gitignore:34`) — good — but it sits plaintext on disk.

**Residual risk: high.** Mitigations that would move this: move the key into a KMS/HSM
or at minimum a secrets manager with audit; document and rehearse a rotation; consider
per-user key wrapping so a single key no longer decrypts the whole table.

### T2 — MongoDB reachable unauthenticated · **Critical**

Dev URI is unauthenticated loopback, which is fine for a laptop and catastrophic in
production. If Mongo is reachable, an attacker does not need to break crypto at all —
they can read `connections` and then use the app's own decryption path, or simply set
`role: 'admin'` on their own user and skip the hard part.

**Status: OPEN for production.** Requires TLS + SCRAM auth + network restriction to the
app host only. Not fixable from inside this repo — it is deployment configuration.

### T3 — Session hijack → full inheritance of A1 · **High**

Controls in place are reasonable: HttpOnly+Secure+SameSite, MFA support, WebAuthn with
clone detection, audit logging on login, login throttling shared between password and
passkey paths.

Residual: there is **no step-up re-authentication** before the genuinely destructive
operations (delete connection, uninstall agent, run remote command). A stolen cookie
is therefore sufficient, not just necessary.

### T4 — Malicious agent/skill content · **High**

Skill install writes attacker-influenced content to disk under a per-user namespace.
Rate limited to 10/min, which throttles volume but does not inspect content. There is
no scanning or provenance check on what gets installed.

### T5 — The Local Relay Web UI tunnel is an open loopback port · **High**

This one is real and easy to miss. The relay serves the agent gateway at plaintext
`http://127.0.0.1:18790–18799`. Consequences:

- **Any** process on the user's machine can reach it — it is not authenticated to the
  browser that requested it.
- The gateway itself may be running *open*. Verified on `fc-debian-isolt`: neither
  `tokenIssueSecret` nor `token` is set, so `/webui/bootstrap` returns **200 even with a
  bogus `X-Nanobot-Auth`**. The bootstrap secret in the URL is decoration in that state.
- The tunnel lives only in memory and is not re-pushed on relay reconnect, so it is
  short-lived — the one mitigating factor.

**Status: OPEN.** The honest fix is for the agent gateway to require auth (set
`tokenIssueSecret`) and for the relay to bind with a single-use token in the URL path.

### T6 — Audit log tampering · **Medium-High**

`src/lib/auditLog.js` writes to the same MongoDB an attacker with T2 would own. The log
is therefore evidence the attacker can edit. It records auth events, connection changes,
key operations and admin actions (28 route files).

**Status: OPEN.** Needs append-only enforcement (a capped collection helps) and/or
shipping to an external sink the app cannot write to.

### T7 — Secrets in audit logs · **Medium** → **FIXED 2026-09-05**

The rule was "never log request bodies containing passwords, tokens, or secrets" — but
the module only enforced *size*, not content. `sanitizeDetail()` stored any string
verbatim, so a caller passing `{ password: '...' }` wrote it to the audit collection in
plaintext. That makes the audit trail a credential store: the collection an attacker
with DB read targets first, and the one an operator trusts most.

Now enforced in `src/lib/auditLog.js`: values under secret-looking keys are replaced
with `[redacted]`, matched as a substring so `tokenIssueSecret`, `userApiKey` and
`sshPassword` are all caught. Nested values are scrubbed inside the serialised snapshot
too. Field *names* (`fields: 'password,privateKey'`, which the decrypt route logs
deliberately) and IPs survive — over-redaction would gut the trail's forensic value.

Verified: 18/18 cases against the shipped source, including that `ip`, `action`,
`skillName` and `connectionId` are **not** redacted.

### T8 — Relay token theft · **Medium**

Tokens live in `systemsettings.relay_tokens`; several exist per user. A stolen token
lets an attacker register as that user's relay and receive tunnel requests. No expiry
or rotation observed.

### T9 — IP-based rate limiting behind a proxy · **Medium**

Unauthenticated requests fall back to IP. Behind Cloudflare + nginx that is only correct
if `TRUSTED_PROXY_HOPS` matches reality. `src/lib/clientIp.js` documents both a
spoofable default and an off-by-one that previously selected an attacker-controlled
entry — both fixed, but the value must be right for the deployment.

### T10 — OAuth without PKCE · **Medium**

`GoogleProvider` sets only clientId/secret → NextAuth defaults to `checks: ['state']`.
One-time state is enforced; PKCE is not. Authorization-code interception risk.

### T11 — `unsafe-eval` in CSP `script-src` · **Low** — already handled

Flagged here in an earlier draft and then found to be a non-issue: `buildCsp()` already
gates it. Production emits `script-src 'self' 'nonce-…' 'wasm-unsafe-eval'`; the
`unsafe-inline`/`unsafe-eval` pair is added **only** when `NODE_ENV !== 'production'`
(`src/proxy.js:128-131`). You see it on a dev server, not in prod.

`wasm-unsafe-eval` stays in both because the client-side vault does Argon2id through
hash-wasm — removing it breaks vault unlock, not just a theoretical script path.

### T12 — npm supply chain · **Low**, now actively managed

Was 4 advisories (2 high). Now 0, gated by `npm audit --audit-level=high` in CI with a
weekly sweep, and patched automatically by Dependabot.

### T13 — Plaintext secrets in a cacheable response · **Medium** → **FIXED 2026-09-05**

`POST /api/utils/decrypt` is the one response in the whole app whose body is a plaintext
SSH private key or password. It was returned with no `Cache-Control` at all, so a shared
cache — corporate proxy, browser disk cache, CDN — was free to persist it. Every other
route's worst case from being cached is stale data; this one's is a live credential on
someone else's disk.

The route itself was already well built (field allowlist, `iv:hex` shape validation,
10/min per-user limit, audited with field names only). Only the response header was
missing. Now `no-store, no-cache, must-revalidate, private` plus `Pragma: no-cache`.

Verified end-to-end: encrypt a throwaway value → decrypt → HTTP 200 with the header
present and the plaintext correct.

---

## 4. Already remediated (recorded so nobody re-opens them)

- **`installPath` RCE** — path traversal / command injection via the install path.
- **`test-uri` SSRF**, including the URL-encoded bypass variant.
- **Rate limiting absent on mutating endpoints** — never was; it is enforced centrally
  in `src/proxy.js` (Upstash sliding window, memory fallback, keyed on user id).
- **Missing audit logging / RBAC / SRI** — all present or N/A (no third-party scripts).

---

## 5. Where this leaves us

The application-code controls are in decent shape. The three things that actually stand
between an attacker and root on your servers are, in order:

1. **MongoDB authentication and network isolation** (T2) — infrastructure.
2. **`ENCRYPTION_KEY` custody and rotation** (T1) — operational.
3. **The open loopback Web UI tunnel** (T5) — a design gap in the relay path.

None of the three is fixed by another header or another lint rule. That is the honest
answer to "what would actually make us safer".
