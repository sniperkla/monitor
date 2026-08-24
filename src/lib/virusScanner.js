import { execCommand } from '@/app/api/server-backup/_ssh';

const NL = String.fromCharCode(10);

/**
 * Heuristic security scanner for Linux servers (via SSH).
 *
 * Runs a battery of read-only checks that look for common signs of
 * compromise: cryptominers, suspicious cron jobs, executables in world-
 * writable dirs, backdoor SSH keys, brute-force evidence, hidden processes,
 * and risky SUID binaries. No antivirus engine is required on the target.
 *
 * Each check returns findings: { checkId, category, severity, title, detail, path, pid, evidence }
 */

/**
 * Run a long antivirus scan inside a detached tmux session on the target
 * server so it survives SSH disconnects, at lowest CPU priority (nice 19)
 * so it never competes with production workloads.
 *
 * Protocol written to outFile:
 *   - harvest: if outFile ends with __DONE__, return its content & clean up
 *   - if the tmux session already exists → __RUNNING__
 *   - otherwise start it → __STARTED__
 */
/**
 * Shell snippet that builds a resource-capped execution wrapper:
 *   1. Hard CPU cap (~15%) + low I/O weight via a systemd cgroup scope when
 *      systemd is available (root or passwordless sudo) — the scanner can
 *      NEVER take more than 15% of total CPU no matter how idle the box is.
 *   2. Otherwise falls back to nice 19 + ionice idle class (priority-only:
 *      yields to production work but may use idle cores).
 * Result is exposed as $CAP (may be empty) and $NICE for the caller.
 */
const LOW_PRIORITY_WRAP =
  `CAP=""; ` +
  `if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then ` +
  `  if [ "$(id -u)" = "0" ]; then CAP="systemd-run --scope -p CPUQuota=15% -p IOWeight=10"; ` +
  `  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then CAP="sudo -n systemd-run --scope -p CPUQuota=15% -p IOWeight=10"; fi; ` +
  `fi; ` +
  `NICE="nice -n 19"; command -v ionice >/dev/null 2>&1 && NICE="nice -n 19 ionice -c3"; `;

