import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { MAX_BLOCKLIST_ENTRIES, normalizeEntry, remoteClientIps, sanitizeManualEntries, buildManualSetCommands, buildDropRuleCommands, buildSnapshotSaveCommands, buildRestoreServiceExec, buildAllowlistRestoreFragment } from '@/lib/firewallBlocklist';

const SCRIPT = '$HOME/.monitor-firewall-source-update.sh';
const LOG = '$HOME/.monitor-firewall-source-update.log';
const LOCK = '$HOME/.monitor-firewall-source-update.lock';
const MARKER = '# monitor-firewall-source-update';

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};

function validateSchedule(value) {
  const schedule = String(value || '').trim().replace(/\s+/g, ' ');
  const fields = schedule.split(' ');
  // Only numeric cron syntax is accepted. This allows intervals/ranges while
  // preventing shell syntax from being inserted into the server crontab.
  if (fields.length !== 5 || fields.some(field => !/^[0-9*/,\-]+$/.test(field))) {
    throw new Error('Enter a valid five-part cron schedule, for example */30 * * * *.');
  }
  if (fields.some(field => field.includes('/0'))) throw new Error('Cron intervals must be greater than zero.');
  return schedule;
}

const cronLine = (schedule) => `${schedule} /bin/bash ${SCRIPT} >> ${LOG} 2>&1 ${MARKER}`;

function validateSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS blocklist URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only public HTTPS blocklist URLs are allowed.');
  return url.toString();
}

function updateScript(url, protectedIps) {
  const protectedList = protectedIps.map(shellQuote).join(' ');
  const allowlistRestore = buildAllowlistRestoreFragment(protectedIps);
  const restoreExec = buildRestoreServiceExec(allowlistRestore);
  return String.raw`#!/bin/bash
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SOURCE_URL=${shellQuote(url)}
PROTECTED_IPS=(${protectedList})
LOCK_DIR=${LOCK}
if ! mkdir "$LOCK_DIR" 2>/dev/null; then echo "[$(date -Is)] Another blocklist update is already running."; exit 0; fi
trap 'rm -rf "$LOCK_DIR" "$WORK_DIR"' EXIT
WORK_DIR="$(mktemp -d /tmp/monitor-firewall-source.XXXXXX)" || exit 1
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "[$(date -Is)] ERROR: root or passwordless sudo is required."; exit 41; fi; }
echo "[$(date -Is)] Starting scheduled source update: $SOURCE_URL"
command -v curl >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: curl is required."; exit 42; }
command -v ipset >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: ipset is required."; exit 43; }
command -v iptables >/dev/null 2>&1 || { echo "[$(date -Is)] ERROR: iptables is required."; exit 44; }
echo "[$(date -Is)] Downloading source…"
curl --fail --location --proto '=https' --connect-timeout 20 --max-time 180 --retry 2 --silent --show-error "$SOURCE_URL" -o "$WORK_DIR/source.txt"
echo "[$(date -Is)] Parsing IPv4 entries…"
awk '{ sub(/#.*/, ""); if ($1 ~ /^[0-9][0-9.]*([/][0-9][0-9]?)?$/) print $1 }' "$WORK_DIR/source.txt" | LC_ALL=C sort -u > "$WORK_DIR/entries.txt"
COUNT="$(wc -l < "$WORK_DIR/entries.txt" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then echo "[$(date -Is)] ERROR: source contained no IPv4 entries."; exit 45; fi
if [ "$COUNT" -gt ${MAX_BLOCKLIST_ENTRIES} ]; then echo "[$(date -Is)] ERROR: source has $COUNT entries; safety limit is ${MAX_BLOCKLIST_ENTRIES}."; exit 46; fi
echo "[$(date -Is)] Validated $COUNT unique IPv4 entries. Building replacement set…"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
awk '{ print "add monitor_blocklist_next " $1 " -exist" }' "$WORK_DIR/entries.txt" > "$WORK_DIR/ipset.restore"
run sh -c 'ipset restore -exist < "$1"' sh "$WORK_DIR/ipset.restore"
for protected_ip in "\${PROTECTED_IPS[@]}"; do
  if run ipset test monitor_blocklist_next "$protected_ip" >/dev/null 2>&1; then
    echo "[$(date -Is)] REFUSED: downloaded list contains protected IP $protected_ip. Existing blocklist remains active."
    exit 51
  fi
done
echo "[$(date -Is)] Protection check passed. Swapping IPSet atomically…"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true
# Ensure the manual quick-block set and its composite wiring exist — the swap
# above only replaced the feed set, so quick blocks are preserved as-is.
${buildManualSetCommands()}

# 1-3. Protect Host ports, Docker published ports, and routed traffic via the
# composite set (unions feed + manual quick blocks).
${buildDropRuleCommands()}

# 4. Admin allowlist — always takes precedence over the blocklist.
#    Includes the server's own egress IP plus the baked-in protected IPs.
run ipset create monitor_allowlist hash:ip family inet -exist
run ipset flush monitor_allowlist
OWN_EGRESS="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
if [ -n "$OWN_EGRESS" ]; then run ipset add monitor_allowlist "$OWN_EGRESS" -exist; fi
for wl_ip in "\${PROTECTED_IPS[@]}"; do [ -n "$wl_ip" ] && run ipset add monitor_allowlist "$wl_ip" -exist; done
run iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT
if run iptables -L DOCKER-USER >/dev/null 2>&1; then
  run iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT
fi
run iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT

run install -d -m 700 /var/lib/monitor-firewall
${buildSnapshotSaveCommands()}
run sh -c 'ipset save monitor_allowlist > /var/lib/monitor-firewall/monitor_allowlist.ipset'
if command -v systemctl >/dev/null 2>&1; then
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "${restoreExec}"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'
  run systemctl daemon-reload || true
  run systemctl enable monitor-blocklist-restore.service || true
fi
echo "[$(date -Is)] SUCCESS: $COUNT entries are active across Host & Docker ports."
`;
}

