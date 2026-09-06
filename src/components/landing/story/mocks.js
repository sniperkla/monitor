'use client';

import { Lock, BrickWallShield, Bug, CloudCog, Database, Server, Rocket, GitBranch } from 'lucide-react';

/* ── Story section primitives ── */
function SectionHead({ cmd, index, title, sub }) {
  const typed = `$ ${cmd}`;
  return (
    <div className="io relative mb-8 sm:mb-10">
      <span
        data-px="0.13"
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 sm:-top-16 right-0 font-mono text-[84px] sm:text-[130px] font-bold leading-none text-white/[0.03] select-none"
      >
        {index}
      </span>
      <div className="flex items-center gap-3 mb-3">
        <span
          data-dot={cmd}
          className="h-2 w-2 rounded-full bg-slate-600 transition-all duration-500"
        />
        {/* The command "executes" as the section arrives: it types itself via
            the CSS typewriter gated by this head's .in-view class. Letter
            spacing is left normal — tracking would break the ch-width math. */}
        <span className="font-mono text-[10px] sm:text-[11px] text-slate-500">
          <span
            className="css-type"
            style={{ '--n': `${typed.length}ch`, '--td': '0.9s', '--sn': typed.length, '--tdel': '150ms' }}
          >
            {typed}
          </span>
          <span className="caret" style={{ width: '6px', height: '0.9em', animationDelay: '1.05s' }} />
        </span>
      </div>
      <h2 className="font-mono text-[clamp(1.25rem,3.4vw,1.9rem)] font-bold text-slate-100 tracking-wide">
        {title}
      </h2>
      <p className="mt-2.5 max-w-xl text-xs sm:text-sm text-slate-400 leading-relaxed">{sub}</p>
    </div>
  );
}

function Ghost({ children, className, speed }) {
  return (
    <span
      data-px={speed}
      aria-hidden="true"
      className={`pointer-events-none absolute font-mono select-none text-white/[0.025] ${className || ''}`}
    >
      {children}
    </span>
  );
}

/* ── Section mocks (pure divs, no images) ── */

const FLEET_TILES = [
  { host: 'web-01', tag: 'nginx', lines: '$ systemctl status nginx\n● active (running) since Mon\n▲ 0 reloads needed' },
  { host: 'db-01', tag: 'postgres', lines: '$ psql -c "select 1"\n?column?\n----------\n1' },
  { host: 'cache-01', tag: 'redis', lines: '$ redis-cli info\nused_memory: 12.4M\nconnected_slaves: 0' },
  { host: 'edge-01', tag: 'caddy', lines: '$ tmux attach -t edge' },
];

