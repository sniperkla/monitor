# useEffect / API fetch-loop audit

Date: 2026-08-30
Scope: all client components, contexts and hooks under `src/`
Method: **static read-only analysis.** No code executed.

> **Verification caveat — read this before trusting any line number below.**
> The Bash and Grep tools are broken in this environment (Bash exits 127 for
> every command, Grep fails with `Failed to spawn sandbox-exec`). Nothing was
> compiled, linted or run. Findings came from reading files directly.
> - `[V]` = I read the exact lines myself and confirmed the claim.
> - `[R]` = reported by a review agent, **not** personally re-verified.
> Line numbers may drift; treat them as approximate.

---

## Executive summary

**No true infinite `useEffect` → fetch → setState → useEffect loop was found.**
Every polling effect has some guard or cleanup. The real damage is different and
worse in aggregate:

1. **Unmemoized `connections` arrays in dependency arrays.** `connections` is
   recomputed with `.filter()` on every render, so any effect listing it
   re-runs on *every render*. In `FirewallBlocklistApp` this recreates the
   WebSocket and re-emits `start_stream` ~once per second. This is the single
   worst defect.
2. **Unmemoized context `value={{...}}`** in all three providers
   (`OSContext`, `AppContext`, `VaultContext`) — every consumer re-renders on
   every provider render, which amplifies every other defect on this list.
3. **Stale closures.** Several polling effects list an incomplete dep array, so
   the interval permanently calls a first-render function over stale data.
4. **Redundant pollers.** Two or three concurrent pollers hitting the same
   endpoint, often alongside an SSE/WS stream already delivering the same data.
5. `requestDedup` is only wired into `AppContext.apiFetch`. Everything else
   calls raw `fetch`.

---

## Fixes applied — 2026-08-31

The user approved fixing these. **Nothing has been compiled or executed** — the
shell in this environment is still broken (Bash exits 127, Grep fails on
`sandbox-exec`). All changes are static-read-only verified. **Run a build and a
manual smoke test before trusting any of it.**

| # | Fix | File |
|---|---|---|
| 1 | Memoized all three provider `value={{...}}` objects | `OSContext.js`, `AppContext.js`, `VaultContext.js` |
| 2 | Hoisted 9 inline dispatch-wrapper arrows into `useCallback` | `OSContext.js` |
| 2 | Hoisted `getMasterPassword` / `verifyMasterPassword` into `useCallback` | `VaultContext.js` |
| 3 | Removed the duplicate `fetchConnections()`; added a once-only transition refetch (effect 2b) | `AppContext.js` |
| 4 | `clearDedupCache()` now called when leaving the unlocked state | `AppContext.js` |
| 5 | Memoized `connections` (was a bare `.filter()` in a dep array) | `FirewallBlocklistApp.js` |
| 6 | 10s `loadStatus` poll now skipped while the realtime stream is active | `FirewallBlocklistApp.js` |
| 7 | Memoized `sshConnections` | `DockerApp.js` |
| 8 | Memoized `connections` | `RcloneApp.js` |
| 9 | `targetPath` moved to a ref so the 3s and 6s intervals stop rebuilding per keystroke | `RcloneApp.js` |
| 10 | `refresh` wrapped in `useCallback`; `initTimer` now cleared | `useAIUsage.js` |
| 11 | `pollInterval` / `placeholderTimer` hoisted into the effect scope and cleared by the real cleanup | `AIAgentsApp.js` |
| 12 | Removed the duplicate `ssh:error` / `connect_error` listeners | `AIAgentsApp.js` |
| 13 | `pollStatus` cleanup now retained and invoked; unmount cleanup for the 3s status poll and the 800ms transfer poll; transfer poll no longer stacks | `ServerBackupApp.js` |
| 14 | `loadRef` fixes the stale-closure 30s poll; `didInitialSearchRef` removes the duplicate mount fetch | `ActivityApp.js` |
| 15 | `fetchHistoryRef` / `fetchAllCronLogsRef` fix the frozen stale-closure 10s poll | `MongoBackupApp.js` |

### Two findings from the audit that turned out to be FALSE ALARMS

- **`ServerMonitorApp.js` `connections` was already memoized** (`:1493`). The
  concern in finding #7 that effect `:2042` re-emits `start_stream` every render
  is unfounded. No change made.
- **The RcloneApp 3s and 6s polls are not duplicate pollers.** The 3s one fetches
  `latestLog=1` for the cron live-log and already guards with
  `if (activeJob && isJobRunning) return;`. They hit the same endpoint but serve
  different state. Only the dep-array thrash was real, and that is fixed.

