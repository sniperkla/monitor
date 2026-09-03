import { isIP } from 'node:net';
import { getClientIp } from '@/lib/clientIp';

export const MAX_BLOCKLIST_ENTRIES = 2000000;
export const MAX_BLOCKLIST_BYTES = 128 * 1024 * 1024;

export function normalizeEntry(value) {
  const entry = String(value || '').trim().replace(/[;,]$/, '');
  if (!entry) return null;

  const [address, rawPrefix] = entry.split('/');
  const family = isIP(address);
  if (!family || (entry.match(/\//g) || []).length > 1) return null;
  if (rawPrefix === undefined) return address;
  if (!/^\d{1,3}$/.test(rawPrefix)) return null;

  const prefix = Number(rawPrefix);
  if (prefix < 0 || prefix > (family === 4 ? 32 : 128)) return null;
  return `${address}/${prefix}`;
}

function extractCandidate(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return null;

  // Plain lists, ipset save/restore, iptables source rules, and hosts files.
  const tokens = trimmed.replace(/#.*/, '').trim().split(/\s+/);
  if (tokens.length === 1) return tokens[0];
  if ((tokens[0] === 'add' && tokens.length >= 3) ||
      (tokens[0] === 'ipset' && tokens[1] === 'add' && tokens.length >= 4)) {
    return tokens[tokens[0] === 'add' ? 2 : 3];
  }
  const sourceIndex = tokens.findIndex(token => token === '-s' || token === '--source');
  if (sourceIndex >= 0) return tokens[sourceIndex + 1];
  // Hosts format: 203.0.113.4 example.invalid
  return tokens[0];
}

export function parseBlocklistLine(line) {
  return normalizeEntry(extractCandidate(String(line)));
}

export function parseBlocklist(raw) {
  const source = String(raw || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_BLOCKLIST_BYTES) {
    throw new Error('The import is larger than 8 MB. Split it into smaller files before importing.');
  }

  let values = source.split(/\r?\n/);
  if (source.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) values = parsed.map(item => String(item));
    } catch {
      // Fall back to line parsing so a malformed JSON file is simply reported as ignored lines.
    }
  }

  const seen = new Set();
  let ignored = 0;
  for (const line of values) {
    const normalized = parseBlocklistLine(line);
    if (normalized) seen.add(normalized);
    else if (String(line).trim() && !String(line).trim().startsWith('#')) ignored += 1;
    if (seen.size > MAX_BLOCKLIST_ENTRIES) {
      throw new Error(`The import contains more than ${MAX_BLOCKLIST_ENTRIES.toLocaleString()} unique entries.`);
    }
  }

  return { entries: [...seen], ignored };
}

function ipToBigInt(address) {
  const family = isIP(address);
  if (family === 4) {
    return address.split('.').reduce((result, part) => (result << 8n) + BigInt(Number(part)), 0n);
  }

  const [left, right = ''] = address.toLowerCase().split('::');
  const leftParts = left ? left.split(':').filter(Boolean) : [];
  const rightParts = right ? right.split(':').filter(Boolean) : [];
  const missing = 8 - leftParts.length - rightParts.length;
  const parts = [...leftParts, ...Array(Math.max(0, missing)).fill('0'), ...rightParts];
  return parts.reduce((result, part) => (result << 16n) + BigInt(`0x${part || '0'}`), 0n);
}

export function entryCoversIp(entry, ip) {
  const normalizedEntry = normalizeEntry(entry);
  const normalizedIp = normalizeEntry(ip)?.split('/')[0];
  if (!normalizedEntry || !normalizedIp) return false;
  const [address, rawPrefix] = normalizedEntry.split('/');
  if (isIP(address) !== isIP(normalizedIp)) return false;
  if (rawPrefix === undefined) return address === normalizedIp;

  const bits = isIP(address) === 4 ? 32 : 128;
  const prefix = Number(rawPrefix);
  const shift = BigInt(bits - prefix);
  return (ipToBigInt(address) >> shift) === (ipToBigInt(normalizedIp) >> shift);
}

export function getConflictingEntries(entries, protectedIps) {
  const normalizedProtected = [...new Set((protectedIps || []).map(normalizeEntry).filter(Boolean))]
    .map(entry => entry.split('/')[0]);
  const conflicts = [];
  for (const entry of entries || []) {
    for (const protectedIp of normalizedProtected) {
      if (entryCoversIp(entry, protectedIp)) {
        conflicts.push({ entry, protectedIp });
        break;
      }
    }
  }
  return conflicts;
}

export function remoteClientIps(headers) {
  // These addresses become the "protected" set when a blocklist is applied —
  // entries the firewall is told never to drop. A client-controlled value here
  // would let a caller add any address they liked to that set, permanently
  // shielding it from the blocklist they are supposedly applying.
  //
  // So this resolves through the shared helper (CF-Connecting-IP first, then
  // the trusted XFF position, then the nginx-overwritten X-Real-IP) instead of
  // trusting the client-supplied leftmost XFF entry.
  //
  // Returns [] when the address cannot be resolved, i.e. no automatic
  // self-protection. That is the conservative direction, but it does mean an
  // admin could lock themselves out — confirm the proxy headers reach the app
  // in staging before applying a blocklist to a host you cannot reach.
  const ip = getClientIp({ headers });
  if (ip === 'unknown') {
    console.warn('[firewallBlocklist] client IP unresolved — no automatic protection will be applied');
    return [];
  }
  return [normalizeEntry(ip)?.split('/')[0]]
    .filter(Boolean)
    .filter((entry) => entry !== '127.0.0.1' && entry !== '::1');
}

// ── Composite block set (manual quick blocks survive re-applies) ────────────
// iptables DROP rules match a single `monitor_all` list:set which unions the
// feed-managed `monitor_blocklist` with `monitor_manual_blocks` (dashboard
// quick blocks). Applies and scheduled syncs swap only the feed set, so
// quick-blocked IPs survive every re-apply; the manual set is never flushed
// by anything except an explicit blocklist removal.
export const MANUAL_SET = 'monitor_manual_blocks';
export const COMPOSITE_SET = 'monitor_all';
export const MAX_MANUAL_BLOCK_ENTRIES = 500;

export function sanitizeManualEntries(entries) {
  return [...new Set((entries || []).map(normalizeEntry).filter(Boolean))]
    .filter(entry => isIP(entry.split('/')[0]) === 4)
    .slice(0, MAX_MANUAL_BLOCK_ENTRIES);
}

// Creates (idempotently) the manual set and the composite list:set, wiring
// both members. Optionally seeds entries — used by applies to migrate the
// dashboard's quick-block list onto the server in the same transaction.
export function buildManualSetCommands(manualEntries = [], indent = '') {
  const entries = sanitizeManualEntries(manualEntries);
  const encoded = Buffer.from(entries.join('\n') + '\n', 'utf8').toString('base64');
  const addEntries = entries.length
    ? `${indent}printf '%s' '${encoded}' | base64 -d | while IFS= read -r mb_ip; do [ -n "$mb_ip" ] && run ipset add ${MANUAL_SET} "$mb_ip" -exist; done`
    : '';
  return [
    `${indent}run ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist`,
    `${indent}run ipset create ${MANUAL_SET} hash:net family inet hashsize 1024 maxelem ${MAX_MANUAL_BLOCK_ENTRIES} -exist`,
    `${indent}run ipset create ${COMPOSITE_SET} list:set -exist`,
    `${indent}run ipset add ${COMPOSITE_SET} monitor_blocklist -exist`,
    `${indent}run ipset add ${COMPOSITE_SET} ${MANUAL_SET} -exist`,
    addEntries,
  ].filter(Boolean).join('\n');
}

// Installs the DROP rules against the composite set, then retires any legacy
// single-set rules from pre-list:set deploys (install first, delete after, so
// protection never gaps during the migration).
export function buildDropRuleCommands(indent = '') {
  const chains = ['INPUT', 'FORWARD'];
  const lines = [
    `${indent}run iptables -C INPUT -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || run iptables -I INPUT 1 -m set --match-set ${COMPOSITE_SET} src -j DROP`,
    `${indent}if run iptables -L DOCKER-USER >/dev/null 2>&1; then`,
    `${indent}  run iptables -C DOCKER-USER -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set ${COMPOSITE_SET} src -j DROP`,
    `${indent}fi`,
    `${indent}run iptables -C FORWARD -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set ${COMPOSITE_SET} src -j DROP`,
  ];
  for (const chain of chains) {
    lines.push(`${indent}while run iptables -C ${chain} -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do run iptables -D ${chain} -m set --match-set monitor_blocklist src -j DROP; done`);
  }
  lines.push(`${indent}if run iptables -L DOCKER-USER >/dev/null 2>&1; then`);
  lines.push(`${indent}  while run iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do run iptables -D DOCKER-USER -m set --match-set monitor_blocklist src -j DROP; done`);
  lines.push(`${indent}fi`);
  return lines.join('\n');
}

// Snapshot now contains all three sets (children before the list:set, which
// is the order `ipset restore` requires) under the historical filename.
export function buildSnapshotSaveCommands(indent = '') {
  return [
    `${indent}run sh -c '{ ipset save monitor_blocklist; ipset save ${MANUAL_SET}; ipset save ${COMPOSITE_SET}; } > /var/lib/monitor-firewall/monitor_blocklist.ipset'`,
  ].join('\n');
}

// Inner sh command for the reboot-restore service: re-creates the set trio,
// restores the snapshot, re-installs composite rules, retires legacy rules.
export function buildRestoreServiceExec(allowlistRestore = '') {
  return [
    `ipset create monitor_blocklist hash:net family inet hashsize 4096 maxelem ${MAX_BLOCKLIST_ENTRIES} -exist`,
    `ipset create ${MANUAL_SET} hash:net family inet hashsize 1024 maxelem ${MAX_MANUAL_BLOCK_ENTRIES} -exist`,
    `ipset create ${COMPOSITE_SET} list:set -exist`,
    `ipset add ${COMPOSITE_SET} monitor_blocklist -exist`,
    `ipset add ${COMPOSITE_SET} ${MANUAL_SET} -exist`,
    `ipset restore -exist < /var/lib/monitor-firewall/monitor_blocklist.ipset`,
    `iptables -C INPUT -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || iptables -I INPUT 1 -m set --match-set ${COMPOSITE_SET} src -j DROP`,
    `iptables -C FORWARD -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || iptables -I FORWARD 1 -m set --match-set ${COMPOSITE_SET} src -j DROP`,
    `if iptables -L DOCKER-USER >/dev/null 2>&1; then iptables -C DOCKER-USER -m set --match-set ${COMPOSITE_SET} src -j DROP 2>/dev/null || iptables -I DOCKER-USER 1 -m set --match-set ${COMPOSITE_SET} src -j DROP; fi`,
    `while iptables -C INPUT -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D INPUT -m set --match-set monitor_blocklist src -j DROP; done`,
    `while iptables -C FORWARD -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D FORWARD -m set --match-set monitor_blocklist src -j DROP; done`,
    `if iptables -L DOCKER-USER >/dev/null 2>&1; then while iptables -C DOCKER-USER -m set --match-set monitor_blocklist src -j DROP 2>/dev/null; do iptables -D DOCKER-USER -m set --match-set monitor_blocklist src -j DROP; done; fi${allowlistRestore ? allowlistRestore : ''}`,
  ].join('; ');
}

// ── Persistent admin allowlist ──────────────────────────────────────────────
// Every firewall apply installs a `monitor_allowlist` ipset plus ACCEPT rules
// ABOVE the blocklist DROPs, so whitelisted IPs (auto-detected client IPs +
// manually protected IPs) can never be locked out — even when a future
// blocklist update contains a subnet covering them.
export function sanitizeProtectedIps(protectedIps) {
  return [...new Set(
    (protectedIps || [])
      .map(ip => normalizeEntry(ip)?.split('/')[0])
      .filter(Boolean)
      .filter(ip => isIP(ip) === 4)
  )];
}

export function buildAllowlistCommands(protectedIps, indent = '') {
  const ips = sanitizeProtectedIps(protectedIps);
  const addUserIps = ips.length
    ? `${indent}printf '%s' '${Buffer.from(ips.join('\n') + '\n', 'utf8').toString('base64')}' | base64 -d | while IFS= read -r wl_ip; do [ -n "$wl_ip" ] && run ipset add monitor_allowlist "$wl_ip" -exist; done`
    : '';
  return [
    `${indent}run ipset create monitor_allowlist hash:ip family inet -exist`,
    `${indent}run ipset flush monitor_allowlist`,
    // Always include the server's own egress IP (from its routing table — no external service)
    `${indent}OWN_EGRESS="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"`,
    `${indent}if [ -n "$OWN_EGRESS" ]; then run ipset add monitor_allowlist "$OWN_EGRESS" -exist; fi`,
    addUserIps,
    `${indent}run iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT`,
    `${indent}if run iptables -L DOCKER-USER >/dev/null 2>&1; then`,
    `${indent}  run iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT`,
    `${indent}fi`,
    `${indent}run iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || run iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT`,
  ].filter(Boolean).join('\n');
}

// Restore-service fragment: safely re-installs the allowlist ACCEPT rules
// after reboot (guarded by the saved snapshot file so it no-ops when the
// server has no allowlist).
export function buildAllowlistRestoreFragment() {
  return ' if [ -f /var/lib/monitor-firewall/monitor_allowlist.ipset ]; then ipset restore -exist < /var/lib/monitor-firewall/monitor_allowlist.ipset; iptables -C INPUT -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -m set --match-set monitor_allowlist src -j ACCEPT; iptables -C FORWARD -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -m set --match-set monitor_allowlist src -j ACCEPT; if iptables -L DOCKER-USER >/dev/null 2>&1; then iptables -C DOCKER-USER -m set --match-set monitor_allowlist src -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -m set --match-set monitor_allowlist src -j ACCEPT; fi; fi;';
}

// ── Last-resort recovery ────────────────────────────────────────────────────
// After a manual apply, the server arms a watchdog: unless the manager
// confirms access within the timeout (the app auto-confirms on its first
// successful status poll), the firewall removes itself. Guarantees the app
// can never permanently lock itself out of a server it just changed.
export function buildLastResortCommands(timeoutSec = 900) {
  return `
# ── Last-resort safety net — auto-revert if the manager loses access ──
run sh -c 'cat > /var/lib/monitor-firewall/last-resort.sh <<"LRSCRIPT"
#!/bin/sh
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
for SET in ${COMPOSITE_SET} monitor_blocklist; do
  while iptables -C INPUT -m set --match-set "$SET" src -j DROP 2>/dev/null; do iptables -D INPUT -m set --match-set "$SET" src -j DROP; done
  while iptables -C FORWARD -m set --match-set "$SET" src -j DROP 2>/dev/null; do iptables -D FORWARD -m set --match-set "$SET" src -j DROP; done
  if iptables -L DOCKER-USER >/dev/null 2>&1; then
    while iptables -C DOCKER-USER -m set --match-set "$SET" src -j DROP 2>/dev/null; do iptables -D DOCKER-USER -m set --match-set "$SET" src -j DROP; done
  fi
done
ipset destroy ${COMPOSITE_SET} 2>/dev/null
ipset destroy monitor_blocklist 2>/dev/null
ipset destroy ${MANUAL_SET} 2>/dev/null
systemctl disable --now monitor-blocklist-restore.service 2>/dev/null
systemctl disable --now monitor-docker-firewall-hook.service 2>/dev/null
rm -f /var/lib/monitor-firewall/rollback.pending
echo "[$(date -Is)] LAST_RESORT auto-revert executed (manager did not confirm access)" >> /var/lib/monitor-firewall/rollback.log
LRSCRIPT'
run chmod 700 /var/lib/monitor-firewall/last-resort.sh
run sh -c 'date -Is > /var/lib/monitor-firewall/rollback.pending'
run sh -c 'setsid sh -c "sleep ${timeoutSec}; if [ -f /var/lib/monitor-firewall/rollback.pending ]; then sh /var/lib/monitor-firewall/last-resort.sh; fi" >/dev/null 2>&1 < /dev/null &'
`;
}
