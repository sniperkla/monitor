import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { encrypt } from '@/utils/encryption';
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
  deployRunId: null,
  cancelRequested: false,
  aiProfile: null,
  aiLogs: [],
  aiModel: 'auto',
  aiCustomModel: '',
  aiEndpoint: '',
  aiApiKey: '',
  githubConnected: false,
  githubUser: ''
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

    await connectDB(process.env.MONGODB_URI, true);
    
    // Find all settings keys that start with auto_deploy_config
    const allSettings = await SystemSetting.find({
      key: { $regex: '^auto_deploy_config' }
    });

    // Parse all projects
    let projects = [];
    allSettings.forEach(s => {
      // Compatibility with old auto_deploy_config
      if (s.key === 'auto_deploy_config') {
        projects.push({ ...defaultConfig, ...s.value, id: 'default', name: s.value.name || 'Default Project' });
      } else {
        const id = s.key.replace('auto_deploy_config_', '');
        projects.push({ ...defaultConfig, ...s.value, id });
      }
    });

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

    await connectDB(process.env.MONGODB_URI, true);

    // Check for duplicate project name (if provided)
    if (body.name && body.name.trim()) {
      const allSettings = await SystemSetting.find({
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

    const existing = await SystemSetting.findOne({ key: dbKey });
    const existingValue = existing?.value || {};

    const targetType = body.targetType || existingValue.targetType || 'local';
    const normalizedConnectionId = typeof body.connectionId === 'string'
      ? body.connectionId.trim()
      : String(existingValue.connectionId || '').trim();

    let sshConnectionData = existingValue.sshConnectionData || null;

    if (targetType === 'ssh' && normalizedConnectionId && body.connectionId) {
      // Try to fetch and cache SSH connection details from user/main database
      let foundConnection = null;
      
      // Try user database first (with relay if available)
      try {
        const userDb = await connectDB(null, true);
        const userRepo = new ConnectionRepository(userDb);
        await userRepo.init();
        foundConnection = await userRepo.findById(normalizedConnectionId);
        console.log(`[deploy/config] Found SSH connection in user database: ${normalizedConnectionId}`);
      } catch (userErr) {
        console.log(`[deploy/config] User database lookup failed: ${userErr.message}`);
      }
      
      // Fall back to main database if not found in user DB
      if (!foundConnection) {
        try {
          const mainDb = await connectDB(process.env.MONGODB_URI, true);
          const mainRepo = new ConnectionRepository(mainDb);
          await mainRepo.init();
          foundConnection = await mainRepo.findById(normalizedConnectionId);
          console.log(`[deploy/config] Found SSH connection in main database: ${normalizedConnectionId}`);
        } catch (mainErr) {
          console.log(`[deploy/config] Main database lookup failed: ${mainErr.message}`);
        }
      }
      
      if (foundConnection) {
        // Store encrypted connection data in config for webhook use
        sshConnectionData = {
          id: foundConnection._id || foundConnection.id,
          host: foundConnection.host,
          port: foundConnection.port || 22,
          username: foundConnection.username || 'root',
          authType: foundConnection.authType,
          password: foundConnection.password || '', // Already encrypted if exists
          privateKey: foundConnection.privateKey || '', // Already encrypted if exists
          passphrase: foundConnection.passphrase || '' // Already encrypted if exists
        };
        console.log(`[deploy/config] Cached SSH connection data for ID: ${normalizedConnectionId}`);
      } else {
        // Don't fail - just warn and let webhook validate at execution time
        console.warn(`[deploy/config] Warning: SSH connection ${normalizedConnectionId} not found in any database. Will attempt to re-lookup at deployment time.`);
      }
    }

    const updatedValue = {
      id: projectId,
      name: body.name || existingValue.name || `Project ${projectId}`,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existingValue.enabled || false,
      branch: body.branch || existingValue.branch || 'main',
      secret: body.secret !== undefined ? body.secret : existingValue.secret || '',
      targetType: body.targetType || existingValue.targetType || 'local',
      connectionId: targetType === 'ssh' ? normalizedConnectionId : '',
      deployCommand: body.deployCommand !== undefined ? body.deployCommand : existingValue.deployCommand || '',
      projectPath: body.projectPath !== undefined ? body.projectPath : existingValue.projectPath || '.',
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
      cancelRequested: body.cancelRequested !== undefined ? body.cancelRequested : existingValue.cancelRequested || false,
      githubConnected: body.githubConnected !== undefined ? body.githubConnected : existingValue.githubConnected || false,
      githubUser: body.githubUser !== undefined ? body.githubUser : existingValue.githubUser || '',
      githubRepo: body.githubRepo !== undefined ? body.githubRepo : existingValue.githubRepo || '',
      githubToken: body.githubToken !== undefined && body.githubToken ? encrypt(body.githubToken) : existingValue.githubToken || '',
      sshConnectionData: sshConnectionData
    };

    await SystemSetting.findOneAndUpdate(
      { key: dbKey },
      { $set: { value: updatedValue } },
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

    await connectDB(process.env.MONGODB_URI, true);
    await SystemSetting.deleteOne({ key: `auto_deploy_config_${projectId}` });

    return NextResponse.json({ success: true, message: 'Project deployment config deleted' });
  } catch (error) {
    console.error('[deploy/config] DELETE error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
