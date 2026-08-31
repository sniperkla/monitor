import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';
import { parseInst, homeDir, instancePort, listInstances, cloneDefaultHome, pidAlive, gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl, copyInstanceBin } from '../_multi-instance';

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

    // -- Multi-instance support (hermes blueprint) --
    const inst = parseInst(body);
    const HH = homeDir('nanobot', inst);        // ${HH} or ${HH}-<tag>
    const GW_PORT = instancePort('nanobot', inst);          // distinct port for instances (null for default)
    const PIDF = `${HH}/daemon.pid`;

    const binPath = () => `p="${HH}/venv/bin/nanobot"; [ ! -x "$p" ] && p="$(export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:/usr/bin:$PATH"; command -v nanobot 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`;

    const gwCtl = async (op) => {
      // Instances first: per-instance systemd template unit (own cgroup +
      // supervision + hardening). Falls through to legacy nohup path on any
      // failure / missing systemd user session. Default keeps exact behavior.
      if (inst && (await sdAvailable(sshConfig))) {
        await writeInstanceEnv(sshConfig, HH, { NB_PORT: GW_PORT });
        await ensureInstanceUnit(sshConfig, 'nanobot', gatewayUnit('nanobot', {
          description: 'Nanobot gateway',
          envLines: [
            'EnvironmentFile=-%h/.nanobot-%i/.env',
            `EnvironmentFile=%h/.nanobot-%i/instance.env`,
            'Environment=PATH=%h/.local/bin:%h/.nanobot/venv/bin:/usr/local/bin:/usr/bin:/bin',
          ],
          execStart: `/bin/sh -c 'exec "$([ -x %h/.nanobot-%i/venv/bin/nanobot ] && echo %h/.nanobot-%i/venv/bin/nanobot || echo %h/.local/bin/nanobot)" gateway --config %h/.nanobot-%i/config.json --workspace %h/.nanobot-%i/workspace --port "$NB_PORT"'`,
          logFile: '%h/.nanobot-%i/logs/gateway.log',
        }));
        const sd = await sdInstanceCtl(sshConfig, 'nanobot', inst, op);
        if (sd) return sd;
      }
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'nanobot binary not found' };
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;
      // Instance-aware launch: explicit config/workspace/port so multiple
      // gateways on the same server never share a data dir or bind port.
      const GW_FLAGS = inst
        ? ` --config "${HH}/config.json" --workspace "${HH}/workspace"${GW_PORT ? ` --port ${GW_PORT}` : ''}`
        : '';
      const pidScan = `${ENVX}; res=0; if [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null; then res=1; fi; if [ "$res" = 0 ]; then pgrep -f "nanobot gateway --config ${HH}/config.json" >/dev/null 2>&1 && res=1; fi; echo "PROC=$res"`;
      if (op === 'status') {
        const r = await execCommand(sshConfig, pidScan, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /PROC=1/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        return execCommand(sshConfig,
          `${ENVX}; if [ -f "${PIDF}" ]; then kill $(cat "${PIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${PIDF}") 2>/dev/null; fi; rm -f "${PIDF}"; echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 })
          .then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      if (op === 'restart') await gwCtl('stop');
      const startCmd = `${ENVX}; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; mkdir -p "${HH}/logs" "${HH}/workspace"; setsid nohup ${BP} gateway${GW_FLAGS} >> "${HH}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${PIDF}"; sleep 4; if kill -0 $(cat "${PIDF}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; fi`;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 90000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) }));
    };

    // ── STATUS ──
    if (action === 'status') {
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: true, timeoutMs: 30000 });
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

    // ── INSTANCES — list every installed nanobot home + running state ───────
    if (action === 'instances') {
      const list = await listInstances(sshConfig, 'nanobot');
      return NextResponse.json({ success: true, instances: list });
    }

    // ── SPAWN-INSTANCE — clone the default install's data dir & start ──────
    if (action === 'spawn-instance') {
      const tag = String((config && config.tag) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (!tag) return NextResponse.json({ success: false, error: 'Instance tag is required' }, { status: 400 });
      const clone = await cloneDefaultHome(sshConfig, 'nanobot', tag, [
        'config.json', '.env', 'workspace/config.json', 'workspace/PROMPT.md', 'workspace/SOUL.md',
        'workspace/IDENTITY.md', 'workspace/USER.md', 'workspace/AGENTS.md', 'workspace/MEMORY.md',
        'prompt.txt', 'workspace/custom_instructions.md',
      ]);
      if (!clone.ok) {
        return NextResponse.json({ success: false, error: 'Failed to clone nanobot instance home' });
      }
      // Per-instance WebSocket/WebUI port: nanobot binds channels.websocket on a
      // FIXED default (8765) — instances would collide. Inject a distinct port
      // right after the clone so the very first start is collision-free.
      if (GW_PORT) {
        await execCommand(sshConfig, `python3 - << 'PY'
import json, os
p = os.path.expanduser('${HH}/config.json')
try:
    d = json.load(open(p))
except Exception:
    d = {}
d.setdefault('channels', {})['websocket'] = { 'enabled': True, 'port': ${GW_PORT + 1} }
json.dump(d, open(p, 'w'), indent=2)
print('WS_PORT_INJECTED')
PY`, { pool: false, timeoutMs: 30000 });
      }
      // Copy the nanobot venv tree into the instance home so it runs its OWN
      // binary (zeroclaw-style) — uninstalling the default won't break it.
      let binCopy = null;
      if (!clone.existed) {
        const cp = await copyInstanceBin(sshConfig, 'nanobot', tag, HH);
        binCopy = cp.err || (cp.copied ? 'own binary copied' : cp.already ? 'own binary already present' : 'no source to copy');
      }
      const g = await gwCtl('start');
      return NextResponse.json({
        success: true,
        instance: tag,
        existed: clone.existed,
        started: g.ok,
        output: clone.existed
          ? `Instance "${tag}" already existed — gateway ${g.ok ? 'running' : 'not started'}.`
          : `Instance "${tag}" spawned and ${g.ok ? 'running' : 'failed to start'}. ${binCopy}. Remember: give it its OWN bot token (reconfigure → env) so instances don't fight over the same Telegram bot.`,
      });
    }

    // ── DETAILS ──
    if (action === 'details') {
      const D = `
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${HH}/config.json" 2>/dev/null || true
echo "===SKILLS==="
[ -d "${HH}/workspace/skills" ] && ls -1 "${HH}/workspace/skills" 2>/dev/null | grep -v '^\.' || true
echo "===PLUGINS==="
[ -n "$BIN" ] && "$BIN" plugins list 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "${HH}/workspace/PROMPT.md" || base64 < "${HH}/prompt.txt" || base64 < "${HH}/workspace/custom_instructions.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${HH}/workspace/SOUL.md" || base64 < "${HH}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "${HH}/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${HH}/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${HH}/workspace/MEMORY.md" || base64 < "${HH}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1
if [ "$res" = 0 ] && [ -n "${inst}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active nanobot-gatew""ay@${inst} 2>/dev/null | grep -qx active && res=1
fi
if [ "$res" = 0 ]; then
  pgrep -f "nanobot gateway --config ${HH}/config.json" >/dev/null 2>&1 && res=1
fi
[ "$res" = 1 ] && echo PROC_ACTIVE || echo NO_PROC
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===LOG==="
LOG=""
for f in "${HH}/logs/gatew""ay.log" "${HH}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -n "$LOGLAST" ] || true
echo "===LOGFILE==="
LOG=""
for f in "${HH}/logs/gatew""ay.log" "${HH}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOG="$f" && break; done
[ -z "$LOG" ] && LOG="${HH}/logs/gatew""ay.log"
echo "$LOG"
tail -n 30 "$LOG" 2>/dev/null | tail -5
`;
      const r = await execCommand(sshConfig, D, { pool: true, timeoutMs: 60000 });
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
        const envR = await execCommand(sshConfig, `[ -f "${HH}/.env" ] && cat "${HH}/.env" 2>/dev/null || true`, { pool: true, timeoutMs: 15000 });
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
      let models = [];
      let activeModelPreset = null;
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
        // All configured model presets (provider+model pairs) — the UI offers a
        // switcher when more than one is configured.
        try {
          for (const [name, p] of Object.entries(c.modelPresets || {})) {
            models.push({ preset: name, provider: p.provider || null, model: p.model || null });
          }
          activeModelPreset = c.agents?.defaults?.modelPreset || Object.keys(c.modelPresets || {})[0] || null;
        } catch {}
      } catch {}
      envText = envText.trim();
      return NextResponse.json({
        success: true,
        installed: !!binR,
        version: sec('VERSION', 'BINPATH') || null,
        model,
        models,
        activeModelPreset,
        isNanobot: true,
        binPath: binR || null,
        running: /PROC_ACTIVE/.test(sec('RUNNING', 'VERSION')),
        recentLog: sec('LOG', 'LOGFILE').split('\n').slice(-5).join('\n'),
        configJson: configJson || '',
        envText: envText || '',
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

    // ── SET MODEL PRESET — switch which configured preset is active ──
    if (action === 'set-model-preset') {
      const preset = String(config.preset || config.modelPreset || '').trim();
      if (!preset) return NextResponse.json({ success: false, error: 'preset is required' }, { status: 400 });
      const r = await execCommand(sshConfig, `
P="${HH}/config.json"
python3 - "$P" "${preset}" <<'PYEOF'
import json, sys
path, preset = sys.argv[1], sys.argv[2]
data = json.load(open(path))
if preset not in data.get("modelPresets", {}):
    print(f"PRESET_NOT_FOUND {preset}")
    sys.exit(1)
d = data.setdefault("agents", {}).setdefault("defaults", {})
d["model_preset"] = preset
d["modelPreset"] = preset
json.dump(data, open(path, "w"), indent=2)
print("PRESET_SET", preset)
PYEOF
`, { pool: false, timeoutMs: 30000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      if (!/PRESET_SET/.test(out)) {
        return NextResponse.json({ success: false, error: out || 'Failed to set preset', log });
      }
      const g = await gwCtl('restart');
      return NextResponse.json({ success: true, activeModelPreset: preset, restarted: g.ok, output: out, log });
    }

    if (action === 'save-prompt') {
      const promptText = String(config.prompt || '');
      const fileName = config.file || 'PROMPT.md';
      const b64 = Buffer.from(promptText, 'utf8').toString('base64');
      let SCRIPT = `mkdir -p "${HH}/workspace"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/SOUL.md"\necho "${b64}" | base64 -d > "${HH}/workspace/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/PROMPT.md"\necho "${b64}" | base64 -d > "${HH}/prompt.txt"\necho "${b64}" | base64 -d > "${HH}/workspace/custom_instructions.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── UNINSTALL ──
    if (action === 'uninstall') {
      // Instance uninstall must never kill other instances or remove the
      // shared binary — only its own pidfile & home.
      if (inst) {
        // Disable the template unit before removing its home, otherwise systemd
        // restarts can recreate the directory and leave a stopped dropdown entry.
        await sdInstanceCtl(sshConfig, 'nanobot', inst, 'stop');
      }
      const stopCmd = inst
        ? `if [ -f "${PIDF}" ]; then p=$(cat "${PIDF}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${PIDF}"; fi; true`
        // Selective kill: only default (no per-instance --config home). Never kill
        // instance gateways so they survive a default stop/uninstall.
        : `for p in $(pgrep -f '[n]anobot' 2>/dev/null); do grep -qaE -- '--config ${HOME}/.nanobot?-' /proc/$p/cmdline 2>/dev/null || grep -qa -- '-.nanobot-' /proc/$p/cmdline 2>/dev/null || kill -9 $p 2>/dev/null; done; true`;
      await run('stop gateway', stopCmd);
      // Share the globally-installed binary/venv. Removing while any instance
      // exists breaks restart for those instances — skip when siblings remain.
      let instancesRemain = false;
      if (!inst) {
        try {
          const instList = await listInstances(sshConfig, 'nanobot');
          instancesRemain = Array.isArray(instList) && instList.length > 0;
        } catch { /* non-fatal */ }
      }
      const binRm = (inst || instancesRemain)
        ? '' // instances share the globally-installed binary — leave it alone
        : `rm -f "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" /usr/local/bin/nanobot /usr/bin/nanobot 2>/dev/null; pipx uninstall nanobot-ai 2>/dev/null; pipx uninstall nanobot 2>/dev/null; `;
      const rmCmd = inst
        ? `rm -rf "${HH}" 2>/dev/null; [ ! -e "${HH}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`   // instances: always remove the whole isolated home
        : purge
          // Only this install's home. Previously `/home/*/.nanobot` was also
          // removed, which as root wiped EVERY user's agent home (including
          // provisioned "friend" users). zeroclaw scopes purge to ${HH} too.
          ? `for p in $(pgrep -f '[n]anobot' 2>/dev/null); do grep -qaE -- '-.nanobot-' /proc/$p/cmdline 2>/dev/null && kill -9 $p 2>/dev/null; done; rm -rf "$HOME/.nanobot-"* 2>/dev/null; ${binRm}rm -rf "${HH}" "$HOME/.cache/nanobot" /tmp/.nb* 2>/dev/null; echo REMOVED_ALL`
          : `${binRm}rm -rf "$HOME/.nanobot/venv" "$HOME/.cache/nanobot" "${HH}/logs" 2>/dev/null; echo REMOVED_CODE`;
      const r = await run(inst ? 'remove instance (isolated home)' : purge ? 'remove nanobot binary & all data' : 'remove nanobot binary & venv (config kept)', `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; ${rmCmd}`);
      const ok = /REMOVED/.test(r.stdout || '');
      return NextResponse.json({ success: ok, purged: purge, output: (r.stdout || '').slice(-500), log });
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
          (command -v apk    >/dev/null 2>&1 && $S apk add --no-cache python3 py3-pip py3-virtualenv) < /dev/null ||
          echo PYTHON_PREREQ_SKIPPED`, { timeoutMs: 300000 });
      }
      // always make sure the venv module is present (Debian/Ubuntu split it into python3-venv)
      // and that the venv's python can bootstrap pip (PEP 668). The HKUDS installer creates
      // ~/.nanobot/venv and runs ensurepip — without python3-venv this silently fails.
      await run('ensure python3-venv + pip', `
        export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
        S="${hasSudo ? 'sudo -n' : ''}"
        (command -v apt-get >/dev/null 2>&1 && $S apt-get install -y python3-venv python3-pip python3-full 2>/dev/null) < /dev/null || true
        # -devel/headers + a compiler: the HKUDS installer builds wheels from
        # source on several platforms, which fails without them.
        (command -v dnf    >/dev/null 2>&1 && $S dnf install -y python3-pip python3-virtualenv python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v yum    >/dev/null 2>&1 && $S yum install -y python3-pip python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v zypper >/dev/null 2>&1 && $S zypper --non-interactive install python3-pip python3-virtualenv python3-devel gcc 2>/dev/null) < /dev/null || true
        (command -v apk    >/dev/null 2>&1 && $S apk add --no-cache py3-pip py3-virtualenv python3-dev gcc musl-dev 2>/dev/null) < /dev/null || true
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
      // resolveBin()/binFrom() were never defined anywhere in this module (and
      // are not imported), so every install died here with
      // `ReferenceError: resolveBin is not defined` -> HTTP 500. Reuse the
      // binPath() helper defined above and the same BIN= parse gwCtl already
      // uses at the top of this handler.
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const NB = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || null;
      if (!NB) return NextResponse.json({ success: false, error: 'Installer finished but nanobot binary was not found. See log.', log });
      const NBE = JSON.stringify(NB);

      // 4. Merge ~/.nanobot/config.json (deep-merge via python3, shipped as b64)
      const cfg = typeof config.configJson === 'object' && config.configJson ? config.configJson : {};
      const cfgB64 = b64(JSON.stringify(cfg));
      await run(`merge ${inst ? `~/.nanobot-${inst}` : '~/.nanobot'}/config.json`, [
        `export NB_HOME="${HH}"; mkdir -p "${HH}"`,
        `echo '${b64(JSON.stringify(cfg))}' | base64 -d > /tmp/.nb-new.json`,
        `cat > /tmp/.nb-merge.py <<'PYEOF'`,
        'import json, os, sys',
        "path = os.environ.get('NB_HOME') or os.path.expanduser('~/.nanobot/config.json')",
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
        `(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-new.json || cp /tmp/.nb-new.json "${HH}/config.json")`,
        'rm -f /tmp/.nb-new.json /tmp/.nb-merge.py',
        'echo NB_CFG_MERGED',
      ].join('\n'), { timeoutMs: 60000 });

      // 5. Enable telegram plugin when requested
      if ((config.plugins || []).includes('telegram')) {
        await run('enable telegram plugin', `PATH="$(dirname ${NBE}):$PATH" ${NBE} plugins enable telegram 2>&1 | tail -3 || true`, { timeoutMs: 120000 });
      }

      // 6. Start gateway detached
      await run('start gateway', [
        `mkdir -p "${HH}/logs" "${HH}/workspace"`,
        // Pass GW_FLAGS so a tagged instance starts on its own config/workspace/
        // port. Previously a bare `nanobot gateway` started the DEFAULT install
        // even when installing an instance. Also record the PID so gwCtl can
        // stop/restart this instance later.
        `setsid nohup ${NBE} gateway${GW_FLAGS} >> "${HH}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${PIDF}"`,
        'sleep 4',
        `if [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; fi`,
      ].join('\n'), { timeoutMs: 90000 });
      // Instance-scoped liveness: check our own pidfile rather than a global
      // pgrep, which would report the default install (or a sibling instance)
      // as up.
      const up = await execCommand(sshConfig, `if [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; fi`, { pool: false, timeoutMs: 30000 });
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
      const modelFromSettings = (config.settings && (config.settings.model || config.settings.default_model)) || env.MODEL || env.NANOBOT_MODEL || env.DEFAULT_MODEL || null;
      const providerName = Object.entries(env)
        .map(([k, v]) => ({ k, v, p: PROVIDER_FROM_KEY[k] }))
        .find(x => x.p && x.v);

      const newConfig = {};
      // Custom endpoint support: wizard sends OPENAI_BASE_URL / OPENAI_API_BASE.
      // Sink it into the provider block (nanobot custom/OpenAI-compatible base).
      const customBaseUrl = String(env.OPENAI_BASE_URL || env.OPENAI_API_BASE || '').trim();
      if (providerName) {
        const pcfg = { apiKey: providerName.v };
        // nanobot ProviderConfig uses snake_case `api_base` (see config/schema.py)
        if (providerName.p === 'custom' && customBaseUrl) pcfg.api_base = customBaseUrl;
        // Provide the chosen provider (plus any base URL). Reconfigure deep-merges
        // with the existing config, so also clear stale providers so the config
        // reflects what was submitted this time.
        newConfig.providers = { [providerName.p]: pcfg };
        if (modelFromSettings) {
          newConfig.modelPresets = { primary: { provider: providerName.p, model: modelFromSettings, maxTokens: 8192, contextWindowTokens: 65536 } };
          newConfig.agents = { defaults: { model_preset: 'primary', modelPreset: 'primary' } };
        }
      } else if (modelFromSettings) {
        newConfig.modelPresets = { primary: { model: modelFromSettings } };
      }
      // also pass custom base URL into the env sidecar so it survives (harmless on default)
      if (customBaseUrl) env.CUSTOM_LLM_BASE_URL = customBaseUrl;
      // Per-instance WebSocket/WebUI port: nanobot binds channels.websocket on a
      // FIXED default (8765) — two instances would collide on it. Give every
      // instance its own ws port derived from its gateway port.
      if (inst && GW_PORT) {
        newConfig.channels = newConfig.channels || {};
        newConfig.channels.websocket = { ...(newConfig.channels.websocket || {}), port: GW_PORT + 1 };
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

      // Write ALL env entries (LLM keys, base URLs, MODEL, messenger tokens, …)
      // into the instance .env — the Env tab reads from there, so anything the
      // user entered must survive here (previously only TELEGRAM_/LINE_/DISCORD_
      // keys landed, which lost custom endpoints like OPENAI_BASE_URL).
      const sidecarKeys = Object.entries(env).filter(([k, v]) => k && v != null && String(v).trim() !== '');
      const cfgB64 = b64(JSON.stringify(newConfig));
      const sidecarB64 = b64(sidecarKeys.map(([k, v]) => `${k}=${v}`).join('\n'));
      const w = await run(`merge ${inst ? `~/.nanobot-${inst}` : '~/.nanobot'}/config.json`, [
        `export NB_HOME="${HH}"; mkdir -p "${HH}"`,
        `echo '${cfgB64}' | base64 -d > /tmp/.nb-cfg-new.json`,
        sidecarKeys.length ? `echo '${sidecarB64}' | base64 -d > "${HH}/.env"; chmod 600 "${HH}/.env"` : 'true',
        `cat > /tmp/.nb-merge.py <<'PYEOF'
import json, os, sys
home = os.environ.get('NB_HOME') or os.path.expanduser('~/.nanobot')
p = home.rstrip('/') + '/config.json'
new = json.load(open(sys.argv[1]))
cur = {}
if os.path.exists(p):
    try: cur = json.load(open(p))
    except Exception: cur = {}
# Remember the previously active provider so a save that only changes MODEL
# (no new provider key) still keeps a valid provider reference.
old_active = cur.get('agents', {}).get('defaults', {}).get('model_preset') or cur.get('agents', {}).get('defaults', {}).get('modelPreset')
old_provider = cur.get('modelPresets', {}).get(old_active, {}).get('provider') if old_active else None
if not old_provider:
    old_provider = next(iter(cur.get('providers', {})), None)
# Replace (not deep-merge) the provider/model/agent sections so stale providers
# (e.g. openrouter) don't linger when the user switched to custom.
for k in ('providers', 'modelPresets', 'agents'):
    cur.pop(k, None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, new)
for pr in (cur.get('modelPresets') or {}).values():
    if isinstance(pr, dict) and not pr.get('provider') and old_provider:
        pr['provider'] = old_provider
json.dump(cur, open(p, 'w'), indent=2)
print('MERGED')
PYEOF`,
        `(command -v python3 >/dev/null 2>&1 && python3 /tmp/.nb-merge.py /tmp/.nb-cfg-new.json || cp /tmp/.nb-cfg-new.json "${HH}/config.json")`,
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
        cp "${HH}/config.json" "${HH}/config.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(jsonText)}' | base64 -d > "${HH}/config.json.new"
        mv "${HH}/config.json.new" "${HH}/config.json"
        echo CONFIG_SAVED`, { pool: false, timeoutMs: 30000 });
      let restarted = false;
      let rolledBack = false;
      if (config.restart) {
        const g = await gwCtl('restart');
        restarted = g.ok;
        if (!g.ok) {
          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "${HH}"/config.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${HH}/config.json" && echo ROLLED_BACK=$BAK || echo NO_BACKUP`,
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
        `ls -1t "${HH}"/config.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      // Accept either shape: nanobot/openclaw use `name`, zeroclaw reads
      // `config.backup`. A shared UI may send either — taking both keeps them
      // interchangeable. The regex below still guards against path traversal.
      const name = String(config.name || config.backup || '');
      // `\\.` in a REGEX LITERAL means "a literal backslash + any char", not a
      // dot — real backups are named config.json.bak-<epoch>, so this never
      // matched and restore-backup always returned 400.
      if (!/^config\.json\.bak-[0-9]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "${HH}/${name}" ] && cp "${HH}/${name}" "${HH}/config.json" && echo RESTORED || echo NOT_FOUND`,
        { pool: false, timeoutMs: 30000 });
      let restarted = false;
      if (/RESTORED/.test(r.stdout || '')) {
        const g = await gwCtl('restart');
        restarted = g.ok;
      }
      return NextResponse.json({ success: /RESTORED/.test(r.stdout || ''), restarted });
    }

    // ── PAIRING APPROVAL ──
    // nanobot has NO `pairing` CLI command — pairing lives in ~/.nanobot/pairing.json
    // ({ pending: {CODE:{channel,sender_id,expires_at}} , approved:{channel:[sender]}}).
    // Approve = move the code from `pending` → `approved[channel]`, matching the
    // runtime's own approve_code(). We edit the JSON directly via python.
    if (action === 'pairing-approve') {
      const platform = String(config.platform || 'auto').trim();
      const code = String(config.code || '').trim();
      if (!code) return NextResponse.json({ success: false, error: 'Pairing code is required' }, { status: 400 });
      const r = await execCommand(sshConfig, `
export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
P="${HH}/pairing.json"
BP="$( (command -v nanobot || which nanobot) 2>/dev/null || echo $HOME/.local/bin/nanobot )"
if [ ! -f "$P" ]; then echo NO_STORE; exit 0; fi
python3 - "$P" "${code}" <<'PYEOF'
import json, sys, os
path, code = sys.argv[1], sys.argv[2]
data = json.load(open(path))
pending = data.get("pending", {})
info = pending.pop(code, None)
if info is None:
    # try approved too (idempotent re-approve)
    for ch, users in data.get("approved", {}).items():
        if isinstance(users, list) and code in users:
            print("ALREADY_APPROVED", ch)
            sys.exit(0)
    print("CODE_NOT_FOUND")
    sys.exit(1)
channel = str(info.get("channel", "telegram"))
sender = str(info.get("sender_id", ""))
data.setdefault("approved", {}).setdefault(channel, [])
if sender and sender not in data["approved"][channel]:
    data["approved"][channel].append(sender)
json.dump(data, open(path, "w"), indent=2)
print("APPROVED", channel, sender)
PYEOF
      `, { pool: false, timeoutMs: 30000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const ok = /APPROVED|ALREADY_APPROVED/.test(out);
      return NextResponse.json({ success: ok, output: out || 'Pairing command executed', approved: /APPROVED/.test(out), log });
    }

    if (action === 'pairing-list') {
      const r = await execCommand(sshConfig, `
P="${HH}/pairing.json"
if [ ! -f "$P" ]; then echo NO_STORE; exit 0; fi
python3 - "$P" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
for code, info in data.get("pending", {}).items():
    print(f"PENDING {code} {info.get('channel','telegram')} {info.get('sender_id','')}")
for ch, users in data.get("approved", {}).items():
    for u in users:
        print(f"APPROVED {ch} {u}")
PYEOF
      `, { pool: false, timeoutMs: 20000 });
      const out = (r.stdout || '');
      const pending = [];
      for (const line of out.split('\n')) {
        const m = line.match(/^PENDING\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
        if (m) pending.push({ code: m[1], platform: m[2] || 'telegram', sender: m[3] || '' });
      }
      return NextResponse.json({ success: true, pending, raw: out.slice(-1000) });
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
for f in "${HH}/logs/gatew""ay.log" "${HH}-gatew""ay.log" "${HH}/logs/webui.log"; do
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
ALIVE=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && ALIVE=1
if [ "$ALIVE" = 0 ] && [ -n "${inst}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active nanobot-gatew""ay@${inst} 2>/dev/null | grep -qx active && ALIVE=1
fi
echo "ALIVE=$ALIVE"
PID=$(cat "${PIDF}" 2>/dev/null)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${HH}/logs/gatew""ay.log" "${HH}-gatew""ay.log"; do [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break; done
if [ -n "$LOGL" ]; then
  if tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
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
        await execCommand(sshConfig, `${ENVX}; ${BP} plugins disable ${JSON.stringify(name)} 2>/dev/null; rm -rf "${HH}/workspace/skills/${name}" 2>/dev/null; true`, { pool: false, timeoutMs: 30000 });
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
          await execCommand(sshConfig, `mkdir -p "${HH}/workspace/skills"; cd "${HH}/workspace/skills"; git clone --depth 1 "${id}" 2>/dev/null || (mkdir -p "${id.replace(/[^a-zA-Z0-9_-]/g, '_')}" && echo '# ${id}' > "${id.replace(/[^a-zA-Z0-9_-]/g, '_')}/SKILL.md")`, { pool: false, timeoutMs: 120000 });
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
