import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand, sftpTransfer } from '../_ssh';
import { resolveBackupPath } from '../_history';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceConnectionId, sourceFilePath, sourceFileRef, targetConnectionId, dryRun } = body;

    if (!sourceConnectionId || !targetConnectionId) {
      return NextResponse.json({ success: false, error: 'Missing sourceConnectionId or targetConnectionId' }, { status: 400 });
    }

    // A history-backed source is addressed by opaque ref (the browser no
    // longer holds the remote path); an explicit path is still accepted for
    // files picked through the server browser.
    let resolvedSourcePath = sourceFilePath || null;
    if (!resolvedSourcePath && sourceFileRef) {
      resolvedSourcePath = await resolveBackupPath(session.user.id, {
        connectionId: sourceConnectionId,
        fileRef: sourceFileRef,
      });
      if (!resolvedSourcePath) {
        return NextResponse.json({ success: false, error: 'Source backup not found' }, { status: 404 });
      }
    }
    if (!resolvedSourcePath) {
      return NextResponse.json({ success: false, error: 'Missing sourceFilePath or sourceFileRef' }, { status: 400 });
    }

    const restoreId = crypto.randomUUID().substring(0, 8);
    const sourceSshConfig = await getSshConfig(sourceConnectionId);
    const targetSshConfig = await getSshConfig(targetConnectionId);
    const remotePath = `/tmp/docker_restore_${restoreId}.tar.gz`;
    const extractPath = `/tmp/docker_restore_${restoreId}`;

    // 1. High-Speed Direct Stream from source server to target server (0 temporary disk space needed)
    logger.info(`[restore-docker] High-speed direct streaming ${resolvedSourcePath} from source to target...`);
    await sftpTransfer(sourceSshConfig, resolvedSourcePath, targetSshConfig, remotePath);

    // 2. Extract and discover what's inside
    const discoverCmd = `
set -e
DOCKER="docker"; if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
mkdir -p ${extractPath}
tar -xzf ${remotePath} -C ${extractPath}

echo "---DISCOVERY---"
echo "HAS_IMAGES=$([ -f ${extractPath}/images.tar.gz ] && echo yes || echo no)"
echo "VOLUME_TARS=$(ls ${extractPath}/vol_*.tar 2>/dev/null | wc -l)"
echo "INSPECT_FILES=$(ls ${extractPath}/inspect_*.json 2>/dev/null | wc -l)"
echo "HAS_COMPOSE=$([ -f ${extractPath}/docker-compose.yml ] || [ -f ${extractPath}/docker-compose.yaml ] || [ -f ${extractPath}/compose.yml ] || [ -f ${extractPath}/compose.yaml ] && echo yes || echo no)"
echo "INSPECT_LIST=$(ls ${extractPath}/inspect_*.json 2>/dev/null | xargs -I{} basename {} .json | sed 's/inspect_//' | tr '\\n' ',')"
echo "VOLUME_LIST=$(ls ${extractPath}/vol_*.tar 2>/dev/null | xargs -I{} basename {} .tar | sed "s/vol_[^_]*_//" | tr '\\n' ',')"
echo "---END---"
`;
    const discovery = await execCommand(targetSshConfig, discoverCmd);

    // Parse discovery output
    const output = discovery.stdout;
    const hasImages = output.includes('HAS_IMAGES=yes');
    const volumeCount = parseInt(output.match(/VOLUME_TARS=(\d+)/)?.[1] || '0');
    const inspectCount = parseInt(output.match(/INSPECT_FILES=(\d+)/)?.[1] || '0');
    const hasCompose = output.includes('HAS_COMPOSE=yes');
    const inspectList = (output.match(/INSPECT_LIST=(.*)/)?.[1] || '').split(',').filter(Boolean);
    const volumeList = (output.match(/VOLUME_LIST=(.*)/)?.[1] || '').split(',').filter(Boolean);

    if (inspectCount === 0 && !hasCompose) {
      return NextResponse.json({
        success: false,
        error: 'No Docker containers or compose files found in backup'
      }, { status: 400 });
    }

    // 3. Build the restore script
    let restoreScript = `#!/bin/bash
set -e
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
LOG=""
log() { echo "[restore] $1"; LOG="$LOG\\n$1"; }

`;

    // Load images first
    if (hasImages) {
      restoreScript += `
log "Loading Docker images..."
$DOCKER load -i ${extractPath}/images.tar.gz 2>&1 | while read line; do log "  $line"; done
log "Images loaded."
`;
    }

    // Restore volumes
    if (volumeCount > 0) {
      restoreScript += `
log "Restoring ${volumeCount} volume(s)..."
for VOL_TAR in ${extractPath}/vol_*.tar; do
  VOL_NAME=$(basename "$VOL_TAR" .tar | sed "s/vol_[^_]*_//")
  log "  Creating volume: $VOL_NAME"
  $DOCKER volume create "$VOL_NAME" 2>/dev/null || true
  $DOCKER run --rm -v "$VOL_NAME":/dst -v "$(dirname "$VOL_TAR")":/src alpine sh -c "cd /dst && tar xf /src/$(basename "$VOL_TAR") --strip-components=0" 2>&1
  log "  Volume $VOL_NAME restored."
done
`;
    }

    // Recreate containers from inspect data
    if (inspectCount > 0) {
      restoreScript += `
log "Recreating ${inspectCount} container(s)..."
`;
      for (const name of inspectList) {
        // Docker container names are restricted to this character set. Reject
        // archive-controlled names outside it before embedding them into the
        // generated shell script and file paths.
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) continue;
        restoreScript += `
# --- Container: ${name} ---
if [ -f ${extractPath}/inspect_${name}.json ]; then
  OLD_STATE=$($DOCKER inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || echo "missing")
  if [ "$OLD_STATE" != "missing" ]; then
    log "  Stopping existing container: ${name}"
    $DOCKER stop "${name}" 2>/dev/null || true
    $DOCKER rm "${name}" 2>/dev/null || true
  fi

  # Extract config from inspect JSON
  IMAGE=$($DOCKER inspect -f '{{.Config.Image}}' "${name}" 2>/dev/null || cat ${extractPath}/inspect_${name}.json | grep -o '"Image": *"[^"]*"' | head -1 | sed 's/"Image": *"//;s/"//')
  if [ -z "$IMAGE" ]; then
    log "  WARNING: Could not determine image for ${name}, skipping."
  else
    # Check if image exists locally
    if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
      log "  Image $IMAGE not found locally, attempting pull..."
      $DOCKER pull "$IMAGE" 2>&1 | tail -1
    fi

    # Build docker run arguments as a Bash array. The backup archive controls
    # every value below, so never concatenate them into a command string or use
    # eval: env values, bind paths, image names, and commands may contain shell
    # metacharacters.
    INSPECT_FILE="${extractPath}/inspect_${name}.json"
    RUN_ARGS=()
    while IFS= read -r -d '' ARG; do RUN_ARGS+=("$ARG"); done < <(python3 - "$INSPECT_FILE" <<'PY'
import json, sys

def emit(value):
    sys.stdout.buffer.write(str(value).encode('utf-8', 'surrogateescape') + b'\0')

with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
config = data.get('Config', {}) or {}
host = data.get('HostConfig', {}) or {}
for value in config.get('Env', []) or []:
    if value and not value.startswith('PATH='):
        emit('-e'); emit(value)
for container_port, bindings in (host.get('PortBindings', {}) or {}).items():
    cp = str(container_port).split('/')[0]
    for binding in bindings or []:
        hp = binding.get('HostPort', '')
        hip = binding.get('HostIp', '0.0.0.0')
        if hp:
            emit('-p'); emit(f'{hip}:{hp}:{cp}' if hip and hip != '0.0.0.0' else f'{hp}:{cp}')
for value in host.get('Binds', []) or []:
    if value:
        emit('-v'); emit(value)
for mount in data.get('Mounts', []) or []:
    if mount.get('Type') == 'volume' and mount.get('Name') and mount.get('Destination'):
        emit('-v'); emit(f"{mount['Name']}:{mount['Destination']}")
network = host.get('NetworkMode', 'default')
if network and network != 'default':
    emit('--network'); emit(network)
restart = host.get('RestartPolicy', {}) or {}
restart_name = restart.get('Name', 'no')
if restart_name and restart_name != 'no':
    value = restart_name
    if restart.get('MaximumRetryCount', 0):
        value = f"{value}:{restart['MaximumRetryCount']}"
    emit('--restart'); emit(value)
hostname = config.get('Hostname', '')
if hostname:
    emit('--hostname'); emit(hostname)
emit('--name'); emit(sys.argv[1].rsplit('/inspect_', 1)[-1].rsplit('.json', 1)[0])
PY
)
    CMD=()
    while IFS= read -r -d '' ARG; do CMD+=("$ARG"); done < <(python3 - "$INSPECT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
for value in data.get('Config', {}).get('Cmd', []) or []:
    sys.stdout.buffer.write(str(value).encode('utf-8', 'surrogateescape') + b'\0')
PY
)

    log "  Starting container: ${name} (image: $IMAGE)"
    log "  Args: \${#RUN_ARGS[@]} arguments"
    $DOCKER run -d "\${RUN_ARGS[@]}" "$IMAGE" "\${CMD[@]}" 2>&1 | while read line; do log "    $line"; done
    log "  Container ${name} started."
  fi
else
  log "  WARNING: inspect file not found for ${name}"
fi
`;
      }
    }

    // Cleanup
    restoreScript += `
log "Cleaning up temporary files..."
rm -rf ${extractPath} ${remotePath}
log "Docker restore complete!"
echo "---RESULT---"
echo "$LOG"
echo "---END---"
`;

    if (dryRun) {
      // Just return what would be done
      return NextResponse.json({
        success: true,
        dryRun: true,
        discovery: {
          hasImages,
          volumeCount,
          inspectCount,
          hasCompose,
          containers: inspectList,
          volumes: volumeList,
        },
        message: `Found ${inspectCount} container(s), ${volumeCount} volume(s), images: ${hasImages ? 'yes' : 'no'}, compose: ${hasCompose ? 'yes' : 'no'}`,
      });
    }

    // 4. Execute the restore script.
    // Transferred as base64 rather than a heredoc: the script embeds container
    // names read out of the backup archive, and a quoted heredoc is still
    // terminated early by a line matching the delimiter.
    const scriptPath = `/tmp/docker_restore_${restoreId}.sh`;
    const qScriptPath = shellQuote(scriptPath);
    const writeScript = `printf '%s' ${shellQuote(Buffer.from(restoreScript, 'utf8').toString('base64'))} | base64 -d > ${qScriptPath} && chmod +x ${qScriptPath}`;
    await execCommand(targetSshConfig, writeScript);

    const result = await execCommand(targetSshConfig, `bash ${qScriptPath} 2>&1; echo "EXIT_CODE=$?"`);

    const exitCode = result.stdout.match(/EXIT_CODE=(\d+)/)?.[1];
    const resultLog = result.stdout.match(/---RESULT---\n([\s\S]*?)---END---/)?.[1]?.trim();

    // Cleanup script
    await execCommand(targetSshConfig, `rm -f ${qScriptPath}`);

    return NextResponse.json({
      success: exitCode === '0',
      logs: resultLog || result.stdout,
      exitCode: parseInt(exitCode || '1'),
    });

  } catch (error) {
    logger.error('[restore-docker] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
