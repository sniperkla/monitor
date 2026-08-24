import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

/**
 * GET  — check whether ClamAV is installed on the target server (+ version).
 * POST — install ClamAV via the system package manager and update signatures
 *        with freshclam. Long-running (~1-5 min depending on network).
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ success: false, error: 'Missing field: connectionId' }, { status: 400 });

    const sshConfig = await getSshConfig(connectionId, { userId });
    const r = await execCommand(sshConfig,
      `(clamscan --version 2>/dev/null || clamdscan --version 2>/dev/null) | head -n 1`,
      { timeoutMs: 15000 }
    );
    const versionLine = (r.stdout || '').trim();
    return NextResponse.json({
      success: true,
      available: !!versionLine && !versionLine.includes('not found'),
      version: versionLine || null,
    });
  } catch (error) {
    console.error('[virus-scan/clamav] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Check failed' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;

    let body;
    try { body = await request.json(); } catch (_) {}
    const connectionId = body?.connectionId;
    if (!connectionId) return NextResponse.json({ success: false, error: 'Missing field: connectionId' }, { status: 400 });

    const sshConfig = await getSshConfig(connectionId, { userId });
    // Detect package manager and install clamav + run freshclam to pull the
    // latest signature database from Cisco Talos (the trusted upstream).
    const cmd =
      `if command -v apt-get >/dev/null 2>&1; then PM="apt-get"; ` +
      `elif command -v dnf >/dev/null 2>&1; then PM="dnf"; ` +
      `elif command -v yum >/dev/null 2>&1; then PM="yum"; ` +
      `elif command -v apk >/dev/null 2>&1; then PM="apk"; else echo NOPM; exit 0; fi; ` +
      `echo "PKG:$PM"; ` +
      `case "$PM" in ` +
      `  apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y clamav clamav-daemon >/dev/null 2>&1 ;; ` +
      `  dnf) dnf install -y clamav clamav-update >/dev/null 2>&1 ;; ` +
      `  yum) yum install -y clamav clamav-update >/dev/null 2>&1 ;; ` +
      `  apk) apk add --no-cache clamav >/dev/null 2>&1 ;; ` +
      `esac; ` +
      `(freshclam --quiet 2>/dev/null || /usr/bin/freshclam --quiet 2>/dev/null); ` +
      `clamscan --version 2>/dev/null | head -n 1`;

    const r = await execCommand(sshConfig, cmd, { timeoutMs: 570000 }); // up to ~9.5 min
    const out = (r.stdout || '').trim();
    if (out.includes('NOPM')) {
      return NextResponse.json({ success: false, error: 'No supported package manager found (apt/dnf/yum/apk)' }, { status: 400 });
    }
    const version = out.split('\n').pop()?.trim();
    if (!version || version.includes('not found')) {
      return NextResponse.json({ success: false, error: 'Installation finished but clamscan was not found — check the server logs' }, { status: 500 });
    }
    return NextResponse.json({ success: true, message: `ClamAV installed: ${version}`, version });
  } catch (error) {
    console.error('[virus-scan/clamav] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Install failed' }, { status: 500 });
  }
}