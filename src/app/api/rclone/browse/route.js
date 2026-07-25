import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const remote = searchParams.get('remote') || '';
    const path = searchParams.get('path') || '';

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';
    
    // Construct rclone target e.g. "gdrive:myfolder" or "s3remote:mybucket/sub"
    const target = remote ? (remote.endsWith(':') ? `${remote}${path}` : `${remote}:${path}`) : path;
    const cmd = `${pathPrefix}rclone lsjson ${quote(target)} --stat 2>/dev/null || ${pathPrefix}rclone lsjson ${quote(target)} 2>/dev/null`;

    const result = await execCommand(sshConfig, cmd);

    if (result.code === 0 && result.stdout.trim()) {
      let items = [];
      try {
        items = JSON.parse(result.stdout.trim());
      } catch (_) {
        items = [];
      }
      return NextResponse.json({
        success: true,
        target,
        items: Array.isArray(items) ? items : [items],
      });
    }

    return NextResponse.json({
      success: true,
      target,
      items: [],
    });

  } catch (error) {
    console.error('[rclone/browse] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
