# Project memory — monitor (Next.js 16 + socket.io SSH/server monitoring)

## Environment
- Dev `npm run dev` → **3030**; prod https://monitor.eaqdragon.com. The server doesn't die with the wrapper —
  kill the child by PID from `lsof -nP -iTCP:3030 -sTCP:LISTEN`.
- `NEXT_DIST_DIR=/tmp/<fresh> npx next build` works; it fails only when it must *delete* an existing tree
  (safe-delete shim, >50 files). **EXIT=1 at "Finalizing page optimization" is that shim.** Output lands in
  `./tmp/<name>` — clean with `mv`, never `rm -rf`.
- `npm test` is a real regression net (370 passing, 2026-09-06). Lint baseline **9 errors / 261 warnings**,
  all Parsing errors in `scratch/*.mjs`, none in `src/`. Per-file lint baseline is 0 errors.
- Headless Chrome: use `http://localhost:3030` (bare IP → 403 on chunks → no hydration) and a normal UA
  (default headless UA is 403'd by `isAiBot()`, `src/proxy.js:48`). App dirs starting `_` are private.

## Architecture
- `FileManager.js` owns the only socket pool (`_fmSocketPool`, TTL 6000ms); handlers must be listed in
  `FM_SOCKET_EVENTS` and guarded by `disposedRef`.
- Server emits `ssh:closed` from `sshClient.on('close')` — every client `ssh:disconnect` echoes. Socket.IO
  serializes `{message: undefined}` to `{}`; tolerate empty payloads.
- Connections owned by `session.user.id`, but **relay registrations key on JWT `sub`**. Rate limiting is
  central (`src/proxy.js` → `src/lib/ratelimit.js`), keyed on userId.

## Local Relay (`public/local-relay.js` → `~/.ssh-monitor-relay/`, launchd `com.ssh-monitor.relay`)
- **SHIPPED AS A BUILD.** `scripts/build-relay.mjs` (seeded, deterministic) turns `public/local-relay.js` into
  `public/local-relay.min.js` (gitignored). `server.js` serves **only** the artifact — a missing artifact is a
  503, never a fallback. Artifact header carries `source-sha256`. `npm run build:relay -- --check` exits 2 on
  stale/non-deterministic. Build+check MUST share `buildArtifact()` or `--check` false-alarms.
  `prebuild`/`predev`/CI build it; `prepack` refuses a stale artifact.
- **Never trust localPort 18790/18791** — hint only; relay acks the real port via
  `{type:'webui:ready',forwardId,localPort}`.
- `handleWebuiHttp()` must never strip `authorization` (nanobot `Bearer nbwt_…`); it may strip `cookie`.
  The tunnel is memory-only — restart drops it, so re-run `loadDetails()` after any mutation. Prod needs
  `CSP_ALLOW_LOCAL_RELAY=1`.
- Self-cleanup deletes its own file unless the path is in the **scratch allowlist** (`/tmp`, `~/Downloads`,
  `~/Desktop`) — `isDisposableScript()`. So never run the relay from inside the repo.
- Token goes in `authorization: Bearer` on /relay-ws (server prefers header, accepts `?token=`).
  **`globalThis.WebSocket` silently ignores the 2nd arg**, hence `WS_CAN_SET_HEADERS`.
- The relay does **not** self-update. So `npm update -g` does not refresh the running service — users must
  re-run `local-relay --pair`.

## Agent Web UIs
- **nanobot** 8765 → relay localPort **18790**, bootstrap secret. **Hermes** 9119 → **18791**, no secret.
  `hermes dashboard` is the UI, `hermes serve` the headless JSON-RPC. First launch compiles the frontend — poll
  (40×3s), don't sleep. Kill by **port**.
- `WEBUI_START_AGENTS=['nanobot','hermes']` gates Start; Stop gated on `details.webUIActive`.
- **Backticks inside shell snippets in JS template literals silently terminate the string.**

## Distribution
- `packages/local-relay/` → npm `ssh-monitor-relay` (bin `local-relay`); `prepack.mjs` copies the **artifact**
  into `dist/`. Publish needs a granular token with **bypass 2FA ticked** — `--otp` never works
  (`auth-type=web` keychain sessions aren't OTP-eligible). OIDC Trusted Publishing is chicken-and-egg.
- **Do not conclude a publish failed from an early `npm view`** — the packument lags ~20 min and the tarball
  404s. Verify by curling the tarball and hashing `package/dist/local-relay.js`.
- `scripts/relay-install-audit.mjs` — read-only installer auditor. Subject is the **artifact**; behavioural
  greps read the source beside it. **Re-pin `PINNED.sha256` + `bytes` whenever the artifact changes.**
- Installer UI: `relayInstallMethod` state defaults to **'npm'**; both the relay modal and the settings card
  render `<InstallMethodToggle>`. An option buried in a collapsed disclosure is an option nobody finds.
- Pairing audit `docs/RELAY_PAIRING_AUDIT_2026-09-06.md`, F1–F7 — **all applied**. Its §5 no-obfuscation
  recommendation was **reversed by the owner the same day**; kept in the doc with the reasoning.

## Security
See `SECURITY_ROADMAP_A_TO_A_PLUS.md` / `THREAT_MODEL.md`. Already done — do NOT re-fix: rate limiting, CSP,
RBAC, audit logging, API-key scoping, vault crypto, WebAuthn clone detection. Don't make `monitor_csrf`
HttpOnly. Only live gap: OAuth PKCE off (`checks:['pkce','state']`).
Open: register the npm Trusted Publisher then **revoke the bypass-2FA token**; dead `relay-v1.0.1` tag.
