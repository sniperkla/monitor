import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { buildAllowlistCommands, sanitizeProtectedIps } from '@/lib/firewallBlocklist';

/**
 * POST /api/firewall/allowlist
 *
 * Live-sync the admin allowlist on the server: body { connectionId, ips }
 * rewrites the `monitor_allowlist` ipset to exactly the given IPs (empty
 * removes it), keeps the ACCEPT rules above the blocklist DROPs, and saves
 * the snapshot so the reboot-restore service stays consistent.
 */
export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, ips = [] } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });

    const clean = sanitizeProtectedIps(ips);
    // Always (re)build the allowlist: the server's own egress IP is included
    // automatically by buildAllowlistCommands, plus the given user IPs.
    const allowlistCmds = buildAllowlistCommands(clean);
    const syncScript = String.raw`
${allowlistCmds}
run install -d -m 700 /var/lib/monitor-firewall
run sh -c 'ipset save monitor_allowlist > /var/lib/monitor-firewall/monitor_allowlist.ipset'
`;

    const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
    const result = await execCommand(sshConfig, String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
${syncScript}
echo ALLOWLIST_SYNCED
`, { pool: false });

    if (result.code !== 0) {
      return NextResponse.json({ success: false, error: result.stderr?.trim() || 'Could not update the server allowlist.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, count: clean.length, message: `Server allowlist synced (${clean.length} user IP${clean.length === 1 ? '' : 's'} + this server's own IP).` });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not update the allowlist' }, { status: 500 });
  }
}
