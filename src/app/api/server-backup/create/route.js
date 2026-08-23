import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

function buildBackupCommand(jobId, type, config) {
  const logFile = `/tmp/backup_${jobId}.log`;
  const outFile = `/tmp/backup_${jobId}.tar.gz`;
  let cmd = '';

  switch (type) {
    case 'webapp': {
      const paths = (config.paths || []).filter(Boolean).join(' ');
      const excludes = (config.excludes || []).map(e => `--exclude='${e}'`).join(' ');
      cmd = `tar -czf ${outFile} ${excludes} -C / ${paths}`;
      break;
    }
    case 'docker': {
      const containers = config.containers || [];
      const includeVolumes = config.includeVolumes !== false;
      const includeImages = config.includeImages !== false;
      cmd = `set -e\nmkdir -p /tmp/bk_${jobId}\n`;
      cmd += `DOCKER="docker"; if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi\n`;
      if (containers.length === 0 || containers.includes('all')) {
        cmd += `$DOCKER ps -a --format '{{.Names}}' > /tmp/bk_${jobId}/containers.txt\n`;
      } else {
        cmd += `echo '${containers.join('\n')}' > /tmp/bk_${jobId}/containers.txt\n`;
      }
      // Collect images used by selected containers
      cmd += `IMAGES=""\n`;
      cmd += `while IFS= read -r c; do\n`;
      cmd += `  echo "[backup] Inspecting container: $c"\n`;
      cmd += `  $DOCKER inspect "$c" > /tmp/bk_${jobId}/inspect_$c.json 2>/dev/null || true\n`;
      cmd += `  IMG=$($DOCKER inspect "$c" --format '{{.Config.Image}}' 2>/dev/null || true)\n`;
      cmd += `  [ -n "$IMG" ] && IMAGES="$IMAGES $IMG"\n`;
      cmd += `  ROOT=$($DOCKER inspect "$c" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)\n`;
      cmd += `  if [ -z "$ROOT" ]; then ROOT=$($DOCKER inspect "$c" --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' 2>/dev/null | xargs dirname 2>/dev/null || true); fi\n`;
      cmd += `  if [ -n "$ROOT" ] && [ -d "$ROOT" ]; then tar -rf /tmp/bk_${jobId}/data.tar -C "$ROOT" . 2>/dev/null || true; fi\n`;
      cmd += `done < /tmp/bk_${jobId}/containers.txt\n`;
      // Backup only volumes used by selected containers
      if (includeVolumes) {
        cmd += `VOLS=""\n`;
        cmd += `while IFS= read -r c; do\n`;
        cmd += `  for v in $($DOCKER inspect "$c" --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' 2>/dev/null || true); do\n`;
        cmd += `    VOLS="$VOLS $v"\n`;
        cmd += `  done\n`;
        cmd += `done < /tmp/bk_${jobId}/containers.txt\n`;
        cmd += `VOLS=$(echo $VOLS | tr ' ' '\\n' | sort -u)\n`;
        cmd += `for vol in $VOLS; do\n`;
        cmd += `  [ -z "$vol" ] && continue\n`;
        cmd += `  echo "[backup] Backing up volume: $vol"\n`;
        cmd += `  $DOCKER run --rm -v "$vol":/src -v /tmp/bk_${jobId}:/dst alpine tar -cf /dst/vol_${jobId}_$vol.tar -C /src . 2>/dev/null || true\n`;
        cmd += `done\n`;
      }
      // Save only images used by selected containers
      if (includeImages) {
        cmd += `IMAGES=$(echo $IMAGES | tr ' ' '\\n' | sort -u)\n`;
        cmd += `if [ -n "$IMAGES" ]; then\n`;
        cmd += `  echo "[backup] Saving Docker images..."\n`;
        cmd += `  $DOCKER save $IMAGES | gzip > /tmp/bk_${jobId}/images.tar.gz 2>/dev/null || true\n`;
        cmd += `fi\n`;
      }
      cmd += `cd /tmp/bk_${jobId} && tar -czf ${outFile} .\n`;
      cmd += `rm -rf /tmp/bk_${jobId}\n`;
      break;
    }
    case 'database': {
      const { dbType, host, port, username, password, database } = config;
      cmd = `set -e\nmkdir -p /tmp/dbdump_${jobId}\n`;
      if (dbType === 'mongodb') {
        const auth = username ? `--username '${username}' --password '${password}' --authenticationDatabase admin` : '';
        cmd += `if command -v mongodump >/dev/null 2>&1; then MONGODUMP="mongodump"; elif command -v sudo >/dev/null 2>&1; then MONGODUMP="sudo mongodump"; else echo "mongodump not found"; exit 1; fi\n`;
        cmd += `$MONGODUMP --host ${host || '127.0.0.1'} --port ${port || 27017} ${auth} --db ${database} --out /tmp/dbdump_${jobId} 2>&1\n`;
      } else if (dbType === 'mysql') {
        cmd += `if command -v mysqldump >/dev/null 2>&1; then MYSQLDUMP="mysqldump"; elif command -v sudo >/dev/null 2>&1; then MYSQLDUMP="sudo mysqldump"; else echo "mysqldump not found"; exit 1; fi\n`;
        cmd += `$MYSQLDUMP -h ${host || '127.0.0.1'} -P ${port || 3306} -u ${username || 'root'} ${password ? `-p'${password}'` : ''} ${database} > /tmp/dbdump_${jobId}/dump.sql 2>&1\n`;
      } else if (dbType === 'postgres') {
        const pgEnv = password ? `PGPASSWORD='${password}'` : '';
        cmd += `if command -v pg_dump >/dev/null 2>&1; then PGDUMP="pg_dump"; elif command -v sudo >/dev/null 2>&1; then PGDUMP="sudo pg_dump"; else echo "pg_dump not found"; exit 1; fi\n`;
        cmd += `${pgEnv} $PGDUMP -h ${host || '127.0.0.1'} -p ${port || 5432} -U ${username || 'postgres'} -d ${database} -F c -f /tmp/dbdump_${jobId}/dump.dump 2>&1\n`;
      }
      cmd += `tar -czf ${outFile} -C /tmp/dbdump_${jobId} .\n`;
      cmd += `rm -rf /tmp/dbdump_${jobId}\n`;
      break;
    }
    case 'system': {
      const items = [];
      if (config.sshKeys) items.push('etc/ssh');
      if (config.cron) items.push('etc/cron.d var/spool/cron');
      if (config.systemd) items.push('etc/systemd/system');
      if (config.aptSources) items.push('etc/apt');
      if (config.hostname) items.push('etc/hostname etc/hosts');
      if (config.firewall) items.push('etc/iptables');
      if (config.nginx) items.push('etc/nginx');
      if (items.length === 0) items.push('etc/ssh');
      cmd = `sudo tar -czf ${outFile} --ignore-failed-read -C / ${items.join(' ')}`;
      break;
    }
    case 'custom': {
      const paths = (config.paths || []).filter(Boolean).join(' ');
      const excludes = (config.excludes || []).map(e => `--exclude='${e}'`).join(' ');
      cmd = `tar -czf ${outFile} ${excludes} -C / ${paths}`;
      break;
    }
    default:
      throw new Error(`Unknown backup type: ${type}`);
  }

  const scriptFile = `/tmp/backup_${jobId}.sh`;
  const fullCmd = [
    `cat > ${scriptFile} <<'BACKUP_EOF'`,
    `echo "[backup] Starting ${type} backup at $(date)"`,
    cmd,
    `echo "[backup] Backup complete: ${outFile}"`,
    `echo "---FINISHED---"`,
    `BACKUP_EOF`,
    `chmod +x ${scriptFile}`,
    `nohup bash ${scriptFile} > ${logFile} 2>&1 &`,
    `echo "PID=$!"`,
  ].join('\n');

  return { command: fullCmd, logFile, outFile };
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { connectionId, backupType, config = {} } = body;

    if (!connectionId) return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    if (!backupType) return NextResponse.json({ success: false, error: 'Missing backupType' }, { status: 400 });

    const jobId = crypto.randomUUID();
    const sshConfig = await getSshConfig(connectionId);
    const { command, logFile, outFile } = buildBackupCommand(jobId, backupType, config);

    const result = await execCommand(sshConfig, command);

    return NextResponse.json({
      success: true,
      jobId,
      logFile,
      outFile,
      pid: result.stdout?.match(/PID=(\d+)/)?.[1] || null
    });
  } catch (error) {
    logger.error('[server-backup/create] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
