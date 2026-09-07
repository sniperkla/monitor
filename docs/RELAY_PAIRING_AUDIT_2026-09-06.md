# Relay pairing audit — local relay & server agent install

**Date:** 2026-09-06
**Scope:** the pairing logic in the installer — `public/local-relay.js --pair`,
`public/monitor-agent.js --pair|--claim`, and the server side they talk to.
**Method:** source trace + live probes against a running dev server (port 3030).
**Subject pinned:** `public/local-relay.min.js` — 195,544 bytes,
SHA-256 `96d159b9164266a34e88df1cb34fa60f8b5a0f04660a838c7c4071f880c5777c`.
That is the **built artifact**, because it is what `/local-relay.js` now serves
(see "Distribution model change" below). Its header declares
`source-sha256: bdd6d059…` — the readable source it was built from, 164,963
bytes. (Earlier digests: `3d2db274…` after F7, `55dcb171…` before any fix.)

> **Distribution model change, same day, after this audit was written.** The
> relay is no longer shipped as readable source. `scripts/build-relay.mjs`
> produces the artifact from `public/local-relay.js`; `server.js` serves only
> that artifact, with no fallback; the release manifest hashes it. This
> reverses section 5 below, which is retained rather than deleted because the
> reasoning is worth reading before you disagree with the reversal. The F1
> *invariant* — hashed bytes == served bytes — is unchanged and still tested;
> only which file it points at moved.

**Status 2026-09-06 (later that day):** F1–F7 are all applied. The installer
was deliberately left untouched while the audit was under review; the fixes
below are now in `public/local-relay.js`, `public/monitor-agent.js`,
`src/lib/relayPairing.js`, `src/lib/relayTokens.js` and `server.js`.
`npm test` 370/370; `relay-install-audit.mjs` exits 0 with no drift;
`npm run build:relay -- --check` exits 0 (artifact matches a fresh build).

Verdict: **the pairing flow is functionally sound.** Every server step behaves as
documented under live probing. The defects found are one latent
correctness bug, one diagnostics bug, and three hygiene issues. None of them
lets an attacker pair someone else's device.

---

## 1. Step-by-step trace

### Local relay — `node local-relay.js --pair --server https://…`

| # | Step | Verified | Status |
|---|------|----------|--------|
| 1 | `curl -fsSL … -o local-relay.js` (verify-gated command from `RelayTrustPanel.js:113`) | yes | ✅ |
| 2 | `echo "<sha256>  local-relay.js" \| shasum -a 256 -c -` — `&&` gate, aborts before `node` runs | yes | ✅ but see **F1** |
| 3 | argv parse — `--pair` followed by `--server` sets `args.pair = true` (not swallowed as a value) | yes | ✅ |
| 4 | `loadConfig()` reads `~/.ssh-monitor-relay.json`; `TOKEN` empty on a fresh install | yes | ✅ |
| 5 | `pairAndGetToken({ client:'local-relay', scope:'relay' })` | yes | ✅ |
| 6 | `POST /api/relay/device/code` — unauthenticated, CSRF-exempt, no secret sent | **live: 200** | ✅ |
| 7 | `createEnrollment` — 20/min/IP throttle, 5,000-entry cap, 256-bit device code, 9-char user code | yes | ✅ |
| 8 | Prints `K7QP-2M4X`; polls every 5s for up to 600s | yes | ✅ |
| 9 | User submits code → `POST /api/relay/device/approve` — session + CSRF required | **live: 401** unauthenticated | ✅ |
| 10 | `approveEnrollment` — normalize → constant-time lookup (pending only) → supporter gate for `scope:'relay'` → binds `userId = session.sub` | yes | ✅ |
| 11 | Next poll returns 200 + token; enrollment consumed (single use) | **live: 202** on the pending path | ✅ |
| 12 | `saveConfig()` → `~/.ssh-monitor-relay.json` at **0600**. Token never in argv, history, or the service definition | yes | ✅ |
| 13 | `ensureInstalledScript()` → mkdir, copy script 0755, write `package.json`, then **blocking `npm install ssh2 ws node-datachannel`** | yes | ⚠️ **F5** |
| 14 | `installMacOS/Linux/Windows` — `serviceArgs()` returns **no `--token`** when paired, so the service boots from the 0600 config. Correct: no secret in a world-readable plist/unit | yes | ✅ |
| 15 | Self-cleanup deletes the downloaded `./local-relay.js` when run outside the install dir | yes | ✅ |
| 16 | Service connects `wss://<server>/relay-ws?token=<TOKEN>` | yes | ⚠️ **F2** |

