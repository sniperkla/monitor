import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function parseCronHuman(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return cronExpr;
  const [min, hour, dom, mon, dow] = parts;

  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every Hour';
  if (min === '*/15' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 15 Minutes';
  if (min === '*/30' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 30 Minutes';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Every Day at Midnight (00:00)';
  if (min === '0' && hour === '2' && dom === '*' && mon === '*' && dow === '*') return 'Every Day at 02:00 AM';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '0') return 'Every Sunday at Midnight';
  if (min === '0' && hour === '0' && dom === '1' && mon === '*' && dow === '*') return '1st Day of Every Month';
  
  return `Schedule: ${cronExpr}`;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const fetchScript = `
(crontab -l 2>/dev/null || true)
`;
    const res = await execCommand(sshConfig, fetchScript);
    const lines = (res.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);

    const jobs = [];
    lines.forEach((line, idx) => {
      if (line.startsWith('#')) return;
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        const isRclone = command.toLowerCase().includes('rclone');
        
        jobs.push({
          id: idx,
          schedule,
          humanSchedule: parseCronHuman(schedule),
          command,
          isRclone,
          raw: line,
        });
      }
    });

    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    console.error('[rclone/cron GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function bashSingleQuote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function POST(req) {
  try {
    const { connectionId, schedule, action, source, target, projectName, options = {} } = await req.json();
    const reqProjectName = projectName || '';

    if (!connectionId || !schedule || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, schedule, source, and target are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Normalize source path: if relative, make absolute via $HOME/
    let normSource = source.trim();
    if (!normSource.includes(':') && !normSource.startsWith('/')) {
      normSource = normSource.startsWith('./') ? `$HOME/${normSource.slice(2)}` : `$HOME/${normSource}`;
    }

    // 🛡️ Auto-Detect RAM and apply smart crash protection flags
    let memMb = 2048;
    try {
      const memRes = await execCommand(sshConfig, `free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048'`);
      memMb = parseInt((memRes.stdout || '').trim(), 10) || 2048;
    } catch (_) {}

    // Build rclone command flags
    const flags = [];
    if (options.dryRun) flags.push('--dry-run');
    if (options.bwlimit) flags.push(`--bwlimit "${options.bwlimit}"`);
    if (options.transfers) flags.push(`--transfers ${options.transfers}`);
    if (options.driveFolderId && options.driveFolderId.trim()) {
      flags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }

    if (!options.transfers) {
      if (memMb <= 2048) flags.push('--transfers 1 --checkers 2');
      else if (memMb <= 8192) flags.push('--transfers 2 --checkers 4');
      else flags.push('--transfers 4 --checkers 8');
    }

    flags.push(memMb <= 2048 ? '--buffer-size 16M' : '--buffer-size 32M');
    flags.push('--vfs-cache-mode off');

    if (target.includes(':')) {
      const targetLower = target.toLowerCase();
      if (targetLower.startsWith('gdrive') || targetLower.includes('drive')) {
        flags.push('--drive-chunk-size 32M');
      }
    }

    const cleanSourceLabel = normSource ? (normSource.split('/').filter(Boolean).pop() || normSource) : 'Source';
    const cleanTargetLabel = target ? target.split('/')[0] : 'Destination';
    const finalProjectName = reqProjectName.trim() ? reqProjectName.trim().replace(/"/g, '') : `${cleanSourceLabel} ➔ ${cleanTargetLabel}`;
    const safeLockName = finalProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const lockFile = `/tmp/rclone-lock-${safeLockName}.lock`;

    // Dynamic timestamped log file per execution run so every run is logged in history
    const logFile = `/tmp/rclone-cron-${safeLockName}-$(date +\\%s).log`;
    
    flags.push(`--log-file="${logFile}"`);
    flags.push(`--log-level INFO`);

    const nicePrefix = memMb <= 2048 ? 'nice -n 19 ' : '';
    let rcloneCmd = `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; exec 9>"${lockFile}"; flock -n 9 || { exit 0; }; echo "=== Project: ${finalProjectName} | Action: ${action || 'copy'} ===" >> "${logFile}"; ${nicePrefix}rclone ${action || 'copy'} "${normSource}" "${target}" ${flags.join(' ')}`;
    
    // Auto Retention Policy: clean old backups older than X days
    if (options.enableRetention && options.retentionDays) {
      const days = parseInt(options.retentionDays, 10) || 7;
      let cleanupTarget = target;
      if (options.driveFolderId && options.driveFolderId.trim()) {
        rcloneCmd += `; rclone delete --min-age ${days}d "${cleanupTarget}" --drive-root-folder-id "${options.driveFolderId.trim()}" --rmdirs 2>/dev/null || true`;
      } else {
        rcloneCmd += `; rclone delete --min-age ${days}d "${cleanupTarget}" --rmdirs 2>/dev/null || true`;
      }
    }

    const cronLine = `${schedule} ${rcloneCmd}`;

    // Perform a quick 1-off Dry-Run test to verify source and destination connectivity before saving
    const testFlags = [];
    if (options.driveFolderId && options.driveFolderId.trim()) {
      testFlags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }
    const testCmd = `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; rclone ${action || 'copy'} "${normSource}" "${target}" --dry-run ${testFlags.join(' ')} 2>&1 | head -15`;
    const testRes = await execCommand(sshConfig, testCmd);

    // Append to server's crontab safely using single-quoted echo to prevent premature bash evaluation of $(date)
    const addCronScript = `
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${bashSingleQuote(rcloneCmd)} > "$TMP_CRON" || true
echo ${bashSingleQuote(cronLine)} >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`;
    const addRes = await execCommand(sshConfig, addCronScript);

    if (addRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: 'Crontab job added successfully!',
        schedule,
        humanSchedule: parseCronHuman(schedule),
        cronLine,
        testPassed: testRes.code === 0,
        testOutput: testRes.stdout || 'Test dry-run completed cleanly.',
      });
    }

    return NextResponse.json({ success: false, error: addRes.stderr || 'Failed to add crontab job' }, { status: 500 });

  } catch (error) {
    console.error('[rclone/cron POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const { connectionId, oldRawLine, schedule, action, source, target, options = {} } = await req.json();

    if (!connectionId || !oldRawLine || !schedule || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, oldRawLine, schedule, source, and target are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Normalize source path: if relative, make absolute via $HOME/
    let normSource = source.trim();
    if (!normSource.includes(':') && !normSource.startsWith('/')) {
      normSource = normSource.startsWith('./') ? `$HOME/${normSource.slice(2)}` : `$HOME/${normSource}`;
    }

    // Build rclone command flags
    const flags = [];
    if (options.dryRun) flags.push('--dry-run');
    if (options.bwlimit) flags.push(`--bwlimit "${options.bwlimit}"`);
    if (options.transfers) flags.push(`--transfers ${options.transfers}`);
    if (options.driveFolderId && options.driveFolderId.trim()) {
      flags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }
    
    const logFile = `/tmp/rclone-cron-${Date.now()}.log`;
    flags.push(`--log-file="${logFile}"`);
    flags.push(`--log-level INFO`);

    let finalTarget = target;
    if (options.useTimestampFolder) {
      let format = '\\%Y-\\%m-\\%d_\\%H-\\%M-\\%S';
      if (options.timestampFormat === 'YMD_MMM_HM') {
        format = '\\%Y_\\%b_\\%d_\\%H_\\%M';
      } else if (options.timestampFormat === 'DMY_HM') {
        format = '\\%d-\\%m-\\%Y_\\%H-\\%M';
      }
      const cleanTarget = target.replace(/\/$/, '');
      finalTarget = `${cleanTarget}/$(date +${format})`;
    }

    let rcloneCmd = `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; rclone ${action || 'copy'} "${normSource}" "${finalTarget}" ${flags.join(' ')}`;
    
    if (options.enableRetention && options.retentionDays) {
      const days = parseInt(options.retentionDays, 10) || 7;
      let cleanupTarget = target;
      if (options.driveFolderId && options.driveFolderId.trim()) {
        rcloneCmd += `; rclone delete --min-age ${days}d "${cleanupTarget}" --drive-root-folder-id "${options.driveFolderId.trim()}" --rmdirs 2>/dev/null || true`;
      } else {
        rcloneCmd += `; rclone delete --min-age ${days}d "${cleanupTarget}" --rmdirs 2>/dev/null || true`;
      }
    }

    const cronLine = `${schedule} ${rcloneCmd}`;

    // Remove old cron line and append new cron line safely
    const updateCronScript = `
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${bashSingleQuote(oldRawLine)} > "$TMP_CRON" || true
echo ${bashSingleQuote(cronLine)} >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`;
    const updateRes = await execCommand(sshConfig, updateCronScript);

    if (updateRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: 'Crontab job updated successfully!',
        schedule,
        humanSchedule: parseCronHuman(schedule),
        cronLine,
      });
    }

    return NextResponse.json({ success: false, error: updateRes.stderr || 'Failed to update crontab job' }, { status: 500 });

  } catch (error) {
    console.error('[rclone/cron PUT] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const rawLine = searchParams.get('rawLine');

    if (!connectionId || !rawLine) {
      return NextResponse.json({ success: false, error: 'connectionId and rawLine are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Remove exact cron line from server's crontab
    const removeCronScript = `
crontab -l 2>/dev/null | grep -F -v '${rawLine.replace(/'/g, `'\\''`)}' | crontab -
`;
    const delRes = await execCommand(sshConfig, removeCronScript);

    return NextResponse.json({ success: delRes.code === 0, error: delRes.code !== 0 ? delRes.stderr : null });

  } catch (error) {
    console.error('[rclone/cron DELETE] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
