import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import crypto from 'crypto';
import { spawn, exec } from 'child_process';
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

// Get the appropriate shell command for the platform
function getShellCommand() {
  if (process.platform === 'win32') {
    return { shell: 'cmd.exe', arg: '/c' };
  }
  // For macOS, Linux, etc.
  return { shell: 'bash', arg: '-c' };
}

// Background deployment execution
async function runDeployment(config) {
  const startedAt = new Date();
  const projectId = config.id || 'default';
  const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

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

    // Get platform-appropriate shell
    const { shell, arg } = getShellCommand();

    // Use spawn with detected shell to stream output and avoid exec buffer hangs
    const childProcess = spawn(shell, [arg, config.deployCommand], { cwd: cwdPath, stdio: 'pipe' });

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
      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      await repo.init();
      
      const connectionId = String(config.connectionId || '').trim();
      if (!connectionId) {
        throw new Error('SSH target is configured but no connection ID was provided. Please select a valid SSH connection in deployment settings.');
      }

      const connection = await repo.findById(connectionId);
      if (!connection) {
        const detail = repo.isSql
          ? 'This may be a stale or incompatible SSH connection ID for the configured database backend.'
          : 'Please verify the selected SSH connection still exists.';
        throw new Error(`SSH connection with ID ${connectionId} not found in database. ${detail}`);
      }

      // Build SSH connection config
      const sshConfig = {
        host: connection.host,
        port: connection.port || 22,
        username: connection.username || 'root',
        readyTimeout: 20000,
      };

      if (connection.authType === 'password') {
        sshConfig.password = decrypt(connection.password);
      } else if (connection.authType === 'privateKey') {
        sshConfig.privateKey = decrypt(connection.privateKey);
        if (connection.passphrase) {
          sshConfig.passphrase = decrypt(connection.passphrase);
        }
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
        logOutput += `[SSH] Connected successfully. Executing deployment script inside "${resolvedPath}"...\n\n`;
        updateStatus('running', logOutput);

        // Chain directory change with deployment script
        const fullSshCommand = `cd ${resolvedPath} && (${config.deployCommand})`;

        conn.exec(fullSshCommand, (err, stream) => {
          if (err) {
            logOutput += `[SSH Error] Failed to execute script: ${err.message}\n`;
            updateStatus('failed', logOutput);
            conn.end();
            return;
          }

          stream.on('data', (data) => {
            logOutput += data.toString();
            updateStatus('running', logOutput);
          });

          stream.stderr.on('data', (data) => {
            logOutput += data.toString();
            updateStatus('running', logOutput);
          });

          stream.on('close', (code, signal) => {
            const finishedAt = new Date();
            logOutput += `\n--------------------------------------------------\n`;
            logOutput += `[${finishedAt.toISOString()}] [SSH] Execution finished. Exit code: ${code}\n`;
            const status = code === 0 ? 'success' : 'failed';
            try { clearRunning(projectId); } catch (e) {}
            updateStatus(status, logOutput);
            conn.end();
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

      const db = await connectDB(process.env.MONGODB_URI, true);
      const repo = new ConnectionRepository(db);
      await repo.init();
      const connection = await repo.findById(connectionId);
      if (!connection) {
        console.log(`[webhook] ❌ SSH connection ID ${connectionId} not found`);
        return NextResponse.json({ success: false, error: `SSH connection with ID ${connectionId} configured for project "${projectId}" does not exist. Please select a valid SSH connection.` }, { status: 400 });
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
            return NextResponse.json({ 
              success: true, 
              message: `Ref ${payload.ref} does not match watched branch ${expectedRef}. Skipping deployment.` 
            });
          }
        }
      } catch (e) {
        console.log(`[webhook] Warning: Could not parse payload:`, e.message);
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