### Not fixed (needs a product decision, not a mechanical change)

- `ServerMonitorApp.js:1881` — the socket effect deps are `[handleIncomingTelemetry]`
  only, so `selectedConnection` / `refreshInterval` are captured at connect time.
  Re-targeting is handled by effect `:2042`, so this is a deliberate split, not a
  bug. Changing it would restructure the socket lifecycle — left alone.
- `DockerApp.js:377` — deps key on `_id` but the body emits the whole
  `selectedConnection` object. Fixing means changing what the server receives.
- `SettingsApp.js:651` — the 10s poll duplicates the SSE. Merging them changes
  what the UI renders on reconnect; needs a behaviour call.
- The `?_=${Date.now()}` cache-busters in `VirusScannerApp` are deliberate.

---

## CRITICAL

### 1. `FirewallBlocklistApp.js:593` — WebSocket rebuilt on every render `[V]`

```js
// :270  — new array identity every render, never memoized
const connections = (appState?.connections || []).filter(c => c.type !== 'database');

// :593
useEffect(() => {
  if (activeTab !== 'controls' || !connectionId || !status?.blocklist?.active) return undefined;
  const conn = connections.find(...);
  const socket = io({ path: '/api/socket', transports: ['websocket', 'polling'] });
  socket.on('connect', () => { socket.emit('telemetry:start_stream', { interval: 1000, ... }); });
  ...
}, [activeTab, connectionId, status?.blocklist?.active, connections, agentTick]);  // :642
```

The component re-renders roughly once per second because the telemetry stream it
subscribes to writes state. Each render produces a new `connections` array → the
effect tears down the socket and opens a new one → emits another
`telemetry:start_stream`. Streams pile up server-side.

**Fix:** remove `connections` from the dep array and read it through a ref
(`connectionsRef.current`), or wrap it in `useMemo` keyed on
`appState.connections`. The same pattern at `DockerApp.js:294/312` and
`RcloneApp.js:615/730` is currently harmless only because of early-return guards.

### 2. `AppContext.js:392` + `:450` — double `fetchConnections()` `[V]`

```js
// :392  deps [vaultStatus, decryptedUri, decryptedTunnel,
//             state.dbConfig?.uri, state.dbConfig?.tunnel, fetchConnections]
fetchConnections();                                    // :404
...
// :450  deps [state.dbConfig?.uri, fetchConnections]
fetchConnections();                                    // :452
```

Both effects key off `state.dbConfig?.uri`. When `SET_DB_CONFIG` dispatches (as
effect `:392` itself does at `:396`), both fire. Partly masked by the 1 s GET
short-circuit inside `requestDedup`, so it is easy to miss in the network panel.

### 3. `AppContext.js` — `fetchConnections()` re-triggers itself `[V]`

`fetchConnections` dispatches `window.dispatchEvent(new Event('ssh-mode-changed'))`
(`:346`, `:369`). The listener registered at `:438-444` sees the mode flip and
calls `fetchConnections()` again. Any call can therefore fan out.

---

## HIGH

### 4. `useAIUsage.js:214` — timers re-armed every render `[V]`

```js
// :275
}, [interval, refresh, onThresholdCrossed, getDayKey]);
```
`refresh` is `() => fetchUsage(true)`, a fresh arrow created at `:198` on every
render. The effect destroys and recreates the 2 s `setTimeout` + the poll
`interval` on every render.

Severity is bounded: `poll` is gated by a 55 s `localStorage`/`lastPollRef`
check (`:224-231`), so this is **timer churn, not a request storm**. Fix:
`const refresh = useCallback(() => fetchUsage(true), [fetchUsage]);`.
Also `setTimeout(clearInitializing, 1000)` at `:181` is never cleared.

### 5. `RcloneApp.js:900` — 3 s poll thrashes on every keystroke `[V]`

```js
}, [selectedConnId, activeTab, apiFetch, targetPath, activeJob, isJobRunning]);  // :900
```
`targetPath` is bound directly to a text input (`:1896`
`onChange={setTargetPath}`), so every keypress destroys and recreates the 3 s
interval. `RcloneApp.js:1169` polls the **same** `/api/rclone/history`
endpoint on a 6 s interval — two concurrent pollers, both thrashing.
`RcloneApp.js:852` (1 s) and `:874` (1.5 s) add two more.

### 6. `AIAgentsApp.js:792` — poll interval escapes React cleanup `[V]`

```js
socket.on('ssh:connected', () => {
  const pollInterval = setInterval(() => { ...; fetchSnapshot(); }, 5000);  // :951
  setTimeout(() => { ... }, 3000);                                          // :965
  return () => { clearInterval(pollInterval); };   // :975 — handed to socket.io, not React
});
...
return () => { active = false; ... };              // :1021 — never clears pollInterval
```