### Server agent — `monitor-agent.js --pair` or `--claim <CODE>`

| # | Step | Verified | Status |
|---|------|----------|--------|
| 17 | Wizard mints an invite: `POST /api/relay/device/invite` — session + CSRF, supporter gate when `scope:'relay'` | yes | ✅ |
| 18 | `createInvite` → `status:'approved'`, `userId` bound up front, `userCode: null` | yes | ⚠️ **F6** |
| 19 | Agent redeems once: `POST /api/relay/device/token` → 200 + token | yes | ✅ |
| 20 | On a consumed/expired code the server replies 410 with a clear message | yes | ⚠️ **F3** |
| 21 | `exchangeEnrollment` deletes the entry, then awaits `persistRelayTokens()` | yes | ⚠️ **F4** |

---

## 2. Findings

### F1 — HIGH (latent): the manifest can hash different bytes than the server serves — **FIXED**

`src/app/api/relay/release/route.js:35` pins the digest to `public/local-relay.js`:

```js
const RELAY_PATH = path.join(process.cwd(), 'public', RELAY_FILENAME);
```

But `server.js:508` chooses what to serve at `/local-relay.js` by a rule — it
prefers the source, **and falls back to `public/local-relay.min.js` when that
file exists and is newer than the source.** When that branch is taken, the
installer's verify step compares the source digest against minified bytes and
**always fails**, so the recommended install path aborts.

Not currently live: `local-relay.min.js` was quarantined as
`local-relay.min.js.stale-sep2`, so served bytes == source bytes (verified —
both `3d2db274…`). It returns the moment anyone runs `npm run build:relay`.

**Root cause:** two independent notions of "the file we publish" — one in the
manifest route, one in the static handler — with no shared resolver.

**Minimal fix** — make the manifest hash what the handler will serve:

```js
// src/app/api/relay/release/route.js
-import { RELAY_FILENAME } from '@/lib/relayRelease';
+import { RELEASE_PATH, RELAY_FILENAME } from '@/lib/relayRelease';
-const RELAY_PATH = path.join(process.cwd(), 'public', RELAY_FILENAME);
+const RELAY_PATH = RELEASE_PATH();
```

with one shared selector in a new `src/lib/relayRelease.js` used by **both**
`server.js` and the manifest route. Given the no-minification policy below, the
simpler fix is to delete `build:relay` and the `.min.js` path entirely.

**Applied (simpler variant, then revised).** A shared resolver still leaves two
places that can disagree; removing the second file removes the disagreement.
`server.js` was first pointed at `public/local-relay.js` unconditionally and
`build:relay` deleted.

**Revised the same day.** The policy reversed (see the box at the top): the
relay is now shipped as a build. The invariant F1 protects is untouched —
hashed bytes must equal served bytes — but it now points at
`public/local-relay.min.js`. Because that reintroduces the exact hazard F1 was
about, the second file is now constrained instead of removed:

- `server.js` resolves to the artifact with **no fallback**; a missing
  artifact is a 503, never a silent switch to the source.
- The artifact carries `source-sha256` in its header, and
  `npm run build:relay -- --check` exits 2 when it no longer matches.
- The build is **seeded**, so identical source produces identical bytes and the
  published digest is stable rather than moving every build.
- `prepack` refuses to publish a stale artifact; `prebuild`/`predev` build it.
- `tests/relayRelease.test.mjs` pins all of the above, including that the
  build and the check share one function — they did not at first, and `--check`
  failed on a perfectly current artifact.

The stale-bundle incident this finding grew out of was caused by a *conditional
fallback*, not by the existence of a second file. There is no conditional
fallback now.

---

### F2 — MEDIUM: the token rides in the websocket query string — **FIXED**

`public/local-relay.js:351`

```js
const wsUrl = SERVER.replace(/^http/, 'ws') + `/relay-ws?token=${encodeURIComponent(TOKEN)}`;
```

Pairing exists to keep the token out of argv and shell history, and it succeeds
at that — but query strings are routinely written to server access logs, so the
token ends up persisted in log storage anyway.

