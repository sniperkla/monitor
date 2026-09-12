# Project memory — monitor

Next.js 16 + custom `server.js` + socket.io. Dev port **3030** (`npm run dev` = `node server.js`). Prod `https://monitor.eaqdragon.com`. **Cap 8000 chars — keep it lean.**

## Build / verify

- **Build into `./tmp/<name>`, never a top-level dir** — Tailwind v4 scans non-gitignored paths, and a stray top-level build dir's Turbopack cache 500s the dev server. Gitignored: `/tmp/`, `/.next*/`, `scratch/`.
- **Never put a literal mangled Tailwind class in any scanned file** (incl. these notes) — Tailwind re-extracts it and re-breaks the server. Most dev breakage is a stale `.next/cache/turbopack`.
- **Verify without disturbing the running server**: `NEXT_DIST_DIR=tmp/<n> PORT=3031 nohup npm run dev &`; kill via `lsof -nP -iTCP:3031 -sTCP:LISTEN -t`.
- Browser checks: `http://localhost:3030` + a normal Chrome UA (headless is blocked by `src/proxy.js`); `npm test` (**519**) + per-file eslint 0 errors. 
- Auth-gated routes test without credentials — recipe in `embedded-frame-diagnose`. A minted session drives the desktop UI only with an **ObjectId-shaped** `sub` (`000000000000000000000001`); a bare `'probe'` 500s `/api/connections`.
- **A green suite does not mean the app runs** — source-inspecting tests cannot see a runtime `ReferenceError`. After changing a component, grep the dev log for it.

## In-app frames: COEP + sandbox

- **COEP nesting rule.** Under a `COEP: credentialless` embedder a nested document must send `credentialless`/`require-corp`; absent/`unsafe-none` is refused with `coep-frame-resource-needs-coep-header`, **even same-origin** — a blank "refused to connect" frame is usually this. One value: `coepValue()` in `server.js` + `COEP` in `next.config.mjs` + both route handlers; opt-out `COEP=unsafe-none`.
- **Sandbox.** `/api/browser/proxy` serves third-party HTML from OUR origin, so external-web frames are sandboxed **without `allow-same-origin`** (`WEB_FRAME_SANDBOX`); `webui` tabs are NOT, and neither is the relay-proxied frame.
- **The PARENT drives navigation; only it builds proxy URLs.** The injected script posts `{__mpBrowser:'goto'|'newtab'|'push'|'nav'}`; the parent assigns `frameSrc`, echoes `'nav'` for redirects, owns per-tab history. `handleNewTab` must stay a `useCallback`. Relay absolute links are intercepted and sent up; relative links stay via `<base href>`.
- **The injected script is one JS template literal** — a backtick inside it (comments are the easy way in) terminates it early and 500s the route. `tests/browser-proxy.test.mjs` guards this.

## In-app browser: relay-hosted proxy

- Ordinary sites render **in-app**, relay-first, server proxy as fallback — reversing `e31bf55e` (real tab). `relayProxyPort` ← `fetchRelayStatus()` ← `/api/relay/token` ← the relay's `webproxy:ready` ack; `frameFor` picks the renderer.
- **LNA does not gate a public→loopback FRAME navigation** (measured); `http://127.0.0.1` is mixed-content-exempt. An **opaque** host (`about:blank`) IS refused — a harness bug.
- The relay frame is **not sandboxed**: a different origin needs none, and an opaque origin breaks `localStorage`. YouTube **does** render through the relay.
- **The relay port must be re-read from TWO places.** `refreshRelayPort()` re-points relay tabs only when the port actually CHANGED (else every poll reloads every tab), on `relay-status-changed` AND from `armRelayProbe`'s timeout — a **silent relay restart fires no event** (the cause of the Google-search refusal). A relay that merely MOVED is followed; only a dead one falls back to the server proxy. The injected script posts `ready` then `alive` every 2s; the watchdog arms only on the first `alive`.
- **Every tab's frame stays MOUNTED** (inactive: `hidden` + `visibility:hidden`) so a tab switch does not reload: attribute `postMessage` by `event.source` via `frameRefsRef`; `frameRef` is re-pointed by an effect to the active tab; `relayReadyRef` keys readiness by **the `frameSrc` that proved it**; the un-embeddable banner is a per-tab set.
- `upgrade-insecure-requests`/`block-all-mixed-content` do **NOT** touch loopback (measured). Don't chase an `https://127.0.0.1` theory.
- **The relay's `<base href>` carries the document's DIRECTORY, not just its origin** — it OVERRIDES the document URL, so an origin-only base broke document-relative URLs below the root (a `<video src="clip.mp4">` on `/html/page` → `/clip.mp4` → 404 → `NETWORK_NO_SOURCE`, `play()` hung). Root-absolute sites are unaffected — why it survived. Non-HTML responses now **STREAM** (buffering held a whole video); traps in the skill.

