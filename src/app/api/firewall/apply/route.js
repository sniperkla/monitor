import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { getConflictingEntries, normalizeEntry, remoteClientIps, MAX_BLOCKLIST_ENTRIES } from '@/lib/firewallBlocklist';

const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};

const wantsProgress = (request) => request.headers.get('accept')?.includes('application/x-ndjson');

function progressStream(run) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      Promise.resolve(run(emit))
        .then((result) => emit({ type: 'complete', progress: 100, ...result }))
        .catch((error) => emit({ type: 'error', error: error.message || 'Could not apply blocklist' }))
        .finally(() => controller.close());
    },
  });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

function remoteProgressReporter(emit) {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.forEach((line) => {
      const match = line.match(/^MONITOR_PROGRESS\|(\d+)\|(.+)$/);
      if (match) emit({ type: 'progress', progress: Number(match[1]), message: match[2] });
    });
  };
}

function buildApplyScript(entries) {
  const encodedEntries = Buffer.from(entries.join('\n') + '\n', 'utf8').toString('base64');
  return String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
WORK_FILE="/tmp/monitor-blocklist-$$.txt"
trap 'rm -f "$WORK_FILE"' EXIT
echo "MONITOR_PROGRESS|18|Preparing the validated blocklist"
printf '%s' '${encodedEntries}' | base64 -d > "$WORK_FILE"
echo "MONITOR_PROGRESS|42|Creating the isolated replacement IPSet"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
echo "MONITOR_PROGRESS|58|Loading entries into the replacement set"
while IFS= read -r entry; do [ -n "$entry" ] && run ipset add monitor_blocklist_next "$entry" -exist; done < "$WORK_FILE"
echo "MONITOR_PROGRESS|76|Atomically switching the active protection"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true
run iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_blocklist src -j DROP
echo "MONITOR_PROGRESS|88|Saving the reboot recovery configuration"
run install -d -m 700 /var/lib/monitor-firewall
run sh -c 'ipset save monitor_blocklist > /var/lib/monitor-firewall/monitor_blocklist.ipset'
run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "ipset restore -exist < /var/lib/monitor-firewall/monitor_blocklist.ipset; iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || iptables -I INPUT 1 -m set --match-set monitor_blocklist src -j DROP"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'
run systemctl daemon-reload
run systemctl enable monitor-blocklist-restore.service
echo "MONITOR_PROGRESS|96|Verifying the firewall configuration"
echo "APPLIED=$(wc -l < \"$WORK_FILE\" | tr -d ' ')"
`;
}

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, entries, protectedIps = [], confirmation } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    if (!matchesConfirmation(confirmation)) return NextResponse.json({ success: false, error: 'Type confirm to confirm this firewall change.' }, { status: 400 });
    if (!Array.isArray(entries) || entries.length === 0) return NextResponse.json({ success: false, error: 'No valid blocklist entries were provided.' }, { status: 400 });

    const cleanEntries = [...new Set(entries.map(normalizeEntry).filter(Boolean))];
    if (cleanEntries.length !== entries.length || cleanEntries.length > MAX_BLOCKLIST_ENTRIES || cleanEntries.some(entry => isIP(entry.split('/')[0]) !== 4)) return NextResponse.json({ success: false, error: 'The blocklist contains invalid, unsupported IPv6, or too many entries.' }, { status: 400 });
    const automaticProtection = remoteClientIps(request.headers);
    const allProtection = [...new Set([...automaticProtection, ...protectedIps.map(normalizeEntry).filter(Boolean).map(ip => ip.split('/')[0])])];
    const conflicts = allProtection.length ? getConflictingEntries(cleanEntries, allProtection) : [];
    if (conflicts.length) return NextResponse.json({ success: false, error: 'Blocked to prevent self-lockout.', conflicts }, { status: 409 });

    const runApply = async (emit) => {
      emit?.({ type: 'progress', progress: 5, message: 'Connecting securely to the server' });
      const sshConfig = await getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
      emit?.({ type: 'progress', progress: 12, message: 'Starting the safe replacement process' });
      const result = await execCommand(sshConfig, buildApplyScript(cleanEntries), {
        pool: false,
        onStdout: emit ? remoteProgressReporter(emit) : undefined,
      });
      if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Firewall update failed before it could be applied.');
      return { success: true, entries: cleanEntries.length, protectedIps: allProtection, message: 'Blocklist applied and configured to restore after reboot.' };
    };

    if (wantsProgress(request)) return progressStream(runApply);
    const result = await runApply();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not apply blocklist' }, { status: 500 });
  }
}
