import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

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
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';

    // Check if rclone binary exists
    const checkRes = await execCommand(sshConfig, `${pathPrefix}command -v rclone`);
    const isInstalled = checkRes.code === 0 && checkRes.stdout.trim().length > 0;

    if (!isInstalled) {
      return NextResponse.json({
        success: true,
        installed: false,
        version: null,
        remotes: [],
        configPath: null,
      });
    }

    // Get rclone version & remotes
    const versionRes = await execCommand(sshConfig, `${pathPrefix}rclone version 2>/dev/null | head -n 2`);
    const remotesRes = await execCommand(sshConfig, `${pathPrefix}rclone listremotes 2>/dev/null`);
    const configPathRes = await execCommand(sshConfig, `${pathPrefix}rclone config file 2>/dev/null | tail -n 1`);

    const version = versionRes.stdout.trim();
    const remotes = remotesRes.stdout
      .split('\n')
      .map(r => r.trim())
      .filter(Boolean)
      .map(r => r.replace(/:$/, ''));

    const configPath = configPathRes.stdout.trim();

    return NextResponse.json({
      success: true,
      installed: true,
      version,
      remotes,
      configPath,
    });
  } catch (error) {
    console.error('[rclone/status] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
