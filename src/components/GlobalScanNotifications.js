'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { ShieldCheck, X } from 'lucide-react';

const NOTIF_PREFS_KEY = 'virus-scan-notif-prefs';
const DEFAULT_NOTIF_PREFS = { enabled: true, clamav: true, maldet: true };
const ENGINE_LABELS = { clamav: 'ClamAV deep scan', maldet: 'LMD malware scan' };

// Time between polls when at least one engine is running (or recently
// finished). 10s feels live without being chatty.
const ACTIVE_POLL_MS = 10_000;
// Time between polls when there IS interest (installed engines, prior
// scans) but nothing is currently running.
const INTERESTED_POLL_MS = 60_000;
// Long backoff when every connection is "never used" — clamav idle, maldet
// idle, wazuh not installed. 5 minutes is plenty because nothing can
// possibly change in the user's notifications without an active scan
// (which is launched from the Virus Scanner app, which already mounts
// its own dedicated poller).
const IDLE_BACKOFF_MS = 5 * 60_000;
// Maximum connections polled in one pass — bound the worst case.
const MAX_CONNS_PER_PASS = 10;

/**
 * Desktop-wide notification banners for background virus scans.
 *
 * The previous version polled every SSH connection's tmux scan status every
 * 60s (or 10s while a scan was running), regardless of whether the user had
 * ever opened the Virus Scanner app or installed any engine. With 10 SSH
 * connections, that meant 10–60 /api/virus-scan/engine?tmux=1 requests
 * per minute, forever, even when nothing has ever scanned.
 *
 * The new design is opt-in / lazy:
 *   • We only poll connections that have shown "interest" — i.e. a prior
 *     poll reported something other than `idle` for clamav/maldet, or
 *     wazuh is installed. New connections start as "untracked" and are
 *     probed on the very next poll; if they show no interest, they are
 *     dropped from the active set until something forces a re-probe.
 *   • When every tracked connection is idle, the backoff grows to 5 min.
 *   • We pause entirely when the tab is hidden (Page Visibility API).
 *   • The Virus Scanner app dispatches a `virus-scan:recheck` event on
 *     mount / after install / after starting a scan, which forces a
 *     full re-probe of all connections so notifications appear without
 *     waiting for the backoff to expire.
 */
