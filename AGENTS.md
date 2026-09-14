# AGENTS.md — resume here

**Project:** `~/Desktop/monitor` · **Branch:** `nextgen16`
**Production:** https://monitor.eaqdragon.com · **Dev:** `npm run dev` → http://localhost:3030
**Test box:** connection `fc-fedora40` (`43.210.221.54:2232`, user `root`, Fedora 40 container)

This file is the handoff. It exists so any compatible agent — Claude, Codex, whatever
comes next — can pick this up without re-deriving a week of hard-won context. Read it
before touching the agent Web UI code. It is written to be *specific and load-bearing*:
every rule below is here because breaking it cost real debugging time.

---

## 1. What this app is

A Next.js 16 App Router app with a **custom `server.js`** (CommonJS) and socket.io.
The custom server is not optional — it owns the WebSocket upgrade path for the SSH
terminal and for the agent Web UI tunnel. Dev and prod both run `node server.js`.

- `src/app/api/agents/<id>/route.js` — one route per agent (`hermes`, `nanobot`,
  `zeroclaw`, `openclaw`). Each exports `POST` and dispatches through
  `dispatchWithLiveLogs(body, handler)` from `_jobs.js`.
- `src/apps/AIAgentsApp.js` — the agent window UI (tabs, Web UI card, start/stop).
- `src/apps/AgentWebUIBrowserApp.js` — the in-app browser that renders a tunneled dashboard.
- `src/app/api/agents/webui-proxy/` — the same-origin reverse proxy (see §3).
- `src/app/api/server-backup/_ssh.js` — pooled SSH. **Note the odd path**; it is not
  under `server-backup` by accident of history, and lots of routes import it.
- `scratch/` — gitignored ad-hoc harnesses. See §7; they are the real test suite for
  anything that needs a live server.

---

## 2. The feature: launching an agent's Web UI

Every agent has a Web UI card. `webui-ctl` is the control op; `details` reports state.

### Two flavours — and why the Stop button differs

| flavour | agents | dashboard served by | Stop button |
|---|---|---|---|
| **separate process** | `nanobot`, `hermes` | its own `webui` process | **yes** — stopping is side-effect free |
| **agent process** | `zeroclaw`, `openclaw` | the agent's own `daemon`/`gateway` | **no** |

For the second kind the dashboard runs on the same port as the agent's channels, so
stopping it takes the agent offline. `WEBUI_IS_AGENT_PROCESS` in `AIAgentsApp.js` gates
that. The Overview tab's Gateway controls own the destructive action, where the
consequence can be named.

### Ports

| agent | dashboard port | relay local-port hint |
|---|---|---|
| hermes | 9119 | 18791 |
| nanobot | 8765 | 18790 |
| zeroclaw | 42617 | 18792 |
| openclaw | 18789 | 18793 |

`instancePort(..., 18000)` skips 18780–18799, so a tagged instance never lands on a hint.
`WEBUI_DEFAULT_PORT` in `AIAgentsApp.js` is the single client-side map — do **not**
reintroduce a ternary like `agent.id === 'hermes' ? 9119 : 8765`; that silently gave
every new agent nanobot's port.

### Contracts (identical across all four routes)

- `webui-ctl` ops: `status | start | stop | restart | relay-start`. Anything else is
  coerced to `status`.
- `details` Web UI fields: `webUIPort`, `webUIActive`, `webUIBind`, `webUILoopback`,
  `webUIBootstrapPath`.
- `webUIActive` must be a **live HTTP probe**, never the process table.
  `active = code >= 200 && code < 500` — a 401/403 means something *is* serving (auth is
  on); only connection-refused (`000`) means down.
- `relay-start` **never returns a guessed port**: relay-reported failure → **502**
  quoting the relay, genuine timeout → **504**, relay not connected → **409**.
  Register the ack waiter **before** sending the forward message, or the relay's reply
  can arrive before you are listening.

### Adding a new agent's Web UI — the checklist

