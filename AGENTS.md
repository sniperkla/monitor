# AGENTS.md — resume here

**Project:** `~/Desktop/monitor` · **Branch:** `nextgen16`  
**Production:** <https://monitor.eaqdragon.com> · **Dev:** `npm run dev` → <http://localhost:3030>  
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

| flavour              | agents                 | dashboard served by                | Stop button                            |
| -------------------- | ---------------------- | ---------------------------------- | -------------------------------------- |
| **separate process** | `nanobot`, `hermes`    | its own `webui` process            | **yes** — stopping is side-effect free |
| **agent process**    | `zeroclaw`, `openclaw` | the agent's own `daemon`/`gateway` | **no**                                 |

For the second kind the dashboard runs on the same port as the agent's channels, so  
stopping it takes the agent offline. `WEBUI_IS_AGENT_PROCESS` in `AIAgentsApp.js` gates  
that. The Overview tab's Gateway controls own the destructive action, where the  
consequence can be named.

### Ports

| agent    | dashboard port | relay local-port hint |
| -------- | -------------- | --------------------- |
| hermes   | 9119           | 18791                 |
| nanobot  | 8765           | 18790                 |
| zeroclaw | 42617          | 18792                 |
| openclaw | 18789          | 18793                 |

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

*The* difference is **who dials**.

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

| agent    | live channel                | renders through the proxy?            |
| -------- | --------------------------- | ------------------------------------- |
| hermes   | WebSocket                   | **yes** — full nav, all API calls 200 |
| zeroclaw | **SSE** (`GET /api/events`) | was starved; see §4                   |
| nanobot  | WebSocket                   | yes                                   |
| openclaw | WebSocket                   | yes                                   |

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

| header                                 | HTTP | WS upgrade |
| -------------------------------------- | ---- | ---------- |
| none                                   | 200  | 101        |
| `X-Forwarded-Proto` / `-Host` / `-For` | 403  | 403        |
| `X-Real-IP`                            | 403  | 403        |
| `Forwarded`                            | 403  | 403        |
| `CF-Connecting-IP`                     | 200  | 101        |

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

### Never address the proxy with an invented connection id

`connectionId` is a **database id**. `local` is the `sshMode` **sentinel** — they are not  
interchangeable, and passing the latter as the former produces a 500, not a fallback:

```
getSshConfig('local') → repo.findById('local') → null → throw 'Connection not found'
GET /api/agents/webui-proxy/m2/local/9119 → 500
```

The agent-shortcut branch of `AgentWebUIBrowserApp.navigateAddress` did exactly this  
(`connectionId || 'local'`). It fired for **every** agent bookmark on the Explore page,  
because the desktop mounts that app with no connection at all:

```js
// DesktopEnvironment.js
{ id: 'browser', title: 'Web Browser', component: <AgentWebUIBrowserApp initialMode="explore" /> }
```

`probeTab()` then turned the 500 into a "Web UI Unreachable" card quoting the raw HTML  
error body — a misleading message for "you haven't picked a server". Resolve from real  
state (`src/utils/tunnelConnection.js`) and, when there is none, say so; never invent an  
id. The proxy route agrees on the shape: `/^[A-Za-z0-9_-]{6,64}$/` rejects `local`.

### The path marker is VERSIONED — never hardcode it

A path-keyed proxy URL is `/api/agents/webui-proxy/<marker>/<cid>/<port>/…`, where  
`<marker>` is `ASSET_KEY` in `webui-proxy/route.js` — currently **`m2`**, bumped from  
`m` on 2026-09-13 to evict a poisoned asset cache. **The HTTP catch-all imports that  
constant; `server.js` is CommonJS and cannot**, so its WS upgrade parser hardcoded the  
marker — and was not bumped with it:

```js
// server.js, handleWebUIProxyUpgrade — WRONG
u.pathname.match(/^\/api\/agents\/webui-(?:ws-)?proxy\/m\/([^/]+)\/(\d+)…/)
```

Every WS upgrade on a URL the app actually mints then parsed to no coordinates and hit  
`destroy()` — **silently**, with no HTTP status, which a hosted dashboard renders as an  
auth failure. Measured with only the marker varying:

