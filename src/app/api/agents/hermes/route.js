import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';

/**
 * Hermes Agent (Nous Research) one-click installer — deploys the real
 * hermes-agent (https://hermes-agent.nousresearch.com) onto a selected SSH
 * server via the official install.sh, then pre-seeds messaging gateway
 * credentials (.env) + config (hermes config set) and installs it as a service.
 *
 * POST body: { connectionId, action, config?, purge? }
 *   action : 'status' | 'install' | 'uninstall'
 *   config : {
 *     env        : { KEY: VALUE, ... }   // merged into ~/.hermes/.env
 *     settings   : { 'gateway.platforms.telegram.enabled': 'true', model: '...' }
 *                  // applied via `hermes config set` (dotted keys)
 *     method     : 'auto' | 'system' | 'user' | 'nohup'
 *     skipBrowser: boolean               // skip Playwright/Chromium (headless)
 *   }
 *   purge  : boolean  // uninstall: also delete ~/.hermes (memories/config)
 */

const INSTALLER_URL = 'https://hermes-agent.nousresearch.com/install.sh';

function maskSecretString(val) {
  if (!val || typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '••••••••';
  return trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
}

function maskConfigYaml(text) {
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

// POSIX sh probe — works on every supported distro.
const STATUS_SCRIPT = `
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CODE=0; [ -d "$HOME/.hermes/hermes-agent" ] && CODE=1
echo "CODE=$CODE"
CFG=0; [ -f "$HOME/.hermes/config.yaml" ] && CFG=1
echo "CONFIG=$CFG"
ENVF=0; [ -f "$HOME/.hermes/.env" ] && ENVF=1
echo "ENVFILE=$ENVF"
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
PROC=0; pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
SUDO=0; sudo -n true 2>/dev/null && SUDO=1
GIT=$(git --version 2>/dev/null | awk '{print $3}')
[ -z "$GIT" ] && GIT=NONE
CURLP=0; command -v curl >/dev/null 2>&1 && CURLP=1
XZ=0; command -v xz >/dev/null 2>&1 && XZ=1
ATOMIC=0
{ ldconfig -p 2>/dev/null | grep -q libatomic || [ -e /usr/lib64/libatomic.so.1 ] || [ -e /usr/lib/x86_64-linux-gnu/libatomic.so.1 ]; } && ATOMIC=1
CXX=0; { command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1; } && CXX=1
TARP=0; command -v tar >/dev/null 2>&1 && TARP=1
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"
echo "GIT=$GIT"; echo "CURL=$CURLP"; echo "XZ=$XZ"; echo "ATOMIC=$ATOMIC"; echo "CXX=$CXX"; echo "TAR=$TARP"
DOCKER=0; command -v docker >/dev/null 2>&1 && DOCKER=1
DCONT=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DCONT=1
echo "DOCKER=$DOCKER"; echo "DCONT=$DCONT"
if [ "$DCONT" = "1" ]; then
  CV="$(docker exec hermes-agent hermes --version 2>/dev/null | tail -1 | cut -c1-40)"
  [ -n "$CV" ] && echo "CVERSION=$CV"
  docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && CGW=1 || CGW=0
  echo "CGW=$CGW"
fi
`;

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const { connectionId, action, config = {}, purge = false } = body;
    if (!connectionId || !action) {
      return NextResponse.json({ success: false, error: 'Missing connectionId or action' }, { status: 400 });
    }
    // `job` polling needs no connectionId
    if (action === 'job') return dispatchWithLiveLogs(body, () => ({}));
    return dispatchWithLiveLogs(body, (b, log) => handleAgentAction(b, session, log));
  } catch (e) {
    logger.error('[agents/hermes] POST failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' }, { status: 500 });
  }
}

