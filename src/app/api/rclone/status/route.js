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
    const detectScript = `
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/snap/bin:$PATH"
RCLONE_CMD="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "$HOME/.local/bin/rclone")"
if [ ! -x "$RCLONE_CMD" ] && ! command -v rclone >/dev/null 2>&1; then
  echo "NOT_INSTALLED"
  exit 0
fi

VERSION="$($RCLONE_CMD version 2>/dev/null | head -n 2)"
CONFIG_PATH="$($RCLONE_CMD config file 2>/dev/null | grep -i "\.conf" | tail -n 1)"
if [ -z "$CONFIG_PATH" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then CONFIG_PATH="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then CONFIG_PATH="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then CONFIG_PATH="/etc/rclone/rclone.conf"
  fi
fi

REMOTES="$($RCLONE_CMD listremotes 2>/dev/null)"
if [ -z "$REMOTES" ] && [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  REMOTES="$(sudo $RCLONE_CMD listremotes 2>/dev/null || true)"
fi

if [ -z "$REMOTES" ]; then
  REMOTES="$(grep -h -E '^\\[.+\\]' "$HOME/.config/rclone/rclone.conf" "/root/.config/rclone/rclone.conf" "/etc/rclone/rclone.conf" 2>/dev/null | tr -d '[]:' || true)"
fi

echo "===VERSION==="
echo "$VERSION"
echo "===CONFIG_PATH==="
echo "$CONFIG_PATH"
echo "===REMOTES==="
echo "$REMOTES"
`;

    const detectRes = await execCommand(sshConfig, detectScript);
    const output = detectRes.stdout || '';

    if (output.includes('NOT_INSTALLED')) {
      return NextResponse.json({
        success: true,
        installed: false,
        version: null,
        remotes: [],
        configPath: null,
      });
    }

    const versionMatch = output.match(/===VERSION===\n([\s\S]*?)(?====CONFIG_PATH===|$)/);
    const configPathMatch = output.match(/===CONFIG_PATH===\n([\s\S]*?)(?====REMOTES===|$)/);
    const remotesMatch = output.match(/===REMOTES===\n([\s\S]*?)(?=$)/);

    const version = versionMatch ? versionMatch[1].trim() : 'rclone installed';
    const configPath = configPathMatch ? configPathMatch[1].trim() : null;
    const rawRemotes = remotesMatch ? remotesMatch[1].trim() : '';

    const remotes = Array.from(new Set(
      rawRemotes
        .split('\n')
        .map(r => r.trim().replace(/:$/, '').replace(/^\[/, '').replace(/\]$/, ''))
        .filter(Boolean)
    ));

    // Check for any currently running rclone processes
    const psRes = await execCommand(sshConfig, `ps aux 2>/dev/null | grep -i rclone | grep -v grep || true`);
    const runningJobs = psRes.stdout
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const cmd = parts.slice(10).join(' ');
        return { pid, cmd };
      });

    return NextResponse.json({
      success: true,
      installed: true,
      version,
      remotes,
      configPath,
      runningJobs,
    });
  } catch (error) {
    console.error('[rclone/status] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
