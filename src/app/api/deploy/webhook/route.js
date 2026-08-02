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

// Extract meaningful error lines from deploy log.
// Returns an array of cleaned error strings (no duplicates, no noise).
function extractErrorsFromLog(logText) {
  if (!logText) return [];

  const lines = logText.split('\n');

  // Patterns that indicate an actual error line
  const errorLinePattern = /\b(error|fatal|exception|crash|panic|segfault|killed|denied|cannot|unable to|refused|timed? ?out|broken|ENOENT|EACCES|EPERM|not found|no such file|undefined is not|cannot read|failed to|command not found|permission denied|syntax error|unexpected token|module not found|cannot find module|type error|reference error|range error)\b/i;

  // Patterns to SKIP — these are noise or generic status lines
  const skipPattern = /^(---DEPLOY_EXIT_CODE:|--->\s*Running|Deploying\.\.\.|warn\s*[:\-]|warning\s*[:\-]|info\s*[:\-]|\[SSE\]|npm warn|npm notice|yarn warning|deprecated|peer dep|info Visit|Done in \d|✨\s*Done)/i;

  // Patterns for compiler-style messages: "file:line:col: error: message"
  const compilerPattern = /(.+?):(\d+):(\d+):\s*(error|fatal error|E\d+):\s*(.+)/i;

  // Patterns for common build tool errors
  const buildErrorPatterns = [
    // gcc/clang: "file:line: error: message"
    /^(.+?):(\d+):\d*:\s*(?:fatal )?error:\s*(.+)/i,
    // Node/JS: "SyntaxError: message", "TypeError: message", etc.
    /^((?:Syntax|Type|Reference|Range|URI|Eval|Internal)?Error):?\s*(.+)/i,
    // Go: "file:line:col: error message" or "./path: line: message"
    /^(\.\/.+?):(\d+):\s*(.+)/i,
    // Python: "File \"path\", line N, in module" + following "XError: message"
    /^(?:Traceback|File\s+".+",\s+line\s+\d+)/i,
    // Generic "Error: ..." at start of line
    /^(?:Error|FATAL|FAILURE|FAILED)[\s:]+(.+)/i,
    // "make: *** [target] Error N"
    /^make:\s*\*\*\*/i,
    // Docker build errors
    /^(?:ERROR|executor failed|process.*did not complete)/i,
    // "declare" style errors (unused variables, etc.)
    /\b(unused|undeclared|undefined|redeclared|multiple definition|duplicate symbol|conflicting types|implicit declaration)\b/i,
    // Exit code lines
    /exit code[:\s]*[1-9]/i,
    // Process failures
    /\bprocess exited with code\s+[1-9]/i,
  ];

  const errors = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (skipPattern.test(line)) continue;

    // Check compiler-style messages first (most specific)
    const compilerMatch = line.match(compilerPattern);
    if (compilerMatch) {
      const file = compilerMatch[1].replace(/^.*\//, ''); // basename
      const lineNum = compilerMatch[2];
      const msg = compilerMatch[5].trim();
      errors.add(`${file}:${lineNum}: ${msg}`);
      continue;
    }

    // Check build-tool specific patterns
    let matched = false;
    for (const pat of buildErrorPatterns) {
      const m = line.match(pat);
      if (m) {
        // Use the captured group or the full line, cleaned up
        const cleaned = (m[m.length - 1] || line).trim();
        if (cleaned.length > 5 && cleaned.length < 300) {
          errors.add(cleaned);
        } else {
          errors.add(line.slice(0, 300));
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Generic error line
    if (errorLinePattern.test(line)) {
      // Skip if it's just a summary/status line
      if (line.length > 300) {
        // Too long — try to extract just the error part
        const errMatch = line.match(/(?:error|fatal|failed)[\s:]+(.{10,200})/i);
        if (errMatch) {
          errors.add(errMatch[1].trim());
        }
      } else {
        errors.add(line);
      }
    }
  }

  // If we found nothing, fall back to last non-empty lines
  if (errors.size === 0) {
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    const last3 = nonEmpty.slice(-3);
    for (const l of last3) {
      errors.add(l.trim().slice(0, 200));
    }
  }

  return [...errors].slice(0, 15); // Cap at 15 errors
}

export async function sendTelegramNotification(config, status, extra = {}) {
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

  if (status === 'failed' && extra.logText) {
    const errors = extractErrorsFromLog(extra.logText);
    if (errors.length > 0) {
      text += `\n<b>Errors:</b>\n`;
      for (const err of errors) {
        text += `• <code>${escapeHtml(err)}</code>\n`;
      }
    }
  } else if (status === 'success' && extra.logText) {
    const lines = extra.logText.split('\n').filter(line => line.trim().length > 0);
    const lastLines = lines.slice(-3).join('\n');
    if (lastLines) {
      text += `\n<b>Log:</b>\n<pre>${escapeHtml(lastLines)}</pre>`;
    }
  }

  const chatIds = String(config.telegramChatId || '')
    .split(/[\s,]+/)
    .map(id => id.trim())
    .filter(Boolean);

  if (chatIds.length === 0) return;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  await Promise.allSettled(
    chatIds.map(async (cid) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: cid,
            text: text,
            parse_mode: 'HTML'
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Telegram] Error sending to chat ${cid}: ${errText}`);
        }
      } catch (err) {
        console.error(`[Telegram] Failed to send notification to chat ${cid}:`, err.message);
      }
    })
  );
}

// Reconnect to a remote server after SSH drops and monitor a tmux session to completion.
// This handles the case where the deploy command restarts Docker/the server,
// killing the original SSH connection — but the tmux session survives on the remote host.
function monitorTmuxAfterReconnect(sshConfig, tmuxSession, projectId, logOutput, updateStatus, startedAt) {
  const maxRetries = 30;
  const retryInterval = 5000; // 5s between retries
  let attempt = 0;

  const tryReconnect = () => {
    attempt++;
    if (attempt > maxRetries) {
      logOutput += `\n[SSH] Gave up reconnecting after ${maxRetries} attempts (${maxRetries * retryInterval / 1000}s).\n`;
      logOutput += `⚠️ tmux session "${tmuxSession}" may still be running on the remote server.\n`;
      logOutput += `   Check manually: ssh ${sshConfig.username}@${sshConfig.host} -p ${sshConfig.port} "tmux attach -t ${tmuxSession}"\n`;
      updateStatus('failed', logOutput).catch(() => {});
      return;
    }

    logOutput += `[SSH] Reconnect attempt ${attempt}/${maxRetries}...\n`;
    updateStatus('running', logOutput).catch(() => {});

    const reconnectConn = new Client();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { reconnectConn.end(); } catch {}
        setTimeout(tryReconnect, retryInterval);
      }
    }, 10000);

    reconnectConn.on('ready', () => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      logOutput += `[SSH] Reconnected! Monitoring tmux session "${tmuxSession}"...\n`;
      updateStatus('running', logOutput).catch(() => {});

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

      reconnectConn.exec(monitorCmd, (execErr, stream) => {
        if (execErr) {
          logOutput += `[SSH-monitor] Failed to exec monitor: ${execErr.message}\n`;
          updateStatus('failed', logOutput).catch(() => {});
          reconnectConn.end();
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
            // Capture exit code from status file embedded in monitor output
            const exitMatch = line.match(/---DEPLOY_EXIT_CODE:(\d+)---/);
            if (exitMatch) {
              monitorExitCode = parseInt(exitMatch[1], 10);
            }
            if (line.includes('---DEPLOY_MONITOR_DONE---')) {
              const exitCode = monitorExitCode;
              const finishedAt = new Date();
              logOutput += `\n--------------------------------------------------\n`;
              logOutput += `[${finishedAt.toISOString()}] [SSH-monitor] tmux session completed. Exit code: ${exitCode}\n`;
              const status = exitCode === 0 ? 'success' : 'failed';
              updateStatus(status, logOutput).catch(() => {});
              // Cleanup
              reconnectConn.exec(`rm -f /tmp/deploy_${tmuxSession}.log /tmp/deploy_${tmuxSession}.status /tmp/deploy_tmux_${projectId}.sh; true`, () => {});
              reconnectConn.end();
              return;
            }
            logOutput += rawLine + '\n';
          }
          if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
          updateStatus('running', logOutput).catch(() => {});
        });

        stream.stderr.on('data', (data) => {
          logOutput += data.toString();
          if (logOutput.length > 200000) logOutput = limitLogOutput(logOutput);
          updateStatus('running', logOutput).catch(() => {});
        });

        stream.on('close', () => {
          // Flush remaining buffer
          if (monitorBuf && monitorBuf.trim()) {
            logOutput += monitorBuf;
          }
        });
      });
    });

    reconnectConn.on('error', () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        setTimeout(tryReconnect, retryInterval);
      }
    });

    reconnectConn.connect(sshConfig);
  };

  // First attempt after a short delay to let the server come back up
  setTimeout(tryReconnect, 10000);
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

        if (status === 'success' && commitSha) {
          updateFields['value.lastDeployedCommitSha'] = commitSha;
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
          try {
            await sendTelegramNotification(config, status, {
              gitInfo: runMeta.gitInfo || null,
              triggerSource: runMeta.triggerSource || null,
              duration,
              logText: status !== 'running' ? cleanLog : undefined
            });
          } catch (err) {
            console.error('[Telegram] error:', err.message);
          }
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
      // ── Self-healing: stash local changes before pull to prevent collision ──
      'STASH_MADE=0',
      'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
      '  DIRTY=$(git status --porcelain 2>/dev/null)',
      '  if [ -n "$DIRTY" ]; then',
      '    echo "[deploy] ⚠️  Local changes detected — stashing before pull to prevent collision..."',
      '    git stash push -u -m "autodeploy-self-heal-$(date +%s)" && STASH_MADE=1 || true',
      '    if [ "$STASH_MADE" = "1" ]; then',
      '      echo "[deploy] ✅ Stashed local changes. Will clean up after deploy."',
      '    else',
      '      echo "[deploy] ⚠️  Could not stash local changes — attempting deploy anyway."',
      '    fi',
      '  fi',
      'fi',
    ];
    // Temporarily write Bitbucket/GitHub credentials depending on provider
    if (config.bitbucketConnected && (config.bitbucketUser || config.bitbucketUsername) && config.bitbucketAppPassword) {
      try {
        let bbUser = config.bitbucketUser || decrypt(config.bitbucketUsername);
        let bbPass = decrypt(config.bitbucketAppPassword);
        if (bbUser && bbUser.includes('@')) {
          bbUser = bbUser.split('@')[0];
        }
        if (bbUser && bbPass) {
          const encodedUser = encodeURIComponent(bbUser);
          const encodedPass = encodeURIComponent(bbPass);
          scriptLines.push(`echo "https://${encodedUser}:${encodedPass}@bitbucket.org" > ~/.git-credentials`);
          scriptLines.push(`git config --global credential.helper store`);
        }
      } catch (e) {}
    } else if (config.githubToken) {
      try {
        let ghToken = decrypt(config.githubToken);
        if (ghToken) {
          const b64Cred = Buffer.from(`x-access-token:${ghToken}`).toString('base64');
          scriptLines.push(`git config http.extraHeader "Authorization: Basic ${b64Cred}"`);
        }
      } catch (e) {}
    }

    if (commitSha) {
      scriptLines.push(`echo "[deploy] Checking out commit: ${commitSha}"`);
      scriptLines.push(`git checkout ${commitSha}`);
    }
    scriptLines.push('echo "[deploy] Running deploy command..."');
    
    let cleanLocalDeployCmd = (config.deployCommand || '').trim();
    cleanLocalDeployCmd = cleanLocalDeployCmd.replace(/\|\|\s*\(\s*docker service inspect[^)]+\)/g, '');
    cleanLocalDeployCmd = cleanLocalDeployCmd.split('\n').map((line, idx) => {
      if (idx > 0 && (line.trim() === '#!/bin/bash' || line.trim() === 'set -e')) {
        return '# ' + line;
      }
      return line;
    }).join('\n');
    cleanLocalDeployCmd = cleanLocalDeployCmd.replace(/docker service create --name \$SVC \$PORT_FLAGS --detach=true --no-resolve-image --replicas 2 \$IMAGE_NAME/g, 'docker service create --name $SVC $PORT_FLAGS --detach=true --no-resolve-image --replicas 2 "${SVC}:latest"');
    cleanLocalDeployCmd = cleanLocalDeployCmd.replace(/\|\| docker compose up -d --build/g, '2>/dev/null || true');

    scriptLines.push(cleanLocalDeployCmd);

    // Clean up credentials after deploy command completes
    if (config.bitbucketConnected) {
      scriptLines.push(`cd "${cwdPath}" || true`);
      scriptLines.push('rm -f ~/.git-credentials');
      scriptLines.push('git config --global --unset credential.helper || true');
    } else if (config.githubToken) {
      scriptLines.push(`cd "${cwdPath}" || true`);
      scriptLines.push('git config --unset http.extraHeader || true');
    }
    // ── Self-healing: drop stash after deploy (stash was only a collision fix) ──
    scriptLines.push('if [ "$STASH_MADE" = "1" ]; then');
    scriptLines.push('  echo "[deploy] 🧹 Dropping auto-stash (local changes were saved as a temporary fix)..."');
    scriptLines.push('  git stash drop 2>/dev/null || true');
    scriptLines.push('  echo "[deploy] ✅ Stash dropped. Local changes discarded (they were only stashed to unblock the pull)."');
    scriptLines.push('fi');
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
    const watchdog = setTimeout(async () => {
      const now = new Date();
      logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000} seconds and will be terminated.\n`;
      logOutput = limitLogOutput(logOutput);
      try {
        await updateStatus('failed', logOutput);
      } catch (e) {
        console.error('[deploy] Failed to update status on timeout:', e.message);
      }
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
      let tmuxSession = null;
      // Register SSH connection so it can be cancelled
      try {
        setRunning(projectId, { type: 'ssh', conn });
      } catch (e) {
        console.warn('[deploy] Failed to register SSH connection:', e.message);
      }

      // ── SSH connection lost (server restart / network drop) ───────────────
      // This fires when the TCP connection closes without a clean stream.close().
      // Typical cause: the deploy command restarts the server itself (docker-compose up).
      // If tmux was used, the session is still alive on the remote server —
      // spawn a background reconnection to monitor it to completion.
      conn.on('close', () => {
        if (!isFinished) {
          try { clearRunning(projectId); } catch (e) {}
          logOutput += `\n[SSH] Connection closed by remote host — server may have restarted.\n`;

          if (tmuxSession) {
            logOutput += `[SSH] tmux session "${tmuxSession}" is still running on the remote server.\n`;
            logOutput += `[SSH] Attempting to reconnect and monitor deployment...\n`;
            throttledUpdateStatus('running', logOutput).catch(() => {});
            monitorTmuxAfterReconnect(sshConfig, tmuxSession, projectId, logOutput, updateStatus, startedAt);
          } else {
            logOutput += `⚠️ If your deploy command restarts the server, the deployment likely succeeded.\n`;
            logOutput += `   Please verify the server is running correctly.\n`;
            updateStatus('failed', logOutput).catch(() => {});
          }
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
            // ── Self-healing: stash local changes before fetch/pull to prevent collision ──
            'STASH_MADE=0',
            'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
            '  DIRTY=$(git status --porcelain 2>/dev/null)',
            '  if [ -n "$DIRTY" ]; then',
            '    echo "[deploy] ⚠️  Local changes detected — stashing before pull to prevent collision..."',
            '    git stash push -u -m "autodeploy-self-heal-$(date +%s)" && STASH_MADE=1 || true',
            '    if [ "$STASH_MADE" = "1" ]; then',
            '      echo "[deploy] ✅ Stashed local changes. Will clean up after deploy."',
            '    else',
            '      echo "[deploy] ⚠️  Could not stash local changes — attempting deploy anyway."',
            '    fi',
            '  fi',
            'fi',
          ];
          const targetBranch = (config.branch || 'main').replace('refs/heads/', '');

          // Temporarily write Bitbucket/GitHub credentials depending on provider
          if (config.bitbucketConnected && (config.bitbucketUser || config.bitbucketUsername) && config.bitbucketAppPassword) {
            try {
              let bbUser = config.bitbucketUser || decrypt(config.bitbucketUsername);
              let bbPass = decrypt(config.bitbucketAppPassword);
              if (bbUser && bbUser.includes('@')) {
                bbUser = bbUser.split('@')[0];
              }
              if (bbUser && bbPass) {
                const encodedUser = encodeURIComponent(bbUser);
                const encodedPass = encodeURIComponent(bbPass);
                scriptLines.push('RAW_URL=$(git remote get-url origin 2>/dev/null || echo "")');
                // Set credentials in git credential store for all subprocesses
                scriptLines.push(`echo "https://${encodedUser}:${encodedPass}@bitbucket.org" > ~/.git-credentials`);
                scriptLines.push(`git config --global credential.helper store`);
                // Also set it directly in the remote URL for git fetch/checkout
                scriptLines.push('if [ -n "$RAW_URL" ]; then');
                scriptLines.push('  CLEAN_PATH=$(echo "$RAW_URL" | sed -E \'s|.*bitbucket\\.org/|bitbucket.org/|; s|.*github\\.com/|github.com/|\')');
                scriptLines.push(`  AUTH_URL="https://${encodedUser}:${encodedPass}@\${CLEAN_PATH}"`);
                scriptLines.push('  git remote set-url origin "$AUTH_URL"');
                scriptLines.push('fi');
              }
            } catch (e) {}
            scriptLines.push(`git fetch origin`);
          } else if (config.githubToken) {
            try {
              let ghToken = decrypt(config.githubToken);
              if (ghToken) {
                const b64Cred = Buffer.from(`x-access-token:${ghToken}`).toString('base64');
                // Set local repository header so all subsequent git commands (including git pull in deployCommand) inherit it
                scriptLines.push(`git config http.extraHeader "Authorization: Basic ${b64Cred}"`);
                scriptLines.push(`git fetch origin`);
              } else {
                scriptLines.push(`git fetch origin`);
              }
            } catch (e) {
              scriptLines.push(`git fetch origin`);
            }
          } else {
            scriptLines.push(`git fetch origin`);
          }
          scriptLines.push(`echo "[deploy] Checking out branch: ${targetBranch}"`);
          scriptLines.push(`git checkout -B ${targetBranch} origin/${targetBranch}`);
          
          if (commitSha) {
            scriptLines.push(`echo "[deploy] Checking out specific commit: ${commitSha}"`);
            scriptLines.push(`git checkout -q ${commitSha}`);
            // Intercept git pull to skip it when a specific commit is selected
            scriptLines.push(`git() {`);
            scriptLines.push(`  if [ "$1" = "pull" ]; then`);
            scriptLines.push(`    echo "[deploy] Specific commit selected: skipping git pull"`);
            scriptLines.push(`    return 0`);
            scriptLines.push(`  fi`);
            scriptLines.push(`  command git "$@"`);
            scriptLines.push(`}`);
            scriptLines.push(`export -f git 2>/dev/null || true`);
          }
          scriptLines.push('echo "[deploy] Running deploy command..."');
          
          let cleanDeployCmd = (config.deployCommand || '').trim();
          // Auto-heal nested subshell syntax error: || (docker service inspect...)
          cleanDeployCmd = cleanDeployCmd.replace(/\|\|\s*\(\s*docker service inspect[^)]+\)/g, '');
          // Auto-heal duplicate nested headers inside body
          cleanDeployCmd = cleanDeployCmd.split('\n').map((line, idx) => {
            if (idx > 0 && (line.trim() === '#!/bin/bash' || line.trim() === 'set -e')) {
              return '# ' + line;
            }
            return line;
          }).join('\n');
          // Auto-heal empty $IMAGE_NAME variable in docker service create
          cleanDeployCmd = cleanDeployCmd.replace(/docker service create --name \$SVC \$PORT_FLAGS --detach=true --no-resolve-image --replicas 2 \$IMAGE_NAME/g, 'docker service create --name $SVC $PORT_FLAGS --detach=true --no-resolve-image --replicas 2 "${SVC}:latest"');
          // Remove broken inline fallback
          cleanDeployCmd = cleanDeployCmd.replace(/\|\| docker compose up -d --build/g, '2>/dev/null || true');

          scriptLines.push(cleanDeployCmd);

          // Clean up credentials after deploy command completes
          if (config.bitbucketConnected) {
            scriptLines.push(`cd "${resolvedPath}" || true`);
            scriptLines.push('rm -f ~/.git-credentials');
            scriptLines.push('git config --global --unset credential.helper || true');
            scriptLines.push('if [ -n "$RAW_URL" ]; then');
            scriptLines.push('  CLEAN_PATH=$(echo "$RAW_URL" | sed -E \'s|.*bitbucket\\.org/|bitbucket.org/|; s|.*github\\.com/|github.com/|\')');
            scriptLines.push('  git remote set-url origin "https://${CLEAN_PATH}"');
            scriptLines.push('fi');
          } else if (config.githubToken) {
            scriptLines.push(`cd "${resolvedPath}" || true`);
            scriptLines.push('git config --unset http.extraHeader || true');
          }
          // ── Self-healing: drop stash after deploy (stash was only a collision fix) ──
          scriptLines.push('if [ "$STASH_MADE" = "1" ]; then');
          scriptLines.push('  echo "[deploy] 🧹 Dropping auto-stash (local changes were saved as a temporary fix)..."');
          scriptLines.push('  git stash drop 2>/dev/null || true');
          scriptLines.push('  echo "[deploy] ✅ Stash dropped. Local changes discarded (they were only stashed to unblock the pull)."');
          scriptLines.push('fi');
          scriptLines.push('echo "[deploy] Deploy command finished successfully"');
          const deployScript = scriptLines.join('\n') + '\n';

          // ── Write deploy script via SFTP ─────────────────────────────────
            tmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);
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

            // tmux wrapper: runs the deploy script, captures exit code, writes status file for post-reconnect monitoring
            const statusFile = `/tmp/deploy_${tmuxSession}.status`;
            const tmuxWrapper = [
              '#!/bin/bash',
              `bash "${remoteDeployPath}"`,
              'CODE=$?',
              `rm -f "${remoteDeployPath}"`,
              `echo "$CODE" > "${statusFile}"`,
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
                `  rm -f "${tmuxWrapperPath}"`,
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
                const watchdog = setTimeout(async () => {
                  logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000}s. Terminating...\n`;
                  logOutput = limitLogOutput(logOutput);
                  try {
                    await updateStatus('failed', logOutput);
                  } catch (e) {
                    console.error('[deploy] Failed to update status on timeout:', e.message);
                  }
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

                  for (const rawLine of lines) {
                    const line = rawLine.replace(/\r/g, '').trim();
                    const m = line.match(/---DEPLOY_EXIT:(\d+)---/);
                    if (m) {
                      exitCodeDetected = parseInt(m[1], 10);
                    }
                    // Keep original line in logs
                    logOutput += rawLine + '\n';
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
                    const cleanBuf = stdoutBuf.replace(/\r/g, '').trim();
                    const m = cleanBuf.match(/---DEPLOY_EXIT:(\d+)---/);
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
    const token = searchParams.get('token');
    let projectId = searchParams.get('project') || 'default';
    let dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    console.log(`[webhook] Received POST request for project: ${projectId}`);

    // 1. Check for manual trigger (requires dashboard session)
    const session = await getServerSession(authOptions);
    const isManual = !!session;

    // 2. Fetch the deployment config
    await connectDB(process.env.MONGODB_URI, true);
    let setting;
    if (token) {
      // Token-based lookup: find project by webhookToken
      const allSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
      setting = allSettings.find(s => s.value?.webhookToken === token);
      if (!setting) {
        return NextResponse.json({ success: false, error: 'Invalid webhook token' }, { status: 404 });
      }
    } else {
      setting = await SystemSetting.findOne({ key: dbKey });
    }
    const config = setting?.value;

    // Resolve actual projectId/dbKey from the matched setting (important for token-based lookups)
    if (setting?.key) {
      dbKey = setting.key;
      projectId = dbKey === 'auto_deploy_config' ? 'default' : dbKey.replace('auto_deploy_config_', '');
    }

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

    let bodyText = await request.text();

    // GitHub supports two webhook content types:
    //   1. application/json          → body is raw JSON (normal)
    //   2. application/x-www-form-urlencoded → body is "payload=%7B%22ref%22..." (URL-encoded JSON)
    // Normalize to raw JSON so all downstream JSON.parse() calls work regardless of content type.
    if (bodyText && (bodyText.startsWith('payload=') || bodyText.includes('payload='))) {
      try {
        const params = new URLSearchParams(bodyText);
        const rawPayload = params.get('payload');
        if (rawPayload) {
          bodyText = rawPayload;
        } else {
          bodyText = decodeURIComponent(bodyText.replace(/\+/g, ' ').replace(/^payload=/, ''));
        }
      } catch (_) {
        try {
          bodyText = decodeURIComponent(bodyText.replace(/\+/g, ' ').replace(/^payload=/, ''));
        } catch (_) {}
      }
    }

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

          const rawBranch = String(config.branch || '').trim();
          const expectedRef = rawBranch
            ? (rawBranch.startsWith('refs/heads/') ? rawBranch : `refs/heads/${rawBranch}`)
            : null;

          // Helper: send a Telegram warning for non-watched branch pushes
          const sendBranchMismatchWarning = async (pushedBranch) => {
            if (!config.telegramNotification || !config.telegramBotToken || !config.telegramChatId) return;
            try {
              let botToken;
              try { botToken = decrypt(config.telegramBotToken); } catch { botToken = config.telegramBotToken; }

              // Extract git info for richer notification
              let author = null, commitMsg = null, commitId = null;
              try {
                if (isGitHub) {
                  const latestCommit = payload.commits?.[0];
                  author = payload.pusher?.name || latestCommit?.author?.name || null;
                  commitMsg = latestCommit?.message || null;
                  commitId = latestCommit?.id || null;
                } else if (isBitbucket) {
                  const change = payload.push?.changes?.[0];
                  const target = change?.new?.target || {};
                  author = payload.actor?.display_name || target.author?.raw || null;
                  commitMsg = target.message || null;
                  commitId = target.hash || null;
                }
              } catch (_) {}

              const projectName = config.name || config.id || 'Default Project';
              const watchedBranch = rawBranch || '(not set)';
              const provider = isGitHub ? 'GitHub' : 'Bitbucket';

              let text = `⚠️ <b>Push to Unwatched Branch</b>\n\n`;
              text += `<b>Project:</b> ${projectName}\n`;
              text += `<b>Pushed Branch:</b> <code>${pushedBranch}</code>\n`;
              text += `<b>Watched Branch:</b> <code>${watchedBranch}</code>\n`;
              text += `<b>Source:</b> ${provider} Webhook\n`;
              if (author) text += `<b>Pusher:</b> ${author}\n`;
              if (commitMsg) text += `<b>Commit:</b> <i>${escapeHtml(commitMsg.trim())}</i>\n`;
              if (commitId) text += `<b>Commit ID:</b> <code>${String(commitId).substring(0, 7)}</code>\n`;
              text += `\n<i>No deployment was triggered. Push to <code>${watchedBranch}</code> to deploy.</i>`;

              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'HTML' })
              });
            } catch (tgErr) {
              console.warn(`[webhook] Telegram branch-mismatch warning failed:`, tgErr.message);
            }
          };

          if (pushRef) {
            console.log(`[webhook] Push ref: ${pushRef}${expectedRef ? `, expected: ${expectedRef}` : ', no branch filter configured'}`);
            if (expectedRef && pushRef !== expectedRef) {
              const pushedBranch = pushRef.replace('refs/heads/', '');
              console.log(`[webhook] Branch mismatch (${pushRef} vs ${expectedRef}) - skipping deployment without updating status`);
              await sendBranchMismatchWarning(pushedBranch);
              return NextResponse.json({
                success: true,
                message: `Ref ${pushRef} does not match watched branch ${expectedRef}. Skipping deployment.`
              });
            }
          } else if (expectedRef) {
            // Could not determine the pushed branch from the payload — skip to be safe
            console.log(`[webhook] Could not extract push ref from payload but branch filter is set (${expectedRef}) — skipping deployment`);
            await sendBranchMismatchWarning('(unknown)');
            return NextResponse.json({
              success: true,
              message: `Could not extract push ref from payload. Expected watched branch ${expectedRef}. Skipping deployment.`
            });
          }
        } catch (e) {
          console.log(`[webhook] Warning: Could not parse payload:`, e.message);
          await updateDeployStatus(
            projectId,
            'failed',
            `[Webhook Error] Failed to parse payload from ${isGitHub ? 'GitHub' : 'Bitbucket'} request: ${e.message}`
          );
          // Stop here — don't fall through to trigger a deployment on a broken payload
          return NextResponse.json({ success: false, error: 'Failed to parse webhook payload' }, { status: 400 });
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

    // For webhook triggers, use the commit ID from git payload so
    // lastDeployedCommitSha is updated and the "Live" badge stays correct.
    if (!commitSha && gitInfo?.commitId) {
      commitSha = gitInfo.commitId;
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
