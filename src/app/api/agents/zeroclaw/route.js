import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';

/**
 * ZeroClaw (zeroclaw-labs) one-click installer — deploys
 * https://github.com/zeroclaw-labs/zeroclaw onto a selected SSH server via its
 * official install.sh (prebuilt binary, source-build fallback), then starts
 * `zeroclaw daemon` as a user service.
 *
 * Facts from the official docs:
 *   • config: ~/.zeroclaw/config.toml (TOML; dir override ZEROCLAW_CONFIG_DIR)
 *   • daemon: `zeroclaw daemon` (full runtime) — dashboard on port 42617
 *   • service: `zeroclaw service install/start/...` → systemd USER unit "zeroclaw"
 *   • logs: journalctl --user -u zeroclaw, or ~/.zeroclaw/logs/daemon.*.log
 *
 * POST body: { connectionId, action, config?, purge?, live? }
 *   action : 'status' | 'details' | 'install' | 'uninstall' | 'gateway'
 *            | 'logs' | 'save-config' | 'backups' | 'restore-backup' | 'job'
 *   purge  : uninstall also deletes ~/.zeroclaw
 *   live   : install/uninstall run as background job → poll with action 'job'
 */

const INSTALLER_URL = 'https://raw.githubusercontent.com/zeroclaw-labs/zeroclaw/master/install.sh';
// Self-match rule: every literal fragment that could match a pgrep/pkill -f
// pattern must be bracketed or split everywhere it appears in the same remote
// command line ("dae""mon", '[z]eroclaw', ...).
const LOGD = '"$HOME/.zeroclaw/logs"';

function maskSecretString(val) {
  if (!val || typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '••••••••';
  return trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
}

function maskConfigText(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    const m = line.match(/^(\s*["']?(?:apiKey|api_key|token|botToken|password|secret|accessToken|access_token|clientSecret)["']?\s*[:=]\s*["']?)([^"'\r\n]+)(["']?.*)$/i);
    if (m) {
      return `${m[1]}${maskSecretString(m[2])}${m[3]}`;
    }
    return line;
  }).join('\n');
}

function maskEnvText(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    const idx = line.indexOf('=');
    if (idx === -1) return line;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    return `${k}=${maskSecretString(v)}`;
  }).join('\n');
}

const STATUS_SCRIPT = `
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/usr/sbin/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | head -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.zeroclaw/config.toml" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; pgrep -f '[z]eroclaw dae[m]on' >/dev/null 2>&1 && PROC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 42617 || command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q 42617) && PORT=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
INITD=0; ps -p 1 -o comm= 2>/dev/null | grep -qx systemd && INITD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
GZP=0; command -v gzip >/dev/null 2>&1 && GZP=1
PROCP=0; command -v pgrep >/dev/null 2>&1 && PROCP=1
TARP=0; command -v tar >/dev/null 2>&1 && TARP=1
echo "PROC=$PROC"; echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PORT=$PORT"
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"; echo "CURL=$CURLP"; echo "TAR=$TARP"; echo "GZIP=$GZP"; echo "PROCP=$PROCP"
`;

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    const { connectionId, action } = body;
    if ((!connectionId || !action) && action !== 'job') return NextResponse.json({ success: false, error: 'Missing connectionId or action' }, { status: 400 });
    if (action === 'job') return dispatchWithLiveLogs(body, () => ({}));
    return dispatchWithLiveLogs(body, (b, log) => handleAgentAction(b, session, log));
  } catch (e) {
    logger.error('[agents/zeroclaw] POST failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' }, { status: 500 });
  }
}

