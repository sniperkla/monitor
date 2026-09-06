'use client';

import { useState, useEffect } from 'react';

/* ── tmux-style statusline; the left-middle slot follows the scroll story ── */
function StatusClock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span suppressHydrationWarning>
      {now ? now.toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--'}
    </span>
  );
}

function Statusline({ cmdRef }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[5] pointer-events-none flex items-center justify-between px-3 sm:px-5 font-mono text-[9px] sm:text-[10px] tracking-wide"
      style={{
        paddingBottom: 'calc(0.35rem + env(safe-area-inset-bottom))',
        background: 'linear-gradient(0deg, rgba(2,4,10,0.85) 0%, rgba(2,4,10,0.45) 70%, transparent 100%)',
      }}
    >
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-emerald-400/80">[0]</span>
        <span>monitor@orbit:~/access*</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <span ref={cmdRef} className="hidden sm:inline text-cyan-300/50">
          auth: PENDING
        </span>
        <span className="text-slate-500">AES-256</span>
        <span className="text-slate-400 tabular-nums">
          <StatusClock />
        </span>
      </div>
    </div>
  );
}


export { Statusline };
