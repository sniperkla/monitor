# Zombie Deploy Process Fix — Complete Summary

## Problem
Multiple deployment processes piling up ("zombie swarm runs") when rapid pushes arrive, causing:
- Latest push not deploying because old ones are stuck
- Docker Swarm service updates racing and conflicting
- Stale bash/SSH processes consuming resources

## Root Causes
1. **In-memory process tracking lost on restart** — `runningMap` cleared but DB still shows `status: running`
2. **No queue** — second push rejected with 409 instead of waiting
3. **Remote tmux sessions pile up** — new SSH deploy doesn't kill previous tmux session
4. **No zombie cleanup** — no way to force-kill all stuck processes

## Solutions Implemented

### 1. `killRunning()` — Force Kill In-Memory Processes
**File:** `src/lib/deployProcesses.js`

```js
export function killRunning(projectId) {
  const entry = runningMap.get(projectId);
  if (entry) {
    if (entry.type === 'local' && entry.proc) {
      process.kill(-entry.proc.pid, 'SIGKILL'); // kills bash watcher, NOT Docker
    } else if (entry.type === 'ssh' && entry.conn) {
      entry.conn.end(); // closes SSH socket
    }
  }
  runningMap.delete(projectId);
  startingLocks.delete(projectId);
}
```

**Safety:** Only kills the Node.js watcher process (bash/SSH). Docker containers and Swarm services are unaffected.

---

### 2. Zombie Guard at Start of Every Deploy
**File:** `src/app/api/deploy/webhook/route.js` → `runDeployment()`

```js
// Kill any existing in-memory stale watcher
if (getRunning(projectId)) {
  killRunning(projectId);
}

// Reset DB status if stuck at 'running'
await SystemSetting.findOneAndUpdate(
  { key: dbKey, 'value.status': 'running' },
  { $set: { 'value.status': 'idle', ... } }
);
```

**Effect:** Every new deploy starts clean, even if the previous one crashed.

---

### 3. Remote Tmux Session Kill on SSH Connect
**File:** `src/app/api/deploy/webhook/route.js` → `conn.on('ready')`

```js
const prevTmuxSession = `deploy-${projectId}`.slice(0, 60);
conn.exec(
  `tmux kill-session -t ${prevTmuxSession} 2>/dev/null || true; ` +
  `rm -f /tmp/deploy_${prevTmuxSession}.* ...`,
  (killErr, killStream) => { if (killStream) killStream.resume(); }
);
```

**Effect:** Kills previous zombie tmux session on remote server before starting new one.

**Safety:** Only kills the project-specific tmux session (e.g., `deploy-myproject`), not your other tmux sessions.

---

### 4. Deploy Queue — Serialize Rapid Pushes
**File:** `src/lib/deployProcesses.js`

```js
export function enqueueDeployment(projectId, runFn) {
  return new Promise((resolve, reject) => {
    const queue = deployQueues.get(projectId) || [];
    queue.push({ runFn, resolve, reject });
    deployQueues.set(projectId, queue);
    
    if (queue.length === 1) {
      processQueue(projectId); // start immediately if idle
    }
  });
}
```

**Before:** Second push → 409 rejected  
**After:** Second push → queued, runs after first finishes

**Updated:** `webhook/route.js` and `trigger/route.js` now call `enqueueDeployment()` instead of rejecting on busy.

---

### 5. `--remove-orphans` Auto-Patched into Docker Compose
**File:** `src/app/api/deploy/webhook/route.js`

```js
if (/docker\s+compose\s+up\b/.test(line) && !line.includes('--remove-orphans')) {
  return line.replace(/docker\s+compose\s+up\b/, 'docker compose up --remove-orphans');
}
if (/docker\s+compose\s+down\b/.test(line) && !line.includes('--remove-orphans')) {
  return line.replace(/docker\s+compose\s+down\b/, 'docker compose down --remove-orphans');
}
```

**Effect:** Automatically removes orphaned containers from old compose files.

---

### 6. `/api/deploy/clean` — Manual Zombie Cleanup
**File:** `src/app/api/deploy/clean/route.js`

```js
POST /api/deploy/clean
```

Kills all in-memory processes across all your projects + resets DB status from `running → idle`.

**UI Button:** `🧹 Clean Zombies` in SettingsApp deployment toolbar.

**Confirmation:** Shows warning that Docker is NOT affected.

---

## Worst Cases & Safety

### Q: Will `killRunning()` kill my Docker containers?
**No.** It only kills the bash/SSH **watcher** process. Docker processes are children of `dockerd`, not bash.

### Q: What if two pushes fire at the exact same time?
**Fixed.** The queue serializes them — second one waits for first to finish.

### Q: What if a Docker Swarm update is mid-converge when new push arrives?
The new push kills the tmux session (log stops) and starts a fresh Swarm update. The old update continues independently in Docker. Two updates may race for ~10s until the old one finishes or rolls back. This is unavoidable without a proper Swarm lock (would require querying Swarm's internal state).

### Q: Can `--remove-orphans` delete my containers?
Only if they're from a service **no longer in your compose file**. Standard practice.

---

## Migration Notes

No DB migration needed. Changes are backward-compatible.

If you have old processes stuck right now:
1. Click `🧹 Clean Zombies` in the UI, or
2. Restart the server (triggers `resetAllState()` on startup)

---

## Files Changed

- `src/lib/deployProcesses.js` — added `killRunning()`, `enqueueDeployment()`, `processQueue()`
- `src/app/api/deploy/webhook/route.js` — zombie guard, queue, tmux kill, `--remove-orphans` patch
- `src/app/api/deploy/trigger/route.js` — queue instead of reject
- `src/app/api/deploy/clean/route.js` — NEW manual cleanup endpoint
- `src/apps/SettingsApp.js` — `handleCleanZombies()` + 🧹 button

---

## Testing

1. Push code 3 times rapidly → should see 3 deploys run sequentially, not rejected or piling up
2. While deploy is running, push again → should queue and run after first finishes
3. Kill server mid-deploy → restart, deploy should reset to failed/idle
4. SSH deploy: new push should kill old tmux session before starting
