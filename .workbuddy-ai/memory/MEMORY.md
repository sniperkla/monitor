# Project memory — monitor

## Environment
- Stack: Next.js 16 + custom `server.js` + socket.io; dev port **3030**; prod `https://monitor.eaqdragon.com`.
- Next build works into a fresh `NEXT_DIST_DIR`; the safe-delete shim fails when cleaning an existing tree. Build output can land in `./tmp/<name>`; move it out, never recursively delete it.
- **ALWAYS build into `./tmp/<name>`, never a top-level dir like `.next-verify`.** Tailwind v4 auto-detects sources and skips only gitignored paths. `.gitignore` has `/tmp/` and `/.next*/`, but a top-level `.next-verify` is *not* covered by `/.next/` — Tailwind scanned its Turbopack cache, extracted mangled arbitrary-value utilities that failed to parse and 500'd the entire dev server. Cost me a long detour. `/.next*/` is now wildcarded so this can't recur.
- **Never write a literal mangled Tailwind class into any scanned file** (`.gitignore`, memory notes, docs). Tailwind v4 scans those too and re-extracts it as a real utility, recreating the 500. Describe the bug in words, not with the broken token.
- Dev-mode breakage is usually a stale/corrupt Turbopack cache: clear `.next/cache/turbopack` (it grows to ~500M). A CSS error citing a line number beyond the source file's length means the *generated* CSS is bad, not the source.
- Browser verification: use `http://localhost:3030` (not bare IP) and a normal Chrome UA. Headless default UA is blocked by `src/proxy.js`.
- Tests: `npm test`; per-file eslint should have 0 errors. Project-wide lint has known pre-existing scratch parsing errors.

## Architecture
- `FileManager.js` owns the only socket pool; new handlers must be listed in `FM_SOCKET_EVENTS` and guarded by `disposedRef`.
- Relay registrations are keyed by JWT `sub`; connections are owned by `session.user.id`.
- `server.js` accepts Local Relay at `/relay-ws` and Monitor Agent at `/agent-ws`.

## Local Relay
- Source: `public/local-relay.js`; built artifact: `public/local-relay.min.js`; installed copy: `~/.ssh-monitor-relay/`; macOS service: `com.ssh-monitor.relay`.
- `scripts/build-relay.mjs` is seeded/deterministic and stamps `source-sha256`; `--check` detects drift. `prebuild`, `predev`, CI, and npm `prepack` build/check artifacts. The server serves only the artifact and returns 503 if missing; never falls back to readable source.
- Token uses `Authorization: Bearer` on `/relay-ws`; `?token=` is legacy fallback. WHATWG `globalThis.WebSocket` ignores extra headers, so use the header-capable WebSocket path.
- Relay does not self-update; rerun `local-relay --pair` after upgrading npm. Pairing code is single-use and expires in 10 minutes; successful exchange persists the long-lived token to MongoDB with rollback on persistence failure.
- **Relay liveness must come from `GET /api/relay/token`, never `/api/health`.** The health route reports `global.__activeRelays?.size > 0` — whether *any* tenant has a relay attached — so it is wrong per-user in both directions. Shared client helper: `src/utils/relayStatus.js` (`fetchRelayStatus`, `requestRelayStatusRefresh`, `RELAY_STATUS_EVENT`).
- **Anything that changes relay state must nudge the poller**, not wait for its tick: pairing approval and the install wizard call `requestRelayStatusRefresh(...)`. `AppContext` owns the only continuous relay poller (5s while missing → 20s after ~2 min, 20s when attached, 60s hidden, immediate on focus/visibility/online). The relay install finishes in the user's terminal, so the browser is never told — one-shot mount reads of `relayInfo` are always stale.
- `relayDown` is only raised when the browser shows relay *intent* (local mode, a chosen preferred relay, or a relay discovered on 127.0.0.1:48923). Setting it unconditionally nags every server-mode user who never installed one.
- `MongoDeadBanner` reads `ssh_monitor_ssh_mode` only. It used to `||` in `ssh_monitor_preferred_relay`, but that key holds a relay *name*, never a mode, so it made the banner appear for server-mode users.
- **`ssh_monitor_ssh_mode` is stored per-device (localStorage) but converges per-ACCOUNT.** `AppContext` auto-pins `local` + `ssh_monitor_preferred_relay` for *any* browser that sees the user's relay, so a phone (which can never run a relay) still sends `x-ssh-mode: local` and gets routed through the Mac's relay. `ssh_monitor_relay_optout === '1'` ("Continue with direct connection") blocks that auto-pin; pairing a relay clears it. `resolveSshConfig` must therefore treat a missing relay as *fall back to direct* for non-localhost hosts, never as a hard error — otherwise every agent call 500s with "Local Relay Agent is not connected" for public-IP targets the server reaches fine. Localhost hosts MUST still throw (falling back = server dials its own loopback = SSRF). Regression tests in `tests/ai-agents-relay-routing.test.mjs`.
- WebUI relay ports are hints only; use the `webui:ready` acknowledgement. Preserve WebUI `authorization` headers; cookie may be stripped. Production WebUI relay needs `CSP_ALLOW_LOCAL_RELAY=1`.
- **`webui-proxy` never routes through a relay.** `route.js:534` calls `getSshConfig(connectionId)` with NO options, so `sshMode` is undefined and `conn.sshMode` is never persisted → `resolveSshConfig` returns the plain config → direct server→target SSH. Every other route passes `x-ssh-mode` / `x-preferred-relay` from headers. Consequence: "Via server" works only when the Next.js box can reach the target directly; it cannot reuse the user's relay for hosts only the relay can see.
- **`relay-start` tunnels to 127.0.0.1 on the RELAY HOST, not the caller.** The gateway lands on the Mac, so the returned `http://127.0.0.1:<port>` is only usable from that Mac. Direct Web UI can therefore never work from a phone or another machine (and Chrome 142+ LNA blocks public→loopback anyway).