1. **Route** — add a `webui-ctl` block and the live-probe fields to `details`. Reuse
   `webUIProbeShell` / `parseWebUIProbe` / `startWebuiRelayTunnel` from
   `src/app/api/agents/_webui-relay.js`. Do **not** hand-copy the relay handshake;
   it is ~90 lines of ordering-sensitive code.
2. **Client** — add to `WEBUI_START_AGENTS`, `WEBUI_DEFAULT_PORT`, and
   `WEBUI_IS_AGENT_PROCESS` if the agent's own daemon serves the dashboard.
3. **Browser** — add to the `AGENT_WEBUI` table in `AgentWebUIBrowserApp.js`.
4. Pick an unused relay local-port hint.

> hermes and nanobot still carry **inline copies** of the probe/relay code. They work and
> are heavily exercised, so they were deliberately left alone. Migrating them is a
> separate, testable change — do not fold it into an unrelated fix.

---

## 3. Two ways to reach a dashboard — NOT interchangeable

The difference is **who dials**.

**Central proxy** — `/api/agents/webui-proxy/m2/<connectionId>/<port>/…`
The *monitor* dials the agent over SSH. Works from any device including a phone.
Because the dashboard is served under a **sub-path** of the monitor origin, the proxy
must rewrite asset URLs and inject a fetch/XHR helper. Bigger HTML. The forwarded-header
rule (§4) applies.

**Local Relay direct transfer** — `webui-ctl` op `relay-start`
The relay on the *user's own machine* opens the tunnel and serves the dashboard at
`127.0.0.1:<localPort>`. A **raw passthrough**: no rewriting, no injected helper, because
the dashboard sits at that origin's *root*.
Its HTML is legitimately smaller (measured 2,234 B vs 19,486 B for zeroclaw). **Never
assert a byte count here — assert completeness** (DOCTYPE + `</html>`). A smaller relay
copy is expected, not truncation.

### Which one is the user actually using? (`src/utils/webuiOpenMode.js`)

The app lets the user pick a transport per device, and this is the first thing to check
when a report says *"it works in a new tab but not embedded"*:

- `'in-app'` — framed inside monitor → the **same-origin proxy**.
- `'external'` — a real browser tab → **Local Relay direct transfer** if the relay is on
  that host, otherwise the same-origin proxy.

So "works in a new tab, blank when embedded" usually means **proxy vs passthrough**, not a
framing problem. Measured: loading the proxy URL top-level and inside a same-origin frame
produces **identical** rendered text (hermes 849 chars both ways), so framing is ruled out.

### What each dashboard needs for its live data

| agent | live channel | renders through the proxy? |
|---|---|---|
| hermes | WebSocket | **yes** — full nav, all API calls 200 |
| zeroclaw | **SSE** (`GET /api/events`) | was starved; see §4 |
| nanobot | WebSocket | yes |
| openclaw | WebSocket | yes |

Grep the **lazy chunks**, not just the entry — the stream client usually lives in a route
chunk, and a hand-rolled `fetch` + `getReader()` client contains no `EventSource` token, so
grepping for that reports 0 either way. `scratch/probe-agent-streaming-needs.mjs` does the
walk.

### The path key must be a PATH SEGMENT

`ASSET_KEY = 'm2'` is duplicated in files that cannot import each other, and
`tests/webui-proxy-key.test.mjs` pins every copy. It must never be a query suffix:
RFC 3986 relative resolution **drops the base query string**, so the coordinates
evaporate on the first lazy `import()` and the app sits on its boot splash forever.

---

## 4. Rules that are easy to get wrong

### Forwarded-identity headers must be dropped — on BOTH paths

The monitor sits behind Cloudflare, so requests arrive carrying `x-forwarded-*`. But the
monitor is the **direct client** of the agent over the SSH tunnel, so none of those are
true at that hop. OpenClaw classifies any `forwarded`, `x-real-ip` or `x-forwarded-*`
from a non-trusted peer as an unattributable proxy and answers **403
`proxy_attribution_required`**.