| URL | result |
|---|---|
| `/api/agents/webui-ws-proxy?connectionId=…&path=%2F` (query form) | 101, alive, 1 frame |
| `/api/agents/webui-proxy/m2/<cid>/18789/` (what the app mints) | **socket hang up** |
| `/api/agents/webui-proxy/m/…` (the stale marker) | 101, alive, 1 frame |

Now `/m\d*/`. `tests/webui-ws-path-key.test.mjs` pins the pattern against the **live  
`ASSET_KEY` value** — because the older assertion in `webui-proxy-assets.test.mjs` pinned  
the literal, so it kept passing while the pattern stopped matching anything.

**Measure liveness, not the handshake.** "Did it open" is too weak: the monitor's upgrade  
listener is a `prependListener`, so Next's dev-server upgradeHandler still sees the same  
request. Hold the socket and check it survives — the OpenClaw gateway pushes a  
`connect.challenge` frame immediately, so a healthy tunnel is unmistakable.

### OpenClaw's Control UI needs a *gateway token*, and the bootstrap fragment is not one

Symptom: the Control UI loads fine but shows *"This Gateway expects its token"* /  
*"…rejected the supplied Gateway secret"*. **This is not a monitor bug** — the socket  
reaches the gateway (101 + `connect.challenge`), and the gateway itself refuses the  
handshake. Two things must both be true to diagnose it, and both are checkable:

- **Does the target have a gateway token at all?** `~/.openclaw/openclaw.json` should  
  carry one. A config of just `{"gateway":{"mode":"local","bind":"loopback"}}` has none,  
  `secret_store_entries` in `~/.openclaw/state/openclaw.sqlite` is empty, and  
  `openclaw dashboard --json` self-reports **`"tokenIncluded": false`**. With no token  
  configured, *nothing* can match, so every attempt fails.
- **What does the gateway log say?** `~/.openclaw/logs/gateway.log` distinguishes the two  
  failure modes, and they are not interchangeable:

  | log field | meaning |
  |---|---|
  | `auth=none reason=token_missing` | the UI presented nothing |
  | `auth=password reason=token_mismatch` | the UI presented a secret and it was rejected |

  `token_mismatch` is what the user sees as "rejected the supplied Gateway secret". The  
  gateway's own `guidance=` field names the repair:  
  `openclaw doctor --generate-gateway-token; restart`.

**Do not try to fix this by injecting the bootstrap fragment.** It looks promising —  
`openclaw dashboard --json` mints `#bootstrapToken=…&bootstrapProfile=owner`, and  
`control-ui-core` really does prefer it (`preferBootstrapToken: true` is hardcoded).  
Measured through the proxy, it is inert: the fragment survives to the page, the UI  
consumes it (strips the hash), and then sends a `connect` frame with **no `auth` object  
at all** → `AUTH_TOKEN_MISSING` again. Rewriting the fragment's `gatewayUrl` to our own  
same-origin `webui-ws-proxy` endpoint does not rescue it either, because the settings  
merge blanks `bootstrapToken` whenever the incoming gatewayUrl differs from the stored  
one, and `dashboard --json` always hands out the target's loopback  
(`ws://127.0.0.1:18789`) — unreachable from a browser. Both variants tested;  
`scratch/probe-openclaw-bootstrap-rewrite.mjs` prints `Not a fix; do not ship it.`

#### The secret is in **sessionStorage**, and the monitor now seeds it

Asking the user to paste a secret that only exists on the gateway host is a dead end, so
the proxy reads it and hands it over. Two things had to be *measured* — the first guess
was wrong and silently inert:

- **Where the UI keeps it.** `sessionStorage['openclaw.control.token.v1:<gatewayUrl>']`.
  `localStorage` holds only `openclaw.control.settings.v1:<gw>` (gatewayUrl / theme /
  navWidth) plus a `bootRecord` whose `credential` is a truncated *fingerprint*. Seeding
  either of those changes nothing: the connect frame still goes out with no `auth` object.
  Found by driving the UI's own login form (`#login-gate-url`, `#login-gate-credential`)
  and diffing storage before/after — **not** by reading its source.
  Because it is sessionStorage, the secret is **per-tab** — which is exactly why the
  prompt comes back on every new tab even after a successful login.
