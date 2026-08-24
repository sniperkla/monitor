import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

/**
 * Unified trusted-engine management: ClamAV, Maldet (LMD), Wazuh agent.
 *
 * GET  ?engine=clamav|maldet|wazuh&connectionId=...  → status
 * POST { engine, connectionId, managerIp? }          → install
 */

const INSTALL_TIMEOUT = 570000;
const NL = String.fromCharCode(10);

// Status checks hit live servers — never let Next cache GET responses
export const dynamic = 'force-dynamic';

function detectPm() {
  return `if command -v apt-get >/dev/null 2>&1; then echo apt-get; ` +
    `elif command -v dnf >/dev/null 2>&1; then echo dnf; ` +
    `elif command -v yum >/dev/null 2>&1; then echo yum; else echo none; fi`;
}

const STATUS_CMDS = {
  clamav: `(clamscan --version 2>/dev/null || clamdscan --version 2>/dev/null) | head -n 1`,
  maldet: `[ -x /usr/local/sbin/maldet ] && echo installed || echo not-installed`,
  wazuh: `[ -x /var/ossec/bin/wazuh-control ] && (/var/ossec/bin/wazuh-control status 2>/dev/null | head -n 3; echo ---; grep -o '"manager": *"[^"]*"' /var/ossec/etc/ossec.conf 2>/dev/null | head -1) || echo not-installed`,
  'wazuh-manager': `[ -x /var/ossec/bin/wazuh-control ] && (systemctl is-active wazuh-manager 2>/dev/null || echo inactive; echo ---; echo manager) || echo not-installed`,
};

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const engine = searchParams.get('engine');
    const sshConfig = await getSshConfig(connectionId, { userId });

    // Raw diagnostics of everything scan-related on the target server.
    // Usage: ?debug=1&connectionId=... → returns tmux/procs/files/runner state.
    if (searchParams.get('debug') === '1') {
      const r = await execCommand(
        sshConfig,
        `echo \"--- SERVER HOSTNAME ---\"; hostname; echo \"ip: $(hostname -I 2>/dev/null | awk '{print $1}')\"; ` +
        `echo '--- tmux sessions ---'; tmux ls 2>&1; ` +
        `echo '--- scanner processes ---'; (ps -eo pid,args 2>/dev/null | grep -E '[c]lamscan -r|sbin/malde[t]' | grep -v grep || echo none); ` +
        `echo '--- monitor files ---'; ls -la /var/tmp/.monitor-* 2>&1; ` +
        `for f in /var/tmp/.monitor-clamav-scan.txt /var/tmp/.monitor-maldet-scan.txt; do ` +
        `  [ -f "$f" ] && { echo "== tail $f =="; tail -n 3 "$f"; }; done; ` +
        `echo '--- runner scripts ---'; for f in /var/tmp/.monitor-monitor-vclam.sh /var/tmp/.monitor-monitor-vmaldet.sh; do ` +
        `  [ -f "$f" ] && { echo "== head $f =="; head -n 6 "$f"; } || echo "missing $f"; done; ` +
        `echo '--- launch errors ---'; for f in /var/tmp/*vclam*-err.log /var/tmp/*vmaldet*-err.log; do ` +
        `  [ -s "$f" ] && { echo "== $f =="; head -n 3 "$f"; }; done 2>/dev/null; ` +
        `echo '--- ENGINE BINARIES (ground truth) ---'; ` +
        `for b in /usr/local/sbin/maldet /usr/local/bin/maldet /usr/bin/maldet /usr/local/maldetect/maldet /usr/local/maldetect /usr/bin/clamscan /usr/local/bin/clamscan /var/ossec; do ` +
        `  if [ -e "$b" ]; then echo "PRESENT: $b"; else echo "absent : $b"; fi; done; ` +
        `echo "PATH-maldet  : $(command -v maldet 2>/dev/null || echo none)"; ` +
        `echo "PATH-clamscan: $(command -v clamscan 2>/dev/null || echo none)"; ` +
        `echo '--- maldet cron leftovers ---'; ls -la /etc/cron.d/maldet /etc/cron.daily/maldet 2>/dev/null || echo none; ` +
        `echo '--- install logs ---'; for f in /var/tmp/.monitor-*-install.log; do ` +
        `  [ -s "$f" ] && { echo "== $f (last 20 lines) =="; tail -n 20 "$f"; }; done; ` +
        `echo '(end)'`,
        { timeoutMs: 30000 }
      );
      return NextResponse.json({ success: true, output: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() });
    }

    // Background scan session status: ClamAV/LMD scans + Wazuh service state.
    // NOTE: handled BEFORE the engine-param validation below because this mode
    // does not require ?engine= — previously placed after it, every badge poll
    // returned 400 and badges stayed stuck on Idle forever.
    if (searchParams.get('tmux') === '1') {
      // Tri-state per engine:
      //   running — tmux session OR scanner process alive
      //   done    — output file ends with __DONE__ (completed, awaiting harvest)
      //   stopped — output file exists WITHOUT __DONE__ (killed / crashed)
      //   idle    — nothing has ever run
      const r3 = await execCommand(
        sshConfig,
        // [i]/[m] character-class trick: the pattern must not match its own
        // containing shell's cmdline, otherwise pgrep always reports "running"
        // even when nothing is actually scanning.
        `CL=running; ML=running; ` +
        // A scan may be running as a systemd transient unit (preferred launch
        // path) — treat an active unit exactly like a live tmux session.
        `SC_UNIT=0; systemctl is-active --quiet monitor-vclam-scan 2>/dev/null && SC_UNIT=1; ` +
        `SM_UNIT=0; systemctl is-active --quiet monitor-vmaldet-scan 2>/dev/null && SM_UNIT=1; ` +
        `if ! tmux has-session -t monitor-vclam 2>/dev/null && [ "$SC_UNIT" = "0" ] && ! pgrep -f 'clamscan -r --[i]nfected' >/dev/null 2>&1; then ` +
        `  CL=idle; ` +
        `  if [ -f /var/tmp/.monitor-clamav-scan.txt ]; then ` +
        `    if tail -n 1 /var/tmp/.monitor-clamav-scan.txt | grep -q '^__DONE__$'; then CL=done; else CL=stopped; fi; ` +
        `  fi; ` +
        `fi; ` +
        `if ! tmux has-session -t monitor-vmaldet 2>/dev/null && [ "$SM_UNIT" = "0" ] && ! pgrep -f '[m]aldet -a' >/dev/null 2>&1; then ` +
        `  ML=idle; ` +
        `  if [ -f /var/tmp/.monitor-maldet-scan.txt ]; then ` +
        `    if tail -n 1 /var/tmp/.monitor-maldet-scan.txt | grep -q '^__DONE__$'; then ML=done; else ML=stopped; fi; ` +
        `  fi; ` +
        `fi; ` +
        `echo "vclam=$CL"; echo "vmaldet=$ML"; ` +
        `WZ=none; if [ -x /var/ossec/bin/wazuh-control ]; then WZ=stopped; ` +
        `if systemctl is-active --quiet wazuh-manager 2>/dev/null || systemctl is-active --quiet wazuh-agent 2>/dev/null; then WZ=active; fi; fi; ` +
        `echo "wazuh=$WZ"`,
        { timeoutMs: 30000 }
      );
      const map = {};
      for (const line of (r3.stdout || '').trim().split(NL)) {
        const [k, v] = line.split('=');
        if (k && v) map[k.trim()] = v.trim();
      }
      return NextResponse.json({
        success: true,
        sessions: {
          clamav: map['vclam'] || 'idle',
          maldet: map['vmaldet'] || 'idle',
          wazuh: map['wazuh'] === 'none' ? null : map['wazuh'],
        },
      });
    }

    if (!connectionId || !STATUS_CMDS[engine]) {
      return NextResponse.json({ success: false, error: 'Missing/invalid engine or connectionId' }, { status: 400 });
    }


    // Live install log streaming: tail the installer's log file and report
    // whether the tmux install session is still running.
    if (searchParams.get('log') === '1') {
      const sess = `monitor-inst-${engine}`;
      const log = `/var/tmp/.monitor-${engine}-install.log`;
      const r2 = await execCommand(
        sshConfig,
        `[ -f ${log} ] && tail -c 12000 ${log} || true; echo __SPLIT__; tmux has-session -t ${sess} 2>/dev/null && echo RUNNING || echo FINISHED`,
        { timeoutMs: 30000 }
      );
      const [logPart, statePart] = (r2.stdout || '').split('__SPLIT__');
      const running = (statePart || '').includes('RUNNING');
      return NextResponse.json({ success: true, engine, running, done: !running, lines: (logPart || '').trim() });
    }

    const r = await execCommand(sshConfig, STATUS_CMDS[engine], { timeoutMs: 30000 });
    const out = (r.stdout || '').trim();
    let available = false;
    let version = null;
    let extra = null;

    if (engine === 'clamav') {
      available = !!out && !out.includes('not found') && !out.includes('command not found');
      version = available ? out : null;
    } else if (engine === 'maldet') {
      // ⚠ Exact match only — "not-installed".includes('installed') is true,
      // which kept the engine card green forever after a successful uninstall!
      available = out.trim() === 'installed';
      version = available ? 'LMD' : null;
    } else if (engine === 'wazuh') {
      const [statusPart, mgrPart] = out.split('---');
      available = !out.includes('not-installed');
      version = available ? 'agent' : null;
      extra = { running: /is running/.test(statusPart || ''), manager: (mgrPart || '').trim().split('"')[3] || null };
    } else if (engine === 'wazuh-manager') {
      const [statusPart] = out.split('---');
      available = !out.includes('not-installed');
      version = available ? 'manager' : null;
      extra = { running: statusPart?.trim() === 'active' };
    }

    return NextResponse.json({ success: true, engine, available, version, extra });
  } catch (error) {
    console.error('[virus-scan/engine] GET error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Check failed' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;

    let body;
    try { body = await request.json(); } catch (_) {}
    const { engine, connectionId, managerIp, action = 'install' } = body || {};
    if (!connectionId || !['clamav', 'maldet', 'wazuh', 'wazuh-manager'].includes(engine)) {
      return NextResponse.json({ success: false, error: 'Missing/invalid engine or connectionId' }, { status: 400 });
    }
    if (!['install', 'stop', 'uninstall'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
    if (action === 'install' && engine === 'wazuh' && !managerIp) {
      return NextResponse.json({ success: false, error: 'Wazuh requires the IP of your Wazuh manager server' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId, { userId });

    // Shared pre-flight: package manager + downloader + reachability of the
    // download host. Emits a specific marker instead of a generic failure so
    // the UI can tell the user exactly what is wrong.
    // url is optional — distro-repo engines (clamav) skip the strict network
    // probe because apt/dnf use their own mirrors; the installer log captures
    // any real download error anyway.
    // SUDO: installs need root. If the SSH user isn't root, require passwordless
    // sudo (non-interactive) — otherwise fail with a clear, actionable error.
    const SUDO_PRE =
      `SUDO=""; [ "$(id -u)" = "0" ] || { command -v sudo >/dev/null 2>&1 || { echo NOSUDO_NOBIN; exit 0; }; ` +
      `sudo -n true 2>/dev/null || { echo NOSUDO_NEEDPW; exit 0; }; SUDO="sudo -n"; }; `;

    // ── ACTION: stop a running background scan ──
    if (action === 'stop') {
      // Bracketed pgrep patterns cannot match their own containing shell.
      const stopMap = {
        // -x exact-name kills — immune to cmdline self-matching
        clamav: `systemctl stop monitor-vclam-scan.service 2>/dev/null; tmux kill-session -t monitor-vclam 2>/dev/null; pkill -9 -x clamscan 2>/dev/null; sleep 0.5; pgrep -x clamscan >/dev/null 2>&1 && echo STILL_RUNNING || echo STOPPED`,
        maldet: `systemctl stop monitor-vmaldet-scan.service 2>/dev/null; tmux kill-session -t monitor-vmaldet 2>/dev/null; pkill -9 -x maldet 2>/dev/null; sleep 0.5; pgrep -x maldet >/dev/null 2>&1 && echo STILL_RUNNING || echo STOPPED`,
        wazuh: `systemctl stop wazuh-agent 2>/dev/null; systemctl stop wazuh-manager 2>/dev/null; sleep 0.5; (systemctl is-active --quiet wazuh-agent 2>/dev/null || systemctl is-active --quiet wazuh-manager 2>/dev/null) && echo STILL_RUNNING || echo STOPPED`,
        'wazuh-manager': `systemctl stop wazuh-manager 2>/dev/null; sleep 0.5; systemctl is-active --quiet wazuh-manager 2>/dev/null && echo STILL_RUNNING || echo STOPPED`,
      };
      try {
        const r = await execCommand(sshConfig, stopMap[engine], { timeoutMs: 30000 });
        const stopped = (r.stdout || '').includes('STOPPED');
        return NextResponse.json({
          success: true,
          stopped,
          message: stopped ? 'Scan stopped.' : 'Process did not exit — check the server manually.',
        });
      } catch (e) {
        return NextResponse.json({ success: false, error: e.message || 'Stop failed' }, { status: 500 });
      }
    }

    // ── ACTION: uninstall an engine entirely (+ clean scan artifacts) ──
    if (action === 'uninstall') {
      const CLEANUP =
        `tmux kill-session -t monitor-vclam 2>/dev/null; tmux kill-session -t monitor-vmaldet 2>/dev/null; ` +
        // -x matches the exact binary name only — NEVER use -f path patterns
        // here: this compound's own cmdline contains those plain paths (rm -rf
        // targets), so -f would kill our own shell mid-run (zero-output bug).
        `pkill -9 -x clamscan 2>/dev/null; pkill -9 -x clamdscan 2>/dev/null; pkill -9 -x freshclam 2>/dev/null; pkill -9 -x maldet 2>/dev/null; pkill -9 -f 'clamscan -r --[i]nfected' 2>/dev/null; ` +
        `rm -f /var/tmp/.monitor-clamav-scan.txt /var/tmp/.monitor-maldet-scan.txt /var/tmp/monitor-vclam.runner.sh /var/tmp/monitor-vmaldet.runner.sh /var/tmp/monitor-*-err.log /var/tmp/.monitor-monitor-*.sh /var/tmp/.monitor-install-*.sh 2>/dev/null; ` +
        `rm -f /etc/cron.d/maldet /etc/cron.daily/maldet 2>/dev/null; `;
      const ULOG = '/var/tmp/.monitor-uninstall.log';
      const LOGOPEN = `ULOG=${ULOG}; : > "$ULOG"; `;
      let un;
      if (engine === 'clamav') {
        un =
          SUDO_PRE +
          LOGOPEN +
          `PM=$( ${detectPm()} ); echo "PM=$PM user=$(id -u)" >> "$ULOG"; ` + CLEANUP +
          `{ systemctl disable --now clamav-freshclam 2>/dev/null; systemctl disable --now clamav-daemon 2>/dev/null; case "$PM" in ` +
          `apt-get) DEBIAN_FRONTEND=noninteractive $SUDO apt-get purge -y 'clamav*' 'libclamav*' 'clamd*' >>"$ULOG" 2>&1 || true; $SUDO apt-get autoremove -y >>"$ULOG" 2>&1 || true ;; ` +
          `dnf) $SUDO dnf remove -y 'clamav*' 'clamd*' >>"$ULOG" 2>&1 || true ;; ` +
          `yum) $SUDO yum remove -y 'clamav*' 'clamd*' >>"$ULOG" 2>&1 || true ;; ` +
          `*) echo "no-known-package-manager" >>"$ULOG" ;; esac; }; ` +
          `(clamscan --version >/dev/null 2>&1 || clamdscan --version >/dev/null 2>&1) && { echo STILL_PRESENT >> "$ULOG"; } || { echo REMOVED >> "$ULOG"; } ; ` +
          `tail -c 600 "$ULOG"`;
      } else if (engine === 'maldet') {
        un =
          SUDO_PRE +
          LOGOPEN +
          `echo "user=$(id -u)" >> "$ULOG"; ` + CLEANUP +
          `{ [ -x /usr/local/sbin/maldet ] && $SUDO /usr/local/sbin/maldet --uninstall >>"$ULOG" 2>&1; ` +
          `$SUDO rm -rf /usr/local/maldetect /usr/local/sbin/maldet; }; ` +
          `[ -x /usr/local/sbin/maldet ] && { echo STILL_PRESENT >> "$ULOG"; } || { echo REMOVED >> "$ULOG"; } ; ` +
          `tail -c 600 "$ULOG"`;
      } else {
        const pkg = engine === 'wazuh' ? 'wazuh-agent' : 'wazuh-manager';
        un =
          SUDO_PRE +
          LOGOPEN +
          `PM=$( ${detectPm()} ); PKG='${pkg}'; echo "PKG=$PKG PM=$PM user=$(id -u)" >> "$ULOG"; ` + CLEANUP +
          `{ $SUDO systemctl disable --now "$PKG" 2>/dev/null; case "$PM" in ` +
          `apt-get) DEBIAN_FRONTEND=noninteractive $SUDO apt-get purge -y "$PKG" >>"$ULOG" 2>&1 || true; $SUDO apt-get autoremove -y >>"$ULOG" 2>&1 || true ;; ` +
          `dnf) $SUDO dnf remove -y "$PKG" >>"$ULOG" 2>&1 || true ;; ` +
          `yum) $SUDO yum remove -y "$PKG" >>"$ULOG" 2>&1 || true ;; esac; $SUDO rm -rf /var/ossec; }; ` +
          `((rpm -q "$PKG" >/dev/null 2>&1 || dpkg -s "$PKG" >/dev/null 2>&1)) && { echo STILL_PRESENT >> "$ULOG"; } || { echo REMOVED >> "$ULOG"; } ; ` +
          `tail -c 600 "$ULOG"`;
      }
      try {
        const r = await execCommand(sshConfig, un, { timeoutMs: 300000 });
        const out = (r.stdout || '') + (r.stderr ? `\n[stderr] ${r.stderr}` : '');
        if (out.includes('NOSUDO_NOBIN') || out.includes('NOSUDO_NEEDPW')) {
          return NextResponse.json({ success: false, error: 'Uninstall requires root or passwordless sudo on the server' }, { status: 403 });
        }
        if (out.includes('REMOVED')) {
          return NextResponse.json({ success: true, removed: true, message: 'Engine uninstalled and scan artifacts cleaned.' });
        }
        const excerpt = out.trim().slice(-350) || '(no output — see /var/tmp/.monitor-uninstall.log on the server)';
        return NextResponse.json({ success: false, error: `Uninstall did not complete — engine still present. Log tail: ${excerpt}` }, { status: 500 });
      } catch (e) {
        return NextResponse.json({ success: false, error: `${e.message || 'Uninstall failed'} — full log: ${ULOG} on the server` }, { status: 500 });
      }
    }

    const preflight = (url) =>
      `PM=$( ${detectPm()} ); [ "$PM" = "none" ] && { echo NOPM; exit 0; }; ` +
      `command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || { echo NOCURL; exit 0; }; ` +
      SUDO_PRE +
      (url
        ? `(curl -sI --max-time 15 '${url}' 2>/dev/null || wget -q --spider -T 15 '${url}' 2>/dev/null) >/dev/null 2>&1 || { echo 'NETFAIL ${url}'; exit 0; }; `
        : '');

    // Shared Wazuh repository setup (used by both agent and manager installs)
    const WAZUH_REPO =
      `if [ "$PM" = "apt-get" ]; then ` +
      `  $SUDO mkdir -p /usr/share/keyrings; ` +
      `  (curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH || wget -qO- https://packages.wazuh.com/key/GPG-KEY-WAZUH) | $SUDO gpg --dearmor -o /usr/share/keyrings/wazuh.gpg; ` +
      `  echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | $SUDO tee /etc/apt/sources.list.d/wazuh.list >/dev/null; ` +
      `  $SUDO apt-get update; ` +
      `else ` +
      `  $SUDO rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH; ` +
      `  printf '[wazuh]\\ngpgcheck=1\\ngpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH\\nenabled=1\\nname=Wazuh repository\\nbaseurl=https://packages.wazuh.com/4.x/yum/\\nprotect=1\\n' | $SUDO tee /etc/yum.repos.d/wazuh.repo >/dev/null; ` +
      `fi`;

    // The full install pipeline is written to a temp script and executed inside
    // a detached tmux session so it survives disconnects AND the user can watch
    // the live output (streamed via GET ?log=1) while it runs.
    let inner;
    if (engine === 'clamav') {
      inner =
        preflight(null) +
        `LOG=/var/tmp/.monitor-clamav-install.log; : > "$LOG"; ` +
        `{ case "$PM" in ` +
        `  apt-get) DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y clamav clamav-daemon ;; ` +
        `  dnf) $SUDO dnf install -y clamav clamav-update ;; ` +
        `  yum) $SUDO yum install -y clamav clamav-update ;; ` +
        `esac; ` +
        `($SUDO freshclam --quiet 2>/dev/null || $SUDO /usr/bin/freshclam --quiet 2>/dev/null); ` +
        `clamscan --version 2>/dev/null | head -n 1; ` +
        `} > "$LOG" 2>&1; ` +
        `clamscan --version >/dev/null 2>&1 && cat "$LOG" || { echo INSTALL_FAIL; tail -n 25 "$LOG"; }`;
    } else if (engine === 'maldet') {
      // LMD is distributed as a tarball from rfxn.com (official source)
      inner =
        preflight('http://www.rfxn.com/downloads/maldetect-current.tar.gz') +
        `LOG=/var/tmp/.monitor-maldet-install.log; : > "$LOG"; cd /tmp && rm -rf maldetect-* maldetect-current.tar.gz && ` +
        `{ (curl -sSL --max-time 120 -o maldetect-current.tar.gz http://www.rfxn.com/downloads/maldetect-current.tar.gz ` +
        `|| wget -q -T 120 -O maldetect-current.tar.gz http://www.rfxn.com/downloads/maldetect-current.tar.gz) && ` +
        `tar xzf maldetect-current.tar.gz && cd maldetect-*/ && $SUDO ./install.sh; ` +
        `} >> "$LOG" 2>&1; ` +
        `[ -x /usr/local/sbin/maldet ] && echo INSTALLED || { echo INSTALL_FAIL; tail -n 25 "$LOG"; }`;
    } else if (engine === 'wazuh') {
      // Wazuh agent — official packages.wazuh.com repo, enrolled to user's manager
      const ip = String(managerIp).replace(/[^a-zA-Z0-9.\-]/g, '');
      const pkg = 'wazuh-agent';
      inner =
        preflight('https://packages.wazuh.com/4.x/') +
        `LOG=/var/tmp/.monitor-wazuh-install.log; : > "$LOG"; ` +
        `{ ` +
        `if [ -x /var/ossec/bin/wazuh-control ]; then ` +
        `  echo '== Wazuh agent already installed =='; ` +
        `else ` +
        `  PKG_PRESENT=0; rpm -q ${pkg} >/dev/null 2>&1 && PKG_PRESENT=1; dpkg -s ${pkg} >/dev/null 2>&1 && PKG_PRESENT=1; ` +
        `  if [ "$PKG_PRESENT" = "0" ]; then ` +
        `    echo '== Step 1/4: Adding official Wazuh repository =='; ` +
        `    ${WAZUH_REPO}; ` +
        `  fi; ` +
        `  echo '== Removing any conflicting wazuh-manager (agent cannot co-exist with manager) =='; ` +
        `  $SUDO $PM remove -y wazuh-manager >>"$LOG" 2>&1 || true; ` +
        `  echo '== Step 2/4: Installing ${pkg} (manager: ${ip}) =='; ` +
        `  if [ "$PM" = "apt-get" ]; then ` +
        `    WAZUH_MANAGER='${ip}' DEBIAN_FRONTEND=noninteractive $SUDO -E apt-get install -y --reinstall ${pkg}; ` +
        `  else ` +
        `    ALLW=""; { [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; } && ALLW="--allowerasing"; ` +
        `    $SUDO env WAZUH_MANAGER='${ip}' $PM install -y $ALLW ${pkg}; ` +
        `    if rpm -q ${pkg} >/dev/null 2>&1 && [ ! -x /var/ossec/bin/wazuh-control ]; then ` +
        `      echo '== Package registered but files missing — forcing reinstall =='; ` +
        `      $SUDO env WAZUH_MANAGER='${ip}' $PM reinstall -y ${pkg}; ` +
        `    fi; ` +
        `  fi; ` +
        `  echo '== Step 3/4: Enabling and starting ${pkg} service =='; ` +
        `  $SUDO systemctl daemon-reload >/dev/null 2>&1; $SUDO systemctl enable ${pkg} >/dev/null 2>&1; $SUDO systemctl start ${pkg} >/dev/null 2>&1 || true; ` +
        `fi; ` +
        `echo '== Step 4/4: Verifying installation =='; ` +
        `if [ -x /var/ossec/bin/wazuh-control ]; then ` +
        `  echo INSTALLED; /var/ossec/bin/wazuh-control version 2>/dev/null | head -n 1; ` +
        `else ` +
        `  echo INSTALL_FAIL; ` +
        `  echo '== Diagnostics =='; ` +
        `  (rpm -q ${pkg} 2>&1 || true) | head -n 1; ` +
        `  dpkg -s ${pkg} 2>/dev/null | head -n 2; ` +
        `  ls /var/ossec 2>&1 | head -n 5; ` +
        `fi; ` +
        `} >> "$LOG" 2>&1; ` +
        `grep -q '^INSTALLED' "$LOG" || { echo INSTALL_FAIL_FINAL; tail -n 30 "$LOG"; }`;
    } else if (engine === 'wazuh-manager') {
      // Wazuh MANAGER — self-contained HIDS brain: analyzes events and stores
      // alerts locally (/var/ossec/logs/alerts/) — no external server needed.
      const pkg = 'wazuh-manager';
      inner =
        preflight('https://packages.wazuh.com/4.x/') +
        `LOG=/var/tmp/.monitor-wazuh-manager-install.log; : > "$LOG"; ` +
        // Wazuh manager needs ~1.5GB+ RAM — on smaller VPSes dpkg/service start
        // fails with cryptic "package not installed / unit not found" errors.
        // Detect up-front and fail with a clear, human reason.
        `{ MEM=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); echo "RAM=\${MEM}MB" >> "$LOG"; if [ "\${MEM:-0}" -lt 1400 ]; then echo '== FAILED: wazuh-manager needs at least ~1.5GB RAM — this server only has '\${MEM}'MB =='; exit 0; fi; } >> "$LOG" 2>&1; ` +
        `{ ` +
        `if [ -x /var/ossec/bin/wazuh-control ] && systemctl is-active --quiet wazuh-manager 2>/dev/null; then ` +
        `  echo '== Wazuh manager already installed and running =='; ` +
        `else ` +
        `  PKG_PRESENT=0; rpm -q ${pkg} >/dev/null 2>&1 && PKG_PRESENT=1; dpkg -s ${pkg} >/dev/null 2>&1 && PKG_PRESENT=1; ` +
        `  if [ "$PKG_PRESENT" = "0" ]; then ` +
        `    echo '== Step 1/4: Adding official Wazuh repository =='; ` +
        `    ${WAZUH_REPO}; ` +
        `  fi; ` +
        `  echo '== Removing any conflicting wazuh-agent (manager cannot co-exist with agent) =='; ` +
        `  $SUDO $PM remove -y wazuh-agent >>"$LOG" 2>&1 || true; ` +
        `  echo '== Step 2/4: Installing ${pkg} (~2 min, includes analysis engine) =='; ` +
        `  if [ "$PM" = "apt-get" ]; then ` +
        `    DEBIAN_FRONTEND=noninteractive $SUDO -E apt-get install -y --reinstall ${pkg}; ` +
        `  else ` +
        `    ALLW=""; { [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; } && ALLW="--allowerasing"; ` +
        `    $SUDO $PM install -y $ALLW ${pkg}; ` +
        `    if rpm -q ${pkg} >/dev/null 2>&1 && [ ! -x /var/ossec/bin/wazuh-control ]; then ` +
        `      echo '== Package registered but files missing — forcing reinstall =='; ` +
        `      $SUDO $PM reinstall -y ${pkg}; ` +
        `    fi; ` +
        `  fi; ` +
        `  echo '== Step 3/4: Enabling and starting wazuh-manager service =='; ` +
        `  $SUDO systemctl daemon-reload >/dev/null 2>&1; $SUDO systemctl enable wazuh-manager >/dev/null 2>&1; $SUDO systemctl start wazuh-manager >/dev/null 2>&1 || true; ` +
        `fi; ` +
        `echo '== Step 4/4: Verifying installation =='; ` +
        `if [ -x /var/ossec/bin/wazuh-control ] && systemctl is-active --quiet wazuh-manager 2>/dev/null; then ` +
        `  echo INSTALLED; /var/ossec/bin/wazuh-control version 2>/dev/null | head -n 1; ` +
        `else ` +
        `  echo INSTALL_FAIL; ` +
        `  echo '== Diagnostics =='; ` +
        `  (rpm -q ${pkg} 2>&1 || true) | head -n 1; ` +
        `  dpkg -s ${pkg} 2>/dev/null | head -n 2; ` +
        `  $SUDO systemctl status wazuh-manager --no-pager 2>&1 | head -n 8; ` +
        `fi; ` +
        `} >> "$LOG" 2>&1; ` +
        `grep -q '^INSTALLED' "$LOG" || { echo INSTALL_FAIL_FINAL; tail -n 30 "$LOG"; }`;
    }

    // Launch the installer inside tmux; output lands in the log file which the
    // client polls via GET ?log=1 for a live terminal preview.
    const sess = `monitor-inst-${engine}`;
    const scriptPath = `/var/tmp/.monitor-install-${engine}.sh`;
    const launchCmd =
      `tmux has-session -t ${sess} 2>/dev/null && { echo ALREADY_RUNNING; exit 0; }; ` +
      `cat > ${scriptPath} <<'MONITOR_INSTALL_SCRIPT'` + NL +
      inner + NL +
      `MONITOR_INSTALL_SCRIPT` + NL +
      `tmux new-session -d -s ${sess} "bash ${scriptPath} > /var/tmp/.monitor-${engine}-install.log 2>&1"; ` +
      `sleep 1; tmux has-session -t ${sess} 2>/dev/null && echo STARTED || { echo LAUNCH_FAIL; head -c 500 /var/tmp/.monitor-${engine}-install.log 2>/dev/null; }`;

    const r = await execCommand(sshConfig, launchCmd, { timeoutMs: 30000 });
    const out = (r.stdout || '').trim();

    if (out.includes('ALREADY_RUNNING')) {
      return NextResponse.json({ success: true, started: true, message: 'Installation already in progress — showing live output' });
    }
    if (out.includes('LAUNCH_FAIL')) {
      return NextResponse.json({ success: false, error: `Failed to start installer: ${out.replace('LAUNCH_FAIL', '').trim().slice(0, 300)}` }, { status: 500 });
    }
    if (!out.includes('STARTED')) {
      return NextResponse.json({ success: false, error: 'Failed to start installer session' }, { status: 500 });
    }
    return NextResponse.json({ success: true, started: true, message: 'Installation started — watch the live output below' });
  } catch (error) {
    console.error('[virus-scan/engine] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Install failed' }, { status: 500 });
  }
}
