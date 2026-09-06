'use client';

import { useEffect, useState } from 'react';
import { Wifi, Battery, Search, Terminal, Activity, Shield, Database, Bot, Command, Rocket } from 'lucide-react';

/* The guest landing backdrop: a pure dark gradient with a faint emerald
   horizon glow — plus the macOS chrome: menu bar on top, dock at the
   bottom. Both are decorative simulations of the app's desktop. */

const DOCK_APPS = [
  { icon: Terminal, label: 'Terminal & SSH', cmd: '$ ssh --fleet' },
  { icon: Activity, label: 'Server Monitor', cmd: '$ watch --live' },
  { icon: Shield, label: 'Vault & Security', cmd: '$ vault --audit' },
  { icon: Database, label: 'Backups', cmd: '$ backup --sync' },
  { icon: Rocket, label: 'Auto Deploy', cmd: '$ deploy --auto' },
  { icon: Bot, label: 'AI Agents', cmd: '$ agent --spawn' },
];

function MenuClock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-emerald-100/70 text-[11px] tabular-nums" suppressHydrationWarning>
      {now
        ? now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
          '  ' +
          now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : ''}
    </span>
  );
}

export default function DesktopChrome({ onNavigate }) {
  return (
    <>
      {/* Backdrop: pure dark gradient + faint emerald horizon glow */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, #03070c 0%, #04090f 55%, #030b09 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 24% at 50% 96%, rgba(16,185,129,0.07) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
          }}
        />
      </div>

      {/* macOS menu bar — decorative simulation */}
      <div
        className="fixed top-0 left-0 right-0 z-[40] h-7 flex items-center justify-between px-3 sm:px-4 bg-black/45 backdrop-blur-xl border-b border-white/8 select-none pointer-events-none"
        aria-hidden="true"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Command size={13} className="text-emerald-300/80" />
          <span className="hidden md:inline text-[11px] font-semibold tracking-wide text-emerald-100/85">
            SSH Monitor
          </span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-3 text-white/60">
          <Wifi size={12} />
          <Battery size={14} />
          <Search size={12} />
          <MenuClock />
        </div>
      </div>

      {/* macOS dock — interactive: click an icon to jump to its story topic.
          Sits above the bottom statusline. */}
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[40] flex items-end gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/12 shadow-2xl"
        role="navigation"
        aria-label="App topics"
      >
        {DOCK_APPS.map((a) => (
          <button
            key={a.cmd}
            type="button"
            data-dock={a.cmd}
            title={a.label}
            aria-label={a.label}
            onClick={() => onNavigate && onNavigate(a.cmd)}
            className="group relative flex w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-white/8 border border-white/12 items-center justify-center text-slate-200 transition-all duration-300 hover:-translate-y-2 hover:scale-110 hover:bg-white/14 cursor-pointer"
          >
            <a.icon size={18} />
            <span className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/45" />
          </button>
        ))}
      </div>
    </>
  );
}
