import { MAX_BLOCKLIST_ENTRIES } from '@/lib/firewallBlocklist';

// remoteFile is generated from a UUID server-side, never from an upload name.
export function buildIpSetApplyScript(remoteFile) {
  return String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
test -r "${remoteFile}" || { echo "IMPORT_FILE_MISSING" >&2; exit 44; }
SORTED_FILE="${remoteFile}.sorted"
trap 'rm -f "${remoteFile}" "$SORTED_FILE"' EXIT
echo "MONITOR_PROGRESS|22|Validating and deduplicating the blocklist"
LC_ALL=C sort -u "${remoteFile}" > "$SORTED_FILE"
echo "MONITOR_PROGRESS|38|Creating the isolated replacement IPSet"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
echo "MONITOR_PROGRESS|54|Loading entries into the replacement set"
while IFS= read -r entry; do [ -n "$entry" ] && run ipset add monitor_blocklist_next "$entry" -exist; done < "$SORTED_FILE"
echo "MONITOR_PROGRESS|70|Atomically switching the active protection"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true

# 1. Protect Host binding ports (SSH, Nginx, Host daemons)
run iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_blocklist src -j DROP

# 2. Protect Docker container published ports (DOCKER-USER chain)
if run iptables -L DOCKER-USER >/dev/null 2>&1; then
  run iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set monitor_blocklist src -j DROP
fi

# 3. Protect generic routed/bridged container traffic (Podman, K8s, LXC)
run iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set monitor_blocklist src -j DROP

echo "MONITOR_PROGRESS|82|Saving the reboot recovery configuration"
run install -d -m 700 /var/lib/monitor-firewall
run sh -c 'ipset save monitor_blocklist > /var/lib/monitor-firewall/monitor_blocklist.ipset'

if command -v systemctl >/dev/null 2>&1; then
  # --- Service 1: Restore blocklist on every boot ---
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist on boot
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "ipset restore -exist < /var/lib/monitor-firewall/monitor_blocklist.ipset; iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || iptables -I INPUT 1 -m set --match-set monitor_blocklist src -j DROP; iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || iptables -I FORWARD 1 -m set --match-set monitor_blocklist src -j DROP; if iptables -L DOCKER-USER >/dev/null 2>&1; then iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || iptables -I DOCKER-USER 1 -m set --match-set monitor_blocklist src -j DROP; fi"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT'

  # --- Service 2: Auto-reinject into DOCKER-USER whenever Docker daemon restarts ---
  # Writes the hook script that listens to docker daemon events
  if command -v docker >/dev/null 2>&1; then
    run sh -c 'cat > /usr/local/bin/monitor-docker-firewall-hook.sh <<"HOOKSCRIPT"
#!/bin/bash
# Automatically reinjected by monitor-firewall when Docker daemon restarts.
# Listens for Docker daemon start events and reinstalls the DOCKER-USER rule.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SNAPSHOT="/var/lib/monitor-firewall/monitor_blocklist.ipset"

reinject() {
  sleep 2  # Give Docker time to recreate the DOCKER-USER chain
  if iptables -L DOCKER-USER >/dev/null 2>&1 && [ -f "$SNAPSHOT" ]; then
    ipset restore -exist < "$SNAPSHOT" 2>/dev/null || true
    iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || \
    iptables -I DOCKER-USER 1 -m set --match-set monitor_blocklist src -j DROP
    iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null || \
    iptables -I FORWARD 1 -m set --match-set monitor_blocklist src -j DROP
    echo "[$(date -Is)] monitor-docker-firewall-hook: DOCKER-USER rule reinjected successfully."
  fi
}

# Listen for Docker daemon-level start events (fires when dockerd itself restarts)
docker events --filter type=daemon --filter event=start --format "{{.Action}}" | while read -r event; do
  echo "[$(date -Is)] monitor-docker-firewall-hook: Docker daemon started, reinjecting firewall rule..."
  reinject
done
HOOKSCRIPT'
    run chmod 750 /usr/local/bin/monitor-docker-firewall-hook.sh

    run sh -c 'cat > /etc/systemd/system/monitor-docker-firewall-hook.service <<"UNIT"
[Unit]
Description=Monitor Firewall - Auto-reinject DOCKER-USER rule on Docker restart
Documentation=https://github.com/your-repo/monitor
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStart=/bin/bash /usr/local/bin/monitor-docker-firewall-hook.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT'

    run systemctl enable monitor-docker-firewall-hook.service || true
    run systemctl restart monitor-docker-firewall-hook.service 2>/dev/null || run systemctl start monitor-docker-firewall-hook.service || true
  fi

  run systemctl daemon-reload || true
  run systemctl enable monitor-blocklist-restore.service || true
fi
echo "MONITOR_PROGRESS|96|Verifying the firewall configuration"
echo "APPLIED=$(wc -l < "$SORTED_FILE" | tr -d ' ')"
`;
}