Measured on the live gateway, one header at a time:

| header | HTTP | WS upgrade |
|---|---|---|
| none | 200 | 101 |
| `X-Forwarded-Proto` / `-Host` / `-For` | 403 | 403 |
| `X-Real-IP` | 403 | 403 |
| `Forwarded` | 403 | 403 |
| `CF-Connecting-IP` | 200 | 101 |

Two things to carry forward:
- The **WS upgrade is the same gate**. Fixing only the HTTP route leaves the dashboard
  rendering with its live socket refused.
- The original filter dropped `x-forwarded-for` and `cf-connecting-ip` — i.e. it kept the
  one header OpenClaw tolerates and forwarded every one it rejects. Both copies live in
  `webui-proxy/route.js` and the `upgrade` handler in `server.js`, and they cannot import
  each other. `tests/webui-proxy-forwarded-headers.test.mjs` pins both.
- `authorization` is deliberately **not** stripped: agent UIs mint their own short-lived
  token and send it back as `Authorization: Bearer …`. Dropping it 401s every `/api/*`.

### A bare loopback origin is a BASE, not a URL

Bundles do `${gatewayBase}/api/events`. The gateway base is the bundle's own
`window.__X_GATEWAY__ ?? "http://127.0.0.1:<port>"`, which the proxy rewrites.

Mapping a bare origin to the **query** form (which ends in `path=%2F`) made that
concatenation produce `//api/events` → no gateway route → **the SPA's index.html with a
200**. The client checked only `res.ok` and `res.body`, saw both, consumed HTML as an
event stream, received zero events, and — because the stream ended cleanly — **never
errored and never retried**. The chrome rendered; the content pane stayed empty forever.

Bare origins now rewrite to the **path-keyed prefix** (no trailing separator), so
appending a path lands correctly. See `src/app/api/agents/_webui-rewrite.js`.

### Event streams must be STREAMED, not buffered

`httpOverSocket` resolves on `end`. An SSE response never ends, so through that path a
browser got **nothing for 30 s and then one stale burst** (measured against a controlled
SSE origin: 30.5 s to first byte). Requests with `Accept: text/event-stream` now take
`httpOverSocketStreaming` + `eventStreamResponse`, which resolves on **headers** and
pipes a `ReadableStream`. After the fix: first byte at **0.18 s**.

- No body timeout on a stream — a feed is *supposed* to stay open. End-of-life is the
  client going away, handled in `cancel()`.
- `content-length` is dropped (unknown), and **`x-accel-buffering: no` is set**: nginx
  buffers proxied responses by default, so without it the app works on localhost and
  hangs in production. Cloudflare passes `text/event-stream` through.
- Any agent UI with live data is a candidate for this. Check with
  `grep -o 'text/event-stream' <bundle>`.

### Probe fallbacks

The port probe must fall back to `/proc/net/tcp` — minimal images (fc-fedora40) have **no
`ss`, `netstat`, `lsof` or `fuser`**. Without the fallback a loopback-bound dashboard
reads as "not loopback" and the UI hides the only route that works from a phone.

### Shell fragments interpolated before `echo`

zeroclaw's `broadKill` was missing its trailing `;`, so the shell parsed
`true echo GW_STOPPED` — `true` swallowed the marker, and "Stop gateway" reported
`success:false` for a stop that had actually worked. If you interpolate a fragment
immediately before a marker `echo`, **end it with `;`**. Both new `webui-ctl stop` paths
decide by port probe rather than marker for exactly this reason.

---

## 5. Tests

```bash
npm test          # node --test, spec reporter
```

- Current baseline: **571 tests / 7 suites / 0 fail** (~16 s).
- The spec reporter prints `ℹ tests N` / `ℹ pass N` / `ℹ fail N`. It does **not** print
  TAP `#` lines — count `✔`/`✖` or read the `ℹ` summary.
