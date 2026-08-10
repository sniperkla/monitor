import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import crypto from 'crypto';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { encrypt, decryptWithMetadata } from '@/utils/encryption';
import SystemSetting from '@/models/SystemSetting';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';

const defaultConfig = {
  id: 'default',
  name: 'Default Project',
  enabled: false,
  branch: '',
  secret: '',
  targetType: 'local',
  connectionId: '',
  deployCommand: '# Enter your deployment shell script here\n# e.g., git pull && npm run build\n',
  projectPath: '.',
  status: 'idle',
  lastDeployLog: '',
  lastDeployAt: null,
  lastDeployedCommitSha: null,
  deployRunId: null,
  cancelRequested: false,
  aiProfile: null,
  aiLogs: [],
  aiModel: 'auto',
  aiCustomModel: '',
  aiEndpoint: '',
  aiApiKey: '',
  githubConnected: false,
  githubUser: '',
  bitbucketConnected: false,
  bitbucketUser: '',
  telegramNotification: false,
  telegramBotToken: '',
  telegramChatId: '',
  webhookToken: ''
};

// GET /api/deploy/config?project=id
// If ?project is not specified or set to "list", returns the list of all deployment projects.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project');

    const rawUserId = session.user?.id || session.user?.sub;
    // Support both BSON ObjectId (stored in DB) and plain string ID from session
    const objectId = (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId))
      ? new mongoose.Types.ObjectId(rawUserId)
      : null;
    // Include all possible ID forms so query matches regardless of storage format
    const userKeys = [...new Set([objectId, rawUserId, session.user?.email].filter(Boolean))];
    const userId = objectId || rawUserId || session.user?.email || 'global';

    await connectDB(process.env.MONGODB_URI, true);
    
    // Find settings keys that start with auto_deploy_config for this user (or global fallback)
    const rawSettings = await SystemSetting.find({
      userId: { $in: [...userKeys, 'global'] },
      key: { $regex: '^auto_deploy_config' }
    });

    // Deduplicate by project key
    const settingsMap = new Map();
    rawSettings.forEach(s => {
      if (!settingsMap.has(s.key)) {
        settingsMap.set(s.key, s);
      }
    });
    const allSettings = Array.from(settingsMap.values());

    // Parse all projects
    let projects = [];
    const needsTokenUpdate = [];
    allSettings.forEach(s => {
      // Compatibility with old auto_deploy_config
      if (s.key === 'auto_deploy_config') {
        const proj = { ...defaultConfig, ...s.value, id: 'default', name: s.value.name || 'Default Project' };
        if (!proj.webhookToken) {
          proj.webhookToken = crypto.randomUUID();
          needsTokenUpdate.push({ key: s.key, token: proj.webhookToken });
        }
        projects.push(proj);
      } else {
        const id = s.key.replace('auto_deploy_config_', '');
        const proj = { ...defaultConfig, ...s.value, id };
        if (!proj.webhookToken) {
          proj.webhookToken = crypto.randomUUID();
          needsTokenUpdate.push({ key: s.key, token: proj.webhookToken });
        }
        projects.push(proj);
      }
    });

    // Auto-assign webhook tokens for existing projects that don't have one
    if (needsTokenUpdate.length > 0) {
      for (const { key, token } of needsTokenUpdate) {
        await SystemSetting.findOneAndUpdate(
          { key },
          { $set: { 'value.webhookToken': token } }
        );
      }
    }

    // Ensure we have at least one project
    if (projects.length === 0) {
      projects.push(defaultConfig);
    }

    // If requesting a specific project
    if (projectId && projectId !== 'list') {
      const proj = projects.find(p => p.id === projectId);
      return NextResponse.json({
        success: true,
        config: proj || { ...defaultConfig, id: projectId, name: `Project ${projectId}` }
      });
    }

    return NextResponse.json({
      success: true,
      projects
    });
  } catch (error) {
    console.error('[deploy/config] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/deploy/config
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const projectId = body.id || 'default';
    const dbKey = projectId === 'default' ? 'auto_deploy_config' : `auto_deploy_config_${projectId}`;

    const targetType = body.targetType || 'local';
    const normalizedConnectionId = typeof body.connectionId === 'string'
      ? body.connectionId.trim()
      : '';

    let sshConnectionData = null;

    // IMPORTANT: Look up SSH connections BEFORE connecting to main DB
    // This ensures we can access relay/user database connections
    if (targetType === 'ssh' && normalizedConnectionId && body.connectionId) {
      try {
        console.log(`[deploy/config] Looking up SSH connection from user database: ${normalizedConnectionId}`);
        const userDb = await connectDB();
        const userRepo = new ConnectionRepository(userDb);
        await userRepo.init();
        const connection = await userRepo.findById(normalizedConnectionId);
        
        if (connection) {
          sshConnectionData = {
            id: connection._id || connection.id,
            host: connection.host,
            port: connection.port || 22,
            username: connection.username || 'root',
            authType: connection.authType,
            password: connection.password || '',
            privateKey: connection.privateKey || '',
            passphrase: connection.passphrase || ''
          };
          console.log(`[deploy/config] ✅ Found SSH connection in user database: ${normalizedConnectionId}`);
        } else {
          console.log(`[deploy/config] ⚠️ SSH connection not found in user database: ${normalizedConnectionId}`);
        }
      } catch (err) {
        console.log(`[deploy/config] ⚠️ Failed to lookup SSH connection from user DB: ${err.message}`);
      }
    }

    const userId = session.user?.id || session.user?.sub || session.user?.email || 'global';

    // NOW connect to main database for saving deployment config
    await connectDB(process.env.MONGODB_URI, true);

    // Check for duplicate project name (for this user)
    if (body.name && body.name.trim()) {
      const allSettings = await SystemSetting.find({
        userId,
        key: { $regex: '^auto_deploy_config' }
      });
      
      const duplicateProject = allSettings.find(s => 
        s.value?.name === body.name.trim() && s.key !== dbKey
      );
      
      if (duplicateProject) {
        return NextResponse.json({ 
          success: false, 
          error: `Project name "${body.name}" already exists. Please use a unique name or leave it empty.` 
        }, { status: 400 });
      }
    }

    const existing = await SystemSetting.findOne({ userId, key: dbKey });
    const existingValue = existing?.value || {};

    // Generate webhookToken for new projects or existing ones without one
    const webhookToken = existingValue.webhookToken || crypto.randomUUID();

    // Determine final values for this save
    const finalTargetType = body.targetType !== undefined ? body.targetType : (existingValue.targetType || 'local');
    const finalConnectionId = body.connectionId !== undefined ? (typeof body.connectionId === 'string' ? body.connectionId.trim() : '') : String(existingValue.connectionId || '').trim();

    // Use cached connection data if available, otherwise use existing data
    // Only encrypt if values are plaintext (not already encrypted from Connection model)
    let finalSshConnectionData = sshConnectionData || existingValue.sshConnectionData || null;
    if (finalSshConnectionData) {
      const encryptIfNeeded = (value) => {
        if (!value) return '';
        // Check if already encrypted (contains colons like "iv_hex:ciphertext_hex")
        if (typeof value === 'string' && value.includes(':')) {
          const test = decryptWithMetadata(value);
          if (test.success) return value; // Already encrypted, keep as-is
        }
        return encrypt(value); // Plaintext, encrypt it
      };

      finalSshConnectionData = {
        ...finalSshConnectionData,
        password: encryptIfNeeded(finalSshConnectionData.password),
        privateKey: encryptIfNeeded(finalSshConnectionData.privateKey),
        passphrase: encryptIfNeeded(finalSshConnectionData.passphrase),
      };
    }

    const updatedValue = {
      id: projectId,
      name: body.name || existingValue.name || `Project ${projectId}`,
      webhookToken,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existingValue.enabled || false,
      branch: body.branch || existingValue.branch || 'main',
      secret: body.secret !== undefined ? body.secret : existingValue.secret || '',
      targetType: finalTargetType,
      connectionId: finalTargetType === 'ssh' ? finalConnectionId : '',
      deployCommand: body.deployCommand !== undefined ? body.deployCommand : existingValue.deployCommand || '',
      projectPath: body.projectPath !== undefined ? body.projectPath : existingValue.projectPath || '.',
      timeoutSeconds: body.timeoutSeconds !== undefined ? Math.max(30, Math.min(3600, Number(body.timeoutSeconds) || 600)) : (existingValue.timeoutSeconds || 600),
      status: body.status || existingValue.status || 'idle',
      lastDeployLog: body.lastDeployLog !== undefined ? body.lastDeployLog : existingValue.lastDeployLog || '',
      lastDeployAt: body.lastDeployAt !== undefined ? body.lastDeployAt : existingValue.lastDeployAt || null,
      aiProfile: body.aiProfile !== undefined ? body.aiProfile : existingValue.aiProfile || null,
      aiLogs: body.aiLogs !== undefined ? body.aiLogs : existingValue.aiLogs || [],
      aiModel: body.aiModel !== undefined ? body.aiModel : existingValue.aiModel || 'auto',
      aiCustomModel: body.aiCustomModel !== undefined ? body.aiCustomModel : existingValue.aiCustomModel || '',
      aiEndpoint: body.aiEndpoint !== undefined ? body.aiEndpoint : existingValue.aiEndpoint || '',
      aiApiKey: body.aiApiKey !== undefined ? body.aiApiKey : existingValue.aiApiKey || '',
      deployRunId: body.deployRunId !== undefined ? body.deployRunId : existingValue.deployRunId || null,
      lastDeployedCommitSha: body.lastDeployedCommitSha !== undefined ? body.lastDeployedCommitSha : existingValue.lastDeployedCommitSha || null,
      cancelRequested: body.cancelRequested !== undefined ? body.cancelRequested : existingValue.cancelRequested || false,
      githubConnected: body.githubConnected !== undefined ? body.githubConnected : existingValue.githubConnected || false,
      githubUser: body.githubUser !== undefined ? body.githubUser : existingValue.githubUser || '',
      githubRepo: body.githubRepo !== undefined ? body.githubRepo : existingValue.githubRepo || '',
      githubToken: (() => {
        if (body.githubToken !== undefined && body.githubToken) {
          // Only encrypt if not already encrypted (encrypted values contain ':')
          const test = decryptWithMetadata(body.githubToken);
          return test.success ? body.githubToken : encrypt(body.githubToken);
        }
        return existingValue.githubToken || '';
      })(),
      bitbucketConnected: body.bitbucketConnected !== undefined ? body.bitbucketConnected : existingValue.bitbucketConnected || false,
      bitbucketUser: body.bitbucketUser !== undefined ? body.bitbucketUser : existingValue.bitbucketUser || '',
      bitbucketUsername: body.bitbucketUsername !== undefined ? body.bitbucketUsername : existingValue.bitbucketUsername || '',
      bitbucketAppPassword: body.bitbucketAppPassword !== undefined ? body.bitbucketAppPassword : existingValue.bitbucketAppPassword || '',
      bitbucketRepo: body.bitbucketRepo !== undefined ? body.bitbucketRepo : existingValue.bitbucketRepo || '',
      telegramNotification: typeof body.telegramNotification === 'boolean' ? body.telegramNotification : existingValue.telegramNotification || false,
      telegramBotToken: (() => {
        if (body.telegramBotToken !== undefined && body.telegramBotToken) {
          // Only encrypt if not already encrypted (encrypted values contain ':')
          const test = decryptWithMetadata(body.telegramBotToken);
          return test.success ? body.telegramBotToken : encrypt(body.telegramBotToken);
        }
        return body.telegramBotToken !== undefined ? '' : existingValue.telegramBotToken || '';
      })(),
      telegramChatId: body.telegramChatId !== undefined ? body.telegramChatId : existingValue.telegramChatId || '',
      sshConnectionData: finalSshConnectionData
    };

    const rawUserId = session.user?.id || session.user?.sub;
    const targetUserId = (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId))
      ? new mongoose.Types.ObjectId(rawUserId)
      : (rawUserId || session.user?.email || 'global');

    await SystemSetting.findOneAndUpdate(
      { userId: targetUserId, key: dbKey },
      { $set: { userId: targetUserId, key: dbKey, value: updatedValue } },
      { upsert: true, runValidators: false }
    );

    return NextResponse.json({ success: true, config: updatedValue });
  } catch (error) {
    console.error('[deploy/config] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/deploy/config?project=id
export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project');

    if (!projectId || projectId === 'default') {
      return NextResponse.json({ success: false, error: 'Cannot delete the default project configuration' }, { status: 400 });
    }

    const rawUserId = session.user?.id || session.user?.sub;
    const objectId = (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId))
      ? new mongoose.Types.ObjectId(rawUserId)
      : null;
    const userKeys = [...new Set([objectId, rawUserId, session.user?.email].filter(Boolean))];

    await connectDB(process.env.MONGODB_URI, true);
    await SystemSetting.deleteOne({ userId: { $in: userKeys }, key: `auto_deploy_config_${projectId}` });

    return NextResponse.json({ success: true, message: 'Project deployment config deleted' });
  } catch (error) {
    console.error('[deploy/config] DELETE error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
