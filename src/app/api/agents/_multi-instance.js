import { execCommand } from '@/app/api/server-backup/_ssh';

// ── Shared multi-instance helpers (hermes blueprint, reused by every agent) ──
// A "tagged" install lives at ~/.<agent>-<tag> and is fully isolated from the
// default ~/.<agent> (own config, own workspace, own log files, own daemon.pid).
// The default install (tag '') uses ~/.<agent> exactly as before.

export function parseInst(body = {}) {
  const raw = body?.instance ?? body?.config?.instance ?? body?.config?.tag ?? '';
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
}

export function homeDir(agentId, inst) {
  return inst ? `$HOME/.${agentId}-${inst}` : `$HOME/.${agentId}`;
}

// Deterministic distinct port per (agent, tag) pair. The agentId is mixed into
// the hash so two different agents using the same tag never collide on the same
// host, and the well-known default-gateway band (Hermes binds 18789) is skipped.
export function instancePort(agentId, inst, base = 18000) {
  if (!inst) return null;
  let h = 0;
  const salt = `${agentId}:${inst}`;
  for (let i = 0; i < salt.length; i++) h = ((h << 5) - h + salt.charCodeAt(i)) | 0;
  let port = base + (Math.abs(h) % 1000);
  if (port >= 18780 && port <= 18799) port += 100; // keep clear of Hermes default gateway (18789)
  return port;
}

// Several distinct ports for one instance (e.g. API server + webhook listener).
// Each port is derived from a DIFFERENT salt so they are independent draws from
// the hash instead of adjacent integers (adjacent ports are far more likely to
// collide with another instance's allocation). Returns [] for the default
// install, which keeps the agent's own shipped defaults.
export function instancePorts(agentId, inst, suffixes = ['api', 'hook']) {
  if (!inst) return [];
  return suffixes.map((s) => instancePort(agentId, `${inst}#${s}`));
}

// ── Per-instance isolation environment ────────────────────────────────────
// Relocating the home dir (<AGENT>_HOME) moves config, secrets, memories and
// logs — but it is NOT sufficient on its own. Hermes keeps several subsystems
// on ABSOLUTE paths outside the home, so two concurrent instances with
// different HERMES_HOME values still share them:
//
//   HERMES_KANBAN_HOME / _DB / _WORKSPACES_ROOT
//       the kanban board (database + workspaces + worklogs). Left unset, Hermes
//       resolves the board from a SHARED root, so every instance would read and
//       mutate the same tasks and the same workspace files.
//   HERMES_KANBAN_BOARD
//       pins which board a process — and the scheduler's worker subprocesses —
//       may see. Without it workers can reach tasks belonging to a sibling.
//   TERMINAL_SANDBOX_DIR  → ~/.hermes/sandboxes  (shared shell workspace)
//   HERMES_OAUTH_FILE     → ~/.hermes/auth.json  (shared OAuth credentials)
//   CODEX_HOME            → ~/.codex             (shared Codex config + auth)
//   HERMES_WRITE_SAFE_ROOT
//       hard-blocks write_file/patch outside the listed roots.
//   API_SERVER_PORT / WEBHOOK_PORT
//       the gateway's listening sockets; every instance would otherwise bind
//       the same default port and only the first would ever start.
//
// Pinning all of them inside the instance home is what makes "separate memory,
// separate credentials, separate filesystem access and no shared runtime state"
// true for concurrently running instances.
export function instanceIsolationEnv(agentId, inst, home) {
  if (!inst) return {}; // default install keeps the agent's shipped defaults
  // HERMES_KANBAN_BOARD must be a slug: lowercase alphanumeric plus - and _.
  const board = String(inst).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'default';
  const [apiPort, hookPort] = instancePorts(agentId, inst, ['api', 'hook']);
  if (agentId !== 'hermes') {
    return { [`${String(agentId).toUpperCase()}_HOME`]: home };
  }
  const env = {
    HERMES_HOME: home,
    HERMES_KANBAN_HOME: `${home}/kanban`,
    HERMES_KANBAN_DB: `${home}/kanban/kanban.db`,
    HERMES_KANBAN_WORKSPACES_ROOT: `${home}/kanban/workspaces`,
    HERMES_KANBAN_BOARD: board,
    TERMINAL_SANDBOX_DIR: `${home}/sandboxes`,
    HERMES_OAUTH_FILE: `${home}/auth.json`,
    CODEX_HOME: `${home}/codex`,
    HERMES_WRITE_SAFE_ROOT: [home, `${home}/sandboxes`, `${home}/workspace`].join(':'),
  };
  if (apiPort) env.API_SERVER_PORT = String(apiPort);
  if (hookPort) env.WEBHOOK_PORT = String(hookPort);
  return env;
}

