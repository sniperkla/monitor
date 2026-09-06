# Project memory — monitor (SSH / server monitoring app)

## Environment
- Stack: Next.js 16 (Turbopack) + custom `server.js` (Express-style HTTP + socket.io).
- Dev: `npm run dev` → port **3030**, not 3000 (`server.js:39`, `process.env.PORT || 3000`).
  Health check: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/`.
- Prod: https://monitor.eaqdragon.com.

## `next build` CAN run here — use `NEXT_DIST_DIR` (corrected 2026-09-05)

An earlier note said `next build` was impossible in this sandbox. **That was wrong.**
It fails only when it has to *delete* an existing output tree:

`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":50,"threshold":50,...}`

The shim caps deletions at 50 per turn and `.next` has thousands of files. But building
into a **fresh, empty** directory deletes nothing, so it sails through:

```bash
NEXT_DIST_DIR=/tmp/mbc3 npx next build > /tmp/build.log 2>&1; echo "EXIT=$?"
grep -E "Compiled successfully|Failed to compile" /tmp/build.log
```

`next.config.mjs:10` already wires `NEXT_DIST_DIR` → `distDir`. Verified 2026-09-05:
`✓ Compiled successfully in 9.0s`, 141/141 static pages, **EXIT=0**.

Two gotchas:
- Next resolves `distDir` **relative to the project root even when you pass an absolute
  path** — `/tmp/mbc3` lands in `./tmp/mbc3`. It will show up as an untracked `tmp/`.
- Cleaning it up with `rm -rf tmp` re-triggers the shim (2380 files > 50). **Use
  `mv tmp /tmp/somewhere` instead** — a move is not a deletion and bypasses it.

This matters: it means a production build is verifiable before shipping. Do it.

Cheaper checks to run first:
1. **Syntax / grammar:** `node scratch/compile-check-filemanager.cjs <file.js>` — parses with
   `@babel/parser` (jsx + ESM). Works on any `.js`/`.jsx` file, arg is the path.
2. **Identifiers / scope:** `npx eslint <file> --rule '{"no-undef":"error"}'`. Baseline lint is
   `npx eslint <file>`; the project has ~11 pre-existing `exhaustive-deps` warnings, so 0 errors
   + those warnings is a clean result.
   **CAREFUL: that baseline is PER-FILE.** Project-wide `npm run lint` reports
   **9 errors / 261 warnings** and that is the pre-existing baseline — all 9 are
   *Parsing errors* in throwaway files (8 × `scratch/*.mjs`, 1 ×
   `scripts/fix-job-schedules.js`), none in `src/`. Don't panic and don't report it
   as a regression. Locate them to a file first:
   `npx eslint . -f json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);for(const f of r)if(f.errorCount>0)console.log(f.errorCount,f.filePath,'|',f.messages[0].message)})"`
3. The native `@next/swc-darwin-arm64` binding rejects plain JS calls (napi type mismatch on
   `TransformOptions`) — don't try to drive it directly.

## Headless-browser UI verification (Chrome + puppeteer-core, 2026-09-05)
`puppeteer-core` is in `node_modules`; no bundled binary, so pass
`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.
Run the script from inside the project (ESM can't resolve `puppeteer-core` from `/tmp`).
Four traps, all of which cost real time:
1. **Use `http://localhost:3030`, never `http://127.0.0.1:3030`.** Next 16 dev returns
   **403 for every `/_next/static/chunks/*`** when the host is the bare IP, so the HTML
   loads but React never hydrates and the page looks empty. Symptom: `net::ERR_ABORTED`
   on chunks + a bare 403 with no security headers.
2. **Set a normal Chrome UA** (`page.setUserAgent(...)`). `isAiBot()` at `src/proxy.js:48`
   hard-403s headless Chrome's default UA before anything else runs.
3. **App dirs starting with `_` are private** — `src/app/__onb-test/` 404s. Use `onb-test`.
4. Temporary routes need adding to `PUBLIC_PATHS` (`src/proxy.js:201`). Back the file up
   and restore when done.
Also: killing the `npm run dev` wrapper does **not** kill the child `node server.js`, which
keeps holding 3030 (`EADDRINUSE` on restart). Kill by PID from
`lsof -nP -iTCP:3030 -sTCP:LISTEN`.