**Minimal fix** — `ws` (a Node client here, not a browser) can set handshake
headers:

```js
-const wsUrl = SERVER.replace(/^http/, 'ws') + `/relay-ws?token=${encodeURIComponent(TOKEN)}`;
-const ws = new WebSocket(wsUrl);
+const wsUrl = SERVER.replace(/^http/, 'ws') + '/relay-ws';
+const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${TOKEN}` } });
```

with the server accepting either source during rollout.

---

**Applied — with one trap worth recording.** `public/local-relay.js` loads
`ws` and falls back to `globalThis.WebSocket`. Those are not interchangeable
here: the WHATWG global **silently ignores** its second argument, so
`new WebSocket(url, { headers })` would send no token at all and every connect
would fail with "Invalid or expired token" and no explanation. The client now
branches on `WS_CAN_SET_HEADERS` — bearer header when `ws` is present, query
string only as the degraded fallback. `server.js` reads
`authorization: Bearer` first and still accepts `?token=` so relays already
installed in the field keep working; they cannot be updated in place.

---

### F3 — MEDIUM: a clear server error is relabelled as a network failure — **FIXED**

`public/monitor-agent.js:152-162`

```js
const r = await postJson('/api/relay/device/token', { deviceCode: code });
if (r.status === 200 && r.data && r.data.token) return r.data.token;
throw new Error((r.data && r.data.error) || `Could not claim the install code (HTTP ${r.status}).`);
} catch (e) {
  if (e && /^Could not claim/.test(e.message || '')) throw e;
  throw new Error(`Could not reach ${SERVER} — ${e.message}`);
}
```

A 410 (consumed/expired code) throws the server's own message — *"This setup
code expired. Run the install command again."* — which does **not** start with
`Could not claim`, so the catch rewrites it to:

> `Could not reach https://… — This setup code expired. Run the install command again.`

The server answered; nothing failed to reach it. Users chase a phantom network
problem and re-run an installer that can never succeed with that code.

**Minimal fix** — stop string-matching, tag the error:

```js
-    throw new Error((r.data && r.data.error) || `Could not claim the install code (HTTP ${r.status}).`);
+    const err = new Error((r.data && r.data.error) || `Could not claim the install code (HTTP ${r.status}).`);
+    err.fromResponse = true;   // the server answered; this is not a transport failure
+    throw err;
   } catch (e) {
-    if (e && /^Could not claim/.test(e.message || '')) throw e;
+    if (e && e.fromResponse) throw e;
     throw new Error(`Could not reach ${SERVER} — ${e.message}`);
   }
```

---

**Applied.** `public/monitor-agent.js` now tags the error with
`fromResponse` and the catch branches on the tag instead of string-matching.
`tests/relay-agent-pair.test.mjs` runs the real agent against a stub server
that answers 410 and asserts the output contains "expired" and never
"Could not reach" — so this is verified by execution, not by reading.

---

### F4 — MEDIUM: the enrollment is consumed before the token is persisted — **FIXED**

`src/lib/relayPairing.js:367-378`

```js
codes.delete(deviceCode);                 // single use — consumed here
const { token, expiresAt } = issueRelayToken({ … });
await persistRelayTokens();               // if this throws, the token is orphaned
```

`issueRelayToken` mutates the in-memory map immediately. If
`persistRelayTokens()` rejects, we have already deleted the enrollment and
issued a token that exists only in memory. The agent sees a 500, retries, gets
410, and the user must re-pair; meanwhile a token that survives until the next
restart was never durably recorded.

**Minimal fix** — persist first, consume last, restore on failure:

```js
-  codes.delete(deviceCode);
-
   const { token, expiresAt } = issueRelayToken({ … });
-
-  await persistRelayTokens();
+  try {
+    await persistRelayTokens();
+  } catch (e) {
+    codes.set(deviceCode, entry);   // give the agent its single use back
+    throw e;
+  }
+  codes.delete(deviceCode);
```

---

**Applied — and the ordering is deliberate, not incidental.** The
`codes.delete()` stays *before* the mint. Moving it after the `await` (the
obvious "persist first, consume last" reading) would put a suspension point
between the two and let a concurrent poll mint a second token from one code.
Instead the persist is wrapped: on failure it revokes the in-memory token via a
new `revokeRelayToken()` in `src/lib/relayTokens.js` **and** restores the
enrollment, so the agent's retry gets its single use back and no unrecorded
credential is left live. Verified by a test that makes persistence throw and
asserts both halves of the rollback, then that the retry succeeds.