- `tests/_register-hooks.mjs` registers the `@/` alias for `node --test`, so tests *can*
  import `src` ESM modules directly (8 files do).

**Prefer calling real code over regex-matching source.** A source-pinning assertion that
is sloppy about *which* occurrence it matches fails for the wrong reason and costs more
than it saves. Four of my own tests were wrong this way in one session:

1. A bare `/Error/i` on dashboard HTML matched OpenClaw's own inline
   `throw new Error("gateway unavailable")`. Match the proxy's error shells by their
   distinctive copy.
2. `body.length > 200` failed on OpenClaw's legitimate **60-byte** ES-module stub. Assert
   content-type and walk the import graph instead.
3. `indexOf('__waitForWebuiForward')` vs `indexOf('__sendToRelayForUserAny')` compared a
   *guard* against the waiter, inverting the result. Match the **calls** (with parens).
4. Flagging `localPort: 18791` as "inventing a port" — it is the **request hint**. The
   response port comes from the ack.

Two more traps: `new Client()` appears in comments, so match the assignment form
`= new Client()`; and "slice from this match to the next" is empty when two matches are
adjacent — slice to the next `export function`.

That is why `rewriteAbsoluteSelfUrls` / `collapseLeadingSlashes` were split into
`_webui-rewrite.js`: dependency-free, so tests call them for real.

---

## 6. Local Relay testing recipe

Never repoint the user's production relay service. Run a **second, isolated** one.

The relay's config path is hardcoded to `~/.ssh-monitor-relay.json`, so override `HOME`
rather than looking for a flag:

```bash
HOME=/tmp/relaydev node ~/.ssh-monitor-relay/local-relay.js \
  --server http://localhost:3030 --token <minted> --name relaydev
```

`--server/--token` runs in the foreground and does **not** install a service. There is no
single-instance lock, so this coexists with `com.ssh-monitor.relay`.

**Two gates bite here:**

- The relay needs `supporter.status = 'active'` on its user (`scratch/grant-supporter.mjs`).
  Already granted to `ui-test@local.test` and left set.
- The WS gate caches that verdict for **5 minutes** (`global.__relaySupporterCache` in
  `server.js`). Granting supporter and retrying immediately still gets
  `4003 SUPPORTER_REQUIRED` while `/api/relay/token` cheerfully reports
  `isSupporter:true` — they read through different paths. **Restart the dev server.**

---

## 7. Scratch harnesses (`scratch/`, gitignored)

These are not optional extras — for anything needing a live server they are the test suite.

- `lib-probe.mjs` — CSRF-aware API client + minted NextAuth session.
- `e2e-zc-oc-webui.mjs` — lifecycle (stop/start/probe). Most SSH-intensive.
- `e2e-webui-proxy-zc-oc.mjs` / `e2e-proxy-all4.mjs` — proxy HTML + asset + ES-module graph.
- `e2e-relay-start.mjs` — Local Relay direct transfer.
- `ssh-probe.mjs` — direct SSH using the app's own vault `decrypt()`. The way to run
  anything on the box.
- `probe-oc-attr-headers.sh` — the raw header-attribution table in §4.
- `diag-zeroclaw-content.mjs` — loads a dashboard in headless Chrome and reports console
  errors, non-2xx and the SPA's own API calls. The tool that found the SSE bug.
- `grant-supporter.mjs`, `mint-relay-token.mjs`.

**Harness gotchas:** the session JWT must carry **ObjectId-shaped** `sub`/`dbId` (a bare
`'probe'` 500s `/api/connections`); the CSRF cookie is minted only on middleware-matched
paths (prime with `GET /api/connections`, not `/api/auth/session`); job polling takes a
**flat** `{ jobId, cursor }`; ship multi-line remote scripts base64-encoded. And
`redirect: 'manual'` on `<keyedPrefix>/` hands you the **57-byte 308 stub** instead of the
dashboard — follow redirects when scraping a proxied page, or your entry-chunk extraction
silently finds zero scripts.