// procPat: the scanner process pattern. It is the source of truth for
// "already running" — a tmux session can get stuck (killed child, dead shell,
// stale socket) and must never block a retry on its own.
//
// The scan command is written to a runner script on the server (heredoc-quoted)
// instead of being inlined into `tmux new-session "..."`. Inlining breaks on
// any nested quotes/parens in scanCmd (shell re-parses them) and the session
// dies instantly — the classic "no tmux running after scan" failure.
function tmuxScanScript({ session, outFile, scanCmd, procPat, harvestOnly = false, preCmd = '' }) {
  const errLog = `/var/tmp/.monitor-${session}-err.log`;
  const runnerBody =
    `#!/bin/bash` + NL +
    LOW_PRIORITY_WRAP +
    `OUT=${outFile}; ` +
    preCmd +
    `${scanCmd} > "$OUT" 2>&1; ` +
    `echo __DONE__ >> "$OUT"; ` +
    `exit 0`;
  // Ship the runner as base64: the launcher's own cmdline contains NO
  // plain-text scan command, so pgrep can never self-match against text it
  // is carrying (this exact bug made every launch report __RUNNING__).
  const b64 = Buffer.from(runnerBody, 'utf8').toString('base64');
  return (
    // 0. Mark the launcher invocation (timestamp + mode) so server-side
    //    debugging can always tell whether/why a launch attempt ran.
    `: > ${errLog}; echo \"[launcher] $(date '+%F %T') harvestOnly=${harvestOnly}\" >> ${errLog}; ` +
    // 1. Write the runner script (base64-decoded — zero quoting pitfalls)
    `RUNNER=/var/tmp/.monitor-${session}.sh; ` +
    `printf '%s' '${b64}' | base64 -d > "$RUNNER" 2>/dev/null; chmod +x "$RUNNER"; ` +
    // 2. Harvest finished results if present
    `OUT=${outFile}; ` +
    `if [ -f "$OUT" ] && tail -n 1 "$OUT" | grep -q '^__DONE__$'; then sed '$d' "$OUT"; rm -f "$OUT"; exit 0; fi; ` +
    // 3. Scanner process alive → genuinely still scanning.
    //    Exclude our own shell ($$) and its parent ($PPID) as belt-and-braces.
    `if pgrep -f '${procPat}' 2>/dev/null | grep -vwE '$$|$PPID' >/dev/null 2>&1; then echo __RUNNING__; exit 0; fi; ` +
    // 3b. Quick-scan mode: harvest/report only — NEVER launch a heavy scan
    `if [ '${harvestOnly ? 'yes' : 'no'}' = 'yes' ]; then echo \"[launcher] skipped: quick-scan harvest-only mode\" >> ${errLog}; echo __IDLE__; exit 0; fi; ` +
    // 4. Kill any stale/stuck leftover session, start clean
    `tmux kill-session -t ${session} 2>/dev/null; ` +
    `rm -f "$OUT"; : > ${errLog}; ` +
    // 5. Launch preference order:
    //    (a) systemd transient unit — immune to logind KillUserProcesses,
    //        which murders tmux/nohup children when the SSH exec disconnects
    //    (b) tmux — survives disconnects elsewhere
    //    (c) nohup — last resort
    // WAY records which one actually launched so the UI reports truthfully.
    `LAUNCHED=0; WAY=unknown; ` +
    `SRUN=""; ` +
    `if command -v systemd-run >/dev/null 2>&1; then ` +
    `  if [ "$(id -u)" = "0" ]; then SRUN="systemd-run --collect --unit=${session}-scan"; ` +
    `  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SRUN="sudo -n systemd-run --collect --unit=${session}-scan"; fi; ` +
    `fi; ` +
    `if [ -n "$SRUN" ]; then $SRUN bash "$RUNNER" >>${errLog} 2>&1 && { LAUNCHED=1; WAY=systemd-unit; }; fi; ` +
    `if [ "$LAUNCHED" = "0" ] && command -v tmux >/dev/null 2>&1; then ` +
    `  tmux new-session -d -s ${session} "bash $RUNNER" 2>>${errLog} && { sleep 0.5; tmux has-session -t ${session} 2>/dev/null && { LAUNCHED=1; WAY=tmux; }; } ` +
    `fi; ` +
    `if [ "$LAUNCHED" = "0" ]; then nohup bash "$RUNNER" >/dev/null 2>&1 & WAY=nohup; fi; ` +
    // 6. Verify something is genuinely alive before claiming success
    `sleep 1; ` +
    `pgrep -f '${procPat}' 2>/dev/null | grep -vwE '$$|$PPID' >/dev/null 2>&1 && { echo __STARTED__; echo "ENGINE_LAUNCH=$WAY"; } || { echo __LAUNCH_FAIL__; echo "[launcher] FAILED way=$WAY" >> ${errLog}; head -n 3 ${errLog} 2>/dev/null; [ -f "$OUT" ] && echo '-- scan output tail --' && tail -n 5 "$OUT"; }`
  );
}

