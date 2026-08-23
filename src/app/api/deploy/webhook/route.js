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
import { setRunning, clearRunning, killRunning, getRunning, tryAcquireStartLock, releaseStartLock, enqueueDeployment } from '@/lib/deployProcesses';
import OpenAI from 'openai';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

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

// No log truncation — each deployment stores the full log from start to finish.

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
    logger.error('Failed to update deploy status in DB:', err.message);
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
  const errorLinePattern = /\b(error|fatal|exception|crash|panic|segfault|killed|denied|cannot|unable to|refused|timed? ?out|broken|ENOENT|EACCES|EPERM|ENOSPC|ENOMEM|no space left|disk full|out of memory|not found|no such file|undefined is not|cannot read|failed to|command not found|permission denied|syntax error|unexpected token|module not found|cannot find module|type error|reference error|range error)\b/i;

  // Patterns to SKIP — these are noise, wrapper-infrastructure or generic status lines
  const skipPattern = /^(---DEPLOY_EXIT_CODE:|--->\s*Running|Deploying\.\.\.|warn\s*[:\-]|warning\s*[:\-]|info\s*[:\-]|\[SSE\]|npm warn|npm notice|yarn warning|deprecated|peer dep|info Visit|Done in \d|✨\s*Done|\/tmp\/deploy_(?:cmd|run|tmux)_|\[deploy\]\s*[✅⚠️❌🚀🧹📌]|\[deploy\]\s*(Starting|Working directory|Now in|Checking out|Running deploy|Deploy command finished|Stash|Dropping|aut))/i;

  // Patterns for compiler-style messages: "file:line:col: error: message"
  const compilerPattern = /(.+?):(\d+):(\d+):\s*(error|fatal error|E\d+):\s*(.+)/i;

  // Patterns for common build tool errors
  const buildErrorPatterns = [
    // gcc/clang: "file:line: error: message"
    /^(.+?):(\d+):\d*:\s*(?:fatal )?error:\s*(.+)/i,
    // Node/JS/TS: "Type error: message", "SyntaxError: message", etc.
    /^((?:Type|Syntax|Reference|Range|URI|Eval|Internal)?\s*error):?\s*(.+)/i,
    // TypeScript line errors: "./components/View.tsx:1799:44"
    /^(\.\/.+?:\d+:\d+)\s*(.+)/i,
    // Go: "file:line:col: error message" or "./path: line: message"
    /^(\.\/.+?):(\d+):\s*(.+)/i,
    // Python: "File \"path\", line N, in module" + following "XError: message"
    /^(?:Traceback|File\s+".+",\s+line\s+\d+)/i,
    // Generic "Error: ..." at start of line
    /^(?:Error|FATAL|FAILURE|FAILED)[\s:]+(.+)/i,
    // Disk / memory errors
    /(?:no space left on device|out of memory|disk full|ENOSPC|ENOMEM)/i,
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

// Extract error summary for Telegram notification using project/global AI settings.
// If AI is unavailable or fails, falls back to legacy regex error extractor.
async function extractErrorForTelegram(config, logText) {
  if (!logText) return null;

  // 1. Try AI Error Extraction using Auto Deploy AI config
  try {
    const projectId = config.id || 'default';
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    await connectDB(process.env.MONGODB_URI, true);
    const keysSetting = await SystemSetting.findOne({ key: 'ai_api_keys' });
    const configSetting = await SystemSetting.findOne({ key: 'ai_config' });
    const projectSetting = await SystemSetting.findOne({ key: dbKey });
    const projectAiPrefs = projectSetting?.value || {};

    let apiKey = process.env.GROQ_API_KEY || '';
    if (keysSetting?.value?.keys && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
      const idx = keysSetting.value.currentIndex || 0;
      apiKey = keysSetting.value.keys[idx] || keysSetting.value.keys[0];
    }

    const effectiveAiModel = config.aiModel || projectAiPrefs.aiModel;
    const effectiveAiCustomModel = config.aiCustomModel || projectAiPrefs.aiCustomModel;
    const effectiveAiEndpoint = (config.aiEndpoint || projectAiPrefs.aiEndpoint || '').trim();
    const effectiveAiApiKey = (config.aiApiKey || projectAiPrefs.aiApiKey || '').trim();

    let baseURL = 'https://api.groq.com/openai/v1';
    let modelName = configSetting?.value?.model || 'llama-3.3-70b-versatile';

    if (effectiveAiModel === 'manual' || (effectiveAiEndpoint && effectiveAiApiKey)) {
      let userEndpoint = effectiveAiEndpoint || 'https://api.openai.com/v1';
      userEndpoint = userEndpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
      baseURL = userEndpoint;
      modelName = effectiveAiCustomModel || 'gpt-3.5-turbo';
      apiKey = effectiveAiApiKey || apiKey;
    } else if (effectiveAiModel && effectiveAiModel !== 'auto') {
      modelName = effectiveAiModel;
    }

    if (apiKey) {
      // Strip wrapper-infrastructure lines (deploy script internals) before sending to AI.
      // These are noise that can mislead the LLM (e.g. /tmp/deploy_cmd_*.sh: unexpected EOF,
      // /tmp/deploy_run_*.sh: cd: No such file, [deploy] ✅ success messages, etc.).
      const deployWrapperNoise = /(\/tmp\/deploy_(?:cmd|run|tmux)_[^\n]*|^\[deploy\]\s*[✅⚠️❌🚀🧹📌][^\n]*|^\[deploy\]\s*(?:Starting|Working directory|Now in|Checking out|Running deploy|Deploy command finished|Stash|Dropping)[^\n]*|---DEPLOY_EXIT(?:_CODE)?:[^\n]*|---DEPLOY_MONITOR_DONE---[^\n]*)/gm;
      const cleanedLog = logText.replace(deployWrapperNoise, '').replace(/\n{3,}/g, '\n\n').trim();
      const logSnippet = cleanedLog.length > 35000 ? cleanedLog.slice(-35000) : cleanedLog;

      const openai = new OpenAI({
        baseURL,
        apiKey,
        timeout: 12000 // 12 sec max timeout
      });

      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature: 0.1,
        max_tokens: 350,
        messages: [
          {
            role: 'system',
            content: `You are a precise error detection engine. Analyze the deployment log and extract ONLY the exact actual error message line(s) causing the failure.

Examples of what to extract:
- TypeScript: "./components/CustomerView.tsx:1799:44 - Type error: This comparison appears to be unintentional..."
- Disk: "No space left on device"
- Module: "Module not found: Can't resolve 'some-package'"
- Build: "Failed to compile."
- Syntax: "SyntaxError: Unexpected token"

CRITICAL FORMAT RULES:
- Output ONLY the exact raw error line(s) from the log. Do NOT paraphrase.
- Include file path and line number if present in the log.
- IGNORE any lines starting with /tmp/deploy_ — those are wrapper script internals, not real errors.
- IGNORE lines like "[deploy] ✅", "[deploy] ❌", "[deploy] Starting", "[deploy] Working directory" — those are deploy system messages.
- DO NOT add explanations, intros, or outros.
- Return ONLY 1 to 4 clean, exact error lines from the build/compile/runtime output.`
          },
          {
            role: 'user',
            content: `Deployment Log:\n${logSnippet}`
          }
        ]
      });

      const aiText = completion.choices?.[0]?.message?.content?.trim();
      if (aiText && aiText.length > 0) {
        return { isAi: true, text: aiText };
      }
    }
  } catch (aiErr) {
    logger.warn('[Telegram Notification] AI error extraction failed, using legacy mode fallback:', aiErr.message);
  }

  // 2. Fallback to Legacy Mode
  const errors = extractErrorsFromLog(logText);
  if (errors && errors.length > 0) {
    return { isAi: false, errors };
  }

  return null;
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
    const errorAnalysis = await extractErrorForTelegram(config, extra.logText);
    if (errorAnalysis) {
      if (errorAnalysis.isAi) {
        text += `\n🤖 <b>AI Failure Analysis:</b>\n<pre>${escapeHtml(errorAnalysis.text)}</pre>\n`;
      } else if (errorAnalysis.errors && errorAnalysis.errors.length > 0) {
        text += `\n<b>Errors (Legacy Detector):</b>\n`;
        for (const err of errorAnalysis.errors) {
          text += `• <code>${escapeHtml(err)}</code>\n`;
        }
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
          logger.error(`[Telegram] Error sending to chat ${cid}: ${errText}`);
        }
      } catch (err) {
        logger.error(`[Telegram] Failed to send notification to chat ${cid}:`, err.message);
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
          updateStatus('running', logOutput).catch(() => {});
        });

        stream.stderr.on('data', (data) => {
          logOutput += data.toString();
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

// Resolve final deployment status from exit code + log output.
// Detects docker/compose/build success even when exit code is non-zero
// due to wrapper script cleanup failures (e.g. cd ./relative: No such file).
function resolveDeployStatus(exitCode, logText) {
  // Strip ANSI color escape codes so terminal output matches clean text
  const cleanLog = (logText || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  const hasSuccessMessage = cleanLog.includes('[deploy] Deploy command finished successfully');

  // Real build/compile errors — these always mean failure
  const realBuildErrors = [
    /\bFailed to compile\b/i,
    /\bType error:/i,
    /\bSyntaxError:/i,
    /\bModule not found:/i,
    /\bCannot find module\b/i,
    /\bbuild failed\b/i,
    /\bERROR in\b/,
    /\bCompilation error\b/i,
    /\bno space left on device\b/i,
    /\bENOSPC\b/,
  ];

  const hasRealBuildError = realBuildErrors.some(p => p.test(cleanLog));
  if (hasRealBuildError) return 'failed';

  // Standard success: exit 0 + success echo
  if (exitCode === 0 && hasSuccessMessage) return 'success';

  // Docker/Compose success indicators — if containers started/running,
  // treat as success even when wrapper cleanup scripts fail with non-zero exit
  const dockerSuccessPatterns = [
    /\bContainer\s+\S+\s+(?:Started|Running)\b/i,
    /✔\s*Container/i,
    /✓\s*Container/i,
    /\bImage\s+\S+\s+Built\b/i,
    /\[deploy\] Deploy command finished successfully/i,
  ];

  // Wrapper-only failure patterns — if failure is ONLY from /tmp/deploy_* scripts
  // and not from actual build tools, the real deployment succeeded
  const wrapperOnlyFailure = /\/tmp\/deploy_(?:cmd|run|tmux)_\S+:\s*line\s*\d+:/i.test(cleanLog);

  const dockerSucceeded = dockerSuccessPatterns.some(p => p.test(cleanLog));
  if (dockerSucceeded && wrapperOnlyFailure && !hasRealBuildError) return 'success';

  // Default
  return exitCode === 0 ? 'success' : 'failed';
}

// Background deployment execution
export async function runDeployment(config, runMeta = {}) {
  const startedAt = new Date();
  const projectId = config.id || 'default';
  const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
  let lastNotifiedStatus = null;
  let isFinished = false;
  const commitSha = runMeta.commitSha || null;

  // ── Zombie guard: kill any existing in-memory run for this project before starting ──
  // This prevents stale bash/SSH watcher processes from a prior run from interfering.
  // It does NOT affect actual Docker containers or Swarm services.
  try {
    if (getRunning(projectId)) {
      logger.info(`[deploy] ⚠️  Killing stale in-memory process for project "${projectId}" before starting new run.`);
      killRunning(projectId);
    }
  } catch (_) {}

  // Reset DB status to ensure we start clean (handles cases where status was stuck at 'running')
  try {
    await connectDB(process.env.MONGODB_URI, true);
    await SystemSetting.findOneAndUpdate(
      { key: dbKey, 'value.status': 'running' },
      { $set: { 'value.status': 'idle', 'value.deployRunId': null, 'value.cancelRequested': false } }
    );
  } catch (_) {}

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
    const isTerminal = status === 'success' || status === 'failed';
    const maxAttempts = isTerminal ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await connectDB(process.env.MONGODB_URI, true);
        const updateFields = {
          'value.status': status,
          'value.lastDeployLog': finalLog,
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
              logText: status !== 'running' ? finalLog : undefined
            });
          } catch (err) {
            logger.error('[Telegram] error:', err.message);
          }
        }
        break; // success — exit retry loop
      } catch (dbErr) {
        logger.error(`Failed to update deploy status in DB (attempt ${attempt}/${maxAttempts}):`, dbErr.message);
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
    if (status !== 'running') {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      await updateStatus(status, finalLog, extra);
      return;
    }

    const now = Date.now();
    if (now - lastUpdateTime > 1500) {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      lastUpdateTime = now;
      await updateStatus(status, finalLog, extra);
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
      'DEPLOY_ABS_DIR="$(pwd)"',
      'echo "[deploy] Working directory: $DEPLOY_ABS_DIR"',
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
    
    let cleanLocalDeployCmd = (config.deployCommand || '').trim().replace(/[^\x00-\x7F]/g, '');
    // For Swarm deployments: patch in rollback flags and remove set -e.
    // set -e causes the entire script to abort when `docker service update` exits non-zero
    // (which happens normally during a rollback), killing the process before Swarm finishes
    // rolling back to the good image.
    const isSwarmScript = /docker\s+(service|stack|swarm)/.test(cleanLocalDeployCmd);
    if (isSwarmScript) {
      // Remove set -e — swarm scripts handle failures explicitly
      cleanLocalDeployCmd = cleanLocalDeployCmd.replace(/^set -e\s*$/m, '# set -e disabled for swarm (rollback exits non-zero by design)');
      // Inject rollback flags into any service update command missing them
      cleanLocalDeployCmd = cleanLocalDeployCmd.replace(
        /docker service update(\s[^\n]+)/g,
        (match) => {
          let patched = match;
          if (!patched.includes('--update-failure-action')) patched += ' --update-failure-action rollback';
          if (!patched.includes('--update-monitor')) patched += ' --update-monitor 15s';
          if (!patched.includes('--update-order')) patched += ' --update-order start-first';
          if (!patched.includes('--update-parallelism')) patched += ' --update-parallelism 1';
          if (!patched.includes('--update-delay')) patched += ' --update-delay 5s';
          if (!patched.includes('--rollback-order')) patched += ' --rollback-order start-first';
          if (!patched.includes('--rollback-parallelism')) patched += ' --rollback-parallelism 1';
          if (!patched.includes('--rollback-monitor')) patched += ' --rollback-monitor 15s';
          return patched;
        }
      );
    }
    cleanLocalDeployCmd = cleanLocalDeployCmd.split('\n').filter(line => !line.includes('SWARM_TARGET=$(') && !line.includes('|| (docker service inspect')).map((line, idx) => {
      if (idx > 0 && (line.trim() === '#!/bin/bash' || line.trim() === 'set -e')) {
        return '# ' + line;
      }
      if (line.includes('docker service create') && line.includes('$IMAGE_NAME')) {
        return line.replace('$IMAGE_NAME', '"${SVC}:latest"').replace('|| docker compose up -d --build', '2>/dev/null || true');
      }
      // Patch --remove-orphans into docker compose up if missing
      if (/docker\s+compose\s+up\b/.test(line) && !line.includes('--remove-orphans')) {
        return line.replace(/docker\s+compose\s+up\b/, 'docker compose up --remove-orphans');
      }
      // Patch --remove-orphans into docker compose down if missing
      if (/docker\s+compose\s+down\b/.test(line) && !line.includes('--remove-orphans')) {
        return line.replace(/docker\s+compose\s+down\b/, 'docker compose down --remove-orphans');
      }
      return line;
    }).join('\n');

    scriptLines.push(cleanLocalDeployCmd);

    // Clean up credentials after deploy command completes
    if (config.bitbucketConnected) {
      scriptLines.push('cd "$DEPLOY_ABS_DIR" 2>/dev/null || true');
      scriptLines.push('rm -f ~/.git-credentials');
      scriptLines.push('git config --global --unset credential.helper || true');
    } else if (config.githubToken) {
      scriptLines.push('cd "$DEPLOY_ABS_DIR" 2>/dev/null || true');
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
      logger.warn('[deploy] Failed to register running process:', e.message);
    }

    // Watchdog to avoid indefinitely hanging processes (default 10 minutes)
    const timeoutMs = (config.timeoutSeconds || 600) * 1000;
    const watchdog = setTimeout(async () => {
      const now = new Date();
      logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000} seconds and will be terminated.\n`;
      try {
        await updateStatus('failed', logOutput);
      } catch (e) {
        logger.error('[deploy] Failed to update status on timeout:', e.message);
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
      if (logOutput.length > 200000) logOutput = logOutput.slice(0, 6000) + '\n\n[... log trimmed — middle omitted to save memory ...]\n\n' + logOutput.slice(-190000);
      throttledUpdateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.stderr.on('data', (data) => {
      logOutput += data.toString();
      if (logOutput.length > 200000) logOutput = logOutput.slice(0, 6000) + '\n\n[... log trimmed — middle omitted to save memory ...]\n\n' + logOutput.slice(-190000);
      throttledUpdateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.on('close', (code) => {
      clearTimeout(watchdog);
      const finishedAt = new Date();
      logOutput += `\n--------------------------------------------------\n`;
      logOutput += `[${finishedAt.toISOString()}] Process exited with code: ${code}\n`;
      const status = resolveDeployStatus(code, logOutput);
      try { clearRunning(projectId); } catch (e) {}
      updateStatus(status, logOutput).catch(() => {});
    });

    childProcess.on('error', (err) => {
      clearTimeout(watchdog);
      const finishedAt = new Date();
      logOutput += `\n--------------------------------------------------\n`;
      logOutput += `[${finishedAt.toISOString()}] ❌ Process execution error: ${err.message}\n`;
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
        logger.info(`[deploy] SSH connection data not cached, attempting fresh lookup for ID: ${connectionId}`);
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
            logger.info(`[deploy] Successfully fetched SSH connection from main database`);
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
        logger.warn('[deploy] Failed to register SSH connection:', e.message);
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

        {
          const runTimestamp = Date.now();
          const remoteDeployPath = `/tmp/deploy_run_${projectId}_${runTimestamp}.sh`;
          const userCmdPath = `/tmp/deploy_cmd_${projectId}_${runTimestamp}.sh`;

          // ── Kill any leftover tmux session from a previous deploy run ──
          // This prevents zombie tmux sessions from piling up when a new push
          // arrives before the previous deploy finished.
          // Safe: only kills the deploy-specific session, not your other tmux sessions.
          const prevTmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);
          conn.exec(
            `tmux kill-session -t ${prevTmuxSession} 2>/dev/null || true; ` +
            `rm -f /tmp/deploy_${prevTmuxSession}.log /tmp/deploy_${prevTmuxSession}.status /tmp/deploy_tmux_${projectId}.sh 2>/dev/null || true`,
            (killErr, killStream) => {
              if (killStream) killStream.resume(); // drain and ignore output
            }
          );

          // ── The actual deploy script ──────────────────────────
          const scriptLines = [
            '#!/bin/bash',
            `trap 'rm -f /tmp/deploy_*_${projectId}*.sh 2>/dev/null || true' EXIT`,
            'echo "[deploy] Starting deployment on $(hostname) at $(date)"',
            'echo "[deploy] Working directory: ' + resolvedPath + '"',
            `if [ ! -d "${resolvedPath}" ]; then echo "[deploy] ERROR: Directory '${resolvedPath}' does not exist"; exit 1; fi`,
            `cd "${resolvedPath}" || { echo "[deploy] ERROR: Cannot cd to ${resolvedPath}"; exit 1; }`,
            'DEPLOY_ABS_DIR="$(pwd)"',
            'echo "[deploy] Absolute working directory: $DEPLOY_ABS_DIR"',
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
          // Wrap all git operations in a git-availability check so servers without git skip gracefully
          scriptLines.push(`if ! command -v git >/dev/null 2>&1; then`);
          scriptLines.push(`  echo "[deploy] git not found — attempting auto-install..."`);
          scriptLines.push(`  if command -v dnf >/dev/null 2>&1; then sudo dnf install -y git 2>&1 || true`);
          scriptLines.push(`  elif command -v yum >/dev/null 2>&1; then sudo yum install -y git 2>&1 || true`);
          scriptLines.push(`  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y git 2>&1 || true`);
          scriptLines.push(`  elif command -v apk >/dev/null 2>&1; then sudo apk add --no-cache git 2>&1 || true`);
          scriptLines.push(`  fi`);
          scriptLines.push(`  command -v git >/dev/null 2>&1 && echo "[deploy] git installed successfully." || echo "[deploy] WARNING: git install failed — fetch/checkout will be skipped."`);
          scriptLines.push(`fi`);
          scriptLines.push(`if command -v git >/dev/null 2>&1; then`);
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
                scriptLines.push('  RAW_URL=$(git remote get-url origin 2>/dev/null || echo "")');
                // Set credentials in git credential store for all subprocesses
                scriptLines.push(`  echo "https://${encodedUser}:${encodedPass}@bitbucket.org" > ~/.git-credentials`);
                scriptLines.push(`  git config --global credential.helper store`);
                // Also set it directly in the remote URL for git fetch/checkout
                scriptLines.push('  if [ -n "$RAW_URL" ]; then');
                scriptLines.push('    CLEAN_PATH=$(echo "$RAW_URL" | sed -E "s|https://[^@]+@|https://|")');
                scriptLines.push(`    AUTH_URL="https://${encodedUser}:${encodedPass}@\${CLEAN_PATH#https://}"`);
                scriptLines.push('    git remote set-url origin "$AUTH_URL" 2>/dev/null || true');
                scriptLines.push('  fi');
              }
            } catch (e) {}
            scriptLines.push(`  git fetch origin`);
          } else if (config.githubToken) {
            try {
              let ghToken = decrypt(config.githubToken);
              if (ghToken) {
                const b64Cred = Buffer.from(`x-access-token:${ghToken}`).toString('base64');
                // Set local repository header so all subsequent git commands (including git pull in deployCommand) inherit it
                scriptLines.push(`  git config http.extraHeader "Authorization: Basic ${b64Cred}"`);
                scriptLines.push(`  git fetch origin`);
              } else {
                scriptLines.push(`  git fetch origin`);
              }
            } catch (e) {
              scriptLines.push(`  git fetch origin`);
            }
          } else {
            scriptLines.push(`  git fetch origin`);
          }
          scriptLines.push(`  echo "[deploy] Checking out branch: ${targetBranch}"`);
          scriptLines.push(`  git checkout -B ${targetBranch} origin/${targetBranch}`);

          if (commitSha) {
            scriptLines.push(`  echo "[deploy] Checking out specific commit: ${commitSha}"`);
            scriptLines.push(`  git checkout -q ${commitSha}`);
            // Intercept git pull to skip it when a specific commit is selected
            scriptLines.push(`  git() { if [ "$1" = "pull" ]; then echo "[deploy] Specific commit selected: skipping git pull"; return 0; fi; command git "$@"; }`);
            scriptLines.push(`  export -f git 2>/dev/null || true`);
          }
          scriptLines.push(`else`);
          scriptLines.push(`  echo "[deploy] git not found — skipping fetch/checkout, running deploy command directly"`);
          scriptLines.push(`fi`);
          scriptLines.push('echo "[deploy] Running deploy command..."');
          
          let rawDeployCmd = (config.deployCommand || '').trim();
          // Strip non-ASCII multibyte characters (like emojis) from bash script to prevent locale issues on Linux shells
          rawDeployCmd = rawDeployCmd.replace(/[^\x00-\x7F]/g, '');
          let cleanCmd = rawDeployCmd.replace(/^#!\/bin\/bash\s*\n?/, '').trim();

          const isSwarmScript = /docker\s+(service|stack|swarm)/.test(cleanCmd);
          if (isSwarmScript) {
            // Remove set -e — swarm scripts handle failures explicitly
            cleanCmd = cleanCmd.replace(/^set -e\s*$/m, '# set -e disabled for swarm (rollback exits non-zero by design)');
            // Inject rollback flags into any service update command missing them
            cleanCmd = cleanCmd.replace(
              /docker service update(\s[^\n]+)/g,
              (match) => {
                let patched = match;
                if (!patched.includes('--update-failure-action')) patched += ' --update-failure-action rollback';
                if (!patched.includes('--update-monitor')) patched += ' --update-monitor 15s';
                if (!patched.includes('--update-order')) patched += ' --update-order start-first';
                if (!patched.includes('--update-parallelism')) patched += ' --update-parallelism 1';
                if (!patched.includes('--update-delay')) patched += ' --update-delay 5s';
                if (!patched.includes('--rollback-order')) patched += ' --rollback-order start-first';
                if (!patched.includes('--rollback-parallelism')) patched += ' --rollback-parallelism 1';
                if (!patched.includes('--rollback-monitor')) patched += ' --rollback-monitor 15s';
                return patched;
              }
            );
          }

          // Build the user command script content — written via SFTP directly (no echo/base64 which has shell length limits)
          // Auto-install git if not present, then proceed normally
          const gitShim = `
# ── Auto-install git if not installed ──
if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git not found — attempting auto-install..."
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y git 2>&1 || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y git 2>&1 || true
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add --no-cache git 2>&1 || true
  else
    echo "[deploy] WARNING: No package manager found — cannot auto-install git. Skipping git commands."
    git() { echo "[deploy] WARNING: git not installed — skipping: git $*"; return 0; }
    export -f git 2>/dev/null || true
  fi
  if command -v git >/dev/null 2>&1; then
    echo "[deploy] git installed successfully."
  else
    echo "[deploy] WARNING: git install failed — git commands will be skipped."
    git() { echo "[deploy] WARNING: git not installed — skipping: git $*"; return 0; }
    export -f git 2>/dev/null || true
  fi
fi
`;
          const userCmdScript = cleanCmd ? `#!/bin/bash\nset +e\n${gitShim}\n${cleanCmd}\n` : '#!/bin/bash\nexit 0\n';

          // The outer run script references the pre-uploaded user command script directly
          scriptLines.push(`USER_CMD_PATH="${userCmdPath}"`);
          scriptLines.push(`chmod +x "$USER_CMD_PATH" 2>/dev/null || true`);
          scriptLines.push(`USER_CMD_EXIT=0`);
          scriptLines.push(`bash "$USER_CMD_PATH" || USER_CMD_EXIT=$?`);
          scriptLines.push(`rm -f "$USER_CMD_PATH" 2>/dev/null || true`);
          scriptLines.push(`if [ "$USER_CMD_EXIT" != "0" ]; then`);
          scriptLines.push(`  echo "[deploy] ❌ Deploy command failed with exit code $USER_CMD_EXIT"`);
          scriptLines.push(`  if command -v docker >/dev/null 2>&1 && docker node ls >/dev/null 2>&1; then`);
          scriptLines.push(`    echo "[deploy] 🔍 Checking for paused or crashing Swarm services to restore..."`);
          scriptLines.push(`    for _svc in $(docker service ls --format '{{.Name}}' 2>/dev/null); do`);
          scriptLines.push(`      _ST=$(docker service inspect "$_svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || echo "")`);
          scriptLines.push(`      if [ "$_ST" = "paused" ] || [ "$_ST" = "updating" ]; then`);
          scriptLines.push(`        echo "[deploy] 🛡️ Auto-recovering Swarm service $_svc (status: $_ST)..."`);
          scriptLines.push(`        docker service rollback "$_svc" 2>/dev/null || true`);
          scriptLines.push(`      fi`);
          scriptLines.push(`    done`);
          scriptLines.push(`  fi`);
          scriptLines.push(`fi`);

          // Clean up credentials — always run regardless of exit code, never fail the script
          if (config.bitbucketConnected) {
            scriptLines.push('cd "$DEPLOY_ABS_DIR" 2>/dev/null || true');
            scriptLines.push('rm -f ~/.git-credentials 2>/dev/null || true');
            scriptLines.push('git config --global --unset credential.helper 2>/dev/null || true');
            scriptLines.push('if [ -n "$RAW_URL" ]; then git remote set-url origin "$RAW_URL" 2>/dev/null || true; fi');
          } else if (config.githubToken) {
            scriptLines.push('cd "$DEPLOY_ABS_DIR" 2>/dev/null || true');
            scriptLines.push('git config --unset http.extraHeader 2>/dev/null || true');
          }
          // ── Self-healing: drop stash after deploy ──
          scriptLines.push('if [ "$STASH_MADE" = "1" ]; then');
          scriptLines.push('  git stash drop 2>/dev/null || true');
          scriptLines.push('fi');
          // Always exit with the user command exit code (0 = success, non-zero = fail)
          scriptLines.push('if [ "$USER_CMD_EXIT" != "0" ]; then exit $USER_CMD_EXIT; fi');
          scriptLines.push('echo "[deploy] Deploy command finished successfully"');
          const deployScript = scriptLines.join('\n') + '\n';

          // ── Write both scripts via SFTP ─────────────────────────────────
          // Write the user command script FIRST via SFTP (no echo/base64 — avoids shell length limits)
          // Then write the outer run script which references it
          tmuxSession = `deploy-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 60);
          const tmuxWrapperPath = `/tmp/deploy_tmux_${projectId}.sh`;

          // Write a file to the remote server.
          // Primary: sftp.writeFile (fast, reliable on most servers).
          // Fallback: base64 over SSH exec stdin (for servers with restricted SFTP).
          const writeRemoteFile = (remotePath, content, mode, cb) => {
            conn.sftp((sftpErr, sftp) => {
              if (sftpErr) return writeViaSsh(remotePath, content, mode, cb);
              sftp.writeFile(remotePath, content, { mode }, (writeErr) => {
                if (!writeErr) return cb(null);
                // SFTP failed — fall back to exec
                logOutput += `[SSH] SFTP write failed (${writeErr.message}), trying exec fallback...\n`;
                writeViaSsh(remotePath, content, mode, cb);
              });
            });
          };

          const writeViaSsh = (remotePath, content, mode, cb) => {
            const b64 = Buffer.from(content).toString('base64');
            // Send base64 content as stdin — no ARG_MAX issues, works on any server
            const writeCmd = `base64 -d > ${remotePath} && chmod ${mode.toString(8)} ${remotePath}`;
            conn.exec(writeCmd, (err, stream) => {
              if (err) return cb(err);
              let stderr = '';
              stream.stderr.on('data', d => { stderr += d.toString(); });
              stream.stdout.resume();
              stream.on('close', (code) => {
                if (code !== 0) return cb(new Error(stderr.trim() || `write exited ${code}`));
                cb(null);
              });
              stream.on('error', cb);
              stream.end(b64 + '\n');
            });
          };

          writeRemoteFile(userCmdPath, userCmdScript, 0o755, (userCmdWriteErr) => {
            if (userCmdWriteErr) {
              logOutput += `[SSH] Warning: could not pre-upload user cmd script (${userCmdWriteErr.message})\n`;
            }

            writeRemoteFile(remoteDeployPath, deployScript, 0o755, (writeErr) => {
            if (writeErr) {
              logOutput += `[SSH Error] Failed to write deploy script: ${writeErr.message}\n`;
              try { clearRunning(projectId); } catch (e) {}
              updateStatus('failed', logOutput).catch(() => {});
              conn.end();
              return;
            }

            logOutput += `[SSH] Scripts uploaded. Launching deployment...\n\n`;
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
                  try { clearRunning(projectId); } catch (e) {}
                  updateStatus('failed', logOutput);
                  conn.end();
                  return;
                }

                // Watchdog timeout
                const timeoutMs = (config.timeoutSeconds || 600) * 1000;
                const watchdog = setTimeout(async () => {
                  logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000}s. Terminating...\n`;
                  try {
                    await updateStatus('failed', logOutput);
                  } catch (e) {
                    logger.error('[deploy] Failed to update status on timeout:', e.message);
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

                  if (logOutput.length > 200000) logOutput = logOutput.slice(0, 6000) + '\n\n[... log trimmed — middle omitted to save memory ...]\n\n' + logOutput.slice(-190000);
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
                  const status = resolveDeployStatus(finalCode, logOutput);

                  try { clearRunning(projectId); } catch (e) {}
                   updateStatus(status, logOutput).catch(() => {});
                  conn.end();
                });
              });
            }; // end launchDeploy

            writeRemoteFile(tmuxWrapperPath, tmuxWrapper, 0o755, (tmuxWriteErr) => {
              if (tmuxWriteErr) logOutput += `[deploy] tmux wrapper write failed: ${tmuxWriteErr.message}\n`;
              launchDeploy();
            });
          }); // end writeRemoteFile(remoteDeployPath)
        }); // end writeRemoteFile(userCmdPath)
      } // end ready block
    }); // end conn.on('ready')

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

    let rawBodyText = '';
    try { rawBodyText = await request.text(); } catch (_) {}

    let bodyText = rawBodyText;
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

    let body = {};
    try { if (bodyText) body = JSON.parse(bodyText); } catch (_) {}
    const { deployCommand: bodyDeployCmd } = body;

    logger.info(`[webhook] Received POST request for project: ${projectId}`);

    // 1. Check for manual trigger (requires dashboard session)
    const session = await getServerSession(authOptions);
    const isManual = !!session;
    const userId = session?.user?.id || session?.user?.sub || session?.user?.email || null;

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
    } else if (isManual && userId) {
      setting = await SystemSetting.findOne({ ...resolveUserIdQuery(userId), key: dbKey });
    } else {
      setting = await SystemSetting.findOne({ key: dbKey });
    }
    const config = setting?.value || {};

    // If manual trigger passed a fresh deployCommand in body, prioritize it!
    if (isManual && bodyDeployCmd?.trim()) {
      config.deployCommand = bodyDeployCmd;
    }

    // Resolve actual projectId/dbKey from the matched setting (important for token-based lookups)
    if (setting?.key) {
      dbKey = setting.key;
      projectId = dbKey === 'auto_deploy_config' ? 'default' : dbKey.replace('auto_deploy_config_', '');
    }

    logger.info(`[webhook] Config found:`, config ? {
      enabled: config.enabled,
      branch: config.branch,
      targetType: config.targetType,
      hasDeployCommand: !!config.deployCommand?.trim(),
    } : 'NO CONFIG');

    if (!config || (!config.enabled && !isManual)) {
      logger.info(`[webhook] Deployment skipped - config missing or disabled`);
      return NextResponse.json({ success: false, error: `Auto-deployment for project "${projectId}" is disabled or not configured` }, { status: 400 });
    }

    if (!config.deployCommand?.trim()) {
      logger.info(`[webhook] ❌ No deployment command set!`);
      return NextResponse.json({ success: false, error: 'Deployment command is not configured' }, { status: 400 });
    }

    if (config.targetType === 'ssh') {
      const connectionId = String(config.connectionId || '').trim();
      if (!connectionId) {
        logger.info(`[webhook] ❌ SSH target configured but no connection selected`);
        return NextResponse.json({ success: false, error: 'SSH deployment is configured but no SSH connection is selected. Please update deployment settings.' }, { status: 400 });
      }

      const hasCachedConnection = config.sshConnectionData && config.sshConnectionData.host;
      if (!hasCachedConnection) {
        logger.info(`[webhook] SSH connection data not cached in project config, verifying in DB...`);
        const db = await connectDB(isManual ? null : process.env.MONGODB_URI, !isManual);
        const repo = new ConnectionRepository(db);
        await repo.init();
        const connection = await repo.findById(connectionId);
        if (!connection) {
          logger.info(`[webhook] ❌ SSH connection ID ${connectionId} not found`);
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
          logger.info(`[webhook] Deployment for "${projectId}" has been running for >${timeoutMs/1000}s — treating as stale and resetting.`);
        } else {
          logger.info(`[webhook] Stale running state detected for project: ${projectId}. Resetting status and allowing new deployment.`);
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
        logger.info(`[webhook] Deployment already running for project: ${projectId} - rejecting new trigger`);
        return NextResponse.json({ success: false, error: 'A deployment is already running for this project' }, { status: 409 });
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
        logger.info(`[webhook] Received GitHub ping`);
        return NextResponse.json({ success: true, message: 'GitHub Ping received successfully' });
      }
      if (bitbucketEvent === 'diagnostics:ping') {
        logger.info(`[webhook] Received Bitbucket ping`);
        return NextResponse.json({ success: true, message: 'Bitbucket Ping received successfully' });
      }

      // For push events, verify signature and check branch
      const isPushEvent = (isGitHub && githubEvent === 'push') || (isBitbucket && bitbucketEvent === 'repo:push');

      if (isPushEvent) {
        if (config.secret) {
          // GitHub uses x-hub-signature-256, Bitbucket uses x-hub-signature
          const signatureHeader = request.headers.get('x-hub-signature-256') || request.headers.get('x-hub-signature');
          if (!signatureHeader || (!verifySignature(rawBodyText, config.secret, signatureHeader) && !verifySignature(bodyText, config.secret, signatureHeader))) {
            logger.info(`[webhook] Signature verification failed`);
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
              logger.warn(`[webhook] Telegram branch-mismatch warning failed:`, tgErr.message);
            }
          };

          if (pushRef) {
            logger.info(`[webhook] Push ref: ${pushRef}${expectedRef ? `, expected: ${expectedRef}` : ', no branch filter configured'}`);
            if (expectedRef && pushRef !== expectedRef) {
              const pushedBranch = pushRef.replace('refs/heads/', '');
              logger.info(`[webhook] Branch mismatch (${pushRef} vs ${expectedRef}) - skipping deployment without updating status`);
              await sendBranchMismatchWarning(pushedBranch);
              return NextResponse.json({
                success: true,
                message: `Ref ${pushRef} does not match watched branch ${expectedRef}. Skipping deployment.`
              });
            }
          } else if (expectedRef) {
            // Could not determine the pushed branch from the payload — skip to be safe
            logger.info(`[webhook] Could not extract push ref from payload but branch filter is set (${expectedRef}) — skipping deployment`);
            await sendBranchMismatchWarning('(unknown)');
            return NextResponse.json({
              success: true,
              message: `Could not extract push ref from payload. Expected watched branch ${expectedRef}. Skipping deployment.`
            });
          }
        } catch (e) {
          logger.info(`[webhook] Warning: Could not parse payload:`, e.message);
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
      logger.info(`[webhook] Rate limit exceeded for project: ${projectId}`);
      return NextResponse.json({ success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` }, { status: 429 });
    }

    // Acquire per-project start lock to prevent race conditions
    // If a deploy is already running, this will queue the new one instead of rejecting.
    // The queue ensures rapid pushes are serialized, not dropped.
    logger.info(`[webhook] ✅ Triggering deployment for project: ${projectId}`);

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

    // Extract commitSha & deployCommand from manual trigger body
    let commitSha = null;
    if (isManual && bodyText) {
      try {
        const body = JSON.parse(bodyText);
        if (body.commitSha) commitSha = body.commitSha;
        if (body.deployCommand && body.deployCommand.trim()) {
          config.deployCommand = body.deployCommand.trim();
        }
      } catch (e) {}
    }

    // For webhook triggers, use the commit ID from git payload so
    // lastDeployedCommitSha is updated and the "Live" badge stays correct.
    if (!commitSha && gitInfo?.commitId) {
      commitSha = gitInfo.commitId;
    }

    // Enqueue the deployment — if one is already running, this waits in queue
    enqueueDeployment(projectId, async () => {
      await runDeployment(config, {
        gitInfo,
        triggerSource,
        commitSha
      });
    }).catch(err => {
      logger.error('[webhook] Queued deployment error:', err.message);
    });

    return NextResponse.json({
      success: true,
      message: isManual ? 'Manual deployment triggered successfully' : 'Auto deployment triggered by Webhook'
    });

  } catch (error) {
    logger.error('[deploy/webhook] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
