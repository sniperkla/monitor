import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { getLatestAgentVersion, isNewerVersion } from '../_version-check';
import { logger } from '@/lib/logger';
import { parseInst, homeDir, instancePort, listInstances, cloneDefaultHome, pidAlive, gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl, copyInstanceBin } from '../_multi-instance';
import { shellQuote } from '@/utils/shellQuote';
const sq = shellQuote;

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

/**
 * Layered liveness probe for the nanobot gateway.
 *
 * Why layered: the dashboard used to trust a single signal, and every one of
 * them can be wrong on its own — which is what produced the permanent
 * "Gateway is DOWN — your bot is not responding" banner on hosts where the bot
 * had been running for days.
 *
 *   1. daemon.pid is written by the nohup launcher as `$!` — the PID of the
 *      `setsid` wrapper. When setsid forks (it does whenever the caller is
 *      already a process-group leader) that PID exits within milliseconds and
 *      the pidfile is left pointing at a dead or, worse, a RECYCLED process.
 *      Verified live: pidfile said 645572 while the real gateway was 622218.
 *   2. `pgrep -f "nanobot gateway --config <home>/config.json"` only matches
 *      gateways launched WITH an explicit --config flag. The default install is
 *      launched as plain `nanobot gateway` (GW_FLAGS is empty when there is no
 *      instance tag), so that pattern can never match it.
 *   3. systemd was only consulted for tagged instances, so a default instance
 *      supervised by a unit (or by the upstream install.sh) was invisible.
 *
 * The probe therefore checks, in order: a *validated* pidfile, systemd
 * (default unit + instance template, user and system bus), then a /proc scan
 * scoped to this instance's home, and finally — for the default instance only
 * — a broad scan that explicitly excludes instance processes.
 *
 * Emits: PROC_ACTIVE|NO_PROC  and  GWPID=<pid> (empty when unknown).
 */
