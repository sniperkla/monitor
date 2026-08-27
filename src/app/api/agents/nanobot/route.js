import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';

/**
 * Nanobot (HKUDS) one-click installer — deploys https://github.com/HKUDS/nanobot
 * onto a selected SSH server via its official install.sh, then writes
 * ~/.nanobot/config.json (provider, model preset, channels) and starts
 * `nanobot gateway` detached.
 *
 * POST body: { connectionId, action, config?, purge? }
 *   action : 'status' | 'details' | 'install' | 'uninstall' | 'gateway'
 *            | 'logs' | 'health' | 'save-config' | 'backups' | 'restore-backup'
 */

const INSTALLER_URL = 'https://raw.githubusercontent.com/HKUDS/nanobot/main/scripts/install.sh';
const LOGF = '"$HOME/.nanobot/logs/gatew""ay.log"';

const STATUS_SCRIPT = `
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.nanobot/config.json" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; pgrep -f '[n]anobot.*gatew[a]y' >/dev/null 2>&1 && PROC=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
GIT=$(git --version 2>/dev/null | awk '{print $3}'); [ -z "$GIT" ] && GIT=NONE
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
PY3=NONE; command -v python3 >/dev/null 2>&1 && PY3=$(python3 --version 2>&1 | awk '{print $2}')
echo "PROC=$PROC"; echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"
echo "GIT=$GIT"; echo "CURL=$CURLP"; echo "PY3=$PY3"
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
    logger.error('[agents/nanobot] POST failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' }, { status: 500 });
  }
}

async function handleAgentAction(body, session, log = []) {
  try {
    const { connectionId, action, config = {}, purge = false } = body;
    const sshConfig = await getSshConfig(connectionId);
    const run = async (label, cmd, opts = {}) => {
      const cmdStr = Array.isArray(cmd) ? cmd.join('\n') : String(cmd ?? '');
      const r = await execCommand(sshConfig, cmdStr, { pool: false, timeoutMs: 60000, ...opts });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      log.push(`$ ${label}${out ? `\n${out.slice(0, 2500)}` : ''}`);
      return r;
    };
    const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

    const binPath = () => `p="$(export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/bin:$PATH"; command -v nanobot 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`;

    const gwCtl = async (op) => {
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'nanobot binary not found' };
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;
      if (op === 'status') {
        const r = await execCommand(sshConfig, `${ENVX}; timeout 15 pgrep -f '[n]anobot.*gatew[a]y' >/dev/null && echo PROC_ACTIVE || echo NO_PROC`, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /PROC_ACTIVE/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        return execCommand(sshConfig, `${ENVX}; timeout 15 pkill -f '[n]anobot.*gatew[a]y' 2>/dev/null; sleep 1; pkill -9 -f '[n]anobot.*gatew[a]y' 2>/dev/null || true; echo GW_STOPPED`, { pool: false, timeoutMs: 60000 })
          .then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      if (op === 'restart') await gwCtl('stop');
      const startCmd = `${ENVX}; mkdir -p "$HOME/.nanobot/logs"; setsid nohup ${BP} gateway >> "$HOME/.nanobot/logs/gateway.log" 2>&1 < /dev/null & sleep 4; timeout 15 pgrep -f '[n]anobot.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 90000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
    };

    // ── STATUS ──
    if (action === 'status') {
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      const parse = (k) => (r.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      return NextResponse.json({
        success: true,
        installed: parse('BIN') === 'SET',
        version: parse('BIN') === 'SET' ? parse('VERSION') : null,
        running: parse('PROC') === '1',
        hasConfig: parse('CONFIG') === '1',
        prereqs: { git: parse('GIT'), curl: parse('CURL') === '1', python3: parse('PY3'), passwordlessSudo: parse('SUDO') === '1' },
      });
    }

    // ── DETAILS ──
    if (action === 'details') {
      const D = `
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "$HOME/.nanobot/config.json" 2>/dev/null || true
echo "===SKILLS==="
[ -d "$HOME/.nanobot/workspace/skills" ] && ls -1 "$HOME/.nanobot/workspace/skills" 2>/dev/null | grep -v '^\.' || true
echo "===PLUGINS==="
[ -n "$BIN" ] && "$BIN" plugins list 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "$HOME/.nanobot/workspace/PROMPT.md" || base64 < "$HOME/.nanobot/prompt.txt" || base64 < "$HOME/.nanobot/workspace/custom_instructions.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "$HOME/.nanobot/workspace/SOUL.md" || base64 < "$HOME/.nanobot/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "$HOME/.nanobot/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "$HOME/.nanobot/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "$HOME/.nanobot/workspace/MEMORY.md" || base64 < "$HOME/.nanobot/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
pgrep -f '[n]anobot.*gatew[a]y' >/dev/null 2>&1 && echo PROC_ACTIVE || echo NO_PROC
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===LOG==="
LOG=""
for f in "$HOME/.nanobot/logs/gatew""ay.log" "$HOME/.nanobot-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -n "$LOGLAST" ] || true
echo "===LOGFILE==="
LOG=""
for f in "$HOME/.nanobot/logs/gatew""ay.log" "$HOME/.nanobot-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -z "$LOG" ] && LOG="$HOME/.nanobot/logs/gatew""ay.log"
echo "$LOG"
tail -n 30 "$LOG" 2>/dev/null | tail -5
`;
      const r = await execCommand(sshConfig, D, { pool: false, timeoutMs: 60000 });
      const out = r.stdout || '';
      const sec = (name, next) => {
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
      try { configJson = Buffer.from(sec('CONFIG_B64', 'SKILLS'), 'base64').toString('utf8'); } catch { /* none */ }
      const binR = sec('BINPATH', 'LOG');
      let systemPrompt = '';
      try { systemPrompt = Buffer.from(sec('PROMPT_B64', 'SOUL_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let soulPrompt = '';
      try { soulPrompt = Buffer.from(sec('SOUL_B64', 'USER_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let userPrompt = '';
      try { userPrompt = Buffer.from(sec('USER_B64', 'AGENTS_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let agentsPrompt = '';
      try { agentsPrompt = Buffer.from(sec('AGENTS_B64', 'MEMORY_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let memoryPrompt = '';
      try { memoryPrompt = Buffer.from(sec('MEMORY_B64', 'RUNNING'), 'base64').toString('utf8'); } catch { /* none */ }

      // envKeys: union of providers.*, sidecar .env keys, and configured channels
      const envKeys = new Set();
      let envText = '';
      try {
        const envR = await execCommand(sshConfig, `[ -f "$HOME/.nanobot/.env" ] && cat "$HOME/.nanobot/.env" 2>/dev/null || true`, { pool: false, timeoutMs: 15000 });
        envText = envR.stdout || '';
        for (const k of envText.split('\n')) {
          const name = k.split('=')[0]?.trim();
          if (name && /^[A-Z_][A-Z0-9_]*$/.test(name)) envKeys.add(name);
        }
      } catch {}
      const skillsList = new Set(sec('SKILLS', 'PLUGINS').split('\n').map(s => s.trim()).filter(Boolean));
      const pluginsOut = sec('PLUGINS', 'PROMPT_B64');
      for (const line of pluginsOut.split('\n')) {
        const m = line.match(/│\s*([a-zA-Z0-9_-]+)\s*│\s*[^│]+\s*│\s*yes\s*│/);
        if (m && m[1]) skillsList.add(m[1].trim());
      }
      let model = null;
      try {
        const c = JSON.parse(configJson || '{}');
        for (const k of Object.keys(c.providers || {})) {
          envKeys.add(k.toUpperCase() + '_API_KEY');
          if (c.providers[k]?.apiKey && !envText.includes(`${k.toUpperCase()}_API_KEY`)) {
            envText += `\n${k.toUpperCase()}_API_KEY=${c.providers[k].apiKey}`;
          }
        }
        for (const ch of Object.keys(c.channels || {})) {
          if (c.channels[ch]?.enabled !== false) skillsList.add(ch);
        }
        for (const pl of Object.keys(c.plugins || {})) {
          if (c.plugins[pl]?.enabled !== false) skillsList.add(pl);
        }
        if (c.channels?.telegram?.token) {
          envKeys.add('TELEGRAM_BOT_TOKEN');
          if (!envText.includes('TELEGRAM_BOT_TOKEN')) {
            envText += `\nTELEGRAM_BOT_TOKEN=${c.channels.telegram.token}`;
          }
        }
        if (c.channels?.telegram?.allowFrom?.length) {
          envKeys.add('TELEGRAM_ALLOWED_USERS');
          if (!envText.includes('TELEGRAM_ALLOWED_USERS')) {
            envText += `\nTELEGRAM_ALLOWED_USERS=${c.channels.telegram.allowFrom.join(',')}`;
          }
        }
        if (!systemPrompt && c.agent?.system_prompt) {
          systemPrompt = c.agent.system_prompt;
        }
        model = c.modelPresets?.primary?.model || c.agents?.defaults?.modelPreset || c.agents?.defaults?.model || null;
      } catch {}
      envText = envText.trim();
      return NextResponse.json({
        success: true,
        installed: !!binR || !!configJson,
        version: sec('VERSION', 'BINPATH') || null,
        model,
        binPath: binR || null,
        running: /PROC_ACTIVE/.test(sec('RUNNING', 'VERSION')),
        recentLog: sec('LOG', 'LOGFILE').split('\n').slice(-5).join('\n'),
        configJson,
        envText,
        envKeys: [...envKeys],
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
      let SCRIPT = `mkdir -p "$HOME/.nanobot/workspace"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.nanobot/workspace/SOUL.md"\necho "${b64}" | base64 -d > "$HOME/.nanobot/workspace/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.nanobot/workspace/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.nanobot/workspace/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.nanobot/workspace/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.nanobot/workspace/PROMPT.md"\necho "${b64}" | base64 -d > "$HOME/.nanobot/prompt.txt"\necho "${b64}" | base64 -d > "$HOME/.nanobot/workspace/custom_instructions.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── UNINSTALL ──
    if (action === 'uninstall') {
      await run('stop gateway', `pkill -f '[n]anobot.*gatew[a]y' 2>/dev/null; pkill -f '[n]anobot webui' 2>/dev/null; true`);
      const rmCmd = purge
        ? `rm -rf "$HOME/.nanobot" /home/*/.nanobot 2>/dev/null; pipx uninstall nanobot-ai 2>/dev/null; echo REMOVED_ALL`
        : `pipx uninstall nanobot-ai 2>/dev/null; echo REMOVED_PKG`;
      const r = await run(purge ? 'remove nanobot & all data' : 'remove package', `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; ${rmCmd}`);
      return NextResponse.json({ success: true, purged: purge, output: (r.stdout || '').slice(-500) });
    }

    // ── INSTALL ──
    if (action === 'install') {
      const probeR = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      let p = (k) => (probeR.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const hasSudo = p('SUDO') === '1';
      // nanobot needs Python >= 3.11 (installer does NOT bootstrap Python)
      const pyVer = String(p('PY3') || '');
      const pyOk = (() => { const m = pyVer.match(/(3)\.(\d+)/); return !!m && (Number(m[2]) >= 11); })();
      if (!pyOk) {
        await run('install Python 3.11+', `
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
          S="${hasSudo ? 'sudo -n' : ''}"
          (command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y python3 python3-venv python3-pip) < /dev/null ||
          (command -v dnf    >/dev/null 2>&1 && { $S dnf install -y python3.11 python3.11-pip 2>/dev/null || $S dnf install -y --allowerasing python3.11 python3.11-pip; }; [ -x /usr/bin/python3.11 ] && ln -sf /usr/bin/python3.11 /usr/local/bin/python3) < /dev/null ||
          (command -v yum    >/dev/null 2>&1 && $S yum install -y python3.11 python3.11-pip) < /dev/null ||
          (command -v zypper >/dev/null 2>&1 && echo 'gpgcheck = 0' >> /etc/zypp/zypp.conf; $S zypper --non-interactive --no-gpg-checks install python311 python311-pip; [ -x /usr/bin/python3.11 ] && ln -sf /usr/bin/python3.11 /usr/local/bin/python3) < /dev/null ||
          (command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed python) < /dev/null ||
          echo PYTHON_PREREQ_SKIPPED`, { timeoutMs: 300000 });
      }
      // always make sure the venv module is present (Debian/Ubuntu split it into python3-venv)
      // and that the venv's python can bootstrap pip (PEP 668). The HKUDS installer creates
      // ~/.nanobot/venv and runs ensurepip — without python3-venv this silently fails.
      await run('ensure python3-venv + pip', `
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
        S="${hasSudo ? 'sudo -n' : ''}"
        (command -v apt-get >/dev/null 2>&1 && $S apt-get install -y python3-venv python3-pip python3-full 2>/dev/null) < /dev/null || true
        (command -v dnf    >/dev/null 2>&1 && $S dnf install -y python3-pip python3-virtualenv 2>/dev/null) < /dev/null || true
        (command -v zypper >/dev/null 2>&1 && $S zypper --non-interactive install python3-pip python3-virtualenv 2>/dev/null) < /dev/null || true
        (command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed python-pip 2>/dev/null) < /dev/null || true
        true`, { timeoutMs: 300000 });
      // refresh probe so later checks see the new interpreter
      const pr2 = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      p = (k) => (pr2.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const pyVer2 = String(p('PY3') || '');
      const m2 = pyVer2.match(/(3)\.(\d+)/);
      if (!m2 || Number(m2[2]) < 11) {
        return NextResponse.json({ success: false, error: `Python >= 3.11 is required for Nanobot but could not be provisioned on this server (found: ${pyVer2 || 'none'}) — see log.`, log });
      }
      if (p('CURL') !== '1') {
        await run('install curl', `
          export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
          export DEBIAN_FRONTEND=noninteractive
          S="${hasSudo ? 'sudo -n' : ''}"
          (command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y curl ca-certificates) < /dev/null ||
          (command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing curl) < /dev/null ||
          (command -v yum    >/dev/null 2>&1 && $S yum install -y curl) < /dev/null ||
          echo PREREQ_SKIPPED`, { timeoutMs: 180000 });
      }
      // 3. Official installer — DETACHED on the host (no SSH channel held open
      //    during the build); lines stream into the job log as they appear.
      {
        let streamed = 0;
        const instR = await execDetached(sshConfig,
          // /usr/local/bin FIRST: sshd's default PATH resolves /usr/bin/python3 (3.9)
          // on RHEL-9 family even after we install python3.11 into /usr/local/bin
          `export PATH="/usr/local/bin:$HOME/.local/bin:\$PATH"; curl -fsSL ${INSTALLER_URL} | sh 2>&1`,
          {
            pollMs: 3000,
            timeoutMs: 900000,
            onLine: (ln) => { if (++streamed <= 400) log.push(ln); },
          });
        log.push(`$ official installer${instR.code !== 0 ? ` — exited ${instR.code}` : ' — finished'}${streamed > 400 ? ` (${streamed} lines total)` : ''}${instR.stderr ? `\n${instR.stderr.slice(0, 300)}` : ''}`);
      }
      const bc = await resolveBin();
      const NB = binFrom(bc);
      if (!NB) return NextResponse.json({ success: false, error: 'Installer finished but nanobot binary was not found. See log.', log });
      const NBE = JSON.stringify(NB);

      // 4. Merge ~/.nanobot/config.json (deep-merge via python3, shipped as b64)
      const cfg = typeof config.configJson === 'object' && config.configJson ? config.configJson : {};
      const cfgB64 = b64(JSON.stringify(cfg));
      await run('merge ~/.nanobot/config.json', [
        'mkdir -p "$HOME/.nanobot"',
        `echo '${b64(JSON.stringify(cfg))}' | base64 -d > /tmp/.nb-new.json`,
        `cat > /tmp/.nb-merge.py <<'PYEOF'`,
        'import json, os, sys',
        "path = os.path.expanduser('~/.nanobot/config.json')",
        'new = json.load(open(sys.argv[1]))',
        'cur = {}',
        'if os.path.exists(path):',
        '    try: cur = json.load(open(path))',
        '    except Exception: cur = {}',
        'def deep_merge(a, b):',
        '    for k, v in b.items():',
        '        if isinstance(v, dict) and isinstance(a.get(k), dict): deep_merge(a[k], v)',
        '        else: a[k] = v',
        '    return a',
        'json.dump(deep_merge(cur, new), open(path, \"w\"), indent=2)',
        "print('CONFIG_MERGED')",
        'PYEOF',
        '(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-new.json || cp /tmp/.nb-new.json "$HOME/.nanobot/config.json")',
        'rm -f /tmp/.nb-new.json /tmp/.nb-merge.py',
        'echo NB_CFG_MERGED',
      ].join('\n'), { timeoutMs: 60000 });

      // 5. Enable telegram plugin when requested
      if ((config.plugins || []).includes('telegram')) {
        await run('enable telegram plugin', `PATH="$(dirname ${NBE}):$PATH" ${NBE} plugins enable telegram 2>&1 | tail -3 || true`, { timeoutMs: 120000 });
      }

      // 6. Start gateway detached
      await run('start gateway', [
        'mkdir -p "$HOME/.nanobot/logs"',
        `setsid nohup $(export PATH="$(dirname ${NBE}):$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; command -v nanobot) gateway >> "$HOME/.nanobot/logs/gatew""ay.log" 2>&1 < /dev/null &`,
        'sleep 4',
        "timeout 15 pgrep -f '[n]anobot.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN",
      ].join('\n'), { timeoutMs: 90000 });
      const up = await execCommand(sshConfig, `timeout 15 pgrep -f '[n]anobot.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`, { pool: false, timeoutMs: 30000 });
      const running = /GW_UP/.test(up.stdout || '');

      return NextResponse.json({
        success: running,
        running,
        startMethod: 'process',
        error: running ? null : 'Gateway did not stay running — check ~/.nanobot/logs/gateway.log on the server.',
        log,
      });
    }

    // ── SAVE-CONFIG (JSON) with corrupt-guard auto-rollback ──
    // ── RECONFIGURE — update providers/apiKey/channels + restart gateway (no reinstall) ──
    if (action === 'reconfigure') {
      const env = (config && config.env) || {};
      const PROVIDER_FROM_KEY = {
        OPENROUTER_API_KEY: 'openrouter',
        OPENAI_API_KEY: 'openai',
        ANTHROPIC_API_KEY: 'anthropic',
        CUSTOM_LLM_API_KEY: 'custom',
      };
      const modelFromSettings = (config.settings && config.settings.model) || null;
      const providerName = Object.entries(env)
        .map(([k, v]) => ({ k, v, p: PROVIDER_FROM_KEY[k] }))
        .find(x => x.p && x.v);

      const newConfig = {};
      if (providerName) {
        newConfig.providers = { [providerName.p]: { apiKey: providerName.v } };
        newConfig.modelPresets = { primary: { provider: providerName.p, model: modelFromSettings || 'stealth/ox-alpha', maxTokens: 8192, contextWindowTokens: 65536 } };
        newConfig.agents = { defaults: { modelPreset: 'primary' } };
      } else if (modelFromSettings) {
        newConfig.modelPresets = { primary: { model: modelFromSettings } };
      }

      const tgToken = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN;
      const tgAllowed = env.TELEGRAM_ALLOWED_USERS ? env.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean) : null;
      if (tgToken) {
        newConfig.channels = newConfig.channels || {};
        newConfig.channels.telegram = {
          enabled: true,
          token: tgToken,
          ...(tgAllowed ? { allowFrom: tgAllowed } : {})
        };
        // Enable telegram plugin if needed
        await execCommand(sshConfig, `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; command -v nanobot >/dev/null 2>&1 && nanobot plugins enable telegram 2>/dev/null || true`, { pool: false, timeoutMs: 30000 });
      }

      const sidecarKeys = Object.entries(env).filter(([k]) => k.startsWith('TELEGRAM_') || k.startsWith('LINE_') || k.startsWith('DISCORD_'));
      const cfgB64 = b64(JSON.stringify(newConfig));
      const sidecarB64 = b64(sidecarKeys.map(([k, v]) => `${k}=${v}`).join('\n'));
      const w = await run('merge ~/.nanobot/config.json', [
        'mkdir -p "$HOME/.nanobot"',
        `echo '${cfgB64}' | base64 -d > /tmp/.nb-cfg-new.json`,
        sidecarKeys.length ? `echo '${sidecarB64}' | base64 -d > "$HOME/.nanobot/.env"; chmod 600 "$HOME/.nanobot/.env"` : 'true',
        `cat > /tmp/.nb-merge.py <<'PYEOF'
import json, os, sys
p = os.path.expanduser('~/.nanobot/config.json')
new = json.load(open(sys.argv[1]))
cur = {}
if os.path.exists(p):
    try: cur = json.load(open(p))
    except Exception: cur = {}
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, new)
json.dump(cur, open(p, 'w'), indent=2)
print('MERGED')
PYEOF`,
        '(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-cfg-new.json || cp /tmp/.nb-cfg-new.json "$HOME/.nanobot/config.json")',
        'rm -f /tmp/.nb-cfg-new.json /tmp/.nb-merge.py',
        'echo RECONFIGURED',
      ].join('\n'), { timeoutMs: 30000 });
      if (!/RECONFIGURED/.test((w.stdout || '') + (w.stderr || ''))) {
        return NextResponse.json({ success: false, error: 'Failed to write config', log });
      }
      // restart gateway
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'process' : null, error: g.ok ? null : (g.out || 'gateway did not start after reconfigure'), log });
    }

    if (action === 'save-config') {
      const jsonText = String(config.configJson ?? '');
      if (!jsonText.trim()) return NextResponse.json({ success: false, error: 'config.json content is empty' }, { status: 400 });
      await execCommand(sshConfig, `
        cp "$HOME/.nanobot/config.json" "$HOME/.nanobot/config.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(jsonText)}' | base64 -d > "$HOME/.nanobot/config.json.new"
        mv "$HOME/.nanobot/config.json.new" "$HOME/.nanobot/config.json"
        echo CONFIG_SAVED`, { pool: false, timeoutMs: 30000 });
      let restarted = false;
      let rolledBack = false;
      if (config.restart) {
        const g = await gwCtl('restart');
        restarted = g.ok;
        if (!g.ok) {
          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "$HOME/.nanobot"/config.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "$HOME/.nanobot/config.json" && echo ROLLED_BACK=$BAK || echo NO_BACKUP`,
            { pool: false, timeoutMs: 30000 });
          if (/ROLLED_BACK/.test(rbk.stdout || '')) {
            rolledBack = true;
            await gwCtl('restart');
            return NextResponse.json({ success: true, restarted: true, rolledBack: true });
          }
        }
      }
      return NextResponse.json({ success: true, restarted, rolledBack });
    }

    // ── CONFIG BACKUPS ──
    if (action === 'backups') {
      const r = await execCommand(sshConfig,
        `ls -1t "$HOME/.nanobot"/config.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const name = String(config.name || '');
      if (!/^config\\.json\\.bak-[0-9]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "$HOME/.nanobot/${name}" ] && cp "$HOME/.nanobot/${name}" "$HOME/.nanobot/config.json" && echo RESTORED || echo NOT_FOUND`,
        { pool: false, timeoutMs: 30000 });
      let restarted = false;
      if (/RESTORED/.test(r.stdout || '')) {
        const g = await gwCtl('restart');
        restarted = g.ok;
      }
      return NextResponse.json({ success: /RESTORED/.test(r.stdout || ''), restarted });
    }

    // ── GATEWAY control ──
    if (action === 'gateway') {
      const op = ['start', 'stop', 'restart'].includes(config.op) ? config.op : 'status';
      const g = await gwCtl(op);
      return NextResponse.json({ success: g.ok !== false, active: g.active ?? g.ok, output: g.out || '', op });
    }

    // ── LOGS ──
    if (action === 'logs') {
      const cursor = Number(config.cursor || 0);
      const LINES = Math.min(Number(config.lines || 300), 1000);
      const script = `
LOG=""
for f in "$HOME/.nanobot/logs/gatew""ay.log" "$HOME/.nanobot-gatew""ay.log" "$HOME/.nanobot/logs/webui.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break
done
if [ -z "$LOG" ]; then echo "SIZE=0"; echo "===DATA==="; exit 0; fi
SZ=$(wc -c < "$LOG")
echo "SIZE=$SZ"
echo "===DATA==="
if [ ${cursor} -gt 0 ] && [ ${cursor} -le $SZ ]; then tail -c +$((cursor + 1)) "$LOG"; else tail -n ${LINES} "$LOG"; fi
`;
      const r = await execCommand(sshConfig, script, { pool: false, timeoutMs: 45000 });
      const out = r.stdout || '';
      const dataIdx = out.indexOf('===DATA===');
      return NextResponse.json({
        success: true,
        size: Number(out.match(/SIZE=(\d+)/)?.[1] || 0),
        data: dataIdx >= 0 ? out.slice(dataIdx + 10) : '',
      });
    }

    // ── HEALTH ──
    if (action === 'health') {
      const script = `
ALIVE=0; pgrep -f '[n]anobot.*gatew[a]y' >/dev/null 2>&1 && ALIVE=1
echo "ALIVE=$ALIVE"
PID=$(pgrep -f '[n]anobot.*gatew[a]y' | head -1)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "$HOME/.nanobot/logs/gatew""ay.log" "$HOME/.nanobot-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break; done
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
      return NextResponse.json({ success: true, alive: gv('ALIVE') === '1', uptimeSec: Number(gv('UPTIME_SEC') || 0), telegram: gv('TG') || 'unknown' });
    }

    // ── SKILLS / PLUGINS ──
    if (action === 'skills') {
      const op = config.op;
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      const BP = bp ? JSON.stringify(bp) : 'nanobot';
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;

      if (op === 'remove') {
        const name = String(config.name || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill/plugin name' }, { status: 400 });
        }
        await execCommand(sshConfig, `${ENVX}; ${BP} plugins disable ${JSON.stringify(name)} 2>/dev/null; rm -rf "$HOME/.nanobot/workspace/skills/${name}" 2>/dev/null; true`, { pool: false, timeoutMs: 30000 });
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, log: [`Removed skill/plugin ${name}`] });
      }

      if (op === 'install') {
        const id = String(config.id || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(id)) {
          return NextResponse.json({ success: false, error: 'Invalid skill id' }, { status: 400 });
        }
        const knownPlugins = ['telegram', 'discord', 'slack', 'matrix', 'feishu', 'dingtalk', 'email', 'langfuse', 'azure', 'bedrock', 'msteams', 'qq', 'signal', 'wecom', 'weixin', 'whatsapp', 'api', 'olostep', 'napcat', 'mochat', 'mattermost'];
        let logMsg = '';
        if (knownPlugins.includes(id.toLowerCase())) {
          const r = await execCommand(sshConfig, `${ENVX}; ${BP} plugins enable ${id.toLowerCase()} 2>&1`, { pool: false, timeoutMs: 120000 });
          logMsg = r.stdout || r.stderr;
        } else {
          await execCommand(sshConfig, `mkdir -p "$HOME/.nanobot/workspace/skills"; cd "$HOME/.nanobot/workspace/skills"; git clone --depth 1 "${id}" 2>/dev/null || (mkdir -p "${id.replace(/[^a-zA-Z0-9_-]/g, '_')}" && echo '# ${id}' > "${id.replace(/[^a-zA-Z0-9_-]/g, '_')}/SKILL.md")`, { pool: false, timeoutMs: 120000 });
          logMsg = `Installed custom skill ${id}`;
        }
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: logMsg });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    logger.error('[nanobot-agent] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
