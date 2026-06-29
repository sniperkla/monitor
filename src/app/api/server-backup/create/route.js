import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import crypto from 'crypto';

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
      const includeVolumes = config.includeVolumes;
      const includeImages = config.includeImages;
      cmd = `set -e\nmkdir -p /tmp/bk_${jobId}\n`;
      if (containers.length === 0 || containers.includes('all')) {
        cmd += `docker ps -a --format '{{.Names}}' > /tmp/bk_${jobId}/containers.txt\n`;
      } else {
        cmd += `echo '${containers.join('\n')}' > /tmp/bk_${jobId}/containers.txt\n`;
      }
      cmd += `while IFS= read -r c; do\n`;
      cmd += `  echo "[backup] Inspecting container: $c"\n`;
      cmd += `  docker inspect "$c" > /tmp/bk_${jobId}/inspect_$c.json 2>/dev/null || true\n`;
      cmd += `  ROOT=$(docker inspect "$c" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)\n`;
      cmd += `  if [ -z "$ROOT" ]; then ROOT=$(docker inspect "$c" --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' 2>/dev/null | xargs dirname 2>/dev/null || true); fi\n`;
      cmd += `  if [ -n "$ROOT" ] && [ -d "$ROOT" ]; then tar -rf /tmp/bk_${jobId}/data.tar -C "$ROOT" . 2>/dev/null || true; fi\n`;
      cmd += `done < /tmp/bk_${jobId}/containers.txt\n`;
      if (includeVolumes) {
        cmd += `for vol in $(docker volume ls -q); do\n`;
        cmd += `  echo "[backup] Backing up volume: $vol"\n`;
        cmd += `  docker run --rm -v "$vol":/src -v /tmp/bk_${jobId}:/dst alpine tar -cf /dst/vol_${jobId}_$vol.tar -C /src . 2>/dev/null || true\n`;
        cmd += `done\n`;
      }
      if (includeImages) {
        cmd += `echo "[backup] Saving Docker images..."\n`;
        cmd += `docker save $(docker images -q) | gzip > /tmp/bk_${jobId}/images.tar.gz 2>/dev/null || true\n`;
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
        cmd += `mongodump --host ${host || '127.0.0.1'} --port ${port || 27017} ${auth} --db ${database} --out /tmp/dbdump_${jobId} 2>&1\n`;
      } else if (dbType === 'mysql') {
        cmd += `mysqldump -h ${host || '127.0.0.1'} -P ${port || 3306} -u ${username || 'root'} ${password ? `-p'${password}'` : ''} ${database} > /tmp/dbdump_${jobId}/dump.sql 2>&1\n`;
      } else if (dbType === 'postgres') {
        const pgEnv = password ? `PGPASSWORD='${password}'` : '';
        cmd += `${pgEnv} pg_dump -h ${host || '127.0.0.1'} -p ${port || 5432} -U ${username || 'postgres'} -d ${database} -F c -f /tmp/dbdump_${jobId}/dump.dump 2>&1\n`;
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
      cmd = `tar -czf ${outFile} --ignore-failed-read -C / ${items.join(' ')}`;
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

  const fullCmd = [
    `nohup bash -c '`,
    `echo "[backup] Starting ${type} backup at $(date)"`,
    cmd,
    `echo "[backup] Backup complete: ${outFile}"`,
    `echo "---FINISHED---"`,
    `' > ${logFile} 2>&1 &`,
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
    console.error('[server-backup/create] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