---

### F5 — LOW (biggest surprise): install runs a blocking, untimed `npm install` — **FIXED**

`public/local-relay.js:297-301` — `spawnSync('npm', ['install', …, 'ssh2', 'ws',
'node-datachannel'], { stdio: 'inherit' })`. Synchronous, no timeout, into
`~/.ssh-monitor-relay/`. `node-datachannel` is a **native module** and may
compile from source. On a cold network this can hold the terminal for minutes
with no progress output, which is exactly the feeling a trust-first installer
should avoid.

**Minimal fix** — at minimum bound it and say what is happening:

```js
-      ], { cwd: INSTALL_DIR, stdio: 'inherit' });
+      ], { cwd: INSTALL_DIR, stdio: 'inherit', timeout: 5 * 60 * 1000 });
```

Better: make `node-datachannel` optional (the relay already degrades to
WebSocket without it) and drop it from the default install.

---

**Applied.** Two `spawnSync` calls with explicit timeouts: `ssh2` + `ws`
first (5 min, required), then `node-datachannel` separately (3 min, optional —
the relay already falls back to WebSocket transport without it). A hang in the
native build can no longer take the required packages down with it, and each
failure mode now says what to do. The auditor's F5 notice downgraded from
NOTICE to INFO accordingly.

---

### F6 — LOW: invite-minted tokens lose their provenance — **FIXED**

`createInvite` sets `userCode: null`, and `exchangeEnrollment` passes
`pairingId: entry.userCode`. So every wizard-installed token is recorded with
`pairingId: null` — indistinguishable from a hand-pasted token, even though
`relayTokens.js:93` explicitly says provenance is the interesting signal.

**Minimal fix** — `pairingId: entry.userCode || 'invite'`.

---

**Applied.** `pairingId: entry.userCode || 'invite'`. A test asserts an
invite-minted token carries `'invite'` and that it is distinguishable from a
device-paired install's user code.


---

### F7 — HIGH (found by running it): the relay deletes its own executable — **FIXED**

**Status: fixed in `public/local-relay.js` as part of this work.**

Both the install and uninstall paths ended with:

```js
if (path.resolve(SCRIPT) !== path.resolve(INSTALLED_SCRIPT) && fs.existsSync(SCRIPT)) {
  fs.unlinkSync(SCRIPT);
}
```

The intent is to remove the throwaway copy a user curled into `~/Downloads`.
There is no notion of "throwaway" though — **any** run from outside
`INSTALL_DIR` deletes the file it is currently running from. That is harmless
for a one-shot download and fatal for an npm install, where the running file
**is** the package's own `dist/local-relay.js`.

Observed while packaging: after a single `local-relay --pair` from a global
install, `dist/` was empty and the next invocation died with
`MODULE_NOT_FOUND`. The background service kept working, because it runs the
copy in `~/.ssh-monitor-relay/` — so the breakage is silent and only surfaces
the next time you type the command.

**Fix applied** — `isDisposableScript()` is now an **allowlist** (tmpdir,
`/tmp`, `/private/tmp`, `~/Downloads`, `~/Desktop`). A blocklist does not work
here, for two reasons both hit during testing:

- `npm install -g ./packages/local-relay` **symlinks** the package, so
  `__filename`'s realpath contains no `node_modules` segment and a
  `node_modules` check misses entirely;
- running from a source checkout would delete the source of truth.

Verified: a file under `/tmp` is still cleaned up, and a real package path
outside `/tmp` survives a full install.

---

### F8 — HIGH (user-reported): `--pair` prints no code on an already-paired machine — **FIXED**

Reported as *"no key appear after installed via npm or direct when success and
need to remove first when install again"*. Both halves are one bug, and it hits
the npm route and the curl route identically because they share the block.

Pairing is the only thing that prints the code box, and it was gated on a
token check that the saved config already satisfies:

```js
let TOKEN = args.token || savedConfig.token || process.env.RELAY_TOKEN || '';  // :267
…
if (!TOKEN) {                     // :321  ← the bug
  TOKEN = await pairAndGetToken({ … });
}
```

