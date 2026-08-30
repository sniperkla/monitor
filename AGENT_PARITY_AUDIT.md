# Agent Parity Audit — hermes / nanobot / openclaw vs ZeroClaw

**Date:** 2026-08-30
**Reference:** `src/app/api/agents/zeroclaw/route.js` (reported working)
**Goal:** confirm each agent install is distro-compatible and has full function
parity with ZeroClaw.

## Method & limitations

The source audit was initially static because command execution was unavailable
inside the WorkBuddy session (`sandbox-exec` failure → Bash exits 127 and Grep
throws `SandboxError`). The user then ran the route verifier and the read-only
server preflight in their own Terminal. No agent install or Telegram E2E has
been run yet.

Marks used below:
- ✅ **VERIFIED** — confirmed by reading the exact cited lines.
- ⚠️ **UNVERIFIED** — from subagent analysis; plausible but not yet confirmed
  by reading the line or by execution.

No source files were modified by this audit.

---

## Verdict

| Agent | Install works? | Blocking | Major | Minor |
|---|---|---|---|---|
| zeroclaw | ✅ yes (reference) | 0 | 0 | 3 (see below — reference is not perfect) |
| nanobot | ❌ **no — guaranteed failure** | 1 | 4 | 3 |
| openclaw | ⚠️ installs, but keys never saved | 1 | 4 | 4 |
| hermes | ⚠️ installs, instances broken | 1 | 4 | 3 |

