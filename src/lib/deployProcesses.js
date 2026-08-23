import connectDB, { getCenterUri } from './mongodb.js';
import SystemSetting from '../models/SystemSetting.js';
import { logger } from '@/lib/logger';

// Simple in-memory registry of running deployment processes per project
const runningMap = new Map();
// Per-project lock to prevent concurrent deployment starts (race condition guard)
const startingLocks = new Map();
// Per-project queue: array of { config, runMeta, resolve, reject }
const deployQueues = new Map();

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

/**
 * Forcefully kill any in-memory running process for a project, then clear it.
 * Safe to call even if nothing is running.
 */
export function killRunning(projectId) {
  const entry = runningMap.get(projectId);
  if (entry) {
    try {
      if (entry.type === 'local' && entry.proc) {
        // Kill the entire process group (detached child)
        try { process.kill(-entry.proc.pid, 'SIGKILL'); } catch (_) {}
        try { entry.proc.kill('SIGKILL'); } catch (_) {}
      } else if (entry.type === 'ssh' && entry.conn) {
        try { entry.conn.end(); } catch (_) {}
      }
    } catch (_) {}
  }
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

/**
 * Enqueue a deployment if one is already running, or run it immediately if idle.
 * Returns a promise that resolves when the deployment completes (or errors).
 * This ensures rapid successive pushes are serialized instead of rejected.
 */
export function enqueueDeployment(projectId, runFn) {
  return new Promise((resolve, reject) => {
    if (!deployQueues.has(projectId)) {
      deployQueues.set(projectId, []);
    }
    const queue = deployQueues.get(projectId);
    
    queue.push({ runFn, resolve, reject });
    
    // If this is the only item, start processing immediately
    if (queue.length === 1) {
      processQueue(projectId);
    }
  });
}

/**
 * Process the queue for a project — run the next deployment, then continue.
 */
async function processQueue(projectId) {
  const queue = deployQueues.get(projectId);
  if (!queue || queue.length === 0) {
    deployQueues.delete(projectId);
    return;
  }

  const item = queue[0]; // peek, don't shift yet (shift after completion)
  
  try {
    await item.runFn();
    item.resolve();
  } catch (err) {
    item.reject(err);
  } finally {
    // Remove the completed item
    queue.shift();
    
    // Process next in queue
    if (queue.length > 0) {
      setImmediate(() => processQueue(projectId));
    } else {
      deployQueues.delete(projectId);
    }
  }
}

/** Reset all in-memory state — called on server startup to clear stale entries from prior crashes. */
export async function resetAllState() {
  runningMap.clear();
  startingLocks.clear();

  try {
    const mongoUri = process.env.MONGODB_URI || getCenterUri();
    if (!mongoUri) {
      logger.warn('[deployProcesses] MongoDB URI not available for startup reset');
      return;
    }
    await connectDB(mongoUri, true);
    // Find all settings keys that look like 'auto_deploy_config' or 'auto_deploy_config_*'
    // and where the status is 'running' OR serverRestarted flag is set.
    const settings = await SystemSetting.find({
      key: /^auto_deploy_config/,
      $or: [
        { 'value.status': 'running' },
        { 'value.serverRestarted': true }
      ]
    });

    if (settings.length > 0) {
      const now = new Date();
      for (const setting of settings) {
        const config = setting.value || {};
        const projectId = setting.key.replace('auto_deploy_config_', '').replace('auto_deploy_config', 'default');

        if (config.serverRestarted && config.targetType === 'ssh') {
          // SSH deploy: server was gracefully restarted — attempt to reconnect to tmux session
          logger.info(`🔄 [deployProcesses] SSH deploy "${projectId}" marked for reconnection. Attempting...`);
          // Clear the flag
          await SystemSetting.findOneAndUpdate(
            { key: setting.key },
            { $set: { 'value.serverRestarted': false } }
          );
          // Attempt reconnect in background (non-blocking)
          attemptTmuxReconnect(config, projectId, setting.key).catch(err => {
            logger.error(`[deployProcesses] Reconnect failed for "${projectId}":`, err.message);
          });
        } else {
          // Local deploy or crash without graceful shutdown — mark as failed
          logger.info(`🧹 [deployProcesses] Stale running deploy "${projectId}". Resetting to failed...`);
          await SystemSetting.findOneAndUpdate(
            { key: setting.key },
            {
              $set: {
                'value.status': 'failed',
                'value.deployRunId': null,
                'value.lastDeployLog': (config.lastDeployLog || '') + `\n[${now.toISOString()}] ⚠️ Deployment interrupted — server was restarted or crashed during deployment.\n`
              }
            }
          );
        }
      }
    }
  } catch (err) {
    logger.error('[deployProcesses] Failed to reset stale DB deployment states on startup:', err.message);
  }
}

/** Attempt to reconnect to a tmux session on the remote server after a server restart. */
async function attemptTmuxReconnect(config, projectId, dbKey) {
  const startedAt = config.lastDeployAt ? new Date(config.lastDeployAt) : new Date();
  const { Client } = await import('ssh2');
  const { ConnectionRepository } = await import('./repositories/ConnectionRepository.js');
  const { decrypt } = await import('../utils/encryption.js');
  const { broadcastDeploymentStatus } = await import('../app/api/deploy/sse/route.js');

  const tmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);

  // Build SSH config from stored connection data
  let sshConnData = config.sshConnectionData;
  if (!sshConnData || !sshConnData.host) {
    const mongoUri = process.env.MONGODB_URI || getCenterUri();
    const db = await import('./mongodb.js').then(m => m.default(mongoUri, true));
    const repo = new ConnectionRepository(db);
    await repo.init();
    const connection = await repo.findById(config.connectionId);
    if (!connection) {
      logger.error(`[deployReconnect] SSH connection ${config.connectionId} not found for project "${projectId}"`);
      const failLog = (config.lastDeployLog || '') + `\n[${new Date().toISOString()}] ❌ Could not reconnect — SSH connection not found.\n`;
      await updateDeployLog(dbKey, failLog, 'failed', config, startedAt);
      await broadcastDeploymentStatus(projectId);
      return;
    }
    sshConnData = {
      host: connection.host,
      port: connection.port || 22,
      username: connection.username || 'root',
      authType: connection.authType,
      password: connection.password || '',
      privateKey: connection.privateKey || '',
      passphrase: connection.passphrase || ''
    };
  }

  const sshConfig = {
    host: sshConnData.host,
    port: sshConnData.port || 22,
    username: sshConnData.username || 'root',
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 6,
  };

  if (sshConnData.authType === 'password' && sshConnData.password) {
    let decrypted = decrypt(sshConnData.password);
    if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
      const test = decrypt(decrypted);
      if (test && !test.includes(':')) decrypted = test;
    }
    sshConfig.password = decrypted;
  } else if (sshConnData.authType === 'privateKey' && sshConnData.privateKey) {
    let decrypted = decrypt(sshConnData.privateKey);
    if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
      const test = decrypt(decrypted);
      if (test && !test.includes(':')) decrypted = test;
    }
    sshConfig.privateKey = decrypted;
    if (sshConnData.passphrase) {
      let dec = decrypt(sshConnData.passphrase);
      if (dec && dec.includes(':') && dec.length > 40) {
        const test = decrypt(dec);
        if (test && !test.includes(':')) dec = test;
      }
      sshConfig.passphrase = dec;
    }
  }

  // Reconnect with retries
  const maxRetries = 30;
  const retryInterval = 5000;
  let logOutput = config.lastDeployLog || '';

  const tryReconnect = (attempt) => {
    return new Promise((resolve, reject) => {
      if (attempt > maxRetries) {
        reject(new Error('Max retries exceeded'));
        return;
      }

      const conn = new Client();
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { conn.end(); } catch {}
          setTimeout(() => tryReconnect(attempt + 1).then(resolve).catch(reject), retryInterval);
        }
      }, 10000);

      conn.on('ready', () => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;

        logOutput += `\n[SSH-monitor] Reconnected after server restart! Monitoring tmux session "${tmuxSession}"...\n`;
        updateDeployLog(dbKey, logOutput, 'running', config, startedAt);
        broadcastDeploymentStatus(projectId).catch(() => {});

        const logFile = `/tmp/deploy_${tmuxSession}.log`;
        const statusFile = `/tmp/deploy_${tmuxSession}.status`;
        const monitorCmd = [
          `set +e`,
          `if tmux has-session -t ${tmuxSession} 2>/dev/null; then`,
          `  echo "[deploy-monitor] tmux session still running, tailing log..."`,
          `  tail -n +1 -f "${logFile}" & TAIL_PID=$!`,
          `  while tmux has-session -t ${tmuxSession} 2>/dev/null; do sleep 1; done`,
          `  kill $TAIL_PID 2>/dev/null || true; wait $TAIL_PID 2>/dev/null || true`,
          `  echo "---DEPLOY_EXIT_CODE:$(cat "${statusFile}" 2>/dev/null || echo 0)---"`,
          `  echo "---DEPLOY_MONITOR_DONE---"`,
          `else`,
          `  echo "[deploy-monitor] tmux session already ended"`,
          `  if [ -f "${logFile}" ]; then cat "${logFile}"; fi`,
          `  echo "---DEPLOY_EXIT_CODE:$(cat "${statusFile}" 2>/dev/null || echo 0)---"`,
          `  echo "---DEPLOY_MONITOR_DONE---"`,
          `fi`,
        ].join('\n');

        conn.exec(monitorCmd, (execErr, stream) => {
          if (execErr) {
            logOutput += `[SSH-monitor] Failed: ${execErr.message}\n`;
            updateDeployLog(dbKey, logOutput, 'failed', config, startedAt);
            broadcastDeploymentStatus(projectId).catch(() => {});
            conn.end();
            resolve();
            return;
          }

          let monitorBuf = '';
          let monitorExitCode = 0;

          stream.on('data', (data) => {
            monitorBuf += data.toString();
            const lines = monitorBuf.split('\n');
            monitorBuf = lines.pop();

            for (const rawLine of lines) {
              const line = rawLine.replace(/\r/g, '');
              const exitMatch = line.match(/---DEPLOY_EXIT_CODE:(\d+)---/);
              if (exitMatch) monitorExitCode = parseInt(exitMatch[1], 10);

              if (line.includes('---DEPLOY_MONITOR_DONE---')) {
                const exitCode = monitorExitCode;
                const finishedAt = new Date();
                logOutput += `\n--------------------------------------------------\n`;
                logOutput += `[${finishedAt.toISOString()}] [SSH-monitor] tmux session completed. Exit code: ${exitCode}\n`;
                const status = exitCode === 0 ? 'success' : 'failed';
                updateDeployLog(dbKey, logOutput, status, config, startedAt);
                broadcastDeploymentStatus(projectId).catch(() => {});
                conn.exec(`rm -f /tmp/deploy_${tmuxSession}.log /tmp/deploy_${tmuxSession}.status /tmp/deploy_tmux_${projectId}.sh; true`, () => {});
                conn.end();
                resolve();
                return;
              }
              logOutput += rawLine + '\n';
            }
            updateDeployLog(dbKey, logOutput, 'running', config, startedAt);
          });

          stream.stderr.on('data', (data) => {
            logOutput += data.toString();
            updateDeployLog(dbKey, logOutput, 'running', config, startedAt);
          });

          stream.on('close', () => {
            if (monitorBuf && monitorBuf.trim()) logOutput += monitorBuf;
          });
        });
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          setTimeout(() => tryReconnect(attempt + 1).then(resolve).catch(reject), retryInterval);
        }
      });

      conn.connect(sshConfig);
    });
  };

  // Start first attempt after 10s delay (let server fully boot)
  await new Promise(r => setTimeout(r, 10000));
  try {
    await tryReconnect(1);
  } catch (err) {
    logOutput += `\n[SSH-monitor] ❌ Could not reconnect after ${maxRetries} attempts. Deploy may have succeeded — check server manually.\n`;
    await updateDeployLog(dbKey, logOutput, 'failed', config, startedAt);
    await broadcastDeploymentStatus(projectId).catch(() => {});
  }
}

async function updateDeployLog(dbKey, logText, status, config, startedAt) {
  try {
    const mongoUri = process.env.MONGODB_URI || getCenterUri();
    await import('./mongodb.js').then(m => m.default(mongoUri, true));
    const updateFields = {
      'value.lastDeployLog': logText,
      'value.lastDeployAt': new Date(),
    };
    if (status) {
      updateFields['value.status'] = status;
      if (status !== 'running') {
        updateFields['value.deployRunId'] = null;
      }
    }
    await SystemSetting.findOneAndUpdate({ key: dbKey }, { $set: updateFields });

    // Send Telegram notification on terminal status (success/failed)
    if (config && status && status !== 'running') {
      try {
        const { sendTelegramNotification } = await import('../app/api/deploy/webhook/route.js');
        const duration = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : undefined;
        await sendTelegramNotification(config, status, { duration, logText });
      } catch (err) {
        logger.error('[deployReconnect] Failed to send Telegram notification:', err.message);
      }
    }
  } catch (err) {
    logger.error('[deployReconnect] Failed to update deploy log:', err.message);
  }
}