The `return` at `:975` is the return value of a socket.io event handler;
socket.io discards it. The effect's real cleanup at `:1021` only sets
`active = false`. **Bounded, not permanent:** the interval's own `if (!active)
clearInterval(...)` guard (`:952-955`) self-clears on the next tick, so you leak
at most one tick and one POST after teardown. The `setTimeout` at `:965` is
never cleared (also `active`-guarded).

**Fix:** hoist `pollInterval` into a local `let` in the effect scope and clear it
in the effect's own cleanup at `:1021`.

> **Correction to an earlier claim:** `ssh:error` is registered twice (`:892`,
> `:1009`) and `connect_error` twice (`:888`, `:1015`), but I checked and only
> the *second* handler of each pair calls `fetchSnapshot()`. So this is
> duplicate/dead code, **not** a double POST per error.

### 7. `ServerMonitorApp.js:1881` — socket captures stale targeting `[V]`

```js
}, [handleIncomingTelemetry]);   // :2036
```
The effect creates the socket and emits `telemetry:start_stream` (`:1905`), but
the handler body reads `connections`, `selectedConnection`, `autoRefresh`,
`isTabVisible` and `refreshInterval` — none of which are deps. They are frozen
at connect time. The split with effect `:2042` (deps `[autoRefresh, isTabVisible,
selectedConnection, refreshInterval, isP2PStreaming, connections]`) is
deliberate — `:1881` owns socket lifecycle, `:2042` re-targets it — but `:2042`
includes `connections`, so **if `connections` is an unmemoized filter here too,
`:2042` re-emits `start_stream` on every render.** `[R]` — I could not locate the
`connections` definition to confirm memoization. **Verify this first.**

### 8. `MongoBackupApp.js:474` — 10 s poll locked to stale closure `[R]`

```js
}, [activeTab]);   // :488
```
`fetchHistory` (`:458`) and `fetchAllCronLogs` are recreated every render and
absent from deps. The interval calls the first-render closures forever, so
`fetchAllCronLogs` keeps filtering a stale `jobs` array.

### 9. `ServerBackupApp.js:370-409` — poll cleanup discarded at call site `[R]`

```js
const pollStatus = (...) => {
  const interval = setInterval(async () => {...}, 3000);   // :371
  return () => clearInterval(interval);                    // :408
};
...
pollStatus(connectionId, data.logFile, data.outFile);      // :441 — return value ignored
```
Survives unmount; a second backup adds a second overlapping 3 s poll. Cleared
only on `completed`/`failed`. Also `:526-552` runs an 800 ms transfer poll with
no effect cleanup.

---

## MEDIUM

| # | Location | Issue `[R]` unless noted |
|---|---|---|
| 10 | `ActivityApp.js:131` + `:134` | Mount fetch **and** a 350 ms `setTimeout` fetch → 2× `/api/activity` on open. `[V]` deps confirmed |
| 11 | `ActivityApp.js:148` | 30 s interval captures `load` from first render (deps `[category]` only). After typing a search, refresh overwrites filtered results with unfiltered data. |
| 12 | `SettingsApp.js:651` | 10 s poll of `/api/deploy/config` duplicates the SSE at `:606`, which already pushes `status`/`lastDeployLog`/`lastDeployAt`. |
| 13 | `SettingsApp.js:606` | SSE effect depends on `addNotification` (OSContext). If that is not `useCallback`-stable, every notification closes and reopens the SSE. |
| 14 | `SettingsApp.js:482` | Four API calls, deps `[activeTab, selectedProjectId]` with `eslint-disable`. Saved only by `deployFetchKeyRef`/`deployFetchInProgressRef`. |
| 15 | `DockerApp.js:377` | Deps key on `selectedConnection?._id` / `dbConfig?.uri`, but the body emits the whole `selectedConnection` object (`:413`). Unchanged `_id` after `SET_CONNECTIONS` → stale connection reused, socket never rebuilt. |
| 16 | `AIAgentsApp.js:755` | Deps `[tab, target]`, `eslint-disable`d. Missing `call`/`agentId` → switching agent on the Config tab keeps the previous agent's backup list. |
| 17 | `AIAgentsApp.js:471` | `loadDetails` missing from deps; `setTab('overview')` (`:476`) cascades into effect `:659` and tears down the log socket — a fetch cascade. `loadDetails` already sets `yamlDraft`/`promptDraft` (`:375-386`), which effect `:481` then redoes. |
| 18 | `VaultContext.js:47` | Deps `[session, authStatus]`. `session` is an object; next-auth refetch on window focus changes its identity → `GET /api/user/vault` again. |
| 19 | `AppContext.js:535` | Comment claims "every 20 seconds" but the effect has deps `[]` and calls `pollHealth()` **once**. No `setInterval`. |
| 20 | `FirewallBlocklistApp.js:644` | 10 s `loadStatus` poll keeps running while the 1 s realtime stream (`:593`) already feeds the same data. |
| 21 | `FirewallBlocklistApp.js:664` | 2 s `loadSourceStatus` poll — cleared correctly, but 2 s is excessive. |
| 22 | `ServerBackupApp.js:96` | Read-then-write: effect at `:80` loads history, effect at `:96` POSTs it straight back after 1 s. |

---

## Cross-cutting

### Providers: unmemoized `value={{...}}` — amplifies everything above `[V]` structure

- `OSContext.js:1683` — plus ~12 inline arrows at `:1737-1747`
- `AppContext.js:596`
- `VaultContext.js:402` — including `getMasterPassword: () => masterPwdRef.current`

Each provider render produces a new context object → **all** consumers
re-render. Because `VaultProvider` wraps `AppProvider`, a vault tick re-renders
the whole tree, which re-runs every effect with an unstable dep anywhere in the
app. **Fixing these three `useMemo`s is probably the highest-leverage single
change in this codebase.**

### `requestDedup` is nearly unused

`src/utils/requestDedup.js` provides in-flight coalescing (any method) plus a
1 s short-circuit **for GET only**. It is used in exactly one place:
`AppContext.js:7` → `apiFetch` (`:263`).

Raw `fetch` bypassing it: `OSContext` (`:1002`, `:1127`, `:1227`, `:1270`,
`:1322`, `:1339`), `VaultContext` (`:115`, `:271`, `:305`, `:326`, `:336`,
`:373`), `AppContext` itself (`:419`, `:513`, `:543`), `useAIUsage` (`:109`),
`useSupporter` (`:43`), `Dashboard` (`:265`), `AIAgentsApp` (`:838`, and all
of `call()` at `:298`).

Two secondary issues:
- `clearDedupCache` is imported by `AppContext` but **never called** — cached
  GET responses survive logout. On a shared machine that is a data-leak path.
- `?_=${Date.now()}` cache-busters (`VirusScannerApp.js:370`, `:512`) defeat the
  dedup layer by design.

Note that `dedupedFetch` would **not** fix findings 1, 5 or 6 — those are
sequential requests, not concurrent ones. It only collapses in-flight overlap.

### Unrelated bug noticed in passing

`OSContext.js` reducer has duplicate `case` labels:
`'REMOVE_WINDOW_FROM_DESKTOP'` (`:592`, `:625`), `'MOVE_WINDOW_TO_DESKTOP'`
(`:602`, `:705`), `'ADD_WINDOW_TO_DESKTOP'` (`:582`, `:647`). The later
definitions silently win. `[R]` — not verified by me.

---

## Recommended fix order

Status as of 2026-08-31: **DONE** unless marked otherwise.

1. **DONE** — Memoize the three provider `value` objects. Highest leverage.
2. **DONE** — Stabilize `connections` in `FirewallBlocklistApp` (memoized).
3. **N/A** — `connections` in `ServerMonitorApp` was already memoized; false alarm.
4. **DONE** — Memoize `refresh` in `useAIUsage`.
5. **DONE** — Move `pollInterval` into the effect scope in `AIAgentsApp`.
6. **DONE** — Clear the `pollStatus` / transfer polls in `ServerBackupApp`.
7. **PARTIAL** — `ActivityApp` mount + 350 ms duplication removed; the
   `RcloneApp` "duplicate" was a false alarm; `FirewallBlocklistApp` 10 s vs
   stream now gated on `realtimeActive`; `SettingsApp` 10 s vs SSE **not done**
   (needs a product decision).
8. **DONE** — `clearDedupCache()` on leaving the unlocked state.

---

## Clean

`AutoDeployApp.js` (7-line wrapper, no hooks). `VirusScannerApp.js` — all
intervals have a single owner and clear on unmount; `loadResults` /
`loadEngineStatuses` are properly `useCallback`'d. `useSupporter.js` — stable
deps with a 60 s global cache guard. `Dashboard.js:105` — 60 s interval cleared
correctly. `AIAgentsApp.js:1058` health watchdog — correct; uses refs to avoid
stale closures. `useIsMobile.js`, `src/app/page.js:72` — clean.