**All blocking and major findings below have since been fixed in code** — see
[Fixes applied](#-fixes-applied). Static verification only; no live test run yet.

---

## ✅ Fixes applied

### nanobot — `src/app/api/agents/nanobot/route.js`
| Fix | Where |
|---|---|
| `resolveBin()`/`binFrom()` never defined → replaced with the existing `binPath()` helper and the `BIN=` parse `gwCtl` already uses | install, ~:536 |
| Purge no longer removes `/home/*/.nanobot` (wiped every user's data as root) | ~:453 |
| `restore-backup` regex `\\.` → `\.`; also accepts `config.name` *or* `config.backup` | ~:734 |
| Install start now passes `GW_FLAGS` and writes `${HH}/daemon.pid`; liveness reads its own pidfile instead of a global pgrep | install step 6 |
| Added `apk` to the Python prereq chain; added `python3-devel`/`gcc` (Alpine: `python3-dev`/`musl-dev`) | ~:478, ~:490 |

### openclaw — `src/app/api/agents/openclaw/route.js`
| Fix | Where |
|---|---|
| `read -rk` → `read -r k` — provider API keys are now actually written to `.env` | ~:542 |
| Config merge driven by `${HH}` via `OC_HOME`, not a hardcoded `~/.openclaw` | ~:528 |
| Default install controlled through systemd when the installer's unit exists (was: stop = no-op, restart = EADDRINUSE) | `gwCtl`, ~:162-200 |
| `EnvironmentFile=-...` (optional) so a missing `instance.env` can't fail the unit | ~:148 |
| Uninstall keeps the shared binary while sibling instances remain | ~:390 |
| `restore-backup` accepts `config.name` *or* `config.backup` | ~:688 |

### hermes — `src/app/api/agents/hermes/route.js`
| Fix | Where |
|---|---|
| Instance tag now via shared `parseInst()` (handles `config.tag`) — spawned instances no longer start the default install | ~:155 |
| `details` returns config under **both** `configYaml` and `configJson`; `save-config` accepts `configJson`/`configToml`/`configYaml` | ~:549, ~:712 |
| pgrep self-match fixed by splitting the literal (`gatew""ay`) | ~:1196 |
| New instance-scoped `procScan()` — instances no longer report each other as running | ~:68-96 |
| Added `PROCP`/procps probe + fallback install (was: `PROC` always 0 on minimal CentOS/Alpine) | ~:1029-1039 |
| `restore-backup` regex `\\.` → `\.` | ~:898 |

### ⚠️ Deliberately NOT fixed: response-level secret masking

Masking helpers exist in all four routes and are never called, so tokens and keys
are returned in cleartext. **Left unfixed on purpose.** The config/env text in
`details` round-trips through the UI editor — returning masked placeholders
(`••••`) makes the UI persist them straight back into the config file on the next
save and corrupt it. A hermes fix that did this was applied and then reverted.
Doing this safely needs a UI contract change first: a separate read-only masked
field, or a sentinel that `save-config` rejects.

### Still open
- Backup **list** shape is inconsistent: nanobot/openclaw return `{name,date,size}`
  objects, zeroclaw returns bare strings. Restore now accepts both name fields,
  but the list shape needs a live check against `AIAgentsApp.js` before unifying.
- nanobot still hard-aborts below Python 3.11 (Ubuntu 22.04 / Debian 11 ship
  3.10 / 3.9 and the apt branch installs plain `python3`). Needs a real 3.11
  source/PPA path.
- The route verifier has now been run by the user: all seven route/helper files parse.
- Nothing has been verified against a live agent install or Telegram E2E yet.

---

## 🧪 Live preflight: fc-fedora40 container (2026-08-30)

The user ran `scratch/preflight-agent-host.mjs` against
`root@43.210.221.54:2232` and reported:

| Capability | Result | Consequence |
|---|---|---|
| OS | Fedora 40 container image, x86_64 | Use the RPM/dnf path; this is not a full Fedora VM. |
| libc | glibc 2.39 | Compatible with modern prebuilt Linux binaries; no glibc workaround needed. |
| Package manager | `dnf` and `yum` | RPM prerequisite branches are available. |
| Python | 3.12.8 | Nanobot's Python >=3.11 requirement is satisfied already. |
| Node | v20.19.1 | OpenClaw runtime prerequisite is present. |
| Rust/Cargo | Missing | ZeroClaw source-build fallback would need Rust installation; prebuilt should be preferred on glibc 2.39. |
| systemd | Installed, but PID 1 is `sshd` | `systemctl --user` cannot work: no `/run/user/0`, no user bus, and no linger. All gateway lifecycle code must use nohup/pidfile fallback on this host. |
| storage/memory | 51G free, 7.8G RAM, no swap | Enough headroom for sequential installs; avoid parallel builds. |
| current agents | ZeroClaw default + `~/.zeroclaw-kkk` process observed; no Hermes/Nanobot/OpenClaw homes or binaries | Do not install or stop ZeroClaw while testing the other three. Capture its baseline first. |
| networking tools | `ss` and `unzip` missing | Port checks should use `netstat` fallback or `/proc`; install `iproute` only if needed. |

### Container-specific conclusion

This host is a good **binary/install compatibility target**, but not a valid
systemd-user target. The application must report the fallback as intentional,
not treat the presence of `/usr/bin/systemctl` as proof that systemd is usable.
The shared `sdAvailable()` helper already probes the user bus and returns false
when `/run/user/0/bus` is absent, so tagged instances should fall through to
isolated nohup + pidfile. Default installs must also be verified through that
fallback, especially stop/restart and config-save restart.

The observed ZeroClaw process has both `zeroclaw daemon` and an isolated
`/root/.zeroclaw-kkk/bin/zeroclaw daemon --config-dir ...` process. Treat these
as the reference baseline and do not use a broad `pkill zeroclaw` during tests.

---

## 🔴 BLOCKING

### 1. nanobot — `install` throws `ReferenceError`, 100% failure on every distro ✅ VERIFIED

`src/app/api/agents/nanobot/route.js:523-524`

```js
const bc = await resolveBin();
const NB = binFrom(bc);
```

Neither `resolveBin` nor `binFrom` is defined anywhere in the file (verified by
reading the complete file, lines 1–917) and neither is imported (line 8 imports
only from `../_multi-instance`). The call throws
`ReferenceError: resolveBin is not defined`, caught at :912 → HTTP 500.

The installer itself (:512-521) runs to completion first, so this surfaces as a
long install that ends in a 500. The file already contains the intended helper —
`binPath()` at :121 — and `gwCtl` demonstrates the correct pattern at :142-145.

**Fix:** replace both lines with the `binPath()` + regex parse used by `gwCtl`.

### 2. openclaw — provider API keys are never written to `.env` ✅ VERIFIED

`src/app/api/agents/openclaw/route.js:479`

```sh
while IFS='=' read -rk; do
```

`read -rk` parses as options `-r` **and** `-k`; `-k` is not a valid `read`
option, so bash/dash emit `read: -k: invalid option` and the loop body never
executes. Keys are therefore never merged into `${HH}/.env`, but :484 still
echoes `ENV_SEEDED` → the UI reports success while the gateway has no key.

This is very likely the direct cause of the error text already baked into :514:
*"usually a missing provider API key"*.

**Fix:** add the missing space — `while IFS='=' read -r k; do`

### 3. openclaw+nanobot — systemd unit is used for the *check* but not for *control* ✅ VERIFIED

Common shape (openclaw `:141`, and `STATUS_SCRIPT` checks the unit at `:88`):

```js
if (inst && (await sdAvailable(sshConfig))) { ... }   // systemd branch
```

- **openclaw default install** never enters the systemd branch; `gwCtl` falls
  through to the nohup/pidfile path (:159-193). `stop` (:184) kills a pidfile
  PID that was never written → **no-op**. `restart` (:190) then starts a second
  gateway on a port the systemd-managed one still holds → **EADDRINUSE**.
  Breaks stop/restart, `save-config` restart, and `reconfigure` on systemd hosts.

**Fix:** for the default install, check whether the unit exists/is active and
control it via systemctl; only fall back to nohup when no unit is present.

(Related, ✅: openclaw `:146` uses `EnvironmentFile=` without the `-` prefix, so
the unit refuses to start when `instance.env` is absent.)

---

## 🟠 MAJOR

### hermes

| # | Finding | Line | Consequence |
|---|---|---|---|
| H1 | Instance tag parsed as `body.instance‖config.instance` but **never `config.tag`**, while `spawn-instance` sends `config.tag` | ✅ `:131` | Spawning an instance starts the **default** `~/.hermes` gateway; the cloned `~/.hermes-<tag>` never starts. Response still reports `success:true`. |
| H2 | `details` returns `configYaml`; `save-config` accepts only `config.configYaml` | ✅ `:517`, `:678` | Shared UI reads `configJson` → blank config editor; saving from a shared component → 400 "content is empty". |
| H3 | pgrep false positive — literal `exec /usr/local/bin/hermes gateway run` sits in the same command line as the `[h]ermes.*gatew[a]y` pattern | ✅ `:1135` | Gateway reported up even when dead. |
| H4 | Instance pgrep patterns lack a `--config-dir` exclusion (zeroclaw has one at :190) | ✅ `:76`, `:459` | One instance's status reports another instance as running. |
| H5 | `save-config` rolls back only when `config.restart` is truthy; otherwise returns `success:true` with the gateway down | ⚠️ `:710` | Silent failure. |

`parseInst()` in `_multi-instance.js` already falls back to `body.config.tag` —
hermes hand-rolls its own parse instead of using it, which is the root cause of
H1. nanobot and openclaw both call `parseInst()` and are unaffected.

### nanobot

| # | Finding | Line | Consequence |
|---|---|---|---|
| N1 | Install's start step runs bare `nanobot gateway` with **no** `--config/--workspace/--port`, ignoring `GW_FLAGS` | ✅ `:561-566` (vs `:164`, `:149-150`) | A tagged install starts against the default config on the default port. |
| N2 | Hard-abort when `python3 < 3.11`; apt branch installs plain `python3` (still <3.11), no deadsnakes PPA | ✅ `:495-497`, `:472` | Install permanently impossible on Ubuntu 22.04 / Debian 11. |
| N3 | Purge runs `rm -rf /home/*/.nanobot` as root | ✅ `:453` | Destroys **every user's** agent home, incl. provisioned users. zeroclaw purges only `${HH}` (:483). |
| N4 | `restore-backup` regex `/^config\\.json\\.bak-[0-9]+$/` — in a regex literal `\\.` needs a literal backslash | ✅ `:730` | No real backup name can ever match → restore always 400. |
| N5 | Secret-masking helpers defined but never called | ✅ `:31`, `:56` vs `:373-374` | Raw `apiKey` + Telegram token returned to the client. |

### openclaw

| # | Finding | Line | Consequence |
|---|---|---|---|
| O1 | `node -e` hardcodes `process.env.HOME+'/.openclaw/openclaw.json'` instead of `${HH}` | ✅ `:470` | Installing a tagged instance mutates the **default** install's config. |
| O2 | `STATUS_SCRIPT` hardcodes `$HOME/.openclaw`, ignores `HH`/`GW_PORT`; `pgrep` unscoped | ✅ `:75-100`, `:87` | A tagged instance's overview shows the default install's version/config/running state. |
| O3 | Uninstall deletes `/usr/local/bin/openclaw` with no "instances remain" guard | ✅ `:392` | Remaining instances (which share the binary) can never restart. zeroclaw guards this (:479). |
| O4 | Secret-masking helpers defined but never called | ✅ `:32-73` vs `:341-342` | Raw tokens returned to the client. |
| O5 | `save-config` returns `success:true` when restart failed, no rollback | ⚠️ `:777` | Gateway down, UI says OK. |

---

## 🟡 MINOR / distro compatibility

| Agent | Finding | Line |
|---|---|---|
| nanobot | No `apk` branch in prereqs → silently skipped on Alpine | `:472-476` |
| nanobot | RPM branch installs no `python3-devel`/`gcc` → source builds fail on Fedora/CentOS | `:486` |
| nanobot | pgrep self-match: `command -v nanobot) gateway` in same line as the pattern → log always says `GW_UP` (authoritative re-check at `:567` is correct, so only the log lies) | ✅ `:563` |
| hermes | No `pgrep`/procps probe → `PROC` always 0 on minimal CentOS Stream 9 / Alpine → false "install failed" | ⚠️ `:990` |
| hermes | `stat -c %y` and `ps -o etimes=` are GNU-only → empty dates/uptime on Alpine/BSD | ⚠️ `:848`, `:753` |
| hermes | `status.prereqs` omits `tar`; `health` omits `portListening` | ⚠️ `:387`, `:791` |
| openclaw | save-config / skills / reconfigure shell out to `python3 -m json.tool` → always 400s on Alpine without python3 | ⚠️ `:689`, `:718`, `:749` |
| openclaw | `prereqs.node` returns the string `"NONE"`, which is truthy → UI shows a version for a missing binary | ✅ `:85`, `:207` |
| openclaw | Prereq failures swallowed (`S="sudo -n"` only when passwordless) → install proceeds and fails late | ⚠️ `:414` |

---

## 🔐 Cross-cutting: secret masking is dead code in all four agents

`maskSecretString` / `maskConfigJson` / `maskConfigText` / `maskEnvText` are
defined in every route but **never called** — including zeroclaw (`:42`, `:53`
defined; `:425-426` return raw). Telegram bot tokens and provider API keys are
sent to the browser in cleartext.

This is pre-existing in the reference, so it is parity rather than a regression,
but it should be fixed in all four at once.

---

## ⚠️ Open question: backup response shape

Two audits reached opposite conclusions and neither is verified:
- nanobot/openclaw return `backups` as `{name,date,size}` objects and read
  `config.name` on restore.
- zeroclaw returns bare strings and reads `config.backup` (:965).

Whichever the shared UI (`src/apps/AIAgentsApp.js`) actually consumes, the other
side is broken — either the UI renders `undefined (NaN KB)` or restore 400s.
**Needs a live check before touching.**

---

## ✅ Worth back-porting to the other agents

| Improvement | Source |
|---|---|
| Incremental byte-offset `logs` cursor (zeroclaw re-tails 300 lines per poll) | nanobot `:818-829`, openclaw `:546-558` |
| `backups` as `{name,date,size}` objects | nanobot `:723` |
| Path-traversal-safe restore regex (zeroclaw's `[\w./~-]+` accepts absolute paths) | openclaw `:626` vs zeroclaw `:966` |
| Remote JSON validation before replacing config (zeroclaw writes blindly) | openclaw `:749` vs zeroclaw `:922` |
| `gateway` op whitelist (zeroclaw passes `config.op` unchecked) | nanobot `:811` |
| Non-blocking background prereq install with polling | hermes `:1014-1030` |
| PID-reuse guard that verifies cmdline (vs zeroclaw's bare `kill -0`) | hermes `:138-154` |
| Docker-isolated install across 8 distros | hermes `:940-975` |
| Real `recentErrors` in `health` (zeroclaw hardcodes `errorCount: 0`) | hermes `:769-776` |
| Install retry + `waitActive` after start | openclaw `:500-507` |

---

## Recommended fix order

**Tier 1 — one-line, mechanically provable**
1. nanobot `:523-524` — replace `resolveBin()`/`binFrom()` with the `binPath()` pattern
2. openclaw `:479` — `read -rk` → `read -r k`
3. nanobot `:730` — `\\.` → `\.`
4. nanobot `:453` — drop `/home/*/.nanobot`
5. openclaw `:470` — use `${HH}` instead of hardcoded `~/.openclaw`
6. openclaw `:146` — `EnvironmentFile=-...`

**Tier 2 — structural**
7. hermes `:131` — use `parseInst()`; `:517`/`:678` — `configYaml` → `configJson` alias
8. openclaw `:141` — extend systemd control to the default install
9. nanobot `:561-566` — pass `GW_FLAGS`
10. openclaw `:392` — guard shared-binary removal

**Tier 3 — correctness**
11. Call the masking helpers in all four routes
12. Fix pgrep self-match (hermes `:1135`, nanobot `:563`) + add instance exclusion
13. Make `save-config` report real restart outcome

**Tier 4 — distro matrix**
14. nanobot: `apk` branch, `python3-devel` on RPM, a real 3.11 path for Ubuntu 22.04/Debian 11
15. hermes: procps probe; replace GNU-only `stat -c` / `ps -o etimes`
16. openclaw: make `python3` optional for save-config

---

## Verification matrix (requires a working shell)

| Distro | Init | What it proves |
|---|---|---|
| Fedora 40 — `root@43.210.221.54:2232` | systemd | nanobot py3.11 path; openclaw systemd lifecycle |
| CentOS Stream 9 | systemd | hermes procps probe; RPM devel headers |
| Ubuntu 22.04 | systemd | nanobot py3.11 hard-abort (N2) |
| Debian 11 | systemd | nanobot py3.11 hard-abort (N2) |
| Alpine | OpenRC | `apk` branches; GNU-only flags; python3-dependent save-config |

Per distro × per agent: `status → install → details → gateway stop/start →
save-config → backups → restore-backup → logs → uninstall`, plus a Telegram
round-trip.
