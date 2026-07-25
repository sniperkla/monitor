import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

export async function POST(req) {
  try {
    const { connectionId } = await req.json();

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);

    // Multi-fallback installer script: official script -> apt-get -> yum -> apk
    const installScript = `
if command -v rclone >/dev/null 2>&1; then
  echo "Rclone is already installed."
  rclone version
  exit 0
fi

echo "🚀 Starting 1-click Rclone Installation..."

if command -v curl >/dev/null 2>&1; then
  curl https://rclone.org/install.sh | bash || true
elif command -v wget >/dev/null 2>&1; then
  wget -qO- https://rclone.org/install.sh | bash || true
fi

if ! command -v rclone >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y rclone
  elif command -v yum >/dev/null 2>&1; then
    yum install -y rclone
  elif command -v apk >/dev/null 2>&1; then
    apk add rclone
  fi
fi

if command -v rclone >/dev/null 2>&1; then
  echo "✅ Rclone installed successfully!"
  rclone version
else
  echo "❌ Rclone installation failed. Please install rclone manually."
  exit 1
fi
`.trim();

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
    }, { status: 500 });

  } catch (error) {
    console.error('[rclone/install] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