// pidfile-scoped liveness: returns shell that echoes PID_ALIVE=1/0.
// `kill -0` alone can false-positive after the OS reuses the PID, so the
// process cmdline is also verified to point inside this instance home.
export function pidAliveCmd(home) {
  // marker: the distinctive part of the home path, e.g. ".hermes-bot2" —
  // "$HOME" is NOT expanded in /proc cmdline args, so grep for the suffix.
  const marker = String(home).replace('$HOME/', '').replace(/\/+$/, '') || home;
  return [
    'res=0',
    `pid=$(cat "${home}/daemon.pid" 2>/dev/null)`,
    `if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= 2>/dev/null | grep -qF "${marker}"; then res=1; fi`,
    'echo "PID_ALIVE=$res"',
  ].join('\n');
}

export async function pidAlive(sshConfig, home) {
  const r = await execCommand(sshConfig, pidAliveCmd(home), { timeoutMs: 15000 });
  return /PID_ALIVE=1/.test(r.stdout || '');
}

// List every installed instance of an agent: [{ tag, running }].
export async function listInstances(sshConfig, agentId) {
  const r = await execCommand(sshConfig, `
DE=0; [ -d "$HOME/.${agentId}" ] && DE=1
echo "DEFAULT_EXISTS=$DE"
PR=0; [ -f "$HOME/.${agentId}/daemon.pid" ] && kill -0 $(cat "$HOME/.${agentId}/daemon.pid") 2>/dev/null && PR=1
[ -f "$HOME/.${agentId}/gateway.pid" ] && kill -0 $(cat "$HOME/.${agentId}/gateway.pid") 2>/dev/null && PR=1
if [ "$PR" = 0 ]; then
  { systemctl is-active ${agentId}-gate""way 2>/dev/null || systemctl is-active ${agentId} 2>/dev/null || systemctl --user is-active ${agentId}-gate""way 2>/dev/null || systemctl --user is-active ${agentId} 2>/dev/null; } | grep -qx active && PR=1
fi
if [ "$PR" = 0 ]; then
    case "${agentId}" in
      nanobot)
        # Match ANY nanobot gateway, then attribute it by the home token found
        # in its command line. The old pattern required an explicit
        # --config <home>/config.json flag — gateways launched before that flag
        # became standard (bare "nanobot gateway") never matched it, so a
        # perfectly healthy default instance reported as stopped. An empty home
        # token also means "default": a bare launcher has no path to attribute.
        # NBLISTSCAN marks this script's own text so the scan skips itself.
        for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
          [ -r "/proc/$p/cmdline" ] || continue
          C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
          [ -n "$C" ] || continue
          case "$C" in *NBLISTSCAN*) continue;; esac
          case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
          HME=$(echo "$C" | grep -o '\\.${agentId}[-a-zA-Z0-9_]*' | head -1)
          case "$HME" in ""|".${agentId}") PR=1; break;; esac
        done
        ;;
    zeroclaw) pgrep -f "zeroclaw.*--config-dir $HOME/.${agentId}" >/dev/null 2>&1 && PR=1 ;;
    openclaw) pgrep -f "openclaw.*--config $HOME/.${agentId}" >/dev/null 2>&1 && PR=1 ;;
    hermes)
      for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
        [ -n "$hp" ] || continue
        HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
        [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
        if [ -z "$HME" ] || [ "$HME" = "$HOME/.hermes" ] || [ "$HME" = ".hermes" ]; then PR=1; break; fi
      done
      if [ "$PR" = 0 ]; then
        command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx hermes-agent && PR=1
      fi
      ;;
  esac
fi
# Hermes self-reports its own lifecycle via control socket — catches gateways
# the (possibly stale) pidfile/systemd cannot see. Run through the venv so
# hermes_cli imports resolve (bare /usr/local/lib/hermes-agent/hermes fails
# on system python without venv site-packages).
if [ "$PR" = 0 ] && [ "${agentId}" = "hermes" ]; then
  export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  HB=$(command -v hermes 2>/dev/null)
  [ -n "$HB" ] && { HERMES_HOME="$HOME/.hermes" timeout 12 "$HB" gatew""ay status 2>/dev/null | grep -q 'is running' && PR=1; }
fi
echo "PROC=$PR"
for d in "$HOME"/.${agentId}-*; do
  [ -d "$d" ] || continue
  tname="$(basename "$d")"
  tag="\${tname#.${agentId}-}"
  case "$tag" in docker|bak|*.bak|*.old|tmp|*.env.bak|*.config.yaml.bak) continue ;; esac
  VALID=0
  if [ -f "$d/config.yaml" ] || [ -f "$d/config.json" ] || [ -f "$d/config.toml" ] || [ -f "$d/.env" ] || [ -f "$d/instance.env" ] || [ -d "$d/hermes-agent" ] || [ -f "$d/daemon.pid" ] || [ -f "$d/gateway.pid" ]; then
    VALID=1
  fi
  RUN=0
  [ -f "$d/daemon.pid" ] && kill -0 "$(cat "$d/daemon.pid")" 2>/dev/null && RUN=1
  [ -f "$d/gateway.pid" ] && kill -0 "$(cat "$d/gateway.pid")" 2>/dev/null && RUN=1
  if [ "$RUN" = 0 ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
    { systemctl --user is-active "${agentId}-gatew""ay@\${tag}" 2>/dev/null || systemctl --user is-active "${agentId}@\${tag}" 2>/dev/null || systemctl is-active "${agentId}-gatew""ay@\${tag}" 2>/dev/null; } | grep -qx active && RUN=1
    # process-cmdline fallback: catches gateways started without a pidfile
    if [ "$RUN" = 0 ]; then
      case "${agentId}" in
        nanobot)
          for p in $(pgrep -f '[n]anobot' 2>/dev/null); do
            [ -r "/proc/$p/cmdline" ] || continue
            C=$(tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
            [ -n "$C" ] || continue
            case "$C" in *NBLISTSCAN*) continue;; esac
            case "$C" in *"gatew"*"ay"*) ;; *) continue;; esac
            HME=$(echo "$C" | grep -o '\\.${agentId}[-a-zA-Z0-9_]*' | head -1)
            if [ "$HME" = ".\${tname}" ]; then RUN=1; break; fi
          done
          ;;
        zeroclaw) pgrep -f "zeroclaw.*--config-dir $d" >/dev/null 2>&1 && RUN=1 ;;
        openclaw) pgrep -f "openclaw.*--config $d" >/dev/null 2>&1 && RUN=1 ;;
        hermes)
          for hp in $(pgrep -f '[h]ermes.*gatew[a]y' 2>/dev/null; pgrep -f '[h]ermes_cli.*gatew[a]y' 2>/dev/null); do
            [ -n "$hp" ] || continue
            HME="$(tr '\\0' '\\n' < /proc/$hp/environ 2>/dev/null | sed -n 's/^HERMES_HOME=//p' | head -1)"
            [ -n "$HME" ] || HME="$(tr '\\0' '\\n' < /proc/$hp/cmdline 2>/dev/null | grep -o '\\.hermes[-a-zA-Z0-9_]*' | head -1)"
            case "$HME" in *".\${tname}"|*".\${tname}/") RUN=1; break ;; esac
          done
          ;;
      esac
    fi
    # Hermes fallback: control-socket self-report (stale-pidfile proof)
    if [ "$RUN" = 0 ] && [ "${agentId}" = "hermes" ]; then
      export PATH="$d/hermes-agent/venv/bin:$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
      HB=$(command -v hermes 2>/dev/null)
      [ -n "$HB" ] && { HERMES_HOME="$d" timeout 8 "$HB" gatew""ay status 2>/dev/null | grep -q 'is running' && RUN=1; }
    fi
  fi
  if [ "$RUN" = 1 ] || [ "$VALID" = 1 ]; then
    echo "TAGRUN=\${tag}:$RUN"
  fi
done
`, { timeoutMs: 60000 });
  const out = r.stdout || '';
  const instances = [];
  if (/DEFAULT_EXISTS=1/.test(out)) instances.push({ tag: '', running: /PROC=1/.test(out) });
  for (const m of out.matchAll(/TAGRUN=([^:\n]+):(\d)/g)) {
    instances.push({ tag: m[1], running: m[2] === '1' });
  }
  return instances;
}

