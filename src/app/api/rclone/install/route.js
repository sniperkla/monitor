import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

function quote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function POST(req) {
  try {
    const { connectionId } = await req.json();

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const sessionName = `rclone-install-${Date.now()}`;
    const logFile = `/tmp/${sessionName}.log`;

    // Installer script writing output to logFile
    const installScript = [
      'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"',
      'echo "🚀 [1/4] Starting Rclone Installation on $(hostname)..."',
      'echo "--------------------------------------------------"',
      'if command -v rclone >/dev/null 2>&1 || [ -x "$HOME/.local/bin/rclone" ]; then',
      '  echo "✅ Rclone is already installed on this server!"',
      '  rclone version 2>/dev/null || "$HOME/.local/bin/rclone" version',
      '  echo "🎉 [4/4] Verifying installation..."',
      '  echo "✅ SUCCESS! Rclone is ready for cloud backup!"',
      '  exit 0',
      'fi',
      'echo "📦 [2/4] Detecting server OS & Architecture..."',
      'ARCH="$(uname -m)"',
      'OS="$(uname -s | tr \'[:upper:]\' \'[:lower:]\')"',
      'echo "    Detected OS: ${OS}, Arch: ${ARCH}"',
      'if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then',
      '  echo "🔑 Running official system installer with sudo..."',
      '  if ! command -v unzip >/dev/null 2>&1; then',
      '    echo "    Installing unzip..."',
      '    sudo yum install -y unzip 2>/dev/null || sudo dnf install -y unzip 2>/dev/null || sudo apt-get install -y unzip 2>/dev/null || true',
      '  fi',
      '  curl -fsSL https://rclone.org/install.sh | sudo bash || true',
      'fi',
      'if ! command -v rclone >/dev/null 2>&1; then',
      '  echo "⬇️ [3/4] Running standalone non-root binary installer..."',
      '  mkdir -p "$HOME/.local/bin"',
      '  if [ "$ARCH" = "x86_64" ]; then RARCH="amd64"',
      '  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then RARCH="arm64"',
      '  elif [ "$ARCH" = "armv7l" ]; then RARCH="arm-v7"',
      '  else RARCH="amd64"; fi',
      '  TMP_DIR="$(mktemp -d 2>/dev/null || echo /tmp/rclone-inst)"',
      '  mkdir -p "$TMP_DIR"',
      '  URL="https://downloads.rclone.org/rclone-current-${OS}-${RARCH}.zip"',
      '  echo "    Fetching package: ${URL}"',
      '  if command -v curl >/dev/null 2>&1; then',
      '    curl -fsSL "${URL}" -o "${TMP_DIR}/rclone.zip"',
      '  elif command -v wget >/dev/null 2>&1; then',
      '    wget -qO "${TMP_DIR}/rclone.zip" "${URL}"',
      '  fi',
      '  if [ -f "${TMP_DIR}/rclone.zip" ]; then',
      '    echo "    Extracting binary into $HOME/.local/bin..."',
      '    unzip -q -o "${TMP_DIR}/rclone.zip" -d "${TMP_DIR}" </dev/null || python3 -c "import zipfile; zipfile.ZipFile(\'${TMP_DIR}/rclone.zip\').extractall(\'${TMP_DIR}\')" 2>/dev/null || true',
      '    BIN_FILE="$(find "${TMP_DIR}" -name rclone -type f | head -n 1)"',
      '    if [ -n "${BIN_FILE}" ]; then',
      '      cp "${BIN_FILE}" "$HOME/.local/bin/rclone"',
      '      chmod +x "$HOME/.local/bin/rclone"',
      '      echo "✅ Rclone executable installed to $HOME/.local/bin/rclone"',
      '    fi',
      '    rm -rf "${TMP_DIR}"',
      '  fi',
      'fi',
      'echo "🎉 [4/4] Verifying installation..."',
      'if command -v rclone >/dev/null 2>&1 || [ -x "$HOME/.local/bin/rclone" ]; then',
      '  echo "✅ SUCCESS! Rclone installed and ready for cloud backup!"',
      '  "$HOME/.local/bin/rclone" version 2>/dev/null || rclone version',
      '  exit 0',
      'else',
      '  echo "❌ Installation failed. Please check internet connection on server."',
      '  exit 1',
      'fi'
    ].join('\n');

    const b64Script = Buffer.from(installScript).toString('base64');
    const decodeCmd = `(base64 -d 2>/dev/null || base64 -D 2>/dev/null || base64 --decode 2>/dev/null || openssl base64 -d 2>/dev/null)`;

    // Ensure log file exists with initial header so polling shows progress immediately
    const initCmd = `echo ${quote("🚀 Initializing Rclone installer...\n--------------------------------------------------")} > ${quote(logFile)}`;
    await execCommand(sshConfig, initCmd);

    // Run inside tmux session if available, fallback to nohup
    const runnerCmd = [
      `if command -v tmux >/dev/null 2>&1; then`,
      `  tmux kill-session -t "${sessionName}" 2>/dev/null || true`,
      `  tmux new-session -d -s "${sessionName}"`,
      `  tmux send-keys -t "${sessionName}" "echo ${b64Script} | ${decodeCmd} > /tmp/${sessionName}.sh && bash /tmp/${sessionName}.sh 2>&1 | tee -a ${logFile}; exit" Enter`,
      `  echo "TMUX_SESSION=${sessionName}"`,
      `else`,
      `  echo ${b64Script} | ${decodeCmd} > /tmp/${sessionName}.sh`,
      `  nohup bash /tmp/${sessionName}.sh >> ${logFile} 2>&1 & echo "PID=$!"`,
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
        tmux: result.stdout.includes('TMUX_SESSION='),
      });
    }

    // Fallback synchronous execution if background launch failed
    const syncRes = await execCommand(sshConfig, installScript);
    return NextResponse.json({
      success: syncRes.code === 0,
      output: syncRes.stdout || syncRes.stderr,
      error: syncRes.code !== 0 ? (syncRes.stderr.trim() || syncRes.stdout.trim() || 'Failed to install Rclone') : null,
    });

  } catch (error) {
    logger.error('[rclone/install POST] error:', error.message);
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
    const logRes = await execCommand(sshConfig, `cat "${logFile}" 2>/dev/null || echo "Initializing tmux terminal log..."`);
    
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
    logger.error('[rclone/install GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
