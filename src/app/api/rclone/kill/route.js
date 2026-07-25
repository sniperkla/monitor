import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

export async function POST(req) {
  try {
    const { connectionId, pid } = await req.json();

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    let killScript = '';
    if (pid && pid !== 'all') {
      const cleanPid = String(pid).replace(/[^0-9]/g, '');
      killScript = `kill -15 ${cleanPid} 2>/dev/null || kill -9 ${cleanPid} 2>/dev/null || sudo kill -9 ${cleanPid} 2>/dev/null || true`;
    } else {
      killScript = `pkill -15 -f rclone 2>/dev/null || pkill -9 -f rclone 2>/dev/null || sudo pkill -9 -f rclone 2>/dev/null || true`;
    }

    const killRes = await execCommand(sshConfig, killScript);

    return NextResponse.json({
      success: true,
      message: pid ? `Terminated process PID ${pid}` : 'Terminated all rclone processes',
      output: killRes.stdout || '',
    });
  } catch (error) {
    console.error('[rclone/kill] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