// Clone default-home identity files into a new tagged home (does NOT start).
// .env is NEVER copied — a tagged instance must use its OWN bot token / API
// keys, so it starts with a clean, empty .env and the user fills credentials
// via the Env tab before first start. This avoids two instances fighting over
// the same Telegram bot (getUpdates 409) and shared paid API keys.
export async function cloneDefaultHome(sshConfig, agentId, tag, files = []) {
  if (files.length === 0) return { existed: false, ok: false };
  const identityFiles = files.filter((f) => f.split('/').pop() !== '.env');
  const cpLines = identityFiles
    .map((f) => {
      // nested targets (workspace/PROMPT.md) need their parent dir first
      const dir = f.includes('/')
        ? `mkdir -p "$HOME/.${agentId}-${tag}/${f.slice(0, f.lastIndexOf('/'))}"\n  `
        : '';
      return `${dir}[ -f "$HOME/.${agentId}/${f}" ] && cp "$HOME/.${agentId}/${f}" "$HOME/.${agentId}-${tag}/${f}"`;
    })
    .join('\n');
  const cmd = `
if [ -d "$HOME/.${agentId}-${tag}" ]; then echo "EXISTS"; exit 0; fi
mkdir -p "$HOME/.${agentId}-${tag}"
${cpLines}
mkdir -p "$HOME/.${agentId}-${tag}/logs"
# Fresh empty .env — the instance is fully credential-isolated from the start.
: > "$HOME/.${agentId}-${tag}/.env"
echo CLONED
`;
  const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 30000 });
  return {
    existed: /EXISTS/.test(r.stdout || ''),
    ok: /CLONED|EXISTS/.test(r.stdout || ''),
    tokenSame: false, // .env is never cloned — always isolated
  };
}

