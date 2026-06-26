import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import SystemSetting from "@/models/SystemSetting";
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { broadcastDeploymentStatus } from '@/app/api/deploy/sse/route';
import { setRunning, clearRunning, getRunning, tryAcquireStartLock, releaseStartLock } from '@/lib/deployProcesses';

// Simple per-project rate limiter for deployment triggers
const triggerRateLimit = new Map();
const TRIGGER_RATE_WINDOW_MS = 60000; // 1 minute
const TRIGGER_RATE_MAX = 10; // max 10 triggers per minute per project

function checkTriggerRateLimit(projectId) {
  const now = Date.now();
  const entry = triggerRateLimit.get(projectId);
  if (!entry || now - entry.windowStart > TRIGGER_RATE_WINDOW_MS) {
    triggerRateLimit.set(projectId, { windowStart: now, count: 1 });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > TRIGGER_RATE_MAX) {
    const resetIn = TRIGGER_RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, resetIn };
  }
  return { allowed: true };
}

// Verify webhook signature using HMAC-SHA256
// Supports both GitHub (x-hub-signature-256) and Bitbucket (x-hub-signature) headers
function verifySignature(bodyText, secret, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split('=');
  if (parts.length !== 2) return false;
  const algo = parts[0]; // 'sha256' for GitHub, 'sha1' for Bitbucket
  const signature = parts[1];
  if (algo !== 'sha256' && algo !== 'sha1') return false;
  const hmac = crypto.createHmac(algo, secret);
  const digest = hmac.update(bodyText).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch (e) {
    return false;
  }
}

// Restrict log output to prevent database bloat, event-loop blocking, and network delay.
// Keeps the last N characters of log text.
function limitLogOutput(logText, maxChars = 150000) {
  if (!logText) return '';
  if (logText.length <= maxChars) return logText;
  
  const truncated = logText.slice(-maxChars);
  const firstNewline = truncated.indexOf('\n');
  const cleanTruncated = firstNewline !== -1 ? truncated.slice(firstNewline + 1) : truncated;
  
  return `[... previous logs truncated for size ...]\n` + cleanTruncated;
}