## Opening the agent Web UI (AIAgentsApp)
- **The claimed tab must never be left on "Opening Web UI…".** It is opened
  synchronously (popup-blocker requirement) and navigated later, so every
  failure path in between strands a tab the user is staring at. All of them now
  write the reason INTO the tab (`failWebUITab`) and offer the same-origin
  server route. Regression tests: `tests/ai-agents-webui-open.test.mjs`.
- **The tab has to watch ITSELF — the opener cannot.** Measured in Chrome: an
  about:blank popup reports the OPENER's URL as `location.href` (about:blank
  inherits the creator's URL), and once it really navigates, reading `href`
  throws. Both opener-side "did it move?" checks are blind; don't reintroduce
  them. `navigateWebUITab()` instead writes a script into the tab that calls
  `location.replace(direct)` and renders the fallback card if the document is
  still alive at the deadline.
- **Direct mode (`http://127.0.0.1:<port>`) is fundamentally device-local**: it
  only works on the machine running the relay, so it can never work on a phone.
  Chrome's Local Network Access (default-on since 142) additionally blocks
  public-origin → loopback. The relay's PNA OPTIONS preflight mitigation is
  obsolete — Chrome put PNA on hold, and top-level navigations never preflight.
  When the jump is refused Chrome commits an error page, so even the in-tab
  card can't help there; the **"Via server" button** is the deterministic route
  for those devices.
- `relay-start` must FAIL (504) when the relay never acks `webui:ready`. It used
  to return `success:true` with a guessed port, sending the browser to a dead
  address. `handleWebuiForward` swallows its errors, so failures currently cost
  the full 20s ack timeout — adding a `webui:fail` message is still open
  (needs a relay rebuild + reinstall).
- The relay's own log is `~/Library/Logs/ssh-monitor-relay.log` (no timestamps) —
  grep it for `[Relay WebUI]` before theorising about Web UI failures. The
  installed relay at `~/.ssh-monitor-relay/local-relay.js` is byte-identical to
  the obfuscated `public/local-relay.min.js`, so plain-text greps for its
  strings find nothing; that is NOT evidence the code is missing.

## Monitor Agent / Server-side install
- `public/monitor-agent.js` → `public/monitor-agent.min.js`; installed on a remote target by `AgentSetupWizard.js` / `/api/server-monitor/agent`; connects outbound to `/agent-ws` and can run as `server-monitor-agent.service`.
- This is distinct from Local Relay: **Server Monitor Agent** runs on the remote target; **Desktop Relay** runs on the user’s own computer; **Direct Server Connection** installs nothing.
- Agent setup uses a one-time `--claim` code. Keep the target wording explicit: “Run this on the target server.”
- `WEBUI_START_AGENTS=['nanobot','hermes']`; nanobot 8765, Hermes 9119.

## WebUI proxy (`/api/agents/webui-proxy`)
- **Tunnel coordinates go in the PATH, never the query**: sub-resources are
  rewritten to `/api/agents/webui-proxy/m/<connectionId>/<port>/<remote-path>`.
  A bundler resolves relative imports against `import.meta.url`, and RFC 3986
  relative resolution drops the base URL's query — `?connectionId=&port=` on the
  entry module makes every lazy chunk 400 and the SPA never leaves its boot
  splash. See `tests/webui-proxy-assets.test.mjs`.
- The injected `<head>` script patches fetch/XHR/WebSocket and, since the escape
  fix, also root-absolute `src`/`href` set post-load (property setters,
  `setAttribute`, `insertAdjacentHTML`, `innerHTML`, MutationObserver net) —
  Hermes' router `pushState`s to `/sessions` and moves the document base.
- **The URL must stay replayable.** It must never be normalised to
  `location.pathname + location.hash` — that is what produced
  `400 connectionId required` on every refresh of a chat session. The script
  rewrites to `ASSET_PREFIX + '/?agent=' + WEBUI_AGENT + location.hash`, and
  patches `pushState`/`replaceState` (`containInTunnel`) to keep same-origin
  navigation under the proxy prefix. Bare URLs fall back to the
  `mp_webui_coords` cookie (7d, httpOnly) for links minted by older builds.
- That injected script lives INSIDE a JS template literal: a backtick in its
  comments terminates the literal and 500s the whole route.
- `remotePath` has `?agent=…` appended by the extraParams loop, so it is never
  exactly `'/'` for the entry document.
- Debugging an agent WebUI: reproduce locally (`localhost:3030`) with a
  `next-auth/jwt`-minted session cookie, puppeteer-core + local Chrome, and log
  `pageerror` plus every response >= 400. "Loading nanobot…" / a blank coloured
  screen is the SPA's static `#root` fallback = JS never executed.

## Distribution
- `packages/local-relay/` publishes npm `ssh-monitor-relay`; `prepack.mjs` copies the built artifact into `dist/`. Published 1.0.4 hash: `ae6c768f...`, 196,100 bytes. Trusted Publishing remains to be registered; then revoke the bypass-2FA token.
- `scripts/relay-install-audit.mjs` audits the artifact and source behaviour; re-pin bytes/hash when artifact changes.
- Installer UI uses `relayInstallMethod` (`npm` default) and shared `InstallMethodToggle` in both card and modal.

## Security / open work
- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` and `THREAT_MODEL.md`; do not re-fix completed rate limiting, CSP, RBAC, vault crypto, WebAuthn clone detection, or audit logging.
- Open: OAuth PKCE; npm Trusted Publisher; dead `relay-v1.0.1` tag; relay `--update`; redundant npm dependency install.
