# Project memory — monitor

Next.js 16 + custom `server.js` + socket.io. Dev **3030**. Prod `monitor.eaqdragon.com` = a **remote Docker host**; `docker compose up -d --build` = a **~2 min Cloudflare `502`** window, not a failure. **Cap 8000.**

## Build / verify

- **Never build into a top-level dir** (use `./tmp/<name>`) and **never write a literal mangled Tailwind class into a scanned file** (incl. these notes) — Tailwind v4 re-extracts both and 500s dev.
- **A second `next dev` is NOT isolated by `NEXT_DIST_DIR`/`PORT`** — it shares `.next` and **takes the user's 3030 server down**. Restart: `nohup npm run dev > /tmp/monitor-dev-3030.log 2>&1 &`.
- Browser checks: `localhost:3030` + a normal Chrome UA; `npm test` (**659**) + per-file eslint 0 errors.
- Auth-gated routes test without credentials — recipe in `embedded-frame-diagnose`. Best: mint `sub` = the **paired relay owner's `googleId`** (`systemsettings.relay_tokens` → `users`), so relay+vault+supporter resolve for real.
- **A green suite ≠ the app runs** — grep the dev log after a change.

## In-app frames: COEP + sandbox

- **COEP nesting rule.** Under a `COEP: credentialless` embedder a nested document must send `credentialless`/`require-corp`, **even same-origin** (grep `coepValue`).
- **Sandbox.** `/api/browser/proxy` serves third-party HTML from OUR origin, so external-web frames drop `allow-same-origin`; `webui` tabs and the relay frame do NOT.
- **The PARENT drives navigation; only it builds proxy URLs** (`{__mpBrowser:'goto'|'newtab'|'push'|'nav'}`).
- **The injected script is one JS template literal** — a backtick truncates it and 500s the route.

## In-app browser: relay-hosted proxy

- Ordinary sites render **in-app**, relay-first, **NO server-proxy fallback** (`frameFor` → `relay` | `relay-required`); port via `fetchRelayStatus()`.
- LNA / `upgrade-insecure-requests` / `block-all-mixed-content` do **NOT** gate loopback frames.
- **The relay port must be re-read from TWO places.** `refreshRelayPort()` re-points tabs only when the port CHANGED, on `relay-status-changed` AND from `armRelayProbe`'s timeout (a **silent relay restart fires no event**).
- **Every tab's frame stays MOUNTED** (inactive: `hidden` + `visibility:hidden`) so a tab switch never reloads: attribute `postMessage` by `event.source` (`frameRefsRef`); `relayReadyRef` keys by the proving `frameSrc`.
- **One origin per site (09-15).** Each target origin gets its **own loopback listener** → own origin → own `localStorage`. `frameSrc` = entry `/go/<enc>/…` → **307** → `127.0.0.1:<sitePort>/`, served at the site's **ROOT** — no prefix, so a chunk can never have two spellings and the module-graph split is structurally impossible. Entry `/p/<enc>/…` is **deprecated** but still serves.
- **A cross-origin DOCUMENT gets its OWN listener; a SUBRESOURCE must not** — split on the INCOMING `sec-fetch-dest` (`document`/`iframe`/`frame`). The injected script rewrites absolute hrefs to `/p/<enc>/` on the CURRENT listener, so an external link ran at the linker's origin (measured in-app). Subresources must stay — COEP refuses a redirected one.
- **Cookies are NOT isolated by that** — host-scoped, port-blind. A per-site listener sets **no** cookie; only the deprecated `/p/` path does.
- **The bridge reports the real URL** (`data.target`) — a bare loopback origin is not invertible. The origin→port map persists to `~/.ssh-monitor-relay-origins.json`, re-bound eagerly, 24 live max, **port kept** on evict.
- **WS upgrades ARE tunnelled** (were refused). Absolute `ws(s)://` → `ws://<listener>/__ws/<b64(scheme//host)>/…`. Teardown destroys BOTH ends on **`end` as well as `close`** and holds the upstream socket in a **closure** — the client side goes first. Never watch an upgraded `ClientRequest` for `close`: it fires right after the 101.
- **`<base href>` only in PREFIX mode** — it OVERRIDES the document URL, so it must carry the directory. Non-HTML responses **STREAM**.
- **Relay:** `sec-ch-ua*` + `STEALTH_SCRIPT` align `navigator` to `WEB_PROXY_UA`; the relay's OWN outgoing requests must never send `sec-fetch-dest: document` (undici forces `cors`). **CSP must stay STRIPPED** — the target's `script-src 'nonce-…'` refuses our injected scripts.