// Helper to update status in DB (outside runDeployment scope)
async function updateDeployStatus(projectId, status, logText, cancelRequested = false) {
  try {
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
    await connectDB(process.env.MONGODB_URI, true);
    
    const updateFields = {
      'value.status': status,
      'value.lastDeployLog': logText,
      'value.lastDeployAt': new Date(),
      'value.cancelRequested': cancelRequested,
      'value.deployRunId': null
    };

    await SystemSetting.findOneAndUpdate(
      { key: dbKey },
      { $set: updateFields }
    );
    await broadcastDeploymentStatus(projectId);
  } catch (err) {
    console.error('Failed to update deploy status in DB:', err.message);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramNotification(config, status, extra = {}) {
  if (!config.telegramNotification || !config.telegramBotToken || !config.telegramChatId) {
    return;
  }

  let botToken;
  try {
    botToken = decrypt(config.telegramBotToken);
  } catch (e) {
    botToken = config.telegramBotToken; // fallback for unencrypted legacy tokens
  }
  
  let text = '';
  const projectName = config.name || config.id || 'Default Project';
  const target = config.targetType === 'ssh' ? 'Remote SSH' : 'Local Host';
  
  if (status === 'running') {
    text = `🚀 <b>Deployment Started</b>\n\n`;
  } else if (status === 'success') {
    text = `✅ <b>Deployment Succeeded</b>\n\n`;
  } else if (status === 'failed') {
    text = `❌ <b>Deployment Failed</b>\n\n`;
  } else {
    return;
  }

  text += `<b>Project:</b> ${projectName}\n`;
  text += `<b>Target:</b> ${target}\n`;

  if (extra.gitInfo) {
    const { branch, commitMsg, author, commitId } = extra.gitInfo;
    if (branch) text += `<b>Branch:</b> <code>${branch}</code>\n`;
    if (author) text += `<b>Pusher:</b> ${author}\n`;
    if (commitMsg) text += `<b>Commit:</b> <i>${escapeHtml(commitMsg.trim())}</i>\n`;
    if (commitId) text += `<b>Commit ID:</b> <code>${commitId.substring(0, 7)}</code>\n`;
  } else if (extra.triggerSource) {
    text += `<b>Source:</b> ${extra.triggerSource}\n`;
  }

  if (extra.duration !== undefined && extra.duration !== null) {
    text += `<b>Duration:</b> ${extra.duration}s\n`;
  }

  if ((status === 'success' || status === 'failed') && extra.logText) {
    const lines = extra.logText.split('\n').filter(line => line.trim().length > 0);
    const lastLines = lines.slice(-8).join('\n');
    if (lastLines) {
      text += `\n<b>Last Logs:</b>\n<pre>${escapeHtml(lastLines)}</pre>`;
    }
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Telegram] Error response: ${errText}`);
    }
  } catch (err) {
    console.error(`[Telegram] Failed to send notification:`, err.message);
  }
}

// Background deployment execution
export async function runDeployment(config, runMeta = {}) {
  const startedAt = new Date();
  const projectId = config.id || 'default';
  const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
  let lastNotifiedStatus = null;
  let isFinished = false;
  const commitSha = runMeta.commitSha || null;

  let logOutput = `[${startedAt.toISOString()}] 🚀 Deployment started in the background for project "${config.name || projectId}"...\n`;
  logOutput += `Target: ${config.targetType.toUpperCase()}\n`;
  if (config.targetType === 'ssh') {
    logOutput += `SSH Connection ID: ${config.connectionId}\n`;
  }
  if (commitSha) {
    logOutput += `📌 Deploying specific commit: ${commitSha}\n`;
  }
  if (runMeta.gitInfo) {
    const g = runMeta.gitInfo;
    if (g.branch)    logOutput += `Branch: ${g.branch}\n`;
    if (g.author)    logOutput += `Pusher: ${g.author}\n`;
    if (g.commitMsg) logOutput += `Commit: ${g.commitMsg.trim()}\n`;
    if (g.commitId)  logOutput += `Commit ID: ${g.commitId.substring(0, 7)}\n`;
  }
  logOutput += `--------------------------------------------------\n\n`;

  const runId = crypto.randomUUID();

  // Helper to update status in DB
  // Terminal statuses (success/failed) are retried up to 3 times with 2s backoff
  // to handle transient DB errors when the deployment command restarts the server.
  const updateStatus = async (status, finalLog, extra = {}) => {
    if (isFinished && status === 'running') return;
    if (status === 'success' || status === 'failed') {
      isFinished = true;
    }
    const cleanLog = limitLogOutput(finalLog);
    const isTerminal = status === 'success' || status === 'failed';
    const maxAttempts = isTerminal ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await connectDB(process.env.MONGODB_URI, true);
        const updateFields = {
          'value.status': status,
          'value.lastDeployLog': cleanLog,
          'value.lastDeployAt': startedAt,
          'value.cancelRequested': extra.cancelRequested === true ? true : false
        };

        if (status === 'running') {
          updateFields['value.deployRunId'] = runId;
        } else {
          updateFields['value.deployRunId'] = null;
        }

        await SystemSetting.findOneAndUpdate(
          { key: dbKey },
          { $set: updateFields }
        );
        // Broadcast update to all SSE clients
        await broadcastDeploymentStatus(projectId);

        // Send Telegram notification on state change
        if (status !== lastNotifiedStatus && (status === 'running' || status === 'success' || status === 'failed')) {
          lastNotifiedStatus = status;
          const duration = status !== 'running' ? Math.round((Date.now() - startedAt.getTime()) / 1000) : undefined;
          sendTelegramNotification(config, status, {
            gitInfo: runMeta.gitInfo || null,
            triggerSource: runMeta.triggerSource || null,
            duration,
            logText: status !== 'running' ? cleanLog : undefined
          }).catch(err => {
            console.error('[Telegram] error:', err.message);
          });
        }
        break; // success — exit retry loop
      } catch (dbErr) {
        console.error(`Failed to update deploy status in DB (attempt ${attempt}/${maxAttempts}):`, dbErr.message);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 2000 * attempt)); // 2s, 4s backoff
        }
      }
    }
  };

  // Throttle updates to DB/SSE to avoid spamming/freezing the process on rapid stdout
  let pendingUpdate = null;
  let lastUpdateTime = 0;

  const throttledUpdateStatus = async (status, finalLog, extra = {}) => {
    const cleanLog = limitLogOutput(finalLog);
    if (status !== 'running') {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      await updateStatus(status, cleanLog, extra);
      return;
    }

    const now = Date.now();
    if (now - lastUpdateTime > 1500) {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      lastUpdateTime = now;
      await updateStatus(status, cleanLog, extra);
    } else {
      if (!pendingUpdate) {
        pendingUpdate = setTimeout(async () => {
          pendingUpdate = null;
          lastUpdateTime = Date.now();
          await updateStatus('running', logOutput, extra);
        }, 1500);
      }
    }
  };

  // 1. Mark as running
  await updateStatus('running', logOutput);

  const resolvedPath = config.projectPath?.trim() || '.';


  if (config.targetType === 'local') {
    // === LOCAL HOST DEPLOYMENT ===
    const cwdPath = resolvedPath.startsWith('/') ? resolvedPath : `${process.cwd()}/${resolvedPath}`;
    const sessionName = `deploy_${projectId}`;
    const logFile = `/tmp/deploy_${projectId}.log`;
    const codeFile = `/tmp/deploy_${projectId}.code`;

    const scriptLines = [
      '#!/bin/bash',
      'echo "[deploy] Starting deployment at $(date)"',
      `if [ ! -d "${cwdPath}" ]; then echo "[deploy] ERROR: Directory '${cwdPath}' does not exist"; exit 1; fi`,
      `cd "${cwdPath}" || { echo "[deploy] ERROR: cannot cd to ${cwdPath}"; exit 1; }`,
      'echo "[deploy] Working directory: $(pwd)"',
      'set -e',
      'set -o pipefail',
    ];
    if (commitSha) {
      scriptLines.push(`echo "[deploy] Checking out commit: ${commitSha}"`);
      scriptLines.push(`git checkout ${commitSha}`);
    }
    scriptLines.push('echo "[deploy] Running deploy command..."');
    scriptLines.push(config.deployCommand);
    scriptLines.push('echo "[deploy] Deploy command finished successfully"');
    const script = scriptLines.join('\n');

    // Spawn bash reading script from stdin — avoids shell escaping issues
    // Using detached: true to run inside a separate process group for group termination
    const childProcess = spawn('bash', ['-s'], {
      cwd: cwdPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true
    });
    childProcess.stdin.write(script);
    childProcess.stdin.end();

    // Register running process so it can be cancelled
    try {
      setRunning(projectId, { type: 'local', proc: childProcess });
    } catch (e) {
      console.warn('[deploy] Failed to register running process:', e.message);
    }

    // Watchdog to avoid indefinitely hanging processes (default 10 minutes)
    const timeoutMs = (config.timeoutSeconds || 600) * 1000;
    const watchdog = setTimeout(() => {
      const now = new Date();
      logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000} seconds and will be terminated.\n`;
      logOutput = limitLogOutput(logOutput);
      updateStatus('failed', logOutput).catch(() => {});
      try {
        // Kill the whole process group
        process.kill(-childProcess.pid, 'SIGTERM');
      } catch (e) {
        try { childProcess.kill('SIGTERM'); } catch (err) {}
      }
    }, timeoutMs);

    childProcess.stdout.on('data', (data) => {
      logOutput += data.toString();
      if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
      throttledUpdateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.stderr.on('data', (data) => {
      logOutput += data.toString();
      if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
      throttledUpdateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.on('close', (code) => {
      clearTimeout(watchdog);
      const finishedAt = new Date();
      logOutput += `\n--------------------------------------------------\n`;
      logOutput += `[${finishedAt.toISOString()}] Process exited with code: ${code}\n`;
      logOutput = limitLogOutput(logOutput);
      const status = code === 0 ? 'success' : 'failed';
      try { clearRunning(projectId); } catch (e) {}
      updateStatus(status, logOutput).catch(() => {});
    });

    childProcess.on('error', (err) => {
      clearTimeout(watchdog);
      const finishedAt = new Date();
      logOutput += `\n--------------------------------------------------\n`;
      logOutput += `[${finishedAt.toISOString()}] ❌ Process execution error: ${err.message}\n`;
      logOutput = limitLogOutput(logOutput);
      try { clearRunning(projectId); } catch (e) {}
      updateStatus('failed', logOutput).catch(() => {});
    });

    
  } else if (config.targetType === 'ssh') {
    // === REMOTE SSH DEPLOYMENT ===
    try {
      const connectionId = String(config.connectionId || '').trim();
      if (!connectionId) {
        throw new Error('SSH target is configured but no connection ID was provided. Please select a valid SSH connection in deployment settings.');
      }

      let sshConnData = config.sshConnectionData;
      
      // If connection data wasn't cached, try to fetch it fresh from main database
      if (!sshConnData || !sshConnData.host) {
        console.log(`[deploy] SSH connection data not cached, attempting fresh lookup for ID: ${connectionId}`);
        try {
          const db = await connectDB(process.env.MONGODB_URI, true);
          const repo = new ConnectionRepository(db);
          await repo.init();
          const connection = await repo.findById(connectionId);
          if (connection) {
            sshConnData = {
              host: connection.host,
              port: connection.port || 22,
              username: connection.username || 'root',
              authType: connection.authType,
              password: connection.password || '',
              privateKey: connection.privateKey || '',
              passphrase: connection.passphrase || ''
            };
            console.log(`[deploy] Successfully fetched SSH connection from main database`);
          } else {
            throw new Error('Connection not found in main database');
          }
        } catch (lookupErr) {
          throw new Error(`Failed to fetch SSH connection ${connectionId}: ${lookupErr.message}`);
        }
      }

      if (!sshConnData || !sshConnData.host) {
        throw new Error(`SSH connection data incomplete or missing for ID ${connectionId}`);
      }

      // Build SSH connection config from stored data
      const sshConfig = {
        host: sshConnData.host,
        port: sshConnData.port || 22,
        username: sshConnData.username || 'root',
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 6,
      };

      if (sshConnData.authType === 'password') {
        if (typeof sshConnData.password === 'string' && sshConnData.password.length > 0) {
          let decrypted = decrypt(sshConnData.password);
          // Handle legacy double-encrypted configs: if result still looks encrypted, decrypt again
          if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
            const test = decrypt(decrypted);
            if (test && !test.includes(':')) decrypted = test;
          }
          sshConfig.password = decrypted;
        }
      } else if (sshConnData.authType === 'privateKey') {
        if (typeof sshConnData.privateKey === 'string' && sshConnData.privateKey.length > 0) {
          let decrypted = decrypt(sshConnData.privateKey);
          if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
            const test = decrypt(decrypted);
            if (test && !test.includes(':')) decrypted = test;
          }
          sshConfig.privateKey = decrypted;
        }
        if (sshConnData.passphrase) {
          if (typeof sshConnData.passphrase === 'string' && sshConnData.passphrase.length > 0) {
            let decrypted = decrypt(sshConnData.passphrase);
            if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
              const test = decrypt(decrypted);
              if (test && !test.includes(':')) decrypted = test;
            }
            sshConfig.passphrase = decrypted;
          }
        }
      }

      // Check if target requires routing through the Local Relay Agent
      const isLocalhostSsh = /^(localhost|127\.0\.0\.1)$/.test(sshConfig.host);
      if (isLocalhostSsh) {
        logOutput += `[Relay] SSH target "${sshConfig.host}" detected as localhost. Auto-detecting Local Relay Agent...\n`;
        await updateStatus('running', logOutput);

        let relay = null;
        const startTime = Date.now();
        const timeoutMs = 30000; // Wait up to 30 seconds

        while (Date.now() - startTime < timeoutMs) {
          const activeRelays = global.__activeRelays;
          if (activeRelays && activeRelays.size > 0) {
            const userRelays = activeRelays.values().next().value;
            if (userRelays instanceof Map && userRelays.size > 0) {
              relay = userRelays.values().next().value;
            } else if (userRelays && !(userRelays instanceof Map)) {
              relay = userRelays;
            }
            break;
          }
          logOutput += `[Relay] Local Relay Agent not active. Retrying detection in 2 seconds...\n`;
          await updateStatus('running', logOutput);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!relay) {
          throw new Error('Local Relay Agent is not connected. Please start local-relay.js on your target machine to enable deployment to localhost.');
        }

        logOutput += `[Relay] Active Local Relay Agent found on local port ${relay.localPort}. Routing SSH traffic: ${sshConfig.host}:${sshConfig.port} -> 127.0.0.1:${relay.localPort}\n`;
        await updateStatus('running', logOutput);

        // Rewrite the target to point to the relay's local TCP proxy port
        relay.targetHost = sshConfig.host;
        relay.targetPort = sshConfig.port;
        sshConfig.host = '127.0.0.1';
        sshConfig.port = relay.localPort;
      }

      logOutput += `[SSH] Connecting to ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}...\n`;
      await updateStatus('running', logOutput);

      const conn = new Client();
      // Register SSH connection so it can be cancelled
      try {
        setRunning(projectId, { type: 'ssh', conn });
      } catch (e) {
        console.warn('[deploy] Failed to register SSH connection:', e.message);
      }
      
      // ── SSH connection lost (server restart / network drop) ───────────────
      // This fires when the TCP connection closes without a clean stream.close().
      // Typical cause: the deploy command restarts the server itself (docker-compose up).
      conn.on('close', () => {
        if (!isFinished) {
          try { clearRunning(projectId); } catch (e) {}
          logOutput += `\n[SSH] Connection closed by remote host — server may have restarted.\n`;
          logOutput += `⚠️ If your deploy command restarts the server, the deployment likely succeeded.\n`;
          logOutput += `   Please verify the server is running correctly.\n`;
          updateStatus('failed', logOutput).catch(() => {});
        }
      });

      conn.on('ready', () => {
        logOutput += `[SSH] Connected successfully. Preparing deployment scripts...\n`;
        updateStatus('running', logOutput);

        conn.sftp((err, sftp) => {
          if (err) {
            logOutput += `[SSH Error] SFTP initialization failed: ${err.message}\n`;
            try { clearRunning(projectId); } catch (e) {}
            updateStatus('failed', logOutput);
            conn.end();
            return;
          }

          const remoteDeployPath = `/tmp/deploy_run_${projectId}.sh`;

          // ── The actual deploy script ──────────────────────────
          const scriptLines = [
            '#!/bin/bash',
            'echo "[deploy] Starting deployment on $(hostname) at $(date)"',
            'echo "[deploy] Working directory: ' + resolvedPath + '"',
            `if [ ! -d "${resolvedPath}" ]; then echo "[deploy] ERROR: Directory '${resolvedPath}' does not exist"; exit 1; fi`,
            `cd "${resolvedPath}" || { echo "[deploy] ERROR: Cannot cd to ${resolvedPath}"; exit 1; }`,
            'echo "[deploy] Now in: $(pwd)"',
            'set -e',
            'set -o pipefail',
          ];
          if (commitSha) {
            scriptLines.push(`echo "[deploy] Checking out commit: ${commitSha}"`);
            scriptLines.push(`git checkout ${commitSha}`);
          }
          scriptLines.push('echo "[deploy] Running deploy command..."');
          scriptLines.push(config.deployCommand);
          scriptLines.push('echo "[deploy] Deploy command finished successfully"');
          const deployScript = scriptLines.join('\n') + '\n';

          // ── Write deploy script via SFTP ─────────────────────────────────
            const tmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);
            const tmuxWrapperPath = `/tmp/deploy_tmux_${projectId}.sh`;

            sftp.writeFile(remoteDeployPath, deployScript, (writeErr) => {
            if (writeErr) {
              logOutput += `[SSH Error] Failed to write deploy script: ${writeErr.message}\n`;
              logOutput = limitLogOutput(logOutput);
              try { clearRunning(projectId); } catch (e) {}
              updateStatus('failed', logOutput).catch(() => {});
              conn.end();
              return;
            }

            logOutput += `[SSH] Script uploaded. Launching deployment...\n\n`;
            logOutput = limitLogOutput(logOutput);
            updateStatus('running', logOutput);

            // tmux wrapper: runs the deploy script, captures exit code, cleans up
            const tmuxWrapper = [
              '#!/bin/bash',
              `bash "${remoteDeployPath}"`,
              'CODE=$?',
              `rm -f "${remoteDeployPath}"`,
              'echo ""',
              'echo "---DEPLOY_EXIT:$CODE---"',
              'exit $CODE',
            ].join('\n');

            // Write tmux wrapper, then exec. If wrapper write fails, just exec directly.
            const launchDeploy = () => {
              const logFile = `/tmp/deploy_${tmuxSession}.log`;
              const command = [
                `set +e`,
                `command -v tmux >/dev/null 2>&1 && HAS_TMUX=0 || HAS_TMUX=1`,
                `if [ "$HAS_TMUX" = "0" ]; then`,
                `  rm -f "${logFile}"`,
                `  touch "${logFile}"`,
                `  tmux kill-session -t ${tmuxSession} 2>/dev/null || true`,
                `  tmux new-session -d -s ${tmuxSession} -x 220 -y 50`,
                `  tmux send-keys -t ${tmuxSession} "bash ${tmuxWrapperPath} 2>&1; tmux set-option -t ${tmuxSession} remain-on-exit off; exit" Enter`,
                `  tmux pipe-pane -t ${tmuxSession} "cat >> ${logFile}"`,
                `  echo "[deploy] Running in tmux session: ${tmuxSession}  (attach: tmux attach -t ${tmuxSession})"`,
                `  tail -n +1 -f "${logFile}" & TAIL_PID=$!`,
                `  while tmux has-session -t ${tmuxSession} 2>/dev/null; do sleep 0.5; done`,
                `  kill $TAIL_PID 2>/dev/null || true; wait $TAIL_PID 2>/dev/null || true`,
                `  rm -f "${logFile}" "${tmuxWrapperPath}"`,
                `else`,
                `  echo "[deploy] tmux not installed \u2014 running directly"`,
                `  bash "${remoteDeployPath}"; CODE=$?; rm -f "${remoteDeployPath}"; echo ""; echo "---DEPLOY_EXIT:$CODE---"`,
                `fi`,
              ].join('\n');

              conn.exec(command, (execErr, stream) => {
                if (execErr) {
                  logOutput += `[SSH Error] Execution failed: ${execErr.message}\n`;
                  logOutput = limitLogOutput(logOutput);
                  try { clearRunning(projectId); } catch (e) {}
                  updateStatus('failed', logOutput);
                  conn.end();
                  return;
                }

                // Watchdog timeout
                const timeoutMs = (config.timeoutSeconds || 600) * 1000;
                const watchdog = setTimeout(() => {
                  logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000}s. Terminating...\n`;
                  logOutput = limitLogOutput(logOutput);
                  updateStatus('failed', logOutput).catch(() => {});
                  // Kill tmux session + cleanup
                  try { conn.exec(`tmux kill-session -t ${tmuxSession} 2>/dev/null; rm -f /tmp/deploy_${tmuxSession}.log /tmp/deploy_tmux_${projectId}.sh; true`, () => {}); } catch {}
                  stream.destroy();
                  conn.end();
                  try { clearRunning(projectId); } catch (e) {}
                }, timeoutMs);

                let exitCodeDetected = null;
                let stdoutBuf = '';

                stream.on('data', (data) => {
                  stdoutBuf += data.toString();

                  // Split on newlines; keep last incomplete line in buffer
                  const lines = stdoutBuf.split('\n');
                  stdoutBuf = lines.pop();

                  for (const line of lines) {
                    const m = line.match(/^---DEPLOY_EXIT:(\d+)---$/);
                    if (m) {
                      exitCodeDetected = parseInt(m[1], 10);
                    } else {
                      logOutput += line + '\n';
                    }
                  }

                  if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
                  throttledUpdateStatus('running', logOutput).catch(() => {});
                });

                stream.stderr.on('data', (data) => {
                  logOutput += data.toString();
                  if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
                  throttledUpdateStatus('running', logOutput).catch(() => {});
                });

                stream.on('close', (code) => {
                  clearTimeout(watchdog);

                  // Flush remaining buffer
                  if (stdoutBuf) {
                    const m = stdoutBuf.match(/^---DEPLOY_EXIT:(\d+)---$/);
                    if (m) {
                      exitCodeDetected = parseInt(m[1], 10);
                    } else if (stdoutBuf.trim()) {
                      logOutput += stdoutBuf;
                    }
                  }

                  const finalCode = exitCodeDetected !== null ? exitCodeDetected : (code || 0);
                  const finishedAt = new Date();
                  logOutput += `\n--------------------------------------------------\n`;
                  logOutput += `[${finishedAt.toISOString()}] [SSH] Execution finished. Exit code: ${finalCode}\n`;
                  logOutput = limitLogOutput(logOutput);
                  const status = finalCode === 0 ? 'success' : 'failed';

                  try { clearRunning(projectId); } catch (e) {}
                   updateStatus(status, logOutput).catch(() => {});
                  conn.end();
                });
              });
            }; // end launchDeploy

            // Write tmux wrapper script, then launch. If write fails, launch anyway (tmux check handles fallback).
            sftp.writeFile(tmuxWrapperPath, tmuxWrapper, { mode: 0o755 }, (tmuxWriteErr) => {
              if (tmuxWriteErr) logOutput += `[deploy] tmux wrapper write failed: ${tmuxWriteErr.message}\n`;
              launchDeploy();
            });
          });
        });
      });

      conn.on('error', (err) => {
        logOutput += `\n[SSH Error] Connection error: ${err.message}\n`;
        try { clearRunning(projectId); } catch (e) {}
        updateStatus('failed', logOutput);
      });

      conn.connect(sshConfig);

    } catch (err) {
      logOutput += `\n❌ Deployment initialization failed: ${err.message}\n`;
      await updateStatus('failed', logOutput);
    }
  } else {
    logOutput += `\n❌ Unsupported deployment target: ${config.targetType}\n`;
    await updateStatus('failed', logOutput);
  }
}

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    console.log(`[webhook] Received POST request for project: ${projectId}`);

    // 1. Check for manual trigger (requires dashboard session)
    const session = await getServerSession(authOptions);
    const isManual = !!session;

    // 2. Fetch the deployment config
    await connectDB(process.env.MONGODB_URI, true);
    const setting = await SystemSetting.findOne({ key: dbKey });
    const config = setting?.value;

    console.log(`[webhook] Config found:`, config ? {
      enabled: config.enabled,
      branch: config.branch,
      targetType: config.targetType,
      hasDeployCommand: !!config.deployCommand?.trim(),
    } : 'NO CONFIG');

    if (!config || (!config.enabled && !isManual)) {
      console.log(`[webhook] Deployment skipped - config missing or disabled`);
      return NextResponse.json({ success: false, error: `Auto-deployment for project "${projectId}" is disabled or not configured` }, { status: 400 });
    }

    if (!config.deployCommand?.trim()) {
      console.log(`[webhook] ❌ No deployment command set!`);
      return NextResponse.json({ success: false, error: 'Deployment command is not configured' }, { status: 400 });
    }

    if (config.targetType === 'ssh') {
      const connectionId = String(config.connectionId || '').trim();
      if (!connectionId) {
        console.log(`[webhook] ❌ SSH target configured but no connection selected`);
        return NextResponse.json({ success: false, error: 'SSH deployment is configured but no SSH connection is selected. Please update deployment settings.' }, { status: 400 });
      }

      const hasCachedConnection = config.sshConnectionData && config.sshConnectionData.host;
      if (!hasCachedConnection) {
        console.log(`[webhook] SSH connection data not cached in project config, verifying in DB...`);
        const db = await connectDB(isManual ? null : process.env.MONGODB_URI, !isManual);
        const repo = new ConnectionRepository(db);
        await repo.init();
        const connection = await repo.findById(connectionId);
        if (!connection) {
          console.log(`[webhook] ❌ SSH connection ID ${connectionId} not found`);
          return NextResponse.json({ success: false, error: `SSH connection with ID ${connectionId} configured for project "${projectId}" does not exist. Please select a valid SSH connection.` }, { status: 400 });
        }
      }
    }

    // Prevent concurrent deployments for the same project.
    // If status is running but there is no active in-memory process, reset the stale state.
    // Also treat as stale if the deployment has been running longer than its configured timeout
    // (handles cases where the server restarted mid-deployment and the SIGTERM handler couldn't write).
    if (config.status === 'running') {
      const activeProcess = getRunning(projectId);
      const timeoutMs = ((config.timeoutSeconds || 600) + 120) * 1000; // timeout + 2 min buffer
      const deployedAt = config.lastDeployAt ? new Date(config.lastDeployAt).getTime() : 0;
      const isStaleByTime = deployedAt > 0 && (Date.now() - deployedAt) > timeoutMs;

      if (!activeProcess || isStaleByTime) {
        if (isStaleByTime) {
          console.log(`[webhook] Deployment for "${projectId}" has been running for >${timeoutMs/1000}s — treating as stale and resetting.`);
        } else {
          console.log(`[webhook] Stale running state detected for project: ${projectId}. Resetting status and allowing new deployment.`);
        }
        await SystemSetting.findOneAndUpdate(
          { key: dbKey },
          {
            $set: {
              'value.status': 'idle',
              'value.deployRunId': null,
              'value.cancelRequested': false
            }
          }
        );
      } else {
        console.log(`[webhook] Deployment already running for project: ${projectId} - rejecting new trigger`);
        return NextResponse.json({ success: false, error: 'A deployment is already running for this project' }, { status: 409 });
      }
    }

    const bodyText = await request.text();

    // 3. Signature verification for webhook calls (when not a manual trigger)
    if (!isManual) {
      const githubEvent = request.headers.get('x-github-event');
      const bitbucketEvent = request.headers.get('x-event-key');

      // Detect provider
      const isGitHub = !!githubEvent;
      const isBitbucket = !!bitbucketEvent;

      // Handle ping events
      if (githubEvent === 'ping') {
        console.log(`[webhook] Received GitHub ping`);
        return NextResponse.json({ success: true, message: 'GitHub Ping received successfully' });
      }
      if (bitbucketEvent === 'diagnostics:ping') {
        console.log(`[webhook] Received Bitbucket ping`);
        return NextResponse.json({ success: true, message: 'Bitbucket Ping received successfully' });
      }

      // For push events, verify signature and check branch
      const isPushEvent = (isGitHub && githubEvent === 'push') || (isBitbucket && bitbucketEvent === 'repo:push');

      if (isPushEvent) {
        if (config.secret) {
          // GitHub uses x-hub-signature-256, Bitbucket uses x-hub-signature
          const signatureHeader = request.headers.get('x-hub-signature-256') || request.headers.get('x-hub-signature');
          if (!signatureHeader || !verifySignature(bodyText, config.secret, signatureHeader)) {
            console.log(`[webhook] Signature verification failed`);
            await updateDeployStatus(
              projectId,
              'failed',
              `[Webhook Error] Signature verification failed. Please check that the Secret configured on ${isGitHub ? 'GitHub' : 'Bitbucket'} matches the Secret in the Auto Deploy settings.`
            );
            return NextResponse.json({ success: false, error: 'Invalid signature verification' }, { status: 401 });
          }
        }

        // Check push branch matches config
        try {
          const payload = JSON.parse(bodyText);
          let pushRef = null;

          if (isGitHub && payload.ref) {
            pushRef = payload.ref;
          } else if (isBitbucket && payload.push?.changes?.[0]?.new?.name) {
            pushRef = `refs/heads/${payload.push.changes[0].new.name}`;
          }

          if (pushRef) {
            const rawBranch = String(config.branch || '').trim();
            const expectedRef = rawBranch
              ? (rawBranch.startsWith('refs/heads/') ? rawBranch : `refs/heads/${rawBranch}`)
              : null;
            console.log(`[webhook] Push ref: ${pushRef}${expectedRef ? `, expected: ${expectedRef}` : ', no branch filter configured'}`);
            if (expectedRef && pushRef !== expectedRef) {
              console.log(`[webhook] Branch mismatch - skipping deployment`);
              await updateDeployStatus(
                projectId,
                'idle',
                `[Webhook Skipped] Received ${isGitHub ? 'GitHub' : 'Bitbucket'} push event for ref "${pushRef}" but watched branch is configured as "${rawBranch}". Skipping deployment.`
              );
              return NextResponse.json({
                success: true,
                message: `Ref ${pushRef} does not match watched branch ${expectedRef}. Skipping deployment.`
              });
            }
          }
        } catch (e) {
          console.log(`[webhook] Warning: Could not parse payload:`, e.message);
          await updateDeployStatus(
            projectId,
            'failed',
            `[Webhook Error] Failed to parse payload from ${isGitHub ? 'GitHub' : 'Bitbucket'} request: ${e.message}`
          );
        }
      }
    }

    // 4. Trigger the deployment in the background
    // Rate limit check
    const rateCheck = checkTriggerRateLimit(projectId);
    if (!rateCheck.allowed) {
      console.log(`[webhook] Rate limit exceeded for project: ${projectId}`);
      return NextResponse.json({ success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` }, { status: 429 });
    }

    // Acquire per-project start lock to prevent race conditions
    if (!tryAcquireStartLock(projectId)) {
      console.log(`[webhook] Deployment start already in progress for project: ${projectId}`);
      return NextResponse.json({ success: false, error: 'A deployment is already starting for this project' }, { status: 409 });
    }

    console.log(`[webhook] ✅ Triggering deployment for project: ${projectId}`);

    // Parse push payload for rich Telegram notifications (supports GitHub and Bitbucket)
    let gitInfo = null;
    if (!isManual && bodyText) {
      try {
        const payload = JSON.parse(bodyText);

        // GitHub push payload
        if (payload.ref && payload.pusher) {
          const latestCommit = payload.commits?.[0];
          gitInfo = {
            branch: String(payload.ref || '').replace('refs/heads/', '') || null,
            commitMsg: latestCommit?.message || null,
            commitId: latestCommit?.id || null,
            author: payload.pusher?.name || latestCommit?.author?.name || null,
          };
        }
        // Bitbucket push payload
        else if (payload.push?.changes?.[0]) {
          const change = payload.push.changes[0];
          const newRef = change.new || {};
          const target = newRef.target || {};
          gitInfo = {
            branch: newRef.name || null,
            commitMsg: target.message || null,
            commitId: target.hash || null,
            author: payload.actor?.display_name || target.author?.raw || null,
          };
        }
      } catch (e) { /* ignore parse errors */ }
    }

    const triggerSource = isManual ? 'Manual (Dashboard)' : (bodyText?.includes?.('"actor"') ? 'Bitbucket Webhook' : 'GitHub Webhook');

    // Extract commitSha from manual trigger body
    let commitSha = null;
    if (isManual && bodyText) {
      try {
        const body = JSON.parse(bodyText);
        if (body.commitSha) commitSha = body.commitSha;
      } catch (e) {}
    }

    runDeployment(config, {
      gitInfo,
      triggerSource,
      commitSha
    }).catch(err => {
      console.error('Unhandled background deployment error:', err.message);
    }).finally(() => {
      releaseStartLock(projectId);
    });

    return NextResponse.json({
      success: true,
      message: isManual ? 'Manual deployment triggered successfully' : 'Auto deployment triggered by Webhook'
    });

  } catch (error) {
    console.error('[deploy/webhook] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