Also: `pkill -f '<pattern>'` over SSH **matches its own shell** and kills your command.
Use a bracket trick (`'[s]se_test'`) or check by port instead.

---

## 8. Environment quirks

- **The test box has no `ss`/`netstat`/`lsof`/`fuser`** — only `curl`, `python3` and
  `/proc`. PID 1 is `sshd`, so `systemctl --user` cannot work.
- **The box accumulates stale root sessions** (`MaxStartups 10:30:100`, `MaxSessions 10`)
  that do **not** drain. This makes the lifecycle e2e flaky when run first in a sweep:
  signature is always `Timed out while waiting for handshake` — an SSH-layer failure
  *before* any route code runs. It passes **40/40** alone on a quiet box. Treat that
  failure as capacity, not code, and do not reap sessions on a shared box unasked.
- **Production does not auto-deploy.** There is no deploy workflow; non-interactive SSH to
  the host is denied. Pushing changes nothing on the live site. Check before concluding a
  fix "didn't work".

---

## 9. Working conventions

- **Local commits only.** The repo deliberately keeps commits unpushed; ask before pushing.
- Conventional-commit subjects (`fix(agents): …`, `chore(memory): …`).
- Keep `src/app/api/agents/_webui-relay.js` and `_webui-rewrite.js` as the single copies of
  their logic — drift between duplicated copies is what caused the forwarded-header bug.
- Report the scoreboard honestly. If a recommendation turns out to be already implemented,
  say so and show the line rather than silently re-applying it.

---

## 10. Status at handoff (2026-09-14)

**Committed locally, not pushed.**

- `7192fca1 fix(agents): make the tunneled agent Web UIs actually work`

Shipped in this round:

- ZeroClaw + OpenClaw Web UI launch (`webui-ctl`, live-probe `details`, relay hints).
- OpenClaw 403 fixed on HTTP **and** WS.
- ZeroClaw empty-content-pane fixed (base rewrite + slash collapse + SSE streaming).
- `_ssh.js` pre-ready connection leak fixed at three sites.
- Four new test files; `npm test` 547 → **571**.

Verified live against `fc-fedora40`:

- `npm test` 571/571, eslint clean on changed files.
- Proxy e2e across all four agents: **24/24**.
- SSE through the proxy: first byte **0.18 s** (was 30.5 s, buffered).
- OpenClaw through the proxy **with the full Cloudflare forwarded-header set present**:
  200, real dashboard, no `proxy_attribution_required`.
- The rewritten bundle now builds `<keyedPrefix>/api/events`, and that path reaches the
  real gateway route (401 = auth required, not the SPA fallback).
- hermes renders fully through the proxy (top-level *and* embedded, identical).

### Open items

1. **Nothing above is deployed.** Production is on an older bundle and does not auto-deploy.
   This is the single most likely reason a fix "didn't work". The OpenClaw 403 the user
   re-reported was exactly this — the fix had never left the working tree.
2. **ZeroClaw's content pane is fixed but not yet confirmed in a logged-in browser.** The
   gateway stores device tokens encrypted (`enc2:…` in
   `/root/.zeroclaw/config.toml` → `gateway.paired_tokens`), so a fresh headless session
   stops at the pairing gate ("already paired"). Verification was therefore done at the
   transport level (the three bullets above). **Worth a human eyeball** — and do not
   re-pair the gateway to get one without asking; adding a device is a mutation of the
   user's setup.
3. `scratch/e2e-webui-card-all4.mjs` is written but never run — it renders the Web UI card
   for all four agents in two passes. The UI card is currently covered only by
   source-regex tests.
4. `webUIProbeShell`'s `/proc/net/tcp` fallback is IPv4-only. Low value: an IPv6-only bind
   also fails the `curl 127.0.0.1` probe, so it surfaces as a visible "down" rather than a
   silent wrong answer.
5. hermes/nanobot still use inline copies of the probe/relay code (§2).
