# nanobot Web UI — `GET /api/settings → 401 Unauthorized`: root cause & fix

Date: 2026-09-05
Verified against: connection `fc-debian-isolt` (`6a941c72e27dead0770a9ad5`), local relay on `sniperkla.local`

---

## TL;DR

Two independent defects, both now fixed:

1. **The "Open in New Tab" button could open the WRONG nanobot instance.**
   The route hardcoded `localPort: 18790`. When a gateway for a different connection
   already held 18790, the relay silently bound 18791 — but the app still opened
   18790 and got the other instance, whose bootstrap secret didn't match →
   `401 Unauthorized`. **This was the reported symptom.**

2. **`action: 'install'` threw a `ReferenceError`** (`GW_FLAGS` used outside the
   scope it was declared in), so installing nanobot could not complete.

---

## 1. Wrong-instance bug (the 401)

### How the flow works

```
browser → monitor /api/agents/nanobot (webui-ctl, op=relay-start)
        → monitor sends `webui:forward` over the relay WS
        → Local Relay opens an SSH tunnel, serves 127.0.0.1:<localPort>
        → monitor replies { localPort } → browser opens a tab at that port
```

`localPort` was pinned to `18790` in **both** the forward message and the HTTP
response (`src/app/api/agents/nanobot/route.js`).

The relay treats it as a hint only:

```js
// public/local-relay.js — handleWebuiForward()
server.once('error', (e) => {
  if (attempts < 10 && e.code === 'EADDRINUSE') { gw.port += 1; attempts += 1; tryListen(); }
  else reject(e);
});
```

It walks up to 18791, 18792… and **never told anyone**. So the second connection
always got the first connection's gateway.

### Why that produced a 401

`43.210.221.54` is one IP fronting **two different containers**:

| connection | SSH port | container | Python | `/webui/bootstrap` |
|---|---|---|---|---|
| `fc-fedora40` | 2232 | `e037df09bb6e` | 3.12.10 | **401** (secret required) |
| `fc-debian-isolt` | 2236 | `5cb40b956629` | 3.11.2 | **200** (open) |

Observed live: local `:18790` served `Server: Python/3.12` — i.e. `fc-fedora40` —
while the user was opening `fc-debian-isolt`. The SPA bootstrapped against an
instance that demands a secret the app never had, so every `/api/*` call answered
`401 Unauthorized`. Exactly the reported error.

Diagnostic signature that gave it away:

```
local  :18790  / -> 200 | /webui/bootstrap -> 401 | Server: Python/3.12
remote  :8765  / -> 200 | /webui/bootstrap -> 200 | Server: Python/3.11
```

Two different Python versions ⇒ two different processes ⇒ the tunnel was pointed
somewhere other than the connection being opened.

### Fix

Three-sided handshake, so the port is *reported* instead of *assumed*:

- **`public/local-relay.js`** — after binding (and on the "already running"
  early-return), ack `{ type: 'webui:ready', forwardId, localPort }` over the
  existing relay socket via `activeWs`.
- **`server.js`** — added `global.__webuiForwardWaiters` +
  `global.__waitForWebuiForward(forwardId, timeoutMs)`, and a `webui:ready`
  branch in the `/relay-ws` message handler.
