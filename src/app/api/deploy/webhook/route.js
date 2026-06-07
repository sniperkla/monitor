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
import { setRunning, clearRunning, getRunning } from '@/lib/deployProcesses';

// Verify GitHub webhook signature using HMAC-SHA256
function verifySignature(bodyText, secret, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  const signature = parts[1];
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(bodyText).digest('hex');
  
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch (e) {
    return false;
  }
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

async function sendTelegramNotification(config, status) {
  if (!config.telegramNotification || !config.telegramBotToken || !config.telegramChatId) {
    return;
  }
  
  let text = '';
  const projectName = config.name || config.id || 'Default Project';
  const target = config.targetType === 'ssh' ? 'Remote SSH' : 'Local Host';
  
  if (status === 'running') {
    text = `🚀 <b>Deployment Started</b>\n<b>Project:</b> ${projectName}\n<b>Target:</b> ${target}`;
  } else if (status === 'success') {
    text = `✅ <b>Deployment Succeeded</b>\n<b>Project:</b> ${projectName}\n<b>Target:</b> ${target}`;
  } else if (status === 'failed') {
    text = `❌ <b>Deployment Failed</b>\n<b>Project:</b> ${projectName}\n<b>Target:</b> ${target}`;
  } else {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
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
async function runDeployment(config) {
  const startedAt = new Date();
  const projectId = config.id || 'default';
  const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;
  let lastNotifiedStatus = null;

  let logOutput = `[${startedAt.toISOString()}] 🚀 Deployment started in the background for project "${config.name || projectId}"...\n`;
  logOutput += `Target: ${config.targetType.toUpperCase()}\n`;
  if (config.targetType === 'ssh') {
    logOutput += `SSH Connection ID: ${config.connectionId}\n`;
  }
  logOutput += `--------------------------------------------------\n\n`;

  const runId = crypto.randomUUID();

  // Helper to update status in DB
  const updateStatus = async (status, finalLog, extra = {}) => {
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

      await SystemSetting.findOneAndUpdate(
        { key: dbKey },
        { $set: updateFields }
      );
      // Broadcast update to all SSE clients
      await broadcastDeploymentStatus(projectId);

      // Send Telegram notification on state change
      if (status !== lastNotifiedStatus && (status === 'running' || status === 'success' || status === 'failed')) {
        lastNotifiedStatus = status;
        sendTelegramNotification(config, status).catch(err => {
          console.error('[Telegram] error:', err.message);
        });
      }
    } catch (dbErr) {
      console.error('Failed to update deploy status in DB:', dbErr.message);
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



    const script = [
      '#!/bin/bash',
      'set -o pipefail',
      `cd "${cwdPath}" || { echo "[deploy] ERROR: cannot cd to ${cwdPath}"; exit 1; }`,
      config.deployCommand
    ].join('\n');

    // Spawn bash reading script from stdin — avoids shell escaping issues
    const childProcess = spawn('bash', ['-s'], {
      cwd: cwdPath,
      stdio: ['pipe', 'pipe', 'pipe']
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
      updateStatus('failed', logOutput).catch(() => {});
      try {
        childProcess.kill('SIGTERM');
      } catch (e) {
        // ignore
      }
    }, timeoutMs);

    childProcess.stdout.on('data', (data) => {
      logOutput += data.toString();
      updateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.stderr.on('data', (data) => {
      logOutput += data.toString();
      updateStatus('running', logOutput).catch(() => {}); // Stream logs
    });

    childProcess.on('close', (code) => {
      clearTimeout(watchdog);
      const finishedAt = new Date();
      logOutput += `\n--------------------------------------------------\n`;
      logOutput += `[${finishedAt.toISOString()}] Process exited with code: ${code}\n`;
      const status = code === 0 ? 'success' : 'failed';
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
        sshConfig.password = decrypt(sshConnData.password);
      } else if (sshConnData.authType === 'privateKey') {
        sshConfig.privateKey = decrypt(sshConnData.privateKey);
        if (sshConnData.passphrase) {
          sshConfig.passphrase = decrypt(sshConnData.passphrase);
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
            // Pick first active relay (or matching connection owner if available)
            relay = Array.from(activeRelays.values())[0];
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
      
      conn.on('ready', () => {
        logOutput += `[SSH] Connected successfully. Preparing deployment scripts...\n`;
        updateStatus('running', logOutput);

        conn.sftp((err, sftp) => {
          if (err) {
            logOutput += `[SSH Error] SFTP initialization failed: ${err.message}\n`;
            updateStatus('failed', logOutput);
            conn.end();
            return;
          }

          const remoteDeployPath = `/tmp/deploy_run_${projectId}.sh`;

          // ── The actual deploy script ──────────────────────────
          const deployScript = [
            '#!/bin/bash',
            'set -o pipefail',
            `cd "${resolvedPath}" || { echo "[deploy] ERROR: Cannot cd to ${resolvedPath}"; exit 1; }`,
            config.deployCommand
          ].join('\n') + '\n';

          // ── Write deploy script via SFTP ─────────────────────────────────
          const writeDeploy = sftp.createWriteStream(remoteDeployPath);
          writeDeploy.on('error', (e) => {
            logOutput += `[SSH Error] Failed to write deploy script: ${e.message}\n`;
            updateStatus('failed', logOutput);
            conn.end();
          });

          writeDeploy.on('finish', () => {
            logOutput += `[SSH] Script uploaded. Launching deployment synchronously...\n\n`;
            updateStatus('running', logOutput);

            // Execute the script directly and stream output back.
            // When done, it prints an exit code marker and cleans up.
            const command = `bash "${remoteDeployPath}"; CODE=$?; rm -f "${remoteDeployPath}"; echo ""; echo "---DEPLOY_EXIT:$CODE---"`;
            
            conn.exec(command, (execErr, stream) => {
                if (execErr) {
                  logOutput += `[SSH Error] Execution failed: ${execErr.message}\n`;
                  updateStatus('failed', logOutput);
                  conn.end();
                  return;
                }

                // Watchdog timeout
                const timeoutMs = (config.timeoutSeconds || 600) * 1000;
                const watchdog = setTimeout(() => {
                  logOutput += `\n[Timeout] Deployment exceeded ${timeoutMs / 1000}s. Terminating...\n`;
                  updateStatus('failed', logOutput).catch(() => {});
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

                  updateStatus('running', logOutput).catch(() => {});
                });

                stream.stderr.on('data', (data) => {
                  logOutput += data.toString();
                  updateStatus('running', logOutput).catch(() => {});
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
                  const status = finalCode === 0 ? 'success' : 'failed';

                  try { clearRunning(projectId); } catch (e) {}
                  updateStatus(status, logOutput).catch(() => {});
                  conn.end();
                });
              });
          });

          writeDeploy.write(deployScript);
          writeDeploy.end();
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
      commandPreview: config.deployCommand?.substring(0, 50)
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
    if (config.status === 'running') {
      const activeProcess = getRunning(projectId);
      if (!activeProcess) {
        console.log(`[webhook] Stale running state detected for project: ${projectId}. Resetting status and allowing new deployment.`);
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

    // 3. Signature verification for GitHub Webhook calls (when not a manual trigger)
    if (!isManual) {
      const githubEvent = request.headers.get('x-github-event');
      if (githubEvent === 'ping') {
        console.log(`[webhook] Received GitHub ping`);
        return NextResponse.json({ success: true, message: 'GitHub Ping received successfully' });
      }

      if (config.secret) {
        const signatureHeader = request.headers.get('x-hub-signature-256');
        if (!signatureHeader || !verifySignature(bodyText, config.secret, signatureHeader)) {
          console.log(`[webhook] Signature verification failed`);
          await updateDeployStatus(
            projectId,
            'failed',
            `[Webhook Error] Signature verification failed. Please check that the Secret configured on GitHub matches the Secret in the Auto Deploy settings.`
          );
          return NextResponse.json({ success: false, error: 'Invalid signature verification' }, { status: 401 });
        }
      }

      // Check push branch matches config
      try {
        const payload = JSON.parse(bodyText);
        if (payload.ref) {
          const rawBranch = String(config.branch || '').trim();
          const expectedRef = rawBranch
            ? (rawBranch.startsWith('refs/heads/') ? rawBranch : `refs/heads/${rawBranch}`)
            : null;
          console.log(`[webhook] Push ref: ${payload.ref}${expectedRef ? `, expected: ${expectedRef}` : ', no branch filter configured'}`);
          if (expectedRef && payload.ref !== expectedRef) {
            console.log(`[webhook] Branch mismatch - skipping deployment`);
            await updateDeployStatus(
              projectId,
              'idle',
              `[Webhook Skipped] Received GitHub push event for ref "${payload.ref}" but watched branch is configured as "${rawBranch}". Skipping deployment.`
            );
            return NextResponse.json({ 
              success: true, 
              message: `Ref ${payload.ref} does not match watched branch ${expectedRef}. Skipping deployment.` 
            });
          }
        }
      } catch (e) {
        console.log(`[webhook] Warning: Could not parse payload:`, e.message);
        await updateDeployStatus(
          projectId,
          'failed',
          `[Webhook Error] Failed to parse payload from GitHub request: ${e.message}`
        );
      }
    }

    // 4. Trigger the deployment in the background
    console.log(`[webhook] ✅ Triggering deployment for project: ${projectId}`);
    runDeployment(config).catch(err => {
      console.error('Unhandled background deployment error:', err.message);
    });

    return NextResponse.json({ 
      success: true, 
      message: isManual ? 'Manual deployment triggered successfully' : 'Auto deployment triggered by GitHub Webhook' 
    });

  } catch (error) {
    console.error('[deploy/webhook] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
