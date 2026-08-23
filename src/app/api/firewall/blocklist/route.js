import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { getConflictingEntries, normalizeEntry, remoteClientIps, COMPOSITE_SET, MANUAL_SET, buildManualSetCommands, buildDropRuleCommands, buildSnapshotSaveCommands, buildRestoreServiceExec, buildAllowlistRestoreFragment } from '@/lib/firewallBlocklist';

/**
 * GET /api/firewall/blocklist?connectionId=&ip=1.2.3.4
 *
 * Membership check against the live blocklist: is this IP (or a range
 * covering it) currently blocked on the server? Checks the composite set
 * (feed + manual quick blocks), falling back to a legacy feed-only set on
 * servers not yet re-applied since the list:set migration.
 */
export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    const ip = normalizeEntry(new URL(request.url).searchParams.get('ip') || '');
    if (!connectionId || !ip || ip.includes('/') || isIP(ip.split('/')[0]) !== 4) {
      return NextResponse.json({ success: false, error: 'connectionId and a valid IPv4 address are required.' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
    const result = await execCommand(sshConfig, String.raw`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else exit 41; fi; }
LOOKUP_SET="${COMPOSITE_SET}"
if ! run ipset list "$LOOKUP_SET" >/dev/null 2>&1; then
  if run ipset list monitor_blocklist >/dev/null 2>&1; then LOOKUP_SET=monitor_blocklist; else echo "NOT_ACTIVE"; exit 0; fi
fi
if run ipset test "$LOOKUP_SET" ${ip} >/dev/null 2>&1; then echo "BLOCKED"; else echo "NOT_BLOCKED"; fi
`, { pool: false });

    const out = (result.stdout || '').trim();
    if (out.includes('NOT_ACTIVE')) {
      return NextResponse.json({ success: true, active: false, blocked: false, message: 'The blocklist is not active on this server.' });
    }
    return NextResponse.json({ success: true, active: true, blocked: out.includes('BLOCKED') });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not check the blocklist' }, { status: 500 });
  }
}

/**
 * POST /api/firewall/blocklist
 *
 * Live-edit the manual quick-block set without importing a file:
 * body { connectionId, mode: 'add' | 'remove', entries: ['1.2.3.4', '5.6.7.0/24'], protectedIps }
 * Updates the monitor_manual_blocks ipset (a member of the monitor_all
 * composite the DROP rules match), so quick blocks survive every feed
 * re-apply and scheduled sync. Keeps the saved snapshot and the restore
 * service in sync.
 */
export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, mode, entries = [], protectedIps = [] } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    if (mode !== 'add' && mode !== 'remove') return NextResponse.json({ success: false, error: 'mode must be add or remove' }, { status: 400 });
    if (!Array.isArray(entries) || entries.length === 0) return NextResponse.json({ success: false, error: 'entries are required' }, { status: 400 });
    if (entries.length > 500) return NextResponse.json({ success: false, error: 'At most 500 entries per request.' }, { status: 400 });

    const clean = [...new Set(entries.map(normalizeEntry).filter(Boolean))];
    if (clean.length !== entries.length || clean.some(entry => isIP(entry.split('/')[0]) !== 4)) {
      return NextResponse.json({ success: false, error: 'Entries must be valid IPv4 addresses or CIDR ranges.' }, { status: 400 });
    }

    // Never allow blocking a protected/whitelisted IP
    if (mode === 'add') {
      const protection = [...new Set([
        ...remoteClientIps(request.headers),
        ...protectedIps.map(normalizeEntry).filter(Boolean).map(ip => ip.split('/')[0]),
      ])];
      const conflicts = getConflictingEntries(clean, protection);
      if (conflicts.length) return NextResponse.json({ success: false, error: 'Blocked to prevent self-lockout.', conflicts }, { status: 409 });
    }

    const encoded = Buffer.from(clean.join('\n') + '\n', 'utf8').toString('base64');
    const entryCmds = mode === 'add'
      ? `printf '%s' '${encoded}' | base64 -d | while IFS= read -r entry; do [ -n "$entry" ] && run ipset add ${MANUAL_SET} "$entry" -exist; done`
      : `printf '%s' '${encoded}' | base64 -d | while IFS= read -r entry; do [ -n "$entry" ] && run ipset del ${MANUAL_SET} "$entry" -exist || true; done`;
    const restoreExec = buildRestoreServiceExec(buildAllowlistRestoreFragment());

    const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
    const result = await execCommand(sshConfig, String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
run ipset list monitor_blocklist >/dev/null 2>&1 || run ipset list ${COMPOSITE_SET} >/dev/null 2>&1 || { echo "BLOCKLIST_NOT_ACTIVE" >&2; exit 44; }
# Create the manual set + composite wiring (idempotent), then apply the edit
${buildManualSetCommands()}
${entryCmds}
# Keep the DROP rules and reboot snapshot consistent with the live sets
${buildDropRuleCommands()}
run install -d -m 700 /var/lib/monitor-firewall
${buildSnapshotSaveCommands()}
# Refresh the restore service so reboots re-enforce the manual set too
if [ -f /etc/systemd/system/monitor-blocklist-restore.service ]; then
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "${restoreExec}"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'
  run systemctl daemon-reload
fi
echo BLOCKLIST_UPDATED
`, { pool: false });

    if (result.code !== 0) {
      const stderr = result.stderr?.trim() || '';
      if (stderr.includes('BLOCKLIST_NOT_ACTIVE')) {
        return NextResponse.json({ success: false, error: 'The blocklist is not active on this server. Import and apply a list first.' }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: stderr || 'Could not update the blocklist.' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      message: `${clean.length} entr${clean.length === 1 ? 'y' : 'ies'} ${mode === 'add' ? 'added to' : 'removed from'} the live blocklist.`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not update the blocklist' }, { status: 500 });
  }
}
