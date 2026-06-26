import connectDB, { getCenterUri } from './mongodb.js';
import SystemSetting from '../models/SystemSetting.js';

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
export async function resetAllState() {
  runningMap.clear();
  startingLocks.clear();

  try {
    const mongoUri = process.env.MONGODB_URI || getCenterUri();
    if (!mongoUri) {
      console.warn('[deployProcesses] MongoDB URI not available for startup reset');
      return;
    }
    await connectDB(mongoUri, true);
    // Find all settings keys that look like 'auto_deploy_config' or 'auto_deploy_config_*'
    // and where the status is 'running'.
    const settings = await SystemSetting.find({
      key: /^auto_deploy_config/,
      'value.status': 'running'
    });

    if (settings.length > 0) {
      const now = new Date();
      console.log(`🧹 [deployProcesses] Found ${settings.length} stale running deployment configs. Resetting to failed/interrupted...`);
      for (const setting of settings) {
        await SystemSetting.findOneAndUpdate(
          { key: setting.key },
          {
            $set: {
              'value.status': 'failed',
              'value.deployRunId': null,
              'value.lastDeployLog': (setting.value.lastDeployLog || '') + `\n[${now.toISOString()}] ⚠️ Deployment interrupted — server was restarted or crashed during deployment.\n`
            }
          }
        );
      }
    }
  } catch (err) {
    console.error('[deployProcesses] Failed to reset stale DB deployment states on startup:', err.message);
  }
}