// Per-instance binary isolation. Each instance executes from its own runtime
// tree under its own home. Hermes deliberately uses a FULL COPY (not hard links):
// a hard-linked Python runtime still shares package files with the default and
// is not complete isolation when an upgrade or repair mutates those files.
// The lighter hard-link optimization remains available for the other agents.
export async function copyInstanceBin(sshConfig, agentId, tag, HH) {
  if (!tag) return { copied: false, bin: '', err: 'no tag' };
  const plan = {
    hermes: { dstRoot: 'hermes-agent', src: '', bin: 'hermes-agent/venv/bin/hermes', py: 'venv/bin/python', fullCopy: true },
    nanobot: { dstRoot: 'venv', src: '$HOME/.nanobot/venv', bin: 'venv/bin/nanobot', py: 'venv/bin/python' },
    openclaw: { dstRoot: 'install', src: '$HOME/.openclaw/local', bin: 'install/bin/openclaw', py: null },
  }[agentId];
  if (!plan) return { copied: false, bin: '', err: `unsupported ${agentId}` };
  const dst = `${HH}/${plan.dstRoot}`;
  // Directory holding the venv's console scripts ("venv/bin/python" →
  // "venv/bin"). Computed in JS, NOT with the shell's ${var%/*}: inside a JS
  // template literal the "${" opens an interpolation, so "/*" is parsed as the
  // start of a BLOCK COMMENT that swallows the rest of the script.
  const pyDir = plan.py ? plan.py.replace(/\/[^/]*$/, '') : '';
  const fixShebang = plan.py ? `
# Rewrite bin/* shebangs to the instance-local interpreter so the copied venv
# is self-contained (default rm -rf cannot break it).
NEWPY="${dst}/${plan.py}"
BINDIR="${dst}/${pyDir}"
for f in "\${BINDIR}/"*; do
  [ -f "$f" ] || continue
  head1=$(head -1 "$f" 2>/dev/null)
  case "$head1" in
    '#!'*) case "$head1" in *"python"*) printf '#!%s\\n' "$NEWPY" > "$f.tmp"; tail -n +2 "$f" >> "$f.tmp"; mv -f "$f.tmp" "$f"; chmod 755 "$f";; esac ;;
  esac
done
# pyvenv.cfg home points at the system python — still valid after the copy.
# Editable installs (pip install -e) embed the ORIGINAL tree path in .pth /
# finder files — repoint them at this copy so the venv is fully self-contained.
SP=$(ls -d ${dst}/venv/lib/python*/site-packages 2>/dev/null | head -1)
if [ -n "$SP" ] && [ "$SRC" != "$dst" ]; then
  grep -rlF "$SRC" "$SP" 2>/dev/null | while read -r pf; do
    sed -i "s|$SRC|${dst}|g" "$pf" 2>/dev/null
  done
fi
` : '';
  const sourceBlock = plan.fullCopy ? `
# Hermes installs may be user-local or root-wide. Select the default runtime
# without falling back to a shared live path at execution time.
SRC=""
for candidate in "$HOME/.hermes/hermes-agent" "/usr/local/lib/hermes-agent" "/opt/hermes-agent"; do
  if [ -d "$candidate" ]; then SRC="$candidate"; break; fi
done
[ -n "$SRC" ] || { echo NO_SRC; exit 0; }
# cp -a is intentional for Hermes: no hard-linked code, venv, plugins or
# package metadata is shared with the default instance.
cp -a "$SRC" "${dst}" 2>/dev/null || { echo COPY_FAIL; exit 0; }
echo COPY_FULL
` : `
SRC="${plan.src}"
[ -e "$SRC" ] || { echo NO_SRC; exit 0; }
if cp -al "$SRC" "${dst}" 2>/dev/null; then
  echo COPY_LINKED
elif cp -a "$SRC" "${dst}" 2>/dev/null; then
  echo COPY_FULL
else
  echo COPY_FAIL
  exit 0
fi
`;
  const cmd = `
[ -d "${dst}" ] && echo ALREADY && exit 0
mkdir -p "${HH}"
${sourceBlock}
rm -f "${dst}/daemon.pid" 2>/dev/null
# Strip copied bytecode: stale .pyc files can fail after a Python/runtime change.
find "${dst}" -depth -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
find "${dst}" -name '*.pyc' -delete 2>/dev/null
${fixShebang}
`;
  const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 180000 });
  const out = r.stdout || '';
  const bin = /COPY_LINKED|COPY_FULL|ALREADY/.test(out) ? `${HH}/${plan.bin}` : '';
  return {
    copied: /COPY_LINKED|COPY_FULL/.test(out),
    linked: /COPY_LINKED/.test(out),
    already: /ALREADY/.test(out),
    bin, err: /NO_SRC/.test(out) ? 'bin source not found' : /COPY_FAIL/.test(out) ? 'copy failed' : '',
  };
}
// ── Strict mode: one Linux user per "friend" (per-owner isolation) ────────
// A dedicated user gets its own home (own .env, own token, own systemd user
// units, own cgroups) — nobody can read anyone else's credentials. The friend
// then uses the agent through their OWN SSH connection in the monitor, so every
// existing route (install/spawn/systemd/logs) works unchanged against their
// account. Linger keeps their gateway units running without an active login.