const CHECKS = [
  {
    id: 'clamav-signatures',
    label: 'Running ClamAV antivirus (trusted signatures)',
    category: 'file',
    run: async (exec, { harvestOnly = false, scope = 'standard' } = {}) => {
      // Scope selection: standard = malware-prone paths (fast); full = entire
      // root minus virtual/pseudo filesystems (hours on big disks).
      const scanCmd = scope === 'full'
        ? `clamscan -r --infected --suppress-ok-results --max-filesize=250M --max-scansize=4000M -i / --exclude-dir='^/(sys|proc|dev|run)$' --exclude-dir='^/var/lib/clamav$' --exclude-dir='^/var/ossec$'`
        : `clamscan -r --infected --suppress-ok-results --max-filesize=100M --max-scansize=500M -i /tmp /var/tmp /dev/shm /root /home /opt /srv`;
      const { stdout } = await exec(
        `(command -v clamscan >/dev/null 2>&1 || command -v clamdscan >/dev/null 2>&1) || { echo NOCLAM; exit 0; }; ` +
        tmuxScanScript({
          session: 'monitor-vclam',
          outFile: '/var/tmp/.monitor-clamav-scan.txt',
          // NOTE: ClamAV ≥1.x removed --max-threads; clamscan self-limits per
          // directory queue, and the LOW_PRIORITY_WRAP cgroup/nice cap keeps
          // total CPU usage low regardless.
          scanCmd,
          // NOTE: [i] character-class trick — see tmuxScanScript comment.
          procPat: 'clamscan -r --[i]nfected',
          harvestOnly,
          // Auto-heal: freshclam during install can silently fail/timeout,
          // leaving no signature DB — clamscan then exits instantly. Detect
          // and download before scanning (capped at 10 min).
          preCmd: `command -v freshclam >/dev/null 2>&1 && ! ls /var/lib/clamav/*.c*d >/dev/null 2>&1 && { echo "[monitor] ClamAV signature database missing — running freshclam first (may take several minutes)"; mkdir -p /var/lib/clamav; timeout 600 freshclam; }; `,
        })
      );
      const out = stdout || '';
      if (out.includes('NOCLAM')) return [];
      if (out.includes('__IDLE__')) return []; // quick mode: nothing running, nothing harvested
      if (out.includes('__LAUNCH_FAIL__')) {
        return [{
          checkId: 'clamav-signatures',
          category: 'file',
          severity: 'medium',
          title: 'ClamAV deep scan failed to start in background',
          detail: 'The scanner exited immediately after launch. Common causes: missing signature database (auto-healed on next attempt via freshclam) or a broken ClamAV install. The evidence below shows the exact server-side error from the scan output.',
          path: null,
          evidence: out.split(NL).filter(l => l.trim()).slice(0, 8).join(NL),
        }];
      }
      if (/__(RUNNING|STARTED)__/.test(out)) {
        // Report the real launch mechanism (systemd unit / tmux / nohup)
        const way = out.match(/ENGINE_LAUNCH=(\S+)/)?.[1] || 'background';
        const where = way === 'systemd-unit'
          ? 'systemd service: monitor-vclam-scan (journalctl -u monitor-vclam-scan)'
          : way === 'tmux' ? 'tmux session: monitor-vclam'
          : 'a detached background process';
        return [{
          checkId: 'clamav-signatures',
          category: 'file',
          severity: 'low',
          title: `ClamAV deep scan running in background (${where})`,
          detail: 'The full signature scan is executing detached, capped at ~15% total CPU via systemd cgroup or nice 19 (single-threaded, idle-class disk I/O). It survives disconnects — run another scan later (or press Refresh) to collect the results.',
          path: null,
          evidence: null,
        }];
      }
      const findings = [];
      for (const line of out.split(NL)) {
        const m = line.match(/^(.+?):\s+(.+)\s+FOUND\s*$/);
        if (!m) continue;
        findings.push({
          checkId: 'clamav-signatures',
          category: 'file',
          severity: 'critical',
          title: `ClamAV: ${m[2].trim()}`,
          detail: `${m[1].trim()} matched the official ClamAV signature database (Cisco Talos). This is a verified malware detection, not a heuristic guess.`,
          path: m[1].trim(),
          evidence: line.trim().slice(0, 300),
        });
      }
      return findings;
    },
  },
  {
    id: 'maldet-scan',
    label: 'Running Linux Malware Detect (LMD)',
    category: 'file',
    run: async (exec, { harvestOnly = false } = {}) => {
      const { stdout } = await exec(
        `(command -v maldet >/dev/null 2>&1 || [ -x /usr/local/sbin/maldet ]) || { echo NOMALDET; exit 0; }; ` +
        tmuxScanScript({
          session: 'monitor-vmaldet',
          outFile: '/var/tmp/.monitor-maldet-scan.txt',
          scanCmd: `maldet -a "/tmp,/var/tmp,/dev/shm" >/dev/null 2>&1; REPORT=$(ls -t /usr/local/maldetect/sess/session.hits.* 2>/dev/null | head -n 1); [ -n "$REPORT" ] && cat "$REPORT"`,
          // Pattern must match how the process actually appears in ps
          // ("maldet -a …" via PATH — no /usr/local/sbin prefix) while still
          // failing to match filename text like ".monitor-maldet-scan.txt".
          procPat: '[m]aldet -a',
          harvestOnly,
          // Always create OUT up-front: guarantees status transitions
          // (Idle→Scanning→Done/Stopped) even if maldet errors out early.
          preCmd: ': > "$OUT"; ',
        })
      );
      const out = stdout || '';
      if (out.includes('NOMALDET')) return [];
      if (out.includes('__IDLE__')) return []; // quick mode: nothing running, nothing harvested
      if (out.includes('__LAUNCH_FAIL__')) {
        return [{
          checkId: 'maldet-scan',
          category: 'file',
          severity: 'medium',
          title: 'LMD malware scan failed to start in background',
          detail: 'The scanner exited immediately after launch. The evidence below shows the exact server-side error from the scan output.',
          path: null,
          evidence: out.split(NL).filter(l => l.trim()).slice(0, 8).join(NL),
        }];
      }
      if (/__(RUNNING|STARTED)__/.test(out)) {
        const way = out.match(/ENGINE_LAUNCH=(\S+)/)?.[1] || 'background';
        const where = way === 'systemd-unit'
          ? 'systemd service: monitor-vmaldet-scan (journalctl -u monitor-vmaldet-scan)'
          : way === 'tmux' ? 'tmux session: monitor-vmaldet'
          : 'a detached background process';
        return [{
          checkId: 'maldet-scan',
          category: 'file',
          severity: 'low',
          title: `LMD malware scan running in background (${where})`,
          detail: 'Linux Malware Detect is scanning detached, capped at ~15% total CPU via systemd cgroup or nice 19 with idle-class disk I/O. It survives disconnects — run another scan later to collect the results.',
          path: null,
          evidence: null,
        }];
      }
      const findings = [];
      for (const line of out.split(NL)) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^(.+?):\s+\{?.*?\}?(.*)$/);
        if (!m) continue;
        findings.push({
          checkId: 'maldet-scan',
          category: 'file',
          severity: 'critical',
          title: `LMD: ${m[2].trim() || 'malware signature match'}`,
          detail: `${m[1].trim()} matched a Linux Malware Detect signature. LMD uses threat data from network edge intrusion detection systems.`,
          path: m[1].trim(),
          evidence: t.slice(0, 300),
        });
      }
      return findings;
    },
  },
  {
    id: 'wazuh-alerts',
    label: 'Checking Wazuh agent security alerts',
    category: 'system',
    run: async (exec) => {
      // If a Wazuh agent is installed, surface its high-severity alerts
      // (rule level >= 7) from the last chunk of the alerts log.
      const { stdout } = await exec(
        `[ -d /var/ossec ] || { echo NOWAZUH; exit 0; }; ` +
        `tail -c 400000 /var/ossec/logs/alerts/alerts.json 2>/dev/null | head -n 300`
      );
      const out = stdout || '';
      if (out.includes('NOWAZUH')) return [];
      const findings = [];
      for (const line of out.split(NL)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const j = JSON.parse(t);
          const level = j?.rule?.level ?? 0;
          if (level < 7) continue;
          const sev = level >= 12 ? 'critical' : level >= 9 ? 'high' : 'medium';
          if (findings.length >= 10) break;
          findings.push({
            checkId: 'wazuh-alerts',
            category: 'system',
            severity: sev,
            title: `Wazuh L${level}: ${j?.rule?.description || 'security event'}`,
            detail: `Alert from the Wazuh agent${j?.location ? ` (${j.location})` : ''}. Rule ${j?.rule?.id ?? '?'} — review in the Wazuh dashboard for full context.`,
            path: j?.location || null,
            evidence: t.slice(0, 300),
          });
        } catch (_) {}
      }
      return findings;
    },
  },
  {
    id: 'miner-process',
    label: 'Scanning processes for cryptominers',
    category: 'process',
    run: async (exec) => {
      const { stdout } = await exec(
        `ps -eo pid,user,pcpu,pmem,etime,args --sort=-pcpu 2>/dev/null | head -n 60`
      );
      const MINER_PATTERNS = [
        /xmrig/i, /cryptonight/i, /stratum\+tcp/i, /minerd/i, /cpuminer/i,
        /kdevtmpfsi/i, /kinsing/i, /donnaskf/i, /pty[0-9]+$/i, /xmr-stak/i,
        /monerod.*--(p2p|rpc)-bind/i, /nanominer/i, /trex/i, /gminer/i,
        /pool\.minexmr/i, /supportxmr/i, /nanopool/i, /f2pool/i,
      ];
      // Legitimate high-CPU security/AV tooling — never flag these as miners
      // (they are often OUR OWN scans running on this server).
      const SECURITY_TOOLS = /^(clamscan|clamdscan|clamd|freshclam|maldet|lmd|rkhunter|chkrootkit|wazuh-agentd|wazuh-analysisd|wazuh-syscheckd|wazuh-logcollector|wazuh-execd|ossec-[a-z]+|yara|lynis|aide|tripwire)$/i;
      const findings = [];
      const lines = (stdout || '').split(NL).slice(1);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.*)$/);
        if (!m) continue;
        const [, pid, user, cpu, , etime, args] = m;
        const procName = args.trim().split(/\s+/)[0].replace(/^.*\//, '');
        if (SECURITY_TOOLS.test(procName)) continue;
        const hit = MINER_PATTERNS.find(rx => rx.test(args));
        // Also flag very-high CPU processes with obfuscated/hidden names
        const looksHidden = /^\[?(kworker[a-z0-9]*|[a-z0-9]{8,})\]?$/i.test(procName) && parseFloat(cpu) > 80;
        if (hit || looksHidden) {
          findings.push({
            checkId: 'miner-process',
            category: 'process',
            severity: 'critical',
            title: `Suspected cryptominer process (PID ${pid}, ${cpu}% CPU)`,
            detail: hit ? `Matches known miner pattern: ${hit}` : `Process "${args.trim().split(/\s+/)[0]}" consuming ${cpu}% CPU with an unusual name`,
            path: args.trim().split(/\s+/).slice(0, 3).join(' '),
            pid: parseInt(pid, 10),
            evidence: t.slice(0, 300),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'hidden-process',
    label: 'Checking for hidden/deleted-binary processes',
    category: 'process',
    run: async (exec) => {
      const { stdout } = await exec(
        `ls -l /proc/*/exe 2>/dev/null | grep '(deleted)' | head -n 20`
      );
      // Known runtimes whose binaries legitimately get replaced during package
      // updates while old processes are still running — not malware signals
      // unless the binary lives in a world-writable location.
      const KNOWN_RUNTIME = /^\/(usr|opt|snap)\/.*\/(python[0-9.]*|node|perl|ruby|php[0-9.]*|java|bash|sh|dash)$/;
      const WORLD_WRITABLE = /^\/(tmp|var\/tmp|dev\/shm)\//;
      const findings = [];
      for (const line of (stdout || '').split(NL)) {
        const m = line.match(/\/proc\/(\d+)\/exe\s*->\s*(.*)\(deleted\)/);
        if (!m) continue;
        const exePath = m[2].trim();
        if (KNOWN_RUNTIME.test(exePath) && !WORLD_WRITABLE.test(exePath)) continue;
        findings.push({
          checkId: 'hidden-process',
          category: 'process',
          severity: WORLD_WRITABLE.test(exePath) ? 'critical' : 'high',
          title: `Process running from a deleted binary (PID ${m[1]})`,
          detail: 'Malware often deletes its own binary after starting to evade detection. Verify what launched this process before acting.',
          path: exePath,
          pid: parseInt(m[1], 10),
          evidence: line.trim().slice(0, 300),
        });
      }
      return findings;
    },
  },
  {
    id: 'tmp-executables',
    label: 'Searching /tmp, /dev/shm, /var/tmp for executables',
    category: 'file',
    run: async (exec) => {
      const { stdout } = await exec(
        `find /tmp /var/tmp /dev/shm -maxdepth 3 -type f \\( -perm -u+x -o -name '*.sh' \\) -not -path '*/systemd-*' 2>/dev/null | head -n 200`
      );
      // Known-benign locations inside world-writable dirs:
      // - _MEIxxxxxx  : PyInstaller self-extraction dirs (app bundles)
      // - .X11-unix / .ICE-unix / .font-unix / .Test-unix : X11 sockets
      // - systemd-private-* : systemd service private tmp
      // - snap / flatpak staging
      const BENIGN_DIR = /\/(_MEI[A-Za-z0-9]+|\.X11-unix|\.ICE-unix|\.font-unix|\.Test-unix|\.XIM-unix|systemd-private-[a-z0-9-]+|snap\.|flatpak)(\/|$)/i;
      const findings = [];
      const byDir = new Map();
      for (const p of (stdout || '').split(NL)) {
        const path = p.trim();
        if (!path || /\.(log|txt|lock|pid|sock)$/i.test(path)) continue;
        if (BENIGN_DIR.test(path)) continue;
        const dir = path.substring(0, path.lastIndexOf('/')) || path;
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(path);
      }
      for (const [dir, files] of byDir) {
        findings.push({
          checkId: 'tmp-executables',
          category: 'file',
          severity: 'medium',
          title: `${files.length} executable file${files.length === 1 ? '' : 's'} in world-writable directory`,
          detail: `${dir} — malware commonly drops payloads here. Review the listed files; quarantine individual files if anything looks unfamiliar.`,
          path: files.length === 1 ? files[0] : dir,
          evidence: files.slice(0, 8).join(NL) + (files.length > 8 ? `${NL}… +${files.length - 8} more` : ''),
        });
      }
      return findings;
    },
  },
  {
    id: 'suspicious-cron',
    label: 'Inspecting cron jobs and systemd timers',
    category: 'cron',
    run: async (exec) => {
      const { stdout } = await exec(
        `(cat /etc/crontab 2>/dev/null; ls -la /etc/cron.d/ 2>/dev/null | awk '{print $NF}' | grep -v '^\\.$' | grep -v '^\\.\\.$'; crontab -l 2>/dev/null; for u in $(cut -d: -f1 /etc/passwd 2>/dev/null); do crontab -l -u "$u" 2>/dev/null; done) | grep -vE '^#|^$' | head -n 80`
      );
      const SUSPICIOUS = /(curl|wget)[^|]*\|\s*(ba)?sh|(curl|wget).*-o.*(\/tmp|\/dev\/shm)|base64\s+-d|python[^ ]*\s+-c\s|nc\s+-e|\/dev\/tcp|chmod\s+\+x.*http/i;
      const findings = [];
      for (const line of (stdout || '').split(NL)) {
        const t = line.trim();
        if (!t || !SUSPICIOUS.test(t)) continue;
        findings.push({
          checkId: 'suspicious-cron',
          category: 'cron',
          severity: 'critical',
          title: 'Suspicious scheduled task (downloads & executes remote code)',
          detail: 'Cron entry pipes downloaded content straight into a shell — classic persistence mechanism.',
          path: 'crontab',
          evidence: t.slice(0, 300),
        });
      }
      return findings;
    },
  },
  {
    id: 'ssh-forced-command',
    label: 'Auditing authorized_keys',
    category: 'auth',
    run: async (exec) => {
      const { stdout } = await exec(
        `find /root /home -maxdepth 4 -name authorized_keys -type f 2>/dev/null | head -n 20 | xargs -r grep -lE 'command=|no-port-forwarding|from=' 2>/dev/null`
      );
      const findings = [];
      for (const f of (stdout || '').split(NL)) {
        const file = f.trim();
        if (!file) continue;
        findings.push({
          checkId: 'ssh-forced-command',
          category: 'auth',
          severity: 'low',
          title: 'SSH key with forced command or restrictions',
          detail: `${file} contains a key with command= restrictions. Usually intentional (rclone/git deploy keys) — verify these are yours, not attacker-planted.`,
          path: file,
          evidence: file,
        });
      }
      return findings;
    },
  },
  {
    id: 'ssh-root-login',
    label: 'Checking SSH root login policy',
    category: 'auth',
    run: async (exec) => {
      const { stdout } = await exec(
        `grep -E '^\\s*PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null | tail -n 1`
      );
      const line = (stdout || '').trim();
      if (!/PermitRootLogin\s+(yes|prohibit-password)/.test(line)) return [];
      const allowsPassword = /PermitRootLogin\s+yes/.test(line);
      return [{
        checkId: 'ssh-root-login',
        category: 'auth',
        severity: allowsPassword ? 'high' : 'low',
        title: allowsPassword
          ? 'SSH root login with password permitted'
          : 'SSH root login allowed with keys only',
        detail: allowsPassword
          ? 'sshd_config has PermitRootLogin yes — attackers can brute-force the root password directly. Recommended: "PermitRootLogin prohibit-password" (keys only). Use the Harden action to apply this safely.'
          : 'Root login is restricted to key authentication. This is acceptable; harden further with "no" if direct root SSH is never needed.',
        path: '/etc/ssh/sshd_config',
        evidence: line,
      }];
    },
  },
  {
    id: 'brute-force',
    label: 'Checking auth log for brute-force attacks',
    category: 'auth',
    run: async (exec) => {
      const { stdout } = await exec(
        `(grep -c 'Failed password' /var/log/auth.log 2>/dev/null || journalctl -u ssh --since '24 hours ago' 2>/dev/null | grep -c 'Failed password') ; echo ---; (grep 'Failed password' /var/log/auth.log 2>/dev/null || journalctl -u ssh --since '24 hours ago' 2>/dev/null | grep 'Failed password') | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn | head -n 10`
      );
      const [countPart, topPart] = (stdout || '').split('---');
      const failedCount = parseInt((countPart || '').trim(), 10) || 0;
      const findings = [];
      if (failedCount > 100) {
        const offenders = (topPart || '').trim().split(NL).slice(0, 5).join('; ');
        findings.push({
          checkId: 'brute-force',
          category: 'auth',
          severity: failedCount > 1000 ? 'high' : 'medium',
          title: `${failedCount} failed SSH login attempts detected`,
          detail: `Top sources: ${offenders || 'unknown'}. Consider fail2ban and key-only auth.`,
          path: '/var/log/auth.log',
          evidence: offenders.slice(0, 300),
        });
      }
      return findings;
    },
  },
  {
    id: 'suspicious-network',
    label: 'Checking outbound connections of suspicious processes',
    category: 'network',
    run: async (exec) => {
      const { stdout } = await exec(
        `ss -tunap 2>/dev/null | grep ESTAB | grep -vE ':(22|80|443|53)\\s' | head -n 40`
      );
      const findings = [];
      const MINER_PORTS = /(3333|4444|5555|7777|8888|9999|14444|14433|45700)/;
      for (const line of (stdout || '').split(NL)) {
        const t = line.trim();
        if (!t) continue;
        const procMatch = t.match(/users:\(\("([^"]+)",pid=(\d+)/);
        const procName = procMatch ? procMatch[1] : '';
        const isMinerLike = MINER_PORTS.test(t) && !/(nginx|apache|node|python|java|docker|containerd|postgres|mysql|redis|mongod)/i.test(procName);
        if (isMinerLike) {
          findings.push({
            checkId: 'suspicious-network',
            category: 'network',
            severity: 'high',
            title: `Suspicious established connection${procName ? ` from ${procName}` : ''}`,
            detail: 'Connection on a port commonly used by botnet/miner C&C traffic.',
            path: procName || null,
            pid: procMatch ? parseInt(procMatch[2], 10) : null,
            evidence: t.slice(0, 300),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'recent-suid',
    label: 'Scanning recently modified SUID binaries',
    category: 'system',
    run: async (exec) => {
      const { stdout } = await exec(
        `nice -n 19 find / -xdev -perm -4000 -type f -mtime -30 2>/dev/null | grep -vE '^/(usr/(bin|lib|lib64|sbin)|bin|sbin)/' | head -n 20`
      );
      const findings = [];
      for (const p of (stdout || '').split(NL)) {
        const path = p.trim();
        if (!path) continue;
        findings.push({
          checkId: 'recent-suid',
          category: 'system',
          severity: 'critical',
          title: 'Recently modified SUID root binary outside standard paths',
          detail: `${path} — SUID binaries outside /usr are a well-known privilege-escalation backdoor.`,
          path,
          evidence: path,
        });
      }
      return findings;
    },
  },
  {
    id: 'known-malware-paths',
    label: 'Checking known malware drop locations',
    category: 'file',
    run: async (exec) => {
      const { stdout } = await exec(
        `for p in /tmp/kdevtmpfsi /tmp/kinsing /var/tmp/kdevtmpfsi /tmp/donnaskf /tmp/systemd-private*/bin /dev/shm/.x11 /root/.configrc* /tmp/.X25-unix /tmp/.ICE-unix/*.x86_64 /tmp/libprocesses /tmp/.mxps; do [ -e "$p" ] && echo "FOUND $p"; done 2>/dev/null | head -n 20`
      );
      const findings = [];
      for (const line of (stdout || '').split(NL)) {
        const m = line.match(/^FOUND (.+)$/);
        if (!m) continue;
        findings.push({
          checkId: 'known-malware-paths',
          category: 'file',
          severity: 'critical',
          title: 'Known malware file present',
          detail: `${m[1]} matches a well-documented malware dropper location (kdevtmpfsi/kinsing family).`,
          path: m[1],
          evidence: line.trim(),
        });
      }
      return findings;
    },
  },
];

/**
 * Run all checks sequentially against a server.
 * @param {Function} getSshConfigFn  configured getSshConfig from _ssh.js
 * @param {string}   connectionId
 * @param {object}   options          { userId, onProgress(checkIdx, total, label) }
 * @returns {{ findings: Array, durationMs: number }}
 */
export async function runSecurityScan(getSshConfigFn, connectionId, options = {}) {
  const started = Date.now();
  const mode = options.mode === 'quick' || options.mode === 'full' ? options.mode : 'deep';
  const isQuick = mode === 'quick';
  // Checks excluded from Quick Scan: the two heavy engine LAUNCHERS are still
  // executed in quick mode but in harvest-only form (collect finished results,
  // never launch), and the SUID sweep walks the whole filesystem.
  const DEEP_ONLY = new Set(['recent-suid']);
  const HARVEST_ONLY = new Set(['clamav-signatures', 'maldet-scan']);

  const sshConfig = await getSshConfigFn(connectionId, { userId: options.userId });
  const exec = (cmd) => execCommand(sshConfig, cmd, { timeoutMs: 45000 });

  const allFindings = [];
  let idx = 0;
  for (const check of CHECKS) {
    options.onProgress?.(idx, CHECKS.length, check.label);
    idx++;
    if (isQuick && DEEP_ONLY.has(check.id)) continue;
    try {
      const checkExec = check.timeoutMs
        ? (cmd) => execCommand(sshConfig, cmd, { timeoutMs: check.timeoutMs })
        : exec;
      const opts = {
        harvestOnly: isQuick && HARVEST_ONLY.has(check.id),
        scope: mode === 'full' ? 'full' : 'standard',
      };
      const found = await check.run(checkExec, opts);
      allFindings.push(...found);
    } catch (err) {
      // A failing check (permissions, missing tools) shouldn't abort the scan
      console.warn(`[virus-scan] check ${check.id} failed:`, err?.message);
    }
  }

  return { findings: allFindings, durationMs: Date.now() - started };
}

export const SCAN_CHECK_COUNT = CHECKS.length;