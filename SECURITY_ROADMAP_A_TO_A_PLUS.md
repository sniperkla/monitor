# Roadmap: A- → A → A+

> 2026-09-05. Directly answers "how do we get to A or A+".
> Current position: **A- on the application-code side** (see
> `SECURITY_AUDIT_REVIEW_2026-09-05.md`). The remaining gap is one line of code plus
> operational work, not a rewrite.

---

## Where the doc's own ladder actually puts us

The hardening doc defines the tiers. Scored against the code today:

| Tier | Doc's requirement | Status |
|---|---|---|
| **B+** | CSRF HttpOnly + rate limiting on mutating endpoints | ✅ (rate limiting real; CSRF HttpOnly **correctly refused** — see below) |
| **A-** | Hardened CSP + security headers + RBAC + audit logging | ✅ |
| **A** | PKCE OAuth + API key scoping + dependency automation + Cloudflare WAF | 🟡 2 done, 2 outstanding |
| **A+** | External pentest + threat modelling + incident response | 🟡 2 done today, 1 outstanding |

Two notes on the ladder itself, because it is not a neutral instrument:

- The **B+ `monitor_csrf` HttpOnly** item is wrong for this app. Double-submit CSRF
  requires JavaScript to read the cookie; making it HttpOnly removes the protection.
  Do not buy that tier at the cost of real security.
- The **A- "hardened CSP"** item is also mis-specified (it targets `style-src`, which
  Next.js needs). The meaningful CSP work is elsewhere.

---

## To reach A — two items

### A1. Enable OAuth PKCE · **one line, needs a live test**

`src/lib/auth.js:89` — `GoogleProvider` sets only `clientId`/`clientSecret`, so NextAuth
v4 defaults to `checks: ['state']`. One-time state is already enforced; PKCE is not.

```js
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  httpOptions: { timeout: 10000 },
  checks: ['pkce', 'state'],   // ← the change
})
```

**Owner: you.** I have deliberately not applied this. It changes the live Google sign-in
flow, and I cannot test it without real OAuth credentials — if it is wrong, nobody can
log in with Google. The change is trivial; the verification is not, so it should be made
by someone who can click through a real login immediately after deploying.

### A2. Cloudflare WAF rules · **infrastructure**

Not reachable from this repo. Concrete spec to apply:

- **Managed rulesets:** Cloudflare OWASP Core Ruleset → on, paranoia level medium.
  Covers SQLi, XSS, and path traversal generically.
- **Custom rule — protect the auth surface:** `(http.request.uri.path contains "/api/auth/")`
  → Managed Challenge. Cheap, and it sits in front of the credential-stuffing path.
- **Rate limiting rule:** `/api/auth/*` → 10 requests / 5 min / IP → block for 15 min.
  Defence in depth behind the app's own user-id-keyed limiter.
- **Bot Management / Super Bot Fight Mode** → on.
- **Custom rule — `/api/admin/*`:** if you expose admin endpoints publicly, geo-restrict
  or put them behind Access. Otherwise delete this line and ignore.
- **`Security → Bots → AI Scrapers`** → block, if you care about the bandwidth.

**Owner: you** (needs Cloudflare dashboard access). Reversible in one click, no code.

### Already satisfied for A

- **API key scoping** — scopes, prefix, `keyHash`, `expiresAt`, `lastUsedAt`. Done.
- **Dependency automation** — done today:
  - `.github/workflows/ci.yml` now runs `npm audit --audit-level=high` as its own job,
    **plus a weekly cron sweep** so CVEs disclosed while the repo is idle are caught.
  - `.github/dependabot.yml` patches npm weekly and GitHub Actions monthly, grouped so
    a framework bump is one PR rather than twelve.

---

## To reach A+ — three items

### A+1. Threat model · **done**

`THREAT_MODEL.md`, written from the code. It ranks the real risks, and it disagrees with
the hardening doc about where the risk actually is (see "the uncomfortable part" below).

### A+2. Incident response plan · **drafted, needs your input**

`INCIDENT_RESPONSE.md` has severities, five runbooks, and evidence handling. Two things
only you can fill in:

- Named on-call / escalation contacts.
- A **rehearsed** `ENCRYPTION_KEY` rotation. Run R1 step 1 against a database copy
  before an incident makes you do it live. Rotation is the action every S1 runbook
  depends on, and it is currently untested.

### A+3. Independent external pentest · **needs a third party**

I cannot do this one. What I can do is make it cheaper and more useful:

- Hand the tester `THREAT_MODEL.md` — they will spend less time on orientation and more
  on the parts that matter.
- Scope it at the three real risks, not a generic OWASP sweep:
  1. The Local Relay Web UI tunnel (T5) — plaintext loopback, gateway may run open.
  2. Auth/session handling and the missing step-up re-auth before destructive ops (T3).
  3. Multi-tenant isolation: can user A reach user B's connections or servers?
- Fix T2 (MongoDB auth) **before** the pentest. Otherwise they will find it in the first
  hour, the report will lead with it, and you will pay for an hour of the obvious.

---

## The uncomfortable part

The doc's A+ is "pentest + threat model + IR plan". Those are process artefacts. Having
now written two of them, the honest conclusion is:

> The top three risks are **not** in the hardening doc's list at all, and none of them
> is fixed by another header, another lint rule, or another process document.

| Risk | What it takes |
|---|---|
| **T2** MongoDB unauthenticated | TLS + SCRAM auth + network isolation. Deployment config. |
| **T1** `ENCRYPTION_KEY` custody | Secrets manager or KMS; a rotation runbook that has been rehearsed. |
| **T5** Open loopback Web UI tunnel | Set `tokenIssueSecret` on the agent gateway; bind the relay tunnel with a single-use token. |

Chasing the letter of the A+ checklist while those three sit open would produce a folder
of documents and no reduction in risk. Do them in that order: **T2, then T1, then T5.**
Then the checklist items are worth having.

---

## Suggested order of work

1. MongoDB auth + network isolation (T2) — highest ratio of risk removed to effort.
2. Cloudflare WAF (A2) — a dashboard afternoon, no code.
3. OAuth PKCE (A1) — one line, deploy alongside someone who can test a Google login.
4. Rehearse key rotation on a DB copy (feeds A+2 and every S1 runbook).
5. Fill in IR contacts (A+2).
6. Commission the pentest **after** 1–5 (A+3).
7. Then, if you want the last of it: drop `unsafe-eval` from the production CSP (T11),
   and add step-up re-authentication before destructive operations (T3).
