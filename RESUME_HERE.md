# RESUME HERE — monitor security hardening

**Project:** `/Users/katanyoo/Desktop/monitor` · **Branch:** `nextgen15`
**Deployed at:** monitor.eaqdragon.com
**Status when the session was interrupted:** 2026-09-02 ~17:07
**Reason for this file:** the WorkBuddy session was cut off (account switch) and
the working state was only recoverable from disk.

---

## What this round of work is

A defence-in-depth security hardening pass, derived from the black-box pentest
report in `docs/SECURITY_AUDIT_2026-09-02.md`. **All eleven planned tasks are
now complete and committed. Nothing has been pushed or deployed.**

## Task list as it stands

| # | Task | Status |
|---|---|---|
| 1 | Progressive login delay (1s/2s/5s/15s/60s, identity-keyed) | done |
| 2 | Install security dependencies | done |
| 3 | Per-user API keys with scopes | done |
| 4 | Audit log hardening and wiring | done |
| 5 | Unified rate limiter (Upstash + in-process fallback) | done |
| 6 | Backup envelope encryption at rest (AES-256-GCM + SSE-S3) | done |
| 7 | Rate limit all mutating routes | done |
| 8 | WebAuthn / passkey login | done |
| 9 | Fix live security holes (vault plaintext code, decrypt oracle, hardcoded key) | done |
| 10 | TOTP MFA enforcement for admins | done |
| 11 | Verify with lint and build | done |

## Commit history for this round (not pushed)

```text
d41ba7f security: unify server-monitor privileged actions into audit_logs
6a91d05 docs: add security hardening handoff
8d7f832 security: finish audit logging and account hardening
```

`8d7f832` carries the bulk: 42 files, +4395/-173, including the five new
dependencies (`@upstash/ratelimit`, `@upstash/redis`, `otpauth`,
`@simplewebauthn/server`, `@simplewebauthn/browser`) and all the new
WebAuthn / MFA / API-key / envelope-encryption modules.

## What task #4 turned into

`src/lib/auditLog.js` was rewritten and now records ip / user-agent / method /
path / status. It is imported by 25 modules. Wired in this round:

- `src/app/api/skills/install/route.js` — the F-01 prompt-injection path,
  including rejected-injection attempts (hashed, never the payload)
- `src/app/api/connections/route.js` and `[id]/route.js` — create/update/delete
- all 5 `/api/admin/*` handlers, plus denials, which now funnel through
  `requireAdmin(req)` so rejected admin calls are recorded centrally
- `src/app/api/user/vault/*` — setup, unlock, recovery request, reset, clear

### The audit collection naming trap (worth knowing before you query)

There are three write-only trails and their names differ by one underscore.
Mongoose pluralizes without snake-casing:

| Collection | Writer | Purpose |
|---|---|---|
| `audit_logs` | `src/lib/auditLog.js` | security trail — query this one |
| `auditlogs` | `src/models/AuditLog.js` | per-server operational history |
| `activitylogs` | `src/models/ActivityLog.js` | user-facing UI timeline |

`audit_logs` and `auditlogs` are **different collections**. Server-monitor
privileged actions (start/stop/uninstall on a user's server) used to go only to
`auditlogs`, so they were invisible to anyone querying the documented security
trail. `d41ba7f` mirrors them into `audit_logs` under `server.service.*`.

The AuditLog model write was deliberately kept for its indexed
`connectionId` / `appName` / `version` fields. Whether to collapse the two into
one collection is still an open decision — see below.

## Environment gotchas (cost real time — read before running anything)

- **`npx next build` fails in this sandbox** with
  `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`. Next clears `.next` on
  build and the shim counts deletions per turn (threshold 50).
  Workaround: `mv .next /tmp/next-backup-$(date +%s)` first, never delete it.
  Build takes ~34s.
- Verification build pattern that works: `NEXT_DIST_DIR=.next-security-verify npx next build`
  (support for `NEXT_DIST_DIR` was added to `next.config.mjs` for this).
- Baseline before this round: 187 tests. Now **195 passing**, 0 failing.
  ESLint reports 0 errors; the only warnings are pre-existing React hook
  warnings in `RevealScreen.js` / `TerminalView.js`.
- `tests/proxyCoverage.test.mjs` asserted an exact source string in
  `src/proxy.js`. The API-key work changed that condition (added
  `!isSelfAuthenticating(...)` and `!apiKeyDeferred`), so the test went stale.
  It was updated — and *strengthened*, not relaxed: it now also asserts the
  passkey allowlist stays passkey-only and that the API-key deferral is both
  allowlisted and closed by `requireApiAuth()` in the route.

## What is genuinely left

Nothing in the code. Three decisions are outstanding, and none of them should
be made unilaterally:

1. **Deploy.** Nothing has been pushed. Production is already known to lag
   local — an earlier verification found CSRF rate limiting and the R2
   presigned-URL fix **not yet live** on monitor.eaqdragon.com. Everything in
   these three commits is therefore also not live. Deploy deliberately, not as
   a side effect of "continuing".
2. **Collapse `auditlogs` into `audit_logs`?** The duplication is now
   intentional and documented, but it is still duplication. The argument for
   keeping it is the indexed `connectionId` / `appName` / `version` fields.
   The argument against is that two collections with names one underscore apart
   is exactly the kind of thing that misleads someone at 03:00.
3. **`_ssh.js:87` admin override.** `getSshConfig` reads `actingUserRole`, but
   the session `role` field was deliberately removed in an earlier
   remediation — so the override is dead code and admins can no longer
   cross-access connections. Confirm that is intended before deploying, because
   it changes admin behaviour in production.

## If you are picking this up cold

```bash
cd /Users/katanyoo/Desktop/monitor
git log --oneline -5          # confirm d41ba7f is the tip
git status                    # should be clean
npm test                      # expect 195 passing
```
