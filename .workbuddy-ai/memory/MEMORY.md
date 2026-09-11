# Project memory — monitor

Next.js 16 + custom `server.js` + socket.io. Dev port **3030** (`npm run dev` = `node server.js`). Prod `https://monitor.eaqdragon.com`. Logs hold detail. **Injected cap is 8000 chars — keep it lean.**

## Build / verify

- **Build into `./tmp/<name>`, never a top-level dir** — Tailwind v4 scans non-gitignored paths, and a stray top-level build dir's Turbopack cache 500s the dev server. Gitignored: `/tmp/`, `/.next*/`, `scratch/`.
- **Never put a literal mangled Tailwind class in any scanned file** (incl. these notes) — Tailwind re-extracts it and re-breaks the server. Most dev breakage is a stale `.next/cache/turbopack`.
- **Verify without disturbing the running server**: `NEXT_DIST_DIR=tmp/<n> PORT=3031 nohup npm run dev &`; kill via `lsof -nP -iTCP:3031 -sTCP:LISTEN -t`; move the distDir out after, never `rm -rf` it.
- Browser checks: `http://localhost:3030` + a normal Chrome UA (the headless default is blocked by `src/proxy.js`); `npm test` (489) + per-file eslint 0 errors. **Never substring-match a package name against a command line** — a random temp dir containing `ws` flaked `relay-agent-pair`.
- Auth-gated routes test without credentials — recipe in the `embedded-frame-diagnose` skill.

## In-app frames: COEP + the browser-proxy sandbox (2026-09-11)

- **COEP nesting rule.** Under a `COEP: credentialless` embedder, a nested document must send `credentialless` or `require-corp`; `unsafe-none`/absent is refused with `ERR_BLOCKED_BY_RESPONSE` / `coep-frame-resource-needs-coep-header`, **even same-origin** — a blank frame saying "refused to connect" is usually this. Shared value: `coepValue()` in `server.js`, `COEP` in `next.config.mjs`, both route handlers; opt-out `COEP=unsafe-none`.
- **Sandbox.** `/api/browser/proxy` serves third-party HTML from OUR origin, so an unsandboxed frame's JS would run as monitor.eaqdragon.com. External-web frames are sandboxed **without `allow-same-origin`** (`WEB_FRAME_SANDBOX`); `webui` tabs are NOT — they need same-origin.
- **The PARENT drives navigation; only it builds proxy URLs.** The injected script intercepts clicks/forms/history and posts `{__mpBrowser:'goto'|'newtab'|'push'|'nav'}`; the parent assigns `frameSrc`, echoes `'nav'` for redirects, and owns the per-tab `history` stack (`stepHistory(±1)`). `handleNewTab` must stay a `useCallback` (else the bridge effect re-subscribes each render). Never build a proxy URL in-page — `<base href>` is the TARGET origin. `frameSrc` = proxy wrapper, `url` = real destination. **`'push'` vs `'nav'` need different handlers**: `applyFrameUrl` unwraps a proxy wrapper and drops a bare destination; `applyPushedRoute` takes a real target URL.
- **Opaque origin, measured.** `document.cookie`/`localStorage`/`indexedDB`/`serviceWorker` throw SecurityError. `pushState` to a different path throws inside the page's own click handler → SPA routers die; push/replaceState are swallowed and posted as `'push'`. A non-GET form submit navigates the frame to the target origin → tab dies with `corp-not-same-origin-after-defaulted-to-same-origin-by-coep`; non-GET is refused in-page and `HTMLFormElement.prototype.submit` patched (`form.submit()` fires no submit event). `target="_blank"` would open a logged-out OS popup in the opaque origin → posts `'newtab'`.
- Assets load **direct** via `<base href>` — no CORS, no limiter cost; only a page's own *relative* `fetch`/XHR fails. **Proxying fetch/XHR is deliberately NOT done** (reasons in the 09-11 log).
- **The injected script is one JS template literal** — a backtick inside it (comments are the easy way in) terminates it early and 500s the route. `tests/browser-proxy.test.mjs` guards this.

## Architecture

