'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { ShieldCheck, X } from 'lucide-react';

const NOTIF_PREFS_KEY = 'virus-scan-notif-prefs';
const DEFAULT_NOTIF_PREFS = { enabled: true, clamav: true, maldet: true };
const ENGINE_LABELS = { clamav: 'ClamAV deep scan', maldet: 'LMD malware scan' };

/**
 * Desktop-wide notification banners for background virus scans.
 *
 * Polls every SSH connection's tmux scan status (lightweight single command)
 * and shows a macOS-style banner at the top-right of the screen when a
 * background scan transitions Running → finished. Works even while the
 * Virus Scanner app is closed.
 *
 * Preferences are shared with the Settings app via localStorage key
 * 'virus-scan-notif-prefs'.
 */
export default function GlobalScanNotifications() {
  const { state, apiFetch } = useApp();
  const [notifications, setNotifications] = useState([]);
  const prefsRef = useRef(DEFAULT_NOTIF_PREFS);
  const prevRunningRef = useRef({}); // `${connId}:${engine}` → 'running' | other

  // Load + watch preference changes from the Settings app
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(NOTIF_PREFS_KEY);
        if (raw) prefsRef.current = { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) };
      } catch (_) {}
    };
    load();
    window.addEventListener('storage', load);
    const iv = setInterval(load, 3000); // same-tab changes don't fire 'storage'
    return () => { window.removeEventListener('storage', load); clearInterval(iv); };
  }, []);

  const sshConns = (state.connections || []).filter(c => c.type === 'ssh' || (!c.type && !c.dbProvider));
  const connsRef = useRef(sshConns);
  useEffect(() => { connsRef.current = sshConns; }, [sshConns]);

  const dismiss = useCallback((id) => setNotifications(n => n.filter(x => x.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    let busy = false;

    const pollAll = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const conns = connsRef.current;
        if (!conns.length) return;
        // Poll each connection's tmux status sequentially (one light SSH cmd each)
        for (const conn of conns.slice(0, 10)) {
          if (cancelled) break;
          try {
            const res = await apiFetch(`/api/virus-scan/engine?tmux=1&connectionId=${encodeURIComponent(conn._id)}&_=${Date.now()}`);
            const data = res?.json ? await res.json() : res;
            if (cancelled || !data?.success || !data.sessions) continue;
            for (const engine of ['clamav', 'maldet']) {
              const key = `${conn._id}:${engine}`;
              const now = data.sessions[engine];
              const prev = prevRunningRef.current[key];
              if (prev === 'running' && now !== 'running') {
                const prefs = prefsRef.current;
                if (prefs.enabled && prefs[engine]) {
                  // Fetch finding summary for the banner subtitle
                  let sub = 'Background scan completed';
                  try {
                    const r2 = await apiFetch(`/api/virus-scan?connectionId=${encodeURIComponent(conn._id)}`);
                    const d2 = r2?.json ? await r2.json() : r2;
                    if (d2?.success && d2.latest?.summary) {
                      const s = d2.latest.summary;
                      const total = (s.critical || 0) + (s.high || 0) + (s.medium || 0) + (s.low || 0);
                      sub = total > 0
                        ? `${total} finding${total === 1 ? '' : 's'} — ${s.critical} critical, ${s.high} high`
                        : 'No threats found';
                    }
                  } catch (_) {}
                  if (!cancelled) {
                    setNotifications(n => [...n.slice(-4), {
                      id: `${Date.now()}-${key}`,
                      label: ENGINE_LABELS[engine] || engine,
                      host: conn.name || conn.host,
                      sub,
                    }]);
                  }
                }
              }
              prevRunningRef.current[key] = now;
            }
          } catch (_) {}
        }
      } finally {
        busy = false;
      }
    };

    pollAll();
    const iv = setInterval(pollAll, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [apiFetch]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[500] flex flex-col gap-2 w-80 pointer-events-none">
      {notifications.map(n => (
        <div
          key={n.id}
          className="pointer-events-auto rounded-xl border border-white/15 bg-[#1a1f2e]/90 backdrop-blur-xl shadow-2xl shadow-black/50 p-3 flex items-start gap-3"
          style={{ animation: 'vsNotifIn .25s ease' }}
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <ShieldCheck size={17} className="text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-100 leading-snug">{n.label} finished</p>
            <p className="text-[11px] text-slate-400 mt-0.5 break-words">
              {n.host ? `${n.host} · ` : ''}{n.sub}
            </p>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            className="text-slate-500 hover:text-slate-200 transition-colors shrink-0 mt-0.5"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}