async function handleAgentAction(body, session, log = []) {
  try {
    const { connectionId, action, config = {}, purge = false } = body;
    const sshConfig = await getSshConfig(connectionId);
    // Docker-isolated installs: when set, every install command is executed
    // inside the container via `docker exec … sh -s` heredoc (quoting-safe).
    let dockerWrap = null;
    const run = async (label, cmd, opts = {}) => {
      const finalCmd = dockerWrap ? dockerWrap(cmd) : cmd;
      const r = await execCommand(sshConfig, finalCmd, { pool: false, timeoutMs: 60000, ...opts });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      log.push(`$ ${label}${out ? `\n${out.slice(0, 2500)}` : ''}`);
      return r;
    };
    const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

    // ── Gateway control helper — never blocks ────────────────────────────────
    // Uses systemctl only when systemd is genuinely PID 1; otherwise falls back
    // to pkill + detached nohup start. Every remote call is wrapped in `timeout`
    // so a stuck hermes CLI can never hang the request.
    const gwCtl = async (op) => {
      const binR = await execCommand(sshConfig,
        `p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -n "$p" ] && echo "HBIN=$p"
DC=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DC=1
echo "DC=$DC"
[ "$DC" = '1' ] && docker exec hermes-agent sh -c 'command -v hermes' 2>/dev/null | head -1 | { read -r cb; [ -n "$cb" ] && echo "CBIN=$cb"; }
true`,
        { pool: false, timeoutMs: 30000 });
      const o0 = binR.stdout || '';
      const dcont = /DC=1/.test(o0);
      let hbin = (o0.match(/HBIN=(.*)/)?.[1] || '').trim();
      let cbin = (o0.match(/CBIN=(.*)/)?.[1] || '').trim();
      if (!hbin && !cbin) return { ok: false, out: 'hermes binary not found (host or container)' };
      const sysdLive = /SYSTEMD=1/.test(binR.stdout || '');
      // Build an execution wrapper + bin path valid for whichever side has hermes
      let PFX = '';
      let BINP;
      if (dcont && cbin) {
        BINP = JSON.stringify(cbin);
        PFX = `docker exec hermes-agent sh -c `;
        return gwCtlExec(op, dcont, cbin);
      }
      BINP = hbin ? JSON.stringify(hbin) : JSON.stringify('/usr/local/bin/hermes');
      return gwCtlHost(op, hbin || '/usr/local/bin/hermes', sysdLive);

      function gwCtlHost(operation, binPath, sysd) {
        const binDir = JSON.stringify(binPath.replace(/\/[^/]+$/, ''));
        const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH=${binDir}:$PATH`;
        if (operation === 'status') {
          return execCommand(sshConfig, `${ENVX}; timeout 20 pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo PROC_ACTIVE || echo NO_PROC`, { pool: false, timeoutMs: 30000 })
            .then(r => ({ ok: true, active: /PROC_ACTIVE/.test(r.stdout || '') }));
        }
        if (operation === 'stop') {
          return execCommand(sshConfig,
            `${ENVX}; ${sysd ? `timeout 25 systemctl stop hermes-gate""way 2>/dev/null; timeout 25 systemctl --user stop hermes-gate""way 2>/dev/null;` : ''} timeout 15 pkill -f '[h]ermes.*gatew[a]y' 2>/dev/null; sleep 1; pkill -9 -f '[h]ermes.*gatew[a]y' 2>/dev/null || true; echo GW_STOPPED`,
            { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
        }
        const verb = operation === 'restart' ? null : operation; // restart handled as stop+start by caller? keep simple:
        if (sysd) {
          const v2 = op === 'restart' ? 'try-restart' : 'start';
          return execCommand(sshConfig,
            `${ENVX}; timeout 40 systemctl ${op === 'restart' ? 'try-restart' : verb === 'start' ? 'start' : 'start'} hermes-gate""way 2>/dev/null || timeout 40 systemctl --user ${verb} hermes-gate""way 2>/dev/null || mkdir -p "$HOME/.hermes/logs" && setsid nohup ${JSON.stringify(binPath)} gateway >> "$HOME/.hermes/logs/gatew""ay-nohup.log" 2>&1 < /dev/null & sleep 3; timeout 15 pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`,
            { pool: false, timeoutMs: 120000 }).then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
        }
        return execCommand(sshConfig,
          `${ENVX}; mkdir -p "$HOME/.hermes/logs"; setsid nohup ${JSON.stringify(binPath)} gateway >> "$HOME/.hermes/logs/gatew""ay-nohup.log" 2>&1 < /dev/null & sleep 3; timeout 15 pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo GW_UP || echo GW_DOWN`,
          { pool: false, timeoutMs: 90000 }).then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
      }
      async function gwCtlExec(operation, cbin) {
        const CB = JSON.stringify(cbin);
        if (operation === 'status') {
          const r = await execCommand(sshConfig, `docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo ACTIVE || echo INACTIVE`, { pool: false, timeoutMs: 30000 });
          return { ok: true, active: /ACTIVE/.test(r.stdout || '') };
        }
        if (operation === 'stop') {
          const r = await execCommand(sshConfig, `timeout 15 docker exec hermes-agent pkill -f '[h]ermes gateway'; echo GW_STOPPED`, { pool: false, timeoutMs: 45000 });
          return { ok: /GW_STOPPED/.test(r.stdout || ''), out: (r.stdout || '').slice(-300) };
        }
        if (operation === 'restart') {
          await execCommand(sshConfig, `docker exec hermes-agent pkill -f '[h]ermes gateway' 2>/dev/null; sleep 2; echo KILLED`, { pool: false, timeoutMs: 45000 });
        }
        const r = await execCommand(sshConfig,
          `docker exec -d hermes-agent bash -c 'mkdir -p /root/.hermes/logs && PATH=/usr/local/bin:/usr/bin:/bin:$PATH nohup ${JSON.stringify(cbin)} gateway >> /root/.hermes/logs/gateway-nohup.log 2>&1 < /dev/null &' && echo GW_STARTED`,
          { pool: false, timeoutMs: 60000 });
        return { ok: /GW_STARTED/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) };
      }
    };
    if (action === 'status') {
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 30000 });
      const parse = (k) => (r.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
      const hostInstalled = parse('BIN') === 'SET';
      const inContainer = parse('DCONT') === '1';
      const containerGatewayUp = parse('CGW') === '1';
      const containerVersion = parse('CVERSION') || null;
      const running = parse('USVC') === '1' || parse('SSVC') === '1' || parse('PROC') === '1' || (inContainer && containerGatewayUp);
      return NextResponse.json({
        success: true,
        installed: hostInstalled || inContainer,
        version: hostInstalled ? parse('VERSION') : (containerVersion || parse('VERSION')),
        running,
        service: parse('SSVC') === '1' ? 'system' : parse('USVC') === '1' ? 'user' : parse('PROC') === '1' ? 'process' : (inContainer && containerGatewayUp) ? 'docker' : null,
        hasConfig: parse('CONFIG') === '1',
        hasEnvFile: parse('ENVFILE') === '1',
        prereqs: { git: parse('GIT'), curl: parse('CURL') === '1', xz: parse('XZ') === '1', systemd: parse('SYSTEMD') === '1', passwordlessSudo: parse('SUDO') === '1' },
      });
    }

    // ── UNINSTALL ───────────────────────────────────────────────────────────
    if (action === 'uninstall') {
      await run('stop system service', `(sudo -n systemctl disable --now hermes-gate""way 2>/dev/null || systemctl disable --now hermes-gate""way 2>/dev/null); true`);
      await run('stop user service', `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now hermes-gate""way 2>/dev/null; true`);
      await run('stop stray processes', `pkill -f '[h]ermes.*gatew[a]y' 2>/dev/null; pkill -f '[h]ermes-agent/hermes' 2>/dev/null; true`);
      // Remove isolated Docker container (if any); data volume kept unless purge.
      await run('remove docker container', `command -v docker >/dev/null 2>&1 && docker rm -f hermes-agent 2>/dev/null; ${purge ? 'rm -rf "$HOME/.hermes-docker" 2>/dev/null;' : ''} true`);
      const rmCmd = purge
        ? `rm -f "$HOME/.local/bin/hermes" /usr/local/bin/hermes; rm -rf "$HOME/.hermes" /usr/local/lib/hermes-agent; echo REMOVED_ALL`
        : `rm -f "$HOME/.local/bin/hermes" /usr/local/bin/hermes; rm -rf "$HOME/.hermes/hermes-agent" /usr/local/lib/hermes-agent; echo REMOVED_CODE`;
      const r = await run(purge ? 'remove binary, code & all config' : 'remove binary & code (config kept)', rmCmd);
      const ok = /REMOVED/.test(r.stdout || '');
      return NextResponse.json({ success: ok, purged: purge, log });
    }

    // ── DETAILS / CONFIG / SKILLS / GATEWAY MANAGEMENT ────────────────────
    if (action === 'details') {
      const DETAILS_SCRIPT = `
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "$HOME/.hermes/config.yaml" 2>/dev/null || true
echo "===ENV_B64==="
base64 < "$HOME/.hermes/.env" 2>/dev/null || true
echo "===ENVKEYS==="
grep -E '^[A-Z_]+=' "$HOME/.hermes/.env" 2>/dev/null | cut -d= -f1 || true
echo "===SKILLS==="
ls -1 "$HOME/.hermes/skills" 2>/dev/null | grep -v '^\.' || true
echo "===PROMPT_B64==="
{ base64 < "$HOME/.hermes/custom_instructions.txt" || base64 < "$HOME/.hermes/prompt.txt" || base64 < "$HOME/.hermes/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "$HOME/.hermes/SOUL.md" || base64 < "$HOME/.hermes/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "$HOME/.hermes/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "$HOME/.hermes/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "$HOME/.hermes/MEMORY.md" || base64 < "$HOME/.hermes/memories/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
PROC=0; pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
echo "SSVC=$SSVC"; echo "USVC=$USVC"; echo "PROC=$PROC"; echo "SYSTEMD=$SYSTEMD"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
[ -n "$BIN" ] && "$BIN" config get model 2>/dev/null | tail -1
`;
      const r = await execCommand(sshConfig, DETAILS_SCRIPT, { pool: false, timeoutMs: 60000 });
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
      let configYaml = '';
      try { configYaml = Buffer.from(section('CONFIG_B64', 'ENV_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let envText = '';
      try { envText = Buffer.from(section('ENV_B64', 'ENVKEYS'), 'base64').toString('utf8'); } catch { /* none */ }
      const envKeys = section('ENVKEYS', 'SKILLS').split('\n').map(s => s.trim()).filter(Boolean);
      const skills = section('SKILLS', 'PROMPT_B64').split('\n').map(s => s.trim()).filter(Boolean);
      let systemPrompt = '';
      try { systemPrompt = Buffer.from(section('PROMPT_B64', 'SOUL_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let soulPrompt = '';
      try { soulPrompt = Buffer.from(section('SOUL_B64', 'USER_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let userPrompt = '';
      try { userPrompt = Buffer.from(section('USER_B64', 'AGENTS_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let agentsPrompt = '';
      try { agentsPrompt = Buffer.from(section('AGENTS_B64', 'MEMORY_B64'), 'base64').toString('utf8'); } catch { /* none */ }
      let memoryPrompt = '';
      try { memoryPrompt = Buffer.from(section('MEMORY_B64', 'RUNNING'), 'base64').toString('utf8'); } catch { /* none */ }

      // Binary may live on the host OR inside the hermes-agent docker container
      const binR2 = await execCommand(sshConfig,
        `p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -n "$p" ] && echo "BIN=$p"; command -v docker >/dev/null 2>&1 && docker exec hermes-agent sh -c 'command -v hermes' 2>/dev/null | head -1 | { read -r cp2; [ -n "$cp2" ] && echo "CBIN=$cp2"; }; true`,
        { pool: false, timeoutMs: 30000 });
      const dout = binR2.stdout || '';
      const remoteBinPath = (dout.match(/BIN=(.*)/)?.[1] || dout.match(/CBIN=(.*)/)?.[1] || '').trim();
      const installed = !!remoteBinPath;
      const running = /SSVC=1|USVC=1|PROC=1/.test(section('RUNNING', 'VERSION')) || (installed && /PROC=1/.test(section('RUNNING', 'VERSION')));
      return NextResponse.json({
        success: true,
        installed,
        version: section('VERSION', 'MODEL') || null,
        model: section('MODEL') || null,
        running,
        binPath: remoteBinPath || null,
        service: /SSVC=1/.test(out) ? 'system' : /USVC=1/.test(out) ? 'user' : /PROC=1/.test(out) ? 'process' : null,
        hasSystemd: /SYSTEMD=1/.test(section('RUNNING', 'VERSION')),
        configYaml: maskConfigYaml(configYaml),
        envText: maskEnvText(envText),
        envKeys,
        skills,
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
      let SCRIPT = `mkdir -p "$HOME/.hermes" "$HOME/.hermes/memories"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.hermes/SOUL.md"\necho "${b64}" | base64 -d > "$HOME/.hermes/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.hermes/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.hermes/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.hermes/MEMORY.md"\necho "${b64}" | base64 -d > "$HOME/.hermes/memories/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "$HOME/.hermes/custom_instructions.txt"\necho "${b64}" | base64 -d > "$HOME/.hermes/prompt.txt"\necho "${b64}" | base64 -d > "$HOME/.hermes/SYSTEM_PROMPT.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── RECONFIGURE — write env to ~/.hermes/.env + restart gateway (no reinstall) ──
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
        const w = await run('write ~/.hermes/.env', `
          touch "$HOME/.hermes/.env"; chmod 600 "$HOME/.hermes/.env"
          echo '${envB64}' | base64 -d > /tmp/.hm-env-new
          while IFS='=' read -r k v; do
            [ -z "$k" ] && continue
            grep -q "^$k=" "$HOME/.hermes/.env" && sed -i "s|^$k=.*|$k=$v|" "$HOME/.hermes/.env" || echo "$k=$v" >> "$HOME/.hermes/.env"
          done < /tmp/.hm-env-new
          rm -f /tmp/.hm-env-new
          echo ENV_UPDATED`, { timeoutMs: 30000 });
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: 'Failed to write ~/.hermes/.env', log });
        }
      }
      // also merge settings (model, platform toggles) into config.yaml if provided
      if (config.settings && Object.keys(config.settings).length) {
        const setB64 = b64(JSON.stringify(config.settings));
        await run('merge ~/.hermes/config.yaml settings', `
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
          python3 - <<'PY' 2>/dev/null || true
import json, os, base64, re
path = os.path.expanduser('~/.hermes/config.yaml')
if not os.path.exists(path):
    open(path, 'w').close()
new = json.loads(base64.b64decode('${setB64}').decode('utf-8'))
text = open(path).read() if os.path.getsize(path) else ''
for k, v in (new.items() if isinstance(new, dict) else []):
    sval = 'true' if v is True else ('false' if v is False else str(v))
    if re.search(rf'^{re.escape(k)}:', text, re.M):
        text = re.sub(rf'^{re.escape(k)}:.*$', f'{k}: {sval}', text, count=1, flags=re.M)
    else:
        text += f'\n{k}: {sval}\n'
open(path, 'w').write(text)
print('SETTINGS_MERGED')
PY`, { timeoutMs: 30000 });
      }
      // restart gateway
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'restart' : null, error: g.ok ? null : g.error, log });
    }

    if (action === 'save-config') {
      const yaml = String(config.configYaml ?? '');
      if (!yaml.trim()) return NextResponse.json({ success: false, error: 'config.yaml content is empty' }, { status: 400 });
      await execCommand(sshConfig, `
        cp "$HOME/.hermes/config.yaml" "$HOME/.hermes/config.yaml.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(yaml)}' | base64 -d > "$HOME/.hermes/config.yaml.new"
        mv "$HOME/.hermes/config.yaml.new" "$HOME/.hermes/config.yaml"
        echo CONFIG_SAVED`, { pool: false, timeoutMs: 30000 });
      let restarted = false;
      let rolledBack = false;
      if (config.restart) {
        const g = await gwCtl('restart');
        restarted = g.ok;
        // Corrupt-config guard: gateway refuses to start → auto-restore backup
        await new Promise(r => setTimeout(r, 6000));
        const chk = await gwCtl('status');
        if (!chk.active) {
          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "$HOME/.hermes"/config.yaml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "$HOME/.hermes/config.yaml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
            { pool: false, timeoutMs: 30000 });
          if (/ROLLED_BACK/.test(rbk.stdout || '')) {
            rolledBack = true;
            await gwCtl('restart');
            await new Promise(r => setTimeout(r, 5000));
            const chk2 = await gwCtl('status');
            return NextResponse.json({
              success: chk2.active, restarted: chk2.active, rolledBack: true,
              error: chk2.active ? null : 'Rolled back previous config but gateway still down — check ~/.hermes/logs/',
              log: [`Your saved config broke the gateway — automatically restored ${((rbk.stdout || '').match(/ROLLED_BACK_TO=(.*)/) || [])[1] || 'last backup'}`],
            });
          }
        }
      }
      return NextResponse.json({ success: true, restarted, rolledBack });
    }

    // ── LOGS — incremental live tail of the active gateway log ──────────────
    if (action === 'logs') {
      const cursor = Number(config.cursor || 0);
      const LINES = Math.min(Number(config.lines || 300), 1000);
      const script = `
ACTIVE=""
for f in "$HOME/.hermes/logs/gatew""ay-nohup.log" "$HOME/.hermes/logs/gatew""ay.log" "$HOME/.hermes-docker/logs/gatew""ay-nohup.log" "$HOME/.hermes-docker/logs/gatew""ay.log"; do
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

    // ── HEALTH — is the bot actually alive & connected? ─────────────────────
    if (action === 'health') {
      const script = `
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
PROC=0; pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1
DC=0; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && DC=1
if [ "$DC" = '1' ]; then docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1 && PROC=1; fi
ALIVE=0; [ $SSVC = 1 -o $USVC = 1 -o $PROC = 1 ] && ALIVE=1
echo "ALIVE=$ALIVE"
PID=$(pgrep -f '[h]ermes.*gatew[a]y' | head -1)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "$HOME/.hermes/logs/gatew""ay-nohup.log" "$HOME/.hermes/logs/gatew""ay.log" "$HOME/.hermes-docker/logs/gatew""ay-nohup.log" "$HOME/.hermes-docker/logs/gatew""ay.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
if [ -n "$LOGL" ]; then
  if tail -n 400 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected)'; then
    TG=error
  fi
  echo "TG=$TG"
  ERRS=$(tail -n 300 "$LOGL" 2>/dev/null | grep -E 'ERROR|CRITICAL' | tail -5)
  EC=0; [ -n "$ERRS" ] && EC=$(printf '%s\n' "$ERRS" | wc -l)
  echo "ERRCOUNT=$EC"
  if [ -n "$ERRS" ]; then
    echo "===ERRORS==="
    printf '%s\n' "$ERRS"
    echo "===ENDERRORS==="
  fi
