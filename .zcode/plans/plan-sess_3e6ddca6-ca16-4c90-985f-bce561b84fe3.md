# Ko-fi Supporter Gating — Local Relay + Speed Profiles (lean server-side)

## What supporters get (monthly membership, granted manually by you)
**Local Relay mode** — SSH/SFTP through the user's own machine. This automatically unlocks TURBO/BALANCED/AUTO-COOL because your existing "SERVER ECO LOCK" logic (`FileManager.js:148,3912+`) already ties all speed profiles to relay mode — **zero new gating code in FileManager**. Free users keep the server path @ ECO speed. Everything else (monitor agent, all manual features, AI limits) stays free and untouched.

## Enforcement — exactly 2 server-side points, everything cached
1. **`POST /api/relay/token`** (`src/app/api/relay/token/route.js`) — add `scope` body param: `'relay'` (local relay) requires supporter → `403 SUPPORTER_REQUIRED`; `'agent'` (monitor agent) stays free, and is the default for backward compatibility with already-installed agents.
2. **`/relay-ws` handshake** (`server.js:4870`) — after token validation, check supporter (so expired supporters' already-installed relay agents are rejected with close code `4003 Supporter required` on reconnect; monitor agent `/agent-ws` untouched). Admin revoke additionally closes the user's active relays via `global.__activeRelays`.

**Resource guarantees:** no new middleware, no client polling, zero changes to hot paths (SSH keystrokes / SFTP chunks / terminal traffic). All supporter checks go through `src/utils/supporter.js` → `isSupporterUser(userId)` with a 5-minute in-memory TTL cache = worst case one indexed `User` lookup per user per 5 min. Admins bypass all gates.

## Data & auth
- **`src/models/User.js`** — new subdoc:
  `supporter: { status: Boolean, expiresAt: Date|null, source: 'admin'|'code', grantedAt, grantedBy, note, request: { kofiName, kofiEmail, note, requestedAt, status: 'pending'|'granted'|'dismissed' } }`
  Lazy expiry (`expiresAt > now`) — no cron sweep.
- **`src/lib/auth.js`** — `token.isSupporter` / `session.user.isSupporter` set only at sign-in (JWT hint, zero extra DB queries); source of truth is always the cached server check.

## New API routes
- `GET /api/user/supporter` — status + expiry (on-demand; also piggybacked on `GET /api/relay/token` so the existing 5s status poll carries it free of extra requests).
- `POST /api/user/supporter/redeem` — activation code (SHA-256 hashed like the register flow, stored hashed in `SystemSetting: supporter_codes`); extends `expiresAt = max(now, current) + code planDays` (stacking), single-use.
- `POST /api/user/supporter/request` — saves pending request on the User doc.
- `GET/POST /api/admin/supporters` — list supporters + pending requests; grant `{email, days}` / revoke / dismiss (admin role check, pattern from `api/admin/seed-keys/route.js:10-20`).
- `POST /api/admin/supporters/codes` — generate N codes with planDays; plaintext returned once.

## UI
- **`src/hooks/useSupporter.js`** — reads session hint, refreshes on demand (window focus / modal open). No polling.
- **`src/components/common/SupporterModal.js`** — Ko-fi membership button (`KOFI_PAGE_URL` env), code redemption, "request access" form (user's Ko-fi name), current status/expiry. Glass styling, trilingual via `src/lib/i18n.js` (**en/th/zh** strings).
- **Settings relay section** (`SettingsApp.js` ~1061-1270): free users see a locked card (lock icon + supporter modal trigger) instead of the install wizard; `ConnectionModal`/relay-mode picker locks the 'local' option. AppContext's existing auto-fallback (`sshMode` → 'server' when no relay connected) already degrades gracefully for free users.
- **Settings admin section** (visible to `role==='admin'`): pending requests with Grant(30d)/Dismiss, supporter list with expiry/extend/revoke, code generator.
- FileManager: only a small label tweak on the existing ECO-lock panel ("Supporter unlock") + i18n.

## Config
- `.env`: `KOFI_PAGE_URL=https://ko-fi.com/yourpage`
- Defaults in code: `defaultGrantDays: 30`, stackable renewal (each grant/code adds days); optional `SystemSetting: supporter_config` override.

## Test plan
Run dev server and verify: free user gets 403 on `scope=relay` token + locked UI, monitor agent token still works, SSH falls back to server mode @ ECO; supporter completes full relay install and sees TURBO/AUTO-COOL; letting expiry pass rejects the relay agent at reconnect (4003); code redeem stacks and rejects reuse; admin revoke kills active relays; admin bypass works; guests unaffected; en/th/zh strings render.