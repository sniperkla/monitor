# Project memory — monitor (SSH / server monitoring app)

## Environment
- Stack: Next.js 16 (Turbopack) + custom `server.js` (Express-style HTTP + socket.io).
- Dev: `npm run dev` → port **3030**, not 3000 (`server.js:39`, `process.env.PORT || 3000`).
  Health check: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/`.
- Prod: https://monitor.eaqdragon.com.

## Verification constraint — `next build` CANNOT run in this sandbox
`next build` aborts with
`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":50,"threshold":50,...}`.
Cause: the build unlinks 50+ generated artifacts under `.next`, and the environment's
safe-delete shim caps deletions at 50 per turn. It is NOT a code error, and it is not fixed by
clearing stale files (it just moves on to the next artifact). Don't burn time on it.

Use these instead:
1. **Syntax / grammar:** `node scratch/compile-check-filemanager.cjs <file.js>` — parses with
   `@babel/parser` (jsx + ESM). Works on any `.js`/`.jsx` file, arg is the path.
2. **Identifiers / scope:** `npx eslint <file> --rule '{"no-undef":"error"}'`. Baseline lint is
   `npx eslint <file>`; the project has ~11 pre-existing `exhaustive-deps` warnings, so 0 errors
   + those warnings is a clean result.
3. The native `@next/swc-darwin-arm64` binding rejects plain JS calls (napi type mismatch on
   `TransformOptions`) — don't try to drive it directly.

## Architecture notes
- `src/components/FileManager.js` is the only component with a **socket pool**
  (`_fmSocketPool`, `POOL_TTL = 6000ms`, keyed by connectionId). It keeps the socket alive after
  unmount so a Split-pane remount can reuse it. Any handler added there must be (a) listed in
  `FM_SOCKET_EVENTS` so it is detached on unmount, and (b) guarded by `disposedRef`, otherwise
  the dead mount fires phantom reconnects/toasts. See `2026-09-03.md`.
- Server emits `ssh:closed` from `sshClient.on('close')` (`server.js:4068`) — so any client-side
  `ssh:disconnect` produces an `ssh:closed` echo. Keep that in mind when adding teardown logic.
- Socket.IO serializes `{ message: undefined }` to `{}` on the wire. Several server emitters do
  this (e.g. `server.js:1035`, `:1042`) — client error handlers must tolerate empty payloads.
- **Safe to `removeAllListeners()` on socket.io reserved events.** Verified against
  `node_modules/socket.io-client/build/cjs/socket.js`: `RESERVED_EVENTS` are `connect`,
  `connect_error`, `disconnect`, `disconnecting`, `newListener`, `removeListener`, and the client
  only ever *emits* them (`emitReserved(...)`) — it never internally subscribes with
  `.on()/.once()`. So detaching `connect_error` / `disconnect` handlers cannot break reconnection.
  (Reconnection is driven by the Manager via engine events, not socket-level listeners.)
- Connections: ownership is scoped by `session.user.id`, but **relay registrations are keyed by
  JWT `sub`** (googleId for OAuth users). `getSshConfig()` translates between the two.

## Local Relay (`public/local-relay.js` → installed to `~/.ssh-monitor-relay/`)
- Runs as a launchd agent `com.ssh-monitor.relay` (RunAtLoad + KeepAlive); log at
  `~/Library/Logs/ssh-monitor-relay.log`. Restart:
  `launchctl kickstart -k gui/$(id -u)/com.ssh-monitor.relay`.
- **THE STALE-BUNDLE TRAP (cost a full debugging session).** The relay *self-updates* by
  re-fetching `/local-relay.js`, and `server.js:509` prefers `public/local-relay.min.js`
  when it exists. That min file was Sep 2 — predating the WebUI gateway feature — so every
  relay restart **downgraded the relay to a bundle with zero `webui` code**, and port
  18790 could never open. Quarantined as `public/local-relay.min.js.stale-sep2` (2026-09-05).
  **Rule: a minified/bundled artifact must never take precedence over the maintained
  source.** If you regenerate one, rebuild it from current source and check mtimes.
- Fast diagnostic: `md5 -q ~/.ssh-monitor-relay/local-relay.js` vs each `public/local-relay*.js`,
  plus `grep -ci webui <file>` — instantly shows which bundle is live and what it supports.
- `handleWebuiHttp()` forwards browser requests to the agent gateway over an SSH tunnel.
  **Never strip the `authorization` header there** — the nanobot SPA authenticates every
  `/api/*` call with `Authorization: Bearer nbwt_…`. Stripping `cookie` IS correct (one
  cookie jar is shared across all 127.0.0.1 ports, incl. the monitor session cookie).
  See `2026-09-05.md`.
- **The Web UI opens in a REAL browser tab, not an embedded iframe** (changed 2026-09-05 at
  the user's request). The floating panel was deleted. Rationale: the relay has to be
  installed locally anyway, so embedding bought no isolation — only Chrome's refusal to
  retry failed top-level navigations ("127.0.0.1 refused to connect" sticks until manual
  reload). See `openWebUIInTab()` / `openBlankWebUITab()` in `src/apps/AIAgentsApp.js`.
  Popup-blocker rule baked in there: claim the tab synchronously, never pass `noopener`
  (it nulls the handle you need to navigate the tab afterward).
- The WebUI tunnel lives only in memory (`webuiGateways`) and is pushed on demand by
  `src/app/api/agents/nanobot/route.js` (`webui-ctl` / `relay-start`). **Any relay restart
  drops it** — there is no re-push on reconnect; the user must click "Start Web UI" again.
  Local port 18790 auto-increments on EADDRINUSE, so a stale relay can land on 18791.
- Verifier: `scratch/verify-nanobot-webui-auth.sh [port]`.
