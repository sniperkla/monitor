import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

export async function POST(req) {
  try {
    const { connectionId } = await req.json();

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);

    // Fixed Universal Rclone Installer with explicit shell variable escaping
    const installScript = `
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"

if command -v rclone >/dev/null 2>&1; then
  echo "✅ Rclone is already installed."
  rclone version
  exit 0
fi

echo "🚀 Installing Rclone..."

# 1. Try official installer if root or passwordless sudo
if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
  curl -fsSL https://rclone.org/install.sh | sudo bash 2>/dev/null || true
fi

# 2. Portable Standalone Binary Fallback (No root / sudo required!)
if ! command -v rclone >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  ARCH="$(uname -m)"
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  
  if [ "$ARCH" = "x86_64" ]; then RARCH="amd64"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then RARCH="arm64"
  elif [ "$ARCH" = "armv7l" ]; then RARCH="arm-v7"
  else RARCH="amd64"; fi

  TMP_DIR="$(mktemp -d 2>/dev/null || echo /tmp/rclone-inst)"
  mkdir -p "$TMP_DIR"
  
  URL="https://downloads.rclone.org/rclone-current-"
  URL="\${URL}\${OS}-\${RARCH}.zip"
  
  echo "Downloading standalone binary from \${URL}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "\${URL}" -o "\${TMP_DIR}/rclone.zip"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "\${TMP_DIR}/rclone.zip" "\${URL}"
  fi

  if [ -f "\${TMP_DIR}/rclone.zip" ]; then
    unzip -q -o "\${TMP_DIR}/rclone.zip" -d "\${TMP_DIR}" </dev/null || python3 -c "import zipfile; zipfile.ZipFile('\${TMP_DIR}/rclone.zip').extractall('\${TMP_DIR}')" 2>/dev/null || true
    BIN_FILE="$(find "\${TMP_DIR}" -name rclone -type f | head -n 1)"
    if [ -n "\${BIN_FILE}" ]; then
      cp "\${BIN_FILE}" "$HOME/.local/bin/rclone"
      chmod +x "$HOME/.local/bin/rclone"
      echo "✅ Rclone binary placed in $HOME/.local/bin/rclone"
    fi
    rm -rf "\${TMP_DIR}"
  fi
fi

# 3. System package manager fallback
if ! command -v rclone >/dev/null 2>&1 && ! [ -x "$HOME/.local/bin/rclone" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo -n apt-get update -qq && sudo -n apt-get install -y rclone || true
  elif command -v yum >/dev/null 2>&1; then
    sudo -n yum install -y rclone || true
  fi
fi

# Final Verification
if command -v rclone >/dev/null 2>&1 || [ -x "$HOME/.local/bin/rclone" ]; then
  echo "✅ Rclone installed successfully!"
  "$HOME/.local/bin/rclone" version 2>/dev/null || rclone version
  exit 0
else
  echo "❌ Rclone installation failed. Please check network connectivity or install rclone manually."
  exit 1
fi
`.replace(/\${/g, '${'); // Ensure JS template string preserves shell ${var} syntax

    const result = await execCommand(sshConfig, installScript);

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        output: result.stdout || 'Installation completed',
      });
    }

    return NextResponse.json({
      success: false,
      error: result.stderr.trim() || result.stdout.trim() || 'Rclone installation failed',
      details: result.stdout + '\n' + result.stderr,
    }, { status: 500 });

  } catch (error) {
    console.error('[rclone/install] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
