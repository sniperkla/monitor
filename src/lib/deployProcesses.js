// Simple in-memory registry of running deployment processes per project
const runningMap = new Map();
// Per-project lock to prevent concurrent deployment starts (race condition guard)
const startingLocks = new Map();

export function setRunning(projectId, info) {
  runningMap.set(projectId, info);
}

export function getRunning(projectId) {
  return runningMap.get(projectId);
}

export function clearRunning(projectId) {
  runningMap.delete(projectId);
  startingLocks.delete(projectId);
}

/** Returns a copy of all currently registered running deployments. Used by graceful shutdown. */
export function getAllRunning() {
  return new Map(runningMap);
}

/**
 * Try to acquire a per-project start lock. Returns true if acquired, false if already locked.
 * This prevents the TOCTOU race where two concurrent requests both see status=idle and start deployments.
 */
export function tryAcquireStartLock(projectId) {
  if (startingLocks.has(projectId)) return false;
  startingLocks.set(projectId, Date.now());
  return true;
}

export function releaseStartLock(projectId) {
  startingLocks.delete(projectId);
}

/** Reset all in-memory state — called on server startup to clear stale entries from prior crashes. */
export function resetAllState() {
  runningMap.clear();
  startingLocks.clear();
}