// Linux username must be lowercase, short, and safe.
export function sanitizeUsername(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 31)
    .replace(/^[^a-z_]+/, '');
}

// Script body: idempotently create the user, harden its home, enable linger
// (so user-level gateway units run without a login session), and optionally
// install the friend's SSH public key.
export function provisionUserScript(username, { publicKey = '' } = {}) {
  const u = sanitizeUsername(username);
  const PUB = Buffer.from(String(publicKey || ''), 'utf8').toString('base64');
  return `
U="${u}"
case "$U" in ''|root|daemon|bin|sys|sync|games|man|lp|mail|news|uucp|proxy|www-data|backup|list|irc|gnats|nobody|systemd-*|sshd|messagebus) echo "BAD_USER=$U"; exit 0;; esac
S=""
command -v useradd >/dev/null 2>&1 && S="" || S="sudo -n"
if ! id "$U" >/dev/null 2>&1; then
  \$S useradd -m -s /bin/bash "$U" 2>/dev/null || useradd -m -s /bin/bash "$U" 2>/dev/null || { echo "CREATE_FAILED"; exit 0; }
fi
export XDG_RUNTIME_DIR="/run/user/\$(id -u)" 2>/dev/null
loginctl enable-linger "\$U" 2>/dev/null || \$S loginctl enable-linger "\$U" 2>/dev/null || true
HOME_U="\$(getent passwd "\$U" | cut -d: -f6)"
chmod 700 "\$HOME_U" 2>/dev/null || true
if [ -n "${PUB}" ]; then
  mkdir -p "\$HOME_U/.ssh" && chmod 700 "\$HOME_U/.ssh"
  echo "${PUB}" | base64 -d > "\$HOME_U/.ssh/authorized_keys"
  chmod 600 "\$HOME_U/.ssh/authorized_keys"
  chown -R "\$U:\$U" "\$HOME_U/.ssh" 2>/dev/null || true
  echo "PUBKEY=1"
fi
echo "USER=\$U"
echo "HOME_U=\$HOME_U"
echo "UID_U=\$(id -u "\$U")"
echo "PROVISIONED"
`;
}

