'use client';

import { Wifi, Battery, Search, Terminal, Folder, Activity, Bot, Settings } from 'lucide-react';

/* The guest landing backdrop: a pure dark gradient with a faint emerald
   horizon glow — plus the macOS dock. */

const DOCK_APPS = [
  { icon: Terminal, label: 'Terminal' },
  { icon: Folder, label: 'Files' },
  { icon: Activity, label: 'Server Monitor' },
  { icon: Bot, label: 'AI Agents' },
  { icon: Settings, label: 'Settings' },
];

export default function DesktopChrome() {
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

      {/* macOS dock — sits above the bottom statusline */}
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[40] flex items-end gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/12 shadow-2xl pointer-events-none"
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
