import { MAX_BLOCKLIST_ENTRIES, COMPOSITE_SET, MANUAL_SET, sanitizeManualEntries, buildManualSetCommands, buildDropRuleCommands, buildSnapshotSaveCommands, buildRestoreServiceExec, buildAllowlistCommands, buildAllowlistRestoreFragment, buildLastResortCommands } from '@/lib/firewallBlocklist';

// remoteFile is generated from a UUID server-side, never from an upload name.
export function buildIpSetApplyScript(remoteFile, protectedIps = [], manualEntries = []) {
  const manual = sanitizeManualEntries(manualEntries);
  const allowlistCmds = buildAllowlistCommands(protectedIps);
  const allowlistSave = `run sh -c 'ipset save monitor_allowlist > /var/lib/monitor-firewall/monitor_allowlist.ipset'`;
  const restoreExec = buildRestoreServiceExec(buildAllowlistRestoreFragment());
  const lastResort = buildLastResortCommands();
  return String.raw`
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
run() { if [ "$(id -u)" = "0" ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else echo "NO_PRIVILEGE" >&2; exit 41; fi; }
command -v ipset >/dev/null 2>&1 || { echo "IPSET_UNAVAILABLE" >&2; exit 42; }
command -v iptables >/dev/null 2>&1 || { echo "IPTABLES_UNAVAILABLE" >&2; exit 43; }
test -r "${remoteFile}" || { echo "IMPORT_FILE_MISSING" >&2; exit 44; }
SORTED_FILE="${remoteFile}.sorted"
trap 'rm -f "${remoteFile}" "$SORTED_FILE" "$SORTED_FILE.restore"' EXIT
echo "MONITOR_PROGRESS|22|Validating and deduplicating the blocklist"
LC_ALL=C sort -u "${remoteFile}" > "$SORTED_FILE"
echo "MONITOR_PROGRESS|38|Creating the isolated replacement IPSet"
run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset create monitor_blocklist_next hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist
run ipset flush monitor_blocklist_next
echo "MONITOR_PROGRESS|54|Loading entries into the replacement set"
# Bulk load via a single ipset restore — a per-entry add loop forks sudo
# once per line and effectively hangs on multi-million-entry lists.
awk '{ print "add monitor_blocklist_next " $1 " -exist" }' "$SORTED_FILE" > "$SORTED_FILE.restore"
run sh -c 'ipset restore -exist < "$1"' sh "$SORTED_FILE.restore"
echo "MONITOR_PROGRESS|70|Atomically switching the active protection"
run ipset swap monitor_blocklist_next monitor_blocklist
run ipset destroy monitor_blocklist_next || true
# Re-seed the manual quick-block set from the dashboard (never flushed here)
${buildManualSetCommands(manual)}

# 1-3. Protect Host ports, Docker published ports, and routed traffic — all
# via the composite set so manual quick blocks stay enforced.
${buildDropRuleCommands()}

# 4. Admin allowlist — always takes precedence over the blocklist
${allowlistCmds}

echo "MONITOR_PROGRESS|82|Saving the reboot recovery configuration"
run install -d -m 700 /var/lib/monitor-firewall
${buildSnapshotSaveCommands()}
${allowlistSave}

if command -v systemctl >/dev/null 2>&1; then
  # --- Service 1: Restore blocklist on every boot ---
  run sh -c 'cat > /etc/systemd/system/monitor-blocklist-restore.service <<"UNIT"
[Unit]
Description=Restore Monitor IPSet blocklist on boot
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "${restoreExec}"
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
    ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist 2>/dev/null || true
    ipset create ${MANUAL_SET} hash:net family inet hashsize 1024 maxelem 500 -exist 2>/dev/null || true
    ipset create ${COMPOSITE_SET} list:set -exist 2>/dev/null || true
    ipset add ${COMPOSITE_SET} monitor_blocklist -exist 2>/dev/null || true
    ipset add ${COMPOSITE_SET} ${MANUAL_SET} -exist 2>/dev/null || true
    iptables -C DOCKER-USER -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || \
    iptables -I DOCKER-USER 1 -m set --match-set ${COMPOSITE_SET} src -j DROP
    iptables -C FORWARD -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || \
    iptables -I FORWARD 1 -m set --match-set ${COMPOSITE_SET} src -j DROP
    while iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D DOCKER-USER -m set --match-set monitor_blocklist src -j DROP; done
    while iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D FORWARD -m set --match-set monitor_blocklist src -j DROP; done
    if ipset list monitor_allowlist >/dev/null 2>&1; then
      iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || \
      iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT
      iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || \
      iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT
    fi
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
${lastResort}
echo "MONITOR_PROGRESS|96|Verifying the firewall configuration"
echo "APPLIED=$(wc -l < "$SORTED_FILE" | tr -d ' ')"
`;
}
