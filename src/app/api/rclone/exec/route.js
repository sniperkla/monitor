import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function POST(req) {
  try {
    const {
      connectionId,
      action = 'copy', // sync | copy | move | check
      source,
      target,
      projectName: reqProjectName = '',
      options = {},
    } = await req.json();

    if (!connectionId || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, source, and target are required' }, { status: 400 });
    }
    // Security: action is interpolated into a remote shell command - restrict it
    // to supported verbs so it can never be used for command injection.
    const ALLOWED_ACTIONS = ['sync', 'copy', 'move', 'check'];
    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json({ success: false, error: 'action must be one of: sync, copy, move, check' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const envPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"; RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "rclone")"; ';

    // Derive project name and safe lock name (mirrors cron route logic)
    const cleanSourceLabel = source ? (source.split('/').filter(Boolean).pop() || source) : 'Source';
    const cleanTargetLabel = target ? target.split('/')[0] : 'Destination';
    const finalProjectName = reqProjectName.trim() ? reqProjectName.trim().replace(/"/g, '') : `${cleanSourceLabel} ➔ ${cleanTargetLabel}`;
    const safeLockName = finalProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Use rclone-cron-* log pattern in both persistent dir and /tmp
    const timestamp = Date.now();
    const sessionName = `rclone-${action}-${timestamp}`;
    const permLogFile = `$HOME/.rclone-scripts/logs/rclone-cron-${safeLockName}-${timestamp}.log`;
    const tmpLogFile = `/tmp/rclone-cron-${safeLockName}-${timestamp}.log`;
    const logFile = permLogFile;

    // Ensure log directory exists and write project header marker
    const headerCmd = `mkdir -p "$HOME/.rclone-scripts/logs"; echo ${quote(`=== Project: ${finalProjectName} | Action: ${action} ===`)} | tee ${quote(tmpLogFile)} > ${quote(permLogFile)}`;
    await execCommand(sshConfig, headerCmd);

    // Build flags
    const flags = ['--progress', '-v', '--stats=1s'];
    if (options.dryRun) flags.push('--dry-run');
    if (options.transfers) flags.push(`--transfers=${parseInt(options.transfers, 10)}`);
    if (options.bwlimit) flags.push(`--bwlimit=${quote(options.bwlimit)}`);
    if (options.deleteBefore) flags.push('--delete-before');
    if (options.driveFolderId && options.driveFolderId.trim()) {
      flags.push(`--drive-root-folder-id=${quote(options.driveFolderId.trim())}`);
    }

    let finalTarget = target;
    if (options.useTimestampFolder) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mmm = months[now.getMonth()];
      const dmy = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
      const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const ymdMmmHm = `${now.getFullYear()}_${mmm}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}`;
      
      let subFolder = ymd;
      if (options.timestampFormat === 'YMD_MMM_HM') {
        subFolder = ymdMmmHm;
      } else if (options.timestampFormat === 'DMY_HM') {
        subFolder = dmy;
      }
      const cleanTarget = target.replace(/\/$/, '');
      finalTarget = `${cleanTarget}/${subFolder}/`;
    }

    let cmd = `${envPrefix}"$RCLONE_BIN" ${action} ${quote(source)} ${quote(finalTarget)} ${flags.join(' ')}`;
    
    // Auto Retention Policy: clean old backups older than X days
    if (options.enableRetention && options.retentionDays) {
      const days = parseInt(options.retentionDays, 10) || 7;
      let driveFlag = '';
      if (options.driveFolderId && options.driveFolderId.trim()) {
        driveFlag = `--drive-root-folder-id=${quote(options.driveFolderId.trim())} `;
      }
      cmd += `; ${envPrefix}"$RCLONE_BIN" delete --min-age ${days}d ${quote(target)} ${driveFlag}--rmdirs 2>/dev/null || true`;
    }

    const b64Script = Buffer.from(`${cmd}`).toString('base64');
    const decodeCmd = `(base64 -d 2>/dev/null || base64 -D 2>/dev/null || base64 --decode 2>/dev/null || openssl base64 -d 2>/dev/null)`;

    // Wrap execution inside tmux session if tmux is installed, fallback to nohup
    // Tee output to both persistent logs directory and /tmp for log compatibility
    const runnerCmd = [
      `if command -v tmux >/dev/null 2>&1; then`,
      `  tmux kill-session -t "${sessionName}" 2>/dev/null || true`,
      `  tmux new-session -d -s "${sessionName}"`,
      `  tmux send-keys -t "${sessionName}" "echo ${b64Script} | ${decodeCmd} > /tmp/${sessionName}.sh && bash /tmp/${sessionName}.sh 2>&1 | tee -a ${quote(permLogFile)} >> ${quote(tmpLogFile)}; exit" Enter`,
      `  echo "TMUX_SESSION=${sessionName}"`,
      `else`,
      `  echo ${b64Script} | ${decodeCmd} > /tmp/${sessionName}.sh`,
      `  nohup bash /tmp/${sessionName}.sh 2>&1 | tee -a ${quote(permLogFile)} >> ${quote(tmpLogFile)} & echo "PID=$!"`,
      `fi`
    ].join('\n');

    const result = await execCommand(sshConfig, runnerCmd);

    const pidMatch = result.stdout?.match(/PID=(\d+)/);
    const pid = pidMatch ? pidMatch[1] : null;

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        sessionName,
        logFile,
        pid,
        command: cmd,
        tmux: result.stdout.includes('TMUX_SESSION='),
        message: `Rclone ${action} launched in ${result.stdout.includes('TMUX_SESSION=') ? 'tmux session' : 'background'}!`,
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || 'Failed to launch rclone job',
    }, { status: 500 });

  } catch (error) {
    logger.error('[rclone/exec POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const logFile = searchParams.get('logFile');
    const sessionName = searchParams.get('sessionName');
    const pid = searchParams.get('pid');

    if (!connectionId || !logFile) {
      return NextResponse.json({ success: false, error: 'connectionId and logFile are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Read latest log output
    const logRes = await execCommand(sshConfig, `cat "${logFile}" 2>/dev/null || echo "Log initializing in tmux..."`);
    
    // Check if tmux session or process is still running
    let isRunning = false;
    if (sessionName) {
      const tmuxCheck = await execCommand(sshConfig, `tmux has-session -t "${sessionName}" 2>/dev/null`);
      isRunning = tmuxCheck.code === 0;
    } else if (pid) {
      const psRes = await execCommand(sshConfig, `ps -p ${pid} 2>/dev/null | grep ${pid}`);
      isRunning = psRes.code === 0;
    }

    return NextResponse.json({
      success: true,
      log: logRes.stdout || '',
      running: isRunning,
      sessionName,
    });

  } catch (error) {
    logger.error('[rclone/exec GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
