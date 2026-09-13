# Project memory — monitor

Next.js 16 + custom `server.js` + socket.io. Dev port **3030** (`npm run dev` = `node server.js`). Prod `https://monitor.eaqdragon.com` is a **remote Docker host**; a `docker compose up -d --build` deploy = a **~2 min Cloudflare `502`** window, not a failure. **Cap 8000 chars.**

## Build / verify

- **Build into `./tmp/<name>`, never a top-level dir** — Tailwind v4 scans non-gitignored paths, and a stray top-level build dir's Turbopack cache 500s the dev server. Gitignored: `/tmp/`, `/.next*/`, `scratch/`.
- **Never put a literal mangled Tailwind class in any scanned file** (incl. these notes) — Tailwind re-extracts it and re-breaks the server. Most dev breakage is a stale `.next/cache/turbopack`.
- **A second `next dev` is NOT isolated by `NEXT_DIST_DIR`/`PORT`** — it shares `.next` and **takes the user's 3030 server down**. Restart: `nohup npm run dev > /tmp/monitor-dev-3030.log 2>&1 &`.
- Browser checks: `http://localhost:3030` + a normal Chrome UA (headless is blocked by `src/proxy.js`); `npm test` (**544**) + per-file eslint 0 errors.
- Auth-gated routes test without credentials — recipe in `embedded-frame-diagnose`. A minted session drives the desktop only with an **ObjectId-shaped** `sub`; a bare `'probe'` 500s `/api/connections`. **Gates stack**: also stub `/api/user/vault` (+ sessionStorage `_vault_uri`) and `/api/user/supporter`.
- **A green suite does not mean the app runs** — source-inspecting tests cannot see a runtime `ReferenceError`. After changing a component, grep the dev log; a render harness beats a regex (`scratch/*-e2e.mjs`).
- **`innerText` applies CSS `text-transform`** — an `uppercase` label never matches a lowercase substring check.

## In-app frames: COEP + sandbox

- **COEP nesting rule.** Under a `COEP: credentialless` embedder a nested document must send `credentialless`/`require-corp`; absent/`unsafe-none` is refused with `coep-frame-resource-needs-coep-header`, **even same-origin**. Set it in `coepValue()` (`server.js`), `COEP` (`next.config.mjs`) AND both route handlers.
- **Sandbox.** `/api/browser/proxy` serves third-party HTML from OUR origin, so external-web frames are sandboxed **without `allow-same-origin`** (`WEB_FRAME_SANDBOX`); `webui` tabs and the relay frame are NOT.
- **The PARENT drives navigation; only it builds proxy URLs.** The injected script posts `{__mpBrowser:'goto'|'newtab'|'push'|'nav'}`; the parent assigns `frameSrc`, echoes `'nav'` for redirects, owns per-tab history. `handleNewTab` must stay a `useCallback`; relay absolute links are intercepted, relative ones stay via `<base href>`.
- **The injected script is one JS template literal** — a backtick inside it terminates it early and 500s the route. `tests/browser-proxy.test.mjs` guards this.

## In-app browser: relay-hosted proxy

- Ordinary sites render **in-app**, relay-first, with **NO server-proxy fallback** (`frameFor` → `relay` | `relay-required`). `relayProxyPort` ← `fetchRelayStatus()` ← `/api/relay/token`.
- LNA / `upgrade-insecure-requests` / `block-all-mixed-content` do **NOT** gate loopback frames — don't chase them. YouTube renders through the relay; an opaque origin breaks `localStorage`.
- **The relay port must be re-read from TWO places.** `refreshRelayPort()` re-points relay tabs only when the port actually CHANGED (else every poll reloads every tab), on `relay-status-changed` AND from `armRelayProbe`'s timeout — a **silent relay restart fires no event**.
- **Every tab's frame stays MOUNTED** (inactive: `hidden` + `visibility:hidden`) so a tab switch never reloads: attribute `postMessage` by `event.source` via `frameRefsRef`; re-point `frameRef` in an effect; `relayReadyRef` keys readiness by **the `frameSrc` that proved it**.
- **The relay's `<base href>` must carry the document's DIRECTORY, not just its origin** — it OVERRIDES the document URL, so an origin-only base 404s relative URLs below the root; root-absolute sites are unaffected, which hid it. Non-HTML responses **STREAM**.

## Architecture

