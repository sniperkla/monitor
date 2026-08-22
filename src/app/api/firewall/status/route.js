import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

const STATUS_SCRIPT = String.raw`
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else return 127; fi; }
echo "===ACCESS==="
if [ "$(id -u)" = "0" ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo limited; fi
echo "===IPSET==="
if command -v ipset >/dev/null 2>&1; then
  echo available
  run ipset list monitor_blocklist 2>/dev/null | awk -F': ' '/Number of entries:/{print "entries=" $2}'
  run ipset list monitor_blocklist 2>/dev/null | grep -q '^Name:' && echo active || true
else echo unavailable; fi
echo "===IPTABLES==="
if command -v iptables >/dev/null 2>&1; then
  echo available
  if run iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo rule=active; else echo rule=missing; fi
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then
    echo docker_chain=present
    if run iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo docker_rule=active; else echo docker_rule=missing; fi
  else
    echo docker_chain=missing
  fi
  if run iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; then echo forward_rule=active; else echo forward_rule=missing; fi
else echo unavailable; fi
echo "===COUNTERS==="
if command -v iptables >/dev/null 2>&1; then
  run iptables -nvx -L INPUT --line-numbers 2>/dev/null | awk '/match-set monitor_blocklist src/ { print "input_line=" $1; print "input_packets=" $2; print "input_bytes=" $3; exit }'
  if run iptables -L DOCKER-USER >/dev/null 2>&1; then
    run iptables -nvx -L DOCKER-USER --line-numbers 2>/dev/null | awk '/match-set monitor_blocklist src/ { print "docker_packets=" $2; print "docker_bytes=" $3; exit }'
  fi
  run iptables -nvx -L FORWARD --line-numbers 2>/dev/null | awk '/match-set monitor_blocklist src/ { print "forward_packets=" $2; print "forward_bytes=" $3; exit }'
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

    return NextResponse.json({
      success: true,
      access: section(result.stdout || '', 'ACCESS') || 'limited',
      tools: { ipset: ipset.startsWith('available'), iptables: iptables.startsWith('available'), nft: section(result.stdout || '', 'NFT').startsWith('available') },
      blocklist: {
        active: setExists && (ruleActive || dockerRuleActive || forwardRuleActive),
        exists: setExists,
        entries: Number(field(ipset, 'entries', '0')) || 0,
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
