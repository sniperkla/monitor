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

export async function POST(req) {
  try {
    const { connectionId, schedule, action, source, target, options = {} } = await req.json();

    if (!connectionId || !schedule || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, schedule, source, and target are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Build rclone command flags
    const flags = [];
    if (options.dryRun) flags.push('--dry-run');
    if (options.bwlimit) flags.push(`--bwlimit "${options.bwlimit}"`);
    if (options.transfers) flags.push(`--transfers ${options.transfers}`);
    
    // Log file path for crontab run
    const logFile = `/tmp/rclone-cron-${Date.now()}.log`;
    flags.push(`--log-file="${logFile}"`);
    flags.push(`--log-level INFO`);

    const rcloneCmd = `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; rclone ${action || 'copy'} "${source}" "${target}" ${flags.join(' ')}`;
    const cronLine = `${schedule} ${rcloneCmd}`;

    // Append to server's crontab safely
    const addCronScript = `
(crontab -l 2>/dev/null | grep -v "${rcloneCmd.replace(/"/g, '\\"')}" ; echo "${cronLine.replace(/"/g, '\\"')}") | crontab -
`;
    const addRes = await execCommand(sshConfig, addCronScript);

    if (addRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: 'Crontab job added successfully!',
        schedule,
        humanSchedule: parseCronHuman(schedule),
        cronLine,
      });
    }

    return NextResponse.json({ success: false, error: addRes.stderr || 'Failed to add crontab job' }, { status: 500 });

  } catch (error) {
    console.error('[rclone/cron POST] error:', error.message);
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
