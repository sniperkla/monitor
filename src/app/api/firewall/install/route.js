import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};

const INSTALL_SCRIPT = String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
if command -v ipset >/dev/null 2>&1 && command -v iptables >/dev/null 2>&1; then echo "ALREADY_READY"; exit 0; fi
if command -v apt-get >/dev/null 2>&1; then
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y ipset iptables
elif command -v dnf >/dev/null 2>&1; then
  run dnf install -y ipset iptables
elif command -v yum >/dev/null 2>&1; then
  run yum install -y ipset iptables
elif command -v apk >/dev/null 2>&1; then
  run apk add --no-cache ipset iptables
elif command -v pacman >/dev/null 2>&1; then
  run pacman --noconfirm -Sy ipset iptables
elif command -v zypper >/dev/null 2>&1; then
  run zypper --non-interactive install ipset iptables
else
  echo "PACKAGE_MANAGER_UNSUPPORTED" >&2
  exit 44
fi
command -v ipset >/dev/null 2>&1 && command -v iptables >/dev/null 2>&1 || { echo "INSTALL_INCOMPLETE" >&2; exit 45; }
echo "INSTALLED"
`;

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, confirmation } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    if (!matchesConfirmation(confirmation)) return NextResponse.json({ success: false, error: 'Type confirm to confirm package installation.' }, { status: 400 });
    const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
    const result = await execCommand(sshConfig, INSTALL_SCRIPT, { pool: false });
    if (result.code !== 0) return NextResponse.json({ success: false, error: result.stderr?.trim() || 'Firewall tools could not be installed.' }, { status: 500 });
    return NextResponse.json({ success: true, alreadyReady: result.stdout.includes('ALREADY_READY'), message: 'IPSet and iptables are ready.' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not install firewall tools' }, { status: 500 });
  }
}