- **Where it can be read from.** `openclaw gateway auth-token --show` refuses outside an
  interactive terminal, so it is unusable over an SSH exec channel; `openclaw config get
  gateway.auth.token` prints `__OPENCLAW_REDACTED__`. The value **is plaintext** in
  `~/.openclaw/openclaw.json` under `gateway.auth.token` — the gateway's own
  `openclaw doctor --json` warns about precisely that. Read the file (python3), same as
  the nanobot route does for its bootstrap secret.

`src/app/api/agents/_openclaw-gateway-token.js` does the read (30 s memo per connection;
swallows errors to `''`, because a gateway we cannot read should degrade to the honest
prompt, not fail the page), and `webui-proxy/route.js` seeds the key in the injected head
script — but **only** when `agentId === 'openclaw'`, since the read costs a remote exec and
only this dashboard consumes a secret. Both key spellings are seeded (with and without a
trailing slash) because the UI normalises the path.

Three traps, all now pinned by `tests/openclaw-gateway-token.test.mjs`:

- **Do not add an awk/regex fallback for the read.** The obvious one ("the first `"token"`
  after `"gateway"`") matches `"mode": "token"` and returns the literal string `token`. A
  *wrong* secret is worse than none: it fails as `token_mismatch` and hides the real cause.
  With no fallback, a missing python3 yields `''` → the prompt, which is the pre-existing
  behaviour the user already understands.
- **Guard the seed with `if (OPENCLAW_TOKEN)`.** Writing `''` would turn "no secret" into
  "the wrong secret" and change the failure mode from the honest prompt to a mismatch.
- **Rewrite `style`, not only `src`/`href`.** OpenClaw's Lit runtime puts provider icons in
  a CSS custom property: `setAttribute('style', '--provider-icon-url: url("/provider-icons/…")')`.
  The initial proxy patch missed this because it only rewrote `src`, `href`, and `data`.
  Result: raw tunnel 39/39 provider-icon requests succeeded, while the proxy had 39 404s.
  A stack trace from the live page (`lit-runtime` → `setAttribute`) identified the sink;
  `fixCssUrls()` now rewrites root-absolute `url()` values in style attributes, idempotently.
  The corrected census is raw **1** failure / proxy **1** failure, with **0 proxy-only icon
  failures**; the remaining `/__openclaw__/catalog-icon/…` failure is shared by raw and proxy.

Verified end-to-end with a probe that injects **nothing** itself, so any success is
attributable to the proxy alone (`scratch/probe-openclaw-token-prompt.mjs`): the connect
frame goes from `AUTH_TOKEN_MISSING` to
`{"type":"res","ok":true,"payload":{"type":"hello-ok","protocol":4,…}}`, followed by a live
dashboard (`sessions.subscribe`, `config.get`, `agents.list`, `health` — all `ok:true`).

### A hosted SPA that routes on the pathname needs its base injected — and one global can be BOTH the router base and the API base

ZeroClaw's dashboard showed a fully painted chrome with a **completely empty content
pane**: `<main>` had zero children, every API call 200'd, no console error, and the
screenshot looked like a CSS bug. It is not. The dashboard derives its React Router
`basename` from a global the proxy never set:

```js
// api-*.js   s = (window.__ZEROCLAW_BASE__ ?? '').replace(/\/+$/, '')
//            export { s as Ft }
// index.js   import { Ft as l } … <BrowserRouter basename={l || '/'}>
```

Unset, `basename` falls back to `'/'`. A document served at the proxy's deep path
(`/api/agents/webui-proxy/m2/<cid>/<port>/`) then matches no route, and React Router
returns **null** — the layout renders, the outlet does not. The proxy now sets
`window.__ZEROCLAW_BASE__ = ASSET_PREFIX` in its injected head script. Bundles that do
not read it (nanobot, hermes) ignore it.

**Isolate the variable before believing a diagnosis.** The empty pane survived every
theory about asset/API rewriting. What settled it was one browser, one token, one
variable at a time — `scratch/probe-zeroclaw-raw-vs-proxy.mjs`:

| load | `<main>` |
| --- | --- |
| raw SSH tunnel | 890 chars |
| raw + `?agent=nanobot` | 890 chars (the param is innocent) |
| proxied | **0 chars** |
| proxied, pathname forced to `/` | 889 chars |

Only the pathname moved the needle.

**Fixing it exposed two bugs the empty pane had been hiding**, because nothing inside a
pane that never mounts ever runs:

- **Doubled tunnel prefix on lazy chunks.** The app composes
  `'/_app' + ASSET_PREFIX + '/assets/<chunk>.js'`; the proxy's prepend then produced
  `ASSET_PREFIX + '/_app' + ASSET_PREFIX + '/assets/…'` and **28 chunks 404'd**.
  `fixSubresource` now lifts a misplaced `ASSET_PREFIX` to the front rather than adding a
  second copy. (The entry chunk was never affected — it comes from the HTML rewriter,
  which is how you know the correct shape is `ASSET_PREFIX + '/_app/assets/…'`.)
- **The proxy's `path` transport param ate the app's own `?path=`.** ZeroClaw calls
  `/api/config/map-keys?path=agents` and `/api/browse?path=…`; the catch-all overwrote
  `path` with its own remote path and `handleProxy` then dropped the key, so the gateway
  answered `API 400: … missing field 'path'`. The keyed form now carries the remote path
  as **`_path`** (same convention as `_base`) and strips `path` only when `_path` did not
  supply it. The legacy query form still uses `path`. Rule of thumb: **a proxy must not
  reuse a parameter name an arbitrary hosted app may also use.**

Verify with `scratch/probe-zeroclaw-failed-requests.mjs`, which prints every response
≥ 400 for both the raw and the proxied load. Target state is **0 on both** — before these
fixes the proxied load had 29.

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

- Current baseline: **613 tests / 7 suites / 0 fail** (~16 s).
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

Same reason `resolveTunnelConnectionId` lives in `src/utils/tunnelConnection.js` rather  
than inline in `AgentWebUIBrowserApp`: the component is not importable from  
`node --test` (it pulls in React and the whole desktop shell), so the rule would  
otherwise only ever be checked by regex.

**When a negative source assertion matches a comment.** `tests/tunnel-connection.test.mjs`  
asserts the component contains no `|| 'local'` — but the file *explains* that bug in a  
comment quoting the old expression, so raw source fails on a correct file. Strip  
whole-line comments before matching, and only whole-line ones: the file has string  
literals like `'https://…'`, and a naive `//` strip eats the code after them, turning a  
real violation into a pass.

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
- `e2e-webui-card-all4.mjs` — renders the real Web UI card for all four agents in two  
  passes (`webUIActive` true/false) and reads the DOM back. **46/0.** Covers what the  
  source-regex tests cannot: that the Stop button is actually suppressed for zeroclaw and  
  openclaw, that it is *offered* for hermes and nanobot, the port each title names, and the  
  idle daemon/process copy. Set `DEBUG_INITIATOR=1` to print the JS stack behind every  
  proxy request.
- `probe-explore-bookmark-local.mjs` — drives the desktop Web Browser app's Explore  
  bookmarks. **4/0** with no connection, **3/0** with `STUB_CONN=1`. Pins the §4 rule that  
  no request may use the literal connection id `local`.
- `probe-ws-path-key.mjs` — the controlled experiment for the marker bug above: same
  handler, same target, only the URL form varies, and it holds the socket to check the
  tunnel is *alive* rather than merely negotiated. `REVERSE=1` swaps case order, which is
  how "follows the form" was separated from "follows the position".
- `diag-openclaw-ws.mjs` — loads the OpenClaw Control UI through the proxy with CDP
  WebSocket instrumentation (handshake, frames, close) and reports whether the injected
  `window.WebSocket` patch was in effect. The tool that showed the socket reaching the
  gateway with `auth=none`.
- `probe-openclaw-bootstrap.mjs` — drives `openclaw dashboard --json` and tries the
  returned one-time `browserUrl` through the proxy. Proved the fragment is delivered to the
  page (`#bootstrapToken=` present at load) but that the Control UI still connects without
  a token — i.e. the bootstrap fragment is not the missing piece.
- `probe-openclaw-bootstrap-rewrite.mjs` — the follow-up that rules out the obvious rescue:
  same as above, but also rewrites the fragment's `gatewayUrl` to our own same-origin
  `webui-ws-proxy` endpoint. Prints the `connect` frame's `auth` field for each variant;
  all three show `(NO auth object)`. This is the probe that says *stop* — see §4.
- `probe-openclaw-handshake.mjs` — talks the gateway's raw WS protocol from inside the
  target box, with no proxy and no Control UI in the loop. **Runs on the box, not locally**
  (it shells out to `openclaw`); the header shows the base64-over-ssh incantation. Useful as
  a technique: the envelope is `{type:"req", id, method, params}` (not JSON-RPC — that yields
  `invalid request frame`), and the gateway validates `connect` params against a JSON
  schema and **names every violation at once**. Sending deliberately incomplete params is
  a far faster way to learn the required shape than reading the minified bundle.
- `probe-openclaw-token-prompt.mjs` — **the decisive one for the auto-paste.** Dumps the
  Control UI's DOM, storage and raw WS frames. It injects **nothing** itself, so a
  successful handshake is attributable to the proxy's seed alone. Before the fix: prompt
  visible, connect frame carries no `auth`, gateway answers `AUTH_TOKEN_MISSING`. After:
  `{"type":"res","ok":true,"payload":{"type":"hello-ok","protocol":4,…}}` and a live
  dashboard. This is the probe to re-run after touching the seed.
- `probe-openclaw-token-inject.mjs` — **a dead end, kept as a warning.** Seeded
  `localStorage['openclaw.control.settings.v1:<gw>'] = {gatewayUrl, token}` — the plausible
  guess. Inert: the connect frame still had no `auth`. Superseded by
  `probe-openclaw-token-submit.mjs`, which drives the UI's **real** login form and diffs
  storage before/after — that is what found the sessionStorage key. Lesson: to learn where
  an app persists a secret, submit its own form and watch, do not guess the store.
- `openclaw-gw-ctl.mjs` — drives the gateway's lifecycle through the app's own `webui-ctl`
  (start/stop/status), because `systemctl --user` does not exist on the box and
  `openclaw doctor --fix` refuses to run while the gateway holds the state DB.
- `probe-error-card-summary.mjs` — asserts the "Web UI Unreachable" card shows a sentence,
  not markup. **7/0.** Deliberately fully real: it stubs only `/api/connections` so a server
  is selectable, then lets the proxy request reach the server, where the fake id does not
  exist → `getSshConfig()` throws → the route answers its genuine HTML 500. It prints the
  raw body and the card's copy side by side, which is the whole contrast:
  `<html><body style="background:#111;…">` versus `💥 Proxy Error Connection not found`.
- `probe-zeroclaw-raw-vs-proxy.mjs` — the A/B that found the basename bug. Loads the SAME
  dashboard four ways in the same browser with the same token — raw SSH tunnel, raw
  `+?agent=nanobot`, proxied, and proxied with `history.replaceState` forced to `/` — and
  reports `<main>`'s child count and text length for each. Needs `ZC_TOKEN` (a paired
  token). The `forcePathname` variant is now the **negative control**: with the base
  correctly injected, forcing `/` is what breaks it.