`~/.ssh-monitor-relay.json` is written at the end of the first successful
install, so from then on `savedConfig.token` is set, `TOKEN` is truthy, and
`--pair` **never pairs**. It falls straight through to
`installMacOS()` and prints `✅ Relay agent installed as service` — a success
message for something that did not happen, and no code anywhere.

`--uninstall` appeared to fix it for exactly one reason: it `unlink`s
`CONFIG_PATH` (`:357`), so the next run has no saved token.

Why it matters beyond the missing code — re-pairing is the recovery path for
every way an install goes wrong:

- the token was revoked server-side;
- the machine is being pointed at a **different server** (and note
  `saveConfig({ server: SERVER, token: TOKEN })` would then have written the
  new server with the old token — a service that starts, fails to authenticate,
  and has no code on screen to fix it with);
- the approval window expired before the user got to Settings.

All three previously required a full uninstall to escape.

**Fix.** `--pair` is an explicit request for a code, so it must always mint
one:

```js
if (!TOKEN || (args.pair && !args.token)) {
```

- no token → pair (unchanged);
- `--pair` → always pair, replacing the saved token, with a line telling the
  user the old one is being discarded;
- explicit `--token` → still wins; we do not go asking for credentials the
  user already supplied;
- `--install` without `--pair` → still reuses the saved token, because that
  command means "re-provision the service", not "get new credentials".

Also added: a warning when a saved token is reused against a different server,
since a token is only valid for the server that minted it.

Two regression tests in `tests/relayRelease.test.mjs` pin the guard and both
messages — including a `doesNotMatch` on the old bare `if (!TOKEN)` shape, so
it cannot quietly come back.

**Verified live, without touching the install.** Running the fixed artifact on
this machine, with the real `~/.ssh-monitor-relay.json` (token present, so the
old code would have skipped pairing) printed:

```
↻ Already paired — replacing the existing token with a new one.
  The old one stops being used; revoke it in Settings → Local Relay.

  ┌──────────────────────────────────────────────┐
  │          >>>   E8CR-EQXS   <<<               │
  └──────────────────────────────────────────────┘
  Waiting for approval (this code expires in 10 min)
```

The trick that makes this safe: pairing runs and blocks *before*
`installMacOS()`, so killing the process during the approval wait exercises the
exact broken branch and changes nothing — confirmed afterwards that the config
token was untouched. Approving would have been needed to reach the install.

Ships in **1.0.4**. Users on 1.0.3 or earlier who hit this can either upgrade
or run `local-relay --uninstall` first — which still works, for the reason
above.

---

### F9 — CRITICAL (live in prod): the served server agent was an Aug 23 build that cannot `--claim` — **FIXED**

Every server-agent install has been downloading an agent that does not
understand the command it is given.