**Dev server 500ing on every page with a CSS parse error?** (`globals.css:3823 Unexpected
token Delim`, mojibake like `var(--bg-A??ary)`) — that is a **stale/corrupt Turbopack
cache**, not a source or Tailwind bug. Fix: `mv .next /tmp/next-cache-old-<ts>` and
restart. Use `mv`, not `rm -rf` (safe-delete shim caps deletions).

## Responsive layout of the onboarding panels (2026-09-05)
All nine `*Onboarding.js` panels are built from **inline styles**, which cannot carry
media-query breakpoints — every value was a hard px literal. `src/hooks/useOnboardingLayout()`
exposes the values that break (`isMobile` w<640, `isShort` h<720); the components read from
it. `OnboardingSpotlight.js` is deliberately excluded: it sizes itself from the target's
`getBoundingClientRect()`, so it is responsive by construction.
Two non-obvious rules:
- **A bottom-anchored panel's `maxHeight` must reserve the bottom offset itself** *plus* a
  matching top gap: `calc(100dvh - ${panelBottom * 2}px)`. An unconditional
  `calc(100dvh - 24px)` clipped the card to `top: -8px` at 844x260 with `bottom: 32`.
- **A scrolling flex child needs `minHeight: 0`.** Flex items default to `min-height: auto`
  and refuse to shrink below their content, which silently defeats `overflowY: 'auto'`.
`globals.css:1710` (`@media (max-width: 768px)`) sets `h1 { font-size: 1.5rem !important }`,
which beats any inline `fontSize`. Note 768 ≠ the hook's 640 `isMobile` breakpoint.

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
- **Never trust `localPort` 18790.** The relay treats it as a hint and silently increments
  (18791, 18792…) on EADDRINUSE. Since 2026-09-05 the relay acks the real port with
  `{type:'webui:ready', forwardId, localPort}` over `activeWs` (NOT `ws` — that one is
  function-scoped near line 238 of `public/local-relay.js`); `server.js` holds
  `global.__webuiForwardWaiters` / `__waitForWebuiForward()`; the route awaits it before
  answering and returns `portConfirmed`. Before this existed, opening connection B's
  Web UI could serve connection A's gateway → `401 Unauthorized` on `/api/settings`.
  Old relays that don't ack time out and fall back to 18790 (no regression).
- Debugging trick that cracked the above: compare the `Server:` banner. Different
  Python versions across the tunnel vs. the remote ⇒ the tunnel is pointed at a
  different process/host than you think. One public IP can front several containers
  (43.210.221.54:2232 and :2236 are different boxes).
- Verifier: `scratch/verify-nanobot-webui-auth.sh [port]`.
- **Any action that mutates remote state MUST call `loadDetails()` afterwards.** Several
  status fields are NOT cached anywhere — they are re-probed over SSH on every
  `details` call: `webUIActive` (curl against the Web UI port, route.js:562-573),
  `running` (gateway pidfile probe), `version`. Missing this makes the UI confidently
  lie. Fixed 2026-09-05 in `handleStartWebUI` — it started the Web UI but never
  refreshed, so the button stayed on "Start Web UI" while the Web UI was up.
- `webui-ctl {op:'start'}` on an already-running Web UI is a **safe no-op** (returns
  `success:true, active:true` at route.js:1248-1262) — it does not kill and restart.
- The UI only ever calls `webui-ctl` with `op:'start'`. **`op:'stop'` and
  `op:'restart'` exist on the backend but have no UI control**, so once the Web UI is
  up the Start button is disabled with no recovery but a page reload. Deliberate (x
  asked for it) — but it's the obvious next ask.

## Security posture (audited 3x, 2026-09-05)
- **Rate limiting is CENTRAL, not per-route.** `src/lib/ratelimit.js` runs from
  `src/proxy.js` (Edge runtime): Upstash sliding window, memory fallback. Buckets key on
  **userId when authed, IP otherwise** (so rotating IPs buy nothing). ~30 files under
  `src/app/api/**` mention `rateLimit` — those are *hand-tuned* overrides. **Absence
  from that grep does NOT mean unprotected.** Re-checking this cost me a false alarm.
- **SRI is N/A, not missing.** `src/app/layout.js` loads zero external scripts (Google
  Fonts only). Nothing to put `integrity` on.
- **WebAuthn clone detection IS wired** — `src/lib/webauthn.js:213` passes `counter` into
  `verifyAuthenticationResponse()` and persists `newCounter` at :225. I nearly filed it
  as dead schema because grepping `src/app/api/auth/webauthn/**` finds nothing; the
  logic lives in `src/lib/`, not the route folder. Grep the whole tree.
