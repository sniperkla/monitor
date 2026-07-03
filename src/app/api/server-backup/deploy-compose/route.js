import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import crypto from 'crypto';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceConnectionId, composeFilePath, targetConnectionId } = body;

    if (!sourceConnectionId || !composeFilePath || !targetConnectionId) {
      return NextResponse.json({ success: false, error: 'Missing sourceConnectionId, composeFilePath, or targetConnectionId' }, { status: 400 });
    }

    const deployId = crypto.randomUUID().substring(0, 8);
    const sourceSshConfig = await getSshConfig(sourceConnectionId);
    const targetSshConfig = await getSshConfig(targetConnectionId);

    // 1. Read the compose file from source server
    console.log(`[deploy-compose] Reading compose file from source: ${composeFilePath}`);
    const readResult = await execCommand(sourceSshConfig, `cat '${composeFilePath}'`);

    if (readResult.code !== 0) {
      return NextResponse.json({ success: false, error: `Failed to read compose file: ${readResult.stderr}` }, { status: 400 });
    }

    const composeContent = readResult.stdout;
    if (!composeContent.trim()) {
      return NextResponse.json({ success: false, error: 'Compose file is empty' }, { status: 400 });
    }

    // 2. Check for .env file in the same directory
    const composeDir = composeFilePath.substring(0, composeFilePath.lastIndexOf('/')) || '/tmp';
    let envContent = '';
    const envResult = await execCommand(sourceSshConfig, `cat '${composeDir}/.env' 2>/dev/null || true`);
    if (envResult.code === 0 && envResult.stdout.trim()) {
      envContent = envResult.stdout;
    }

    // 3. Deploy on target server
    const targetPath = `/tmp/docker_deploy_${deployId}`;
    const composeFileName = composeFilePath.split('/').pop();

    // Build the deploy script
    let deployScript = `#!/bin/bash
set -e
DOCKER="docker"
COMPOSE="docker compose"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="sudo docker-compose"
  fi
fi

LOG=""
log() { echo "[deploy] $1"; LOG="$LOG\\n$1"; }

# Create temp directory
mkdir -p ${targetPath}
cd ${targetPath}

log "Compose file transferred to target server"
log "File: ${targetPath}/${composeFileName}"

# Pull images first
log "Pulling images..."
$COMPOSE pull 2>&1 | while read line; do log "  $line"; done

# Stop existing containers if any
log "Stopping existing containers..."
$COMPOSE down 2>/dev/null || true

# Start containers
log "Starting containers..."
$COMPOSE up -d 2>&1 | while read line; do log "  $line"; done

log "Containers started successfully"

# List running containers
log "Running containers:"
$COMPOSE ps 2>&1 | while read line; do log "  $line"; done

# Cleanup
log "Cleaning up temporary files..."
rm -rf ${targetPath}

log "Compose deployment complete!"
echo "---RESULT---"
echo "$LOG"
echo "---END---"
`;

    // Write compose file to target
    const writeComposeCmd = `mkdir -p ${targetPath} && cat > ${targetPath}/${composeFileName} <<'COMPOSE_EOF'\n${composeContent}\nCOMPOSE_EOF`;
    await execCommand(targetSshConfig, writeComposeCmd);

    // Write .env file if exists
    if (envContent) {
      const writeEnvCmd = `cat > ${targetPath}/.env <<'ENV_EOF'\n${envContent}\nENV_EOF`;
      await execCommand(targetSshConfig, writeEnvCmd);
    }

    // Write and execute the deploy script
    const scriptPath = `/tmp/docker_deploy_${deployId}.sh`;
    const writeScriptCmd = `cat > ${scriptPath} <<'DEPLOY_EOF'\n${deployScript}\nDEPLOY_EOF\nchmod +x ${scriptPath}`;
    await execCommand(targetSshConfig, writeScriptCmd);

    const result = await execCommand(targetSshConfig, `bash ${scriptPath} 2>&1; echo "EXIT_CODE=$?"`);

    const exitCode = result.stdout.match(/EXIT_CODE=(\d+)/)?.[1];
    const resultLog = result.stdout.match(/---RESULT---\n([\s\S]*?)---END---/)?.[1]?.trim();

    // Cleanup script
    await execCommand(targetSshConfig, `rm -f ${scriptPath} 2>/dev/null; rm -rf ${targetPath} 2>/dev/null`);

    return NextResponse.json({
      success: exitCode === '0',
      logs: resultLog || result.stdout,
      exitCode: parseInt(exitCode || '1'),
    });

  } catch (error) {
    console.error('[deploy-compose] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