// Server-side: run the provision script on the remote host.
export async function provisionUser(sshConfig, username, opts = {}) {
  const r = await execCommand(sshConfig, provisionUserScript(username, opts), { pool: false, timeoutMs: 30000 });
  const out = r.stdout || '';
  const val = (k) => out.match(new RegExp(`${k}=(.*)`))?.[1]?.trim() || null;
  const ok = /PROVISIONED/.test(out);
  return {
    ok,
    existed: ok && !/PUBKEY|CREATE_FAILED/.test(out) ? true : undefined,
    username: val('USER'),
    home: val('HOME_U'),
    uid: val('UID_U'),
    error: /BAD_USER/.test(out) ? 'Reserved or invalid username' : /CREATE_FAILED/.test(out) ? 'useradd failed (need root/sudo)' : ok ? null : ((r.stderr || '').slice(-200) || 'provision failed'),
  };
}

// ── Per-instance systemd template unit (true process isolation) ──────────
// One template per agent: ~/.config/systemd/user/<agentId>-gateway@.service
// Every tagged instance then runs as its OWN user-level cgroup with
// supervision (Restart=on-failure) and hardening (NoNewPrivileges, PrivateTmp):
//   systemctl --user start <agentId>-gateway@<tag>
// The per-instance identity (HERMES_HOME / OPENCLAW_* / --config / --config-dir
// and per-instance port) is relocated via EnvironmentFile=<HH>/instance.env,
// written right before start. %i expands to the tag, %h to the user home.

// Build the unit body for an agent's template unit.
// Resource caps keep one instance from starving the host — important when
// instances are shared with other people. Override via opts, or pass 'none'
// to disable a cap entirely.
export function gatewayUnit(agentId, {
  description,
  envLines = [],
  execStart,
  logFile,
  memoryMax = '2G',
  cpuQuota = '200%',
}) {
  const lines = [
    '[Unit]',
    `Description=${description} (instance %i)`,
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    ...envLines,
    `ExecStartPre=/bin/mkdir -p %h/.${agentId}-%i/logs`,
    execStart,
    'Restart=on-failure',
    'RestartSec=3',
    'SuccessExitStatus=0 143',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    `StandardOutput=append:${logFile}`,
    `StandardError=append:${logFile}`,
  ];
  if (memoryMax && memoryMax !== 'none') lines.push(`MemoryMax=${memoryMax}`);
  if (cpuQuota && cpuQuota !== 'none') lines.push(`CPUQuota=${cpuQuota}`);
  lines.push('', '[Install]', 'WantedBy=default.target');
  return lines.join('\n');
}

// Idempotently install the template unit + daemon-reload.
export async function ensureInstanceUnit(sshConfig, agentId, unit) {
  const cmd = `
UNIT="$HOME/.config/systemd/user/${agentId}-gatew""ay@.service"
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<'UNIT_EOF'
${unit}
UNIT_EOF
export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
systemctl --user daemon-reload 2>/dev/null || true
echo UNIT_OK
`;
  const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 20000 });
  return { ok: /UNIT_OK/.test(r.stdout || '') };
}