async function ssh(request, connectionId) {
  return getSshConfig(connectionId, { sshMode: request.headers.get('x-ssh-mode'), preferredRelay: request.headers.get('x-preferred-relay') });
}

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    const result = await execCommand(await ssh(request, connectionId), String.raw`
CRON_LINE="$(crontab -l 2>/dev/null | grep -F ${shellQuote(MARKER)} | tail -n 1 || true)"
if [ -n "$CRON_LINE" ]; then
  echo "installed=true"
  echo "schedule=$(printf '%s\\n' "$CRON_LINE" | awk '{print $1 " " $2 " " $3 " " $4 " " $5}')"
else
  echo "installed=false"
fi
if [ -d ${LOCK} ]; then echo "running=true"; else echo "running=false"; fi
tail -n 160 ${LOG} 2>/dev/null || true
`, { pool: false });
    const output = result.stdout || '';
    const log = output.split(/\r?\n/).filter(line => !/^(installed|running)=(true|false)$/.test(line) && !/^schedule=.+$/.test(line)).join('\n');
    const schedule = output.match(/^schedule=(.+)$/m)?.[1]?.trim() || null;
    return NextResponse.json({ success: true, installed: /^installed=true$/m.test(output), running: /^running=true$/m.test(output), schedule, log });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not read source update status' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId, sourceUrl, protectedIps = [], manualBlocks = [], schedule, runNow = false, confirmation } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    if (!matchesConfirmation(confirmation)) return NextResponse.json({ success: false, error: 'Type confirm to allow automatic firewall updates.' }, { status: 400 });
    const url = validateSourceUrl(sourceUrl);
    const cronSchedule = validateSchedule(schedule || '*/30 * * * *');
    const manualProtection = protectedIps.map(normalizeEntry).filter(Boolean);
    if (manualProtection.some(ip => ip.includes('/'))) return NextResponse.json({ success: false, error: 'Automated updates currently require individual protected IP addresses, not CIDR ranges.' }, { status: 400 });
    const cleanManual = sanitizeManualEntries(manualBlocks);
    if (cleanManual.length !== manualBlocks.length) return NextResponse.json({ success: false, error: 'Manual blocks contain invalid or non-IPv4 entries.' }, { status: 400 });
    const ips = [...new Set([...remoteClientIps(request.headers), ...manualProtection])].filter(ip => isIP(ip) === 4);
    const config = await ssh(request, connectionId);
    const encoded = Buffer.from(updateScript(url, ips), 'utf8').toString('base64');
    const install = await execCommand(config, String.raw`
set -eu
printf '%s' ${shellQuote(encoded)} | base64 -d > ${SCRIPT}
chmod 700 ${SCRIPT}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${shellQuote(MARKER)} > "$TMP_CRON" || true
echo ${shellQuote(cronLine(cronSchedule))} >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
${runNow ? `nohup /bin/bash ${SCRIPT} >> ${LOG} 2>&1 < /dev/null &` : 'true'}
`, { pool: false });
    if (install.code !== 0) return NextResponse.json({ success: false, error: install.stderr?.trim() || 'Could not install the automated source update.' }, { status: 500 });
    // One-time migration: move the dashboard's quick-block chips into the
    // manual set now. The cron script itself never carries entries, so IPs
    // removed from the dashboard later stay removed.
    const seed = await execCommand(config, String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 && run ipset list monitor_blocklist >/dev/null 2>&1 || exit 0
${buildManualSetCommands(cleanManual)}
${buildDropRuleCommands()}
run install -d -m 700 /var/lib/monitor-firewall
${buildSnapshotSaveCommands()}
echo SEEDED
`, { pool: false });
    if (seed.code !== 0) return NextResponse.json({ success: false, error: seed.stderr?.trim() || 'Could not seed manual blocks on this server.' }, { status: 500 });
    return NextResponse.json({ success: true, schedule: cronSchedule, message: runNow ? 'Automated source update installed and started. Open the activity view below to follow it.' : `Automated source update installed for ${cronSchedule}.` });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not configure the source update' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { connectionId } = await request.json();
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    const result = await execCommand(await ssh(request, connectionId), String.raw`
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${shellQuote(MARKER)} > "$TMP_CRON" || true
crontab "$TMP_CRON"
rm -f "$TMP_CRON" ${SCRIPT} ${LOG}
`, { pool: false });
    if (result.code !== 0) return NextResponse.json({ success: false, error: result.stderr?.trim() || 'Could not remove the daily source update.' }, { status: 500 });
    return NextResponse.json({ success: true, message: 'Automated source update and its log were removed.' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not remove the source update' }, { status: 500 });
  }
}
