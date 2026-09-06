'use client';

import { useEffect, useState } from 'react';
import { Wifi, Battery, Search, Terminal, Folder, Activity, Bot, Settings } from 'lucide-react';

/* The guest landing sits on the same macOS-style desktop the app uses:
   wallpaper, menu bar, dock. Static decoration — no interaction, no state
   beyond a 1s clock tick. */

const WALLPAPER = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop';

const DOCK_APPS = [
  { icon: Terminal, label: 'Terminal' },
  { icon: Folder, label: 'Files' },
  { icon: Activity, label: 'Server Monitor' },
  { icon: Bot, label: 'AI Agents' },
  { icon: Settings, label: 'Settings' },
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
    <span className="text-white/70 text-[11px] tabular-nums" suppressHydrationWarning>
      {now
        ? now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
          '  ' +
          now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : ''}
    </span>
  );
}

export default function DesktopChrome() {
  return (
    <>
      {/* Wallpaper + dimming overlay */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${WALLPAPER}')` }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(2,6,12,0.7) 0%, rgba(2,6,12,0.42) 38%, rgba(2,6,12,0.55) 72%, rgba(2,6,12,0.82) 100%)',
          }}
        />
        {/* Subtle scanline texture keeps the CRT/terminal identity */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
          }}
        />
      </div>

      {/* Menu bar */}
      <div
        className="fixed top-0 left-0 right-0 z-[40] h-7 flex items-center justify-between px-3 sm:px-4 bg-black/45 backdrop-blur-xl border-b border-white/8 select-none pointer-events-none"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <span className="text-white/85 text-[13px] leading-none"></span>
          {['Monitor', 'File', 'View', 'Security', 'Help'].map((m) => (
            <span key={m} className="hidden md:inline text-[11px] font-medium text-white/60">
              {m}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2.5 sm:gap-3 text-white/60">
          <Wifi size={12} />
          <Battery size={14} />
          <Search size={12} />
          <MenuClock />
        </div>
      </div>

      {/* Dock */}
      <div
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[40] flex items-end gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/12 shadow-2xl pointer-events-none"
        aria-hidden="true"
      >
        {DOCK_APPS.map((a) => (
          <span
            key={a.label}
            title={a.label}
            className="relative flex w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-white/8 border border-white/12 items-center justify-center text-slate-200 transition-transform duration-200 hover:-translate-y-2 hover:scale-110"
          >
            <a.icon size={18} />
            <span className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/45" />
          </span>
        ))}
      </div>
    </>
  );
}
