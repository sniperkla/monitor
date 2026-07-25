import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

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
      options = {},
    } = await req.json();

    if (!connectionId || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, source, and target are required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);

    // Build flags
    const flags = ['--progress', '-v', '--stats=1s'];
    if (options.dryRun) flags.push('--dry-run');
    if (options.transfers) flags.push(`--transfers=${parseInt(options.transfers, 10)}`);
    if (options.bwlimit) flags.push(`--bwlimit=${quote(options.bwlimit)}`);
    if (options.deleteBefore) flags.push('--delete-before');

    const cmd = `rclone ${action} ${quote(source)} ${quote(target)} ${flags.join(' ')}`;

    // Create unique log file
    const logId = `rclone_${Date.now()}`;
    const logFile = `/tmp/${logId}.log`;
    const fullCmd = `stdbuf -i0 -o0 -e0 ${cmd} > ${logFile} 2>&1 & echo $!`;

    const result = await execCommand(sshConfig, fullCmd);

    if (result.code === 0) {
      const pid = result.stdout.trim();
      return NextResponse.json({
        success: true,
        logId,
        logFile,
        pid,
        command: cmd,
        message: `Rclone ${action} started!`,
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || 'Failed to launch rclone job',
    }, { status: 500 });

  } catch (error) {
    console.error('[rclone/exec POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const logFile = searchParams.get('logFile');
    const pid = searchParams.get('pid');

    if (!connectionId || !logFile) {
      return NextResponse.json({ success: false, error: 'connectionId and logFile are required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);

    // Read latest log output
    const logRes = await execCommand(sshConfig, `tail -n 100 "${logFile}" 2>/dev/null || echo "Log not ready..."`);
    
    // Check if process is still running
    let isRunning = false;
    if (pid) {
      const psRes = await execCommand(sshConfig, `ps -p ${pid} 2>/dev/null | grep ${pid}`);
      isRunning = psRes.code === 0;
    }

    return NextResponse.json({
      success: true,
      log: logRes.stdout || '',
      running: isRunning,
    });

  } catch (error) {
    console.error('[rclone/exec GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