- `FileManager.js` owns the only socket pool; new handlers go in `FM_SOCKET_EVENTS` + `disposedRef` guard. Relay registrations keyed by JWT `sub`; connections owned by `session.user.id`.
- `server.js` sets security headers, but next.config `headers()` apply on top and win — change a value in **both**. It serves `/relay-ws` (Local Relay) and `/agent-ws` (Monitor Agent).
- `src/proxy.js` **excludes `/api/agents/webui-proxy` and `/api/browser/proxy`**, so those routes' own framing headers apply. `upgrade-insecure-requests` is HTTPS-only (it upgrades same-origin iframes to https://localhost on plain http).
- Monitor Agent: `public/monitor-agent.js` → `.min.js` via `AgentSetupWizard.js`, dials `/agent-ws` with a one-time `--claim` code; `WEBUI_START_AGENTS=['nanobot','hermes']` (8765 / 9119). `scripts/relay-install-audit.mjs` audits the artifact — re-pin bytes/hash on change.

## Local Relay

- `public/local-relay.js` → `.min.js` → `~/.ssh-monitor-relay/`; service `com.ssh-monitor.relay`. `scripts/build-relay.mjs` is deterministic, `--check` detects drift. Server serves only the artifact (503 if missing). Token via `Authorization: Bearer` on `/relay-ws` (`?token=` legacy) — WHATWG `WebSocket` ignores headers. No self-update: rerun `local-relay --pair` after upgrading npm; pair code single-use, 10 min.
- **Liveness is `GET /api/relay/token`, never `/api/health`** (health ≠ your relay). Helper `src/utils/relayStatus.js`; relay-state changes must call `requestRelayStatusRefresh(...)`; `AppContext` owns the only poller — one-shot mount reads of `relayInfo` are always stale. `relayDown` only when the browser shows relay *intent*. `MongoDeadBanner` reads `ssh_monitor_ssh_mode` only.
- **`ssh_monitor_ssh_mode` is per-device but converges per-ACCOUNT** — AppContext auto-pins `local` for any browser seeing the user's relay; `ssh_monitor_relay_optout=1` blocks that, pairing clears it. So `resolveSshConfig` must treat a missing relay as *fall back to direct* for non-localhost hosts (localhost MUST still throw). Tests: `tests/ai-agents-relay-routing.test.mjs`.
- **`relay-start` tunnels to 127.0.0.1 on the RELAY HOST, not the caller.** Chrome LNA also blocks public→loopback. Log `~/Library/Logs/ssh-monitor-relay.log`; the installed copy is obfuscated. Ack contract: `webui:ready`(port) vs `webui:fail`(reason) — a relay-reported failure is a 502 quoting it, a timeout is the 504 that blames a missing relay. Tests: `tests/webui-forward-ack.test.mjs`.

## Agent Web UI / WebUI proxy

- `AIAgentsApp` Open offers a chooser: **in-app** (`AgentWebUIView`, frames the same-origin proxy) or **browser tab**; preference in `localStorage['ssh_monitor_webui_open_mode']` (`src/utils/webuiOpenMode.js`). Tests: `tests/ai-agents-webui-open*.test.mjs`. **In-app works on a phone in standard mobile mode** (same-origin → no popup, no LNA, no relay on device); it probes before mounting (failure = retryable card).
- The in-app panel is a real window (floating / docked / maximised) — drag+resize must use **pointer events, never mouse events** (the mouse trio is dead on touchscreens); minimise hides rather than unmounts — unmounting drops the socket and any half-typed message.
- `openExternalUrl()` = `window.open` then a synthetic `<a target="_blank">` click (the anchor is the only thing that opens a tab on mobile Safari / iOS standalone); never pass a `features` string. The tab must **watch ITSELF** — an about:blank popup reports the OPENER's URL as `location.href`. `relay-start` must FAIL (504) if the relay never acks `webui:ready`.
- WebUI proxy: **tunnel coordinates go in the PATH, never the query** — relative imports resolve against `import.meta.url` and RFC 3986 drops the base query, so `?connectionId=&port=` 400s every lazy chunk; bare URLs fall back to the `mp_webui_coords` cookie. **Hermes uses Vue Router `createWebHashHistory()`** — never treat its hash routes like a BrowserRouter basename; preserve `window.__HERMES_BASE_PATH__`. Tests: `tests/webui-proxy-assets.test.mjs`.

## Security / open work

- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` / `THREAT_MODEL.md`; do not re-fix completed rate limiting, CSP, RBAC, vault crypto, WebAuthn clone detection, audit logs.
