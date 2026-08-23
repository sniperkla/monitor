import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { getConflictingEntries, parseBlocklistLine, remoteClientIps, normalizeEntry, MAX_BLOCKLIST_ENTRIES, COMPOSITE_SET, MANUAL_SET, buildDropRuleCommands } from '@/lib/firewallBlocklist';

const SNAPSHOT = '/var/lib/monitor-firewall/monitor_blocklist.ipset';
const SERVICE = 'monitor-blocklist-restore.service';

// Removes DROP rules matching both the composite set and the legacy
// single-set deploys, in every chain the firewall installs them in.
const purgeDropRules = (indent = '') => [
  ...['INPUT', 'FORWARD'].map(chain =>
    `${indent}while run iptables -C ${chain} -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null; do run iptables -D ${chain} -m set --match-set ${COMPOSITE_SET} src -j DROP; done`,
  ),
  `${indent}if run iptables -L DOCKER-USER >/dev/null 2>&1; then`,
  `${indent}  while run iptables -C DOCKER-USER -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null; do run iptables -D DOCKER-USER -m set --match-set ${COMPOSITE_SET} src -j DROP; done`,
  `${indent}fi`,
  ...['INPUT', 'FORWARD'].map(chain =>
    `${indent}while run iptables -C ${chain} -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do run iptables -D ${chain} -m set --match-set monitor_blocklist src -j DROP; done`,
  ),
  `${indent}if run iptables -L DOCKER-USER >/dev/null 2>&1; then`,
  `${indent}  while run iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do run iptables -D DOCKER-USER -m set --match-set monitor_blocklist src -j DROP; done`,
  `${indent}fi`,
].join('\n');

const scripts = {
  disable: String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
run systemctl disable --now ${SERVICE} 2>/dev/null || true
run systemctl stop monitor-docker-firewall-hook.service 2>/dev/null || true
${purgeDropRules()}
echo DISABLED
`,
  reactivate: String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
if [ "$(id -u)" = "0" ]; then test -r ${SNAPSHOT}; elif sudo -n test -r ${SNAPSHOT} 2>/dev/null; then :; else echo "SNAPSHOT_MISSING" >&2; exit 44; fi
# The snapshot carries feed + manual + composite sets (children listed first)
run sh -c 'ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist; ipset create ${MANUAL_SET} hash:net family inet hashsize 1024 maxelem 500 -exist; ipset create ${COMPOSITE_SET} list:set -exist; ipset add ${COMPOSITE_SET} monitor_blocklist -exist; ipset add ${COMPOSITE_SET} ${MANUAL_SET} -exist; ipset restore -exist < ${SNAPSHOT}'
${buildDropRuleCommands()}
# Admin allowlist — re-install ACCEPT rules above the blocklist if present
if run ipset list monitor_allowlist >/dev/null 2>&1; then
  run iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then
    run iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT
  fi
  run iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT
fi
if command -v systemctl >/dev/null 2>&1; then
  run systemctl enable --now ${SERVICE} 2>/dev/null || run systemctl enable ${SERVICE} 2>/dev/null || true
  run systemctl restart monitor-docker-firewall-hook.service 2>/dev/null || run systemctl start monitor-docker-firewall-hook.service 2>/dev/null || true
fi
echo REACTIVATED
`,
  remove: String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
if command -v systemctl >/dev/null 2>&1; then
  run systemctl disable --now ${SERVICE} 2>/dev/null || run systemctl disable ${SERVICE} 2>/dev/null || true
  run systemctl disable --now monitor-docker-firewall-hook.service 2>/dev/null || true
fi
${purgeDropRules()}
# Clean the admin allowlist too
while run iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null; do run iptables -D INPUT -m set --match-set monitor_allowlist src -j ACCEPT; done
while run iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null; do run iptables -D FORWARD -m set --match-set monitor_allowlist src -j ACCEPT; done
if run iptables -L DOCKER-USER >/dev/null 2>&1; then
  while run iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null; do run iptables -D DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT; done
fi
run ipset destroy ${COMPOSITE_SET} 2>/dev/null || true
run ipset destroy monitor_blocklist 2>/dev/null || true
run ipset destroy monitor_blocklist_next 2>/dev/null || true
run ipset destroy ${MANUAL_SET} 2>/dev/null || true
run ipset destroy monitor_allowlist 2>/dev/null || true
run rm -f ${SNAPSHOT} /var/lib/monitor-firewall/monitor_allowlist.ipset /etc/systemd/system/${SERVICE} \
  /etc/systemd/system/monitor-docker-firewall-hook.service \
  /usr/local/bin/monitor-docker-firewall-hook.sh
if command -v systemctl >/dev/null 2>&1; then
  run systemctl daemon-reload || true
fi
echo REMOVED
`,
};

const confirmationFor = { disable: 'DISABLE BLOCKLIST', reactivate: 'REACTIVATE BLOCKLIST', remove: 'REMOVE BLOCKLIST' };
const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};

async function readSnapshotEntries(sshConfig) {
  const result = await execCommand(sshConfig, String.raw`
set -eu
if [ "$(id -u)" = "0" ]; then cat ${SNAPSHOT}; elif sudo -n true 2>/dev/null; then sudo -n cat ${SNAPSHOT}; else exit 41; fi
`, { pool: false });
  if (result.code !== 0) throw new Error('Saved blocklist snapshot is missing. Import a list and apply it again first.');
  return (result.stdout || '').split(/\r?\n/).map(parseBlocklistLine).filter(Boolean);
}

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, action, confirmation, protectedIps = [] } = await request.json();
    if (!connectionId || !scripts[action]) return NextResponse.json({ success: false, error: 'A valid connection and action are required.' }, { status: 400 });
    if (!matchesConfirmation(confirmation)) return NextResponse.json({ success: false, error: 'Type confirm to confirm this change.' }, { status: 400 });

    const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
    if (action === 'reactivate') {
      const protection = [...new Set([
        ...remoteClientIps(request.headers),
        ...protectedIps.map(normalizeEntry).filter(Boolean).map(ip => ip.split('/')[0]),
      ])];
      if (!protection.length) return NextResponse.json({ success: false, error: 'Your current IP could not be detected. Add a protected SSH or VPN IP before reactivating.' }, { status: 400 });
      const conflicts = getConflictingEntries(await readSnapshotEntries(sshConfig), protection);
      if (conflicts.length) return NextResponse.json({ success: false, error: 'Reactivation blocked to prevent self-lockout.', conflicts }, { status: 409 });
    }

    const result = await execCommand(sshConfig, scripts[action], { pool: false });
    if (result.code !== 0) return NextResponse.json({ success: false, error: result.stderr?.trim() || `Could not ${action} the blocklist.` }, { status: 500 });
    return NextResponse.json({ success: true, action, message: action === 'disable' ? 'Blocklist disabled; its saved snapshot is kept for reactivation.' : action === 'reactivate' ? 'Blocklist reactivated and set to restore after reboot.' : 'Blocklist rule, set, snapshot, and restore service removed.' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not manage the blocklist' }, { status: 500 });
  }
}