- **`src/app/api/agents/nanobot/route.js`** — registers the waiter *before*
  sending (so a fast ack can't be missed), awaits it, and returns the real port
  plus a new `portConfirmed` flag.

Backwards compatible: an older relay that doesn't ack simply times out and falls
back to `18790` — today's behaviour, no regression.

### Verification

A stand-in relay was run for the test account with `127.0.0.1:18790` deliberately
pre-occupied (reproducing "another gateway got there first"):

```
relay-start: status=200 success=true localPort=18791 portConfirmed=true (1194ms)
[fake-relay] ← webui:forward localPort=18790
[fake-relay] → webui:ready 6a941c72…8765 BOUND port=18791
```

The old code returned `18790` here; the fix returns `18791`.

---

## 2. `ReferenceError: GW_FLAGS` on install

`GW_FLAGS` was a `const` declared inside the gateway helper (was line 244) but
referenced from the `action === 'install'` branch (line ~867), which is a
different block:

```js
`NBSTARTSCAN=1; setsid nohup ${NBE} gateway${GW_FLAGS} >> …`
```

Evaluating that template literal threw, aborting the install. The comment above it
("Pass GW_FLAGS so every install carries its config/workspace marker") confirms
the intent.

**Fix:** hoisted `GW_FLAGS` next to `GW_PORT` in the shared scope and removed the
inner duplicate, so the helper and the installer use one definition.
`eslint --rule '{"no-undef":"error"}'` on the route now reports **0 errors**
(previously 1).

---

## 3. Data repair: undecryptable SSH credential

`fc-debian-isolt` answered `500 {"error":"Decryption failed"}`. Not caused by the
WebUI work — `decrypt()` runs before any of it.

Findings:

- Format is `iv:ciphertext` (no salt); `salt:iv:ct` belongs only to the
  *password-derived* helpers. Initial triage used the wrong layout and produced a
  misleading "all 4 connections broken" result.
- With the correct layout: **3 of 4 encrypted connections decrypt fine**. Only
  `fc-debian-isolt` (created 2026-08-30) failed, against `ENCRYPTION_KEY`,
  `NEXTAUTH_SECRET` **and** `ENCRYPTION_KEY_OLD`.
- Records created both before (2026-06-23, 2026-08-26) and after the `.env`
  mtime (2026-08-23) decrypt fine ⇒ the key never rotated. This one record was
  written under a key that isn't in `.env` today (most likely a shell-exported
  `ENCRYPTION_KEY`, which wins over `.env` in `server.js`).

**Repair:** reused the credential from the sibling connection `fc-fedora40`
(same host), proved it authenticates against `root@43.210.221.54:2236` over SSH,
then re-encrypted `fc-debian-isolt` under the current key. Rollback artifact:
`/tmp/bad-conn-password.backup.json`. The plaintext was never printed or logged.

---

## 4. Note on the bootstrap secret

`nanobot`'s `_webui_bootstrap_secret()` returns `tokenIssueSecret or token` from
the websocket channel. For `fc-debian-isolt` both are unset, so the instance runs
**open**: `/webui/bootstrap` issues a token even with a bogus `X-Nanobot-Auth`
header, and `_webui_browser_url()` emits a bare URL with no `bootstrapSecret`.

So `webUIBootstrapPath: "/"` is **correct** for this instance — nothing to fix.
An earlier URL the user used (`…/#/?bootstrapSecret=Ph163J7…`) worked *despite*
the secret, not because of it.

---

## Files changed

| File | Change |
|---|---|
| `public/local-relay.js` | ack `webui:ready` with the port actually bound |
| `~/.ssh-monitor-relay/local-relay.js` | redeployed from source (relay restarted) |
| `server.js` | `webui:ready` handler + `__waitForWebuiForward` waiter registry |
| `src/app/api/agents/nanobot/route.js` | await real port, return `portConfirmed`; hoist `GW_FLAGS` |
| DB `connections` | `fc-debian-isolt` credential re-encrypted under current key |

Services restarted: monitor (`node server.js`, :3030) and the `com.ssh-monitor.relay`
launchd agent. Both verified healthy.

---

## Still open (pre-existing, not touched)

- **No re-push of `webui:forward` on relay reconnect.** `webuiGateways` is
  in-memory in the relay, so a relay restart drops every gateway until the user
  clicks again. A monitor restart does *not* drop them.
- `fc-fedora40`'s Web UI requires a bootstrap secret that the monitor cannot
  discover (it isn't in `config.json` or any log). That instance will keep 401-ing
  until `tokenIssueSecret` is set in its config or the monitor learns to read it.
- `/api/rclone/*` relies on middleware-only auth.
- `connect-src` for port 18790 in `src/proxy.js` is not production-gated.
