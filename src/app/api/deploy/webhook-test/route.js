import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { Client } from 'ssh2';
import { resolveUserIdQuery, normalizeUserId } from '@/lib/deployUserQuery';
import { logger } from '@/lib/logger';

// POST /api/deploy/webhook-test?project=<projectId>
// Runs independent checks and returns structured results
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeUserId(session.user?.id || session.user?.sub || session.user?.email);

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project') || 'default';
    const token = searchParams.get('token');
    let dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    await connectDB(process.env.MONGODB_URI, true);
    let setting;
    if (token) {
      // Search only within requesting user's settings
      const userIdQuery = resolveUserIdQuery(userId);
      const allSettings = await SystemSetting.find({ ...userIdQuery, key: { $regex: '^auto_deploy_config' } });
      setting = allSettings.find(s => s.value?.webhookToken === token);
      if (!setting) {
        return NextResponse.json({ success: false, error: 'Invalid webhook token' }, { status: 404 });
      }
    } else {
      const userIdQuery = resolveUserIdQuery(userId);
      setting = await SystemSetting.findOne({ ...userIdQuery, key: dbKey });
    }
    const config = setting?.value;

    if (!config) {
      return NextResponse.json({ success: false, error: 'Project not configured' }, { status: 404 });
    }

    const checks = [];

    // 1. Config check
    const configIssues = [];
    if (!config.enabled) configIssues.push('auto-deploy is disabled');
    if (!config.deployCommand?.trim() || config.deployCommand.trim() === '# Enter your deployment shell script here\n# e.g., git pull && npm run build') {
      configIssues.push('deploy command is not set');
    }
    if (!config.branch?.trim()) configIssues.push('branch is not configured');
    if (config.targetType === 'ssh' && !config.connectionId) {
      configIssues.push('SSH connection is not selected');
    }

    checks.push({
      name: 'config',
      status: configIssues.length === 0 ? 'pass' : 'fail',
      message: configIssues.length === 0 ? 'Configuration is complete' : `Missing: ${configIssues.join(', ')}`
    });

    // 2. Git provider check
    if (config.githubConnected && config.githubToken) {
      try {
        let token;
        try { token = decrypt(config.githubToken); } catch { token = config.githubToken; }
        const ghRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'monitor-deploy'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (ghRes.ok) {
          const user = await ghRes.json();
          checks.push({
            name: 'git_provider',
            status: 'pass',
            message: `GitHub token valid (authenticated as ${user.login})`
          });
        } else {
          checks.push({
            name: 'git_provider',
            status: 'fail',
            message: `GitHub token invalid (HTTP ${ghRes.status})`
          });
        }
      } catch (err) {
        checks.push({
          name: 'git_provider',
          status: 'fail',
          message: `GitHub API error: ${err.message}`
        });
      }
    } else if (config.bitbucketConnected && (config.bitbucketUsername || config.bitbucketUser) && config.bitbucketAppPassword) {
      checks.push({
        name: 'git_provider',
        status: 'pass',
        message: `Bitbucket credentials stored for ${config.bitbucketUser || 'user'}`
      });
    } else {
      checks.push({
        name: 'git_provider',
        status: 'skip',
        message: 'No git provider connected'
      });
    }

    // 3. SSH connection check (if targetType is ssh)
    if (config.targetType === 'ssh' && config.connectionId) {
      try {
        const connectionId = String(config.connectionId).trim();
        let sshConnData = config.sshConnectionData;

        if (!sshConnData || !sshConnData.host) {
          const db = await connectDB(process.env.MONGODB_URI, true);
          const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);
          await repo.init();
          const connection = await repo.findById(connectionId);
          if (!connection) {
            checks.push({
              name: 'ssh_connection',
              status: 'fail',
              message: `SSH connection ID ${connectionId} not found`
            });
          } else {
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
        }

        if (sshConnData && sshConnData.host) {
          const sshConfig = {
            host: sshConnData.host,
            port: sshConnData.port || 22,
            username: sshConnData.username || 'root',
            readyTimeout: 10000,
          };

          if (sshConnData.authType === 'password' && sshConnData.password) {
            try {
              let decrypted = decrypt(sshConnData.password);
              if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
                const test = decrypt(decrypted);
                if (test && !test.includes(':')) decrypted = test;
              }
              sshConfig.password = decrypted;
            } catch { sshConfig.password = sshConnData.password; }
          } else if (sshConnData.authType === 'privateKey' && sshConnData.privateKey) {
            try {
              let decrypted = decrypt(sshConnData.privateKey);
              if (decrypted && decrypted.includes(':') && decrypted.length > 40) {
                const test = decrypt(decrypted);
                if (test && !test.includes(':')) decrypted = test;
              }
              sshConfig.privateKey = decrypted;
            } catch { sshConfig.privateKey = sshConnData.privateKey; }
            if (sshConnData.passphrase) {
              try {
                let dec = decrypt(sshConnData.passphrase);
                if (dec && dec.includes(':') && dec.length > 40) {
                  const test = decrypt(dec);
                  if (test && !test.includes(':')) dec = test;
                }
                sshConfig.passphrase = dec;
              } catch { sshConfig.passphrase = sshConnData.passphrase; }
            }
          }

          // Quick connect + disconnect test
          const sshResult = await new Promise((resolve) => {
            const conn = new Client();
            const timeout = setTimeout(() => {
              try { conn.end(); } catch {}
              resolve({ ok: false, message: 'SSH connection timed out (10s)' });
            }, 10000);

            conn.on('ready', () => {
              clearTimeout(timeout);
              conn.end();
              resolve({ ok: true, message: `Connected to ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}` });
            });

            conn.on('error', (err) => {
              clearTimeout(timeout);
              resolve({ ok: false, message: `SSH error: ${err.message}` });
            });

            try {
              conn.connect(sshConfig);
            } catch (err) {
              clearTimeout(timeout);
              resolve({ ok: false, message: `SSH connect failed: ${err.message}` });
            }
          });

          checks.push({
            name: 'ssh_connection',
            status: sshResult.ok ? 'pass' : 'fail',
            message: sshResult.message
          });
        }
      } catch (err) {
        checks.push({
          name: 'ssh_connection',
          status: 'fail',
          message: `SSH check error: ${err.message}`
        });
      }
    } else {
      checks.push({
        name: 'ssh_connection',
        status: 'skip',
        message: 'Target is local host'
      });
    }

    const allPassed = checks.every(c => c.status === 'pass' || c.status === 'skip');

    return NextResponse.json({ success: true, allPassed, checks });
  } catch (error) {
    logger.error('[deploy/webhook-test] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