export default function GlobalScanNotifications() {
  const { state, apiFetch } = useApp();
  const [notifications, setNotifications] = useState([]);
  const prefsRef = useRef(DEFAULT_NOTIF_PREFS);
  const prevRunningRef = useRef({}); // `${connId}:${engine}` → last seen state
  // Set of connection IDs that have shown "interest" (some engine state
  // other than never-used). Only these connections are polled.
  const interestedConnsRef = useRef(new Set());

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

  // Drop interested flags for connections that no longer exist (deleted).
  useEffect(() => {
    const live = new Set(sshConns.map(c => c._id));
    for (const id of Array.from(interestedConnsRef.current)) {
      if (!live.has(id)) {
        interestedConnsRef.current.delete(id);
        // Also clear any per-conn state.
        for (const k of Object.keys(prevRunningRef.current)) {
          if (k.startsWith(id + ':')) delete prevRunningRef.current[k];
        }
      }
    }
  }, [sshConns]);

  const dismiss = useCallback((id) => setNotifications(n => n.filter(x => x.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    let iv = null;
    let isRunningAnywhere = false;
    // Set to true after the first-ever poll pass. Until then, the poller
    // probes a slice of connections to seed the "interested" set; after
    // that, the poller does ZERO work unless something is already
    // interesting or the user forces a recheck. Without this flag, the
    // poller would re-probe the full slice on every 5-min tick forever
    // (because every connection is idle, so the interested set stays
    // empty, so selectToPoll keeps returning the initial-discovery
    // list).
    let initialDiscoveryDone = false;

    const clearTimer = () => {
      if (iv) { clearInterval(iv); iv = null; }
    };

    const scheduleNext = (running) => {
      clearTimer();
      if (cancelled) return;
      const interested = interestedConnsRef.current.size > 0;
      // Long backoff when nothing is interesting — no engines, no scans.
      // 10s only when at least one scan is currently running.
      // 60s when at least one engine has been used but no scan is active.
      const delay = running
        ? ACTIVE_POLL_MS
        : (interested ? INTERESTED_POLL_MS : IDLE_BACKOFF_MS);
      iv = setInterval(pollAll, delay);
    };

    const isConnectionInteresting = (sessions) => {
      if (!sessions) return false;
      // "interest" = any engine shows non-idle OR wazuh is installed.
      if (sessions.clamav && sessions.clamav !== 'idle') return true;
      if (sessions.maldet && sessions.maldet !== 'idle') return true;
      if (sessions.wazuh != null) return true;
      return false;
    };

    const pollAll = async () => {
      if (cancelled) return;
      // Skip when the tab is hidden — the next visibility change or
      // recheck event will resume polling.
      if (typeof document !== 'undefined' && document.hidden) return;
      const conns = connsRef.current;
      if (!conns.length) return;
      let anyRunning = false;
      // Determine which connections to poll THIS pass:
      //   • always include connections we've already flagged as "interested"
      //   • if no connections are yet flagged AND this is the first
      //     pass, probe the first MAX_CONNS_PER_PASS once (initial
      //     discovery). After that, do NOTHING until something forces a
      //     re-probe — otherwise the idle poller would re-probe forever.
      const interested = interestedConnsRef.current;
      let toPoll = conns.filter(c => interested.has(c._id)).slice(0, MAX_CONNS_PER_PASS);
      if (toPoll.length === 0) {
        if (initialDiscoveryDone) return; // nothing to do; just wait
        // First-ever poll: probe a slice of connections to seed the
        // interested set.
        toPoll = conns.slice(0, MAX_CONNS_PER_PASS);
        initialDiscoveryDone = true;
      }
      for (const conn of toPoll) {
        if (cancelled) return;
        try {
          const res = await apiFetch(`/api/virus-scan/engine?tmux=1&connectionId=${encodeURIComponent(conn._id)}&_=${Date.now()}`);
          const data = res?.json ? await res.json() : res;
          if (cancelled || !data?.success || !data.sessions) continue;

          // Maintain the "interested" set based on what we just learned.
          if (isConnectionInteresting(data.sessions)) {
            interested.add(conn._id);
          } else {
            // This connection has nothing to notify about right now —
            // drop it from the active set so we don't bloat every 60s
            // tick. A future recheck event will re-probe it.
            interested.delete(conn._id);
          }

          for (const engine of ['clamav', 'maldet']) {
            const key = `${conn._id}:${engine}`;
            const now = data.sessions[engine];
            const prev = prevRunningRef.current[key];
            if (now === 'running') anyRunning = true;
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
      // Adapt interval based on whether any scan is running AND whether
      // anything is still "interested" (i.e. worth polling at all).
      if (anyRunning !== isRunningAnywhere) {
        isRunningAnywhere = anyRunning;
        scheduleNext(anyRunning);
      } else {
        // Re-schedule so the loop naturally downshifts from
        // INTERESTED (60s) → IDLE (5 min) when every connection loses
        // interest (e.g. an engine was uninstalled).
        scheduleNext(isRunningAnywhere);
      }
    };

    // Re-probe handler: the Virus Scanner app dispatches this event
    // whenever it mounts, after install/uninstall, after starting a scan,
    // etc. It forces a full probe so notifications appear without
    // waiting for the backoff to expire.
    const onRecheck = () => {
      if (cancelled) return;
      // Reset the interested set so the next poll re-probes everything.
      interestedConnsRef.current = new Set();
      // Allow the initial-discovery pass to run again — the user just
      // opened the Virus Scanner app or installed an engine, so the
      // previous "nothing interesting" state may be stale.
      initialDiscoveryDone = false;
      // Re-evaluate the schedule (probably becomes active since the
      // user just did something interesting).
      scheduleNext(true);
      // Fire the poll immediately.
      pollAll();
    };

    // Page visibility: pause when hidden, resume on visible.
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        clearTimer();
      } else {
        // Coming back to the tab — re-probe so notifications aren't stale.
        pollAll();
      }
    };

    window.addEventListener('virus-scan:recheck', onRecheck);
    document.addEventListener('visibilitychange', onVisibility);

    pollAll();
    // Start at the long backoff until we know whether anything is
    // interesting. The first pollAll() call above will populate the
    // interested set and then call scheduleNext() to pick the right
    // interval.
    scheduleNext(false);

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener('virus-scan:recheck', onRecheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
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