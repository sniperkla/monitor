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

// Deterministic distinct port per instance tag (used by agents whose gateway
// needs a unique bind port). Port range: 18.000 + hash(tag) % 1000.
export function instancePort(inst, base = 18000) {
  if (!inst) return null;
  let h = 0;
  for (let i = 0; i < inst.length; i++) h = ((h << 5) - h + inst.charCodeAt(i)) | 0;
  return base + (Math.abs(h) % 1000);
}

// pidfile-scoped liveness: returns shell that echoes PID_ALIVE=1/0.
export function pidAliveCmd(home) {
  return `res=0;\n if [ -f "${home}/daemon.pid" ] && kill -0 $(cat "${home}/daemon.pid") 2>/dev/null; then res=1; fi;\n echo "PID_ALIVE=$res"`;
}

export async function pidAlive(sshConfig, home) {
  const r = await execCommand(sshConfig, pidAliveCmd(home), { pool: false, timeoutMs: 15000 });
  return /PID_ALIVE=1/.test(r.stdout || '');
}

// List every installed instance of an agent: [{ tag, running }].
export async function listInstances(sshConfig, agentId) {
  const r = await execCommand(sshConfig, `
DE=0; [ -d "$HOME/.${agentId}" ] && DE=1
echo "DEFAULT_EXISTS=$DE"
PR=0; [ -f "$HOME/.${agentId}/daemon.pid" ] && kill -0 $(cat "$HOME/.${agentId}/daemon.pid") 2>/dev/null && PR=1
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
  echo "TAGRUN=\${tag#.${agentId}-}:$RUN"
done
`, { pool: false, timeoutMs: 20000 });
  const out = r.stdout || '';
  const instances = [];
  if (/DEFAULT_EXISTS=1/.test(out)) instances.push({ tag: '', running: /PROC=1/.test(out) });
  for (const m of out.matchAll(/TAGRUN=([^:\n]+):(\d)/g)) {
    instances.push({ tag: m[1], running: m[2] === '1' });
  }
  return instances;
}

// Clone default-home identity files into a new tagged home (does NOT start).
export async function cloneDefaultHome(sshConfig, agentId, tag, files = []) {
  if (files.length === 0) return { existed: false, ok: false };
  const cpLines = files
    .map(f => `[ -f "$HOME/.${agentId}/${f}" ] && cp "$HOME/.${agentId}/${f}" "$HOME/.${agentId}-${tag}/${f}"`)
    .join('\n');
  const cmd = `
if [ -d "$HOME/.${agentId}-${tag}" ]; then echo "EXISTS"; exit 0; fi
mkdir -p "$HOME/.${agentId}-${tag}"
${cpLines}
mkdir -p "$HOME/.${agentId}-${tag}/logs"
echo CLONED
`;
  const r = await execCommand(sshConfig, cmd, { pool: false, timeoutMs: 30000 });
  return { existed: /EXISTS/.test(r.stdout || ''), ok: /CLONED|EXISTS/.test(r.stdout || '') };
}