else
  echo "TG=unknown"; echo "ERRCOUNT=0"
fi
`;
      const r = await execCommand(sshConfig, script, { pool: false, timeoutMs: 90000 });
      const out = r.stdout || '';
      const gv = (k) => (out.match(new RegExp(`${k}=([^\\n]*)`)) || [])[1]?.trim();
      let recentErrors = [];
      const errSection = out.match(/===ERRORS===([\s\S]*?)===ENDERRORS===/);
      if (errSection && errSection[1]) {
        recentErrors = errSection[1].trim().split('\n').filter(Boolean);
      }
      return NextResponse.json({
        success: true,
        alive: gv('ALIVE') === '1',
        uptimeSec: Number(gv('UPTIME_SEC') || 0),
        telegram: gv('TG') || 'unknown',
        errorCount: Number(gv('ERRCOUNT') || 0),
        recentErrors,
      });
    }

    // ── CONFIG BACKUPS — list & restore ─────────────────────────────────────
    if (action === 'backups') {
      const r = await execCommand(sshConfig,
        `ls -1t "$HOME/.hermes"/config.yaml.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const name = String(config.name || '');
      if (!/^config\\.yaml\\.bak-[0-9]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "$HOME/.hermes/${name}" ] && cp "$HOME/.hermes/${name}" "$HOME/.hermes/config.yaml" && echo RESTORED || echo NOT_FOUND`,
        { pool: false, timeoutMs: 30000 });
      const ok = /RESTORED/.test(r.stdout || '');
      let gwOk = false;
      if (ok) { const g = await gwCtl('restart'); gwOk = g.ok; }
      return NextResponse.json({ success: ok && gwOk, restarted: gwOk, error: ok ? (gwOk ? null : 'restored but gateway did not start') : 'Backup file not found' });
    }

    if (action === 'skills') {
      const op = config.op;
      const binR = await execCommand(sshConfig,
        `p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes)"; [ -z "$p" ] && [ -x "$HOME/.local/bin/hermes" ] && p="$HOME/.local/bin/hermes"; echo "BIN=$p"`,
        { pool: false, timeoutMs: 15000 });
      const rb = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!rb) return NextResponse.json({ success: false, error: 'hermes binary not found' }, { status: 400 });

      if (op === 'remove') {
        const name = String(config.name || '');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill name' }, { status: 400 });
        }
        const r = await execCommand(sshConfig,
          `rm -rf "$HOME/.hermes/skills/${name}" && echo SKILL_REMOVED`,
          { pool: false, timeoutMs: 30000 });
        return NextResponse.json({ success: (r.stdout || '').includes('SKILL_REMOVED'), log: [r.stdout || r.stderr] });
      }
      if (op === 'install' || op === 'opt-out' || op === 'opt-in' || op === 'reset') {
        let cmd;
        if (op === 'install') {
          const id = String(config.id || '').trim();
          if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(id)) {
            return NextResponse.json({ success: false, error: 'Invalid skill id' }, { status: 400 });
          }
          cmd = `${rb} skills install '${id}' --force --yes 2>&1 || ${rb} skills install '${id}' 2>&1`;
        } else if (op === 'reset') {
          cmd = `${rb} skills reset '${String(config.name || '')}' --restore --yes 2>&1`;
        } else {
          cmd = `${rb} skills ${op}${op === 'opt-in' ? ' --sync' : ''} 2>&1`;
        }
        const r = await execCommand(sshConfig, `${cmd}; echo OP_DONE`, { pool: false, timeoutMs: 180000 });
        return NextResponse.json({
          success: (r.stdout || '').includes('OP_DONE'),
          output: ((r.stdout || '') + (r.stderr || '')).slice(-3000),
        });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    if (action === 'gateway') {
      const gwOp = ['start', 'stop', 'restart'].includes(config.op) ? config.op : 'status';
      const g = await gwCtl(gwOp);
      if (!g.ok && gwOp === 'status') {
        return NextResponse.json({ success: false, error: g.out });
      }
      let extra = {};
      if (gwOp !== 'status') {
        const st = await gwCtl('status');
        extra = { active: st.active };
      } else {
        extra = { active: !!g.active };
      }
      return NextResponse.json({ success: true, op: gwOp, output: g.out || (g.active ? 'gateway process active' : ''), ...extra });
    }

    // ── INSTALL ─────────────────────────────────────────────────────────────
    if (action !== 'install') {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    const method = ['auto', 'system', 'user', 'nohup'].includes(config.method) ? config.method : 'auto';
    const skipBrowser = config.skipBrowser !== false; // default: headless-safe

    // ── 0. Docker-isolated target ────────────────────────────────────────────
    // Spin up a disposable distro container and run every subsequent step inside
    // it via `docker exec … sh -s` heredocs. Agent data persists on the host at
    // ~/.hermes-docker (bind-mounted to /root/.hermes), and the container is
    // restarted automatically by the Docker daemon (--restart unless-stopped).
    const DOCKER_IMAGES = {
      ubuntu: 'ubuntu:24.04', debian: 'debian:12', alma: 'almalinux:9', rocky: 'rockylinux:9',
      centos: 'quay.io/centos/centos:stream9',
      fedora: 'fedora:40', arch: 'archlinux:base', leap: 'opensuse/leap:15',
    };
    let dockerImage = null;
    if (config.docker?.enabled) {
      dockerImage = DOCKER_IMAGES[config.docker.image] || null;
      if (!dockerImage) {
        return NextResponse.json({ success: false, error: `Unknown distro: ${config.docker.image}. Choose one of: ${Object.keys(DOCKER_IMAGES).join(', ')}` }, { status: 400 });
      }
    }

    // 1. Probe HOST (docker availability lives here, not inside the container)
    const hostProbe = await run('host probe', STATUS_SCRIPT);

    if (config.docker?.enabled) {
      if (hp('DOCKER') !== '1') {
        return NextResponse.json({ success: false, error: 'Docker is not available on the selected server — choose "directly on server" or install Docker first.', log });
      }
      await run(`start isolated container (${dockerImage})`, `
        docker rm -f hermes-agent >/dev/null 2>&1 || true
        mkdir -p "$HOME/.hermes-docker"
        docker run -d --name hermes-agent --restart unless-stopped \\
          -v "$HOME/.hermes-docker:/root/.hermes" \\
          ${dockerImage} sleep infinity
        sleep 1
        docker exec hermes-agent true && echo CONTAINER_READY`, { timeoutMs: 300000 });
      if (!/CONTAINER_READY/.test(log.join('\n').split('$ start isolated container').pop() || '')) {
        return NextResponse.json({ success: false, error: `Failed to start the ${dockerImage} container (often disk space on the server). See log.`, log });
      }
      dockerWrap = (c) => `docker exec -i hermes-agent sh -s <<'HEOF'\n${c}\nHEOF`;
    }
    const wrap = (c) => (dockerWrap ? dockerWrap(c) : c);
    const dockerMode = !!dockerWrap;

    // 1b. Probe TARGET (inside container when docker-isolated, else the host)
    const probeR = await execCommand(sshConfig, wrap(STATUS_SCRIPT), { pool: false, timeoutMs: 60000 });
    const p = (k) => (probeR.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
    const hasSystemd = p('SYSTEMD') === '1';
    const hasSudo = p('SUDO') === '1';

    // 2. Best-effort prerequisites (git/curl/xz/libatomic) when missing + sudo available.
    // NOTE: only request packages that are actually missing — e.g. Alma/RHEL ship
    // curl-minimal which CONFLICTS with a full curl install and aborts dnf.
    // libatomic is required by the Hermes-managed Node.js binary (minimal
    // containers ship without it and the official installer fails silently).
    // A C++ toolchain is required by native Node modules (node-pty).
    const atomicMissing = p('ATOMIC') !== '1';
    const cxxMissing = p('CXX') !== '1';
    const tarMissing = p('TAR') !== '1'; // installer unpacks uv/node with tar
    if (p('GIT') === 'NONE' || p('CURL') !== '1' || p('XZ') !== '1' || atomicMissing || cxxMissing || tarMissing) {
      const base = [['git', p('GIT') === 'NONE'], ['curl', p('CURL') !== '1'], ['xz', p('XZ') !== '1'], ['tar', tarMissing]]
        .filter(x => x[1]).map(x => x[0]);
      const mk = (extra) => base.concat(extra.filter(Boolean)).join(' ');
      const aptPkgs = mk(['xz-utils', 'gzip', atomicMissing && 'libatomic1', cxxMissing && 'build-essential', 'procps']);
      const apkPkgs = mk(['gzip', atomicMissing && 'libatomic', cxxMissing && 'g++ make', 'procps']);
      const rpmPkgs = mk(['gzip', atomicMissing && 'libatomic', cxxMissing && 'gcc-c++ make', 'procps-ng']);
      const zyppPkgs = mk(['gzip', atomicMissing && 'libatomic1', cxxMissing && 'gcc-c++ make', 'procps']);
      const pacPkgs = mk(['libatomic', cxxMissing && 'base-devel', 'procps']);
      // Ship as detached base64 script — immune to quoting issues, SSH drops,
      // and stdin-consuming package managers (zypper).
      const innerChain = [
        'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"',
        'export DEBIAN_FRONTEND=noninteractive',
        `S="${hasSudo ? 'sudo -n' : ''}"`,
        `(command -v apt-get >/dev/null 2>&1 && $S apt-get update -qq 2>/dev/null; $S apt-get install -y ${aptPkgs}) < /dev/null ||`,
        `(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache ${apkPkgs}) < /dev/null ||`,
        `(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing ${rpmPkgs}) < /dev/null ||`,
        `(command -v yum    >/dev/null 2>&1 && $S yum install -y ${rpmPkgs}) < /dev/null ||`,
        `(command -v zypper >/dev/null 2>&1 && { sed -i 's|^gpgcheck.*|gpgcheck = 0|' /etc/zypp/zypp.conf 2>/dev/null || echo 'gpgcheck = 0' >> /etc/zypp/zypp.conf; } && $S zypper --non-interactive --no-gpg-checks install ${zyppPkgs} && { command -v pip3 >/dev/null 2>&1 && $S pip3 install -q uv 2>/dev/null || true; }) < /dev/null ||`,
        `(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed git curl xz libatomic make) < /dev/null ||`,
        'echo PREREQ_SKIPPED',
        'touch /tmp/.prereq-done',
      ].join('\n');
      await run(`install prerequisites (${aptPkgs || rpmPkgs})`, `
        rm -f /tmp/.prereq-done
        echo '${b64(innerChain)}' | base64 -d > /tmp/prereq.sh
        nohup sh /tmp/prereq.sh > /tmp/prereq.log 2>&1 < /dev/null &
        sleep 1
        test -f /tmp/prereq.log && echo BG_PREREQ_STARTED`, { timeoutMs: 60000 });
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 15000));
        const st = await execCommand(sshConfig, wrap('test -f /tmp/.prereq-done && echo DONE || echo PENDING'), { pool: false, timeoutMs: 20000 });
        if (/DONE/.test(st.stdout || '')) break;
      }
    }

    // 3. Official installer — non-interactive, skips setup wizard & heavy extras.
    // Lightweight mode: --no-skills stops ~90 bundled skills from being seeded,
    // which dramatically cuts system-prompt size and token usage per message.
    const flags = ['--non-interactive', '--skip-setup', ...(skipBrowser ? ['--skip-browser'] : []), ...(config.lightweight ? ['--no-skills'] : [])].join(' ');
    // Runs DETACHED on the host (setsid+nohup into a temp log) so no SSH
    // channel is held open for the whole build; lines stream into the job log.
    {
      let streamed = 0;
      const instR = await execDetached(sshConfig,
        `curl -fsSL ${INSTALLER_URL} | bash -s -- ${flags} 2>&1`,
        {
          pollMs: 3000,
          timeoutMs: 900000, // up to 15 min — builds Python venv, downloads Node etc.
          onLine: (ln) => { if (++streamed <= 400) log.push(ln); },
        });
      log.push(`$ official installer (${flags})${instR.code !== 0 ? ` — exited ${instR.code}` : ' — finished'}${streamed > 400 ? ` (${streamed} lines total)` : ''}${instR.stderr ? `\n${instR.stderr.slice(0, 300)}` : ''}`);
    }

    // 3b. Recovery — if the installer aborted late (e.g. OOM-killed while building
    // optional browser-tools npm deps on small servers) but the Python venv was
    // already created, create the hermes launcher symlink ourselves.
    await run('launcher recovery check', `
      p="$(export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; command -v hermes 2>/dev/null)"
      [ -n "$p" ] && echo LAUNCHER_PRESENT && exit 0
      for v in "$HOME/.hermes/hermes-agent/venv/bin/hermes" /usr/local/lib/hermes-agent/venv/bin/hermes /usr/local/lib/hermes-agent/hermes; do
        [ -x "$v" ] || continue
        mkdir -p "$HOME/.local/bin"
        ln -sf "$v" /usr/local/bin/hermes 2>/dev/null || ln -sf "$v" "$HOME/.local/bin/hermes"
        echo "LAUNCHER_RECOVERED from $v"
        break
      done`);

    const binCheck = await execCommand(sshConfig, wrap(
      `export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; p="$(command -v hermes 2>/dev/null)"; [ -z "$p" ] && [ -x "$HOME/.local/bin/hermes" ] && p="$HOME/.local/bin/hermes"; [ -n "$p" ] && echo "BIN=$p" || echo BIN_MISSING`),
      { pool: false, timeoutMs: 15000 });
    const remoteBin = (binCheck.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
    if (!remoteBin) {
      return NextResponse.json({ success: false, error: 'Installer finished but the hermes binary was not found (~/.local/bin/hermes or /usr/local/bin/hermes). See log output.', log });
    }
    const HB = JSON.stringify(remoteBin); // shell-quoted absolute path (root FHS installs → /usr/local/bin/hermes)
    const BIN_DIR = String(remoteBin).replace(/\/hermes$/, '');
    const ENVPREFIX = `export PATH="${BIN_DIR}:$HOME/.local/bin:$PATH"; export XDG_RUNTIME_DIR="/run/user/$(id -u)"`;

    // 4. Merge secrets into ~/.hermes/.env (never clobbers existing keys)
    const envEntries = Object.entries(config.env || {}).filter(([k, v]) => k && v != null && String(v).trim() !== '');
    if (envEntries.length > 0) {
      const envBlock = envEntries.map(([k, v]) => `${k}=${String(v).trim()}`).join('\n');
      // NOTE: trailing newline is REQUIRED — `while read` drops an unterminated
    // final line, which silently lost the last .env key.
    const envPayload = envBlock.endsWith('\n') ? envBlock : envBlock + '\n';
    await run(`write ${envEntries.length} key(s) to ~/.hermes/.env`, `
        mkdir -p "$HOME/.hermes" && touch "$HOME/.hermes/.env"
        echo '${b64(envPayload)}' | base64 -d > /tmp/.hermes-env-merge
        while IFS= read -r line; do
          case "$line" in ''|'#'*) continue ;; esac
          k=\${line%%=*}
          # NOTE: awk prefix match — grep BRE \$\\{k\\} would be an invalid interval
          # expression on GNU grep and silently truncate the whole .env file.
          awk -v pre="$k=" 'index(\$0, pre) != 1' "\$HOME/.hermes/.env" > "\$HOME/.hermes/.env.tmp"
          mv "\$HOME/.hermes/.env.tmp" "\$HOME/.hermes/.env"
          printf '%s\n' "\$line" >> "\$HOME/.hermes/.env"
        done < /tmp/.hermes-env-merge
        rm -f /tmp/.hermes-env-merge
        chmod 600 "$HOME/.hermes/.env"
        echo ENV_MERGED`, { timeoutMs: 30000 });
    }

    // 5. Apply config.yaml settings via the official CLI (handles dotted keys)
    const settingsEntries = Object.entries(config.settings || {}).filter(([, v]) => v != null && String(v).trim() !== '');
    // Lightweight defaults: keep auxiliary fallbacks on :free SKUs only so
    // compression/summarization calls never burn paid tokens behind the scenes.
    if (config.lightweight && !settingsEntries.some(([k]) => k === 'auxiliary.free_only')) {
      settingsEntries.push(['auxiliary.free_only', 'true']);
    }
    for (const [key, value] of settingsEntries) {
      await run(`hermes config set ${key}`,
        `${ENVPREFIX}; ${HB} config set ${key} ${JSON.stringify(String(value))} 2>&1 | tail -2`,
        { timeoutMs: 60000 });
    }

    // 6. Gateway service (system > user+linger > nohup)
    let startMethod = method;
    if (startMethod === 'auto') startMethod = hasSystemd ? (hasSudo ? 'system' : 'user') : 'nohup';

    let svcOk = false;
    if (startMethod === 'system' && hasSystemd) {
      const S = hasSudo ? 'sudo -n -E' : '';
      const r = await run('install boot-time system service',
        `${ENVPREFIX}; $S ${HB} gateway install --system 2>&1 | tail -6; $S ${HB} gateway start --system 2>&1 | tail -3; echo SVC_DONE`,
        { timeoutMs: 120000 });
      svcOk = (r.stdout || '').includes('SVC_DONE');
      if (!svcOk) log.push('system service failed — falling back to user service');
    }
    if (!svcOk && (startMethod === 'user' || (startMethod === 'system' && hasSystemd)) && hasSystemd) {
      const r = await run('install user service + enable lingering',
        `${ENVPREFIX}; ${HB} gateway install 2>&1 | tail -5; ${HB} gateway start 2>&1 | tail -3; ${hasSudo ? `sudo -n loginctl enable-linger "$(id -un)" 2>/dev/null;` : ''} echo SVC_DONE`,
        { timeoutMs: 120000 });
      svcOk = (r.stdout || '').includes('SVC_DONE');
      if (!svcOk) log.push('user service failed — falling back to nohup');
    }
    if (!svcOk) {
      await run('start gateway (nohup)',
        `${ENVPREFIX}; mkdir -p "$HOME/.hermes/logs"; nohup ${HB} gateway >> "$HOME/.hermes/logs/gatew""ay-nohup.log" 2>&1 & echo NOHUP_PID=$!`,
        { timeoutMs: 30000 });
    }

    // 7. Verify (inside the container for docker installs)
    await new Promise(res => setTimeout(res, 4000));
    const verify = await execCommand(sshConfig, wrap(STATUS_SCRIPT), { pool: false, timeoutMs: 60000 });
    const vp = (k) => (verify.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
    const running = dockerMode
      ? vp('PROC') === '1'
      : vp('SSVC') === '1' || vp('USVC') === '1' || vp('PROC') === '1';

    return NextResponse.json({
      success: running,
      running,
      startMethod: dockerMode ? 'docker' : startMethod,
      docker: dockerMode ? { image: dockerImage, name: 'hermes-agent', dataDir: '~/.hermes-docker' } : undefined,
      version: vp('VERSION'),
      error: running ? null : 'Gateway did not stay running. Check ~/.hermes/logs/ on the server — most often the LLM API key or messenger token needs attention.',
      log,
    });
  } catch (e) {
    logger.error('[hermes-install] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
