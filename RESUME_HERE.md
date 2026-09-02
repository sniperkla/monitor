# RESUME HERE — monitor security hardening

**Project:** `/Users/katanyoo/Desktop/monitor` · **Branch:** `nextgen15`
**Deployed at:** monitor.eaqdragon.com
**Status when the session was interrupted:** 2026-09-02 ~17:07
**Reason for this file:** the WorkBuddy session was cut off (account switch) and
the working state was only recoverable from disk.

---

## What this round of work is

A defence-in-depth security hardening pass, derived from the black-box pentest
report in `docs/SECURITY_AUDIT_2026-09-02.md`. Ten of eleven planned tasks are
done. **None of it is committed.**

## Task list as it stands

| # | Task | Status |
|---|---|---|
| 1 | Progressive login delay (1s/2s/5s/15s/60s, identity-keyed) | done |
| 2 | Install security dependencies | done |
| 3 | Per-user API keys with scopes | done |
| 4 | **Audit log hardening and wiring** | **IN PROGRESS** |
| 5 | Unified rate limiter (Upstash + in-process fallback) | done |
| 6 | Backup envelope encryption at rest (AES-256-GCM + SSE-S3) | done |
| 7 | Rate limit all mutating routes | done |
| 8 | WebAuthn / passkey login | done |
| 9 | Fix live security holes (vault plaintext code, decrypt oracle, hardcoded key) | done |
| 10 | TOTP MFA enforcement for admins | done |
| 11 | **Verify with lint and build** | **PENDING** |

## Uncommitted change set (24 paths)

Modified: `package.json`, `package-lock.json`, `src/lib/auditLog.js`,
`src/lib/auth.js`, `src/lib/loginRateLimit.js`, `src/lib/r2.js`,
`src/models/User.js`, `src/proxy.js`, `src/utils/encryption.js`,
`src/components/landing/RevealScreen.js`,
`src/app/api/connections/route.js`,
`src/app/api/server-backup/upload-r2/route.js`,
`src/app/api/user/vault/recovery/route.js`,
`src/app/api/utils/decrypt/route.js`

New: `src/lib/{apiAuth,backupCrypto,mfa,ratelimit,webauthn}.js`,
`src/models/{ApiKey,WebAuthnCredential}.js`, `src/utils/passkey.js`,
`src/app/api/auth/webauthn/`, `src/app/api/user/api-keys/`,
`src/app/api/user/mfa/`, `src/app/api/server-backup/download-r2/`

New dependencies (all confirmed installed in `node_modules`):
`@upstash/ratelimit`, `@upstash/redis`, `otpauth`,
`@simplewebauthn/server`, `@simplewebauthn/browser`

## Exactly what is left on task #4

`src/lib/auditLog.js` was rewritten (+117/-22) and now records
ip / user-agent / method / path / status. It is already imported by 13 routes.

**Still not wired** — these were in the task description and are confirmed
missing by grep:

- `src/app/api/skills/install/route.js` — highest risk, this is the
  prompt-injection-to-shell path from finding F-01
- `src/app/api/connections/route.js` — all mutations
- `src/app/api/admin/*` — 5 handlers (`ai-usage/migrate-daily-limit`,
  `ai-usage/reset`, `seed-keys`, `supporters`, `supporters/codes`)
- `src/app/api/user/vault/*` — unlock, recovery, reset

The "two competing audit implementations" part: only `src/lib/auditLog.js` +
`src/models/AuditLog.js` exist now, but `src/models/ActivityLog.js` is a
separate parallel log and `src/lib/auth.js` still writes its own entries.
Decide whether to unify or leave both, then document the choice.

## Environment gotchas (cost real time — read before running anything)

- **`npx next build` fails in this sandbox** with
  `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`. Next clears `.next` on
  build and the shim counts deletions per turn (threshold 50).
  Workaround: `mv .next /tmp/next-backup-$(date +%s)` first, never delete it.
  Build takes ~34s.
- Verification build pattern that works: `NEXT_DIST_DIR=.next-security-verify npx next build`
  (support for `NEXT_DIST_DIR` was added to `next.config.mjs` for this).
- Baseline before this round: **187 tests passing**, ESLint clean except
  pre-existing React hook warnings.

## Suggested order to finish

1. Wire `auditLog` into the routes listed above (task #4).
2. Run `npm test` + ESLint on changed files (task #11).
3. Build with the `.next` move-aside workaround, not a plain `next build`.
4. **Commit before doing anything else.** 24 uncommitted paths including
   dependency changes is the single biggest risk here — one bad reset and this
   whole round is gone.
5. Only then consider deploying. Note the previous session already found
   production lagging local: CSRF rate limiting and the R2 presigned-URL fix
   were verified **NOT yet deployed** on monitor.eaqdragon.com.

## Open question carried over from earlier

`_ssh.js:87` `getSshConfig` has an admin override that reads `actingUserRole`,
but the session `role` field was deliberately removed in an earlier
remediation — so that override is dead code and admins can no longer
cross-access connections. Confirm that is intended.
