# AI Agents: "works on MacBook, can't fetch data on mobile"

**Symptom:** with the MacBook-installed Local Relay selected, AI Agents loads on the
MacBook but returns no data on a phone.

**Status:** root-caused and fixed. Four chained defects; the last one is the one
that actually produced the symptom, and it was reproduced in a real browser.

---

## The decisive measurement

Same app, same connection (`fc-debian-isolt`, 43.210.221.54), same request.
**Only the `x-ssh-mode` header differed:**

| `x-ssh-mode` | Result |
|---|---|
| `server` | `200` — `{"success":true,"installed":true,"version":"OpenAI SDK: 2.24.0",...}` |
| `local`  | `500` — `{"success":false,"error":"Local Relay Agent is not connected..."}` |

Reproduced with `tmp/mb-harness/phone-sim.mjs` (headless Chrome, 390×844, touch).

---

## Defect 4 — the actual cause

`ssh_monitor_ssh_mode` is pinned **per account, not per device**. `AppContext`
writes `local` for *any* browser that sees the user's relay
(`src/context/AppContext.js:643`). A phone can never run a relay, but it still
sends `x-ssh-mode: local`.

`resolveSshConfig` then treated that as a **hard requirement**:

```js
if (isLocalhost(sshConfig.host) || options.sshMode === 'local') {
  ...
  if (!relay || !relay.ws) throw new Error('Local Relay Agent is not connected...');
```

So every agent call 500'd — even for public-IP targets the server can reach
directly — whenever no relay socket was live at that moment (MacBook asleep,
relay service stopped, or the request simply coming from a device with no relay).

**Fix** (`src/app/api/server-backup/_ssh.js`): a relay is only *strictly*
required to reach the user's own machine. When no relay is found **and** the
host is not localhost, return the config unchanged and connect directly, with a
`logger.warn`.

**Localhost still throws.** Falling back there would make the server dial its
own loopback — that is an SSRF hole, and it is precisely what the throw exists
to prevent. The fallback is gated on `!hostIsLocal` and a test pins it.

After the fix: `200`, `x-ssh-mode: local` still sent, no error in the UI.

---

## Defects 1–3 (fixed in the previous session, now verified in-browser)

1. **`AIAgentsApp` never received `apiFetch`.** It was the only app taking it as
   a *prop*, but the window manager mounts apps with no props, so it silently
   fell back to bare `fetch()` — dropping `x-ssh-mode` / `x-preferred-relay`.
   Now resolved from context: `apiFetch || ctxApiFetch || fetch`.
2. **"Continue with direct connection" only flipped React state** — requests
   kept routing through the relay the user had just bypassed, and the choice
   reset on remount. Now it writes `ssh_monitor_ssh_mode=server`.
3. **`AppContext` re-pinned mode back to `local` within seconds**, undoing (2).
   Now guarded by `ssh_monitor_relay_optout`.

Browser-verified: clicking the bypass writes `mode: server`, `opt-out: 1`, the
gate clears, and the next `/api/agents/hermes` returns `200` with real data.

---

## Verification

- `npm test` → **408/408** (3 new tests for defect 4)
- eslint on changed files → **0 errors** (pre-existing warnings only)
- `next build` → OK
- **Mutation-tested** so the new tests are not vacuous:
  - remove the fallback → 2 tests fail
  - make it unconditional (SSRF) → the localhost guard test fails

---

## Known remaining limitation

The **Web UI** button still navigates to `http://127.0.0.1:<port>`, which only
resolves on the machine running the relay. Opening it from a phone cannot work
without routing it through the central proxy — a design decision, not a bug fix,
so it was left alone.

---

## Harness gotchas (for anyone re-running the probes)

- `useSupporter` gates on `data.success`. A stub of `{isSupporter:true}`
  **without** `success:true` silently resolves to "not a supporter", so the app
  never leaves the supporter screen and the probe looks broken.
- Detecting the relay gate with `/Local Relay Required/i` is ambiguous — the
  per-agent-card Web UI badge renders the same string in the *normal* UI. Match
  the full gate heading (`/Local Relay Required Fast Agent Telemetry/`).
