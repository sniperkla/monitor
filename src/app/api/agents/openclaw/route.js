import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';
import { parseInst, homeDir, instancePort, listInstances, cloneDefaultHome, pidAlive, gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl, copyInstanceBin } from '../_multi-instance';

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

    // -- Multi-instance support (hermes blueprint) --
    const inst = parseInst(body);
    const HH = homeDir('openclaw', inst);   // ${HH} or ${HH}-<tag>
    const GW_PORT = instancePort('openclaw', inst);         // distinct WebSocket port for instances
    const PIDF = `${HH}/daemon.pid`;
    const binPath = () => `p="${HH}/install/bin/openclaw"; [ ! -x "$p" ] && p="$(export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; command -v openclaw 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`;

    // ── Gateway control — pidfile-scoped; instances relocate via env vars ────
    const gwCtl = async (op) => {
      // Instances first: per-instance systemd template unit (own cgroup +
      // supervision + hardening). The DEFAULT install is handled by the block
      // immediately below, which drives the installer-created unit when one
      // exists. Both fall through to the legacy nohup path when systemd is
      // unavailable or does not know about the unit.
      if (inst && (await sdAvailable(sshConfig))) {
        await writeInstanceEnv(sshConfig, HH, { OC_PORT: GW_PORT });
        await ensureInstanceUnit(sshConfig, 'openclaw', gatewayUnit('openclaw', {
          description: 'OpenClaw gateway',
          envLines: [
            // Leading '-' marks the file optional. Without it systemd refuses
            // to start the unit when instance.env does not exist yet.
            `EnvironmentFile=-%h/.openclaw-%i/instance.env`,
            'EnvironmentFile=-%h/.openclaw-%i/.env',
            'Environment=OPENCLAW_STATE_DIR=%h/.openclaw-%i',
            'Environment=OPENCLAW_CONFIG_PATH=%h/.openclaw-%i/openclaw.json',
            'Environment=OPENCLAW_LOG_DIR=%h/.openclaw-%i/logs',
            'Environment=PATH=%h/.openclaw-%i/install/bin:%h/.openclaw/local/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin',
          ],
          execStart: `/bin/sh -c 'exec "$([ -x %h/.openclaw-%i/install/bin/openclaw ] && echo %h/.openclaw-%i/install/bin/openclaw || command -v openclaw || echo %h/.openclaw/local/bin/openclaw)" gatew''ay --port "$OC_PORT"'`,
          logFile: '%h/.openclaw-%i/logs/gateway.log',
        }));
        const sd = await sdInstanceCtl(sshConfig, 'openclaw', inst, op);
        if (sd) return sd;
      }

      // The DEFAULT install is supervised by the unit the official installer
      // creates. That branch above was instance-only, so the default install
      // always fell through to the nohup/pidfile path: `stop` killed a pidfile
      // PID that was never written (a silent no-op) and `restart` then started a
      // SECOND gateway onto a port systemd still held (EADDRINUSE). If the unit
      // actually exists, drive it through systemd instead.
      // NOTE: ${UNIT} carries the `gatew""ay` split, which the shell collapses
      // to `gateway`. It must stay inside DOUBLE quotes (or unquoted) — single
      // quotes would preserve the `""` literally and match nothing.
      if (!inst && (await sdAvailable(sshConfig))) {
        const probe = await execCommand(
          sshConfig,
          `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; ` +
          `systemctl --user list-unit-files "${UNIT}*" 2>/dev/null | grep -qi "${UNIT}" && echo UNIT_SCOPE=user; ` +
          `systemctl list-unit-files "${UNIT}*" 2>/dev/null | grep -qi "${UNIT}" && echo UNIT_SCOPE=system; ` +
          `echo PROBE_DONE`,
          { pool: false, timeoutMs: 15000 });
        const pout = probe.stdout || '';
        const scope = /UNIT_SCOPE=user/.test(pout) ? 'user' : /UNIT_SCOPE=system/.test(pout) ? 'system' : null;
        if (scope) {
          const ctl = scope === 'user' ? 'systemctl --user' : 'systemctl';
          const sudo = scope === 'system' ? 'sudo -n ' : '';
          const pre = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; `;
          const res = await execCommand(
            sshConfig,
            `${pre}${sudo}${ctl} ${op} ${UNIT} 2>&1 | tail -5; echo "SD_DONE";`,
            { pool: false, timeoutMs: 90000 });
          const o = (res.stdout || '') + (res.stderr || '');
          // Only trust systemd when it really acted on the unit; otherwise fall
          // through to the legacy nohup path below.
          if (/SD_DONE/.test(o) && !/Unknown|not-found|No such file/i.test(o)) {
            const act = await execCommand(
              sshConfig,
              `${pre}${sudo}${ctl} is-active ${UNIT} 2>/dev/null | grep -qx active && echo ACTIVE || echo INACTIVE`,
              { pool: false, timeoutMs: 15000 });
            return { ok: true, active: /ACTIVE/.test(act.stdout || ''), out: o.slice(-400) };
          }
        }
      }

      const binR = await execCommand(sshConfig, `${binPath()} ; echo "SYSTEMD=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`, { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'openclaw binary not found' };
      const sysd = /SYSTEMD=1/.test(binR.stdout || '');
      const BP = JSON.stringify(bp);
      // Instance-aware env: OPENCLAW_STATE_DIR + OPENCLAW_CONFIG_PATH relocate the
      // whole gateway data dir; --port gives each instance a distinct bind port.
      const OC_RELOC = inst
        ? `export OPENCLAW_STATE_DIR="${HH}"; export OPENCLAW_CONFIG_PATH="${HH}/openclaw.json"; export OPENCLAW_LOG_DIR="${HH}/logs"`
        : '';
      const OC_FLAGS = GW_PORT ? ` --port ${GW_PORT}` : '';
      const OC_LOGL = inst ? `"${HH}/logs/gateway.log"` : LOGL;
      // Build the env prefix from parts, joining with '; ' and dropping empties —
      // a trailing '; ' (empty OC_RELOC) combined with `${ENVX}; cmd` produced
      // `set +a; ; if` which bash rejects with a syntax error.
      const ENVX = [
        `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null`,
        `export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"`,
        `set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a`,
        OC_RELOC || null,
      ].filter(Boolean).join('; ');
      if (op === 'status') {
        const r = await execCommand(sshConfig, `${ENVX}; res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1; echo "PROC=$res"`, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /PROC=1/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        return execCommand(sshConfig,
          `${ENVX}; if [ -f "${PIDF}" ]; then kill $(cat "${PIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${PIDF}") 2>/dev/null; fi; rm -f "${PIDF}"; echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      // start / restart
      if (op === 'restart') await gwCtl('stop');
      const startCmd = `${ENVX}; mkdir -p "${HH}/logs"; setsid nohup ${BP} gateway${OC_FLAGS} >> ${OC_LOGL} 2>&1 < /dev/null & echo $! > "${PIDF}"; sleep 4; if kill -0 $(cat "${PIDF}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; tail -8 "${HH}/logs/gateway.log" 2>/dev/null; fi`;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 120000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-400) }));
    };

    // ── STATUS ──
    if (action === 'status') {
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: true, timeoutMs: 30000 });
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

    // ── INSTANCES — list every installed openclaw home + running state ──────
    if (action === 'instances') {
      const list = await listInstances(sshConfig, 'openclaw');
      return NextResponse.json({ success: true, instances: list });
    }

    // ── SPAWN-INSTANCE — clone the default install's data dir & start ──────
    if (action === 'spawn-instance') {
      const tag = String((config && config.tag) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (!tag) return NextResponse.json({ success: false, error: 'Instance tag is required' }, { status: 400 });
      const clone = await cloneDefaultHome(sshConfig, 'openclaw', tag, [
        'openclaw.json', '.env', 'workspace/PROMPT.md', 'workspace/SOUL.md', 'workspace/IDENTITY.md',
        'workspace/USER.md', 'workspace/AGENTS.md', 'workspace/MEMORY.md', 'prompt.txt', 'SYSTEM_PROMPT.md',
      ]);
      if (!clone.ok) {
        return NextResponse.json({ success: false, error: 'Failed to clone openclaw instance home' });
      }
      // Copy the openclaw binary bundle into the instance home so it runs its
      // OWN binary (zeroclaw-style) — uninstalling the default won't break it.
      let binCopy = null;
      if (!clone.existed) {
        const cp = await copyInstanceBin(sshConfig, 'openclaw', tag, HH);
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
export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
BIN="$(command -v openclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" "/usr/local/bin/openclaw" "/usr/bin/openclaw" "/usr/sbin/openclaw"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${HH}/openclaw.json" 2>/dev/null || true
echo "===RUNNING==="
res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1
if [ "$res" = 0 ] && [ -n "${inst}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active openclaw-gatew""ay@${inst} 2>/dev/null | grep -qx active && res=1
fi
echo "PROC=$res"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
[ -f "${HH}/openclaw.json" ] && grep -oE '"(defaultModel|model)"[[:space:]]*:[[:space:]]*"[^"]+"' "${HH}/openclaw.json" 2>/dev/null | head -1 | cut -d'"' -f4
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "${HH}/skills" ] && ls -1 "${HH}/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "${HH}/workspace/skills" ] && ls -1 "${HH}/workspace/skills" 2>/dev/null | grep -v '^\.' || true
echo "===SKILLSCLI==="
# OpenClaw bundles its own skill catalog (openclaw-bundled/extra) — list via CLI
[ -n "$BIN" ] && "$BIN" skills list 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "${HH}/workspace/PROMPT.md" || base64 < "${HH}/prompt.txt" || base64 < "${HH}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${HH}/workspace/SOUL.md" || base64 < "${HH}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
base64 < "${HH}/workspace/USER.md" 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${HH}/workspace/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${HH}/workspace/MEMORY.md" || base64 < "${HH}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
echo "===ENV_B64==="
base64 < "${HH}/.env" 2>/dev/null || true
echo "===ENVKEYS==="
[ -f "${HH}/.env" ] && grep -oE '^[A-Z_][A-Z0-9_]*' "${HH}/.env" 2>/dev/null | sort -u | head -50
`;
      const r = await execCommand(sshConfig, D, { pool: true, timeoutMs: 60000 });
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
      const skillsList = new Set(section('SKILLS', 'SKILLSCLI').split('\n').map(s => s.trim()).filter(Boolean));
      // Merge the bundled catalog from `openclaw skills list` (openclaw-bundled /
      // openclaw-extra sources). Table rows: │ status │ name │ desc │ source │ —
      // wrapped continuation rows have an empty status column and are skipped.
      const skillsCliRaw = section('SKILLSCLI', 'PROMPT_B64');
      for (const line of skillsCliRaw.split('\n')) {
        if (!line.includes('│')) continue;
        const parts = line.split('│').map(p => p.trim());
        if (parts.length < 4 || !parts[1] || !parts[2]) continue;
        if (parts[1] === 'Status') continue; // table header
        const nm = parts[2].replace(/^[^A-Za-z0-9]+/, '').trim();
        if (nm && /^[a-zA-Z0-9][\w.-]*$/.test(nm) && nm.toLowerCase() !== 'skill') skillsList.add(nm);
      }
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
        configJson: configJson || '',
        envText: envText || '',
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
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/workspace/PROMPT.md"\necho "${b64}" | base64 -d > "${HH}/prompt.txt"\necho "${b64}" | base64 -d > "${HH}/SYSTEM_PROMPT.md"\n`;
      }
      await execCommand(sshConfig, SCRIPT, { pool: false, timeoutMs: 30000 });
      if (config.restart !== false) {
        await gwCtl('restart');
      }
      return NextResponse.json({ success: true, file: fileName });
    }

    // ── UNINSTALL ──
    if (action === 'uninstall') {
      // Instance uninstall must NEVER touch shared resources (systemd unit,
      // broad pkill patterns, the shared binary) — only its own pidfile & home.
      if (inst) {
        // Disable the template unit before deleting its home. Otherwise its
        // Restart=on-failure policy recreates the directory after uninstall.
        await sdInstanceCtl(sshConfig, 'openclaw', inst, 'stop');
        await run('stop instance (pidfile-scoped)', `if [ -f "${PIDF}" ]; then p=$(cat "${PIDF}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${PIDF}"; fi; true`);
      } else {
        await run('stop system service', `(sudo -n systemctl disable --now ${UNIT} 2>/dev/null || systemctl disable --now ${UNIT} 2>/dev/null); true`);
        await run('stop user service', `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now ${UNIT} 2>/dev/null; true`);
        await run('stop stray processes', `pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; pkill -f '[o]penclaw gateway' 2>/dev/null; true`);
      }
      // Instances share the globally-installed binary. Removing it while any
      // instance still exists leaves those instances unable to ever restart, so
      // skip binary removal when siblings remain (zeroclaw guards this too).
      let instancesRemain = false;
      if (!inst) {
        try {
          const instList = await listInstances(sshConfig, 'openclaw');
          instancesRemain = Array.isArray(instList) && instList.filter(i => i.tag && i.tag !== inst).length > 0;
        } catch { /* non-fatal: fall through to the normal removal */ }
      }
      const binRm = (inst || (instancesRemain && !purge))
        ? '' // non-purge keeps the binary for surviving instances; purge wipes them first
        : `(npm -g rm openclaw 2>/dev/null || true); rm -f "$HOME/.openclaw/local/bin/openclaw" "$HOME/.local/bin/openclaw" /usr/local/bin/openclaw /usr/bin/openclaw /usr/sbin/openclaw; `;
      // Full purge of the DEFAULT also wipes every instance home (and kills
      // their daemons) so uninstall is genuinely clean — no orphan entries.
      const instWipe = (!inst && purge)
        ? `pkill -f '[o]penclaw.*gatew[a]y' 2>/dev/null; rm -rf "$HOME/.openclaw-"* 2>/dev/null; `
        : '';
      const rmCmd = inst
        ? `rm -rf "${HH}"; [ ! -e "${HH}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`   // instances: always remove the whole isolated home
        : purge
          ? `${instWipe}${binRm}rm -rf "${HH}"; echo REMOVED_ALL`
          : `${binRm}rm -rf "${HH}/local" "${HH}/logs"; echo REMOVED_CODE`;
      const r = await run(inst ? 'remove instance (isolated home)' : purge ? 'remove binary, code & all data' : 'remove binary & code (config kept)', rmCmd);
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
          mkdir -p "${HH}"
          [ -f "${HH}/openclaw.json" ] || echo '{}' > "${HH}/openclaw.json"
          cp "${HH}/openclaw.json" "${HH}/openclaw.json.bak-install"
          echo '${b64(json)}' | base64 -d > /tmp/oc-seed.json
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          # Drive the merge off ${HH} instead of the hardcoded default home —
          # otherwise installing a tagged instance rewrites the DEFAULT
          # install's openclaw.json rather than the new instance's.
          export OC_HOME="${HH}"
          node -e "const fs=require('fs');const p=process.env.OC_HOME+'/openclaw.json';const cur=JSON.parse(fs.readFileSync(p,'utf8'));const seed=JSON.parse(fs.readFileSync('/tmp/oc-seed.json','utf8'));const merged={...seed,...cur};merged.gateway={...seed.gateway,...(cur.gateway||{})};fs.writeFileSync(p,JSON.stringify(merged,null,2));console.log('CONFIG_SEED')"
          rm -f /tmp/oc-seed.json`,
          { timeoutMs: 30000 });
        const envEntries = Object.entries(config.env || {});
        if (envEntries.length > 0) {
          const envFile = envEntries.map(([k, v]) => `${k}=${v}`).join('\n');
          await run('write provider keys to ~/.openclaw/.env', `
            touch "${HH}/.env"
            echo '${b64(envFile)}' | base64 -d > /tmp/oc-env-seed
            # 'read -rk' parses as options -r AND -k; -k is not a valid read
            # option, so bash/dash error out and the loop body never runs —
            # provider keys were silently never written even though ENV_SEEDED
            # is echoed below. The space after -r is load-bearing.
            while IFS='=' read -r k; do
              k="\${k%%=*}"
              grep -q "^$\{k\}=" "${HH}/.env" && sed -i "s|^$\{k\}=.*|$k=$(grep "^$\{k\}=" /tmp/oc-env-seed | cut -d= -f2-)|" "${HH}/.env" || printf '%s\\n' "$(grep "^$\{k\}=" /tmp/oc-env-seed)" >> "${HH}/.env"
            done < /tmp/oc-env-seed
            rm -f /tmp/oc-env-seed
            echo ENV_SEEDED`, { timeoutMs: 30000 });
        }
      }

      // 3b. Persist the model + messenger token into openclaw.json on a FRESH
      // install (same as reconfigure). Without this the model/token land only
      // in .env and the gateway starts unconfigured.
      const envI = (config && config.env) || {};
      const settingsI = (config && config.settings) || {};
      const targetModelI = (settingsI.model || settingsI.default_model) || envI.MODEL || envI.OPENCLAW_MODEL || envI.DEFAULT_MODEL || '';
      if (targetModelI || envI.TELEGRAM_BOT_TOKEN) {
        const ocPatch = {};
        if (envI.TELEGRAM_BOT_TOKEN) {
          const allowFrom = String(envI.TELEGRAM_ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
          ocPatch.channels = { telegram: { enabled: true, botToken: envI.TELEGRAM_BOT_TOKEN, dmPolicy: 'allowlist', ...(allowFrom.length ? { allowFrom } : {}) } };
        }
        if (targetModelI) ocPatch.agents = { defaults: { model: targetModelI } };
        const setB64i = b64(JSON.stringify(ocPatch));
        await run('merge model + telegram into openclaw.json', `
          export OC_HOME="${HH}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
s = json.loads(base64.b64decode('${setB64i}').decode('utf8'))
cur.pop('defaultModel', None)
cur.pop('model', None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, s)
open(p, 'w').write(json.dumps(cur, indent=2))
print('MODEL_TG_MERGED')
" 2>&1 | tail -2`, { timeoutMs: 30000 });
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
for f in "${HH}/logs/gatew""ay.log" "${HH}/logs/"*.log /tmp/openclaw*.log; do
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
res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1
if [ "$res" = 0 ] && [ -n "${inst}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active openclaw-gatew""ay@${inst} 2>/dev/null | grep -qx active && res=1
fi
ALIVE=$res
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '18789${GW_PORT ? `|${GW_PORT}` : ''}') && PORT=1
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(cat "${PIDF}" 2>/dev/null)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${HH}/logs/gatew""ay.log" "${HH}/logs/"*.log /tmp/openclaw*.log; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
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
        `ls -1t "${HH}"/openclaw.json.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      // Accept either shape: openclaw/nanobot use `name`, zeroclaw reads
      // `config.backup`. A shared UI may send either — taking both keeps them
      // interchangeable. The regex below still guards against path traversal.
      const name = String(config.name || config.backup || '');
      if (!/^openclaw\.json\.bak-[A-Za-z0-9._-]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "${HH}/${name}" ] && cp "${HH}/${name}" "${HH}/openclaw.json" && echo RESTORED || echo NOT_FOUND`,
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
      // ── Custom OpenAI-compatible endpoint (wizard "Custom…" provider) ──
      // OpenClaw resolves OpenAI-compatible providers via env (OPENAI_API_KEY for
      // the credential + OPENAI_BASE_URL / LLM_API_BASE for the endpoint). Map
      // the wizard's custom fields so the endpoint is actually used.
      const customKey = String(env.CUSTOM_LLM_API_KEY || '').trim()
        || String(env.OPENAI_API_KEY || '').trim();
      const customBaseUrl = String(env.OPENAI_BASE_URL || env.OPENAI_API_BASE || '').trim();
      if (customKey && customBaseUrl) {
        env.OPENAI_API_KEY = customKey;
        env.OPENAI_BASE_URL = customBaseUrl;
        env.LLM_API_BASE = customBaseUrl; // common OpenClaw alias
        env.CUSTOM_LLM_API_KEY = customKey; // keep wizard's original
      }
      const envKeys = Object.keys(env).filter(k => env[k] != null && env[k] !== '');
      const hasSettings = Object.keys(settings).filter(k => settings[k] != null && settings[k] !== '').length > 0;
      if (envKeys.length === 0 && !hasSettings) {
        return NextResponse.json({ success: false, error: 'No settings or env keys to update' }, { status: 400 });
      }
      if (envKeys.length > 0) {
        const envLinesB64 = b64(envKeys.map(k => `${k}=${env[k]}`).join('\n'));
        // Python upsert: handles values containing '=' (e.g. base64 bot tokens)
        const envPy = [
          'import os, base64',
          `lines_raw = base64.b64decode('${envLinesB64}').decode('utf-8').splitlines()`,
          `ep = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/.env'`,
          `os.makedirs(os.path.dirname(ep), exist_ok=True)`,
          `existing = open(ep).read().splitlines() if os.path.exists(ep) else []`,
          `upsert = {}`,
          `for ln in lines_raw:`,
          `    idx = ln.find('=')`,
          `    if idx > 0: upsert[ln[:idx]] = ln[idx+1:]`,
          `result = []`,
          `keys_done = set()`,
          `for ln in existing:`,
          `    idx = ln.find('=')`,
          `    if idx > 0 and ln[:idx] in upsert:`,
          `        result.append(ln[:idx] + '=' + upsert[ln[:idx]])`,
          `        keys_done.add(ln[:idx])`,
          `    else:`,
          `        result.append(ln)`,
          `for k, v in upsert.items():`,
          `    if k not in keys_done: result.append(k + '=' + v)`,
          `open(ep, 'w').write('\\n'.join(result) + '\\n')`,
          `os.chmod(ep, 0o600)`,
          `print('ENV_UPDATED')`,
        ].join('\n');
        const envPyB64 = b64(envPy);
        const w = await run('write ~/.openclaw/.env', `export OC_HOME="${HH}"` + '; echo \'${envPyB64}\' | base64 -d | python3', { timeoutMs: 30000 });
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: 'Failed to write ~/.openclaw/.env', log });
        }
      }

      const targetModel = (hasSettings && (settings.model || settings.default_model)) || env.MODEL || env.OPENCLAW_MODEL || env.DEFAULT_MODEL || '';
      if (targetModel || env.TELEGRAM_BOT_TOKEN) {
        // OpenClaw 2026.x native schema (from `openclaw config schema`):
        //   - default model -> [agents.defaults].model   (root defaultModel/model keys are INVALID)
        //   - telegram -> [channels.telegram]: enabled, botToken, allowFrom, dmPolicy
        const ocPatch = {};
        if (env.TELEGRAM_BOT_TOKEN) {
          const allowFrom = String(env.TELEGRAM_ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
          ocPatch.channels = {
            telegram: {
              enabled: true,
              botToken: env.TELEGRAM_BOT_TOKEN,
              dmPolicy: 'allowlist',
              ...(allowFrom.length ? { allowFrom } : {}),
            },
          };
        }
        if (targetModel) {
          ocPatch.agents = { defaults: { model: targetModel } };
        }
        const setB64 = b64(JSON.stringify(ocPatch));
        await run('merge ~/.openclaw/openclaw.json settings', `
          export OC_HOME="${HH}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
s = json.loads(base64.b64decode('${setB64}').decode('utf8'))
# strip legacy root keys written by older monitor versions - they make the
# whole config fail schema validation ('<root>: Invalid input')
cur.pop('defaultModel', None)
cur.pop('model', None)
def dm(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): dm(a[k], v)
        else: a[k] = v
dm(cur, s)
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
        cp "${HH}/openclaw.json" "${HH}/openclaw.json.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(json)}' | base64 -d > "${HH}/openclaw.json.new"
        python3 -m json.tool "${HH}/openclaw.json.new" >/dev/null 2>&1 && { mv "${HH}/openclaw.json.new" "${HH}/openclaw.json"; echo CONFIG_SAVED; } || echo CONFIG_INVALID`,
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
            `BAK="$(ls -1t "${HH}"/openclaw.json.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${HH}/openclaw.json" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
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
          export OC_HOME="${HH}"
          python3 -c "
import json, os
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
if os.path.exists(p):
    cur = json.load(open(p))
    cur.setdefault('mcpServers', {}).pop('${name}', None)
    cur.setdefault('tools', {}).pop('${name}', None)
    json.dump(cur, open(p, 'w'), indent=2)
" 2>/dev/null || true
          rm -rf "${HH}/skills/${name}" 2>/dev/null || true`);
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
          export OC_HOME="${HH}"
          mkdir -p "${HH}/skills/${skillName}"
          python3 -c "
import json, os, base64
p = (os.getenv('OC_HOME') or os.path.expanduser('~/.openclaw')) + '/openclaw.json'
cur = json.load(open(p)) if os.path.exists(p) else {}
mcp = json.loads(base64.b64decode('${mcpB64}').decode('utf8'))
cur.setdefault('mcpServers', {})['${skillName}'] = mcp
json.dump(cur, open(p, 'w'), indent=2)
print('MCP_ADDED')
" 2>/dev/null || true`);
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: `Configured MCP skill ${skillName}` });
      }

      if (op === 'install-content') {
        const rawName = String(config.name || config.id || '').trim();
        const skillDir = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'custom-skill';
        let content = String(config.content || '').trim();
        if (!content) {
          content = `# ${rawName}\n\nSkill definition for ${rawName}.\n`;
        }
        const contentB64 = b64(content);
        await run('install skill content', `
          export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
          mkdir -p "${HH}/skills/${skillDir}"
          python3 -c "import base64; open('${HH}/skills/${skillDir}/SKILL.md','w').write(base64.b64decode('${contentB64}').decode('utf8'))" 2>/dev/null || true`);
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: `Installed skill "${rawName}" with full content` });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    // ── PAIRING APPROVAL (openclaw pairing approve <platform> <code>) ──
    if (action === 'pairing-approve') {
      const platform = String(config.platform || 'telegram').trim();
      const code = String(config.code || '').trim();
      if (!code) return NextResponse.json({ success: false, error: 'Pairing code is required' }, { status: 400 });
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || 'openclaw';
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a`;
      const runCmd = platform && platform !== 'auto'
        ? `${ENVX}; ${BP} pairing approve ${JSON.stringify(platform)} ${JSON.stringify(code)} 2>&1 || ${BP} pairing approve ${JSON.stringify(code)} 2>&1`
        : `${ENVX}; ${BP} pairing approve telegram ${JSON.stringify(code)} 2>&1 || ${BP} pairing approve ${JSON.stringify(code)} 2>&1`;
      const r = await run(`pairing approve ${platform ? platform + ' ' : ''}${code}`, runCmd);
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const ok = !/error|failed|invalid/i.test(out) || /approved|success|paired|ok/i.test(out);
      return NextResponse.json({ success: ok, output: out || 'Pairing command executed', log });
    }

    if (action === 'pairing-list') {
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || 'openclaw';
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="$HOME/.openclaw/local/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a`;
      const r = await execCommand(sshConfig,
        `${ENVX}; ${BP} pairing list 2>&1 || true; { FILE="$(ls -1t "${HH}/logs/"*.log 2>/dev/null | head -1)"; [ -n "$FILE" ] && tail -n 80 "$FILE"; } || true`,
        { pool: false, timeoutMs: 20000 });
      const out = r.stdout || '';
      const matches = [
        ...out.matchAll(/pairing\s+approve\s+(?:(\w+)\s+)?([A-Z0-9]{6,12})/gi),
        ...out.matchAll(/code[:\s]+([A-Z0-9]{6,12})/gi),
        ...out.matchAll(/pairing\s+code\s+is\s+([A-Z0-9]{6,12})/gi),
        ...out.matchAll(/Pairing:\s+([A-Z0-9]{6,12})/gi),
      ];
      const pending = [];
      for (const m of matches) {
        const code = m[2] || m[1];
        const platform = m[2] ? m[1] : 'telegram';
        if (code && !pending.some(p => p.code === code)) {
          pending.push({ code, platform: platform || 'telegram' });
        }
      }
      return NextResponse.json({ success: true, pending, raw: out.slice(-1000) });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });






  } catch (e) {
    logger.error('[openclaw-agent] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
