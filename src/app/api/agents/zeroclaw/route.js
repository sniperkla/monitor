import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { dispatchWithLiveLogs } from '@/app/api/agents/_jobs';
import { execDetached } from '@/app/api/agents/_remote-bg';
import { logger } from '@/lib/logger';
import { parseInst, homeDir, instancePort, listInstances, cloneDefaultHome, pidAlive, gatewayUnit, ensureInstanceUnit, writeInstanceEnv, sdAvailable, sdInstanceCtl } from '../_multi-instance';

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
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
[ -z "$BIN" ] && BIN="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
if [ -n "$BIN" ]; then echo "BIN=SET"; else echo "BIN=UNSET"; fi
VER=NONE
[ -n "$BIN" ] && VER="$($BIN --version 2>/dev/null | head -1 | cut -c1-40)"
echo "VERSION=$VER"
CFG=0; [ -f "$HOME/.zeroclaw/config.toml" ] && CFG=1
echo "CONFIG=$CFG"
PROC=0; (pgrep -x zeroclaw >/dev/null 2>&1 || pgrep -x zeroclaw >/dev/null 2>&1) && PROC=1
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

    // -- Multi-instance support (hermes blueprint) --
    const inst = parseInst(body);
    const HH = homeDir('zeroclaw', inst);  // ${HH} or ${HH}-<tag>
    const GW_PORT = instancePort('zeroclaw', inst);        // distinct dashboard port for instances
    const PIDF = `${HH}/daemon.pid`;
    const CFG_DIR_ARG = inst ? `--config-dir "${HH}"` : '';
    const binPath = () => inst
      ? `${ENVX}; p=""; [ -x "${HH}/bin/zeroclaw" ] && p="${HH}/bin/zeroclaw"; echo "BIN=$p"` // instance-local isolated binary
      : `
      export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
      p="$(command -v zeroclaw 2>/dev/null || true)"
      [ -z "$p" ] && for q in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$q" ] && p="$q" && break; done
      [ -z "$p" ] && p="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
      echo "BIN=$p"
    `;
    const ENVX = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" 2>/dev/null; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"`;

    // ── Gateway control — zeroclaw service CLI, systemd user unit, else nohup ──
    // Instances override the config dir (--config-dir) and write a pidfile so
    // lifecycle stays isolated; the default install keeps its exact behavior.
    const gwCtl = async (op) => {
      const binR = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp = (binR.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      if (!bp) return { ok: false, out: 'zeroclaw binary not found. Please click "Install ZeroClaw" in the Overview tab.' };
      const BP = JSON.stringify(bp);
      if (inst) {
        // Tagged instance: preferred path = per-instance systemd template unit
        // (own cgroup + Restart=on-failure + NoNewPrivileges/PrivateTmp).
        // Falls back to pidfile-scoped nohup when no systemd user session.
        if (await sdAvailable(sshConfig)) {
          // Per-instance dashboard port: the fixed default (42617) would collide
          // across instances. zeroclaw stores it in config.toml gateway.port —
          // set it via the binary's own props command (best-effort).
          if (GW_PORT) {
            await execCommand(sshConfig, `${ENVX}; ${BP} config set gateway.port ${GW_PORT} --no-interactive 2>/dev/null || true`, { pool: false, timeoutMs: 30000 });
          }
          await ensureInstanceUnit(sshConfig, 'zeroclaw', gatewayUnit('zeroclaw', {
            description: 'ZeroClaw daemon',
            envLines: [
              'EnvironmentFile=-%h/.zeroclaw-%i/.env',
              'Environment=PATH=%h/.local/bin:%h/.cargo/bin:%h/bin:/usr/local/bin:/usr/bin:/bin',
            ],
            execStart: `/bin/sh -c 'exec "$( [ -x %h/.zeroclaw-%i/bin/zeroclaw ] && echo %h/.zeroclaw-%i/bin/zeroclaw || echo %h/.cargo/bin/zeroclaw)" dae""mon --config-dir %h/.zeroclaw-%i'`,
            logFile: '%h/.zeroclaw-%i/logs/daemon.log',
          }));
          const sd = await sdInstanceCtl(sshConfig, 'zeroclaw', inst, op);
          if (sd) return sd;
        }
        // Legacy fallback: fully isolated, pidfile-scoped, no shared systemd unit.
        if (op === 'status') {
          const r = await execCommand(sshConfig, `${ENVX}; res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1; echo "PROC=$res"`, { pool: false, timeoutMs: 30000 });
          return { ok: true, active: /PROC=1/.test(r.stdout || '') };
        }
        if (op === 'stop') {
          return execCommand(sshConfig,
            `${ENVX}; if [ -f "${PIDF}" ]; then kill $(cat "${PIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${PIDF}") 2>/dev/null; fi; rm -f "${PIDF}"; echo GW_STOPPED`,
            { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
        }
        if (op === 'restart') await gwCtl('stop');
        if (GW_PORT) {
          await execCommand(sshConfig, `${ENVX}; ${BP} config set gateway.port ${GW_PORT} --no-interactive 2>/dev/null || true`, { pool: false, timeoutMs: 30000 });
        }
        const startCmd = `${ENVX}; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; mkdir -p "${HH}/logs"; setsid nohup ${BP} dae${'mon'} ${CFG_DIR_ARG} >> "${HH}/logs/daemon.log" 2>&1 < /dev/null & echo $! > "${PIDF}"; sleep 4; if kill -0 $(cat "${PIDF}") 2>/dev/null; then echo "GW_UP (instance)"; else echo GW_DOWN; tail -n 12 "${HH}/logs/daemon.log" 2>/dev/null; fi`;
        return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 120000 })
          .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-500) }));
      }
      if (op === 'status') {
        // Instances: pidfile-scoped only (never match the default's daemon).
        // Default: pidfile, systemd, then any daemon WITHOUT --config-dir.
        let statusSh;
        if (inst) {
          statusSh = `${ENVX}; res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1; [ "$res" = 1 ] && echo PROC_ACTIVE || echo NO_PROC`;
        } else {
          statusSh = `${ENVX}; res=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && res=1; [ "$res" = 1 ] && echo PROC_ACTIVE || { systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && echo SVC_ACTIVE || true; }; if [ "$res" = 0 ]; then for p in $(pgrep -f '[z]eroclaw daem[o]n' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || res=1; done; fi; [ "$res" = 1 ] && echo PROC_ACTIVE || echo NO_PROC`;
        }
        const r = await execCommand(sshConfig, statusSh, { pool: false, timeoutMs: 30000 });
        return { ok: true, active: /SVC_ACTIVE|PROC_ACTIVE/.test(r.stdout || '') };
      }
      if (op === 'stop') {
        // Broad `pkill -x zeroclaw` matches EVERY instance on the box — only
        // allowed for the default install (full reset). Instances are killed
        // strictly via their own pidfile.
        const broadKill = inst ? '' : `for p in $(pgrep -f '[z]eroclaw dae[m]on' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || kill -9 $p 2>/dev/null; done; true`;
        return execCommand(sshConfig,
          `${ENVX}; ${BP} service stop 2>/dev/null; ${inst ? '' : 'systemctl --user stop zeroclaw 2>/dev/null;'} if [ -f "${PIDF}" ]; then kill $(cat "${PIDF}") 2>/dev/null; sleep 1; kill -9 $(cat "${PIDF}") 2>/dev/null; fi; rm -f "${PIDF}"; ${broadKill} echo GW_STOPPED`,
          { pool: false, timeoutMs: 60000 }).then(r => ({ ok: /GW_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-400) }));
      }
      // start / restart — never write the plain word "daemon" here (self-match)
      if (op === 'restart') await gwCtl('stop');
      const startCmd = `
        mkdir -p "${HH}/logs" "$HOME/.config/systemd/user"
        ${ENVX}; set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a
        systemctl --user stop zeroclaw 2>/dev/null || true
        ${inst ? '' : `for p in $(pgrep -f '[z]eroclaw dae[m]on' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || kill -9 $p 2>/dev/null; done; true`}
        sleep 1
        # Enable lingering on Fedora / RHEL so user systemd stays active after SSH disconnects
        loginctl enable-linger $(whoami) 2>/dev/null || sudo -n loginctl enable-linger $(whoami) 2>/dev/null || true
        
        STARTED_VIA=""
        # 1. Write and start systemd user service file if systemctl is available
        if command -v systemctl >/dev/null 2>&1; then
          cat <<'EOF' > "$HOME/.config/systemd/user/zeroclaw.service"
[Unit]
Description=ZeroClaw AI Assistant Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=-%h/.zeroclaw/.env
Environment=PATH=%h/.local/bin:%h/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/sh -c 'exec $(command -v zeroclaw || echo "$HOME/.cargo/bin/zeroclaw") daemon'
Restart=on-failure
RestartSec=3
StandardOutput=append:%h/.zeroclaw/logs/daemon.log
StandardError=append:%h/.zeroclaw/logs/daemon.log

[Install]
WantedBy=default.target
EOF
          systemctl --user daemon-reload 2>/dev/null || true
          systemctl --user enable zeroclaw 2>/dev/null || true
          systemctl --user restart zeroclaw 2>/dev/null || systemctl --user start zeroclaw 2>/dev/null || true
          sleep 2
          if systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active; then
            STARTED_VIA="systemd"
          fi
        fi

        # 2. Nohup fallback if systemd user unit is not running
        if [ -z "$STARTED_VIA" ] && ! pgrep -x zeroclaw >/dev/null 2>&1 && ! pgrep -x zeroclaw >/dev/null 2>&1; then
          setsid env -i HOME="$HOME" PATH="$PATH" sh -c 'set -a; [ -f "${HH}/.env" ] && . "${HH}/.env"; set +a; exec '"${BP}"' dae""mon' >> "${HH}/logs/daemon.log" 2>&1 < /dev/null &
          echo $! > "${PIDF}"
          sleep 3
          if pgrep -x zeroclaw >/dev/null 2>&1 || pgrep -x zeroclaw >/dev/null 2>&1; then
            STARTED_VIA="nohup"
          fi
        fi

        if (systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active) || pgrep -x zeroclaw >/dev/null 2>&1 || kill -0 $(cat "${PIDF}" 2>/dev/null) 2>/dev/null; then
          echo "GW_UP ($STARTED_VIA)"
        else
          echo "GW_DOWN"
          echo "=== RECENT_LOG ==="
          tail -n 25 "${HH}/logs/daemon.log" 2>/dev/null || true
          command -v journalctl >/dev/null 2>&1 && journalctl --user -u zeroclaw -n 20 --no-pager 2>/dev/null || true
        fi
      `;
      return execCommand(sshConfig, startCmd, { pool: false, timeoutMs: 120000 })
        .then(r => ({ ok: /GW_UP/.test(r.stdout || ''), out: (r.stdout || '').slice(-600) }));
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
      const r = await execCommand(sshConfig, STATUS_SCRIPT, { pool: true, timeoutMs: 30000 });
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

    // ── INSTANCES — list every installed zeroclaw home + running state ─────
    if (action === 'instances') {
      const list = await listInstances(sshConfig, 'zeroclaw');
      return NextResponse.json({ success: true, instances: list });
    }

    // ── SPAWN-INSTANCE — clone the default install's data dir & start ──────
    if (action === 'spawn-instance') {
      const tag = String((config && config.tag) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (!tag) return NextResponse.json({ success: false, error: 'Instance tag is required' }, { status: 400 });
      // FULL ISOLATION: do NOT seed anything from the default (no config.toml,
      // no .env, no .secret_key, no personality files). The instance starts as a
      // blank slate — the auto-opened setup wizard writes the user's OWN config
      // (API key, bot token, model) via Save & Start.
      const seedRes = await execCommand(sshConfig,
        `mkdir -p "${HH}/logs" "${HH}/bin" "${HH}/data" "${HH}/workspace"; if [ ! -f "${HH}/config.toml" ]; then printf 'schema_version = 3\\n' > "${HH}/config.toml"; fi; mkdir -p "${HH}/bin"; SRC=$(command -v zeroclaw 2>/dev/null || echo "$HOME/.cargo/bin/zeroclaw"); if [ -x "$SRC" ]; then cp -f "$SRC" "${HH}/bin/zeroclaw"; chmod 755 "${HH}/bin/zeroclaw"; fi; echo FRESH_HOME_READY`,
        { pool: false, timeoutMs: 30000 });
      const clone = { ok: /FRESH_HOME_READY/.test(seedRes.stdout || ''), existed: false };
      // True per-instance binary isolation: give each instance its own copy of
      // the shared binary at ~/.zeroclaw-<tag>/bin/zeroclaw. Then uninstalling
      // the default (which removes the shared ~/.cargo/bin/zeroclaw) never
      // breaks running/restartable instances.
      if (!clone.existed) {
        await execCommand(sshConfig,
          `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/usr/sbin:$PATH"; SRC=$(command -v zeroclaw 2>/dev/null || echo "$HOME/.cargo/bin/zeroclaw"); mkdir -p "${HH}/bin"; if [ -x "$SRC" ]; then cp -f "$SRC" "${HH}/bin/zeroclaw"; chmod 755 "${HH}/bin/zeroclaw"; echo BIN_COPIED; else echo BIN_SRC_MISSING; fi`,
          { pool: false, timeoutMs: 30000 });
      }
      const g = await gwCtl('start');
      return NextResponse.json({
        success: true,
        instance: tag,
        existed: clone.existed,
        started: g.ok,
        output: clone.existed
          ? `Instance "${tag}" already existed — daemon ${g.ok ? 'running' : 'not started'}.`
          : `Instance "${tag}" created fully isolated (nothing seeded from default). Configure it in the setup wizard — give it its OWN bot token so instances don't fight over the same Telegram bot.`,
      });
    }

    // ── DETAILS ──
    if (action === 'details') {
      const D = `
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
BIN="";
if [ -n "${inst}" ] && [ -x "${HH}/bin/zeroclaw" ]; then BIN="${HH}/bin/zeroclaw"; fi
[ -z "$BIN" ] && BIN="$(command -v zeroclaw 2>/dev/null || true)"
[ -z "$BIN" ] && for p in "$HOME/.cargo/bin/zeroclaw" "$HOME/.local/bin/zeroclaw" "$HOME/bin/zeroclaw" "$HOME/.zeroclaw/bin/zeroclaw" "/root/.cargo/bin/zeroclaw" "/root/.local/bin/zeroclaw" "/usr/local/bin/zeroclaw" "/usr/bin/zeroclaw" "/opt/zeroclaw/zeroclaw"; do [ -x "$p" ] && BIN="$p" && break; done
[ -z "$BIN" ] && BIN="$(find "$HOME" /root /usr /opt -maxdepth 4 -name zeroclaw -type f -perm -111 2>/dev/null | head -1 || true)"
echo "===TOML_B64==="
base64 < "${HH}/config.toml" 2>/dev/null || true
echo "===RUNNING==="
USVC=0; command -v systemctl >/dev/null 2>&1 && systemctl --user is-active zeroclaw 2>/dev/null | grep -qx active && USVC=1
SSVC=0; command -v systemctl >/dev/null 2>&1 && systemctl is-active zeroclaw 2>/dev/null | grep -qx active && SSVC=1
PROC=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && PROC=1
if [ "$PROC" = 0 ] && [ -z "${inst}" ]; then
  DEFAULT_DAEMON=0; for p in $(pgrep -f '[z]eroclaw daem[o]n' 2>/dev/null); do grep -qa -- '--config-dir' /proc/$p/cmdline 2>/dev/null || DEFAULT_DAEMON=1; done; [ "$DEFAULT_DAEMON" = 1 ] && PROC=1
fi
echo "USVC=$USVC"; echo "SSVC=$SSVC"; echo "PROC=$PROC"
echo "===VERSION==="
[ -n "$BIN" ] && "$BIN" --version 2>/dev/null | head -1 | cut -c1-40
echo "===MODEL==="
[ -f "${HH}/config.toml" ] && grep -E '^\\s*(model|model_provider|default_model)\\s*=' "${HH}/config.toml" 2>/dev/null | head -1 | cut -d'"' -f2
echo "===BINPATH==="
[ -n "$BIN" ] && echo "$BIN"
echo "===SKILLS==="
[ -d "${HH}/skills" ] && ls -1 "${HH}/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "${HH}/workspace/skills" ] && ls -1 "${HH}/workspace/skills" 2>/dev/null | grep -v '^\.' || true
[ -d "${HH}/sop" ] && ls -1 "${HH}/sop" 2>/dev/null | grep -v '^\.' | sed 's/\.md$//' || true
echo "===ZCSKILLS==="
# ZeroClaw manages skills per config-dir via its CLI — list what's installed
[ -n "$BIN" ] && "$BIN" skills list ${CFG_DIR_ARG} 2>/dev/null || true
echo "===PROMPT_B64==="
{ base64 < "${HH}/data/PROMPT.md" || base64 < "${HH}/workspace/PROMPT.md" || base64 < "${HH}/prompt.txt" || base64 < "${HH}/SYSTEM_PROMPT.md"; } 2>/dev/null || true
echo "===SOUL_B64==="
{ base64 < "${HH}/data/SOUL.md" || base64 < "${HH}/workspace/SOUL.md" || base64 < "${HH}/data/IDENTITY.md" || base64 < "${HH}/workspace/IDENTITY.md"; } 2>/dev/null || true
echo "===USER_B64==="
{ base64 < "${HH}/data/USER.md" || base64 < "${HH}/workspace/USER.md"; } 2>/dev/null || true
echo "===AGENTS_B64==="
{ base64 < "${HH}/data/AGENTS.md" || base64 < "${HH}/workspace/AGENTS.md"; } 2>/dev/null || true
echo "===MEMORY_B64==="
{ base64 < "${HH}/data/MEMORY.md" || base64 < "${HH}/workspace/MEMORY.md" || base64 < "${HH}/workspace/memory/MEMORY.md"; } 2>/dev/null || true
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
      try { configJson = Buffer.from(section('TOML_B64', 'RUNNING'), 'base64').toString('utf8'); } catch { /* none */ }
      let envText = '';
      try { envText = Buffer.from(section('ENV_B64', 'ENVKEYS'), 'base64').toString('utf8'); } catch { /* none */ }
      const binR = section('BINPATH', 'SKILLS');
      const running = /USVC=1|SSVC=1|PROC=1/.test(section('RUNNING', 'VERSION'));
      const skillsList = section('SKILLS', 'ZCSKILLS').split('\n').map(s => s.trim()).filter(Boolean);
      // Merge real zeroclaw-managed skills from `zeroclaw skills list`.
      // Format: "  probe-skill v0.1.0 — description" under "[bundle: x]" headers.
      const zcSkillsRaw = section('ZCSKILLS', 'PROMPT_B64');
      for (const line of zcSkillsRaw.split('\n')) {
        const m = line.match(/^\s+([a-zA-Z0-9][\w-]*)\s+v[\d.]+/);
        if (m) skillsList.push(m[1]);
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

      return NextResponse.json({
        success: true,
        installed: !!binR,
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
      let SCRIPT = `mkdir -p "${HH}/data" "${HH}/workspace"\n`;
      SCRIPT += `for f in PROMPT.md SOUL.md IDENTITY.md USER.md AGENTS.md MEMORY.md; do [ -f "${HH}/data/$f" ] || [ ! -f "${HH}/workspace/$f" ] || cp "${HH}/workspace/$f" "${HH}/data/$f"; done\n`;
      if (fileName === 'SOUL.md' || fileName === 'IDENTITY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/data/SOUL.md"\necho "${b64}" | base64 -d > "${HH}/data/IDENTITY.md"\n`;
      } else if (fileName === 'USER.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/data/USER.md"\n`;
      } else if (fileName === 'AGENTS.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/data/AGENTS.md"\n`;
      } else if (fileName === 'MEMORY.md') {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/data/MEMORY.md"\n`;
      } else {
        SCRIPT += `echo "${b64}" | base64 -d > "${HH}/data/PROMPT.md"\necho "${b64}" | base64 -d > "${HH}/prompt.txt"\necho "${b64}" | base64 -d > "${HH}/SYSTEM_PROMPT.md"\n`;
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
        await run('stop instance (pidfile-scoped)', `if [ -f "${PIDF}" ]; then p=$(cat "${PIDF}"); kill "$p" 2>/dev/null; sleep 1; kill -9 "$p" 2>/dev/null; rm -f "${PIDF}"; fi; true`);
      } else {
        await run('stop & unregister service', `${ENVX}; p="$(command -v zeroclaw 2>/dev/null)"; [ -n "$p" ] && $p service uninstall 2>/dev/null; systemctl --user disable --now zeroclaw 2>/dev/null; true`);
        await run('stop stray processes', `timeout 15 pkill -f '[z]eroclaw dae[m]on' 2>/dev/null; true`);
      }
      // Only remove the (shared) binary when NO instances remain — instances need
      // it to keep running (zeroclaw has one binary, all instances reuse it via
      // --config-dir). If instances exist, keep the binary so they stay usable.
      const binRm = inst
        ? '' // instances share the globally-installed binary — leave it alone
        : `HAS_INST=$(ls -d "$HOME/.zeroclaw-"* 2>/dev/null | head -1); if [ -z "$HAS_INST" ]; then rm -f "$HOME/.local/bin/zeroclaw" "$HOME/.cargo/bin/zeroclaw" /usr/local/bin/zeroclaw; echo BIN_REMOVED; else echo BIN_KEPT_FOR_INSTANCES; fi; `;
      const rmCmd = inst
        ? `rm -rf "${HH}"; echo REMOVED_INSTANCE`   // instances: always remove the whole isolated home
        : purge
          ? `${binRm}rm -rf "${HH}"; echo REMOVED_ALL`
          : `${binRm}rm -rf "${HH}/logs"; echo REMOVED_CODE`;
      const r = await run(inst ? 'remove instance (isolated home)' : purge ? 'remove binary & all data' : 'remove binary (config kept)', rmCmd);
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

      // 2. Official installer — runs DETACHED on the host
      let streamed = 0;
      const instCmd = `
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
        mkdir -p "${HH}/logs" "$HOME/.local/bin" "$HOME/.cargo/bin"
        # Alpine/musl: the official installer assumes glibc — install the musl
        # release tarball directly (zeroclaw ships a static musl target).
        MUSL=0; ldd /bin/busybox 2>/dev/null | grep -qi musl && MUSL=1 || { [ -f /etc/alpine-release ] && MUSL=1; }
        if [ "$MUSL" = 1 ]; then
          mkdir -p /tmp/zcmusl && cd /tmp/zcmusl
          if curl -fsSL -o zcm.tar.gz https://github.com/zeroclaw-labs/zeroclaw/releases/download/v0.8.4/zeroclaw-x86_64-unknown-linux-musl.tar.gz 2>/dev/null; then
            tar -xzf zcm.tar.gz zeroclaw 2>/dev/null && mv -f zeroclaw "$HOME/.cargo/bin/zeroclaw" && chmod 755 "$HOME/.cargo/bin/zeroclaw" && echo "MUSL_INSTALL_SUCCESS"
          else
            echo "MUSL_TARBALL_UNAVAILABLE - building from source is required on Alpine"
          fi
        fi
        if curl -fsSL ${INSTALLER_URL} | bash 2>&1; then
          echo "OFFICIAL_INSTALLER_SUCCESS"
        else
          echo "Official installer returned non-zero, trying cargo fallback..."
          if command -v cargo >/dev/null 2>&1; then
            cargo install zeroclaw 2>&1 || true
          fi
        fi
      `;
      const instR = await execDetached(sshConfig,
        instCmd,
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

      // Initialize default config.toml if it does not exist yet (clean schema_version = 3, no malformed sections)
      await execCommand(sshConfig, `
        mkdir -p "${HH}"
        if [ ! -f "${HH}/config.toml" ]; then
          printf 'schema_version = 3\\n' > "${HH}/config.toml"
        else
          # Clean up any previously generated invalid channels_config without bot_token
          python3 -c "
import os, re
p = os.path.expanduser('~/.zeroclaw/config.toml')
if os.path.exists(p):
    t = open(p).read()
    if 'bot_token' not in t and '[channels_config' in t:
        t = re.sub(r'\\[channels_config[^\\]]*\\][\\s\\S]*?(?=\\n\\[|$)', '', t)
        open(p, 'w').write(t.strip() + '\\n')
" 2>/dev/null || true
        fi
      `, { pool: false, timeoutMs: 15000 });

      // Apply env & settings if provided in install payload
      const env = (config && config.env) || {};
      const settings = (config && config.settings) || {};
      const envKeys = Object.keys(env).filter(k => env[k] != null && env[k] !== '');
      const hasSettings = Object.keys(settings).filter(k => settings[k] != null && settings[k] !== '').length > 0;

      if (envKeys.length > 0) {
        const envLinesB64 = b64(envKeys.map(k => `${k}=${env[k]}`).join('\n'));
        const envPy = [
          'import os, base64',
          `lines_raw = base64.b64decode('${envLinesB64}').decode('utf-8').splitlines()`,
          `ep = os.path.expanduser('~/.zeroclaw/.env')`,
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
        await run('write ~/.zeroclaw/.env', `echo '${b64(envPy)}' | base64 -d | python3`, { timeoutMs: 30000 });
      }

      if (hasSettings || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_ALLOWED_USERS || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.MODEL || env.ZEROCLAW_MODEL) {
        const setB64 = b64(JSON.stringify(settings));
        const envB64 = b64(JSON.stringify(env));
        const cfgPy = [
          'import os, re, base64, json',
          `s = json.loads(base64.b64decode('${setB64}').decode('utf-8'))`,
          `e = json.loads(base64.b64decode('${envB64}').decode('utf-8'))`,
          `p = os.path.expanduser('~/.zeroclaw/config.toml')`,
          `os.makedirs(os.path.dirname(p), exist_ok=True)`,
          `text = open(p).read() if os.path.exists(p) else ''`,
          `NL = chr(10)`,
          `def drop(content, header_pat):`,
          `    while True:`,
          `        out, skipping, removed = [], False, False`,
          `        for ln in content.split(NL):`,
          `            if re.fullmatch(header_pat, ln.strip()):`,
          `                skipping = True`,
          `                removed = True`,
          `                continue`,
          `            if skipping and ln.startswith('['):`,
          `                skipping = False`,
          `            if not skipping:`,
          `                out.append(ln)`,
          `        content = NL.join(out)`,
          `        if not removed:`,
          `            return content`,
          `# strip legacy top-level keys — 0.8.x ignores them (provider lives under [providers.models.*])`,
          `pre = text.find(NL + '[')`,
          `head, tail = (text, '') if pre < 0 else (text[:pre + 1], text[pre + 1:])`,
          `head = re.sub(r'(?m)^(api_key|model|default_model)[ \\t]*=.*$', '', head)`,
          `text = head + tail`,
          `# strip legacy/malformed channel sections (pre-0.8 schema)`,
          `text = drop(text, r'\\[channels_config\\.telegram\]')`,
          `text = drop(text, r'\\[channels_config\]')`,
          `text = drop(text, r'\\[channels\\.telegram\]')`,
          `# model provider profile — ZeroClaw 0.8+ native schema`,
          `prov = None`,
          `base_url_override = ''`,
          `key = ''`,
          `if e.get('OPENROUTER_API_KEY'):`,
          `    prov = 'openrouter'`,
          `elif e.get('OPENAI_API_KEY'):`,
          `    prov = 'openai'`,
          `elif e.get('ANTHROPIC_API_KEY'):`,
          `    prov = 'anthropic'`,
          `elif e.get('CUSTOM_LLM_API_KEY') and e.get('OPENAI_BASE_URL'):`,
          `    prov = 'openai'`,
          `    base_url_override = e.get('OPENAI_BASE_URL') or ''`,
          `if prov:`,
          `    key = e.get(prov.upper() + '_API_KEY') or e.get('CUSTOM_LLM_API_KEY') or e.get('API_KEY') or s.get('api_key') or ''`,
          `    model = (s.get('model') or s.get('default_model') or e.get('MODEL') or e.get('ZEROCLAW_MODEL') or e.get('DEFAULT_MODEL') or '')`,
          `    if key:`,
          `        header = '[providers.models.' + prov + '.default]'`,
          `        text = drop(text, re.escape(header))`,
          `        block = header + NL + 'api_key = "' + key + '"'`,
          `        if base_url_override:`,
          `            block += NL + 'base_url = "' + base_url_override + '"'`,
          `        if model:`,
          `            block += NL + 'model = "' + model + '"'`,
          `        text = text.rstrip(NL) + NL + NL + block + NL`,
          `# telegram channel alias — user access is granted via 'zeroclaw channel bind-telegram <id>'`,
          `tok = e.get('TELEGRAM_BOT_TOKEN') or s.get('telegram_token') or ''`,
          `if tok:`,
          `    text = drop(text, r'\\[channels\\.telegram\\.[^\\]]+\]')`,
          `    block = '[channels.telegram.default]' + NL + 'enabled = true' + NL + 'bot_token = "' + tok + '"' + NL`,
          `    text = text.rstrip(NL) + NL + NL + block`,
          `# agent binding — 0.8+ channels only poll for an ENABLED agent bound to a channel`,
          `if tok and prov and key:`,
          `    text = drop(text, re.escape('[agents.default]'))`,
          `    text = drop(text, re.escape('[risk_profiles.personal]'))`,
          `    text = drop(text, re.escape('[risk_profiles.personal.default]'))`,
          `    agent = '[agents.default]' + NL + 'enabled = true' + NL + 'model_provider = "' + prov + '.default"' + NL + 'channels = ["telegram.default"]' + NL + 'risk_profile = "personal"' + NL`,
          `    text = text.rstrip(NL) + NL + NL + '[risk_profiles.personal]' + NL + 'level = "supervised"' + NL + NL + agent`,
          `if 'schema_version' not in text:`,
          `    text = 'schema_version = 3' + NL + text`,
          `open(p, 'w').write(text.strip(NL) + NL)`,
          `print('ZEROCLAW_CONFIG_MERGED')`,
        ].join('\n');
        await run('merge ~/.zeroclaw/config.toml', `echo '${b64(cfgPy)}' | base64 -d | python3 2>&1`, { timeoutMs: 30000 });
      }

      // 3. Daemon — register via `zeroclaw service install` only if systemd is PID 1
      const hasInit = p('INITD') === '1';
      if (hasInit) {
        await run('register service', `${ENVX}; ${JSON.stringify(zcBin)} service install 2>&1 | tail -3 || true`, { timeoutMs: 60000 });
      } else {
        log.push('$ register service — skipped (using background nohup daemon mode)');
      }
      const gw = await gwCtl('start');
      const startMethod = gw.ok ? (hasInit ? 'systemd-user' : 'service/nohup') : 'manual';
      if (gw.ok) {
        await run('start daemon', `echo GW_UP`);
      } else {
        log.push('$ start daemon — deferred: no LLM API key configured yet. Add your API key and bot token in the Environment tab, then click Restart.');
      }

      const readRunning = async () => {
        const v = await execCommand(sshConfig, STATUS_SCRIPT, { pool: false, timeoutMs: 60000 });
        const vp = (k) => (v.stdout || '').match(new RegExp(`${k}=(.*)`))?.[1]?.trim();
        return vp('USVC') === '1' || vp('SSVC') === '1' || vp('PROC') === '1';
      };
      await new Promise(r => setTimeout(r, 2000));
      const running = await readRunning();

      // Binary installed = success even if daemon won't start (no API key yet is expected on fresh install)
      return NextResponse.json({
        success: true,
        installed: true,
        running,
        startMethod,
        version: p('VERSION'),
        warning: running ? null : 'Daemon is not running yet — add your API key and Telegram bot token in the Environment tab, then click Restart.',
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
        `tail -n ${LINES} "${HH}/logs/daemon.log" 2>/dev/null || ` +
        `tail -n ${LINES} "${HH}/logs/dae""mon-nohup.log" 2>/dev/null || ` +
        `tail -n ${LINES} "${HH}/logs/daem""on.stderr.log" 2>/dev/null || ` +
        `{ LOG=$(ls -1t "${HH}/logs/"*.log 2>/dev/null | head -1); [ -n "$LOG" ] && tail -n ${LINES} "$LOG"; } || ` +
        `echo "(no log file found in ~/.zeroclaw/logs/ — daemon may have exited early)"; ` +
        `fi; rm -f /tmp/.zc-jl.txt`,
        { pool: false, timeoutMs: 30000 });
      const data = (r.stdout || '').slice(-200000);
      return NextResponse.json({ success: true, data, size: data.length, file: 'journal::user/zeroclaw | ~/.zeroclaw/logs/daemon.log' });
    }

    // ── RECONFIGURE — write env & settings to ~/.zeroclaw + restart gateway (no reinstall) ──
    if (action === 'reconfigure') {
      const env = (config && config.env) || {};
      const settings = (config && config.settings) || {};
      const envKeys = Object.keys(env).filter(k => env[k] != null && env[k] !== '');
      const hasSettings = Object.keys(settings).filter(k => settings[k] != null && settings[k] !== '').length > 0;
      if (envKeys.length === 0 && !hasSettings) {
        return NextResponse.json({ success: false, error: 'No settings or env keys to update' }, { status: 400 });
      }

      // Write ~/.zeroclaw/.env — use Python so values containing '=' (base64 tokens) are safe
      if (envKeys.length > 0) {
        const envLinesB64 = b64(envKeys.map(k => `${k}=${env[k]}`).join('\n'));
        // Python script: upsert each KEY=VALUE line in .env, handles values with '='
        const envPy = [
          'import os, base64',
          `lines_raw = base64.b64decode('${envLinesB64}').decode('utf-8').splitlines()`,
          `ep = os.path.expanduser('~/.zeroclaw/.env')`,
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
        const w = await run('write ~/.zeroclaw/.env', `echo '${envPyB64}' | base64 -d | python3`, { timeoutMs: 30000 });
        if (!/ENV_UPDATED/.test(w.stdout || '')) {
          return NextResponse.json({ success: false, error: 'Failed to write ~/.zeroclaw/.env', log });
        }
      }

      // Merge settings + telegram into config.toml
      // IMPORTANT: Pass the Python via stdin (base64 decoded) to avoid ALL shell escaping issues.
      // Double-backslash in regex is correct inside a normal Python string passed via stdin.
      if (hasSettings || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_ALLOWED_USERS || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.MODEL || env.ZEROCLAW_MODEL) {
        const setB64 = b64(JSON.stringify(settings));
        const envB64 = b64(JSON.stringify(env));
        const cfgPy = [
          'import os, re, base64, json',
          `s = json.loads(base64.b64decode('${setB64}').decode('utf-8'))`,
          `e = json.loads(base64.b64decode('${envB64}').decode('utf-8'))`,
          `p = os.path.expanduser('~/.zeroclaw/config.toml')`,
          `os.makedirs(os.path.dirname(p), exist_ok=True)`,
          `text = open(p).read() if os.path.exists(p) else ''`,
          `NL = chr(10)`,
          `def drop(content, header_pat):`,
          `    while True:`,
          `        out, skipping, removed = [], False, False`,
          `        for ln in content.split(NL):`,
          `            if re.fullmatch(header_pat, ln.strip()):`,
          `                skipping = True`,
          `                removed = True`,
          `                continue`,
          `            if skipping and ln.startswith('['):`,
          `                skipping = False`,
          `            if not skipping:`,
          `                out.append(ln)`,
          `        content = NL.join(out)`,
          `        if not removed:`,
          `            return content`,
          `# strip legacy top-level keys — 0.8.x ignores them (provider lives under [providers.models.*])`,
          `pre = text.find(NL + '[')`,
          `head, tail = (text, '') if pre < 0 else (text[:pre + 1], text[pre + 1:])`,
          `head = re.sub(r'(?m)^(api_key|model|default_model)[ \\t]*=.*$', '', head)`,
          `text = head + tail`,
          `# strip legacy/malformed channel sections (pre-0.8 schema)`,
          `text = drop(text, r'\\[channels_config\\.telegram\]')`,
          `text = drop(text, r'\\[channels_config\]')`,
          `text = drop(text, r'\\[channels\\.telegram\]')`,
          `# model provider profile — ZeroClaw 0.8+ native schema`,
          `prov = None`,
          `base_url_override = ''`,
          `key = ''`,
          `if e.get('OPENROUTER_API_KEY'):`,
          `    prov = 'openrouter'`,
          `elif e.get('OPENAI_API_KEY'):`,
          `    prov = 'openai'`,
          `elif e.get('ANTHROPIC_API_KEY'):`,
          `    prov = 'anthropic'`,
          `if prov:`,
          `    key = e.get(prov.upper() + '_API_KEY') or e.get('API_KEY') or s.get('api_key') or ''`,
          `    model = (s.get('model') or s.get('default_model') or e.get('MODEL') or e.get('ZEROCLAW_MODEL') or e.get('DEFAULT_MODEL') or '')`,
          `    if key:`,
          `        header = '[providers.models.' + prov + '.default]'`,
          `        text = drop(text, re.escape(header))`,
          `        block = header + NL + 'api_key = "' + key + '"'`,
          `        if model:`,
          `            block += NL + 'model = "' + model + '"'`,
          `        text = text.rstrip(NL) + NL + NL + block + NL`,
          `# telegram channel alias — user access is granted via 'zeroclaw channel bind-telegram <id>'`,
          `tok = e.get('TELEGRAM_BOT_TOKEN') or s.get('telegram_token') or ''`,
          `if tok:`,
          `    text = drop(text, r'\\[channels\\.telegram\\.[^\\]]+\]')`,
          `    block = '[channels.telegram.default]' + NL + 'enabled = true' + NL + 'bot_token = "' + tok + '"' + NL`,
          `    text = text.rstrip(NL) + NL + NL + block`,
          `# agent binding — 0.8+ channels only poll for an ENABLED agent bound to a channel`,
          `if tok and prov and key:`,
          `    text = drop(text, re.escape('[agents.default]'))`,
          `    text = drop(text, re.escape('[risk_profiles.personal.default]'))`,
          `    agent = '[agents.default]' + NL + 'enabled = true' + NL + 'model_provider = "' + prov + '.default"' + NL + 'channels = ["telegram.default"]' + NL + 'risk_profile = "personal"' + NL`,
          `    text = text.rstrip(NL) + NL + NL + '[risk_profiles.personal.default]' + NL + 'level = "supervised"' + NL + NL + agent`,
          `if 'schema_version' not in text:`,
          `    text = 'schema_version = 3' + NL + text`,
          `open(p, 'w').write(text.strip(NL) + NL)`,
          `print('ZEROCLAW_CONFIG_MERGED')`,
        ].join('\n');
        const cfgPyB64 = b64(cfgPy);
        const cfgR = await run('merge ~/.zeroclaw/config.toml', `echo '${cfgPyB64}' | base64 -d | python3 2>&1`, { timeoutMs: 30000 });
        log.push(`config-merge result: ${(cfgR.stdout || '').trim().slice(0, 300)}`);

        // Flush any pending Telegram webhook so polling starts immediately
        await execCommand(sshConfig, `
          TOKEN="$(grep -oE 'bot_token = "[^"]+"' "${HH}/config.toml" 2>/dev/null | cut -d'"' -f2 || grep -oE 'TELEGRAM_BOT_TOKEN=[^ \t\n]+' "${HH}/.env" 2>/dev/null | cut -d= -f2-)"
          if [ -n "$TOKEN" ]; then
            curl -s "https://api.telegram.org/bot\${TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>&1 || true
          fi
        `, { pool: false, timeoutMs: 15000 });
      }

      // Seed missing workspace persona files (SOUL.md / USER.md / MEMORY.md).
      // ZeroClaw's bootstrap instructs the agent to read these from its
      // workspace, but nothing creates them — so the Prompt tabs show empty
      // and the agent has no persona to load. Only files that are MISSING
      // are created; user content is never overwritten.
      const seedB64 = b64(JSON.stringify({
        'SOUL.md': '# SOUL.md\n\nPersona identity, tone of voice, and character traits for this agent.\n\n- Tone: friendly, concise, and practical\n- Style: direct answer first, short explanation after\n- When unsure, ask one clarifying question instead of guessing\n',
        'USER.md': '# USER.md\n\n## Profile\n- Name: Admin\n- Language: English & Thai\n- Style: provide command lines first, brief explanations after\n\n## Preferences\n- Prefer safe, reversible commands\n- Confirm before any destructive operation\n',
        'MEMORY.md': '# MEMORY.md\n\nLong-term knowledge, decisions, and lessons the agent should remember across sessions.\n\n- Append new lessons as bullet points\n- Keep entries short; one topic per bullet\n',
      }));
      await run('seed workspace files', `echo '${seedB64}' | base64 -d | python3 -c "
import json, os, base64, sys
defaults = json.loads(base64.b64decode('${seedB64}').decode('utf8'))
ws = os.path.expanduser('~/.zeroclaw/data')
os.makedirs(ws, exist_ok=True)
created = []
for name, content in defaults.items():
    fp = os.path.join(ws, name)
    if not os.path.exists(fp):
        open(fp, 'w').write(content)
        created.append(name)
print('SEEDED:' + (','.join(created) if created else 'none'))
" 2>&1`, { timeoutMs: 30000 });

      // restart gateway
      const g = await gwCtl('restart');
      return NextResponse.json({ success: g.ok, restarted: g.ok, startMethod: g.ok ? 'process' : null, error: g.ok ? null : (g.out || 'gateway did not start after reconfigure — check logs tab'), log });
    }

    if (action === 'save-config') {
      const tomlText = String(config.configJson ?? config.configToml ?? config.configYaml ?? '');
      if (!tomlText.trim()) return NextResponse.json({ success: false, error: 'Empty config' }, { status: 400 });
      const stamp = Date.now();
      await run('backup current config', `mkdir -p "${HH}"; [ -f "${HH}/config.toml" ] && cp "${HH}/config.toml" "${HH}/config.toml.bak-${stamp}"; ls -1t "${HH}"/config.toml.bak-* 2>/dev/null | head -3`);
      const wr = await run('write config.toml', `echo '${b64(tomlText)}' > /tmp/.zc-cfg.b64 && base64 -d /tmp/.zc-cfg.b64 > "${HH}/config.toml" && rm -f /tmp/.zc-cfg.b64 && echo CONFIG_SAVED`);
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
          // Capture the exact daemon error from logs
          const errR = await execCommand(sshConfig,
            `tail -n 30 "${HH}/logs/daemon.log" 2>/dev/null || journalctl --user -u zeroclaw -n 20 --no-pager 2>/dev/null || true`,
            { pool: false, timeoutMs: 15000 });
          const daemonErr = (errR.stdout || '').trim();

          const rbk = await execCommand(sshConfig,
            `BAK="$(ls -1t "${HH}"/config.toml.bak-* 2>/dev/null | head -1)"; [ -n "$BAK" ] && cp "$BAK" "${HH}/config.toml" && echo ROLLED_BACK_TO=$BAK || echo NO_BACKUP`,
            { pool: false, timeoutMs: 30000 });
          if (/ROLLED_BACK/.test(rbk.stdout || '')) {
            rolledBack = true;
            await gwCtl('restart');
            const up2 = await waitActive(24);
            return NextResponse.json({
              success: false, restarted: up2, rolledBack: true,
              error: `Your saved config caused the daemon to crash (rolled back to backup). Error:\n${daemonErr.slice(-600)}`,
              log: [`Daemon crashed with saved config: ${daemonErr.slice(-300)}`, `Automatically restored ${((rbk.stdout || '').match(/ROLLED_BACK_TO=(.*)/) || [])[1] || 'last backup'}`],
            });
          }
        }
      }
      return NextResponse.json({ success: true, restarted, rolledBack });
    }

    // ── BACKUPS ──
    if (action === 'backups') {
      const r = await run('list config backups', `ls -1t "${HH}"/config.toml.bak-* 2>/dev/null || true`);
      const backups = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
      return NextResponse.json({ success: true, backups });
    }

    if (action === 'restore-backup') {
      const bak = String(config.backup || '');
      if (!/^[\w./~-]+$/.test(bak) || !bak.includes('config.toml.bak-')) {
        return NextResponse.json({ success: false, error: 'Invalid backup path' }, { status: 400 });
      }
      await run('restore backup', `cp "${bak}" "${HH}/config.toml" && echo RESTORED`);
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
PROC=0; [ -f "${PIDF}" ] && kill -0 $(cat "${PIDF}") 2>/dev/null && PROC=1
PORT=0; (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '42617${GW_PORT ? `|${GW_PORT}` : ''}') && PORT=1
ALIVE=0; [ $USVC = 1 -o $SSVC = 1 -o $PROC = 1 ] && ALIVE=1
if [ "$ALIVE" = 0 ] && [ -n "${inst}" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
  systemctl --user is-active zeroclaw-gatew""ay@${inst} 2>/dev/null | grep -qx active && ALIVE=1
fi
echo "ALIVE=$ALIVE"; echo "PORT=$PORT"
PID=$(cat "${PIDF}" 2>/dev/null)
UP=0; [ -n "$PID" ] && UP=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
[ -z "$UP" ] && UP=0
echo "UPTIME_SEC=$UP"
TG=not_configured
if [ -f "${HH}/config.toml" ] && grep -qiE '(bot_token|token)\s*=\s*"[0-9]+:' "${HH}/config.toml" || { [ -f "${HH}/.env" ] && grep -qiE 'TELEGRAM_BOT_TOKEN=[0-9]+:' "${HH}/.env"; }; then
  TG=connected
fi
LOGL="$(ls -1t "${HH}/logs/"*.log 2>/dev/null | head -1)"
if [ -n "$LOGL" ]; then
  if tail -n 100 "$LOGL" | grep -qiE 'telegram.*(invalid token|unauthorized|failed to connect|login error|connection rejected|conflict|isolated polling|polling error)'; then
    TG=error
  elif tail -n 300 "$LOGL" | grep -qiE 'telegram.*(bot.*connected|polling|channel enabled|started|ready|connected|ok|listening)'; then
    TG=connected
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
      const binR0 = await execCommand(sshConfig, binPath(), { pool: false, timeoutMs: 15000 });
      const bp0 = (binR0.stdout || '').match(/BIN=(.*)/)?.[1]?.trim();
      const BP0 = bp0 ? JSON.stringify(bp0) : 'zeroclaw';
      // Skills live in "bundles" — auto-configure the default bundle so
      // add/install works out of the box (scoped to this instance's config dir).
      const pre = `${ENVX}; ${BP0} config set skill_bundles.default.directory shared/skills/default ${CFG_DIR_ARG} 2>/dev/null; `;

      if (op === 'remove') {
        const name = String(config.name || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          return NextResponse.json({ success: false, error: 'Invalid skill name' }, { status: 400 });
        }
        // Real zeroclaw-managed skills first; legacy dir/SOP layouts as fallback.
        const r = await execCommand(sshConfig,
          `${pre}${BP0} skills remove ${JSON.stringify(name)} ${CFG_DIR_ARG} 2>&1 || rm -rf "${HH}/skills/${name}" "${HH}/sop/${name}.md" "${HH}/sop/${name}" 2>/dev/null; true`,
          { pool: false, timeoutMs: 30000 });
        const g = await gwCtl('restart');
        return NextResponse.json({ success: true, restarted: g.ok, output: ((r.stdout || '') + (r.stderr || '')).slice(-400) });
      }

      if (op === 'install') {
        const id = String(config.id || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-:.]*$/.test(id)) {
          return NextResponse.json({ success: false, error: 'Invalid skill id' }, { status: 400 });
        }
        const skillName = id.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        // URL / git repo / archive -> `skills install`; bare name -> scaffold via `skills add`
        const isSource = /^https?:\/\//.test(id) || /\.(git|zip|tgz|tar\.gz)$/.test(id);
        const cmd = isSource
          ? `${pre}${BP0} skills install ${JSON.stringify(id)} ${CFG_DIR_ARG} 2>&1`
          : `${pre}${BP0} skills add ${JSON.stringify(skillName)} --bundle default --description ${JSON.stringify('Skill ' + skillName)} ${CFG_DIR_ARG} 2>&1 || { mkdir -p "${HH}/skills/${skillName}" "${HH}/sop"; echo "# SOP: ${id}\n\nExecute ${skillName} standard operating procedure." > "${HH}/sop/${skillName}.md"; echo SCAFFOLLED; }`;
        const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 120000 });
        const ok = !/error|failed|not found/i.test((r.stdout || '') + (r.stderr || '')) || /Scaffolded|installed|SCAFFOLLED/i.test(r.stdout || '');
        const g = await gwCtl('restart');
        return NextResponse.json({ success: ok, restarted: g.ok, output: ((r.stdout || '') + (r.stderr || '')).slice(-500) });
      }
      return NextResponse.json({ success: false, error: `Unknown skills op: ${op}` }, { status: 400 });
    }

    // ── PAIRING / USER ACCESS APPROVAL ──
    // ZeroClaw supports two types of pairing:
    // 1. HTTP Gateway pairing code (e.g. 018875) via POST http://127.0.0.1:42617/pair -H "X-Pairing-Code: 018875"
    // 2. Telegram user ID allowlist in config.toml: [channels_config.telegram] allowed_users = ["..."]
    // Gateway dashboard port — default 42617, instances use their own.
    const dashPort = GW_PORT || 42617;

    if (action === 'pairing-approve') {
      const code = String(config.code || '').trim();
      // 0. If this is a pending one-time TELEGRAM BIND code, it can only be
      //    confirmed from the user's Telegram account — tell them how.
      // Scan wide (1000 lines, newest 2 logs) — a narrow 250-line window once
      // missed the bind line and the code got added as a bogus user ID.
      const logScan = await execCommand(sshConfig,
        `cat $(ls -1t "${HH}/logs/"*.log 2>/dev/null | head -2) 2>/dev/null | tail -n 1000 || true`,
        { pool: false, timeoutMs: 20000 });
      // The UI tags bind codes with platform 'telegram-bind' — never add those
      // as user IDs; they must be confirmed from the user's Telegram account.
      const isBindPlatform = String(config.platform || '') === 'telegram-bind';
      const bindCodeRe = new RegExp(`one-time bind code:\\\\s*${code}([^0-9]|$)`, 'i');
      if (code && (isBindPlatform || bindCodeRe.test(logScan.stdout || ''))) {
        return NextResponse.json({
          success: true,
          output: `Bind code ${code} is pending. Open Telegram, send "/bind ${code}" to your bot, then press "Scan Pending Requests" again. (The bind must be confirmed from your own Telegram account, so it cannot be approved from here.)`,
          log,
        });
      }
      // 0b. If this is a pending GATEWAY pairing code (dashboard/API access),
      //     it must NOT be bound as a Telegram identity — earlier versions
      //     blindly ran `bind-telegram <6-digit-code>` here, which added a
      //     bogus user to the telegram allowlist.
      const isGatewayCode = code && new RegExp(`X-Pairing-Code:\\\\s*${code}([^0-9]|$)`, 'i').test(logScan.stdout || '');
      // 1. Try ZeroClaw CLI channel bind-telegram if available (only for real
      //    Telegram identities — numeric user IDs or usernames)
      if (!isGatewayCode) {
      await execCommand(sshConfig, `
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"
        zeroclaw channel bind-telegram ${JSON.stringify(code)} 2>&1 || true
        # If bot token exists, clear any stale webhooks so long polling works immediately
        TOKEN="$(grep -oE 'bot_token\\s*=\\s*"[^"]+"' "${HH}/config.toml" 2>/dev/null | cut -d'"' -f2 || grep -oE 'TELEGRAM_BOT_TOKEN=[^ \\n]+' "${HH}/.env" 2>/dev/null | cut -d= -f2)"
        if [ -n "$TOKEN" ]; then
          curl -s "https://api.telegram.org/bot\${TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>&1 || true
        fi
      `, { pool: false, timeoutMs: 15000 });
      }

      // 2. Try HTTP Gateway pairing (for dashboard / API / webhook access)
      const httpPairR = await execCommand(sshConfig, `
        curl -s -w "\\nHTTP_CODE:%{http_code}" -X POST http://127.0.0.1:${dashPort || 42617}/pair \
          -H "X-Pairing-Code: ${code}" \
          -H "Content-Type: application/json" \
          -d '{}' 2>/dev/null || true
      `, { pool: false, timeoutMs: 15000 });
      const httpOut = (httpPairR.stdout || '').trim();
      const httpPaired = /HTTP_CODE:20[0-9]/.test(httpOut) || /token|session|paired|success/i.test(httpOut);

      // 2. Append this user ID to allowed_users in config.toml and ~/.zeroclaw/.env
      const pairPy = [
        'import os, re, json, base64',
        `uid = ${JSON.stringify(code)}`,
        `p = os.path.expanduser('~/.zeroclaw/config.toml')`,
        `text = open(p).read() if os.path.exists(p) else ''`,
        `def add_user(content, u):`,
        `    for sec in ['[channels_config.telegram]', '[telegram]']:`,
        `        if sec in content:`,
        `            m = re.search(r'(' + re.escape(sec) + r'[\\s\\S]*?^\\s*(?:allowed_users|allowed_user_ids)\\s*=\\s*\\[)([^\\]]*)(\\])', content, re.M)`,
        `            if m:`,
        `                raw_items = [x.strip().strip('"\\' ') for x in m.group(2).split(',') if x.strip().strip('"\\' ')]`,
        `                unique_items = []`,
        `                for item in raw_items:`,
        `                    if item and item not in unique_items:`,
        `                        unique_items.append(item)`,
        `                if u and u not in unique_items:`,
        `                    unique_items.append(u)`,
        `                new_val = json.dumps(unique_items)`,
        `                content = content[:m.start(1)] + m.group(1) + new_val[1:-1] + m.group(3) + content[m.end():]`,
        `            else:`,
        `                content = content.replace(sec, sec + '\\nallowed_users = [' + json.dumps(u) + ']')`,
        `            return content`,
        `    return content`,
        `if uid and os.path.exists(p) and uid.isdigit():`,
        `    open(p, 'w').write(add_user(text, uid).strip() + '\\n')`,
        `# Update ~/.zeroclaw/.env TELEGRAM_ALLOWED_USERS`,
        `env_p = os.path.expanduser('~/.zeroclaw/.env')`,
        `env_text = open(env_p).read() if os.path.exists(env_p) else ''`,
        `if uid and uid.isdigit():`,
        `    if 'TELEGRAM_ALLOWED_USERS=' in env_text:`,
        `        curr = re.search(r'^TELEGRAM_ALLOWED_USERS=(.*)$', env_text, re.M)`,
        `        existing_env = [x.strip() for x in (curr.group(1) if curr else '').split(',') if x.strip()]`,
        `        if uid not in existing_env:`,
        `            existing_env.append(uid)`,
        `        env_text = re.sub(r'^TELEGRAM_ALLOWED_USERS=.*$', 'TELEGRAM_ALLOWED_USERS=' + ','.join(existing_env), env_text, flags=re.M)`,
        `    else:`,
        `        env_text = env_text.rstrip('\\n') + '\\nTELEGRAM_ALLOWED_USERS=' + uid + '\\n'`,
        `    open(env_p, 'w').write(env_text)`,
        `added = bool(uid) and (os.path.exists(p) and uid in open(p).read() or uid in open(env_p).read())`,
        `print('ADDED_TO_ALLOWED_USERS' if added else 'NOT_ADDED')`,
      ].join('\n');
      const pairPyB64 = b64(pairPy);
      const r = await execCommand(sshConfig, `echo '${pairPyB64}' | base64 -d | python3 2>&1`, { pool: false, timeoutMs: 30000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const ok = /ADDED_TO_ALLOWED_USERS/.test(out) || httpPaired;
      if (!ok) return NextResponse.json({ success: false, error: `Failed to approve code: ${out}`, log });
      
      // If HTTP gateway pairing succeeded, do NOT restart daemon (restarting resets the active pairing session)
      if (httpPaired) {
        return NextResponse.json({
          success: true,
          output: `Successfully paired gateway with code "${code}".`,
          paired: true,
          log,
        });
      }

      // Otherwise restart so zeroclaw reloads the config with new env and allowed_users
      const g = await gwCtl('restart');
      return NextResponse.json({
        success: true,
        output: `Telegram user ID "${code}" added to allowed_users. Daemon restarted: ${g.ok}`,
        restarted: g.ok,
        log,
      });
    }

    if (action === 'pairing-list') {
      // Scan daemon logs for:
      // 1. HTTP Gateway pairing code: "X-Pairing-Code: 018875" or "│  018875  │"
      // 2. Telegram one-time bind code: "One-time bind code: 388439" (user
      //    must send "/bind <code>" to the bot from their Telegram account)
      // 3. Unauthorized Telegram user IDs: "unauthorized user: 123456"
      const r = await execCommand(sshConfig,
        `FILE="$(ls -1t "${HH}/logs/"*.log 2>/dev/null | head -1)"; [ -n "$FILE" ] && tail -n 250 "$FILE" || true`,
        { pool: false, timeoutMs: 20000 });
      const out = r.stdout || '';
      const pending = [];

      // 0b. Fetch a FRESH one-time gateway pairing code from the daemon's
      //     admin endpoint (localhost-only). Banner codes seen in the startup
      //     log ("Send: POST /pair with header X-Pairing-Code: ...") are help
      //     text, not live pending codes — the real code must come from here.
      const freshR = await execCommand(sshConfig,
        `curl -s -m 5 -X POST http://127.0.0.1:${dashPort}/admin/paircode/new 2>/dev/null || true`,
        { pool: false, timeoutMs: 15000 });
      const freshCode = (freshR.stdout || '').match(/pairing_code\":\"([0-9]{4,8})\"/) || (freshR.stdout || '').match(/pairing_code\":\"?([0-9]{4,8})/);
      if (freshCode && freshCode[1]) {
        pending.push({ code: freshCode[1], platform: 'gateway', fresh: true });
      }

      // 1. Gateway codes from the log: every daemon start prints a NEW banner
      //    code, so older entries in the log are STALE. When a fresh code was
      //    fetched from the admin endpoint above, skip log-derived gateway
      //    codes entirely. Otherwise keep ONLY the last one (most recent).
      if (!freshCode) {
        const logLines = out.split('\n').filter(l => !/Send:\s*POST \/pair with header/i.test(l));
        const logText = logLines.join('\n');
        const gwMatches = [
          ...logText.matchAll(/X-Pairing-Code:\s*([0-9]{6})/gi),
          ...logText.matchAll(/[│|]\s*([0-9]{6})\s*[│|]/g),
          ...logText.matchAll(/pairing\s+code\s+is\s+([0-9]{6})/gi),
        ];
        const last = gwMatches[gwMatches.length - 1];
        if (last && last[1] && !pending.some(p => p.code === last[1])) {
          pending.push({ code: last[1], platform: 'gateway' });
        }
      }

      // 1b. Telegram one-time bind codes — only the LAST one is valid; older
      //     banners are stale and would clutter the approve list.
      const bindMatches = [...out.matchAll(/one-time bind code:\s*([0-9]{4,8})/gi)];
      const lastBind = bindMatches[bindMatches.length - 1];
      if (lastBind && lastBind[1] && !pending.some(p => p.code === lastBind[1])) {
        pending.push({ code: lastBind[1], platform: 'telegram-bind' });
      }

      // 2. Telegram unauthorized user attempts
      const tgMatches = [
        ...out.matchAll(/(?:unauthorized|unknown|denied|not allowed)[^\d]*(\d{5,12})/gi),
        ...out.matchAll(/user[_\s]?id[:\s]+(\d{5,12})/gi),
        ...out.matchAll(/from user[:\s]+(\d{5,12})/gi),
      ];
      for (const m of tgMatches) {
        const code = m[1];
        if (code && !pending.some(p => p.code === code)) {
          pending.push({ code, platform: 'telegram' });
        }
      }

            // 3. Already-paired devices + total token count (for the revoke UI).
      //    The config keeps paired_tokens under [gateway]; each device is a
      //    separate bearer token entry.
      const devR = await execCommand(sshConfig,
        `CONF="${HH}/config.toml"; PT=$(grep -oE 'paired_tokens\\s*=\\s*\\[[^]]*\\]' "$CONF" 2>/dev/null | tr ',' '\n' | grep -cE 'enc2|zc_' || echo 0); echo "PAIRED_TOKENS=$PT"`,
        { pool: false, timeoutMs: 15000 });
      const pairedTokens = Number((devR.stdout || '').match(/PAIRED_TOKENS=(\d+)/)?.[1] || 0);

      return NextResponse.json({ success: true, pending, pairedTokens, raw: out.slice(-1000) });
    }

    // ── PAIRING-REVOKE — deactivate / unapprove a pairing ──
    // zeroclaw has no 1:1 "unpair the pending code" — instead it revokes the
    // issued bearer token(s):
    //   --rotate         revoke ALL paired tokens + clear device registry
    //   --rotate-device  revoke one device's token (reissue a code for it)
    // And Telegram allow-list removal is handled separately here.
    if (action === 'pairing-revoke') {
      const which = String(config.which || '');
      const device = String(config.device || '').trim();
      if (which === 'remove-tg') {
        const uid = device;
        if (!uid) return NextResponse.json({ success: false, error: 'Telegram user id is required' }, { status: 400 });
        const py = [
          'import os, re',
          `uid = ${JSON.stringify(uid)}`,
          "env_p = os.path.expanduser('~/.zeroclaw/.env')",
          "e = open(env_p).read() if os.path.exists(env_p) else ''",
          "m = re.search(r'^TELEGRAM_ALLOWED_USERS=(.*)$', e, re.M)",
          'if m:',
          "    users = [x.strip() for x in m.group(1).split(',') if x.strip() and x.strip() != uid]",
          "    e = re.sub(r'^TELEGRAM_ALLOWED_USERS=.*$', 'TELEGRAM_ALLOWED_USERS=' + ','.join(users), e, flags=re.M)",
          "    open(env_p, 'w').write(e)",
          "    print('TG_REMOVED' if uid not in (','.join(users)) else 'TG_STILL_PRESENT')",
          "# /bind stores peers in config.toml [peer_groups.*].external_peers - remove there too",
          "cfg_p = os.path.expanduser('~/.zeroclaw/config.toml')",
          "cfg = open(cfg_p).read() if os.path.exists(cfg_p) else ''",
          "if uid in cfg:",
          "    q = chr(34)",
          "    cfg = cfg.replace(q + uid + q + ',', '').replace(', ' + q + uid + q, '').replace(q + uid + q, '')",
          "    open(cfg_p, 'w').write(cfg)",
          "    print('CFG_PEER_REMOVED')",
          'else:',
          "    print('TG_NONE')",
        ].join('\n');
        const r = await execCommand(sshConfig, `echo '${b64(py)}' | base64 -d | python3`, { pool: false, timeoutMs: 30000 });
        const ok = /TG_REMOVED|CFG_PEER_REMOVED/.test(r.stdout || '');
        await gwCtl('restart');
        return NextResponse.json({ success: ok, output: ok ? `Removed Telegram user ${uid}.` : 'User not found in allow-list.', restarted: true, log });
      }

      const flag = which === 'device' && device
        ? `--rotate-device ${JSON.stringify(device)}`
        : '--rotate'; // all
      const r = await execCommand(sshConfig,
        `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"; zeroclaw gateway get-paircode ${flag} --port ${dashPort || 42617} 2>&1 | head -20`,
        { pool: false, timeoutMs: 30000 });
      const out = (r.stdout || '').trim();
      const ok = !/error|failed/i.test(out);
      return NextResponse.json({ success: ok, output: ok ? (out || `Pairing revoked (${which === 'device' && device ? device : 'all devices'}).`) : out, log });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    logger.error('[agents/zeroclaw] action failed:', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'Request failed' });
  }
}

