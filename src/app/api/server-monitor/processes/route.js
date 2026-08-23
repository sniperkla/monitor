import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

const PROCESS_LIST_SCRIPT = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [ "$(uname)" = "Darwin" ]; then
  # macOS
  ps -A -o pid,user,%cpu,%mem,rss,state,time,command -r 2>/dev/null | head -n 120
else
  # Linux: sort by CPU descending
  ps -eo pid,user,%cpu,%mem,rss,stat,time,command --sort=-%cpu 2>/dev/null | head -n 120
fi
`;

function parseProcessOutput(stdout) {
  if (!stdout) return [];
  const lines = stdout.trim().split('\n');
  if (lines.length < 2) return [];

  const processes = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split on whitespace into at most 8 tokens
    const tokens = line.split(/\s+/);
    if (tokens.length < 8) continue;

    const pid = parseInt(tokens[0], 10);
    if (isNaN(pid) || pid <= 0) continue;

    const user = tokens[1];
    const cpu = parseFloat(tokens[2]) || 0;
    const mem = parseFloat(tokens[3]) || 0;
    const rssKb = parseInt(tokens[4], 10) || 0;
    const stat = tokens[5];
    const time = tokens[6];
    const command = tokens.slice(7).join(' ');

    // Extract short name from command
    const firstWord = tokens[7] || '';
    const cleanName = firstWord.split('/').pop().replace(/[:()[\]]/g, '') || firstWord;

    processes.push({
      pid,
      user,
      cpu,
      mem,
      rssKb,
      stat,
      time,
      name: cleanName,
      command
    });
  }

  return processes;
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const result = await execCommand(sshConfig, PROCESS_LIST_SCRIPT);

    if (result.code !== 0 && !result.stdout) {
      return NextResponse.json({
        success: false,
        error: result.stderr || 'Failed to list processes'
      }, { status: 500 });
    }

    const processes = parseProcessOutput(result.stdout || '');

    return NextResponse.json({
      success: true,
      processes,
      total: processes.length,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('[server-monitor/processes] GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { connectionId, pid, signal = 'SIGTERM' } = body;

    const numericPid = parseInt(pid, 10);
    if (!connectionId || isNaN(numericPid) || numericPid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid connectionId or PID' }, { status: 400 });
    }

    // Protect PID 1 (init / systemd) from accidental termination
    if (numericPid === 1) {
      return NextResponse.json({ success: false, error: 'Cannot terminate system init process (PID 1)' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const sigFlag = signal === 'SIGKILL' ? '-9' : signal === 'SIGINT' ? '-2' : '-15';

    const killScript = `
      export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
      if kill ${sigFlag} ${numericPid} 2>/dev/null; then
        echo "SUCCESS"
      elif sudo kill ${sigFlag} ${numericPid} 2>/dev/null; then
        echo "SUCCESS_SUDO"
      else
        echo "FAILED"
        exit 1
      fi
    `;

    const result = await execCommand(sshConfig, killScript);
    const output = (result.stdout || '').trim();

    if (result.code === 0 && output.startsWith('SUCCESS')) {
      return NextResponse.json({
        success: true,
        message: `Process ${numericPid} terminated successfully (${signal})`,
        pid: numericPid,
        signal
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.stderr || 'Failed to kill process. It may have already exited or requires root permissions.'
      }, { status: 500 });
    }
  } catch (error) {
    logger.error('[server-monitor/processes] POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
