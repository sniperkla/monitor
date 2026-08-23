import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import connectMongo from '@/lib/mongodb';
import FirewallHistory from '@/models/FirewallHistory';

const STATUS_SCRIPT = String.raw`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else return 127; fi; }
echo "===ACCESS==="
if [ "$(id -u)" = "0" ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo limited; fi
echo "===IPSET==="
if command -v ipset >/dev/null 2>&1; then
  echo available
  run ipset list monitor_blocklist 2>/dev/null | awk -F': ' '/Number of entries:/{print "entries=" $2}'
  run ipset list monitor_manual_blocks 2>/dev/null | awk -F': ' '/Number of entries:/{print "manual_entries=" $2}'
  run ipset list monitor_allowlist 2>/dev/null | awk -F': ' '/Number of entries:/{print "allowlist_entries=" $2}'
  run ipset list monitor_blocklist 2>/dev/null | grep -q '^Name:' && echo active || true
else echo unavailable; fi
echo "===IPTABLES==="
if command -v iptables >/dev/null 2>&1; then
  echo available
  # Composite set first; legacy single-set rules still count as active on
  # servers not yet re-applied since the list:set migration.
  if run iptables -C INPUT -m set --match-set monitor_all src -j DROP 2>/dev/null || run iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo rule=active; else echo rule=missing; fi
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then
    echo docker_chain=present
    if run iptables -C DOCKER-USER -m set --match-set monitor_all src -j DROP 2>/dev/null || run iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo docker_rule=active; else echo docker_rule=missing; fi
  else
    echo docker_chain=missing
  fi
  if run iptables -C FORWARD -m set --match-set monitor_all src -j DROP 2>/dev/null || run iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo forward_rule=active; else echo forward_rule=missing; fi
else echo unavailable; fi
echo "===COUNTERS==="
if command -v iptables >/dev/null 2>&1; then
  # Prefer the composite rule's counters; fall back to the legacy rule for
  # pre-migration servers. (Both briefly coexist during a migration apply —
  # summing them would double-count, so first match per set wins.)
  counters() {
    run iptables -nvx -L "$1" --line-numbers 2>/dev/null | awk -v pfx="$2" '
      /match-set monitor_all src/ && !c { c=1; cl=$1; cp=$2; cb=$3 }
      /match-set monitor_blocklist src/ && !l { l=1; ll=$1; lp=$2; lb=$3 }
      END {
        if (c) { print pfx "line=" cl; print pfx "packets=" cp; print pfx "bytes=" cb }
        else if (l) { print pfx "line=" ll; print pfx "packets=" lp; print pfx "bytes=" lb }
      }'
  }
  counters INPUT input_
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then counters DOCKER-USER docker_; fi
  counters FORWARD forward_
fi
echo "===NFT==="
if command -v nft >/dev/null 2>&1; then echo available; else echo unavailable; fi
echo "===PERSISTENCE==="
if [ -f /var/lib/monitor-firewall/monitor_blocklist.ipset ]; then echo snapshot=present; else echo snapshot=missing; fi
if systemctl is-enabled monitor-blocklist-restore.service >/dev/null 2>&1; then echo service=enabled; else echo service=disabled; fi
echo "===INSTALLER==="
for manager in apt-get dnf yum apk pacman zypper; do
  if command -v "$manager" >/dev/null 2>&1; then echo "$manager"; break; fi
done
`;

const section = (text, name) => text.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?====|$)`))?.[1]?.trim() || '';
const field = (text, name, fallback = null) => text.match(new RegExp(`(?:^|\\n)${name}=([^\\n]+)`))?.[1]?.trim() || fallback;

// Interim history recorder: while the dashboard is open, every status poll also
// persists a cumulative-counter sample so attack history accumulates in the DB
// before the updated monitor agent (24/7 background sampler) is installed.
// Skips recording when the agent already covers this server, or when another
// tab/poll recorded moments ago, to avoid duplicate interleaved samples.
async function recordInterimSample(connectionId, packets, bytes) {
  try {
    await connectMongo();
    const newest = await FirewallHistory
      .findOne({ connectionId })
      .sort({ recordedAt: -1 })
      .lean()
      .select({ recordedAt: 1, source: 1 });
    if (newest) {
      const age = Date.now() - new Date(newest.recordedAt).getTime();
      if (newest.source === 'agent' && age < 90 * 1000) return; // agent fleet handles this server
      if (age < 8 * 1000) return; // another poll just recorded
    }
    await FirewallHistory.create({ connectionId, packets, bytes, source: 'app' });
  } catch (_) {
    // History recording is best-effort — never fail the status poll
  }
}

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    if (!connectionId) return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });

    const sshConfig = await getSshConfig(connectionId, {
      sshMode: request.headers.get('x-ssh-mode'),
      preferredRelay: request.headers.get('x-preferred-relay'),
    });
    const result = await execCommand(sshConfig, STATUS_SCRIPT);
    const ipset = section(result.stdout || '', 'IPSET');
    const iptables = section(result.stdout || '', 'IPTABLES');
    const persistence = section(result.stdout || '', 'PERSISTENCE');
    const counters = section(result.stdout || '', 'COUNTERS');
    const setExists = ipset.includes('\nactive') || ipset.endsWith('active');
    const ruleActive = field(iptables, 'rule', 'missing') === 'active';
    const dockerChainPresent = field(iptables, 'docker_chain', 'missing') === 'present';
    const dockerRuleActive = field(iptables, 'docker_rule', 'missing') === 'active';
    const forwardRuleActive = field(iptables, 'forward_rule', 'missing') === 'active';

    const inputPkts = Number(field(counters, 'input_packets', '0')) || 0;
    const dockerPkts = Number(field(counters, 'docker_packets', '0')) || 0;
    const forwardPkts = Number(field(counters, 'forward_packets', '0')) || 0;

    const inputBytes = Number(field(counters, 'input_bytes', '0')) || 0;
    const dockerBytes = Number(field(counters, 'docker_bytes', '0')) || 0;
    const forwardBytes = Number(field(counters, 'forward_bytes', '0')) || 0;

    const blocklistActive = setExists && (ruleActive || dockerRuleActive || forwardRuleActive);
    if (blocklistActive) {
      recordInterimSample(connectionId, inputPkts + dockerPkts + forwardPkts, inputBytes + dockerBytes + forwardBytes); // fire-and-forget
    }

    return NextResponse.json({
      success: true,
      access: section(result.stdout || '', 'ACCESS') || 'limited',
      tools: { ipset: ipset.startsWith('available'), iptables: iptables.startsWith('available'), nft: section(result.stdout || '', 'NFT').startsWith('available') },
      blocklist: {
        active: blocklistActive,
        exists: setExists,
        entries: Number(field(ipset, 'entries', '0')) || 0,
        manualEntries: Number(field(ipset, 'manual_entries', '0')) || 0,
        allowlistEntries: Number(field(ipset, 'allowlist_entries', '0')) || 0,
        ruleActive,
        dockerProtected: dockerChainPresent ? dockerRuleActive : forwardRuleActive,
        dockerChainPresent,
        forwardRuleActive,
        ruleLine: Number(field(counters, 'input_line', '0')) || 1,
        blockedPackets: inputPkts + dockerPkts + forwardPkts,
        blockedBytes: inputBytes + dockerBytes + forwardBytes,
      },
      persistence: { snapshot: field(persistence, 'snapshot', 'missing') === 'present', service: field(persistence, 'service', 'disabled') === 'enabled' },
      installer: section(result.stdout || '', 'INSTALLER') || null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not inspect firewall status' }, { status: 500 });
  }
}