function FleetMock() {
  return (
    <div className="io mt-9 grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ '--d': '120ms' }}>
      {FLEET_TILES.map((t, i) => (
        <div
          key={t.host}
          data-px={i % 2 ? '-0.035' : '0.05'}
          className="relative rounded-lg border border-slate-700/50 bg-slate-950/60 p-3.5 font-mono text-[10px] leading-relaxed overflow-hidden"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
            <span className="text-slate-300">{t.host}</span>
            <span className="text-slate-600">· {t.tag}</span>
            <span className="ml-auto text-[8px] tracking-[0.2em] text-slate-600">LIVE</span>
          </div>
          <div className="text-slate-500 whitespace-pre-wrap">{t.lines}</div>
          {i === 3 && (
            <div className="mt-1 text-cyan-300/80">
              <span className="css-type" style={{ '--n': '28ch', '--td': '1.8s', '--sn': 28, '--tdel': '0.5s' }}>
                tail -f /var/log/access.log
              </span>
              <span className="caret" style={{ width: '6px', height: '0.9em' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const METRICS = [
  { k: 'CPU', v: 34 },
  { k: 'MEM', v: 61 },
  { k: 'DISK', v: 68 },
  { k: 'NET', v: 22 },
];

const CONTAINERS = [
  { name: 'nginx:alpine', id: 'a3f2', port: '443→443' },
  { name: 'postgres:16', id: 'b7c1', port: '5432' },
  { name: 'redis:7', id: 'e9d4', port: '6379' },
];

function MonitorMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-slate-500">
          server-monitor · web-01
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] text-emerald-400/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          STREAMING
        </span>
      </div>
      <div className="space-y-3">
        {METRICS.map((m, i) => (
          <div key={m.k} className="flex items-center gap-3" style={{ '--d': `${i * 90}ms` }}>
            <span className="w-9 font-mono text-[9px] text-slate-500">{m.k}</span>
            <span className="bar-track relative flex-1 h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
              <span className="bar-fill" style={{ '--w': `${m.v}%`, background: '#94a3b8', opacity: 0.75 }} />
            </span>
            <span className="w-9 text-right font-mono text-[10px] tabular-nums text-slate-400">
              {m.v}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-1.5">
        {CONTAINERS.map((c) => (
          <div key={c.id} className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
            <span className="text-slate-400">{c.name}</span>
            <span className="text-slate-600">Up 14d · {c.port}</span>
            <span className="ml-auto text-slate-700">{c.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SECURITY_ROWS = [
  { icon: Lock, title: 'Vault', detail: 'AES-256 · Shamir 3-of-5 · unsealed' },
  { icon: BrickWallShield, title: 'Firewall Blocklist', detail: '23 IPs banned · fail2ban jail ACTIVE' },
  { icon: Bug, title: 'Virus Scanner', detail: 'ClamAV sweep 04:00 · 0 threats' },
];

function SecurityMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="space-y-3">
        {SECURITY_ROWS.map((r, i) => (
          <div key={r.title} className="flex items-center gap-3" style={{ '--d': `${i * 110}ms` }}>
            <span className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 bg-slate-800/40 border border-slate-700/40">
              <r.icon size={14} className="text-slate-400" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-200">{r.title}</p>
              <p className="font-mono text-[9px] text-slate-500 truncate">{r.detail}</p>
            </div>
            <span className="ml-auto font-mono text-[8px] tracking-[0.2em] text-emerald-400/70 shrink-0">
              OK
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[10px] text-slate-500">
        <span className="text-emerald-400/80 mr-1.5">$</span>
        <span className="css-type" style={{ '--n': '34ch', '--td': '2.2s', '--sn': 34, '--tdel': '0.4s' }}>
          fail2ban-client set sshd banip 45.33.22.11
        </span>
        <span className="caret" style={{ width: '6px', height: '0.9em' }} />
      </div>
    </div>
  );
}

const BACKUPS = [
  { icon: CloudCog, label: 'Rclone → S3', detail: '1.24 GiB @ 38 MiB/s · verified', v: 100 },
  { icon: Database, label: 'Mongo snapshot', detail: 'daily · oplog tailing', v: 100 },
  { icon: Server, label: 'Bare-metal image', detail: 'weekly · 84% uploading', v: 84 },
];

function BackupMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="space-y-4">
        {BACKUPS.map((b, i) => (
          <div key={b.label} style={{ '--d': `${i * 110}ms` }}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <b.icon size={13} className="text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-200">{b.label}</span>
              <span className="ml-auto font-mono text-[9px] text-slate-500 tabular-nums">{b.detail}</span>
            </div>
            <span className="bar-track flex h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
              <span className="bar-fill" style={{ '--w': `${b.v}%`, background: '#94a3b8', opacity: 0.75 }} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[10px] text-slate-500">
        <span className="text-emerald-400/80 mr-1.5">cron</span>
        <span className="css-type" style={{ '--n': '30ch', '--td': '1.9s', '--sn': 30, '--tdel': '0.4s' }}>
          0 4 * * * backup --all --verify
        </span>
        <span className="caret" style={{ width: '6px', height: '0.9em' }} />
      </div>
    </div>
  );
}

function DeployMock() {
  const steps = [
    { icon: GitBranch, label: 'git push origin main', detail: 'received · 4 files' },
    { icon: CloudCog, label: 'Build image', detail: 'done · 42s' },
    { icon: Database, label: 'Migrate database', detail: 'ok · 0 downtime' },
    { icon: Server, label: 'Rolling update', detail: '3/3 live', v: 100 },
  ];
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="space-y-4">
        {steps.map((st, i) => (
          <div key={st.label} style={{ '--d': `${i * 110}ms` }}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <st.icon size={13} className="text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-200">{st.label}</span>
              <span className="ml-auto font-mono text-[9px] text-emerald-400/70">{st.detail}</span>
            </div>
            {st.v !== undefined && (
              <span className="bar-track flex h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                <span className="bar-fill" style={{ '--w': `${st.v}%`, background: '#94a3b8', opacity: 0.75 }} />
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[10px] text-slate-500">
        <span className="text-emerald-400/80 mr-1.5">$</span>
        <span className="css-type" style={{ '--n': '32ch', '--td': '2s', '--sn': 32, '--tdel': '0.4s' }}>
          autodeploy status --release v2.1.0
        </span>
        <span className="caret" style={{ width: '6px', height: '0.9em' }} />
      </div>
    </div>
  );
}

const AGENTS = [
  { name: 'Hermes Agent', status: 'IDLE', color: '#64748b', logo: '/agents/hermes.png' },
  { name: 'Nanobot', status: 'WATCHING', color: '#4ade80', logo: '/agents/nanobot.svg' },
  { name: 'OpenClaw', status: 'IDLE', color: '#64748b', logo: '/agents/openclaw.png' },
  { name: 'ZeroClaw', status: 'IDLE', color: '#64748b', logo: '/agents/zeroclaw.jpg' },
];

function AgentMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {AGENTS.map((a, i) => (
          <div
            key={a.name}
            className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
            style={{
              '--d': `${i * 80}ms`,
              borderColor: 'rgba(100,116,139,0.28)',
              background: 'rgba(15,23,42,0.45)',
            }}
          >
            {/* Real agent artwork from /public/agents, same assets the app uses */}
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-black/40 border border-white/5 shrink-0 overflow-hidden">
              <img src={a.logo} alt="" className="w-[18px] h-[18px] object-contain" loading="lazy" />
            </span>
            <span className="text-[10px] font-semibold text-slate-300 truncate">{a.name}</span>
            <span
              className="ml-auto font-mono text-[7px] tracking-[0.18em]"
              style={{ color: a.color }}
            >
              {a.status}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-black/40 border border-slate-800/80 p-3 font-mono text-[10px] leading-relaxed">
        <p className="flex items-center gap-1.5 text-[8px] tracking-[0.22em] uppercase text-slate-600 mb-2">
          <img src="/agents/nanobot.svg" alt="" className="w-3 h-3 object-contain opacity-70" loading="lazy" />
          nanobot · task log
        </p>
        <p className="text-slate-500">&gt; tail -f /var/log/auth.log</p>
        <p className="text-amber-300/80">&gt; anomaly: 5 failed ssh · 45.33.22.11</p>
        <p className="text-slate-500">
          &gt; action: banip + report{' '}
          <span className="css-type text-emerald-400/90" style={{ '--n': '9ch', '--td': '1s', '--sn': 9, '--tdel': '1.2s' }}>
            … done ✓
          </span>
          <span className="caret" style={{ width: '5px', height: '0.85em' }} />
        </p>
      </div>
    </div>
  );
}


export { SectionHead, Ghost, FleetMock, MonitorMock, SecurityMock, BackupMock, DeployMock, AgentMock };
