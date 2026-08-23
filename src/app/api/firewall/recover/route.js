import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

const DIR = '/var/lib/monitor-firewall';
const PENDING = `${DIR}/rollback.pending`;
const LOG = `${DIR}/rollback.log`;

/**
 * Last-resort recovery endpoint.
 *
 *  GET  ?connectionId= → { armed, lastLog } — is the auto-revert watchdog pending?
 *  POST { connectionId, action } where action is:
 *   - 'confirm'  : disarm the watchdog (called automatically after the app's
 *                  first successful status poll following an apply)
 *   - 'rollback' : run the last-resort script NOW — removes the blocklist rules,
 *                  set, and restore services immediately (emergency disable)
 */
async function ssh(request, connectionId) {
  return getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
}

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    const result = await execCommand(await ssh(request, connectionId), String.raw`
if [ -f ${PENDING} ]; then echo "armed=true"; else echo "armed=false"; fi
tail -n 5 ${LOG} 2>/dev/null || true
`, { pool: false });
    const out = result.stdout || '';
    return NextResponse.json({
      success: true,
      armed: /armed=true/.test(out),
      lastLog: out.split(/\r?\n/).filter(l => l && !/^armed=/.test(l)).join('\n') || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not read recovery state' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, action } = await request.json();
    if (!connectionId || !['confirm', 'rollback'].includes(action)) {
      return NextResponse.json({ success: false, error: 'connectionId and action (confirm|rollback) are required.' }, { status: 400 });
    }

    // Elevate like every other firewall route: root directly, otherwise
    // passwordless sudo — otherwise iptables/systemctl fail with permission denied.
    const run = String.raw`run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE: rollback needs root or passwordless sudo" >&2; exit 41; fi; }`;

    const script = action === 'confirm'
      ? String.raw`
set -eu
${run}
run rm -f ${PENDING}
run sh -c 'echo "[$(date -Is)] Access confirmed by manager — safety net disarmed." >> ${LOG}'
echo CONFIRMED
`
      : String.raw`
set -eu
${run}
run sh ${DIR}/last-resort.sh 2>/dev/null || {
  # Script missing (older apply) — inline the same rollback
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
  for SET in monitor_all monitor_blocklist; do
    while run iptables -C INPUT -m set --match-set "$SET" src -j DROP 2>/dev/null; do run iptables -D INPUT -m set --match-set "$SET" src -j DROP; done
    while run iptables -C FORWARD -m set --match-set "$SET" src -j DROP 2>/dev/null; do run iptables -D FORWARD -m set --match-set "$SET" src -j DROP; done
    if run iptables -L DOCKER-USER >/dev/null 2>&1; then
      while run iptables -C DOCKER-USER -m set --match-set "$SET" src -j DROP 2>/dev/null; do run iptables -D DOCKER-USER -m set --match-set "$SET" src -j DROP; done
    fi
  done
  run ipset destroy monitor_all 2>/dev/null || true
  run ipset destroy monitor_blocklist 2>/dev/null || true
  run ipset destroy monitor_manual_blocks 2>/dev/null || true
  run systemctl disable --now monitor-blocklist-restore.service 2>/dev/null || true
  run systemctl disable --now monitor-docker-firewall-hook.service 2>/dev/null || true
  run rm -f ${PENDING}
}
run sh -c 'echo "[$(date -Is)] Emergency rollback executed from app." >> ${LOG}'
echo ROLLED_BACK
`;

    const result = await execCommand(await ssh(request, connectionId), script, { pool: false });
    if (result.code !== 0) return NextResponse.json({ success: false, error: result.stderr?.trim() || 'Recovery action failed.' }, { status: 500 });
    return NextResponse.json({
      success: true,
      message: action === 'confirm'
        ? 'Safety net disarmed — firewall confirmed reachable.'
        : 'Emergency rollback complete: blocklist rules, set, and restore services removed.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Recovery failed' }, { status: 500 });
  }
}
