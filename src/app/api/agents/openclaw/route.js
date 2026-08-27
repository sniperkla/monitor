import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';

/**
 * OpenClaw (openclaw.ai) one-click installer — deploys the OpenClaw gateway
 * (https://docs.openclaw.ai) onto a selected SSH server via the official
 * install.sh (auto-provisions Node.js if missing), then seeds
 * ~/.openclaw/openclaw.json and installs the gateway daemon.
 *
 * POST body: { connectionId, action, config?, purge?, live? }
 *   action : 'status' | 'details' | 'install' | 'uninstall' | 'gateway'
 *            | 'logs' | 'health' | 'save-config' | 'backups' | 'restore-backup'
 *            | 'job' (live-log polling)
 *   config : { model?, provider?, env?, configJson?, restart?, op? }
 *   purge  : uninstall also deletes ~/.openclaw (workspace/sessions/config)
 *   live   : install/uninstall run as background job → poll with action 'job'
 */

const INSTALLER_URL = 'https://openclaw.ai/install.sh';
// Self-match rule: every pgrep/pkill -f pattern fragment must be bracketed or
// split anywhere else it appears literally in the same remote command line
// (unit names, log filenames, binary paths).
const UNIT = 'openclaw-gatew""ay';
const LOGL = '"$HOME/.openclaw/logs/gatew""ay.log"';