async function handleAgentAction(body, session, log = []) {
  try {
    const { connectionId, action, config = {}, purge = false } = body;
    const sshConfig = await getSshConfig(connectionId);
    const run = async (label, cmd, opts = {}) => {
      const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 60000, ...opts });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      log.push(`$ ${label}${out ? `\n${out.slice(0, 2500)}` : ''}`);
      return r;
    };
    const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
    const binPath = () => `p="$(export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; command -v zeroclaw 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/usr/sbin/zeroclaw"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`;
    const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"`;

    // ── Gateway control — zeroclaw service CLI, systemd user unit, else nohup ──
    const gwCtl = async (op) => {
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'zeroclaw binary not found' };
      const BP = JSON.stringify(bp);
      if (op === 'status') {
        const r = await execCommand(sshConfig,
          `${ENVX}; systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && echo SVC_ACTIVE || { timeout 15 pgrep -f '[z]eroclaw dae[m]on' >/dev/null && echo PROC_ACTIVE || echo NO_PROC; }`,
          { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /SVC_ACTIVE|PROC_ACTIVE/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        return execCommand(sshConfig,
          `${ENVX}; ${BP} service stop 2>/dev/null; systemctl --user stop zeroclaw 2>/dev/null; timeout 15 pkill -f '[z]eroclaw dae[m]on' 2>/dev/null; sleep 1; pkill -9 -f '[z]eroclaw' 2>/dev/null || true; echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      // start / restart — never write the plain word "daemon" here (self-match)
      if (op === 'restart') await gwCtl('stop');
      const startCmd = `${ENVX}; { ${BP} service start 2>/dev/null || systemctl --user start zeroclaw 2>/dev/null || { mkdir -p ${LOGD}; setsid nohup ${BP} dae""mon >> "$HOME/.zeroclaw/logs/daemon.log" 2>&1 < /dev/null & sleep 3; }; }; sleep 2; timeout 15 pgrep -f '[z]eroclaw dae[m]on' >/dev/null && echo GW_UP || echo GW_DOWN`;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 120000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
    };

    // The daemon can take a few seconds to appear after start — poll.
    const waitActive = async (totalS = 24) => {
      let ok = (await gwCtl('status')).active;
      for (let waited = 0; !ok && waited < totalS; waited += 6) {
        await new Promise(r => setTimeout(r, 6000));
        ok = (await gwCtl('status')).active;
      }
      return ok;
    };

    // ── STATUS ──
    if (action === 'status') {
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      const parse = (k) => (r.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const installed = parse('BIN') === 'SET';
      return NextResponse.json({
        success: true,
        installed,
        version: installed ? parse('VERSION') : null,
        running: parse('USVC') === '1' || parse('SSVC') === '1' || parse('PROC') === '1',
        hasConfig: parse('CONFIG') === '1',
        prereqs: { curl: parse('CURL') === '1', tar: parse('TAR') === '1', systemd: parse('SYSTEMD') === '1', passwordlessSudo: parse('SUDO') === '1' },
      });
    }

    // ── DETAILS ──
    if (action === 'details') {
      const D = `
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"
BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/usr/sbin/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===TOML_B64==="
base64 < "$HOME/.zeroclaw/config.toml" 2>/dev/null || true
echo "===RUNNING==="
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PROC=0; pgrep -f '[z]eroclaw dae[m]on' >/dev/null 2>&1 && PROC=1
echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PROC=$PROC"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | head -1 | cut -c1-40
echo "===MODEL==="
[ -f "$HOME/.zeroclaw/config.toml" ] && grep -E '^\\s*(model|model_provider|default_model)\\s*=' "$HOME/.zeroclaw/config.toml" 2>/dev/null | head -1 | cut -d'"' -f2
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "$HOME/.zeroclaw/skills" ] && ls -1 "$HOME/.zeroclaw/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "$HOME/.zeroclaw/workspace/skills" ] && ls -1 "$HOME/.zeroclaw/workspace/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "$HOME/.zeroclaw/sop" ] && ls -1 "$HOME/.zeroclaw/sop" 2>/dev/null | grep -v '^\.' | sed 's/\.md$//' || true
echo "===PROMPT_B64==="
{ base64 < "$HOME/.zeroclaw/workspace/PROMPT.md" || base64 < "$HOME/.zeroclaw/prompt.txt" || base64 < "$HOME/.zeroclaw/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "$HOME/.zeroclaw/workspace/SOUL.md" || base64 < "$HOME/.zeroclaw/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "$HOME/.zeroclaw/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "$HOME/.zeroclaw/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "$HOME/.zeroclaw/workspace/MEMORY.md" || base64 < "$HOME/.zeroclaw/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===ENV_B64==="
base64 < "$HOME/.zeroclaw/.env" 2>/dev/null || true
echo "===ENVKEYS==="
[ -f "$HOME/.zeroclaw/.env" ] && grep -oE '^[A-Z_][A-Z0-9_]*' "$HOME/.zeroclaw/.env" 2>/dev/null | sort -u | head -50
`;
      const r = await execCommand(sshConfig, D, { pool: false, timeoutMs: 60000 });
      const out = r.stdout || '';
      const section = (name, next) => {
        const marker = `===${name}===`;
        const start = out.indexOf(marker);
        if (start < 0) return '';
        const contentStart = start + marker.length;
        if (!next) return out.slice(contentStart).trim();
        const nextMarker = `===${next}===`;
        const nextIdx = out.indexOf(nextMarker, contentStart);
        return (nextIdx >= 0 ? out.slice(contentStart, nextIdx) : out.slice(contentStart)).trim();
      };
      let configJson = '';
      try { configJson = Buffer.from(section('TOML_B64', 'RUNNING'), 'base64').toString('utf8'); } catch { /* none */ }
      let envText = '';
      try { envText = Buffer.from(section('ENV_B64', 'ENVKEYS'), 'base64').toString('utf8'); } catch { /* none */ }
      const binR = section('BINPATH', 'SKILLS');
      const running = /USVC=1|SSVC=1|PROC=1/.test(section('RUNNING', 'VERSION'));
      const skillsList = section('SKILLS', 'PROMPT_B64').split('\n').map(s => s.trim()).filter(Boolean);
      let systemPrompt = '';
      try { systemPrompt = Buffer.from(section('PROMPT_B64', 'SOUL_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let soulPrompt = '';
      try { soulPrompt = Buffer.from(section('SOUL_B64', 'USER_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let userPrompt = '';
      try { userPrompt = Buffer.from(section('USER_B64', 'AGENTS_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let agentsPrompt = '';
      try { agentsPrompt = Buffer.from(section('AGENTS_B64', 'MEMORY_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let memoryPrompt = '';
      try { memoryPrompt = Buffer.from(section('MEMORY_B64', 'ENV_B64'), 'base64').toString('utf8'); } catch { /* none */ }

      return NextResponse.json({
        success: true,
        installed: !!binR || !!configJson,
        version: section('VERSION', 'MODEL') || null,
        model: section('MODEL', 'BINPATH') || null,
        running,
        binPath: binR || null,
        service: /SSVC=1/.test(out) ? 'system' : /USVC=1/.test(out) ? 'user' : /PROC=1/.test(out) ? 'process' : null,
        hasSystemd: true,
        configJson: configJson || '',
        envText: envText || '',
        envKeys: section('ENVKEYS').split('\n').map(s => s.trim()).filter(Boolean),
        skills: [...new Set(skillsList)],
        systemPrompt,
        promptFiles: {
          'PROMPT.md': systemPrompt,
          'SOUL.md': soulPrompt,
          'USER.md': userPrompt,
          'AGENTS.md': agentsPrompt,
          'MEMORY.md': memoryPrompt,
        },
      });
    }

    if (action === 'save-prompt') {
      const promptText = String(config.prompt || '');
      const fileName = config.file || 'PROMPT.md';
      const b64 = Buffer.from(promptText, 'utf8').toString('base64');
      let SCRIPT = `mkdir -p "$HOME/.zeroclaw/workspace"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/SOUL.md"\necho "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.zeroclaw/workspace/PROMPT.md"\necho "${b64}" | base64 -d > "$HOME/.zeroclaw/prompt.txt"\necho "${b64}" | base64 -d > "$HOME/.zeroclaw/SYSTEM_PROMPT.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── UNINSTALL ──
    if (action === 'uninstall') {
      await run('stop & unregister service', `${ENVX}; p="$(command -v zeroclaw 2>/dev/null)"; [ -n "$p" ] && $p service uninstall 2>/dev/null; systemctl --user disable --now zeroclaw 2>/dev/null; true`);
      await run('stop stray processes', `timeout 15 pkill -f '[z]eroclaw dae[m]on' 2>/dev/null; true`);
      const rmCmd = purge
        ? `rm -f "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" /usr/local/bin/zeroclaw; rm -rf "$HOME/.zeroclaw"; echo REMOVED_ALL`
        : `rm -f "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" /usr/local/bin/zeroclaw; rm -rf ${LOGD}; echo REMOVED_CODE`;
      const r = await run(purge ? 'remove binary & all data' : 'remove binary (config kept)', rmCmd);
      const ok = /REMOVED/.test(r.stdout || '');
      return NextResponse.json({ success: ok, purged: purge, log });
    }

    // ── INSTALL ──
    if (action === 'install') {
      const probeR = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      const p = (k) => (probeR.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const hasSudo = p('SUDO') === '1';

      // 1. Prerequisites — curl + tar (the installer may extract archives).
      if (p('CURL') !== '1' || p('TAR') !== '1' || p('GZIP') !== '1' || p('PROCP') !== '1') {
        const pkgs = ['curl', 'tar', 'gzip'].filter(x => (x === 'curl' ? p('CURL') !== '1' : x === 'gzip' ? p('GZIP') !== '1' : p('TAR') !== '1')).join(' ') || 'curl';
        const inner = [
          'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"',
          'export DEBIAN_FRONTEND=noninteractive',
          `S="${hasSudo ? 'sudo -n' : ''}"`,
          `(command -v apt-get >/dev/null 2>&1 && { $S apt-get update -qq 2>/dev/null || $S apt-get update -qq 2>/dev/null; }; $S apt-get install -y ${pkgs}) < /dev/null ||`,
          `(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing ${pkgs}) < /dev/null ||`,
          `(command -v yum    >/dev/null 2>&1 && $S yum install -y ${pkgs}) < /dev/null ||`,
          `(command -v zypper >/dev/null 2>&1 && $S zypper --gpg-auto-import-keys --non-interactive install ${pkgs}) < /dev/null ||`,
          `(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed ${pkgs}) < /dev/null ||`,
          `(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache ${pkgs}) < /dev/null ||`,
          '(command -v pgrep >/dev/null 2>&1) ||',
          '(command -v apt-get >/dev/null 2>&1 && $S apt-get install -y procps) < /dev/null ||',
          '(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing procps-ng) < /dev/null ||',
          '(command -v yum    >/dev/null 2>&1 && $S yum install -y procps-ng) < /dev/null ||',
          '(command -v zypper >/dev/null 2>&1 && $S zypper --gpg-auto-import-keys --non-interactive install procps) < /dev/null ||',
          '(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed procps-ng) < /dev/null ||',
          '(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache procps) < /dev/null ||',
          'true',
          'echo PREREQ_SKIPPED',
        ].join('\n');
        await run(`install prerequisites (${pkgs})`, `echo '${b64(inner)}' | base64 -d | sh 2>&1 | tail -5`, { timeoutMs: 300000 });
      }

      // 2. Official installer — runs DETACHED on the host (setsid+nohup into a
      //    temp log). No SSH channel is held open during the potentially very
      //    long build (source fallback can bootstrap Rust); we tail the log and
      //    stream every line into the job log as it appears.
      let streamed = 0;
      const instR = await execDetached(sshConfig,
        `curl -fsSL ${INSTALLER_URL} | sh 2>&1`,
        {
          pollMs: 3000,
          timeoutMs: 1200000, // up to 20 min — source fallback may compile Rust
          onLine: (ln) => { if (++streamed <= 400) log.push(ln); },
        });
      log.push(`$ official installer${instR.code !== 0 ? ` — exited ${instR.code}` : ' — finished'}${streamed > 400 ? ` (${streamed} lines total)` : ''}${instR.stderr ? `\n${instR.stderr.slice(0, 300)}` : ''}`);

      const verR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 30000 });
      const zcBin = (verR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!zcBin) {
        return NextResponse.json({ success: false, error: 'Installer finished but the zeroclaw binary was not found — see log.', log });
      }
      await run('zeroclaw --version', `${ENVX}; ${JSON.stringify(zcBin)} --version 2>&1 | head -1`, { timeoutMs: 60000 });

      // 3. Daemon — register via `zeroclaw service install`, then start.
      const sysd = p('SYSTEMD') === '1';
      await run('register service', `${ENVX}; ${JSON.stringify(zcBin)} service install 2>&1 | tail -3`, { timeoutMs: 60000 });
      const gw = await gwCtl('start');
      const startMethod = gw.ok ? (p('INITD') === '1' ? 'systemd-user' : 'service/nohup') : 'manual';
      await run('start daemon', `echo GW_${gw.ok ? 'UP' : 'DEFERRED'}${gw.ok ? '' : `\n${(gw.out || '').slice(0, 300)}`}`);

      const readRunning = async () => {
        const v = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 60000 });
        const vp = (k) => (v.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
        return vp('USVC') === '1' || vp('SSVC') === '1' || vp('PROC') === '1';
      };
      await new Promise(r => setTimeout(r, 5000));
      let running = await readRunning();
      if (!running) {
        const retry = await gwCtl('start');
        await run('retry start daemon', `echo GW_${retry.ok ? 'UP' : 'DOWN'}${retry.ok ? '' : `\n${(retry.out || '').slice(0, 300)}`}`, { timeoutMs: 120000 });
        await new Promise(r => setTimeout(r, 5000));
        running = await readRunning();
      }

      return NextResponse.json({
        success: running,
        running,
        startMethod,
        version: p('VERSION'),
        error: running ? null : 'Daemon did not stay running — check journalctl --user -u zeroclaw or ~/.zeroclaw/logs/, then configure via the Config tab or the dashboard at http://<host>:42617.',
        log,
      });
    }

    // ── GATEWAY ops ──
    if (action === 'gateway') {
      const op = config.op || 'status';
      const g = await gwCtl(op);
      let active = g.active;
      if (active === undefined && g.ok !== false && op !== 'stop') {
        active = await waitActive();
      }
      return NextResponse.json({ success: g.ok !== false, op, active, output: g.out || '' });
    }

    // ── LOGS — journalctl first, then any .log file in ~/.zeroclaw/logs/ ──
    if (action === 'logs') {
      const LINES = Math.min(Number(config.lines || 300), 1000);
      const r = await execCommand(sshConfig,
        // journalctl on Docker/no-systemd outputs "-- No entries --" which is non-empty,
        // so we strip that sentinel before checking file size to force fallback to daemon.log
        `${ENVX}; journalctl --user -u zeroclaw --no-pager -n ${LINES} 2>/dev/null ` +
        `| grep -v '^-- No entries --' | grep -v '^-- Logs begin' | tail -n ${LINES} > /tmp/.zc-jl.txt; ` +
        `if [ -s /tmp/.zc-jl.txt ]; then cat /tmp/.zc-jl.txt; else ` +
        `tail -n ${LINES} "$HOME/.zeroclaw/logs/daemon.log" 2>/dev/null || ` +
        `tail -n ${LINES} "$HOME/.zeroclaw/logs/dae""mon-nohup.log" 2>/dev/null || ` +
        `tail -n ${LINES} "$HOME/.zeroclaw/logs/daem""on.stderr.log" 2>/dev/null || ` +
        `{ LOG=$(ls -1t "$HOME/.zeroclaw/logs/"*.log 2>/dev/null | head -1); [ -n "$LOG" ] && tail -n ${LINES} "$LOG"; } || ` +
        `echo "(no log file found in ~/.zeroclaw/logs/ — daemon may have exited early)"; ` +
        `fi; rm -f /tmp/.zc-jl.txt`,
        { pool: false, timeoutMs: 30000 });
      const data = (r.stdout || '').slice(-200000);
      return NextResponse.json({ success: true, data, size: data.length, file: 'journal::user/zeroclaw | ~/.zeroclaw/logs/daemon.log' });
    }

    // ── SAVE-CONFIG (raw TOML) with auto-rollback ──
    // ── RECONFIGURE — write env & settings to ~/.zeroclaw + restart gateway (no reinstall) ──
    if (action === 'reconfigure') {
      const env = (config && config.env) || {};
      const settings = (config && config.settings) || {};
      const envKeys = Object.keys(env).filter(k => env[k] != null && env[k] !== '');
      const hasSettings = Object.keys(settings).filter(k => settings[k] != null && settings[k] !== '').length > 0;
      if (envKeys.length === 0 && !hasSettings) {
        return NextResponse.json({ success: false, error: 'No settings or env keys to update' }, { status: 400 });
      }
      if (envKeys.length > 0) {
        const envB64 = b64(envKeys.map(k => `${k}=${env[k]}`).join('\n'));
        const w = await run('write ~/.zeroclaw/.env', `
          mkdir -p "$HOME/.zeroclaw"
          touch "$HOME/.zeroclaw/.env"; chmod 600 "$HOME/.zeroclaw/.env"
          echo '${envB64}' | base64 -d > /tmp/.zc-env-new
          while IFS='=' read -r k v; do
            [ -z "$k" ] && continue
            grep -q "^$k=" "$HOME/.zeroclaw/.env" && sed -i "s|^$k=.*|$k=$v|" "$HOME/.zeroclaw/.env" || echo "$k=$v" >> "$HOME/.zeroclaw/.env"
          done < /tmp/.zc-env-new
          rm -f /tmp/.zc-env-new
          echo ENV_UPDATED`, { timeoutMs: 30000 });
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: 'Failed to write ~/.zeroclaw/.env', log });
        }
      }
      if (hasSettings || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_ALLOWED_USERS) {
        const setB64 = b64(JSON.stringify(settings));
        const envB64 = b64(JSON.stringify(env));
        await run('merge ~/.zeroclaw/config.toml settings', `
          python3 -c "
import json, os, re, base64
p = os.path.expanduser('~/.zeroclaw/config.toml')
if not os.path.exists(p):
    open(p, 'w').close()
s = json.loads(base64.b64decode('${setB64}').decode('utf8'))
e = json.loads(base64.b64decode('${envB64}').decode('utf8'))
text = open(p).read()

# Update model
m = s.get('model')
if m:
    if re.search(r'^(model|default_model)\s*=', text, re.M):
        text = re.sub(r'^(model|default_model)\s*=.*$', f'model = \"{m}\"', text, flags=re.M)
    else:
        text = f'model = \"{m}\"\n' + text

# Update telegram configuration if passed in settings or env
tg_token = e.get('TELEGRAM_BOT_TOKEN') or s.get('telegram.bot_token') or s.get('telegram_token')
tg_allowed = e.get('TELEGRAM_ALLOWED_USERS') or s.get('telegram.allowed_users') or s.get('telegram_allowed_users')

if tg_token or tg_allowed:
    if '[telegram]' not in text:
        text += '\n[telegram]\nenabled = true\n'
    if tg_token:
        if re.search(r'^\s*(bot_token|token)\s*=', text, re.M):
            text = re.sub(r'^\s*(bot_token|token)\s*=.*$', f'bot_token = \"{tg_token}\"', text, flags=re.M)
        else:
            text = text.replace('[telegram]', f'[telegram]\nbot_token = \"{tg_token}\"')
    if tg_allowed:
        ids = [x.strip() for x in str(tg_allowed).split(',') if x.strip()]
        ids_toml = json.dumps(ids)
        if re.search(r'^\s*(allowed_users|allowed_user_ids|allowed_ids)\s*=', text, re.M):
            text = re.sub(r'^\s*(allowed_users|allowed_user_ids|allowed_ids)\s*=.*$', f'allowed_users = {ids_toml}', text, flags=re.M)
        else:
            text = text.replace('[telegram]', f'[telegram]\nallowed_users = {ids_toml}')

open(p, 'w').write(text)
print('ZEROCLAW_CONFIG_MERGED')
" 2>/dev/null || true`);
      }
      // restart gateway
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'process' : null, error: g.ok ? null : (g.out || 'gateway did not start after reconfigure'), log });
    }

    if (action === 'save-config') {
      const tomlText = String(config.configJson ?? config.configToml ?? config.configYaml ?? '');
      if (!tomlText.trim()) return NextResponse.json({ success: false, error: 'Empty config' }, { status: 400 });
      const stamp = Date.now();
      await run('backup current config', `mkdir -p "$HOME/.zeroclaw"; [ -f "$HOME/.zeroclaw/config.toml" ] && cp "$HOME/.zeroclaw/config.toml" "$HOME/.zeroclaw/config.toml.bak-${stamp}"; ls -1t "$HOME/.zeroclaw"/config.toml.bak-* 2>/dev/null | head -3`);
      const wr = await run('write config.toml', `echo '${b64(tomlText)}' > /tmp/.zc-cfg.b64 && base64 -d /tmp/.zc-cfg.b64 > "$HOME/.zeroclaw/config.toml" && rm -f /tmp/.zc-cfg.b64 && echo CONFIG_SAVED`);
      if (!/CONFIG_SAVED/.test(wr.stdout || '')) {
        return NextResponse.json({ success: false, error: 'Failed to write config.toml', log });
      }
      let restarted = false;
      let rolledBack = false;
      if (config.restart) {
        const g = await gwCtl('restart');
        restarted = g.ok;
        const up = g.ok ? await waitActive(24) : false;
        if (!up) {
          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "$HOME/.zeroclaw"/config.toml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "$HOME/.zeroclaw/config.toml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
            { pool: false, timeoutMs: 30000 });
          if (/ROLLED_BACK/.test(rbk.stdout || '')) {
            rolledBack = true;
            await gwCtl('restart');
            const up2 = await waitActive(24);
            return NextResponse.json({
              success: up2, restarted: up2, rolledBack: true,
              error: up2 ? null : 'Rolled back previous config but daemon still down — check logs',
              log: [`Your saved config broke the daemon — automatically restored ${((rbk.stdout || '').match(/ROLLED_BACK_TO=(.*)/) || [])[1] || 'last backup'}`],
            });
          }
        }
      }
      return NextResponse.json({ success: true, restarted, rolledBack });
    }

    // ── BACKUPS ──
    if (action === 'backups') {
      const r = await run('list config backups', `ls -1t "$HOME/.zeroclaw"/config.toml.bak-* 2>/dev/null || true`);
      const backups = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const bak = String(config.backup || '');
      if (!/^[\w./~-]+$/.test(bak) || !bak.includes('config.toml.bak-')) {
        return NextResponse.json({ success: false, error: 'Invalid backup path' }, { status: 400 });
      }
      await run('restore backup', `cp "${bak}" "$HOME/.zeroclaw/config.toml" && echo RESTORED`);
      if (config.restart) {
        await gwCtl('restart');
        await waitActive(24);
      }
      return NextResponse.json({ success: true });
    }

    // ── HEALTH ──
    if (action === 'health') {
      const script = `
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PROC=0; pgrep -f '[z]eroclaw dae[m]on' >/dev/null 2>&1 && PROC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 42617) && PORT=1
ALIVE=0; [ $USVC = 1 -o $SSVC = 1 -o $PROC = 1 ] && ALIVE=1
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(pgrep -f '[z]eroclaw dae[m]on' | head -1)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "$HOME/.zeroclaw/logs/daemon.log" "$HOME/.zeroclaw/logs/dae""mon-nohup.log" "$HOME/.zeroclaw/logs/gateway.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
if [ -n "$LOGL" ]; then
  if tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected)'; then
    TG=error
  fi
fi
echo "TG=$TG"
`;
      const r = await execCommand(sshConfig, script, { pool: false, timeoutMs: 45000 });
      const out = r.stdout || '';
      const gv = (k) => (out.match(new RegExp(`${k}=([^\\n]*)`)) || [])[1]?.trim();
      return NextResponse.json({
        success: true,
        alive: gv('ALIVE') === '1',
        portListening: gv('PORT') === '1',
        uptimeSec: Number(gv('UPTIME_SEC') || 0),
        telegram: gv('TG') || 'unknown',
        errorCount: 0,
        recentErrors: [],
      });
    }

    // ── SKILLS / SOPS ──
    if (action === 'skills') {
      const op = config.op;
      const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"`;

      if (op === 'remove') {
        const name = String(config.name || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill name' }, { status: 400 });
        }
        await execCommand(sshConfig, `${ENVX}; rm -rf "$HOME/.zeroclaw/skills/${name}" "$HOME/.zeroclaw/sop/${name}.md" "$HOME/.zeroclaw/sop/${name}" 2>/dev/null; true`, { pool: false, timeoutMs: 30000 });
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, log: [`Removed ${name}`] });
      }

      if (op === 'install') {
        const id = String(config.id || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(id)) {
          return NextResponse.json({ success: false, error: 'Invalid skill id' }, { status: 400 });
        }
        const skillName = id.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '_');
        await execCommand(sshConfig, `${ENVX}; mkdir -p "$HOME/.zeroclaw/skills/${skillName}" "$HOME/.zeroclaw/sop"; echo "# SOP: ${id}\n\nExecute ${skillName} standard operating procedure." > "$HOME/.zeroclaw/sop/${skillName}.md"`, { pool: false, timeoutMs: 30000 });
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: `Installed skill & SOP ${skillName}` });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }


    // ── PAIRING / USER ACCESS APPROVAL ──
    // ZeroClaw has NO `pairing` CLI subcommand. Access is granted by adding the
    // Telegram user ID (the "code" shown by the bot) to:
    //   [channels_config.telegram] allowed_users = ["123456"]  in config.toml
    // The code field here is the Telegram numeric user ID to authorize.
    if (action === 'pairing-approve') {
      const code = String(config.code || '').trim();
      if (!code) return NextResponse.json({ success: false, error: 'User ID / pairing code is required' }, { status: 400 });
      // Append this user ID to allowed_users in config.toml via python3
      const r = await execCommand(sshConfig, `
python3 -c "
import os, re, json

p = os.path.expanduser('~/.zeroclaw/config.toml')
if not os.path.exists(p):
    open(p, 'w').close()
text = open(p).read()
uid = '${code.replace(/'/g, "")}'

# Try to find and update [channels_config.telegram] allowed_users
# Pattern 1: already has allowed_users line under [channels_config.telegram]
def add_to_list(text, uid):
    # Insert into existing allowed_users = [...] line if present
    m = re.search(r'(allowed_users\\s*=\\s*\\[)([^\\]]*)(\\])', text)
    if m:
        existing = [x.strip().strip('\"\\' ') for x in m.group(2).split(',') if x.strip().strip('\"\\' ')]
        if uid not in existing:
            existing.append(uid)
        new_val = ', '.join(f'\"{x}\"' for x in existing)
        return text[:m.start()] + f'allowed_users = [{new_val}]' + text[m.end():]
    return None

updated = add_to_list(text, uid)
if updated:
    open(p, 'w').write(updated)
    print('ADDED_TO_ALLOWED_USERS')
else:
    # No existing allowed_users — inject under [channels_config.telegram] section
    if '[channels_config.telegram]' in text:
        text = text.replace('[channels_config.telegram]', f'[channels_config.telegram]\\nallowed_users = [\"{uid}\"]')
    elif '[telegram]' in text:
        text = text.replace('[telegram]', f'[telegram]\\nallowed_users = [\"{uid}\"]')
    else:
        text += f'\\n[channels_config.telegram]\\nenabled = true\\nallowed_users = [\"{uid}\"]\\n'
    open(p, 'w').write(text)
    print('ADDED_TO_ALLOWED_USERS')
" 2>&1`, { pool: false, timeoutMs: 30000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const ok = /ADDED_TO_ALLOWED_USERS/.test(out);
      if (!ok) return NextResponse.json({ success: false, error: `Failed to add user to allowed_users: ${out}`, log });
      // Restart so zeroclaw reloads the config
      const g = await gwCtl('restart');
      return NextResponse.json({
        success: true,
        output: `User ID "${code}" added to allowed_users in config.toml. Gateway restarted: ${g.ok}`,
        restarted: g.ok,
        log,
      });
    }

    if (action === 'pairing-list') {
      // ZeroClaw shows unauthorized user IDs in logs when they try to message the bot.
      // Scan daemon logs for "unauthorized user" or "unknown user" entries.
      const r = await execCommand(sshConfig,
        `FILE="$(ls -1t "$HOME/.zeroclaw/logs/"*.log 2>/dev/null | head -1)"; [ -n "$FILE" ] && tail -n 200 "$FILE" || true`,
        { pool: false, timeoutMs: 20000 });
      const out = r.stdout || '';
      // Match patterns like: "unauthorized user: 123456789", "user 123456789 not allowed",
      // "unknown user id: 123456789", "access denied for 123456789"
      const matches = [
        ...out.matchAll(/(?:unauthorized|unknown|denied|not allowed)[^\d]*(\d{5,12})/gi),
        ...out.matchAll(/user[_\s]?id[:\s]+(\d{5,12})/gi),
        ...out.matchAll(/from user[:\s]+(\d{5,12})/gi),
      ];
      const pending = [];
      for (const m of matches) {
        const code = m[1];
        if (code && !pending.some(p => p.code === code)) {
          pending.push({ code, platform: 'telegram' });
        }
      }
      return NextResponse.json({ success: true, pending, raw: out.slice(-1000) });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    logger.error('[agents/zeroclaw] action failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' });
  }
}