- `probe-zeroclaw-failed-requests.mjs` — the acceptance check for the whole fix. Same
  browser, raw vs proxied, and it prints **every response ≥ 400 with its URL**. Target state
  is 0 on both; it was `29` (28 chunks + one 400) before. Prefer this shape of assertion —
  "the two loads agree and nothing 4xxes" — over counting elements.
- `_check-inject.mjs` — fetches the proxied HTML and greps it for markers unique to the
  injected script. The cheap way to prove a running server actually compiled your edit
  (see the dead-watcher note in §7).
- `grant-supporter.mjs`, `mint-relay-token.mjs`.

**Harness gotchas:** the session JWT must carry **ObjectId-shaped** `sub`/`dbId` (a bare  
`'probe'` 500s `/api/connections`); the CSRF cookie is minted only on middleware-matched  
paths (prime with `GET /api/connections`, not `/api/auth/session`); job polling takes a  
**flat** `{ jobId, cursor }`; ship multi-line remote scripts base64-encoded. And  
`redirect: 'manual'` on `<keyedPrefix>/` hands you the **57-byte 308 stub** instead of the  
dashboard — follow redirects when scraping a proxied page, or your entry-chunk extraction  
silently finds zero scripts.

**Match catalog tiles inside their container.** `e2e-webui-card-all4.mjs` switched agents  
with a bare `startsWith('Hermes Agent')` over every `<button>` in the document — which also  
matches AgentWebUIBrowserApp's Explore bookmark **"Hermes Agent WebUI"**. Clicking the  
bookmark instead of the tile was the real cause of its long-standing "no page/console  
errors" failure, and it was masked because the resulting 500 looked like product noise.  
Scope the query to `[data-onboarding="agent-catalog"]` and record *which* element was  
clicked, so a mis-click can never pass vacuously.

