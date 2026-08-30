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
if [ "$PR" = 0 ]; then
  case "${agentId}" in
    nanobot)  pgrep -f "nanobot gateway --config $HOME/.${agentId}/config.json" >/dev/null 2>&1 && PR=1 ;;
    zeroclaw) pgrep -f "zeroclaw.*--config-dir $HOME/.${agentId}" >/dev/null 2>&1 && PR=1 ;;
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
  tag="$(basename "$d")"
  echo "INSTANCE_DIR=\${tag#.${agentId}-}"
done
for d in "$HOME"/.${agentId}-*; do
  [ -d "$d" ] || continue
  tag="$(basename "$d")"
  RUN=0; [ -f "$d/daemon.pid" ] && kill -0 "$(cat "$d/daemon.pid")" 2>/dev/null && RUN=1
  if [ "$RUN" = 0 ]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)" 2>/dev/null
    systemctl --user is-active "${agentId}-gatew""ay@\${tag#.${agentId}-}" 2>/dev/null | grep -qx active && RUN=1
    # process-cmdline fallback: catches gateways started without a pidfile
    if [ "$RUN" = 0 ]; then
      case "${agentId}" in
        nanobot)  pgrep -f "nanobot gateway --config $d/config.json" >/dev/null 2>&1 && RUN=1 ;;
        zeroclaw) pgrep -f "zeroclaw.*--config-dir $d" >/dev/null 2>&1 && RUN=1 ;;
      esac
    fi
    # Hermes fallback: control-socket self-report (stale-pidfile proof)
    if [ "$RUN" = 0 ] && [ "${agentId}" = "hermes" ]; then
      export PATH="$HOME/.local/bin:/usr/local/lib/hermes-agent/venv/bin:$HOME/.hermes/hermes-agent/venv/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
      HB=$(command -v hermes 2>/dev/null)
      [ -n "$HB" ] && { HERMES_HOME="$d" timeout 12 "$HB" gatew""ay status 2>/dev/null | grep -q 'is running' && RUN=1; }
    fi
  fi
  echo "TAGRUN=\${tag#.${agentId}-}:$RUN"
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
export async function writeInstanceEnv(sshConfig, home, entries = {}) {
  const lines = Object.entries(entries)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  if (lines.length === 0) return { ok: true, skipped: true };
  const cmd = `mkdir -p "${home}"\ncat > "${home}/instance.env" <<'ENV_EOF'\n${lines.join('\n')}\nENV_EOF\necho ENV_OK`;
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
      `${XF} systemctl --user disable --now ${U} 2>/dev/null; systemctl --user stop ${U} 2>/dev/null; echo SD_STOPPED`,
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