- `FileManager.js` owns the only socket pool; new handlers go in `FM_SOCKET_EVENTS` + `disposedRef` guard. Relay registrations keyed by JWT `sub`.
- `server.js` sets security headers, but next.config `headers()` apply on top and win — change a value in **both**. It serves `/relay-ws` (Local Relay) + `/agent-ws` (Monitor Agent).
- `src/proxy.js` **excludes `/api/agents/webui-proxy` + `/api/browser/proxy`**, so those routes' framing headers apply.
- **`/api/health` 503 ≠ DB down**: `status = memory.safe && mongoUp ? 'ok':'degraded'`; the relay flag is informational. Read `body.mongo.up`, never the status code (`classifyHealth()`, `src/utils/healthProbe.js`). `checkMemory` reads `MemAvailable`, not `os.freemem()` (MemFree on Linux).

## Local Relay

- `public/local-relay.js` → `.min.js` → `~/.ssh-monitor-relay/`; service `com.ssh-monitor.relay`. `scripts/build-relay.mjs` is deterministic (`--check` detects drift); the server serves only the artifact. Token via `Authorization: Bearer` on `/relay-ws` — WHATWG `WebSocket` ignores headers.
- **No self-update, but no re-pairing either**: replace `~/.ssh-monitor-relay/local-relay.js` and `launchctl kickstart -k gui/$(id -u)/com.ssh-monitor.relay`; the token in `~/.ssh-monitor-relay.json` reconnects it as the same relay. Re-pin `relay-install-audit.mjs` `PINNED` on every relay change.
- **Liveness is `GET /api/relay/token`, never `/api/health`** (health ≠ your relay). `src/utils/relayStatus.js`; relay-state changes must call `requestRelayStatusRefresh(...)`; `AppContext` owns the only poller (20s/5s) and does **not** emit the event after each poll.
- **`relayInfo` is `{ connected, relays, checkDone }` — NO `webProxyPort`.** The reducer drops the port `relayStatus.js` derives from `relays[]`, so reading it gives `undefined` silently and the feature does nothing. Derive it from `relays[]`.
- **`ssh_monitor_ssh_mode` is per-device but converges per-ACCOUNT** — AppContext auto-pins `local` for any browser seeing the user's relay; `ssh_monitor_relay_optout=1` blocks that, pairing clears it. `resolveSshConfig` treats a missing relay as *fall back to direct* for non-localhost hosts (localhost MUST throw). `tests/ai-agents-relay-routing.test.mjs`.
- **`relay-start` tunnels to 127.0.0.1 on the RELAY HOST, not the caller.** Ack contract: `webui:ready`(port) vs `webui:fail`(reason) — a relay-reported failure is a 502 quoting it, a timeout is the 504 blaming a missing relay. Log `~/Library/Logs/ssh-monitor-relay.log`; `tests/webui-forward-ack.test.mjs`.

## Agent Web UI / WebUI proxy

- `AIAgentsApp` Open forks **in-app** vs **browser tab** (`localStorage['ssh_monitor_webui_open_mode']`). In-app opens `AgentWebUIBrowserApp` as a real OS window — drag+resize must use **pointer events, never mouse events**.
- `openExternalUrl()` = `window.open` then a synthetic `<a target="_blank">` click (the only thing that opens a tab on mobile Safari); never pass a `features` string. The tab must **watch ITSELF** — an about:blank popup reports the OPENER's URL.
- WebUI proxy: **tunnel coordinates go in the PATH, never the query** (RFC 3986 drops the base query, so `?connectionId=&port=` 400s lazy chunks). **Hermes uses Vue Router `createWebHashHistory()`**. `tests/webui-proxy-assets.test.mjs`.
- **The asset path key (`ASSET_KEY`, now `m2`) must stay a STATIC path segment** — a query-string epoch splits Hermes' module graph (modulepreload keeps it, the lazy import drops it → two module instances → green splash). Bump the key to evict an `immutable`-cached poisoned entry. `tests/webui-proxy-key.test.mjs`.

## Security / open work

- **OPEN (09-13): prod Mongo `43.210.134.78:27021` is internet-reachable, the `54ab5dac^` password still authenticates (root), and this repo is PUBLIC.** Fix = loopback bind + rotate.
- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` / `THREAT_MODEL.md`; don't re-fix completed rate limiting, CSP, RBAC, vault crypto, WebAuthn clone detection, audit logs.
