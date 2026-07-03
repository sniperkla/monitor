import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand, sftpUpload } from '../_ssh';
import crypto from 'crypto';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(request) {
  let tempFile = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file');
    const connectionId = formData.get('connectionId');
    const dryRun = formData.get('dryRun') === 'true';

    if (!file || !connectionId) {
      return NextResponse.json({ success: false, error: 'Missing file or connectionId' }, { status: 400 });
    }

    const restoreId = crypto.randomUUID().substring(0, 8);
    tempFile = join(tmpdir(), `docker_restore_${restoreId}.tar.gz`);
    const bytes = await file.arrayBuffer();
    await writeFile(tempFile, Buffer.from(bytes));

    const sshConfig = await getSshConfig(connectionId);
    const remotePath = `/tmp/docker_restore_${restoreId}.tar.gz`;
    const extractPath = `/tmp/docker_restore_${restoreId}`;

    // 1. Upload backup to target server
    await sftpUpload(sshConfig, tempFile, remotePath);

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
    const discovery = await execCommand(sshConfig, discoverCmd);

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

    # Build docker run command from inspect data
    RUN_ARGS=""

    # Environment variables
    while IFS= read -r env; do
      [ -n "$env" ] && RUN_ARGS="$RUN_ARGS -e $env"
    done < <(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for e in data.get('Config', {}).get('Env', []):
    if not e.startswith('PATH='):
        print(e)
" 2>/dev/null || true)

    # Port bindings
    while IFS= read -r port; do
      [ -n "$port" ] && RUN_ARGS="$RUN_ARGS -p $port"
    done < <(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
bindings = data.get('HostConfig', {}).get('PortBindings', {}) or {}
for container_port, host_list in bindings.items():
    cp = container_port.split('/')[0]
    for h in (host_list or []):
        hp = h.get('HostPort', '')
        hip = h.get('HostIp', '0.0.0.0')
        if hp:
            if hip and hip != '0.0.0.0':
                print(f'{hip}:{hp}:{cp}')
            else:
                print(f'{hp}:{cp}')
" 2>/dev/null || true)

    # Volume mounts (bind mounts)
    while IFS= read -r bind; do
      [ -n "$bind" ] && RUN_ARGS="$RUN_ARGS -v $bind"
    done < <(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for b in data.get('HostConfig', {}).get('Binds', []) or []:
    print(b)
" 2>/dev/null || true)

    # Named volumes via Mounts
    while IFS= read -r mount; do
      [ -n "$mount" ] && RUN_ARGS="$RUN_ARGS -v $mount"
    done < <(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data.get('Mounts', []) or []:
    if m.get('Type') == 'volume':
        name = m.get('Name', '')
        dest = m.get('Destination', '')
        if name and dest:
            print(f'{name}:{dest}')
" 2>/dev/null || true)

    # Network mode
    NETWORK=$(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
nm = data.get('HostConfig', {}).get('NetworkMode', 'default')
print(nm if nm and nm != 'default' else '')
" 2>/dev/null || true)
    [ -n "$NETWORK" ] && RUN_ARGS="$RUN_ARGS --network $NETWORK"

    # Restart policy
    RESTART=$(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
rp = data.get('HostConfig', {}).get('RestartPolicy', {}) or {}
name = rp.get('Name', 'no')
if name and name != 'no':
    mc = rp.get('MaximumRetryCount', 0)
    if mc:
        print(f'{name}:{mc}')
    else:
        print(name)
" 2>/dev/null || true)
    [ -n "$RESTART" ] && RUN_ARGS="$RUN_ARGS --restart $RESTART"

    # Hostname
    HOSTNAME=$(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
h = data.get('Config', {}).get('Hostname', '')
print(h)
" 2>/dev/null || true)
    [ -n "$HOSTNAME" ] && RUN_ARGS="$RUN_ARGS --hostname $HOSTNAME"

    # Container name
    RUN_ARGS="$RUN_ARGS --name ${name}"

    # Command
    CMD=$(cat ${extractPath}/inspect_${name}.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
cmd = data.get('Config', {}).get('Cmd')
if cmd:
    print(' '.join(cmd))
" 2>/dev/null || true)

    log "  Starting container: ${name} (image: $IMAGE)"
    log "  Args: $RUN_ARGS"
    eval "$DOCKER run -d $RUN_ARGS $IMAGE $CMD" 2>&1 | while read line; do log "    $line"; done
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

    // 4. Execute the restore script
    const scriptPath = `/tmp/docker_restore_${restoreId}.sh`;
    const writeScript = `cat > ${scriptPath} <<'RESTORE_EOF'\n${restoreScript}\nRESTORE_EOF\nchmod +x ${scriptPath}`;
    await execCommand(sshConfig, writeScript);

    const result = await execCommand(sshConfig, `bash ${scriptPath} 2>&1; echo "EXIT_CODE=$?"`);

    const exitCode = result.stdout.match(/EXIT_CODE=(\d+)/)?.[1];
    const resultLog = result.stdout.match(/---RESULT---\n([\s\S]*?)---END---/)?.[1]?.trim();

    // Cleanup script
    await execCommand(sshConfig, `rm -f ${scriptPath}`);

    return NextResponse.json({
      success: exitCode === '0',
      logs: resultLog || result.stdout,
      exitCode: parseInt(exitCode || '1'),
    });

  } catch (error) {
    console.error('[restore-docker] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (tempFile) { try { await unlink(tempFile); } catch {} }
  }
}
