import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function POST(req) {
  try {
    const { connectionId, name, type, config } = await req.json();

    if (!connectionId || !name || !type) {
      return NextResponse.json({ success: false, error: 'connectionId, name, and type are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const cleanName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';

    const args = Object.entries(config || {})
      .filter(([_, val]) => val !== undefined && val !== null && String(val).trim() !== '')
      .map(([key, val]) => `${quote(key)}=${quote(val)}`)
      .join(' ');

    const cmd = `${pathPrefix}rclone config create ${quote(cleanName)} ${quote(type)} ${args} non_interactive=true`;

    const result = await execCommand(sshConfig, cmd);

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Remote "${cleanName}" configured successfully!`,
        name: cleanName,
      });
    }

    // Fallback: append directly to rclone.conf if command fails
    const confLines = [`[${cleanName}]`, `type = ${type}`];
    Object.entries(config || {}).forEach(([k, v]) => {
      if (v) confLines.push(`${k} = ${v}`);
    });
    const confBlock = confLines.join('\n') + '\n\n';

    const appendCmd = `mkdir -p ~/.config/rclone && echo ${quote(confBlock)} >> ~/.config/rclone/rclone.conf`;
    const fallbackRes = await execCommand(sshConfig, appendCmd);

    if (fallbackRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Remote "${cleanName}" added to rclone.conf!`,
        name: cleanName,
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || result.stdout.trim() || 'Failed to configure remote',
    }, { status: 500 });

  } catch (error) {
    console.error('[rclone/remote POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const name = searchParams.get('name');

    if (!connectionId || !name) {
      return NextResponse.json({ success: false, error: 'connectionId and name are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const cleanName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';

    const cmd = `${pathPrefix}rclone config delete ${quote(cleanName)}`;
    const result = await execCommand(sshConfig, cmd);

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Remote "${cleanName}" removed successfully`,
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || 'Failed to delete remote',
    }, { status: 500 });

  } catch (error) {
    console.error('[rclone/remote DELETE] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
