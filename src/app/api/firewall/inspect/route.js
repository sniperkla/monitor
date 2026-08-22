import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

const INSPECTION_SCRIPT = String.raw`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else return 127; fi; }
echo "===ACCESS==="
if [ "$(id -u)" = "0" ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo limited; fi
echo "===IPSET==="
if command -v ipset >/dev/null 2>&1 && run ipset list monitor_blocklist >/dev/null 2>&1; then
  echo present
  run ipset list monitor_blocklist | awk -F': ' '/Number of entries:/{print "entries=" $2}'
  run ipset list monitor_blocklist | sed -n '/^Members:/,$p' | sed '1d' | head -n 12
else
  echo missing
fi
echo "===RULE==="
if command -v iptables >/dev/null 2>&1; then
  echo "--- INPUT Chain (Host Ports) ---"
  run iptables -S INPUT 2>/dev/null | grep -- '--match-set monitor_blocklist src' || echo "No monitor_blocklist rule in INPUT"
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then
    echo "--- DOCKER-USER Chain (Docker Containers) ---"
    run iptables -S DOCKER-USER 2>/dev/null | grep -- '--match-set monitor_blocklist src' || echo "No monitor_blocklist rule in DOCKER-USER"
  fi
  echo "--- FORWARD Chain (Routed/Bridged Containers) ---"
  run iptables -S FORWARD 2>/dev/null | grep -- '--match-set monitor_blocklist src' || echo "No monitor_blocklist rule in FORWARD"
fi
echo "===RESTORE==="
systemctl is-enabled monitor-blocklist-restore.service 2>/dev/null || true
systemctl is-active monitor-blocklist-restore.service 2>/dev/null || true
echo "===SNAPSHOT==="
if [ -f /var/lib/monitor-firewall/monitor_blocklist.ipset ]; then
  echo present
  stat -c 'modified=%y' /var/lib/monitor-firewall/monitor_blocklist.ipset 2>/dev/null || true
  stat -c 'bytes=%s' /var/lib/monitor-firewall/monitor_blocklist.ipset 2>/dev/null || true
else
  echo missing
fi
`;

const section = (text, name) => text.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?====|$)`))?.[1]?.trim() || '';
const field = (text, name, fallback = null) => text.match(new RegExp(`(?:^|\\n)${name}=([^\\n]+)`))?.[1]?.trim() || fallback;

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });

    const sshConfig = await getSshConfig(connectionId, {
      sshMode: request.headers.get('x-ssh-mode'),
      preferredRelay: request.headers.get('x-preferred-relay'),
    });
    const result = await execCommand(sshConfig, INSPECTION_SCRIPT, { pool: false });
    if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Could not inspect the firewall on this server.');

    const ipset = section(result.stdout, 'IPSET');
    const snapshot = section(result.stdout, 'SNAPSHOT');
    const restore = section(result.stdout, 'RESTORE').split(/\r?\n/).filter(Boolean);
    const samples = ipset.split(/\r?\n/).filter(line => line && line !== 'present' && !line.startsWith('entries=')).slice(0, 12);
    const rule = section(result.stdout, 'RULE').split(/\r?\n/).filter(Boolean)[0] || '';

    return NextResponse.json({
      success: true,
      inspectedAt: new Date().toISOString(),
      access: section(result.stdout, 'ACCESS') || 'limited',
      ipset: { present: ipset.startsWith('present'), entries: Number(field(ipset, 'entries', '0')) || 0, samples },
      rule: { active: Boolean(rule), value: rule },
      restore: { enabled: restore.includes('enabled'), active: restore.includes('active'), states: restore },
      snapshot: { present: snapshot.startsWith('present'), modified: field(snapshot, 'modified'), bytes: Number(field(snapshot, 'bytes', '0')) || 0 },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not inspect firewall configuration' }, { status: 500 });
  }
}
