import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

/**
 * Map app names to their service names
 */
const SERVICE_MAP = {
  'docker': 'docker',
  'nginx': 'nginx',
  'mongodb': 'mongod',
  'mysql / mariadb': 'mysql',
  'mysql': 'mysql',
  'mariadb': 'mariadb',
  'postgresql': 'postgresql',
  'redis': 'redis-server',
};

/**
 * Generate command based on action
 */
function getActionCommand(appName, action) {
  const serviceName = SERVICE_MAP[appName.toLowerCase()] || appName.toLowerCase();
  
  // Try systemctl first, then fall back to service command
  const systemctlCmd = `sudo systemctl ${action} ${serviceName} 2>&1 || systemctl ${action} ${serviceName} 2>&1`;
  const serviceCmd = `sudo service ${serviceName} ${action} 2>&1 || service ${serviceName} ${action} 2>&1`;
  
  switch (action) {
    case 'start':
    case 'stop':
    case 'restart':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          ${systemctlCmd}
        else
          ${serviceCmd}
        fi
      `;
      
    case 'status':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl status ${serviceName} 2>&1 || systemctl status ${serviceName} 2>&1
        else
          sudo service ${serviceName} status 2>&1 || service ${serviceName} status 2>&1
        fi
      `;
      
    case 'enable':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl enable ${serviceName} 2>&1 || systemctl enable ${serviceName} 2>&1
        else
          echo "Enable action not supported without systemd"
          exit 1
        fi
      `;
      
    case 'disable':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl disable ${serviceName} 2>&1 || systemctl disable ${serviceName} 2>&1
        else
          echo "Disable action not supported without systemd"
          exit 1
        fi
      `;
      
    case 'update':
      // Package manager agnostic update
      return `
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update && sudo apt-get install --only-upgrade ${serviceName} -y 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum update ${serviceName} -y 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf update ${serviceName} -y 2>&1
        elif command -v pacman >/dev/null 2>&1; then
          sudo pacman -Syu ${serviceName} --noconfirm 2>&1
        elif command -v brew >/dev/null 2>&1; then
          brew upgrade ${serviceName} 2>&1
        else
          echo "No supported package manager found"
          exit 1
        fi
      `;
      
    case 'uninstall':
      // Package manager agnostic uninstall
      return `
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get remove ${serviceName} -y 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum remove ${serviceName} -y 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf remove ${serviceName} -y 2>&1
        elif command -v pacman >/dev/null 2>&1; then
          sudo pacman -R ${serviceName} --noconfirm 2>&1
        elif command -v brew >/dev/null 2>&1; then
          brew uninstall ${serviceName} 2>&1
        else
          echo "No supported package manager found"
          exit 1
        fi
      `;
      
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { connectionId, appName, action } = body;

    if (!connectionId || !appName || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: connectionId, appName, action' },
        { status: 400 }
      );
    }

    // Validate action
    const validActions = ['start', 'stop', 'restart', 'status', 'enable', 'disable', 'update', 'uninstall'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    // Get SSH config and execute command
    const sshConfig = await getSshConfig(connectionId);
    const command = getActionCommand(appName, action);
    
    logger.info(`[server-monitor/app-action] Executing ${action} for ${appName}`);
    
    const result = await execCommand(sshConfig, command);

    logger.info(`[server-monitor/app-action] Result:`, {
      code: result.code,
      stdoutLength: result.stdout?.length || 0,
      stderrLength: result.stderr?.length || 0
    });

    // Consider success if exit code is 0 or if stdout contains success indicators
    const output = (result.stdout || '') + (result.stderr || '');
    const success = result.code === 0 || 
                   output.includes('Started') || 
                   output.includes('Stopped') ||
                   output.includes('active (running)') ||
                   output.includes('success');

    const responseBody = {
      success,
      action,
      appName,
      output: output.trim(),
      exitCode: result.code
    };

    if (!success) {
      // Provide a readable error from the command output so the UI never shows "undefined"
      const firstLine = output.trim().split('\n').find(l => l.trim()) || '';
      responseBody.error = firstLine || `Command exited with code ${result.code}`;
    }

    return NextResponse.json(responseBody);

  } catch (error) {
    logger.error('[server-monitor/app-action] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
