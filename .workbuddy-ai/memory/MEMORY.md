# Project memory — monitor

## Environment
- Stack: Next.js 16 + custom `server.js` + socket.io; dev port **3030**; prod `https://monitor.eaqdragon.com`.
- Next build works into a fresh `NEXT_DIST_DIR`; the safe-delete shim fails when cleaning an existing tree. Build output can land in `./tmp/<name>`; move it out, never recursively delete it.
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
- WebUI relay ports are hints only; use the `webui:ready` acknowledgement. Preserve WebUI `authorization` headers; cookie may be stripped. Production WebUI relay needs `CSP_ALLOW_LOCAL_RELAY=1`.

## Monitor Agent / Server-side install
- `public/monitor-agent.js` → `public/monitor-agent.min.js`; installed on a remote target by `AgentSetupWizard.js` / `/api/server-monitor/agent`; connects outbound to `/agent-ws` and can run as `server-monitor-agent.service`.
- This is distinct from Local Relay: **Server Monitor Agent** runs on the remote target; **Desktop Relay** runs on the user’s own computer; **Direct Server Connection** installs nothing.
- Agent setup uses a one-time `--claim` code. Keep the target wording explicit: “Run this on the target server.”
- `WEBUI_START_AGENTS=['nanobot','hermes']`; nanobot 8765, Hermes 9119.

## Distribution
- `packages/local-relay/` publishes npm `ssh-monitor-relay`; `prepack.mjs` copies the built artifact into `dist/`. Published 1.0.4 hash: `ae6c768f...`, 196,100 bytes. Trusted Publishing remains to be registered; then revoke the bypass-2FA token.
- `scripts/relay-install-audit.mjs` audits the artifact and source behaviour; re-pin bytes/hash when artifact changes.
- Installer UI uses `relayInstallMethod` (`npm` default) and shared `InstallMethodToggle` in both card and modal.

## Security / open work
- See `SECURITY_ROADMAP_A_TO_A_PLUS.md` and `THREAT_MODEL.md`; do not re-fix completed rate limiting, CSP, RBAC, vault crypto, WebAuthn clone detection, or audit logging.
- Open: OAuth PKCE; npm Trusted Publisher; dead `relay-v1.0.1` tag; relay `--update`; redundant npm dependency install.