const gwProbe = (HH, PIDF, inst) => {
  const units = inst
    ? [`nanobot-gatew""ay@${inst}`, 'nanobot-gatew""ay', 'nanobot']
    : ['nanobot-gatew""ay', 'nanobot'];
  return `
GW_PID=""
# 1) pidfile — only trusted when the PID is alive AND really is a nanobot process
if [ -f "${PIDF}" ]; then
  P=$(tr -cd '0-9' < "${PIDF}" 2>/dev/null)
  if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then
    CMDL=$(tr '\\0' ' ' < "/proc/$P/cmdline" 2>/dev/null)
    [ -z "$CMDL" ] && CMDL=$(ps -p "$P" -o args= 2>/dev/null)
    case "$CMDL" in *nanobot*) GW_PID="$P";; esac
  fi
fi
# 2) systemd — per-instance template unit, then the plain default unit
if [ -z "$GW_PID" ]; then
  [ -n "$XDG_RUNTIME_DIR" ] || export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  for u in ${units.join(' ')}; do
    if { systemctl --user is-active "$u" 2>/dev/null || systemctl is-active "$u" 2>/dev/null; } | grep -qx active; then
      GW_PID="systemd:$u"; break
    fi
  done
fi
# 3) process scan scoped to THIS instance: a nanobot gateway whose command line
#    points at this instance home (--config / workspace / --port).
#    The GWPID guard drops OUR OWN remote shell, whose argv literally contains
#    this script (and therefore the word nanobot and the unit names above).
if [ -z "$GW_PID" ]; then
  for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
    [ -r "/proc/$p/cmdline" ] || continue
    C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    [ -n "$C" ] || continue
    case "$C" in *GWPID*) continue;; esac
    case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
    case "$C" in *"${HH}"*) GW_PID="$p"; break;; esac
  done
fi
# 4) default install: launched as bare "nanobot gateway" with NO --config flag,
#    so nothing in its command line names the home. Fall back to a broad scan
#    that excludes tagged-instance homes (.nanobot-<tag>) so a running instance
#    can never make the default instance look UP.
if [ -z "$GW_PID" ] && [ -z "${inst}" ]; then
  for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
    [ -r "/proc/$p/cmdline" ] || continue
    C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    [ -n "$C" ] || continue
    case "$C" in *GWPID*) continue;; esac
    case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
    case "$C" in *".nanobot-"*) continue;; esac
    GW_PID="$p"; break
  done
fi
if [ -n "$GW_PID" ]; then echo PROC_ACTIVE; else echo NO_PROC; fi
echo "GWPID=$GW_PID"
`;
};

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
      const BP = sq(bp);
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;
      // Instance-aware launch: explicit config/workspace/port so multiple
      // gateways on the same server never share a data dir or bind port.
      // ALWAYS pass --config/--workspace — including for the DEFAULT install.
      // The default used to be launched as a bare `nanobot gateway`; with no
      // instance-identifying text anywhere in its command line, no process
      // scan could ever find or attribute it, which is exactly what made the
      // dashboard report "Gateway is DOWN" while the bot was running. These
      // flags resolve to the very paths nanobot would have defaulted to, so
      // behaviour is unchanged — only discoverability improves.
      const GW_FLAGS = ` --config "${HH}/config.json" --workspace "${HH}/workspace"${GW_PORT ? ` --port ${GW_PORT}` : ''}`;
      const pidScan = `${ENVX}; ${gwProbe(HH, PIDF, inst)}`;
      if (op === 'status') {
        const r = await execCommand(sshConfig, pidScan, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /PROC_ACTIVE/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        // The pidfile can be stale (it used to record the `setsid` wrapper's
        // PID), so after the pidfile kill also sweep any gateway still running
        // against THIS instance home. Never touches a sibling instance.
        return execCommand(sshConfig,
          `${ENVX}; NBSTOPSCAN=1; if [ -f "${PIDF}" ]; then kill $(cat "${PIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${PIDF}") 2>/dev/null; fi; rm -f "${PIDF}"; for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); [ -n "$C" ] || continue; case "$C" in *NBSTOPSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${HH}"*) kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null;; esac; done; echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 })
          .then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      if (op === 'restart') await gwCtl('stop');
      // `setsid` forks whenever the caller is already a process-group leader,
      // so `$!` is the wrapper's PID, not the gateway's — it exits immediately
      // and leaves a stale pidfile. Re-resolve the real gateway PID from /proc
      // (scoped to this instance home) and rewrite the pidfile with it.
      // NBSTARTSCAN marks our own script text so the scan cannot match itself.
      const startCmd = `${ENVX}; NBSTARTSCAN=1; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; mkdir -p "${HH}/logs" "${HH}/workspace"; rm -f "${PIDF}"; setsid nohup ${BP} gateway${GW_FLAGS} >> "${HH}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${PIDF}"; sleep 4; REAL=$(for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); [ -n "$C" ] || continue; case "$C" in *NBSTARTSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${HH}"*) echo "$p";; esac; done | head -1); [ -n "$REAL" ] && echo "$REAL" > "${PIDF}"; if kill -0 $(cat "${PIDF}") 2>/dev/null; then echo GW_UP; else echo GW_DOWN; fi`;
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
export PATH="$HOME/.local/bin:${HH}/venv/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"
BIN="${HH}/venv/bin/nanobot"
[ -x "$BIN" ] || BIN="$(command -v nanobot 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "${HH}/venv/bin/nanobot" "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" "/usr/local/bin/nanobot" "/usr/bin/nanobot"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${HH}/config.json" 2>/dev/null || true
# Bundled skills ship INSIDE the nanobot package
# (<site-packages>/nanobot/skills) — cron, github, weather, memory, tmux, ...
# They are installed and immediately usable by the bot, but they live outside
# the instance home, so listing only the workspace showed a fraction of what
# the bot actually has. Resolve the package dir through the venv interpreter
# (the nanobot on PATH may be a shim outside the venv), then glob as backup.
NBSK=""
for py in "$(dirname "$BIN" 2>/dev/null)/python" "$HOME/.nanobot/venv/bin/python" "$(command -v python3 2>/dev/null)"; do
  [ -n "$py" ] && [ -x "$py" ] || continue
  NBSK=$("$py" -c 'import nanobot, os; print(os.path.join(os.path.dirname(nanobot.__file__), "skills"))' 2>/dev/null)
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && break
  NBSK=""
done
if [ -z "$NBSK" ]; then
  for d in "$HOME"/.nanobot/venv/lib/python*/site-packages/nanobot/skills; do
    [ -d "$d" ] && NBSK="$d" && break
  done
fi
echo "===SKILLS==="
{
  # 1) user / workspace skill dirs for this instance. Directories are the norm
  #    (each holds a SKILL.md); a bare <name>.md also counts. Files like
  #    README.md are NOT skills, hence -type d / -name '*.md' rather than ls -1.
  for d in "${HH}/workspace/skills" "${HH}/skills"${inst ? '' : ' "$HOME/.nanobot/workspace/skills" "$HOME/.nanobot/skills"'}; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##'
    find "$d" -maxdepth 1 -mindepth 1 -type f -name '*.md' 2>/dev/null | sed 's#.*/##; s#\\.md$##'
  done
  # 2) nested skills anywhere under the instance home (a SKILL.md a level or two
  #    down is still an installed skill, e.g. skills/cat/name/SKILL.md)
  for base in "${HH}/workspace/skills" "${HH}/skills"; do
    [ -d "$base" ] && find "$base" -maxdepth 3 -name 'SKILL.md' 2>/dev/null | while read -r f; do basename "$(dirname "$f")"; done
  done
  # 3) bundled skills shipped inside the nanobot package
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##'
  [ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 2 -name 'SKILL.md' 2>/dev/null | while read -r f; do basename "$(dirname "$f")"; done
} | grep -v '^\\.' | grep -viE '^readme([.-_]|$)' | sort -u || true
echo "===PLUGINS==="
[ -n "$BIN" ] && "$BIN" plugins list 2>/dev/null || true
echo "===SKILLS_BUNDLED==="
[ -n "$NBSK" ] && [ -d "$NBSK" ] && find "$NBSK" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's#.*/##' | grep -v '^\\.' | grep -viE '^readme([.-_]|$)' | sort -u || true
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
${gwProbe(HH, PIDF, inst)}
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
echo "===WEBUI_SECRET==="
# Prefer config.json — the authoritative secret. Flatten newlines so the whole
# JSON is one line (the webui.log wraps the token across two lines, truncating
# it when grepped).
SEC=$(tr -d '\n' < "${HH}/config.json" 2>/dev/null | grep -oE '"(tokenIssueSecret|token_issue_secret|bootstrapSecret|bootstrap_secret)" *: *"[A-Za-z0-9+/=_-]+"' | tail -1 | awk -F"' '{print $(NF-1)}')
[ -z "$SEC" ] && SEC=$(grep -oE 'bootstrapSecret=[A-Za-z0-9+/=_-]+' "${HH}/logs/webui.log" 2>/dev/null | tail -1 | cut -d= -f2)
echo "$SEC"
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
      // Skills that ship inside the nanobot package itself. They are real and
      // usable, but they are NOT removable (they live in site-packages, outside
      // the instance home), so the UI badges them instead of offering a Remove
      // button that would silently do nothing.
      const bundledList = new Set(
        sec('SKILLS_BUNDLED', 'PROMPT_B64').split('\n').map(s => s.trim()).filter(Boolean),
      );
      const pluginsOut = sec('PLUGINS', 'SKILLS_BUNDLED');
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
      // Web UI port — nanobot exposes a browser UI on the
      // websocket/webui channel port. Read from config, fall back to 8765 (or GW_PORT + 1).
      let webUIPort = GW_PORT ? (GW_PORT + 1) : 8765;
      let webUIBootstrapPath = '/';
      const secFromLog = sec('WEBUI_SECRET', '').trim();
      if (secFromLog) {
        webUIBootstrapPath = `/#/?bootstrapSecret=${secFromLog}`;
      }
      try {
        const c = JSON.parse(configJson || '{}');
        const wsPort = c?.channels?.websocket?.port;
        if (wsPort && typeof wsPort === 'number' && wsPort > 0) webUIPort = wsPort;
        // Some nanobot builds expose a dedicated webui channel
        const wuPort = c?.channels?.webui?.port;
        if (wuPort && typeof wuPort === 'number' && wuPort > 0) webUIPort = wuPort;

        if (webUIBootstrapPath === '/') {
          // The nanobot webui writes its bootstrap secret into the websocket
          // channel config (tokenIssueSecret) and may also store it under
          // webui.* bootstrap keys. The webui.log can split the token across
          // two lines, which truncates it — config.json is the authoritative
          // source, so prefer it here.
          const secToken = c?.channels?.websocket?.tokenIssueSecret
            || c?.channels?.websocket?.token_issue_secret
            || c?.webui?.bootstrapSecret
            || c?.channels?.webui?.bootstrapSecret
            || c?.webui?.bootstrap_secret
            || c?.channels?.webui?.bootstrap_secret
            || c?.bootstrapSecret;
          if (secToken) {
            webUIBootstrapPath = `/#/?bootstrapSecret=${secToken}`;
          }
        }
      } catch {}
      // Is the Web UI actually answering on its port?
      //
      // `running` above is the GATEWAY process, which is a different thing —
      // `nanobot webui` is its own process on webUIPort. Reusing the gateway
      // flag here would let the UI claim "Running" when the Web UI is really
      // down (and, worse, disable the Start button that would have fixed it),
      // so probe the port instead of guessing from the process table.
      //
      // Port probe rather than `pgrep -f '[n]anobot.*webui'`: the webui-ctl
      // handler has to filter out its own shell's argv, and that trick is
      // fragile to layer into this much bigger script. A curl against the
      // port answers the question we actually care about — is it serving?
      let webUIActive = false;
      try {
        const wuResp = await execCommand(
          sshConfig,
          `HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${webUIPort}/" 2>/dev/null || true); echo "HTTP_CODE=$HTTP_CODE"`,
          { pool: false, timeoutMs: 8000 },
        );
        const hc = parseInt((wuResp?.stdout || '').match(/HTTP_CODE=(\d+)/)?.[1] || '0', 10);
        // Anything that answers at all (2xx–4xx) means something is listening
        // and serving; only 000/5xx-network means "not up".
        webUIActive = hc >= 200 && hc < 500;
      } catch { /* treat as not running */ }
      envText = envText.trim();
      const currentVer = sec('VERSION', 'BINPATH') || null;
      let latestVersion = null;
      let updateAvailable = false;
      try {
        latestVersion = await getLatestAgentVersion('nanobot');
        if (currentVer && latestVersion) {
          updateAvailable = isNewerVersion(currentVer, latestVersion);
        }
      } catch (_) {}
      return NextResponse.json({
        success: true,
        installed: !!binR,
        version: currentVer,
        latestVersion,
        updateAvailable,
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
        bundledSkills: [...bundledList],
        systemPrompt,
        webUIPort,
        webUIBootstrapPath,
        hasWebUI: true,
        // True only when the Web UI is actually serving on webUIPort. Distinct
        // from `running` (the gateway process) — see the probe above.
        webUIActive,
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
python3 - "$P" ${sq(preset)} <<'PYEOF'
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
        // Selective kill: only the DEFAULT gateway. Instance gateways carry a
        // tagged home (.nanobot-<tag>) in their command line and are spared so
        // they survive a default stop/uninstall.
        // Keyed on the HOME, not on --config: the default install now also gets
        // --config (so the dashboard can find it), which makes that flag useless
        // as a default/instance discriminator.
        // Bracketed pgrep cannot match this script's own cmdline (self-kill guard).
        : `for p in $(pgrep -f '[n]anobot gatew' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); case "$C" in *".nanobot-"*) continue;; esac; kill -9 $p 2>/dev/null; done; true`;
      await run('stop gateway', stopCmd);
      // Share the globally-installed binary/venv. Removing while any instance
      // exists breaks restart for those instances — skip when siblings remain.
      let instancesRemain = false;
      if (!inst) {
        try {
          const instList = await listInstances(sshConfig, 'nanobot');
          instancesRemain = Array.isArray(instList) && instList.filter(i => i.tag && i.tag !== inst).length > 0;
        } catch { /* non-fatal */ }
      }
      const binRm = (inst || (instancesRemain && !purge))
        ? '' // non-purge keeps the binary for surviving instances; purge wipes them first
        : `rm -f "$HOME/.local/bin/nanobot" "$HOME/.nanobot/venv/bin/nanobot" /usr/local/bin/nanobot /usr/bin/nanobot 2>/dev/null; pipx uninstall nanobot-ai 2>/dev/null; pipx uninstall nanobot 2>/dev/null; `;
      const rmCmd = inst
        ? `rm -rf "${HH}" 2>/dev/null; [ ! -e "${HH}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`   // instances: always remove the whole isolated home
        : purge
          // Only this install's home. Previously `/home/*/.nanobot` was also
          // removed, which as root wiped EVERY user's agent home (including
          // provisioned "friend" users). zeroclaw scopes purge to ${HH} too.
          ? `pkill -9 -f '[n]anobot gatew' 2>/dev/null; rm -rf "$HOME/.nanobot-"* 2>/dev/null; ${binRm}rm -rf "${HH}" "$HOME/.cache/nanobot" /tmp/.nb* 2>/dev/null; echo REMOVED_ALL`
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
      const NBE = sq(NB);

      // 4. Build config.json from the wizard's env + settings (same as reconfigure).
      // The wizard sends config.env (API keys, tokens, MODEL) and config.settings
      // (model), NOT configJson - so a fresh install must derive providers /
      // modelPresets / channels the same way reconfigure does, otherwise the
      // model & messenger token are silently dropped on first install.
      const env = (config && config.env) || {};
      const settings = (config && config.settings) || {};
      const PROVIDER_FROM_KEY = { OPENROUTER_API_KEY: 'openrouter', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', CUSTOM_LLM_API_KEY: 'custom' };
      const modelFromSettings = (settings.model || settings.default_model) || env.MODEL || env.NANOBOT_MODEL || env.DEFAULT_MODEL || null;
      const providerName = Object.entries(env).map(([k, v]) => ({ k, v, p: PROVIDER_FROM_KEY[k] })).find(x => x.p && x.v);
      const newCfg = {};
      const customBaseUrl = String(env.OPENAI_BASE_URL || env.OPENAI_API_BASE || '').trim();
      if (providerName) {
        const pcfg = { apiKey: providerName.v };
        if (providerName.p === 'custom' && customBaseUrl) pcfg.api_base = customBaseUrl;
        newCfg.providers = { [providerName.p]: pcfg };
        if (modelFromSettings) {
          newCfg.modelPresets = { primary: { provider: providerName.p, model: modelFromSettings, maxTokens: 8192, contextWindowTokens: 65536 } };
          newCfg.agents = { defaults: { model_preset: 'primary', modelPreset: 'primary' } };
        }
      } else if (modelFromSettings) {
        newCfg.modelPresets = { primary: { model: modelFromSettings } };
      }
      if (inst && GW_PORT) {
        newCfg.channels = newCfg.channels || {};
        newCfg.channels.websocket = { ...(newCfg.channels.websocket || {}), port: GW_PORT + 1 };
      }
      const tgToken = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN;
      const tgAllowed = env.TELEGRAM_ALLOWED_USERS ? env.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean) : null;
      if (tgToken) {
        newCfg.channels = newCfg.channels || {};
        newCfg.channels.telegram = { enabled: true, token: tgToken, ...(tgAllowed ? { allowFrom: tgAllowed } : {}) };
      }
      // Merge any explicit configJson on top (advanced users / presets).
      const cfg = { ...((typeof config.configJson === 'object' && config.configJson) || {}), ...newCfg };
      // Persist all env entries into the .env sidecar (Env tab reads it).
      const envWrite = Object.entries(env).filter(([k, v]) => k && v != null && String(v).trim() !== '');
      const envB64n = b64(envWrite.map(([k, v]) => `${k}=${v}`).join('\n'));
      const cfgB64 = b64(JSON.stringify(cfg));
      await run(`merge ${inst ? `~/.nanobot-${inst}` : '~/.nanobot'}/config.json`, [
        `export NB_HOME="${HH}"; mkdir -p "${HH}"`,
        envWrite.length ? `echo '${envB64n}' | base64 -d > "${HH}/.env"; chmod 600 "${HH}/.env"` : 'true',
        `echo '${b64(JSON.stringify(cfg))}' | base64 -d > /tmp/.nb-new.json`,
        `cat > /tmp/.nb-merge.py <<'PYEOF'`,
        'import json, os, sys',
        "home = os.environ.get('NB_HOME') or os.path.expanduser('~/.nanobot')",
        "path = os.path.join(home, 'config.json')",
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

      // 6. Start gateway detached. `$!` is the setsid wrapper PID, not
      // necessarily the gateway PID, so resolve the real process through the
      // same instance-aware probe used by details/status/health.
      await run('start gateway', [
        `mkdir -p "${HH}/logs" "${HH}/workspace"; rm -f "${PIDF}"`,
        // Pass GW_FLAGS so every install (including the default) carries its
        // config/workspace marker and can be attributed without a false DOWN.
        `NBSTARTSCAN=1; setsid nohup ${NBE} gateway${GW_FLAGS} >> "${HH}/logs/gateway.log" 2>&1 < /dev/null & echo $! > "${PIDF}"`,
        'sleep 4',
        `REAL=$(NBSTARTSCAN=1; for p in $(pgrep -f '[n]anobot' 2>/dev/null); do [ -r "/proc/$p/cmdline" ] || continue; C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null); case "$C" in *NBSTARTSCAN*) continue;; esac; case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac; case "$C" in *"${HH}"*) echo "$p"; break;; esac; done); [ -n "$REAL" ] && echo "$REAL" > "${PIDF}"; ${gwProbe(HH, PIDF, inst)}`,
      ].join('\n'), { timeoutMs: 90000 });
      // Instance-scoped liveness: use the shared probe rather than kill -0 on
      // the stale setsid PID. This is the signal the dashboard consumes later.
      const up = await execCommand(sshConfig, gwProbe(HH, PIDF, inst), { pool: false, timeoutMs: 30000 });
      const running = /PROC_ACTIVE/.test(up.stdout || '');

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
    if k in new:
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
python3 - "$P" ${sq(code)} <<'PYEOF'
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

    // ── WEBUI control ──
    if (action === 'webui-ctl') {
      const op = ['start', 'stop', 'restart', 'status', 'relay-start'].includes(config.op) ? config.op : 'status';
      const wuPIDF = `${HH}/webui.pid`;
      const wuPort = parseInt(config.port || (GW_PORT ? (GW_PORT + 1) : 8765), 10);
      const wuLog = `${HH}/logs/webui.log`;
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) {
        log.push('✗ Nanobot binary not found on this server');
        return NextResponse.json({ success: false, error: 'nanobot binary not found', log });
      }
      const BP = sq(bp);
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;

      if (op === 'status') {
        // NOTE: the bash -c wrapper's own argv contains the script text (paths with
        // "nanobot" + the word "webui"), so a bare `pgrep -f '[n]anobot.*webui'`
        // matches the shell itself and always reports UP=1. Skip self/parent PIDs.
        const r = await execCommand(sshConfig, `${ENVX}; UP=0; for P in $(pgrep -f '[n]anobot.*webui' 2>/dev/null); do if [ "$P" != "$$" ] && [ "$P" != "$PPID" ]; then UP=1; break; fi; done; echo "UP=$UP"`, { pool: false, timeoutMs: 15000 });
        const active = /UP=1/.test(r.stdout || '');
        return NextResponse.json({ success: true, active, op, port: wuPort });
      }
      if (op === 'stop' || op === 'restart') {
        log.push(`> Stopping Nanobot Web UI...`);
        // Skip $$/$PPID — pkill -f '[n]anobot.*webui' would match this shell's own
        // argv (script text contains nanobot paths + webui words) and kill it.
        await execCommand(sshConfig, `${ENVX}; if [ -f "${wuPIDF}" ]; then kill $(cat "${wuPIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${wuPIDF}") 2>/dev/null; fi; rm -f "${wuPIDF}"; for P in $(pgrep -f '[n]anobot.*webui' 2>/dev/null); do [ "$P" != "$$" ] && [ "$P" != "$PPID" ] && kill "$P" 2>/dev/null; done; true`, { pool: false, timeoutMs: 20000 });
        log.push(`✓ Stopped previous Web UI processes`);
      }
      if (op === 'relay-start') {
        // Direct-transfer mode: the user's Local Relay opens the SSH tunnel on
        // the user's own machine and serves the WebUI at 127.0.0.1:18790 — the
        // central server is control-plane only (no data flows through it).
        if (typeof global.__sendToRelayForUserAny !== 'function') {
          return NextResponse.json({ success: false, error: 'relay bridge unavailable' }, { status: 503, log });
        }
        const monitorOrigin = String(config.monitorOrigin || '');
        const forwardId = `${connectionId}-${wuPort}`;
        // Pass the bootstrap secret so the relay gateway can auto-pair the SPA on
        // ANY page load — deep links like /#/settings?section=models otherwise load
        // with no secret → no api_token → settings API answers 401 "Unauthorized".
        let bootstrapSecret = '';
        try {
          const secResp = await execCommand(sshConfig, `${ENVX}; SEC=$(tr -d '\n' < "${HH}/config.json" 2>/dev/null | grep -oE '"(tokenIssueSecret|token_issue_secret|bootstrapSecret|bootstrap_secret)" *: *"[A-Za-z0-9+/=_-]+"' | tail -1 | awk -F'"' '{print $(NF-1)}'); [ -z "$SEC" ] && SEC=$(grep -oE 'bootstrapSecret=[A-Za-z0-9+/=_-]+' "${wuLog}" 2>/dev/null | tail -1 | cut -d= -f2); echo "SEC=$SEC"`, { pool: false, timeoutMs: 10000 });
          bootstrapSecret = (secResp.stdout || '').match(/SEC=(.*)/)?.[1]?.trim() || '';
        } catch {}
        const forwardMsg = {
          type: 'webui:forward',
          forwardId,
          remotePort: wuPort,
          localPort: 18790,
          monitorOrigin,
          bootstrapSecret,
          connection: {
            host: sshConfig.host, port: sshConfig.port, username: sshConfig.username,
            password: sshConfig.password, privateKey: sshConfig.privateKey, passphrase: sshConfig.passphrase,
          },
        };
        const sent = await (global.__sendToRelayForUserAny([session?.user?.id, session?.user?.dbId, session?.user?.sub], forwardMsg) || Promise.resolve(false));
        if (!sent) {
          return NextResponse.json({ success: false, error: 'Local Relay is not connected — start it or use the central proxy' }, { status: 409, log });
        }
        log.push('> [webui] Direct relay requested — gateway will serve at http://127.0.0.1:18790');
        return NextResponse.json({ success: true, active: true, relay: true, localPort: 18790, log });
      }
      if (op === 'start' || op === 'restart') {
        log.push(`> [webui] Nanobot binary: ${bp}`);

        // 1. Check if WebUI is ALREADY responding to HTTP requests on wuPort
        if (op === 'start') {
          const checkResp = await execCommand(sshConfig, `${ENVX}; HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${wuPort}/" 2>/dev/null || true); echo "HTTP_CODE=$HTTP_CODE"`, { pool: false, timeoutMs: 10000 });
          const httpCode = parseInt((checkResp.stdout || '').match(/HTTP_CODE=(\d+)/)?.[1] || '0', 10);
          if (httpCode >= 200 && httpCode < 500) {
            log.push(`✓ Nanobot Web UI is already running and responding on port ${wuPort} (HTTP ${httpCode})`);
            const secResp = await execCommand(sshConfig, `${ENVX}; SEC=$(tr -d '\n' < "${HH}/config.json" 2>/dev/null | grep -oE '"(tokenIssueSecret|token_issue_secret|bootstrapSecret|bootstrap_secret)" *: *"[A-Za-z0-9+/=_-]+"' | tail -1 | awk -F"' '{print $(NF-1)}'); [ -z "$SEC" ] && SEC=$(grep -oE 'bootstrapSecret=[A-Za-z0-9+/=_-]+' "${wuLog}" 2>/dev/null | tail -1 | cut -d= -f2); echo "SEC=$SEC"`, { pool: false, timeoutMs: 10000 });
            const secFound = (secResp.stdout || '').match(/SEC=(.*)/)?.[1]?.trim() || '';
            const webUIBootstrapPath = secFound ? `/#/?bootstrapSecret=${secFound}` : '/';
            return NextResponse.json({
              success: true,
              active: true,
              op,
              port: wuPort,
              webUIBootstrapPath,
              output: `Nanobot Web UI is already running on port ${wuPort}`,
              log
            });
          }
        }

        // Check supported CLI commands — detect --yes and --gateway-port flag support
        const helpR = await execCommand(sshConfig, `${ENVX}; ${BP} webui --help 2>&1`, { pool: false, timeoutMs: 15000 });
        const helpTxt = (helpR.stdout || '').trim();
        const hasWebui = !helpTxt.includes('invalid choice') && !helpTxt.includes('error:');
        const hasYesFlag = /--yes\b/.test(helpTxt);
        const hasGwPortFlag = /--gateway-port\b/.test(helpTxt);
        const wuGwPort = wuPort === 8765 ? 18799 : (wuPort + 100);
        const gwPortFlag = hasGwPortFlag ? ` --gateway-port ${wuGwPort}` : '';
        log.push(`> [webui] CLI support: ${hasWebui ? 'nanobot webui available' : 'checking fallback'}${hasYesFlag ? ' (--yes supported)' : ''}${hasGwPortFlag ? ` (--gateway-port: ${wuGwPort})` : ''}`);

        await execCommand(sshConfig, `mkdir -p "${HH}/logs"`, { pool: false, timeoutMs: 10000 });

        const yesFlag = hasYesFlag ? ' --yes' : '';
        const cmd = hasWebui
          ? `${BP} webui --port ${wuPort}${gwPortFlag}${yesFlag}`
          : `${BP} gateway --port ${wuPort}`;

        log.push(`$ nohup ${cmd} > "${wuLog}" 2>&1 &`);

        const launchScript = `${ENVX}
export PYTHONUNBUFFERED=1
mkdir -p "${HH}/logs"

# Wipe old log so we always get a fresh error trace
> "${wuLog}"

# Kill any lingering webui processes — skip $$/$PPID: this shell's own argv
# contains the script text (nanobot paths + webui words) so a bare pkill -f
# '[n]anobot.*webui' would kill THIS shell before the webui process is launched.
for P in $(pgrep -f '[n]anobot.*webui' 2>/dev/null); do [ "$P" != "$$" ] && [ "$P" != "$PPID" ] && kill "$P" 2>/dev/null || true; done
sleep 0.5

# Free ports if occupied
P_WU=$(lsof -ti :${wuPort} 2>/dev/null || fuser ${wuPort}/tcp 2>/dev/null || true)
[ -n "$P_WU" ] && kill -9 $P_WU 2>/dev/null || true

# Run nanobot foreground for 2s so its exit code and stderr are captured
${cmd} >> "${wuLog}" 2>&1 &
PID=$!
echo $PID > "${wuPIDF}"
sleep 4
ALIVE=0
if kill -0 $PID 2>/dev/null; then
  ALIVE=1
else
  REAL=""
  for P in $(pgrep -f '[n]anobot.*webui' 2>/dev/null); do
    if [ "$P" != "$$" ] && [ "$P" != "$PPID" ]; then REAL="$P"; break; fi
  done
  if [ -n "$REAL" ]; then
    echo "$REAL" > "${wuPIDF}"
    ALIVE=1
  fi
fi
echo "ALIVE=$ALIVE"
echo "===WEBUI_SECRET==="
SEC=$(tr -d '\n' < "${HH}/config.json" 2>/dev/null | grep -oE '"(tokenIssueSecret|token_issue_secret|bootstrapSecret|bootstrap_secret)" *: *"[A-Za-z0-9+/=_-]+"' | tail -1 | awk -F"' '{print $(NF-1)}')
[ -z "$SEC" ] && SEC=$(grep -oE 'bootstrapSecret=[A-Za-z0-9+/=_-]+' "${wuLog}" 2>/dev/null | tail -1 | cut -d= -f2)
echo "$SEC"
echo "===LOG_TAIL==="
cat "${wuLog}" 2>/dev/null || echo "(no log)"
`;
        const r = await execCommand(sshConfig, launchScript, { pool: false, timeoutMs: 35000 });
        const out = r.stdout || '';
        const alive = /ALIVE=1/.test(out);
        log.push(`> [webui] process status: ${alive ? 'active (PID found)' : 'not running'}`);

        // Extract bootstrapSecret from out or log
        let bootstrapSecret = '';
        const secBlock = out.includes('===WEBUI_SECRET===')
          ? out.split('===WEBUI_SECRET===')[1].split('===LOG_TAIL===')[0].trim()
          : '';
        if (secBlock) {
          bootstrapSecret = secBlock.split('\n')[0].trim();
        }
        const logContent = out.includes('===LOG_TAIL===') ? out.split('===LOG_TAIL===')[1].trim() : '';

        if (!bootstrapSecret) {
          const secretMatch = (logContent + '\n' + out).match(/bootstrapSecret=([A-Za-z0-9+/=_-]+)/);
          bootstrapSecret = secretMatch?.[1] || null;
        }

        const webUIBootstrapPath = bootstrapSecret ? `/#/?bootstrapSecret=${bootstrapSecret}` : '/';

        // Treat "port already in use" as success — WebUI is already running
        const portInUse = /port (?:is )?already in use|already in use/i.test(logContent);

        // Redact secret from log lines before pushing to client
        if (logContent) {
          for (const l of logContent.split('\n')) {
            const redacted = bootstrapSecret ? l.split(bootstrapSecret).join('<redacted>') : l;
            log.push(`  ${redacted}`);
          }
        }

        // Detect known failure patterns in the log even when ALIVE=1 (brief fork then exit)
        const needsConfirm = /needs confirmation|Re-run with --yes|use `nanobot onboard/i.test(logContent);

        if ((alive || portInUse) && !needsConfirm) {
          const statusDesc = portInUse ? 'already running' : 'started successfully';
          log.push(`✓ Nanobot Web UI ${statusDesc} on port ${wuPort}`);
          return NextResponse.json({
            success: true,
            active: true,
            op,
            port: wuPort,
            webUIBootstrapPath,
            output: `Nanobot Web UI ${statusDesc} on port ${wuPort}`,
            log
          });
        } else {
          // Surface a meaningful error
          let errMsg;
          if (needsConfirm) {
            errMsg = 'WebUI setup needs confirmation — the --yes flag was not accepted. Try running: nanobot onboard --wizard on the server.';
          } else if (logContent) {
            errMsg = logContent.split('\n').filter(l => /error|fail/i.test(l)).pop() || logContent.split('\n').pop();
          } else {
            errMsg = 'Web UI process exited immediately';
          }
          log.push(`✗ ${errMsg}`);
          return NextResponse.json({
            success: false,
            active: false,
            op,
            port: wuPort,
            error: errMsg,
            log
          });
        }
      }
    }

    // ── HEALTH ──
    if (action === 'health') {
      const script = `
PROBE=$( ${gwProbe(HH, PIDF, inst)} )
ALIVE=0; echo "$PROBE" | grep -qx PROC_ACTIVE && ALIVE=1
# Uptime must come from the RESOLVED pid — the pidfile alone can be stale, which
# used to report uptime 0 for a gateway that had been up for days.
PID=$(echo "$PROBE" | sed -n 's/^GWPID=//p' | head -1)
echo "ALIVE=$ALIVE"
UP=0
case "$PID" in ''|systemd:*) ;; *) UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ');; esac
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
      const BP = bp ? sq(bp) : 'nanobot';
      const ENVX = `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"`;

      if (op === 'remove') {
        const name = String(config.name || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill/plugin name' }, { status: 400 });
        }
        await execCommand(sshConfig, `${ENVX}; ${BP} plugins disable ${sq(name)} 2>/dev/null; rm -rf "${HH}/workspace/skills/${name}" 2>/dev/null; true`, { pool: false, timeoutMs: 30000 });
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

      if (op === 'install-content') {
        const rawName = String(config.name || config.id || '').trim();
        const skillName = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'custom-skill';
        let content = String(config.content || '').trim();
        if (!content) {
          content = `# ${rawName}\n\nSkill definition for ${rawName}.\n`;
        }
        // Write SKILL.md over SSH to both workspace/skills and skills
        const b64 = Buffer.from(content, 'utf8').toString('base64');
        await execCommand(sshConfig,
          `${ENVX}; mkdir -p "${HH}/workspace/skills/${skillName}" "${HH}/skills/${skillName}"; printf '%s' "${b64}" | base64 -d | tee "${HH}/workspace/skills/${skillName}/SKILL.md" > "${HH}/skills/${skillName}/SKILL.md"`,
          { pool: false, timeoutMs: 30000 });
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: `Installed skill "${rawName}" with full content` });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────
    if (action === 'update') {
      log.push(`> [update] Checking installation for Nanobot...`);
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const currentBin = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || null;
      if (!currentBin) {
        return NextResponse.json({ success: false, error: 'Nanobot is not installed on this server. Please install it first.', log }, { status: 400 });
      }

      const verCheckBefore = await execCommand(sshConfig,
        `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; nanobot --version 2>/dev/null | tail -1`,
        { pool: false, timeoutMs: 15000 });
      const oldVer = (verCheckBefore.stdout || '').trim();
      log.push(`> [update] Current version: ${oldVer || 'unknown'}`);

      // Stop gateway before upgrading
      log.push(`> [update] Stopping running gateway daemon...`);
      try { await gwCtl('stop'); } catch (e) { log.push(`> [update] Gateway stop note: ${e.message}`); }

      // Upgrade Nanobot
      log.push(`> [update] Pulling and applying latest Nanobot updates...`);
      const upgradeCmd = `
        export PATH="/usr/local/bin:$HOME/.local/bin:$HOME/.nanobot/venv/bin:\$PATH"
        export HOME="${homeDir(sshConfig) || '$HOME'}"
        export HH="${HH}"

        # 1. Upgrade pip package in venv if available
        for p in "$HOME/.nanobot/venv/bin/pip" "\${HH}/venv/bin/pip"; do
          if [ -x "$p" ]; then
            echo "> Running pip upgrade in $p..."
            "$p" install --upgrade --no-cache-dir nanobot-ai 2>&1 || true
            break
          fi
        done

        # 2. Re-run official installer
        echo "> Running official Nanobot installer update..."
        curl -fsSL ${INSTALLER_URL} | sh 2>&1

        echo "UPDATE_SCRIPT_DONE"
      `;

      let streamed = 0;
      const upR = await execDetached(sshConfig, upgradeCmd, {
        pollMs: 2000,
        timeoutMs: 600000,
        onLine: (ln) => { if (++streamed <= 400) log.push(ln); }
      });
      log.push(`> [update] Update script finished${upR.code !== 0 ? ` (exit code ${upR.code})` : ''}.`);

      // Verify new version
      const verCheckAfter = await execCommand(sshConfig,
        `export PATH="$HOME/.local/bin:$HOME/.nanobot/venv/bin:/usr/local/bin:$PATH"; nanobot --version 2>/dev/null | tail -1`,
        { pool: false, timeoutMs: 15000 });
      const newVer = (verCheckAfter.stdout || '').trim();
      log.push(`> [update] Verified upgraded version: ${newVer || 'ready'}`);

      // Restart gateway
      log.push(`> [update] Restarting Nanobot gateway daemon...`);
      try {
        const startRes = await gwCtl('start');
        log.push(`> [update] Gateway restart: ${startRes.ok ? 'active' : (startRes.out || 'done')}`);
      } catch (e) {
        log.push(`> [update] Warning restarting gateway: ${e.message}`);
      }

      log.push(`> [update] ✅ Nanobot update complete.`);
      return NextResponse.json({
        success: true,
        message: `Nanobot updated successfully (${oldVer || 'previous'} → ${newVer || 'latest'})`,
        version: newVer,
        log
      });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    logger.error('[nanobot-agent] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