Also: `pkill -f '<pattern>'` over SSH **matches its own shell** and kills your command.  
Use a bracket trick (`'[s]se_test'`) or check by port instead.

**A full-screen overlay can make your screenshot lie while every assertion passes.**
Two of them stack on the desktop, and neither blocks a synthetic `.click()` — so the DOM
assertions are green and the PNG shows the overlay instead of the thing under test:

| overlay | appears | suppress before load |
|---|---|---|
| Initialize Secure Vault | immediately, if the vault is "not configured" | stub `/api/user/vault` **and** seed `_vault_uri`/`_vault_pwd` in `sessionStorage` |
| **Install SSH Monitor** (PWA) | **3 s after load**, driven by `beforeinstallprompt` | `sessionStorage.setItem('pwa_modal_dismissed','true')` |

The PWA one is the sneakier of the two: it arrives *after* the page looks settled, so a
probe that screenshots at 4 s photographs the modal. It went unnoticed until a screenshot
cited as evidence for the error card turned out to show the install prompt — see
`scratch/probe-error-card-summary.mjs`. **If a screenshot is your evidence, read the PNG
before quoting it.**

**A dev server started from a sandboxed shell has a DEAD FILE WATCHER.** Editing a route
does **not** change what is served — the process keeps answering from its last compile, so
you "verify" a fix that was never loaded and conclude the fix failed. Symptom: the served
HTML lacks a string you just added, and `touch`ing the file does not help. Confirm with
`lsof -nP -iTCP:3030 -sTCP:LISTEN`, kill that PID, restart, then re-fetch and grep the
response for a marker unique to the new code **before** believing any probe result. A
comment inside the injected script works well as that marker, since comments ship with it.
It cost two probe runs here: the first runs after the basename fix reported "still empty"
against a stale build, which reads exactly like "the fix was wrong".

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
- `24fab5f5 docs: add AGENTS.md handoff for the next agent`
- `6ff9d304 fix(browser): stop addressing the WebUI proxy with the invented id 'local'`
- `5f31d027 fix(webui-proxy): accept the versioned path marker in the WS upgrade parser`
- `3389540f fix(browser): show a sentence in the error card, not a wall of markup`
- `3d24e7e8 docs: narrow the ZeroClaw open item to the one layer still unverified`
- `fd0f1bb9 fix(webui-proxy): mount ZeroClaw's dashboard, and the two bugs it hid`
- `90037ede docs: record the ZeroClaw basename bug, and correct the claim that the pane was fixed`
- `64b51e9a feat(webui-proxy): paste OpenClaw's gateway secret instead of prompting`

