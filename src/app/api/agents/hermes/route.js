import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { parseInst, gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl, copyInstanceBin, listInstances, instancePorts, instanceIsolationEnv } from '../_multi-instance';
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

/**
 * Shared .env upsert program (Python) used by BOTH install and reconfigure.
 *
 * Every submitted KEY=VALUE line is upserted into the target .env: existing
 * keys are replaced in place, new keys are appended, and unrelated keys are
 * preserved. Values may contain '=' (base64 tokens), and the result is written
 * with mode 0600.
 *
 * NOTE: do not re-implement this as generated shell. A previous shell version
 * emitted `index(\$0, ...)` into awk (double-escaped in this JS template
 * literal), which failed awk and left only the LAST submitted key in the file.
 */
export function buildEnvUpsertPy(envEntries) {
  const payload = Buffer.from(envEntries.map(([k, v]) => `${k}=${v}`).join('\n'), 'utf8').toString('base64');
  return [
    'import os, base64',
    `lines_raw = base64.b64decode('${payload}').decode('utf-8').splitlines()`,
    `ep = (os.environ.get('HERMES_HOME') or os.path.expanduser('~/.hermes')) + '/.env'`,
    `os.makedirs(os.path.dirname(ep), exist_ok=True)`,
    `existing = open(ep).read().splitlines() if os.path.exists(ep) else []`,
    `upsert = {}`,
    `for ln in lines_raw:`,
    `    idx = ln.find('=')`,
    `    if idx > 0: upsert[ln[:idx]] = ln[idx+1:]`,
    // Rebuild the file from the submitted order: every pre-existing occurrence
    // of an upserted key is dropped, so duplicate stale entries cannot survive.
    `result = [ln for ln in existing if ln.find('=') <= 0 or ln[:ln.find('=')] not in upsert]`,
    `written = set()`,
    `for ln in existing:`,
    `    idx = ln.find('=')`,
    `    if idx > 0 and ln[:idx] in upsert and ln[:idx] not in written:`,
    `        result.append(ln[:idx] + '=' + upsert[ln[:idx]])`,
    `        written.add(ln[:idx])`,
    `for k, v in upsert.items():`,
    `    if k not in written:`,
    `        result.append(k + '=' + v)`,
    `        written.add(k)`,
    `open(ep, 'w').write('\\n'.join(result) + '\\n')`,
    `os.chmod(ep, 0o600)`,
    `print('ENV_UPDATED')`,
  ].join('\n');
}

const PROVIDER_ENV_KEYS = Object.freeze({
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
});

// Provider metadata is supplied by the easy-mode wizard to validate that a
// gateway never starts with only a messenger token. Do not trust arbitrary env
// names from clients: accept known providers or a conservative custom key name.
function providerEnvKey(provider) {
  const id = String(provider?.id || '').trim().toLowerCase();
  if (PROVIDER_ENV_KEYS[id]) return PROVIDER_ENV_KEYS[id];
  if (id === 'custom') {
    const key = String(provider?.envKey || '').trim();
    return /^[A-Z][A-Z0-9_]*$/.test(key) ? key : '';
  }
  return '';
}

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

// ── Instance-scoped gateway detection (shared by every probe script) ────────
// A bare `pgrep -f '[h]ermes.*gatew[a]y'` matches EVERY instance on the box, so
// one instance's status would report a sibling instance as running — ZeroClaw
// solves exactly this with a `--config-dir` check. Here we walk the matched pids
// and keep only those whose HERMES_HOME (or command line) points at THIS
// instance's home; a gateway carrying no marker at all cannot be attributed to a
// sibling, so it still counts (preserves the previous behaviour).
// NOTE: the literal word "gateway" must never appear in this snippet — only the
// bracketed regex `gatew[a]y` — or pgrep would match this very command line.
const procScan = (tag = '') => `PROC=0
for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
  [ -n "$hp" ] || continue
  HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
  [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
  # A process carrying NO home marker cannot be attributed to this instance.
  # For the default install we keep the legacy lenient behaviour (an
  # unattributed gateway is assumed to be the default's). For a TAGGED instance
  # it must be ignored: it belongs to a sibling or the default, and counting it
  # would make every instance report itself as running whenever any other
  # hermes gateway on the box is up — the core cross-instance leak.
  if [ -z "$HME" ]; then ${tag ? 'continue' : 'PROC=1; break'}; fi
  case "$HME" in *".hermes${tag ? '-' + tag : ''}") PROC=1; break ;; esac
done`;