## Architecture

- `FileManager.js` owns the only socket pool; new handlers go in `FM_SOCKET_EVENTS` + `disposedRef` guard. Relay registrations keyed by JWT `sub`.
- `server.js` sets security headers, but next.config `headers()` win. It serves `/relay-ws` + `/agent-ws`.
- **Container app port is 3030**; Dockerfile + compose override `env_file`. Nginx on `proxy-net` → `monitor:3030`.
- `src/proxy.js` **excludes `/api/agents/webui-proxy` + `/api/browser/proxy`**, so those routes' framing headers apply.
- **`/api/health` 503 ≠ DB down** — the status is `memory.safe && mongoUp`. read `body.mongo.up`, never the code.

## Local Relay

- `public/local-relay.js` → `.min.js` → `~/.ssh-monitor-relay/`; service `com.ssh-monitor.relay`. `scripts/build-relay.mjs` is deterministic (`--check`). Token via `Authorization: Bearer` on `/relay-ws` — WHATWG `WebSocket` ignores headers.
- **No self-update, but no re-pairing either**: replace `~/.ssh-monitor-relay/local-relay.js` and `launchctl kickstart -k gui/$(id -u)/com.ssh-monitor.relay`. Re-pin `relay-install-audit.mjs` `PINNED` on every relay change.
- **A dead relay writes NOTHING to its log.** Check the service first: `launchctl print` → `last exit code = 78: EX_CONFIG` = launchd can't spawn it — usually a stale `ProgramArguments[0]` (a deleted node).
- **A relay change ships by TAG**: `relay-v*` → `publish-relay.yml` → npm. Bump `RELAY_VERSION` **and** `packages/local-relay/package.json` TOGETHER — an unbumped fix is invisible to npm and Settings says "up to date". `main` is a stub and the DEFAULT branch, so re-run the TAG's run, never a UI dispatch.
- **Liveness is `GET /api/relay/token`, never `/api/health`** (health ≠ your relay). `src/utils/relayStatus.js`; `AppContext` owns the only poller (20s/5s).
- **`relayInfo` is `{connected, relays, checkDone}` — NO `webProxyPort`.** The reducer drops the port `relayStatus.js` derives from `relays[]` → silent `undefined`. Derive from `relays[]`.
- **`ssh_monitor_ssh_mode` is per-device but converges per-ACCOUNT** — AppContext auto-pins `local` for any browser seeing the user's relay; `ssh_monitor_relay_optout=1` blocks it.
- **`relay-start` tunnels to 127.0.0.1 on the RELAY HOST, not the caller.** `webui:ready`(port) vs `webui:fail`(reason) → 502 quoting it, or 504 blaming a missing relay.

## Agent Web UI / WebUI proxy

- `AIAgentsApp` Open forks **in-app** vs **browser tab** (`localStorage['ssh_monitor_webui_open_mode']`). In-app drag+resize must use **pointer events, never mouse**.
- `openExternalUrl()` = `window.open` then a synthetic `<a target="_blank">` click. The tab must **watch ITSELF** — an about:blank popup reports the OPENER's URL.
- WebUI proxy: **tunnel coordinates go in the PATH, never the query** (RFC 3986 drops the base query). **Hermes uses Vue Router `createWebHashHistory()`**.
- **`ASSET_KEY` (now `m2`) must stay a STATIC path segment** — a query-string epoch splits Hermes' module graph → green splash.
- **A fresh `openclaw` install wipes the gateway token**; `openclaw doctor --generate-gateway-token`.

## Deploy

- **Deploys ship from GIT, never the working tree** — the host runs `git checkout <sha>`/`git pull` uncommitted work CANNOT ship. Branch `nextgen16` (not `main`); no deploy workflow, SSH denied.

## Security / open work

- **OPEN (09-13): prod Mongo `43.210.134.78:27021` is internet-reachable, the `54ab5dac^` password still authenticates, and this repo is PUBLIC.** Fix = loopback bind + rotate.
- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` / `THREAT_MODEL.md`; don't re-fix completed rate limiting, CSP, RBAC, vault crypto.