Shipped in this round:

- ZeroClaw + OpenClaw Web UI launch (`webui-ctl`, live-probe `details`, relay hints).
- OpenClaw 403 fixed on HTTP **and** WS.
- ZeroClaw's content pane **actually renders through the proxy** (§4). The earlier
  "empty-content-pane fixed" entry in this list was **wrong** — base rewrite, slash
  collapse and SSE streaming were all real fixes, but the pane was still empty after
  them. The remaining cause was the router basename.
- Two defects that the empty pane had been hiding, both fixed: the doubled tunnel
  prefix on lazy chunks (28 × 404) and the `path` transport-param collision (§4).
- `AgentWebUIBrowserApp` now passes `?agent=<id>` when it opens an agent Web UI. It was
  the only builder that did not, so the proxy fell back to `nanobot` for every agent —
  a ZeroClaw tab's address bar read `?agent=nanobot` and the "start the Web UI"
  fallback button POSTed `/api/agents/nanobot`.
- **OpenClaw's gateway secret is pasted for the user.** The Control UI no longer asks them
  to supply a token that only exists on the gateway host: the proxy reads it over SSH and
  seeds the UI's sessionStorage key before the bundle boots (§4). Verified end-to-end by a
  probe that injects nothing itself — `hello-ok` and a live dashboard. On the target the
  token was generated with `openclaw doctor --fix --generate-gateway-token` **with the
  user's authorisation** (they chose "Generate it, then wire auto-paste"); the gateway was
  stopped first, because doctor needs exclusive state-DB access (§10 open item 1).
