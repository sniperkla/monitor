/**
 * serverCompat.js — metadata + parser for the server compatibility probe.
 * The shell probe lives in compatProbeScript.js (POSIX sh, any distro).
 */
import { COMPAT_PROBE } from './compatProbeScript.js';
export { COMPAT_PROBE };

/** Metadata per probe id. impact is shown when status !== pass. */
export const COMPAT_META = {
  distro:      { label: 'Distribution',        cat: 'system',  impact: '' },
  node:        { label: 'Node.js',             cat: 'runtime', impact: 'Monitoring agent and AI deploys require Node.js — install via the agent wizard.' },
  npm:         { label: 'npm',                 cat: 'runtime', impact: 'Package installs (pm2, deps) will fail without npm.' },
  pgrep:       { label: 'pgrep',               cat: 'process', impact: 'Agent status detection degrades without it.' },
  pkill:       { label: 'pkill',               cat: 'process', impact: 'Agent stop/uninstall cannot terminate stray processes safely.' },
  ps:          { label: 'ps',                  cat: 'process', impact: 'Process listing unavailable.' },
  nohup:       { label: 'nohup',               cat: 'agent',   impact: 'Background agent start method unavailable.' },
  setsid:      { label: 'setsid',              cat: 'agent',   impact: 'Detached session start may fail.' },
  tmux:        { label: 'tmux',                cat: 'agent',   impact: 'Tmux start method unavailable (installer can add it).' },
  cron:        { label: 'crontab',             cat: 'agent',   impact: 'Scheduled jobs (firewall refresh, backups) are limited.' },
  systemd:     { label: 'systemd',             cat: 'system',  impact: 'System-service management limited; tmux/nohup methods still work.' },
  priv:        { label: 'Privilege level',     cat: 'system',  impact: 'Password-prompt sudo pauses automated installs.' },
  nproc:       { label: 'nproc (CPU count)',   cat: 'metrics', impact: 'CPU core metric shows N/A.' },
  mem_free:    { label: 'Memory (free -b)',    cat: 'metrics', impact: 'Memory metrics unavailable.' },
  df_pk:       { label: 'Disk (df -Pk)',       cat: 'metrics', impact: 'Disk metrics unavailable.' },
  proc_uptime: { label: '/proc/uptime',        cat: 'metrics', impact: 'Uptime precision reduced.' },
  net_dev:     { label: '/proc/net/dev',       cat: 'metrics', impact: 'Network throughput metrics unavailable.' },
  hostname_cmd:{ label: 'hostname',            cat: 'metrics', impact: 'Hostname falls back to connection name.' },
  uname:       { label: 'uname -r',            cat: 'metrics', impact: 'Kernel version unavailable.' },
  cpu_model:   { label: 'CPU model',           cat: 'metrics', impact: 'Generic CPU info via fallback.' },
  uptime_p:    { label: 'uptime -p',           cat: 'metrics', impact: 'Readable uptime falls back to raw seconds.' },
  curl_tls:    { label: 'curl (HTTPS/TLS)',    cat: 'network', impact: 'One-click installers need curl — install curl + ca-certificates.' },
  wget:        { label: 'wget (fallback)',     cat: 'network', impact: 'No secondary downloader if curl breaks.' },
  xz:          { label: 'xz (tar -xJ)',        cat: 'network', impact: 'Portable Node binary extraction limited.' },
  libc:        { label: 'C library',           cat: 'system',  impact: 'Determines whether official Node 20 binaries can run here.' },
};

export function parseCompatOutput(stdout) {
  const checks = [];
  let distro = null;
  const seen = new Set();
  for (const lineRaw of String(stdout || '').split('\n')) {
    const parts = lineRaw.trim().split('|');
    if (parts.length < 3) continue;
    const [id, status] = parts;
    const detail = parts.slice(2).join('|').trim();
    if (!COMPAT_META[id] || !['pass','warn','fail','info'].includes(status)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const meta = COMPAT_META[id];
    if (id === 'distro') { distro = detail; continue; }
    checks.push({ id, label: meta.label, category: meta.cat, status,
      detail, impact: status === 'pass' ? '' : meta.impact });
  }
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
    total: checks.length,
  };
  return { distro, checks, summary };
}