function maskSecretString(val) {
  if (!val || typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '••••••••';
  return trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
}

function maskConfigJson(jsonStr) {
  if (!jsonStr) return jsonStr;
  try {
    const obj = JSON.parse(jsonStr);
    const maskObj = (o) => {
      if (!o || typeof o !== 'object') return o;
      if (Array.isArray(o)) return o.map(maskObj);
      const res = {};
      for (const [k, v] of Object.entries(o)) {
        if (/^(apiKey|api_key|token|botToken|password|secret|accessToken|access_token|clientSecret)$/i.test(k) && typeof v === 'string') {
          res[k] = maskSecretString(v);
        } else if (typeof v === 'object' && v !== null) {
          res[k] = maskObj(v);
        } else {
          res[k] = v;
        }
      }
      return res;
    };
    return JSON.stringify(maskObj(obj), null, 2);
  } catch {
    return jsonStr;
  }
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
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v openclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.openclaw/openclaw.json" ] && CFG=1
echo "CONFIG=$CFG"
NODE=NONE; command -v node >/dev/null 2>&1 && NODE=$(node --version 2>/dev/null | cut -c1-20)
echo "NODE=$NODE"
PROC=0; pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null 2>&1 && PROC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active ${UNIT} 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active ${UNIT} 2>/dev/null | grep -qx active && SSVC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 18789 || command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q 18789) && PORT=1
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
    const { connectionId, action, config = {}, purge = false } = body;
    if ((!connectionId || !action) && action !== 'job') return NextResponse.json({ success: false, error: 'Missing connectionId or action' }, { status: 400 });
    if (action === 'job') return dispatchWithLiveLogs(body, () => ({}));
    return dispatchWithLiveLogs(body, (b, log) => handleAgentAction(b, session, log));
  } catch (e) {
    logger.error('[agents/openclaw] POST failed:', e?.message);
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
    const binPath = () => `p="$(export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; command -v openclaw 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`;

    // ── Gateway control — systemd user unit when available, else nohup ──────
    const gwCtl = async (op) => {
      const binR = await execCommand(sshConfig, `${binPath()} ; echo "SYSTEMD=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`, { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'openclaw binary not found' };
      const sysd = /SYSTEMD=1/.test(binR.stdout || '');
      const BP = JSON.stringify(bp);
      const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"`;
      if (op === 'status') {
        const r = await execCommand(sshConfig, `${ENVX}; ${sysd ? `systemctl --user is-active ${UNIT} 2>/dev/null | grep -qx active && echo SVC_ACTIVE || ` : ''}{ timeout 15 pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null && echo PROC_ACTIVE || echo NO_PROC; }`, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /SVC_ACTIVE|PROC_ACTIVE/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        return execCommand(sshConfig,
          `${ENVX}; ${sysd ? `timeout 25 systemctl --user stop ${UNIT} 2>/dev/null;` : ''} timeout 15 pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; sleep 1; pkill -9 -f '[o]penclaw.*gatew[a]y' 2>/dev/null || true; echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      // start / restart
      if (op === 'restart') await gwCtl('stop');
      const startCmd = sysd
        ? `${ENVX}; timeout 40 systemctl --user start ${UNIT} 2>/dev/null || { mkdir -p "$HOME/.openclaw/logs"; setsid nohup ${BP} gateway >> ${LOGL} 2>&1 < /dev/null & sleep 3; }; timeout 15 pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`
        : `${ENVX}; mkdir -p "$HOME/.openclaw/logs"; setsid nohup ${BP} gateway >> ${LOGL} 2>&1 < /dev/null & sleep 3; timeout 15 pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 120000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
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
        prereqs: { curl: parse('CURL') === '1', tar: parse('TAR') === '1', node: parse('NODE'), systemd: parse('SYSTEMD') === '1', passwordlessSudo: parse('SUDO') === '1' },
      });
    }
    // ── DETAILS ──
    if (action === 'details') {
      const D = `
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
BIN="$(command -v openclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "$HOME/.openclaw/openclaw.json" 2>/dev/null || true
echo "===RUNNING==="
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active ${UNIT} 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active ${UNIT} 2>/dev/null | grep -qx active && SSVC=1
PROC=0; pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null 2>&1 && PROC=1
echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PROC=$PROC"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
[ -f "$HOME/.openclaw/openclaw.json" ] && grep -oE '"(defaultModel|model)"[[:space:]]*:[[:space:]]*"[^"]+"' "$HOME/.openclaw/openclaw.json" 2>/dev/null | head -1 | cut -d'"' -f4
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "$HOME/.openclaw/skills" ] && ls -1 "$HOME/.openclaw/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "$HOME/.openclaw/workspace/skills" ] && ls -1 "$HOME/.openclaw/workspace/skills" 2>/dev/null | grep -v '^\.' || true
echo "===PROMPT_B64==="
{ base64 < "$HOME/.openclaw/workspace/PROMPT.md" || base64 < "$HOME/.openclaw/prompt.txt" || base64 < "$HOME/.openclaw/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "$HOME/.openclaw/workspace/SOUL.md" || base64 < "$HOME/.openclaw/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "$HOME/.openclaw/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "$HOME/.openclaw/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "$HOME/.openclaw/workspace/MEMORY.md" || base64 < "$HOME/.openclaw/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===ENV_B64==="
base64 < "$HOME/.openclaw/.env" 2>/dev/null || true
echo "===ENVKEYS==="
[ -f "$HOME/.openclaw/.env" ] && grep -oE '^[A-Z_][A-Z0-9_]*' "$HOME/.openclaw/.env" 2>/dev/null | sort -u | head -50
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
      try { configJson = Buffer.from(section('CONFIG_B64', 'RUNNING'), 'base64').toString('utf8'); } catch { /* none */ }
      let envText = '';
      try { envText = Buffer.from(section('ENV_B64', 'ENVKEYS'), 'base64').toString('utf8'); } catch { /* none */ }
      const binR = section('BINPATH', 'SKILLS');
      const running = /USVC=1|SSVC=1|PROC=1/.test(section('RUNNING', 'VERSION'));
      const envKeys = section('ENVKEYS').split('\n').map(s => s.trim()).filter(Boolean);
      const skillsList = new Set(section('SKILLS', 'PROMPT_B64').split('\n').map(s => s.trim()).filter(Boolean));
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

      try {
        const c = JSON.parse(configJson || '{}');
        for (const k of Object.keys(c.mcpServers || {})) skillsList.add(k);
        for (const k of Object.keys(c.tools || {})) skillsList.add(k);
        if (!systemPrompt && (c.systemPrompt || c.instructions)) {
          systemPrompt = c.systemPrompt || c.instructions;
        }
      } catch {}
      return NextResponse.json({
        success: true,
        installed: !!binR || !!configJson,
        version: section('VERSION', 'MODEL') || null,
        model: section('MODEL', 'BINPATH') || null,
        running,
        binPath: binR || null,
        service: /SSVC=1/.test(out) ? 'system' : /USVC=1/.test(out) ? 'user' : /PROC=1/.test(out) ? 'process' : null,
        hasSystemd: true,
        configJson: maskConfigJson(configJson),
        envText: maskEnvText(envText),
        envKeys,
        skills: [...skillsList],
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
      let SCRIPT = `mkdir -p "$HOME/.openclaw/workspace"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.openclaw/workspace/SOUL.md"\necho "${b64}" | base64 -d > "$HOME/.openclaw/workspace/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.openclaw/workspace/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.openclaw/workspace/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.openclaw/workspace/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.openclaw/workspace/PROMPT.md"\necho "${b64}" | base64 -d > "$HOME/.openclaw/prompt.txt"\necho "${b64}" | base64 -d > "$HOME/.openclaw/SYSTEM_PROMPT.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── UNINSTALL ──
    if (action === 'uninstall') {
      await run('stop system service', `(sudo -n systemctl disable --now ${UNIT} 2>/dev/null || systemctl disable --now ${UNIT} 2>/dev/null); true`);
      await run('stop user service', `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now ${UNIT} 2>/dev/null; true`);
      await run('stop stray processes', `pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; pkill -f '[o]penclaw gateway' 2>/dev/null; true`);
      const rmCmd = purge
        ? `(npm -g rm openclaw 2>/dev/null || true); rm -f "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" /usr/local/bin/openclaw /usr/bin/openclaw /usr/sbin/openclaw; rm -rf "$HOME/.openclaw"; echo REMOVED_ALL`
        : `(npm -g rm openclaw 2>/dev/null || true); rm -f "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" /usr/local/bin/openclaw /usr/bin/openclaw /usr/sbin/openclaw; rm -rf "$HOME/.openclaw/local" "$HOME/.openclaw/logs"; echo REMOVED_CODE`;
      const r = await run(purge ? 'remove binary, code & all data' : 'remove binary & code (config kept)', rmCmd);
      const ok = /REMOVED/.test(r.stdout || '');
      return NextResponse.json({ success: ok, purged: purge, log });
    }
    // ── INSTALL ──
    if (action === 'install') {
      const probeR = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      const p = (k) => (probeR.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const hasSudo = p('SUDO') === '1';

      // 1. Prerequisites — curl + tar (the installer provisions Node itself).
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

      // 2. Official installer — provisions Node + OpenClaw, skips onboarding.
      //    Runs DETACHED on the host (setsid+nohup into a temp log) so no SSH
      //    channel is held open for the whole build; we tail that log and
      //    stream every line into the job log as it appears. If the SSH
      //    connection drops midway, the remote job keeps running.
      {
        let streamed = 0;
        const instR = await execDetached(sshConfig,
          `curl -fsSL ${INSTALLER_URL} | bash -s -- --no-onboard 2>&1`,
          {
            pollMs: 3000,
            timeoutMs: 900000, // up to 15 min — may download Node
            onLine: (ln) => { if (++streamed <= 400) log.push(ln); },
          });
        log.push(`$ official installer (--no-onboard)${instR.code !== 0 ? ` — exited ${instR.code}` : ' — finished'}${streamed > 400 ? ` (${streamed} lines total)` : ''}${instR.stderr ? `\n${instR.stderr.slice(0, 300)}` : ''}`);
      }

      const verR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 30000 });
      const ocBin = (verR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!ocBin) {
        return NextResponse.json({ success: false, error: 'Installer finished but the openclaw binary was not found — see log.', log });
      }
      await run('openclaw --version', `export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; openclaw --version 2>&1 | tail -1`, { timeoutMs: 60000 });
      // 3. Seed config — schema-safe:
      //    • gateway defaults (mode/bind) MERGED into ~/.openclaw/openclaw.json
      //    • provider API keys written to ~/.openclaw/.env (documented env source)
      //    NOTE: openclaw.json is strictly validated — unknown root keys like
      //    `model` or `env: { KEY }` make the gateway refuse to start.
      {
        const json = JSON.stringify({ gateway: { mode: 'local', bind: 'loopback' } });
        await run('merge gateway defaults into openclaw.json', `
          mkdir -p "$HOME/.openclaw"
          [ -f "$HOME/.openclaw/openclaw.json" ] || echo '{}' > "$HOME/.openclaw/openclaw.json"
          cp "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.bak-install"
          echo '${b64(json)}' | base64 -d > /tmp/oc-seed.json
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          node -e "const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const cur=JSON.parse(fs.readFileSync(p,'utf8'));const seed=JSON.parse(fs.readFileSync('/tmp/oc-seed.json','utf8'));const merged={...seed,...cur};merged.gateway={...seed.gateway,...(cur.gateway||{})};fs.writeFileSync(p,JSON.stringify(merged,null,2));console.log('CONFIG_SEED')"
          rm -f /tmp/oc-seed.json`,
          { timeoutMs: 30000 });
        const envEntries = Object.entries(config.env || {});
        if (envEntries.length > 0) {
          const envFile = envEntries.map(([k, v]) => `${k}=${v}`).join('\n');
          await run('write provider keys to ~/.openclaw/.env', `
            touch "$HOME/.openclaw/.env"
            echo '${b64(envFile)}' | base64 -d > /tmp/oc-env-seed
            while IFS='=' read -rk; do
              k="\${k%%=*}"
              grep -q "^$\{k\}=" "$HOME/.openclaw/.env" && sed -i "s|^$\{k\}=.*|$k=$(grep "^$\{k\}=" /tmp/oc-env-seed | cut -d= -f2-)|" "$HOME/.openclaw/.env" || printf '%s\\n' "$(grep "^$\{k\}=" /tmp/oc-env-seed)" >> "$HOME/.openclaw/.env"
            done < /tmp/oc-env-seed
            rm -f /tmp/oc-env-seed
            echo ENV_SEEDED`, { timeoutMs: 30000 });
        }
      }

      // 4. Gateway daemon — systemd user unit when available, else nohup.
      const gw = await gwCtl('start');
      const startMethod = gw.ok ? (p('INITD') === '1' ? 'systemd-user' : 'nohup') : 'manual';
      await run('start gateway', `echo GW_${gw.ok ? 'UP' : 'DEFERRED'}${gw.ok ? '' : `\n${(gw.out || '').slice(0, 300)}`}`);

      const readRunning = async () => {
        const v = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 60000 });
        const vp = (k) => (v.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
        return vp('USVC') === '1' || vp('SSVC') === '1' || vp('PROC') === '1';
      };
      // The gateway can take several seconds to bind; a single probe right
      // after start races it. Wait, and retry the start once if needed.
      await new Promise(r => setTimeout(r, 5000));
      let running = await readRunning();
      if (!running) {
        const retry = await gwCtl('start');
        await run('retry start gateway', `echo GW_${retry.ok ? 'UP' : 'DOWN'}${retry.ok ? '' : `\n${(retry.out || '').slice(0, 300)}`}`, { timeoutMs: 120000 });
        await new Promise(r => setTimeout(r, 5000));
        running = await readRunning();
      }

      return NextResponse.json({
        success: running,
        running,
        startMethod,
        version: p('VERSION'),
        error: running ? null : 'Gateway did not stay running — check ~/.openclaw/logs/ (usually a missing provider API key; set it via the Config tab or run `openclaw onboard` on the server).',
        log,
      });
    }

    // ── GATEWAY ops ──
    // The gateway can bounce once right after start (port-release race — see
    // gateway.log double "starting…"), so verify by POLLING, not a single probe.
    const waitActive = async (totalS = 24) => {
      let ok = (await gwCtl('status')).active;
      for (let waited = 0; !ok && waited < totalS; waited += 6) {
        await new Promise(r => setTimeout(r, 6000));
        ok = (await gwCtl('status')).active;
      }
      return ok;
    };
    if (action === 'gateway') {
      const op = config.op || 'status';
      const g = await gwCtl(op);
      // start/restart results don't carry `active` — verify with a status probe
      let active = g.active;
      if (active === undefined && g.ok !== false && op !== 'stop') {
        active = await waitActive();
      }
      return NextResponse.json({ success: g.ok !== false, op, active, output: g.out || '' });
    }
    // ── LOGS — incremental tail ──
    if (action === 'logs') {
      const cursor = Number(config.cursor || 0);
      const LINES = Math.min(Number(config.lines || 300), 1000);
      const script = `
ACTIVE=""
for f in "$HOME/.openclaw/logs/gatew""ay.log" "$HOME/.openclaw/logs/"*.log /tmp/openclaw*.log; do
  if [ -f "$f" ] && [ -s "$f" ]; then ACTIVE="$f"; break; fi
done
if [ -z "$ACTIVE" ]; then echo "SIZE=0"; echo "===DATA==="; exit 0; fi
SZ=$(wc -c < "$ACTIVE")
echo "FILE=$(basename "$ACTIVE")"
echo "SIZE=$SZ"
echo "===DATA==="
if [ ${cursor} -gt 0 ] && [ ${cursor} -le $SZ ]; then
  tail -c +$((cursor + 1)) "$ACTIVE"
else
  tail -n ${LINES} "$ACTIVE"
fi
`;
      const r = await execCommand(sshConfig, script, { pool: false, timeoutMs: 45000 });
      const out = r.stdout || '';
      const szM = out.match(/SIZE=(\d+)/)?.[1];
      const fileM = out.match(/FILE=(.*)/)?.[1]?.trim();
      const dataIdx = out.indexOf('===DATA===');
      return NextResponse.json({ success: true, size: szM ? Number(szM) : 0, file: fileM || null, data: dataIdx >= 0 ? out.slice(dataIdx + 10) : '' });
    }

    // ── HEALTH ──
    if (action === 'health') {
      const script = `
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active ${UNIT} 2>/dev/null | grep -qx active && SSVC=1
SSVC2=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active ${UNIT} 2>/dev/null | grep -qx active && SSVC2=1
PROC=0; pgrep -f '[o]penclaw.*gatew[a]y' >/dev/null 2>&1 && PROC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q 18789) && PORT=1
ALIVE=0; [ $SSVC = 1 -o $SSVC2 = 1 -o $PROC = 1 ] && ALIVE=1
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(pgrep -f '[o]penclaw.*gatew[a]y' | head -1)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "$HOME/.openclaw/logs/gatew""ay.log" "$HOME/.openclaw/logs/"*.log /tmp/openclaw*.log; do
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
    // ── CONFIG BACKUPS — list & restore ──
    if (action === 'backups') {
      const r = await execCommand(sshConfig,
        `ls -1t "$HOME/.openclaw"/openclaw.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const name = String(config.name || '');
      if (!/^openclaw\.json\.bak-[A-Za-z0-9._-]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "$HOME/.openclaw/${name}" ] && cp "$HOME/.openclaw/${name}" "$HOME/.openclaw/openclaw.json" && echo RESTORED || echo NOT_FOUND`,
        { pool: false, timeoutMs: 30000 });
      const ok = /RESTORED/.test(r.stdout || '');
      let restarted = false;
      if (ok) { const g = await gwCtl('restart'); restarted = g.ok; }
      return NextResponse.json({ success: ok && restarted, restarted, error: ok ? (restarted ? null : 'restored but gateway did not start') : 'Backup file not found' });
    }
    // ── SAVE-CONFIG — JSON editor with corrupt-guard + auto-rollback ──
    // ── RECONFIGURE — update env keys + restart gateway (no reinstall) ──
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
        const w = await run('write ~/.openclaw/.env', `
          touch "$HOME/.openclaw/.env"; chmod 600 "$HOME/.openclaw/.env"
          echo '${envB64}' | base64 -d > /tmp/.oc-env-new
          while IFS='=' read -r k v; do
            [ -z "$k" ] && continue
            grep -q "^$k=" "$HOME/.openclaw/.env" && sed -i "s|^$k=.*|$k=$v|" "$HOME/.openclaw/.env" || echo "$k=$v" >> "$HOME/.openclaw/.env"
          done < /tmp/.oc-env-new
          rm -f /tmp/.oc-env-new
          echo ENV_UPDATED`, { timeoutMs: 30000 });
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: 'Failed to write ~/.openclaw/.env', log });
        }
      }
      if (hasSettings && settings.model) {
        const setB64 = b64(JSON.stringify(settings));
        await run('merge ~/.openclaw/openclaw.json settings', `
          python3 -c "
import json, os
p = os.path.expanduser('~/.openclaw/openclaw.json')
cur = json.load(open(p)) if os.path.exists(p) else {}
import base64
s = json.loads(base64.b64decode('${setB64}').decode('utf8'))
if 'model' in s:
    cur['defaultModel'] = s['model']
    cur['model'] = s['model']
json.dump(cur, open(p, 'w'), indent=2)
print('OPENCLAW_CONFIG_MERGED')
" 2>/dev/null || true`);
      }
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'restart' : null, error: g.ok ? null : g.error, log });
    }

    if (action === 'save-config') {
      const json = String(config.configJson ?? '');
      if (!json.trim()) return NextResponse.json({ success: false, error: 'openclaw.json content is empty' }, { status: 400 });
      try { JSON.parse(json); } catch (e) {
        return NextResponse.json({ success: false, error: `Invalid JSON: ${e.message}` }, { status: 400 });
      }
      const sv = await execCommand(sshConfig, `
        cp "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(json)}' | base64 -d > "$HOME/.openclaw/openclaw.json.new"
        python3 -m json.tool "$HOME/.openclaw/openclaw.json.new" >/dev/null 2>&1 && { mv "$HOME/.openclaw/openclaw.json.new" "$HOME/.openclaw/openclaw.json"; echo CONFIG_SAVED; } || echo CONFIG_INVALID`,
        { pool: false, timeoutMs: 30000 });
      if (/CONFIG_INVALID/.test(sv.stdout || '')) {
        return NextResponse.json({ success: false, error: 'Remote JSON validation failed — config not replaced.' }, { status: 400 });
      }
      let restarted = false;
      let rolledBack = false;
      if (config.restart) {
        const g = await gwCtl('restart');
        restarted = g.ok;
        // poll — the gateway can take ~10-20s (incl. one bounce) to stay up
        const up = g.ok ? await waitActive(24) : false;
        if (!up) {
          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "$HOME/.openclaw"/openclaw.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "$HOME/.openclaw/openclaw.json" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
            { pool: false, timeoutMs: 30000 });
          if (/ROLLED_BACK/.test(rbk.stdout || '')) {
            rolledBack = true;
            await gwCtl('restart');
            const up2 = await waitActive(24);
            return NextResponse.json({
              success: up2, restarted: up2, rolledBack: true,
              error: up2 ? null : 'Rolled back previous config but gateway still down — check ~/.openclaw/logs/',
              log: [`Your saved config broke the gateway — automatically restored ${((rbk.stdout || '').match(/ROLLED_BACK_TO=(.*)/) || [])[1] || 'last backup'}`],
            });
          }
        }
      }
      return NextResponse.json({ success: true, restarted, rolledBack });
    }

    // ── SKILLS / MCP SERVERS ──
    if (action === 'skills') {
      const op = config.op;
      const ENVX = `export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"`;
      const MCP_PRESETS = {
        'filesystem': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/root'] },
        'github': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        'fetch': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
        'brave-search': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'] },
        'puppeteer': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
        'postgres': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'] },
        'memory': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
      };

      if (op === 'remove') {
        const name = String(config.name || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill/MCP name' }, { status: 400 });
        }
        await run('remove MCP/skill', `
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          python3 -c "
import json, os
p = os.path.expanduser('~/.openclaw/openclaw.json')
if os.path.exists(p):
    cur = json.load(open(p))
    cur.setdefault('mcpServers', {}).pop('${name}', None)
    cur.setdefault('tools', {}).pop('${name}', None)
    json.dump(cur, open(p, 'w'), indent=2)
" 2>/dev/null || true
          rm -rf "$HOME/.openclaw/skills/${name}" 2>/dev/null || true`);
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, log: [`Removed ${name}`] });
      }

      if (op === 'install') {
        const id = String(config.id || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(id)) {
          return NextResponse.json({ success: false, error: 'Invalid skill id' }, { status: 400 });
        }
        const presetKey = Object.keys(MCP_PRESETS).find(k => k.toLowerCase() === id.toLowerCase());
        const mcpConfig = presetKey ? MCP_PRESETS[presetKey] : { command: 'npx', args: ['-y', id] };
        const mcpB64 = b64(JSON.stringify(mcpConfig));
        const skillName = (presetKey || id.split('/').pop()).replace(/[^a-zA-Z0-9_-]/g, '_');
        await run('install MCP/skill', `
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          mkdir -p "$HOME/.openclaw/skills/${skillName}"
          python3 -c "
import json, os, base64
p = os.path.expanduser('~/.openclaw/openclaw.json')
cur = json.load(open(p)) if os.path.exists(p) else {}
mcp = json.loads(base64.b64decode('${mcpB64}').decode('utf8'))
cur.setdefault('mcpServers', {})['${skillName}'] = mcp
json.dump(cur, open(p, 'w'), indent=2)
print('MCP_ADDED')
" 2>/dev/null || true`);
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: `Configured MCP skill ${skillName}` });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });






  } catch (e) {
    logger.error('[openclaw-agent] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