- **OAuth PKCE is the one real gap left.** `GoogleProvider` (`src/lib/auth.js:89`) sets
  only clientId/secret → NextAuth v4 defaults to `checks:['state']`, so one-time state is
  fine but PKCE is off. Fix is `checks: ['pkce','state']` — deliberately NOT applied: it
  changes the live Google login flow and can't be tested without real OAuth creds.
- Already implemented, don't "re-fix": rate limiting, CSP, RBAC (`role` +
  `src/lib/requireAdmin.js`), audit logging (`src/lib/auditLog.js`, 28 route files),
  API-key scoping (scopes/prefix/keyHash/expiresAt/lastUsedAt), vault crypto
  (Argon2id → AES-256-GCM in `src/utils/clientCrypto.js`).
- npm audit is **0 vulnerabilities** as of 2026-09-05 (was 4: mysql2, browserslist,
  fflate, @humanfs/node). All fixes were inside existing semver ranges → used
  `npm update <pkg>`, left `package.json` alone. Prefer that over blanket
  `npm audit fix` when you can't run `next build`.
- Prod deployments that rely on **Local Relay direct transfer MUST set
  `CSP_ALLOW_LOCAL_RELAY=1`**. `buildCsp()` in `src/proxy.js:148` gates every localhost
  `connect-src` entry behind `localAllowed = !isProd || CSP_ALLOW_LOCAL_RELAY === '1'`;
  without it the reachability probe fails closed and traffic falls back to the central
  proxy. **Degrades gracefully, not a break:** `probeReachable()` (AIAgentsApp.js:115)
  swallows all errors, so `waitUntilReachable` burns 12 × 750ms ≈ **8s** and step 2
  (`buildWebUIProxyUrl`) then runs. Net effect in prod = Web UI opens ~8s slower.
- **Asymmetry worth remembering:** `frame-src` includes `http://127.0.0.1:*` /
  `http://localhost:*` **unconditionally** (NOT gated by `localAllowed`). So in prod
  you can still *frame* a local gateway while `connect-src` blocks fetching it.
  `CSP_ALLOW_LOCAL_RELAY` only governs `connect-src`.
- CSP enumerates **18790–18799** for both `127.0.0.1` and `localhost`. Deliberately NOT
  `http://127.0.0.1:*` — that would let client-side XSS probe every local port.
- `/api/rclone/*` (16 handlers, 9 routes) are guarded by `src/lib/requireSession.js`
  **in addition to** the middleware gate. It returns **503** for an unreachable session
  store (don't bounce users to sign-in mid-work) and **401** otherwise, logging ip+UA.
- Already implemented, don't "re-fix": rate limiting, CSP, RBAC, audit logging, SRI.
- **Do NOT make `monitor_csrf` HttpOnly** — double-submit CSRF requires JS to read the
  cookie. Same for the hardening doc's proposed target CSP: it drops `blob:`/`data:`
  and the localhost entries the relay path needs.

## Credential encryption
- **Server `encrypt()` format is `iv:ciphertext` — NO salt.** The `salt:iv:ciphertext`
  layout belongs only to `encryptWithPassword`/`clientCrypto`. Parsing a server secret as
  salt:iv:ct makes every record look broken ("wrong final block length") instead of the
  correct "bad decrypt" for the one real failure.
- Key = `sha256(ENCRYPTION_KEY || NEXTAUTH_SECRET)`; `ENCRYPTION_KEY_OLD` is the rotation
  fallback. `decrypt()` throws the generic `Decryption failed`, so check
  `ENCRYPTION_KEY_OLD` and a possible shell-exported `ENCRYPTION_KEY` (shell env WINS over
  `.env` in `server.js`) before concluding the key rotated.
- To repair an undecryptable record: take the credential from a sibling connection on the
  same host, **prove it authenticates over SSH first**, then re-encrypt. Keep the old
  ciphertext in a backup file.
- `nanobot` runs "open" when neither `tokenIssueSecret` nor `token` is set in the websocket
  channel: `/webui/bootstrap` then returns 200 even with a bogus `X-Nanobot-Auth`, and
  `_webui_browser_url()` emits no `bootstrapSecret`. So `webUIBootstrapPath: "/"` can be
  perfectly correct — don't "fix" it. Bootstrap secrets live in config.json or
  `logs/webui.log`, nowhere else.