## Architecture

- `FileManager.js` owns the only socket pool; new handlers go in `FM_SOCKET_EVENTS` + `disposedRef` guard. Relay registrations keyed by JWT `sub`.
- `server.js` sets security headers, but next.config `headers()` apply on top and win — change a value in **both**. It serves `/relay-ws` (Local Relay) + `/agent-ws` (Monitor Agent).
- `src/proxy.js` **excludes `/api/agents/webui-proxy` + `/api/browser/proxy`**, so those routes' framing headers apply.

## Local Relay

- `public/local-relay.js` → `.min.js` → `~/.ssh-monitor-relay/`; service `com.ssh-monitor.relay`. `scripts/build-relay.mjs` is deterministic (`--check` detects drift); the server serves only the artifact (503 if missing). Token via `Authorization: Bearer` on `/relay-ws` (`?token=` legacy) — WHATWG `WebSocket` ignores headers.
- **No self-update, but no re-pairing either**: replace `~/.ssh-monitor-relay/local-relay.js` and `launchctl kickstart -k gui/$(id -u)/com.ssh-monitor.relay`; the token in `~/.ssh-monitor-relay.json` (`server`/`token`/`name`) reconnects it as the same relay. Re-pin `relay-install-audit.mjs` `PINNED` (bytes + both digests) on every relay change.
- **Liveness is `GET /api/relay/token`, never `/api/health`** (health ≠ your relay). `src/utils/relayStatus.js`; relay-state changes must call `requestRelayStatusRefresh(...)`; `AppContext` owns the only poller (20s connected / 5s waiting) and does **not** emit the event after each poll.
- **`ssh_monitor_ssh_mode` is per-device but converges per-ACCOUNT** — AppContext auto-pins `local` for any browser seeing the user's relay; `ssh_monitor_relay_optout=1` blocks that, pairing clears it. So `resolveSshConfig` treats a missing relay as *fall back to direct* for non-localhost hosts (localhost MUST still throw). `tests/ai-agents-relay-routing.test.mjs`.
- **`relay-start` tunnels to 127.0.0.1 on the RELAY HOST, not the caller.** Ack contract: `webui:ready`(port) vs `webui:fail`(reason) — a relay-reported failure is a 502 quoting it, a timeout is the 504 blaming a missing relay. Log `~/Library/Logs/ssh-monitor-relay.log`; `tests/webui-forward-ack.test.mjs`.

## Agent Web UI / WebUI proxy

- `AIAgentsApp` Open offers **in-app** (`AgentWebUIView`, same-origin proxy) or **browser tab**; preference in `localStorage['ssh_monitor_webui_open_mode']`. In-app works on a phone (same-origin → no popup, no LNA, no relay on device); `tests/ai-agents-webui-open*.test.mjs`. The panel is a real window — drag+resize must use **pointer events, never mouse events** (the mouse trio is dead on touchscreens).
- `openExternalUrl()` = `window.open` then a synthetic `<a target="_blank">` click (the anchor is the only thing that opens a tab on mobile Safari / iOS standalone); never pass a `features` string. The tab must **watch ITSELF** — an about:blank popup reports the OPENER's URL.
- WebUI proxy: **tunnel coordinates go in the PATH, never the query** (relative imports resolve against `import.meta.url`; RFC 3986 drops the base query, so `?connectionId=&port=` 400s every lazy chunk). **Hermes uses Vue Router `createWebHashHistory()`** — not a BrowserRouter basename. `tests/webui-proxy-assets.test.mjs`.

## Security / open work

- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` / `THREAT_MODEL.md`; don't re-fix completed rate limiting, CSP, RBAC, vault crypto, WebAuthn clone detection, audit logs.