- `_ssh.js` pre-ready connection leak fixed at three sites.
- Agent bookmarks no longer address the proxy with the invented connection id `local`
  (§4) — the desktop Web Browser's Explore page 500ed on every agent bookmark.
- `server.js`'s WS upgrade parser now accepts the **versioned** path marker (`/m\d*/`), so a
  URL the app actually mints can no longer be silently dropped (§4).
- The "Web UI Unreachable" card now shows a sentence instead of a wall of markup
  (`src/utils/httpErrorSummary.js`). The proxy's HTML 500 is right for its document case,
  so the summarizer lives on the consumer side.
- Ten new test files; `npm test` 547 → **613**.
- OpenClaw's provider-icon style-attribute rewrite is now pinned by one additional
  regression test; the live raw-vs-proxy census is recorded in §4.

Verified live against `fc-fedora40`:

- `npm test` **613/613**, 7 suites, eslint clean on changed files.
- OpenClaw auto-paste probe: `hello-ok` / protocol 4 and all dashboard requests under
  test were `ok:true`; raw-vs-proxy icon census: 1 shared failure, 0 proxy-only failures.
- Proxy e2e across all four agents: **24/24**.
- UI-card harness `e2e-webui-card-all4.mjs`: **46/0** (was 36/2, both failures being the
  harness's own mis-click).
- Explore-bookmark probe: **4/0** with no server selected, **3/0** with one.
- WS upgrade through the proxy for the path-keyed form the app mints: **101, socket held,
  `connect.challenge` received** (was a silent socket hang up). `scratch/probe-ws-path-key.mjs`.
- Error card renders a real proxy 500 as `💥 Proxy Error Connection not found`: **7/0**.
  `scratch/probe-error-card-summary.mjs`.
- ZeroClaw's dashboard **renders through the proxy, with the raw and proxied loads
  agreeing exactly**: same visible text, `<main>` populated, and **0 responses ≥ 400 on
  both** (the proxied load had 29 before the fix). `scratch/probe-zeroclaw-failed-requests.mjs`.
- The basename diagnosis itself, one variable at a time: raw **890** chars into `<main>`,
  proxied **0**, proxied with the pathname forced to `/` **889**.
  `scratch/probe-zeroclaw-raw-vs-proxy.mjs`.
- ZeroClaw's dashboard boots through the proxy with **every asset 200** and **no console/page
  errors**. The SPA's own calls (`/health`, `/pair/code`) return 200. `scratch/diag-zeroclaw-content.mjs`.
- The **doubled-slash collapse** holds: `…/42617//api/events` reaches the real gateway route
  (`401` with the gateway's own body) instead of falling through to the SPA's `index.html`
  under a `200`. That was the failure that made the pane sit empty with no error.
- SSE through the proxy: first byte **0.18 s** (was 30.5 s, buffered).
- OpenClaw through the proxy **with the full Cloudflare forwarded-header set present**:  
  200, real dashboard, no `proxy_attribution_required`.
- The rewritten bundle now builds `<keyedPrefix>/api/events`, and that path reaches the  
  real gateway route (401 = auth required, not the SPA fallback).
- hermes renders fully through the proxy (top-level *and* embedded, identical).


### Open items

1. ~~**OpenClaw's Control UI token prompt is NOT a monitor bug — it needs a gateway token on
   the box.**~~ **CLOSED — the target was repaired *with authorisation*, and the monitor now
   pastes the secret for the user.** The original diagnosis was right and is preserved here
   because the failure modes are still the first thing to check: the socket reaches the
   gateway fine (101 + `connect.challenge`); the gateway refuses the handshake because **no
   gateway token was configured** — `~/.openclaw/openclaw.json` was only
   `{"gateway":{"mode":"local","bind":"loopback"}}`, `secret_store_entries` in
   `~/.openclaw/state/openclaw.sqlite` was **empty**, and `openclaw dashboard --json`
   self-reported **`"tokenIncluded": false`**. The gateway log at the screenshot's timestamp
   (`2026-09-14T09:52 UTC` = 16:52 Bangkok) shows `auth=password reason=token_mismatch`,
   preceded by `auth=none reason=token_missing` — a secret was offered and could not match,
   because there was nothing to match.
   **What was done (user chose "Generate it, then wire auto-paste"):**
   - ran `openclaw doctor --fix --generate-gateway-token` on `fc-fedora40`, then restarted
     the gateway. Note the ordering constraint: **doctor needs exclusive state-DB access**
     and dies with `StateDatabaseCoordinatorContentionError: another OpenClaw process owns
     gateway-lifecycle` unless the gateway is stopped first. `systemctl --user` is unavailable
     on that box (`Failed to connect to bus: No medium found`); the gateway is a detached
     `setsid nohup` process tracked in `~/.openclaw/daemon.pid`. Stopped/started it through
     the app's own `webui-ctl` path (`scratch/openclaw-gw-ctl.mjs`).
   - wired the auto-paste — the sessionStorage key, the read, and the two traps are in §4
     above. The token is **not** in the repo or in the monitor's config; it is read from the
     box on demand and memoised for 30 s.
   The `#bootstrapToken=` fragment is still **not** a workaround — measured inert, see §4.
2. **Nothing above is deployed.** Production is on an older bundle and does not auto-deploy.  
   This is the single most likely reason a fix "didn't work". The OpenClaw 403 the user  
   re-reported was exactly this — the fix had never left the working tree.
3. ~~**ZeroClaw's content pane: the authenticated render is unverified.**~~ **CLOSED
   (fd0f1bb9).** Pairing a probe device was authorised ("you decide"), a real token was
   minted, and the authenticated render was reached — which is what exposed the basename
   bug. The pane now renders through the proxy with 0 failing requests. Two consequences
   to be aware of:
   - **The probe left a device paired on the box.** `gateway.paired_tokens` in
     `/root/.zeroclaw/config.toml` went **2 → 3**; the pre-probe file is preserved at
     `/root/.zeroclaw/config.toml.before-probe`. It was deliberately **not** reverted:
     un-pairing would also invalidate the token a browser holds in
     `localStorage['zeroclaw_token']`, breaking exactly the dashboard we just fixed.
     Revert by restoring the backup and restarting `zeroclaw daemon` if that is preferred.
   - The monitor app still holds **no** dashboard token by design (`webUIBootstrapPath: '/'`,
     `bootstrapSecret: ''` — it drives the user through `pairing-approve`), so the app
     itself cannot authenticate a fresh dashboard. That is unchanged and intentional.
4. `webUIProbeShell`'s `/proc/net/tcp` fallback is IPv4-only. Low value: an IPv6-only bind  
   also fails the `curl 127.0.0.1` probe, so it surfaces as a visible "down" rather than a  
   silent wrong answer.
5. hermes/nanobot still use inline copies of the probe/relay code (§2).
6. **ZeroClaw's chunk URLs are healed by the proxy, not built correctly by the app.** The
   `'/_app' + basename + '/assets/…'` composition is a property of that dashboard's build;
   `fixSubresource` folds the duplicate prefix. If ZeroClaw changes its Vite base, the
   fold still works (it keys on `ASSET_PREFIX`, not on `/_app`), but the AGENTS.md note in
   §4 is where the reasoning lives.