`public/monitor-agent.min.js` was last built **2026-08-23** ("many fix firewall
and UI"). The source `public/monitor-agent.js` last changed **2026-09-06 18:03**
("improve webUI") — the same commit that switched every install snippet to
claim codes. The UI and the artifact had not met since.

| Probe | Aug 23 artifact | Sep 6 source |
| --- | --- | --- |
| `claim` | **0** | 13 |
| `--claim` | **0** | 8 |
| `claimWithCode` | **0** | 1 |
| `--pair` | **0** | 8 |
| `MONITOR_CLAIM` | **0** | 1 |

And every snippet in the product sends `--claim`:

- `src/components/AgentSetupWizard.js:204–206` (tmux, service and foreground
  variants),
- `src/app/api/server-monitor/agent/route.js:365` and `:450`.

**Proof, old vs rebuilt** (against a deliberately dead port, sandboxed `HOME`):

```
OLD:  ⚡ Server Monitor Telemetry Agent
      Usage: node monitor-agent.js --server <URL> --token <TOKEN> …   exit 1
      ^ never saw --claim at all

NEW:  🛡️  [Monitor Agent] Firewall attack-history sampler active
      ❌ Could not reach http://127.0.0.1:9 — fetch failed            exit 1
      ^ attempted the claim; only the dead port stopped it
```

So a "successful" install was writing nothing and registering a service that
could not authenticate — with no error anyone would notice.

**Root cause is the pipeline, not the file.** `build:agent` was a bare
`npx javascript-obfuscator … --compact true --string-array true` one-liner: no
seed, no `source-sha256` stamp, not wired into `prebuild`, and nothing that
could ever compare it to its source. It is the same shape as the stale-bundle
trap the relay had, minus even the ability to detect it.

**Fix.** `build:agent` now runs `scripts/build-relay.mjs --target agent`, so
the agent inherits determinism, the `source-sha256` stamp and the `--check`
gate. `prebuild`/`predev` build **both** artifacts, and CI builds and checks
both. One builder, two targets — see `TARGETS` in `scripts/build-relay.mjs`.

Verified: agent artifact `f5c813c4…9a87`, 38,629 bytes, built from source
`52c43d33…d3a5`; `--check` passes; tampering with the file makes `--check`
exit 2.

**This one is live.** `public/` is served as-is by prod, so
monitor.eaqdragon.com has been handing out the broken agent. It is fixed in
the working tree and needs a deploy to take effect.

Also fixed here: **F8 in the agent** — the same `if (!TOKEN)` guard, and worse,
because `saveConfig()` sat *inside* it, so on an already-installed agent not
only was no code printed, nothing was rewritten and a `--claim` code was
ignored outright. Three integration tests cover it (re-pair with a saved token,
claim honoured over a stale token, and the existing explicit-`--token` case).

---

## 3. Confirmed correct (do not "fix" these)

- **CSRF exemption is scoped right.** `/api/relay/device/code` and
  `/api/relay/device/token` are exempt (`src/lib/csrf.js:72-73`);
  `/api/relay/device/approve` is **not** — correct, it is the only step that can
  bind a device to an account.
- **Session gate is skipped only for the two inert endpoints**
  (`src/proxy.js:240-243`, `:455`), and `/approve` returns 401 without a session.
- **The service never carries the token.** `serviceArgs()` omits `--token` when
  pairing was used, so the LaunchAgent plist / systemd unit / VBS launcher holds
  no credential.
- **Throttles are adequate.** 1-minute windows: 20 enrollments/IP, 30 approvals/
  user, 240 exchange polls/IP against a 5s poll cadence (~12/min).
- **Constant-time user-code comparison** (`safeEqual`) is length-safe and
  null-safe; `findByUserCode` skips non-pending entries.
- **Supporter gating is checked at approval, not creation** — deliberate and
  correct: the error lands in the browser where the user can act on it.

---

## 4. The verification artifact

`scripts/relay-install-audit.mjs` — standalone, plain JS, node builtins only.

```bash
# read-only audit (default: zero writes, zero network)
node scripts/relay-install-audit.mjs --script public/local-relay.js

# machine-readable
node scripts/relay-install-audit.mjs --script public/local-relay.js --json

# prove the server serves the bytes you just hashed (explicit opt-in)
node scripts/relay-install-audit.mjs --script public/local-relay.js \
     --check-served https://monitor.eaqdragon.com/local-relay.js

# write a report (the only write path, and it is opt-in)
node scripts/relay-install-audit.mjs --script public/local-relay.js --emit-report audit.md
```

It derives its output from the file on disk rather than trusting this document,
and reports: SHA-256 + size + line count, the exact three commands the installer
runs, every network call, every file created/modified/deleted with modes, every
external binary spawned, the npm packages fetched, and drift against the
expectations pinned at audit time. Exit `0` clean, `2` drift, `3` read error.

**Side-effect contract:** read-only by default. It writes nothing and opens no
socket unless you pass `--emit-report` or `--check-served`.

---

## 5. On the no-obfuscation constraint — **REVERSED, kept for the reasoning**

This audit originally recommended, and the artifact then followed, a
plain-source policy: **no minification, no obfuscation, no embedded payloads.**
The argument was that shipping readable source is what a user needs before
piping a download into `node`, that it is the direct cause of F1 and of the
earlier stale-bundle incident, and that deterrence should come from the
checksum, the license header and the usage terms instead.

**That recommendation was reversed the same day by the project owner**, and the
relay now ships as a build. The argument above is not wrong about the *trust*
side — a user genuinely can no longer skim the file — so it is recorded rather
than quietly deleted. What follows is what the reversal actually costs and what
was done to contain it, since "we obfuscated it" is not by itself an answer to
any of the three objections.

Costs, honestly:

1. **The installer's strongest reassurance is gone.** "Read it, it is one
   dependency-free file" was the one claim a user could check in ten seconds.
   It is no longer true and the trust panel no longer says it. What replaces it
   is weaker but still checkable: a checksum, a fixed file list, and a
   pre-flight report generated *from the source* describing every write, network
   call and service the installer makes.
2. **It is deterrence, not secrecy.** The relay runs on the user's machine.
   Anyone with a deobfuscator gets the logic. What changed is the cost of
   copying it: "open the file" became "run a tool". Say so in the license
   rather than implying protection that does not exist — which is why the
   license now states it is a build and still permits decompiling for personal
   inspection.
3. **The F1 class of bug is back in the room.** Contained as described in F1:
   no fallback, stamped `source-sha256`, seeded build, `--check` gate in CI,
   and `prepack` refusing to publish a stale artifact.

What was **not** done, because it would have made things worse:

- `controlFlowFlattening`, `deadCodeInjection`, `selfDefending` stay **off**.
  The relay resolves modules through a dynamic `require()` search path, and
  those transforms have corrupted it before. A build that will not run is worse
  than a build someone can read.
- The trust panel was **not** left claiming the file is readable. A claim a
  user can disprove in ten seconds costs more trust than it buys.

---

## 6. Distribution as an npm package

`packages/local-relay/` publishes the relay as **`ssh-monitor-relay`** (name
confirmed available on the registry), installed globally:

```bash
npm install -g ssh-monitor-relay
local-relay --pair --server https://monitor.eaqdragon.com
```

`src/components/RelayTrustPanel.js` now shows this as the recommended path,
with the curl one-liner kept as the fallback.

### Why this is actually safer, not just more comfortable

- **No install lifecycle scripts.** The package declares only `prepack`, which
  runs on the *publisher's* machine. An npm package with no `preinstall`/
  `install`/`postinstall` cannot execute anything at install time — installing
  it is a file copy. This is the whole reason npm beats `curl … | node` here,
  and it is worth stating plainly: `npm install` is **not** inherently safe,
  because lifecycle scripts can run arbitrary code. It is safe *here* because
  there are none.
- Registry integrity verification, semver, `npm audit`, clean removal.
- No pipe-to-shell, and the user can `npm pack` and read the tarball first.

### One source of truth

`scripts/prepack.mjs` copies `public/local-relay.min.js` → `dist/local-relay.js`
at pack time, so the published bytes are byte-identical to what the server
serves at `GET /local-relay.js`. This structurally prevents the F1 class of
drift — and since 1.0.2 the artifact is what both routes ship, so npm users and
curl users run identical (obfuscated) code. Verified: `npm pack` reports 5
files, and the `dist/local-relay.js` inside hashes to the same SHA-256 as the
served file.

> **Deployment trap found on 2026-09-06.** After `server.js` was switched to the
> artifact, the already-running dev server kept serving the *readable source* —
> `server.js` is the custom server and is not hot-reloaded. For those minutes
> the manifest hashed `96d159b9…` while `/local-relay.js` handed out
> `bdd6d059…`, i.e. exactly the F1 failure, live. It resolved on restart.
> **The handler change and the deploy are not atomic**; a prod rollout must
> restart the server in the same step, or verify the served digest immediately
> after. Worth a post-deploy curl:
> `curl -s <host>/local-relay.js | shasum -a 256`.

### To publish

```bash
cd packages/local-relay
npm login                 # once
npm pack --dry-run        # inspect the tarball first
npm publish --access public
```

`ssh-monitor-relay@1.0.0` was published 2026-09-06 to bootstrap the package
(npm will not attach a trusted publisher to a package that does not exist yet).

**`ssh-monitor-relay@1.0.3` is the current release** (2026-09-06). It is the
first version to ship the **built artifact** — 1.0.0 and 1.0.1 published the
readable source, which is the whole reason a new release exists at all.

| Check | Result |
| --- | --- |
| `dist-tags.latest` | `1.0.3` |
| `versions` | `1.0.0, 1.0.1, 1.0.3` |
| `package/dist/local-relay.js` SHA-256 | `96d159b9…5777c` — identical to `public/local-relay.min.js` |
| size | 195,544 bytes |
| built from source | `bdd6d059…c8e8` (`source-sha256` header) |
| readable identifiers (`ensureInstalledScript`, `pairAndGetToken`, …) | 0 |
| `local-relay --help` / `--bogus` | exit 0 / exit 1, from a real global install |

### ⚠ 1.0.2 is dead — never reuse that number

`1.0.2` was published first and **silently vanished**. It is not a
propagation delay; it is wedged and the version can never be used again.

The sequence, so nobody re-diagnoses it:

1. `npm publish` printed `+ ssh-monitor-relay@1.0.2` and exited **0**. The
   debug log shows `http fetch PUT 202` — *202 Accepted*, not the usual 201,
   plus "Your package is being processed and may take a few minutes."
2. ~100 minutes later the packument still listed only `1.0.0, 1.0.1`, and
   `time.modified` was untouched since the 1.0.1 publish. `npm view`, the
   version doc and the tarball URL all returned **404**. No incident on
   <status.npmjs.org>.
3. Retrying gave `npm error code E409` —
   **"Cannot publish over previously staged version 1.0.2."**
4. `npm stage list` → *"No staged packages found."* So there is no stage-id to
   pass to `npm stage reject`, and nothing to clear.

That is a known npm registry bug —
[npm/cli#9889](https://github.com/npm/cli/issues/9889), same signature, same
phantom state: absent from the packument, absent from `stage list`, and
permanently blocking that version number. The only workaround is to abandon
the number. **1.0.3 is the same bytes with a different version field.**

Two rules fall out of this:

- **A 202 is not a publish.** Verify by fetching the tarball and hashing it,
  and treat "exited 0" as meaningless on its own.
- **Never bump a version until the previous one is confirmed live.** Had 1.0.3
  been cut first, 1.0.2 would simply have been skipped with no mystery.

*Do* expect real propagation lag on top of this: the 1.0.1 publish took ~20
minutes to appear in the packument while the tarball 404'd. So a fresh publish
that 404s is normal for the first half hour — the tell that it is the bug and
not lag is the **E409 on retry** and an unchanged `time.modified`.

**Reaching users.** Publishing the package is only half the job. The Local Relay
Agent modal previously showed exactly one install command — the curl one-liner —
and the npm route appeared only inside the collapsed *"Before you run it"*
disclosure, which nobody opened looking for an installer. The modal and the
relay settings card now carry an explicit **npm / Direct download** switch that
defaults to npm, and every copy button follows the selection.

### After 1.0.0: `--help` was not handled

`local-relay --help` set `args.help = true` and fell straight through: the relay
started and dialled the default server. For an npm user that is the first
command they run. Fixed — `--help` prints usage and exits 0, an unknown flag
exits 1 naming the bad flag, and the capability notices ("node-datachannel not
found") are suppressed so the usage text stands alone. Ships in 1.0.1.

Also observed on install: npm 11 blocks install scripts by default, so
`node-datachannel` (native) is not built and the relay runs in WebSocket mode.
That is the documented fallback and works, but it means the relay's own
`ensureInstalledScript()` install will hit the same block for users on new npm.

### Still open

- **The npm package still runs a dependency install it does not need.**
  `ensureInstalledScript()` copies itself into `~/.ssh-monitor-relay/` and then
  installs `ssh2`/`ws`/`node-datachannel` there, even when the relay arrived
  from npm with those already present. F5 bounded and split that install, but
  did not skip it. Skipping is *not* a one-line change: the copied script
  resolves modules relative to its own `__dirname`, so dropping the local
  `node_modules` would leave the installed copy unable to find `ssh2`. It needs
  the package root recorded in the config and added to the search path.
- **`public/monitor-agent.js` still has the F2 shape, and now matches F1's new
  model by accident rather than by design.** It is distributed as
  `monitor-agent.min.js` (built by `build:agent` with
  `javascript-obfuscator`), and the install snippets in the UI curl that
  minified file — so it does not drift, but it also has none of the guardrails
  the relay now has: no `source-sha256` stamp, no `--check` gate, no
  no-fallback rule in the server. Its agent WebSocket also takes its token from
  `?token=` (F2). Left alone deliberately — it is live in existing install
  snippets and is a separate change with its own rollout. **When it is next
  touched, the cheapest real fix is to make it go through the same build
  script the relay uses**, so both artifacts inherit the same drift protection
  instead of maintaining two subtly different pipelines.
- The relay has **no self-update logic at all**, despite the comment at
  `server.js:513` claiming it re-fetches `/local-relay.js`. That comment is
  stale. It is also good news for npm: an npm-installed relay will not
  overwrite itself with server-served bytes.