// POSIX sh probe — works on every supported distro.
// `tag` scopes every process check to one instance home ('' = default install).
const statusScript = (tag = '') => `
${tag ? `export HERMES_HOME="$HOME/.hermes-${tag}"` : ''}
HH="\${HERMES_HOME:-$HOME/.hermes}"
# Instance-scoped PATH: a tagged instance must resolve "hermes" from its OWN
# copied runtime tree. The DEFAULT home's venv is deliberately kept off a
# tagged instance's PATH — otherwise every spawned instance would execute the
# default install's code and all of them would share a single runtime.
if [ -n "${tag}" ]; then
  export PATH="\${HH}/hermes-agent/venv/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
else
  export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
fi
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "\${HH}/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes" "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | tail -1 | cut -c1-40)"
echo "VERSION=$VER"
CODE=0; [ -d "$HH/hermes-agent" ] && CODE=1
echo "CODE=$CODE"
CFG=0; [ -f "$HH/config.yaml" ] && CFG=1
echo "CONFIG=$CFG"
ENVF=0; [ -f "$HH/.env" ] && ENVF=1
echo "ENVFILE=$ENVF"
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
${procScan(tag)}
GSTAT=0; if [ "$PROC" = 0 ] && [ -n "$BIN" ]; then timeout 15 "$BIN" gatew""ay status 2>/dev/null | grep -q 'is running' && GSTAT=1; fi
[ "$GSTAT" = 1 ] && PROC=1
echo "PROC=$PROC"
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
PROCP=0; command -v pgrep >/dev/null 2>&1 && PROCP=1
echo "SYSTEMD=$SYSTEMD"; echo "SUDO=$SUDO"
echo "GIT=$GIT"; echo "CURL=$CURLP"; echo "XZ=$XZ"; echo "ATOMIC=$ATOMIC"; echo "CXX=$CXX"; echo "TAR=$TARP"; echo "PROCP=$PROCP"
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

    // ── Multi-instance support: optional instance tag ──
    // instance '' → default install (~/.hermes); tag → ~/.hermes-<tag> with
    // its own HERMES_HOME, service identity, pidfile, env, and bot token.
    // parseInst reads body.instance → body.config.instance → body.config.tag
    // (the `spawn-instance` action sends config.tag), so a spawned instance is
    // actually targeted instead of silently hitting the default install.
    const inst = parseInst(body);
    const HH = inst ? `$HOME/.hermes-${inst}` : `$HOME/.hermes`;
    const HERMES_ENV = inst ? `export HERMES_HOME=$HOME/.hermes-${inst};` : '';

    // ── Per-instance isolation ─────────────────────────────────────────────
    // HERMES_HOME relocates config/.env/memories/logs, but Hermes keeps the
    // kanban board, terminal sandbox, OAuth file and Codex home on SHARED
    // absolute paths, and every instance would bind the same API server port.
    // instanceIsolationEnv pins all of them inside this instance's home, and
    // instancePorts gives it its own listening ports.
    const [GW_API_PORT, GW_HOOK_PORT] = instancePorts('hermes', inst);
    const ISO_ENV = instanceIsolationEnv('hermes', inst, HH);
    // instance.env is consumed by BOTH start paths: the systemd template unit
    // (EnvironmentFile=-%h/.hermes-%i/instance.env) and the legacy nohup start
    // (set -a; . instance.env), so isolation holds regardless of supervisor.
    // It is re-synced before every start so a pre-existing instance picks up
    // the current allocation too.
    const syncInstanceEnv = async (label) => {
      if (!inst) return { ok: true, skipped: true };
      const w = await writeInstanceEnv(sshConfig, HH, ISO_ENV, { expand: true });
      if (!w.ok) log.push(`> [isolation] WARNING: could not write ${HH}/instance.env (${label}) — this instance may share state with siblings.`);
      return w;
    };

    // instance liveness: pidfile-first (fast) + systemd fallback (default).
    // kill -0 alone can false-positive after PID reuse, so the process cmdline
    // is verified to point inside this instance home (".hermes-<tag>").
    const pidScan = `res=0;` +
      ` pid=$(cat "${HH}/daemon.pid" 2>/dev/null);` +
      ` if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= 2>/dev/null | grep -qF ".hermes${inst ? `-${inst}` : ''}"; then res=1; fi;` +
      ` if [ "$res" = 0 ] && [ -z "${inst}" ]; then` +
      ` systemctl --user is-active hermes-gate\\way 2>/dev/null | grep -qx active && res=1;` +
      ` systemctl is-active hermes-gate\\way 2>/dev/null | grep -qx active && res=1;` +
      ` fi;` +
      ` if [ "$res" = 0 ] && [ -n "${inst}" ]; then` +
      ` export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; systemctl --user is-active hermes-gate""way@${inst} 2>/dev/null | grep -qx active && res=1;` +
      ` fi;` +
      // Last resort: ask hermes itself — it reports "is running" only when the
      // control socket is actually live (its exit code is 0 either way, so we
      // must match the output, NOT the exit status).
      ` if [ "$res" = 0 ]; then` +
      ` export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; ${inst ? `export HERMES_HOME=$HOME/.hermes-${inst};` : ''} timeout 15 hermes gatew""ay status 2>/dev/null | grep -q 'is running' && res=1;` +
      ` fi;` +
      ` echo "PID_ALIVE=$res"`;
    const pidAlive = async () => {
      const r = await execCommand(sshConfig, pidScan, { pool: false, timeoutMs: 15000 });
      return /PID_ALIVE=1/.test(r.stdout || '');
    };
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
    // Shared .env upsert (see buildEnvUpsertPy) — identical writer for install
    // and reconfigure so secrets cannot diverge between the two paths.
    const runEnvUpsert = (entries, label) => run(label,
      `${HERMES_ENV} echo '${b64(buildEnvUpsertPy(entries))}' | base64 -d | python3`, { timeoutMs: 30000 });
    const hasPersistedEnvKey = async (key) => {
      const keyCheck = b64(key);
      const result = await execCommand(sshConfig,
        `${HERMES_ENV} test -f "${HH}/.env" && KEY="$(echo '${keyCheck}' | base64 -d)" awk -F= '$1 == ENVIRON["KEY"] && length($2) > 0 { found=1 } END { exit found ? 0 : 1 }' "${HH}/.env"`,
        { pool: false, timeoutMs: 15000 });
      return result.code === 0;
    };

    // ── Per-instance systemd template unit (Hermes) ─────────────────────────
    // Instances run as their own user-level cgroup (Restart=on-failure,
    // NoNewPrivileges, PrivateTmp) via hermes-gateway@<tag>. Returns null when
    // unavailable/failed so the legacy pidfile+nohup flow takes over.
    const sdHermesBranch = async (operation) => {
      if (!inst || !(await sdAvailable(sshConfig))) return null;
      // Refresh instance.env before the unit is (re)started so the running
      // process always picks up this instance's ports and pinned paths.
      if (operation !== 'status' && operation !== 'stop') await syncInstanceEnv(`systemd ${operation}`);
      await ensureInstanceUnit(sshConfig, 'hermes', gatewayUnit('hermes', {
        description: 'Hermes gateway',
        envLines: [
          // Order matters: systemd applies these in order, so the files are
          // loaded first and the authoritative Environment= lines below win.
          // Hermes keeps provider keys in .env. Load it directly so a
          // systemd-managed spawned instance receives OPENROUTER_API_KEY and
          // its own messenger credentials after reconfigure/install.
          'EnvironmentFile=-%h/.hermes-%i/.env',
          // Per-instance isolation (ports + pinned shared-state paths).
          'EnvironmentFile=-%h/.hermes-%i/instance.env',
          // HERMES_HOME is derived from %i so it stays correct even if
          // instance.env is missing or stale — a stale file must never be able
          // to point this unit at another instance's home.
          'Environment=HERMES_HOME=%h/.hermes-%i',
          // The instance's OWN venv comes first: a tagged instance must resolve
          // `hermes` from its copied runtime tree, never the shared/global one.
          'Environment=PATH=%h/.hermes-%i/hermes-agent/venv/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin',
        ],
        execStart: `/bin/sh -c 'exec "$([ -x %h/.hermes-%i/hermes-agent/venv/bin/hermes ] && echo %h/.hermes-%i/hermes-agent/venv/bin/hermes || command -v hermes || echo %h/.local/bin/hermes)" gatew''ay run'`,
        logFile: '%h/.hermes-%i/logs/gateway.log',
      }));
      return sdInstanceCtl(sshConfig, 'hermes', inst, operation);
    };

    // ── Gateway control helper — never blocks ────────────────────────────────
    // Uses systemctl only when systemd is genuinely PID 1; otherwise falls back
    // to pkill + detached nohup start. Every remote call is wrapped in `timeout`
    // so a stuck hermes CLI can never hang the request.
    const gwCtl = async (op) => {
      // Instances: systemd-first for start/restart (own cgroup + supervision).
      // stop is belt-and-braces: systemd stop + legacy pidfile kill, so an
      // instance started via the legacy nohup path is still stopped cleanly.
      if (inst) {
        if (op === 'stop') {
          const sd = await sdHermesBranch('stop');
          const legacy = await legacyGwCtl(op);
          return {
            ok: (sd ? sd.ok : false) || legacy.ok,
            out: `${sd ? `systemd:${sd.out || 'ok'} ` : ''}${legacy.out}`,
          };
        }
        if (op !== 'status') {
          const sd = await sdHermesBranch(op);
          if (sd) return sd;
          // systemd is unavailable → the legacy nohup path runs instead.
          // Refresh instance.env so this start inherits the same isolation.
          await syncInstanceEnv(`legacy ${op}`);
        }
      }
      return legacyGwCtl(op);
    };

    const legacyGwCtl = async (op) => {
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
      // Per-instance binary isolation (zeroclaw blueprint): an instance runs
      // its OWN copied hermes-agent tree from its home when present, so it
      // keeps working even after the default install is uninstalled.
      if (inst) {
        const localBin = `${HH}/hermes-agent/venv/bin/hermes`;
        const lb = await execCommand(sshConfig, `[ -x \"${localBin}\" ] && echo LOCAL_BIN=1 || true`, { pool: false, timeoutMs: 15000 });
        if (/LOCAL_BIN=1/.test(lb.stdout || '')) {
          return gwCtlHost(op, localBin, sysdLive);
        }
      }
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
        const binDir = JSON.stringify(binPath.replace(/\/\/[^/]+$/, ''));
        const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export PATH=${binDir}:$PATH`;
        // pidfile-scoped lifecycle (DEFAULT and tagged instances alike).
        // Every hermes gateway is tracked by $HH/daemon.pid. We never use
        // pkill/pgrep -f here - that matches every hermes process on the box,
        // so stopping one instance would silently stop the others (mirror).
        const PIDF = `${HH}/daemon.pid`;
        const HHX = inst ? `export HERMES_HOME=${HH}; ` : '';
        const SYS_ACTIVE = `(systemctl --user is-active hermes-gate""way 2>/dev/null || systemctl is-active hermes-gate""way 2>/dev/null) | grep -qx active`;
        if (operation === 'status') {
          return execCommand(sshConfig, `${ENVX}; ${HHX}if [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null; then echo PROC_ACTIVE; elif ${SYS_ACTIVE}; then echo PROC_ACTIVE;  else echo NO_PROC; fi`, { pool: false, timeoutMs: 30000 })
            .then(r => ({ ok: true, active: /PROC_ACTIVE/.test(r.stdout || '') }));
        }
        if (operation === 'stop') {
          const sysdStop = sysd ? `timeout 25 systemctl stop hermes-gate""way 2>/dev/null; timeout 25 systemctl --user stop hermes-gate""way 2>/dev/null; ` : '';
          return execCommand(sshConfig, `${ENVX}; ${HHX}${sysdStop} if [ -f "${PIDF}" ]; then kill -9 $(cat "${PIDF}") 2>/dev/null; rm -f "${PIDF}"; fi; echo GW_STOPPED`, { pool: false, timeoutMs: 60000 })
            .then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
        }
        const preStop = (op === 'restart' || operation === 'restart') ? `if [ -f "${PIDF}" ]; then kill -9 $(cat "${PIDF}") 2>/dev/null; rm -f "${PIDF}"; sleep 1; fi; ` : '';
        // instance.env is sourced FIRST so the pinned isolation paths and the
        // per-instance ports are in the environment; .env is sourced after so a
        // user-set variable in .env still wins.
        const startBackground = `mkdir -p "${HH}/logs"; ${HHX}setsid nohup sh -c 'set -a; [ -f "${HH}/instance.env" ] && . "${HH}/instance.env"; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; exec ${JSON.stringify(binPath)} gateway run || exec ${JSON.stringify(binPath)} gateway' >> "${HH}/logs/gateway-nohup.log" 2>&1 < /dev/null & echo $! > "${PIDF}"; sleep 4; if kill -0 $(cat "${PIDF}") 2>/dev/null; then echo 'GW_UP'; else echo GW_DOWN; tail -5 "${HH}/logs/gateway-nohup.log" 2>/dev/null; fi`;
        // Start, with self-healing: hermes tracks its own lifecycle via the
        // control socket, so a gateway the monitor cannot see (stale pidfile,
        // process started outside the monitor) makes `start` refuse with
        // "Another gateway instance is already running". In that case fall
        // back to `gateway restart` which replaces it cleanly.
        const startAliveCheck = `${ENVX}; ${HHX}sleep 3; if [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null; then echo ALIVE; elif ${SYS_ACTIVE}; then echo ALIVE; elif pgrep -f '[h]ermes.*gatew[a]y' >/dev/null 2>&1; then echo ALIVE; else echo DEAD; fi`;
        const finishStart = async (r) => {
          const out = r.stdout || '';
          if (/GW_UP/.test(out)) return { ok: true, out: out.slice(-200) };
          if (/already running/i.test(out)) {
            const r2 = await execCommand(sshConfig,
              `${ENVX}; ${HHX}timeout 90 ${JSON.stringify(binPath)} gateway restart 2>&1 || ${startBackground}`,
              { pool: false, timeoutMs: 120000 });
            const chk = await execCommand(sshConfig, startAliveCheck, { pool: false, timeoutMs: 30000 });
            const ok = /ALIVE/.test(chk.stdout || '');
            return { ok, out: (`auto-replaced running instance: ` + (r2.stdout || out)).slice(-300) };
          }
          return { ok: false, out: out.slice(-300) };
        };
        if (sysd) {
          const v2 = op === 'restart' ? 'try-restart' : 'start';
          return execCommand(sshConfig,
            `${ENVX}; ${preStop}timeout 40 systemctl ${v2} hermes-gate""way 2>/dev/null || timeout 40 systemctl --user ${verb || 'start'} hermes-gate""way 2>/dev/null || ${startBackground}`,
            { pool: false, timeoutMs: 120000 }).then(finishStart);
        }
        return execCommand(sshConfig, `${ENVX}; ${preStop}${startBackground}`, { pool: false, timeoutMs: 90000 })
          .then(finishStart);
      }
      async function gwCtlExec(operation, cbin) {
        const CB = JSON.stringify(cbin);
        if (operation === 'status') {
          const r = await execCommand(sshConfig, `docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo ACTIVE || echo INACTIVE`, { pool: false, timeoutMs: 30000 });
          return { ok: true, active: /ACTIVE/.test(r.stdout || '') };
        }
        if (operation === 'stop') {
          const r = await execCommand(sshConfig, `timeout 15 docker exec hermes-agent pkill -f '[h]ermes.*gatew[a]y'; echo GW_STOPPED`, { pool: false, timeoutMs: 45000 });
          return { ok: /GW_STOPPED/.test(r.stdout || ''), out: (r.stdout || '').slice(-300) };
        }
        if (operation === 'restart') {
          await execCommand(sshConfig, `docker exec hermes-agent pkill -f '[h]ermes.*gatew[a]y' 2>/dev/null; sleep 2; echo KILLED`, { pool: false, timeoutMs: 45000 });
        }
        const r = await execCommand(sshConfig,
          // Same self-match guard as the host path: the literal `gateway run`
          // sits on this very command line, so it is split (`gatew""ay`).
          `docker exec -d hermes-agent bash -c 'mkdir -p /root/.hermes/logs && PATH=/usr/local/bin:/usr/bin:/bin:$PATH nohup sh -c "exec ${JSON.stringify(cbin)} gatew""ay run || exec ${JSON.stringify(cbin)} gatew""ay" >> /root/.hermes/logs/gateway-nohup.log 2>&1 < /dev/null &' && sleep 3 && docker exec hermes-agent pgrep -f '[h]ermes.*gatew[a]y' >/dev/null && echo GW_STARTED`,
          { pool: false, timeoutMs: 60000 });
        return { ok: /GW_STARTED/.test(r.stdout || ''), out: (r.stdout || '').slice(-200) };
      }
    };
    // ── Multi-instance: list + spawn ────────────────────────────────────────
    if (action === 'instances') {
      // List installed instances: ~/.hermes (default) + any ~/.hermes-<tag>
      const r = await execCommand(sshConfig, `
          DEFAULT_EXISTS=0; [ -d "$HOME/.hermes" ] && DEFAULT_EXISTS=1\nPROC=0; [ -f "$HOME/.hermes/daemon.pid" ] && kill -0 $(cat "$HOME/.hermes/daemon.pid") 2>/dev/null && PROC=1\n{ systemctl --user is-active hermes-gate\\way 2>/dev/null || systemctl is-active hermes-gate\\way 2>/dev/null; } | grep -qx active && PROC=1\necho "PROC=$PROC"
echo "DEFAULT_EXISTS=$DEFAULT_EXISTS"
for d in "$HOME"/.hermes-*; do
  [ -d "$d" ] || continue
  tag="$(basename "$d")"
  echo "INSTANCE_DIR=\${tag#.hermes-}"
done
for d in "$HOME"/.hermes-*; do
  [ -d "$d" ] || continue
  tag="$(basename "$d")"
  PIDF="$d/daemon.pid"
  RUN=0; [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && RUN=1
  if [ "$RUN" = 0 ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
    systemctl --user is-active "hermes-gate""way@\${tag#.hermes-}" 2>/dev/null | grep -qx active && RUN=1
  fi
  echo "TAGRUN=\${tag#.hermes-}:$RUN"
done
`, { pool: true, timeoutMs: 20000 });
      const out = r.stdout || '';
      const instances = [];
      if (/DEFAULT_EXISTS=1/.test(out)) instances.push({ tag: '', running: /PROC=1/.test(out) });
      for (const m of out.matchAll(/TAGRUN=([^:\n]+):(\d)/g)) {
        instances.push({ tag: m[1], running: m[2] === '1' });
      }
      return NextResponse.json({ success: true, instances });
    }

    if (action === 'spawn-instance') {
      // Clone only non-secret identity/config files into a new HERMES_HOME.
      // The instance intentionally gets an EMPTY .env (own credentials) but a
      // VALID config.yaml cloned from the default — a 0-byte config.yaml makes
      // the gateway unable to validate/persist pairing (codes report "expired")
      // and leaves it without any model/telegram baseline. The wizard then
      // overrides model/token on the instance only.
      const tag = String((config && config.tag) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (!tag) return NextResponse.json({ success: false, error: 'Instance tag is required' }, { status: 400 });
      const r = await execCommand(sshConfig, `
if [ -d "$HOME/.hermes-${tag}" ]; then
  echo "EXISTS"
else
  # Fresh instance home with a valid default config.yaml (non-secret baseline).
  # .env is the ONLY thing kept empty — credential isolation stays intact, but
  # the gateway can start, persist pairing, and respond from the very first boot.
  mkdir -p "$HOME/.hermes-${tag}" "$HOME/.hermes-${tag}/logs" "$HOME/.hermes-${tag}/memories" "$HOME/.hermes-${tag}/workspace" "$HOME/.hermes-${tag}/skills" "$HOME/.hermes-${tag}/sessions" "$HOME/.hermes-${tag}/kanban"
  if [ -s "$HOME/.hermes/config.yaml" ]; then
    cp "$HOME/.hermes/config.yaml" "$HOME/.hermes-${tag}/config.yaml"
  else
    : > "$HOME/.hermes-${tag}/config.yaml"
  fi
  : > "$HOME/.hermes-${tag}/.env"
  echo CLONED_FRESH
fi
chmod 700 "$HOME/.hermes-${tag}" 2>/dev/null || true
chmod 600 "$HOME/.hermes-${tag}/.env" 2>/dev/null || true
chmod 600 "$HOME/.hermes-${tag}/config.yaml" 2>/dev/null || true
`, { pool: false, timeoutMs: 30000 });
      if (!/CLONED_FRESH|EXISTS/.test(r.stdout || '')) {
        return NextResponse.json({ success: false, error: 'Failed to clone instance home: ' + ((r.stdout || '') + (r.stderr || '')).slice(-200), log });
      }
      const existed = /EXISTS/.test(r.stdout || '');
      // Persist this instance's isolation contract — its own listening ports and
      // every shared-state path pinned inside its own home — BEFORE it ever
      // starts, so the first boot is already isolated.
      await syncInstanceEnv('spawn');
      // Copy the hermes runtime tree into the instance home so it runs its OWN
      // binary (zeroclaw-style) — uninstalling the default won't break it.
      let binCopy = null;
      if (!existed) {
        const cp = await copyInstanceBin(sshConfig, 'hermes', tag, `$HOME/.hermes-${tag}`);
        binCopy = cp.err || (cp.copied ? 'own binary copied' : cp.already ? 'own binary already present' : 'no source to copy');
      }
      return NextResponse.json({
        success: true,
        instance: tag,
        existed,
        started: false,
        needsConfiguration: true,
        output: existed
          ? `Instance "${tag}" already exists and is waiting for configuration.`
          : `Instance "${tag}" is ready to configure. ${binCopy}. Add its own provider API key and messenger token, then install/reconfigure to start the gateway.`,
        log,
      });
    }

    if (action === 'status') {
      const r = await execCommand(sshConfig, statusScript(inst), { pool: true, timeoutMs: 30000 });
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
      // Instance uninstall must never kill other instances (broad pkill
      // matches every hermes gateway on the box), touch the shared systemd
      // unit, or remove the shared binary — only its own pidfile & home.
      if (inst) {
        // A systemd-managed template unit can recreate its home on restart.
        // Disable it first, then retain the pidfile cleanup for legacy nohup instances.
        await sdInstanceCtl(sshConfig, 'hermes', inst, 'stop');
        await run('stop instance (pidfile-scoped)', `if [ -f "${HH}/daemon.pid" ]; then p=$(cat "${HH}/daemon.pid"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${HH}/daemon.pid"; fi; true`);
      } else {
        await run('stop system service', `(sudo -n systemctl disable --now hermes-gate""way 2>/dev/null || systemctl disable --now hermes-gate""way 2>/dev/null); true`);
        await run('stop user service', `export XDG_RUNTIME_DIR="/run/user/$(id -u)"; systemctl --user disable --now hermes-gate""way 2>/dev/null; true`);
        // Selective stray-kill: only default gateways (no per-instance home), so
        // spawned instances survive a default stop/uninstall (zeroclaw blueprint).
        await run('stop stray processes', `for p in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes-agent/hermes' 2>/dev/null); do grep -qaE 'HERMES_HOME=.+\.hermes-[^ /]' /proc/$p/environ 2>/dev/null || kill -9 $p 2>/dev/null; done; true`);
        // Remove isolated Docker container (if any); data volume kept unless purge.
        await run('remove docker container', `command -v docker >/dev/null 2>&1 && docker rm -f hermes-agent 2>/dev/null; ${purge ? `rm -rf "$HOME/.hermes-docker" 2>/dev/null;` : ''} true`);
      }
      // Share the globally-installed binary/venv. Removing it while any instance
      // still exists breaks restart for those instances — skip when siblings remain.
      let instancesRemain = false;
      if (!inst) {
        try {
          const instList = await listInstances(sshConfig, 'hermes');
          instancesRemain = Array.isArray(instList) && instList.length > 0;
        } catch { /* non-fatal */ }
      }
      const binRm = (inst || (instancesRemain && !purge))
        ? '' // non-purge keeps the binary for surviving instances; purge wipes them first
        : `rm -f "$HOME/.local/bin/hermes" /usr/local/bin/hermes; `;
      const libRm = purge && !inst && !instancesRemain ? ' /usr/local/lib/hermes-agent' : '';
      // Full purge of the DEFAULT also wipes every instance home (and kills
      // their daemons) so uninstall is genuinely clean — no orphan entries.
      // Full purge kills EVERY gateway (default + instances) and wipes every
      // instance home. $$ exclusion: the script's own bash -c cmdline contains
      // the pgrep pattern — without excluding it the loop kills itself.
      const instWipe = (!inst && purge)
        ? `for p in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null); do [ "$p" = "$$" ] && continue; kill -9 $p 2>/dev/null; done; rm -rf "$HOME/.hermes-"* 2>/dev/null; `
        : '';
      // Safety net: keep the current .env outside the home dir so a subsequent
      // fresh install can restore keys the user forgot to re-enter (the wizard
      // form starts empty, and One-Click Reinstall would otherwise destroy a
      // working provider key).
      await run('backup .env (survives purge)', `cp "${HH}/.env" "${HH}.env.bak" 2>/dev/null; cp "${HH}/config.yaml" "${HH}.config.yaml.bak" 2>/dev/null; true`);
      const rmCmd = inst
        ? `rm -rf "${HH}"; [ ! -e "${HH}" ] && echo REMOVED_INSTANCE || { echo INSTANCE_HOME_REMAINS; exit 1; }`   // instances: always remove the whole isolated home
        : purge
          ? `${instWipe}${binRm}rm -rf "${HH}"${libRm}; echo REMOVED_ALL`
          : `${binRm}rm -rf "${HH}/hermes-agent"${libRm}; echo REMOVED_CODE`;
      const r = await run(inst ? 'remove instance (isolated home)' : purge ? 'remove binary, code & all config' : 'remove binary & code (config kept)', rmCmd);
      const ok = /REMOVED/.test(r.stdout || '');
      return NextResponse.json({ success: ok, purged: purge, log });
    }

    // ── DETAILS / CONFIG / SKILLS / GATEWAY MANAGEMENT ────────────────────
    if (action === 'details') {
      const DETAILS_SCRIPT = `
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
BIN="$(command -v hermes 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes" "${HH}/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/venv/bin/hermes" "/usr/local/lib/hermes-agent/hermes"; do [ -x "$p" ] && BIN="$p" && break; done
echo "===CONFIG_B64==="
base64 < "${HH}/config.yaml" 2>/dev/null || true
echo "===ENV_B64==="
base64 < "${HH}/.env" 2>/dev/null || true
echo "===ENVKEYS==="
grep -E '^[A-Z_]+=' "${HH}/.env" 2>/dev/null | cut -d= -f1 || true
echo "===SKILLS==="
# Hermes nests skills as skills/<category>/<skill-name>/; also support flat
# skills/<skill-name>/ installs. Emit skill NAMES (not category folders).
{ for d in "${HH}/skills"/*/; do
    [ -d "$d" ] || continue
    for s in "$d"*/; do
      [ -d "$s" ] || continue
      basename "$s"
    done
  done
  for s in "${HH}/skills"/*/; do
    [ -d "$s" ] || continue
    [ -f "\${s}SKILL.md" ] && basename "$s"
  done
} 2>/dev/null | sort -u | grep -v '^$' || true
echo "===PROMPT_B64==="
{ base64 < "${HH}/custom_instructions.txt" || base64 < "${HH}/prompt.txt" || base64 < "${HH}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${HH}/SOUL.md" || base64 < "${HH}/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
{ base64 < "${HH}/USER.md" || base64 < "${HH}/memories/USER.md"; } 2>/dev/null || true
echo "===AGENTS_B64==="
base64 < "${HH}/AGENTS.md" 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${HH}/MEMORY.md" || base64 < "${HH}/memories/MEMORY.md"; } 2>/dev/null || true
echo "===RUNNING==="
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active hermes-gate""way 2>/dev/null | grep -qx active && SSVC=1
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hermes-gate""way 2>/dev/null | grep -qx active && USVC=1
${procScan(inst)}
SYSTEMD=0; command -v systemctl >/dev/null 2>&1 && SYSTEMD=1
echo "SSVC=$SSVC"; echo "USVC=$USVC"; echo "PROC=$PROC"; echo "SYSTEMD=$SYSTEMD"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | tail -1 | cut -c1-40
echo "===MODEL==="
MDL="$( [ -n "$BIN" ] && "$BIN" config get model 2>/dev/null | tail -1 || true )"
[ -z "$MDL" ] && MDL="$(grep -E '^model:' "${HH}/config.yaml" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' | tr -d "'")"
[ -z "$MDL" ] && MDL="$(grep -E '^(MODEL|HERMES_MODEL|DEFAULT_MODEL)=' "${HH}/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
echo "$MDL"
`;
      const r = await execCommand(sshConfig, DETAILS_SCRIPT, { pool: true, timeoutMs: 60000 });
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
        { pool: true, timeoutMs: 30000 });
      const dout = binR2.stdout || '';
      const remoteBinPath = (dout.match(/BIN=(.*)/)?.[1] || dout.match(/CBIN=(.*)/)?.[1] || '').trim();
      const installed = !!remoteBinPath;
      let running = /SSVC=1|USVC=1|PROC=1/.test(section('RUNNING', 'VERSION')) || (installed && /PROC=1/.test(section('RUNNING', 'VERSION')));
      running = (await pidAlive()) === true; // pidfile-scoped (never pgrep, which matches other instances)
      return NextResponse.json({
        success: true,
        installed,
        version: section('VERSION', 'MODEL') || null,
        model: section('MODEL') || null,
        running,
        binPath: remoteBinPath || null,
        service: /SSVC=1/.test(out) ? 'system' : /USVC=1/.test(out) ? 'user' : /PROC=1/.test(out) ? 'process' : null,
        hasSystemd: /SYSTEMD=1/.test(section('RUNNING', 'VERSION')),
        // Intentionally NOT masked: these fields round-trip through the config
        // editor. Returning masked placeholders ("••••") would make the UI
        // persist them straight back into config.yaml on save and corrupt it.
        // Masking needs a UI contract change first — either a separate
        // read-only masked field, or a sentinel value that save-config rejects.
        // Matches zeroclaw's current behaviour. See AGENT_PARITY_AUDIT.md.
        configYaml,
        // Field-name drift: the shared config editor reads `configJson`
        // (zeroclaw returns configJson) — return the same content under BOTH
        // names so either consumer works.
        configJson: configYaml,
        envText,
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
      let SCRIPT = `mkdir -p "${HH}" "${HH}/memories"\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/SOUL.md"\necho "${b64}" | base64 -d > "${HH}/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/USER.md"\necho "${b64}" | base64 -d > "${HH}/memories/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/MEMORY.md"\necho "${b64}" | base64 -d > "${HH}/memories/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/custom_instructions.txt"\necho "${b64}" | base64 -d > "${HH}/prompt.txt"\necho "${b64}" | base64 -d > "${HH}/SYSTEM_PROMPT.md"\n`;
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
      const requiredProviderKey = providerEnvKey(config && config.provider);
      const targetModel = settings.model || settings.default_model || env.MODEL || env.HERMES_MODEL || env.DEFAULT_MODEL || '';
      // NOTE: the model is persisted as a config setting only. It used to be
      // copied into env.MODEL too, but model ids are lowercase/slashed and were
      // rejected by the env-name validation below.
      if (targetModel) {
        settings.model = targetModel;
      }

      // ── Custom OpenAI-compatible endpoint (wizard "Custom…" provider) ──
      // Writes CUSTOM_LLM_API_KEY + OPENAI_BASE_URL. hermes routes custom
      // endpoints through its model.provider / model.base_url block and reads the
      // provider's API key env var. Map the wizard's custom fields into the
      // proper hermes provider + env key so the endpoint is actually used.
      const customKey = String(env.CUSTOM_LLM_API_KEY || '').trim()
        || String(env.CUSTOM_API_KEY || env.OPENAI_API_KEY || '').trim();
      const customBaseUrl = String(env.OPENAI_BASE_URL || env.OPENAI_API_BASE || '').trim();
      let customProvider = null;
      if (customBaseUrl && targetModel) {
        // Z.ai / GLM endpoint → native zai provider (env GLM_API_KEY|ZAI_API_KEY).
        // Anything else → generic openai-compatible provider (env OPENAI_API_KEY).
        customProvider = /z\.ai|api\.bigmodel|zhipu/i.test(customBaseUrl) ? 'zai' : 'openai';
        if (customKey) {
          const provKey = customProvider === 'zai' ? 'ZAI_API_KEY' : 'OPENAI_API_KEY';
          env[provKey] = customKey;          // hermes reads this for the provider
          env.CUSTOM_LLM_API_KEY = customKey;  // keep the wizard's original key too
        }
      }
      const envKeys = Object.keys(env).filter(k => env[k] != null && env[k] !== '');
      const invalidEnvKey = envKeys.find(k => !/^[A-Z][A-Z0-9_]*$/.test(k));
      if (invalidEnvKey) {
        return NextResponse.json({ success: false, error: `Invalid environment variable name: ${invalidEnvKey}` }, { status: 400 });
      }
      const hasSettings = Object.keys(settings).filter(k => settings[k] != null && settings[k] !== '').length > 0;
      if (envKeys.length === 0 && !hasSettings) {
        return NextResponse.json({ success: false, error: 'No settings or env keys to update' }, { status: 400 });
      }
      // A spawned/fresh instance has no previous credentials. Allow a
      // messenger-only update only when the selected provider key is already
      // safely present in this instance's .env; otherwise do not restart an
      // unusable gateway.
      if (requiredProviderKey && !String(env[requiredProviderKey] || '').trim()) {
        if (!(await hasPersistedEnvKey(requiredProviderKey))) {
          return NextResponse.json({
            success: false,
            error: `${requiredProviderKey} is required before this gateway can start. Paste the selected model provider API key and try again.`,
          }, { status: 400 });
        }
      }
      if (envKeys.length > 0) {
        const envTargetLabel = inst ? `~/.hermes-${inst}/.env` : '~/.hermes/.env';
        const w = await runEnvUpsert(envKeys.map(k => [k, env[k]]), `write ${envTargetLabel}`);
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: `Failed to write ${envTargetLabel}`, log });
        }
      }

      // also merge settings (model, platform toggles) into config.yaml if provided
      if (hasSettings) {
        const setB64 = b64(JSON.stringify(settings));
        const cfgTargetLabel = inst ? `~/.hermes-${inst}/config.yaml` : '~/.hermes/config.yaml';
        await run(`merge ${cfgTargetLabel} settings`, `${HERMES_ENV}
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
          python3 - <<'PY' 2>/dev/null || true
import json, os, base64, re
path = (os.environ.get('HERMES_HOME') or os.path.expanduser('~/.hermes')) + '/config.yaml'
if not os.path.exists(path):
    open(path, 'w').close()
new = json.loads(base64.b64decode('${setB64}').decode('utf-8'))
text = open(path).read() if os.path.getsize(path) else ''
for k, v in (new.items() if isinstance(new, dict) else []):
    sval = 'true' if v is True else ('false' if v is False else str(v))
    if re.search(rf'^{re.escape(k)}:', text, re.M):
        text = re.sub(rf'^{re.escape(k)}:.*$', f'{k}: {sval}', text, count=1, flags=re.M)
    else:
        text += f'\\n{k}: {sval}\\n'
open(path, 'w').write(text)
print('SETTINGS_MERGED')
PY`, { timeoutMs: 30000 });
      }

      // Sync active model to hermes CLI directly
      if (targetModel) {
        await execCommand(sshConfig, `
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
          HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
          ${HERMES_ENV} $HB config set model.default ${JSON.stringify(targetModel)} 2>&1 || true
          command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && docker exec hermes-agent hermes config set model.default ${JSON.stringify(targetModel)} 2>&1 || true
        `, { pool: false, timeoutMs: 30000 });
      }

      // Custom endpoint → point hermes' model block at the custom provider/URL.
      // `hermes config set model.<nested>` supports dotted paths (verified).
      if (customProvider && customBaseUrl) {
        const esc = (v) => JSON.stringify(v);
        await execCommand(sshConfig, `
          export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
          HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
          ${HERMES_ENV} $HB config set model.provider ${esc(customProvider)} 2>&1 || true
          ${HERMES_ENV} $HB config set model.base_url ${esc(customBaseUrl)} 2>&1 || true
          ${HERMES_ENV} $HB config set model.default ${esc(targetModel)} 2>&1 || true
        `, { pool: false, timeoutMs: 30000 });
      }

      // restart gateway
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'restart' : null, error: g.ok ? null : g.error, log });
    }

    if (action === 'save-config') {
      // Accept every name the config editors post (zeroclaw: configJson →
      // configToml → configYaml) so a shared component posting `configJson`
      // no longer gets a 400 "content is empty".
      const yaml = String(config.configJson ?? config.configToml ?? config.configYaml ?? '');
      if (!yaml.trim()) return NextResponse.json({ success: false, error: 'config.yaml content is empty' }, { status: 400 });
      await execCommand(sshConfig, `
        cp "${HH}/config.yaml" "${HH}/config.yaml.bak-$(date +%s)" 2>/dev/null || true
        echo '${b64(yaml)}' | base64 -d > "${HH}/config.yaml.new"
        mv "${HH}/config.yaml.new" "${HH}/config.yaml"
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
            `BAK="$(ls -1t "${HH}"/config.yaml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${HH}/config.yaml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
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
for f in "${HH}/logs/gatew""ay.log" "${HH}/logs/gatew""ay-nohup.log" "${HH}-docker/logs/gatew""ay.log" "${HH}-docker/logs/gatew""ay-nohup.log"; do
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
# Resolve the PID from this instance's OWN pidfile first. A bare
# "pgrep -f '[h]ermes.*gatew[a]y' | head -1" matches EVERY instance on the box
# and would report a sibling's uptime for this one.
PID=""
[ -f "${HH}/daemon.pid" ] && PID=$(cat "${HH}/daemon.pid" 2>/dev/null)
if [ -z "$PID" ]; then
  for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null); do
    HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
    [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
    # Unattributable process: only the DEFAULT install may adopt it.
    if [ -z "$HME" ]; then ${inst ? 'continue' : 'PID="$hp"; break'}; fi
    case "$HME" in *".hermes${inst ? '-' + inst : ''}") PID="$hp"; break ;; esac
  done
fi
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=unknown
LOGL=""
for f in "${HH}/logs/gatew""ay.log" "${HH}/logs/gatew""ay-nohup.log" "${HH}-docker/logs/gatew""ay.log" "${HH}-docker/logs/gatew""ay-nohup.log"; do
  [ -f "$f" ] && [ -s "$f" ] && LOGL="$f" && break
done
if [ -n "$LOGL" ]; then
  if tail -n 400 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling mode|channel enabled|connected|sending)'; then
    TG=connected
  fi
  if tail -n 50 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
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
      let alive = gv('ALIVE') === '1';
      alive = (await pidAlive()) === true; // pidfile-scoped (never pgrep, which matches other instances)
      return NextResponse.json({
        success: true,
        alive,
        instance: inst || 'default',
        uptimeSec: Number(gv('UPTIME_SEC') || 0),
        telegram: gv('TG') || 'unknown',
        errorCount: Number(gv('ERRCOUNT') || 0),
        recentErrors,
      });
    }

    // ── PAIRING APPROVAL ──
    if (action === 'pairing-approve') {
      const platform = String(config.platform || '').trim();
      const code = String(config.code || '').trim();
      if (!code) return NextResponse.json({ success: false, error: 'Pairing code is required' }, { status: 400 });
      const binR = await execCommand(sshConfig,
        `p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "${HH}/hermes-agent/venv/bin/hermes"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,
        { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || 'hermes';
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="${HH}/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; ${HERMES_ENV} set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a`;
      const runCmd = platform && platform !== 'auto'
        ? `${ENVX}; ${BP} pairing approve ${JSON.stringify(platform)} ${JSON.stringify(code)} 2>&1 || ${BP} pairing approve ${JSON.stringify(code)} 2>&1`
        : `${ENVX}; ${BP} pairing approve ${JSON.stringify(code)} 2>&1 || ${BP} pairing approve telegram ${JSON.stringify(code)} 2>&1`;
      const r = await run(`pairing approve ${platform ? platform + ' ' : ''}${code}`, runCmd);
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const ok = !/error|failed|invalid/i.test(out) || /approved|success|paired/i.test(out);
      return NextResponse.json({ success: ok, output: out || 'Pairing command executed', log });
    }

    if (action === 'pairing-list') {
      const binR = await execCommand(sshConfig,
        `p="$(export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; command -v hermes 2>/dev/null)"; [ -z "$p" ] && for q in "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "${HH}/hermes-agent/venv/bin/hermes"; do [ -x "$q" ] && p="$q" && break; done; echo "BIN=$p"`,
        { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim() || 'hermes';
      const BP = JSON.stringify(bp);
      const ENVX = `export PATH="${HH}/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; ${HERMES_ENV}`;
      const r = await execCommand(sshConfig,
        `${ENVX}; ${BP} pairing list 2>&1 || true; { [ -f "${HH}/logs/gateway-nohup.log" ] && tail -n 60 "${HH}/logs/gateway-nohup.log"; } || { [ -f "${HH}/logs/gateway.log" ] && tail -n 60 "${HH}/logs/gateway.log"; } || true`,
        { pool: false, timeoutMs: 20000 });
      const out = (r.stdout || '');
      const matches = [...out.matchAll(/pairing\s+approve\s+(?:(\w+)\s+)?([A-Z0-9]{6,12})/gi), ...out.matchAll(/code[:\s]+([A-Z0-9]{6,12})/gi), ...out.matchAll(/pairing\s+code\s+is\s+([A-Z0-9]{6,12})/gi)];
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

    // ── CONFIG BACKUPS — list & restore ─────────────────────────────────────
    if (action === 'backups') {
      const r = await execCommand(sshConfig,
        `ls -1t "${HH}"/config.yaml.bak-* 2>/dev/null | head -10 | while read f; do echo "$(basename "$f")|$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)|$(wc -c < "$f")"; done`,
        { pool: false, timeoutMs: 30000 });
      const backups = (r.stdout || '').split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], date: parts[1] || '', size: Number(parts[2]) || 0 };
      });
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const name = String(config.name || '');
      if (!/^config\.yaml\.bak-[0-9]+$/.test(name)) {
        return NextResponse.json({ success: false, error: 'Invalid backup name' }, { status: 400 });
      }
      const r = await execCommand(sshConfig,
        `[ -f "${HH}/${name}" ] && cp "${HH}/${name}" "${HH}/config.yaml" && echo RESTORED || echo NOT_FOUND`,
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
        // Skills live at skills/<category>/<name>/ (or flat skills/<name>/)
        const r = await execCommand(sshConfig,
          `F="$(find "${HH}/skills" -mindepth 2 -maxdepth 2 -type d -name '${name}' 2>/dev/null | head -1)"; [ -z "$F" ] && F="$(find "${HH}/skills" -mindepth 1 -maxdepth 1 -type d -name '${name}' 2>/dev/null | head -1)"; if [ -n "$F" ]; then rm -rf "$F" && echo SKILL_REMOVED; else ${rb} skills remove '${name}' --yes 2>/dev/null || rm -rf "${HH}/skills/${name}"; echo SKILL_REMOVED; fi`,
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

    log.push(`> [install] Initializing ${config.docker?.enabled ? 'Docker-isolated' : 'direct'} installation for Hermes Agent...`);
    log.push(`> [install] Target connection: ${connectionId}`);

    const method = ['auto', 'system', 'user', 'nohup'].includes(config.method) ? config.method : 'auto';
    const skipBrowser = config.skipBrowser !== false; // default: headless-safe
    const requiredProviderKey = providerEnvKey(config.provider);
    if (requiredProviderKey && !String(config.env?.[requiredProviderKey] || '').trim()) {
      return NextResponse.json({
        success: false,
        error: `${requiredProviderKey} is required for a fresh install. Paste the selected model provider API key before installing.`,
      }, { status: 400 });
    }
    // ── 0. Docker-isolated target ────────────────────────────────────────────
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
    log.push(`> [probe] Checking host system capabilities...`);
    const hostProbe = await run('host probe', statusScript(inst));
    const hp = (k) => (hostProbe.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();

    if (config.docker?.enabled) {
      if (hp('DOCKER') !== '1') {
        return NextResponse.json({ success: false, error: 'Docker is not available on the selected server — choose "directly on server" or install Docker first.', log });
      }
      log.push(`> [docker] Starting isolated container (${dockerImage})...`);
      await run(`start isolated container (${dockerImage})`, `
        docker rm -f hermes-agent >/dev/null 2>&1 || true
        mkdir -p "${HH}-docker"
        docker run -d --name hermes-agent --restart unless-stopped \\
          -v "${HH}-docker:/root/.hermes" \\
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
    log.push(`> [probe] Checking target environment prerequisites...`);
    const probeR = await execCommand(sshConfig, wrap(statusScript(inst)), { pool: false, timeoutMs: 60000 });
    const p = (k) => (probeR.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
    const hasSystemd = p('SYSTEMD') === '1';
    const hasSudo = p('SUDO') === '1';

    // 2. Best-effort prerequisites (git/curl/xz/libatomic) when missing + sudo available.
    const atomicMissing = p('ATOMIC') !== '1';
    const cxxMissing = p('CXX') !== '1';
    const tarMissing = p('TAR') !== '1';
    // pgrep/procps: every status/health check shells out to pgrep, and minimal
    // images (CentOS Stream 9, Alpine) ship without it — without this probe the
    // whole prereq block is skipped and installs report failure (PROC always 0).
    const procpsMissing = p('PROCP') !== '1';
    if (p('GIT') === 'NONE' || p('CURL') !== '1' || p('XZ') !== '1' || atomicMissing || cxxMissing || tarMissing || procpsMissing) {
      const base = [['git', p('GIT') === 'NONE'], ['curl', p('CURL') !== '1'], ['xz', p('XZ') !== '1'], ['tar', tarMissing]]
        .filter(x => x[1]).map(x => x[0]);
      const mk = (extra) => base.concat(extra.filter(Boolean)).join(' ');
      const aptPkgs = mk(['xz-utils', 'gzip', atomicMissing && 'libatomic1', cxxMissing && 'build-essential', 'procps']);
      const apkPkgs = mk(['gzip', atomicMissing && 'libatomic', cxxMissing && 'g++ make', 'procps']);
      const rpmPkgs = mk(['gzip', atomicMissing && 'libatomic', cxxMissing && 'gcc-c++ make', 'procps-ng']);
      const zyppPkgs = mk(['gzip', atomicMissing && 'libatomic1', cxxMissing && 'gcc-c++ make', 'procps']);
      const pacPkgs = mk(['libatomic', cxxMissing && 'base-devel', 'procps']);

      log.push(`> [prereqs] Installing missing system packages: ${aptPkgs || rpmPkgs}...`);
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
        // procps/pgrep fallback (mirrors zeroclaw): the branch above only ever
        // runs when git/curl/xz/libatomic/g++/tar is missing too, so pgrep stays
        // absent on minimal CentOS Stream 9 / Alpine images. Ends in `true` so
        // the marker file below is always written (otherwise the poll loop waits
        // the full 160s for a file that never appears).
        'command -v pgrep >/dev/null 2>&1 ||',
        '(command -v apt-get >/dev/null 2>&1 && $S apt-get install -y procps) < /dev/null ||',
        '(command -v apk    >/dev/null 2>&1 && $S apk add --no-cache procps) < /dev/null ||',
        '(command -v dnf    >/dev/null 2>&1 && $S dnf install -y --allowerasing procps-ng) < /dev/null ||',
        '(command -v yum    >/dev/null 2>&1 && $S yum install -y procps-ng) < /dev/null ||',
        '(command -v zypper >/dev/null 2>&1 && $S zypper --non-interactive --no-gpg-checks install procps) < /dev/null ||',
        '(command -v pacman >/dev/null 2>&1 && $S pacman -Sy --noconfirm --needed procps-ng) < /dev/null ||',
        'true',
        'touch /tmp/.prereq-done',
      ].join('\n');
      await run(`install prerequisites (${aptPkgs || rpmPkgs})`, `
        rm -f /tmp/.prereq-done
        echo '${b64(innerChain)}' | base64 -d > /tmp/prereq.sh
        nohup sh /tmp/prereq.sh > /tmp/prereq.log 2>&1 < /dev/null &
        sleep 1
        test -f /tmp/prereq.log && echo BG_PREREQ_STARTED`, { timeoutMs: 60000 });
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const st = await execCommand(sshConfig, wrap('test -f /tmp/.prereq-done && echo DONE || echo PENDING'), { pool: false, timeoutMs: 20000 });
        if (/DONE/.test(st.stdout || '')) {
          log.push('> [prereqs] Prerequisite packages installed.');
          break;
        }
        if ((i + 1) % 3 === 0) {
          log.push(`> [prereqs] Package manager working in background... (${(i + 1) * 4}s elapsed)`);
        }
      }
    }

    // 3. Official installer — non-interactive, skips setup wizard & heavy extras.
    const flags = ['--non-interactive', '--skip-setup', ...(skipBrowser ? ['--skip-browser'] : []), ...(config.lightweight ? ['--no-skills'] : [])].join(' ');
    log.push(`> [installer] Running official installer: curl -fsSL ${INSTALLER_URL} | bash -s -- ${flags}`);
    log.push(`> [installer] Building Python environment and pulling dependencies (this typically takes 1-3 minutes)...`);
    {
      let streamed = 0;
      const instR = await execDetached(sshConfig,
        `curl -fsSL ${INSTALLER_URL} | bash -s -- ${flags} 2>&1`,
        {
          pollMs: 2000,
          timeoutMs: 900000,
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
      for v in "${HH}/hermes-agent/venv/bin/hermes" /usr/local/lib/hermes-agent/venv/bin/hermes /usr/local/lib/hermes-agent/hermes; do
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
    const invalidEnvKey = envEntries.find(([k]) => !/^[A-Z][A-Z0-9_]*$/.test(k))?.[0];
    if (invalidEnvKey) {
      return NextResponse.json({ success: false, error: `Invalid environment variable name: ${invalidEnvKey}` }, { status: 400 });
    }
    const envTargetLabel = `${inst ? `~/.hermes-${inst}` : '~/.hermes'}/.env`;
    await run(`ensure ${envTargetLabel}`, `mkdir -p "${HH}" && touch "${HH}/.env" && chmod 600 "${HH}/.env"`, { timeoutMs: 15000 });
    // Safety net: restore keys from the pre-uninstall backup first — a
    // reinstall with an empty/stale wizard form must never silently drop a
    // working provider key. Payload keys are upserted on top and win.
    const backupProbe = b64([
      'import os',
      `p = os.path.expanduser("${HH}.env.bak")`,
      'if not os.path.exists(p):',
      '    print("BACKUP_NONE")',
      'else:',
      '    for ln in open(p).read().splitlines():',
      '        idx = ln.find("=")',
      '        if idx > 0:',
      '            print(ln[:idx])',
      '    print("BACKUP_DONE")',
    ].join('\n'));
    const backupEntries = await run('read backup credentials', `echo '${backupProbe}' | base64 -d | python3`, { timeoutMs: 15000 });
    const backupKeys = [...new Set([...(backupEntries.stdout || '').matchAll(/^([A-Z][A-Z0-9_]*)$/gm)].map(m => m[1]))];
    if (backupKeys.length > 0) {
      const restored = await run('restore backup credentials', `
        python3 - <<'PY'
import os
src = os.path.expanduser("${HH}.env.bak")
dst = os.path.expanduser("${HH}/.env")
keys = set("${backupKeys.join(',')}".split(','))
if os.path.exists(src):
    keep = [ln for ln in open(src).read().splitlines()
            if ln.find('=') > 0 and ln[:ln.find('=')] in keys]
    cur = [ln for ln in (open(dst).read().splitlines() if os.path.exists(dst) else [])
           if not (ln.find('=') > 0 and ln[:ln.find('=')] in keys)]
    text = '\\n'.join(cur + keep) + '\\n'
    open(dst, 'w').write(text)
    os.chmod(dst, 0o600)
    print('BACKUP_RESTORED')
PY`, { timeoutMs: 30000 });
      if (/BACKUP_RESTORED/.test(restored.stdout || '')) {
        await run('clear backup', `rm -f "${HH}.env.bak"`, { timeoutMs: 15000 });
      }
    }
    if (envEntries.length > 0) {
      const envWrite = await runEnvUpsert(
        envEntries.map(([k, v]) => [k, String(v).trim()]),
        `write ${envEntries.length} key(s) to ${envTargetLabel}`,
      );
      if (!/ENV_UPDATED/.test(envWrite.stdout || '')) {
        return NextResponse.json({ success: false, error: `Failed to save credentials to ${envTargetLabel}; gateway was not started.`, log });
      }
    }

    // 5. Apply config.yaml settings via the official CLI (handles dotted keys)
    const settingsEntries = Object.entries(config.settings || {}).filter(([, v]) => v != null && String(v).trim() !== '');
    // Lightweight defaults: keep auxiliary fallbacks on :free SKUs only so
    // compression/summarization calls never burn paid tokens behind the scenes.
    if (config.lightweight && !settingsEntries.some(([k]) => k === 'auxiliary.free_only')) {
      settingsEntries.push(['auxiliary.free_only', 'true']);
    }
    for (const [key, value] of settingsEntries) {
      await run(`hermes config set ${key}${inst ? ` (→ ~/.hermes-${inst})` : ''}`,
        `${ENVPREFIX}; ${HERMES_ENV} ${HB} config set ${key} ${JSON.stringify(String(value))} 2>&1 | tail -2`,
        { timeoutMs: 60000 });
    }

    // 5a. Guarantee the submitted settings land in config.yaml even if
    // `hermes config set` failed silently above. Spawned instances start with a
    // deliberately EMPTY config.yaml (spawn-instance truncates it), so any
    // swallowed CLI error left the whole file empty — the same direct merge the
    // reconfigure path uses, HERMES_HOME-qualified, makes install == update.
    if (settingsEntries.length > 0) {
      const mergeB64 = b64(JSON.stringify(Object.fromEntries(settingsEntries)));
      const cfgTargetLabel = inst ? `~/.hermes-${inst}/config.yaml` : '~/.hermes/config.yaml';
      await run(`merge ${cfgTargetLabel} settings (guaranteed write)`, `${HERMES_ENV}
        python3 - <<'PY' 2>&1 || true
import json, os, base64, re
path = (os.environ.get('HERMES_HOME') or os.path.expanduser('~/.hermes')) + '/config.yaml'
os.makedirs(os.path.dirname(path), exist_ok=True)
if not os.path.exists(path):
    open(path, 'w').close()
new = json.loads(base64.b64decode('${mergeB64}').decode('utf-8'))
text = open(path).read() if os.path.getsize(path) else ''
for k, v in (new.items() if isinstance(new, dict) else []):
    sval = 'true' if v is True else ('false' if v is False else str(v))
    if re.search(rf'^{re.escape(k)}:', text, re.M):
        text = re.sub(rf'^{re.escape(k)}:.*$', f'{k}: {sval}', text, count=1, flags=re.M)
    else:
        text += f'\\n{k}: {sval}\\n'
open(path, 'w').write(text)
print('SETTINGS_MERGED')
PY`, { timeoutMs: 30000 });
    }

    // 5b. Fresh install must persist model + messenger token into config.yaml the
    // same way reconfigure does. The generic loop above only writes keys present
    // in `settings`; the model is sent as `settings.model` and the Telegram token
    // is sent as `env.TELEGRAM_BOT_TOKEN` (not a dotted settings key), so without
    // this both are silently dropped on a fresh install. Mirror the reconfigure
    // path (model.default + gateway.platforms.telegram.token) so install == update.
    const tgtModel = (config.settings && config.settings.model)
      || (config.env && (config.env.MODEL || config.env.HERMES_MODEL || config.env.DEFAULT_MODEL))
      || '';
    const tgtTok = (config.env && config.env.TELEGRAM_BOT_TOKEN) || '';
    if (tgtModel || tgtTok) {
      await execCommand(sshConfig, `
        export PATH="${BIN_DIR}:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
        HB="$([ -x "$HOME/.local/bin/hermes" ] && echo "$HOME/.local/bin/hermes" || command -v hermes || echo "/usr/local/bin/hermes")"
        ${tgtModel ? `${HERMES_ENV} $HB config set model.default ${JSON.stringify(String(tgtModel))} 2>&1 | tail -1 || true` : 'true'}
        ${tgtTok ? `${HERMES_ENV} $HB config set gateway.platforms.telegram.token ${JSON.stringify(String(tgtTok))} 2>&1 | tail -1 || true` : 'true'}
        true`, { pool: false, timeoutMs: 40000 });
    }

    // 6. Gateway service (system > user+linger > background daemon)
    let startMethod = method;
    if (startMethod === 'auto') startMethod = hasSystemd ? (hasSudo ? 'system' : 'user') : 'nohup';

    let svcOk = false;
    if (inst && !dockerMode) {
      // ── Tagged instance ──────────────────────────────────────────────────
      // Hermes derives BOTH its gateway pidfile and its systemd unit name from
      // HERMES_HOME. `hermes gateway install` without HERMES_HOME set would
      // rewrite and start the DEFAULT instance's unit — installing one instance
      // would clobber another. The per-instance template unit is tried first,
      // and every fallback exports HERMES_HOME so the service identity stays
      // qualified to this instance.
      await syncInstanceEnv('install');
      if (startMethod !== 'nohup') {
        const sd = await sdHermesBranch('start');
        svcOk = !!(sd && sd.ok);
      }
      if (!svcOk && startMethod !== 'nohup' && hasSystemd) {
        await run('install instance service (HERMES_HOME-qualified)',
          `${ENVPREFIX}; ${HERMES_ENV} ${HB} gateway install 2>&1 | tail -5; ${HERMES_ENV} ${HB} gateway start 2>&1 | tail -3; echo SVC_DONE`,
          { timeoutMs: 120000 });
        const chk = await execCommand(sshConfig, wrap(`systemctl --user is-active hermes-gate""ay@${inst} 2>/dev/null`), { pool: false, timeoutMs: 15000 });
        svcOk = /active/.test(chk.stdout || '');
        if (!svcOk) log.push('> Instance systemd unit not active — falling back to background daemon...');
      }
    } else if (startMethod === 'system' && hasSystemd && !dockerMode) {
      const S = hasSudo ? 'sudo -n -E' : '';
      await run('install boot-time system service',
        `${ENVPREFIX}; $S ${HB} gateway install --system 2>&1 | tail -6; $S ${HB} gateway start --system 2>&1 | tail -3; echo SVC_DONE`,
        { timeoutMs: 120000 });
      const chk = await execCommand(sshConfig, wrap('systemctl is-active hermes-gateway 2>/dev/null || systemctl is-active hermes 2>/dev/null'), { pool: false, timeoutMs: 15000 });
      svcOk = /active/.test(chk.stdout || '');
      if (!svcOk) log.push('> Systemd service not active on this environment — falling back to background daemon...');
    }
    if (!svcOk && !inst && (startMethod === 'user' || (startMethod === 'system' && hasSystemd)) && hasSystemd && !dockerMode) {
      await run('install user service + enable lingering',
        `${ENVPREFIX}; ${HB} gateway install 2>&1 | tail -5; ${HB} gateway start 2>&1 | tail -3; ${hasSudo ? `sudo -n loginctl enable-linger "$(id -un)" 2>/dev/null;` : ''} echo SVC_DONE`,
        { timeoutMs: 120000 });
      const chk = await execCommand(sshConfig, wrap('systemctl --user is-active hermes-gateway 2>/dev/null || systemctl --user is-active hermes 2>/dev/null'), { pool: false, timeoutMs: 15000 });
      svcOk = /active/.test(chk.stdout || '');
      if (!svcOk) log.push('> User service not active — falling back to background daemon...');
    }
    if (!svcOk) {
      await run('start gateway (background daemon)',
        // NOTE: the literal is split (`gatew""ay`) so the pgrep pattern in the
        // SAME command line cannot match the enclosing shell — otherwise pgrep
        // always reports the gateway up, even right after it died.
        // HERMES_HOME is exported so the instance-scoped scan can attribute
        // this process to its own home instead of the default install.
        // instance.env is sourced first (isolation paths + own ports), .env
        // second so a user-set variable in .env still wins.
        `${ENVPREFIX}; export HERMES_HOME="${HH}"; mkdir -p "${HH}/logs"; setsid nohup sh -c 'set -a; [ -f "${HH}/instance.env" ] && . "${HH}/instance.env"; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; export PATH="${BIN_DIR}:$HOME/.local/bin:/usr/local/bin:$PATH"; exec ${HB} gatew""ay run || exec ${HB} gatew""ay' >> "${HH}/logs/gateway-nohup.log" 2>&1 < /dev/null & sleep 3; { pgrep -f '[h]ermes.*gatew[a]y' || pgrep -f '[h]ermes gatew[a]y'; } >/dev/null 2>&1 && echo GW_RUNNING || echo GW_PENDING`,
        { timeoutMs: 30000 });
    }

    // 7. Verify (inside the container for docker installs)
    await new Promise(res => setTimeout(res, 3000));
    const verify = await execCommand(sshConfig, wrap(statusScript(inst)), { pool: false, timeoutMs: 60000 });
    const vp = (k) => (verify.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
    const running = dockerMode
      ? vp('PROC') === '1'
      : vp('SSVC') === '1' || vp('USVC') === '1' || vp('PROC') === '1';

    let errorMsg = null;
    if (!running) {
      const errR = await execCommand(sshConfig, wrap(
        `{ [ -f "${HH}/logs/gateway-nohup.log" ] && tail -n 25 "${HH}/logs/gateway-nohup.log"; } || { [ -f "${HH}/logs/gateway.log" ] && tail -n 25 "${HH}/logs/gateway.log"; } || ls -1t "${HH}/logs/"*.log 2>/dev/null | head -1 | xargs -r tail -n 25 2>/dev/null || true`
      ), { pool: false, timeoutMs: 15000 });
      const rawLog = (errR.stdout || '').trim();
      if (rawLog) {
        log.push(`\n=== RECENT GATEWAY LOG ===\n${rawLog}`);
        const lastLine = rawLog.split('\n').filter(Boolean).pop() || '';
        errorMsg = `Gateway stopped shortly after launch: ${lastLine.slice(0, 150)}`;
      } else {
        errorMsg = 'Gateway did not stay running. Check ~/.hermes/logs/ on the server — most often the LLM API key or messenger token needs attention.';
      }
    }

    return NextResponse.json({
      success: running,
      running,
      startMethod: dockerMode ? 'docker' : startMethod,
      docker: dockerMode ? { image: dockerImage, name: 'hermes-agent', dataDir: '~/.hermes-docker' } : undefined,
      version: vp('VERSION'),
      error: errorMsg,
      log,
    });
  } catch (e) {
    logger.error('[hermes-install] action failed:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