// Write the per-instance env file consumed by the template unit.
//
// `expand: true` writes the file through an UNQUOTED heredoc so the remote shell
// resolves `$HOME` to the real home directory. This is required whenever the
// values are paths: systemd does NOT expand environment variables (or `$HOME`)
// inside an EnvironmentFile, so a literal `HERMES_HOME=$HOME/.hermes-bot2`
// would leave the instance pointed at a non-existent directory. The nohup
// fallback sources the same file, so both paths need real absolute paths.
export async function writeInstanceEnv(sshConfig, home, entries = {}, { expand = false } = {}) {
  // A newline would terminate the KEY=value line early and inject arbitrary
  // content into the file; a backtick would enable command substitution when
  // the heredoc is unquoted.
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/`/g, '');
  // Keys must not contain whitespace, '=', quotes, '$' or a backtick — any of
  // those could terminate the line early or (in expand mode) be expanded by the
  // shell. Deliberately permissive otherwise, so existing callers passing
  // non-identifier keys keep working exactly as before.
  const lines = Object.entries(entries)
    .filter(([k, v]) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(String(k)) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${clean(v)}`);
  if (lines.length === 0) return { ok: true, skipped: true };
  const delim = expand ? 'ENV_EOF' : "'ENV_EOF'";
  const cmd = `mkdir -p "${home}"\ncat > "${home}/instance.env" <<${delim}\n${lines.join('\n')}\nENV_EOF\necho ENV_OK`;
  const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 15000 });
  return { ok: /ENV_OK/.test(r.stdout || '') };
}

// Is a usable systemd *user* session available?
export async function sdAvailable(sshConfig) {
  const r = await execCommand(sshConfig,
    `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null; systemctl --user show-environment >/dev/null 2>&1 && echo SD_OK || echo SD_NO`,
    { pool: false, timeoutMs: 15000 });
  return /SD_OK/.test(r.stdout || '');
}

// Full lifecycle for one tagged instance via the template unit.
// Returns null for a failed start/restart so the caller can fall back to the
// legacy nohup+pidfile path; status/stop always return a result.
export async function sdInstanceCtl(sshConfig, agentId, inst, op) {
  const U = `${agentId}-gatew""ay@${inst}`;
  const XF = `export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null;`;
  if (op === 'status') {
    const r = await execCommand(sshConfig,
      `${XF} systemctl --user is-active ${U} 2>/dev/null | grep -qx active && echo ACTIVE || echo INACTIVE`,
      { pool: false, timeoutMs: 20000 });
    return { ok: true, active: /ACTIVE/.test(r.stdout || ''), via: 'systemd' };
  }
  if (op === 'stop') {
    const r = await execCommand(sshConfig,
      `${XF} systemctl --user disable --now ${U} 2>/dev/null; systemctl --user stop ${U} 2>/dev/null; systemctl --user reset-failed ${U} 2>/dev/null; rm -f "$HOME/.config/systemd/user/default.target.wants/${agentId}-gatew\"\"ay@${inst}.service" "$HOME/.config/systemd/user/multi-user.target.wants/${agentId}-gatew\"\"ay@${inst}.service" 2>/dev/null; systemctl --user daemon-reload 2>/dev/null || true; echo SD_STOPPED`,
      { pool: false, timeoutMs: 45000 });
    return { ok: /SD_STOPPED/.test(r.stdout || ''), out: ((r.stdout || '') + (r.stderr || '')).slice(-300), via: 'systemd' };
  }
  // start / restart
  if (op === 'restart') await sdInstanceCtl(sshConfig, agentId, inst, 'stop');
  const r = await execCommand(sshConfig,
    `${XF} loginctl enable-linger $(whoami) 2>/dev/null || sudo -n loginctl enable-linger $(whoami) 2>/dev/null || true; systemctl --user daemon-reload 2>/dev/null || true; systemctl --user enable --now ${U} 2>/dev/null; sleep 2; systemctl --user is-active ${U} 2>/dev/null | grep -qx active && echo SD_UP || echo SD_DOWN`,
    { pool: false, timeoutMs: 60000 });
  const ok = /SD_UP/.test(r.stdout || '');
  return ok ? { ok: true, via: 'systemd', out: 'GW_UP (systemd)' } : null; // null → caller falls back
}
