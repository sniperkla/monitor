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
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"
RCLONE_CMD=""
for _p in "$HOME/.local/bin/rclone" "/usr/bin/rclone" "/usr/local/bin/rclone" "/snap/bin/rclone"; do
  if [ -x "$_p" ]; then RCLONE_CMD="$_p"; break; fi
done
if [ -z "$RCLONE_CMD" ]; then
  RCLONE_CMD="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || true)"
fi
if [ -z "$RCLONE_CMD" ] || [ ! -x "$RCLONE_CMD" ]; then
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

MEM_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048')"
NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '2')"

echo "===VERSION==="
echo "$VERSION"
echo "===CONFIG_PATH==="
echo "$CONFIG_PATH"
echo "===REMOTES==="
echo "$REMOTES"
echo "===MEM_MB==="
echo "$MEM_MB"
echo "===NPROC==="
echo "$NPROC"
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
    const remotesMatch = output.match(/===REMOTES===\n([\s\S]*?)(?====MEM_MB===|$)/);
    const memMatch = output.match(/===MEM_MB===\n(\d+)/);
    const nprocMatch = output.match(/===NPROC===\n(\d+)/);

    const version = versionMatch ? versionMatch[1].trim() : 'rclone installed';
    const configPath = configPathMatch ? configPathMatch[1].trim() : null;
    const rawRemotes = remotesMatch ? remotesMatch[1].trim() : '';

    const totalMemMb = memMatch ? parseInt(memMatch[1], 10) : 2048;
    const cpuCores = nprocMatch ? parseInt(nprocMatch[1], 10) : 2;

    let recMode = 'standard';
    let recTransfers = 2;
    let recCheckers = 4;
    let recBufferSize = '16M';
    let recChunkSize = '32M';

    if (totalMemMb <= 2048) {
      recMode = 'low_ram';
      recTransfers = 1;
      recCheckers = 2;
      recBufferSize = '16M';
      recChunkSize = '32M';
    } else if (totalMemMb >= 8192) {
      recMode = 'high_spec';
      recTransfers = 4;
      recCheckers = 8;
      recBufferSize = '64M';
      recChunkSize = '64M';
    }

    const serverSpecs = {
      totalMemMb,
      cpuCores,
      mode: recMode,
      recommended: {
        transfers: recTransfers,
        checkers: recCheckers,
        bufferSize: recBufferSize,
        chunkSize: recChunkSize,
      }
    };

    const remotes = Array.from(new Set(
      rawRemotes
        .split('\n')
        .map(r => r.trim().replace(/:$/, '').replace(/^\[/, '').replace(/\]$/, ''))
        .filter(Boolean)
    ));

    // Read config file content / dumpconfig to get full remote details
    let configDump = '';
    if (configPath) {
      const catRes = await execCommand(sshConfig, `cat "${configPath}" 2>/dev/null || sudo cat "${configPath}" 2>/dev/null || true`);
      configDump = catRes.stdout || '';
    }
    if (!configDump) {
      const dumpRes = await execCommand(sshConfig, `rclone config show 2>/dev/null || true`);
      configDump = dumpRes.stdout || '';
    }

    // Parse remoteDetails map: { [remoteName]: { type: 'drive', scope: '...', ... } }
    const remoteDetails = {};
    let currentRemote = null;

    configDump.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentRemote = trimmed.slice(1, -1);
        remoteDetails[currentRemote] = {};
      } else if (currentRemote && trimmed.includes('=')) {
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        remoteDetails[currentRemote][key] = val;
      }
    });

    // Detect all running rclone processes (user + root) with CPU, MEM, ETIME details
    const psScript = `
PS_CMD="ps -eo pid,user,%cpu,%mem,etime,args 2>/dev/null || ps aux 2>/dev/null"
RAW_PS="$($PS_CMD | grep -i rclone | grep -v grep || true)"
if [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  ROOT_PS="$(sudo $PS_CMD | grep -i rclone | grep -v grep || true)"
  if [ -n "$ROOT_PS" ]; then
    RAW_PS="$RAW_PS\n$ROOT_PS"
  fi
fi
echo "$RAW_PS"
`;
    const psRes = await execCommand(sshConfig, psScript);
    const seenPids = new Set();
    const runningJobs = (psRes.stdout || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/);
        if (parts.length < 6) return null;
        const pid = parts[0];
        if (seenPids.has(pid)) return null;
        seenPids.add(pid);
        const user = parts[1];
        const cpu = parts[2];
        const mem = parts[3];
        const etime = parts[4];
        const cmd = parts.slice(5).join(' ');
        const isCron = cmd.includes('cron') || cmd.includes('/etc/cron') || cmd.includes('anacron');
        return { pid, user, cpu, mem, etime, cmd, isCron };
      })
      .filter(Boolean);

    // Detect Crontab entries (user & root)
    const cronScript = `
if command -v crontab >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' || true
fi
if [ "$(id -u)" != "0" ] && sudo -n true 2>/dev/null; then
  sudo crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' | sed 's/^/[root] /' || true
fi
`;
    const cronRes = await execCommand(sshConfig, cronScript);
    const cronJobs = (cronRes.stdout || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      installed: true,
      version,
      remotes,
      remoteDetails,
      configPath,
      configContent: configDump,
      runningJobs,
      cronJobs,
      serverSpecs,
    });
  } catch (error) {
    console.error('[rclone/status] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
