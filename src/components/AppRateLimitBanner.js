'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Gauge, Info, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';

// ─── Module-level shared cache ────────────────────────────────────────────────
// All mounted instances share one data source and one in-flight fetch.
const cache = {
  data: null,          // { used, limit, remaining, percentage, resetsInSeconds, isAdmin }
  timestamp: 0,
  pendingPromise: null,
  subscribers: new Set(),
};

const CACHE_TTL_MS = 15_000; // 15 s — rate-limit data changes slowly
const POLL_INTERVAL_MS = 60_000; // refresh every 60 s in the background

function notifyAll(data) {
  cache.data = data;
  cache.timestamp = Date.now();
  // Persist for the GlobalRateLimitOverlay (reads via localStorage)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('_rl_cache', JSON.stringify({ percentage: data.percentage, ts: Date.now() }));
    }
  } catch { /* ignore */ }
  cache.subscribers.forEach((cb) => cb(data));
}

async function fetchStatus(force = false) {
  if (!force && cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }
  if (cache.pendingPromise) return cache.pendingPromise;

  cache.pendingPromise = (async () => {
    try {
      const res = await fetch('/api/user/rate-limit-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        const data = {
          used:            json.used ?? 0,
          limit:           json.limit ?? 2000,
          remaining:       json.remaining ?? 0,
          percentage:      json.percentage ?? 0,
          resetsInSeconds: json.resetsInSeconds ?? 0,
          isAdmin:         json.isAdmin ?? false,
        };
        notifyAll(data);
        return data;
      }
    } catch {
      // Silently ignore — don't break the UI on a network hiccup
    } finally {
      cache.pendingPromise = null;
    }
  })();
  return cache.pendingPromise;
}

/**
 * Push fresh data from an X-RateLimit-* header set (read by any API caller).
 * Call this whenever you parse those headers from a response.
 */
export function injectRateLimitHeaders(headers) {
  const used      = parseInt(headers.get?.('x-ratelimit-used') ?? '');
  const limit     = parseInt(headers.get?.('x-ratelimit-limit') ?? '');
  const remaining = parseInt(headers.get?.('x-ratelimit-remaining') ?? '');
  const reset     = parseInt(headers.get?.('x-ratelimit-reset') ?? '');

  if (!Number.isFinite(used) || !Number.isFinite(limit)) return;

  const now = Math.floor(Date.now() / 1000);
  const resetsInSeconds = Math.max(0, reset - now);
  const percentage = Math.min(100, Math.round((used / limit) * 100));

  notifyAll({
    used,
    limit,
    remaining: Math.max(0, remaining),
    percentage,
    resetsInSeconds,
    isAdmin: false,
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
function useRateLimitStatus() {
  const [data, setData] = useState(
    cache.data ?? { used: 0, limit: 2000, remaining: 2000, percentage: 0, resetsInSeconds: 0, isAdmin: false }
  );
  const [loading, setLoading] = useState(!cache.data);
  const mountedRef = useRef(true);

  const sync = useCallback((d) => {
    if (mountedRef.current) setData(d);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    cache.subscribers.add(sync);

    // Initial fetch
    if (!cache.data || Date.now() - cache.timestamp > CACHE_TTL_MS) {
      fetchStatus(true).finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    } else {
      setLoading(false);
    }

    // Background polling — coordinated via localStorage to avoid duplicate fetches across tabs
    const intervalId = setInterval(() => {
      const lastPoll = Number(
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('_rl_last_poll') || 0
          : 0
      );
      if (Date.now() - lastPoll < POLL_INTERVAL_MS - 5000) return; // another tab just polled
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('_rl_last_poll', String(Date.now()));
      }
      fetchStatus(true);
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      cache.subscribers.delete(sync);
      clearInterval(intervalId);
    };
  }, [sync]);

  return { data, loading };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatReset(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function barColor(pct) {
  if (pct >= 95) return 'from-rose-600 to-rose-400';
  if (pct >= 80) return 'from-amber-500 to-yellow-400';
  if (pct >= 60) return 'from-orange-500 to-amber-400';
  return 'from-violet-600 to-indigo-400';
}

function iconColor(pct) {
  if (pct >= 95) return 'text-rose-400';
  if (pct >= 80) return 'text-amber-400';
  if (pct >= 60) return 'text-orange-400';
  return 'text-violet-400';
}

function iconBg(pct) {
  if (pct >= 95) return 'bg-rose-500/20';
  if (pct >= 80) return 'bg-amber-500/20';
  if (pct >= 60) return 'bg-orange-500/20';
  return 'bg-violet-500/20';
}

// ─── Component ────────────────────────────────────────────────────────────────
/**
 * AppRateLimitBanner
 *
 * Global daily-request-quota progress banner. Renders in two modes:
 *
 *   compact={true}   — small inline pill for the taskbar (like AiUsageBar compact)
 *   compact={false}  — full sidebar bar with warning strips (default)
 *
 * Hidden entirely for admin users.
 */
export default function AppRateLimitBanner({ compact = false, className = '' }) {
  const { status: sessionStatus } = useSession();
  const { data, loading } = useRateLimitStatus();
  const [tooltip, setTooltip] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  const { used, limit, percentage, remaining, resetsInSeconds, isAdmin } = data;
  const isHigh     = percentage >= 80;
  const isCritical = percentage >= 95;
  const isDepleted = used >= limit;

  // Animate bar on mount / data change
  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarWidth(percentage));
    return () => cancelAnimationFrame(raf);
  }, [percentage]);

  // Don't render while unauthenticated, loading session, or admin
  if (sessionStatus !== 'authenticated') return null;
  if (isAdmin) return null;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return compact ? (
      <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white/5 border border-white/10">
        <Gauge size={10} className="text-slate-500 animate-pulse" />
        <div className="w-16 h-1 bg-white/10 rounded-full animate-pulse" />
      </div>
    ) : (
      <div className={`relative mb-4 ${className}`}>
        <div className="h-2 w-full bg-white/5 rounded-full animate-pulse" />
      </div>
    );
  }

  // ── Compact pill ─────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        className="relative inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-default"
        onMouseEnter={() => setTooltip(true)}
        onMouseLeave={() => setTooltip(false)}
      >
        {isCritical
          ? <ShieldAlert size={10} className="text-rose-400 animate-pulse" />
          : isHigh
          ? <AlertTriangle size={10} className="text-amber-400 animate-pulse" />
          : <Gauge size={10} className="text-violet-400" />
        }

        <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${barColor(percentage)} transition-all duration-700 ease-out`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <span className={`text-[9px] font-bold tabular-nums ${isCritical ? 'text-rose-400' : 'text-slate-400'}`}>
          {percentage}%
        </span>

        <button className="text-slate-500 hover:text-white transition-colors" aria-label="Daily quota info">
          <Info size={10} />
        </button>

        {tooltip && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2.5 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl z-[9999] pointer-events-none">
            <p className="text-[9px] text-slate-300 leading-relaxed">
              Daily API quota:{' '}
              <span className="text-white font-bold">{used.toLocaleString()}</span>
              {' / '}
              <span className="text-white font-bold">{limit.toLocaleString()}</span>
              <br />
              <span className="text-slate-500 italic">Resets in {formatReset(resetsInSeconds)} (midnight UTC+7)</span>
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Full bar ─────────────────────────────────────────────────────────────────
  return (
    <div className={`relative ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded-md ${iconBg(percentage)} ${iconColor(percentage)}`}>
            {isCritical
              ? <ShieldAlert size={12} />
              : isHigh
              ? <AlertTriangle size={12} />
              : <Gauge size={12} />
            }
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Daily Quota
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[9px] text-slate-500">
            <Clock size={9} />
            <span>Resets {formatReset(resetsInSeconds)}</span>
          </div>
          <button
            onMouseEnter={() => setTooltip(true)}
            onMouseLeave={() => setTooltip(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Quota info"
          >
            <Info size={12} />
          </button>
        </div>

        {tooltip && (
          <div className="absolute right-0 bottom-full mb-2 w-56 p-3 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl z-[9999] pointer-events-none">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              <span className="text-white font-bold">{used.toLocaleString()}</span>
              {' / '}
              <span className="text-white font-bold">{limit.toLocaleString()}</span>
              {' API requests used today.'}
              <br />
              <span className="text-[9px] text-slate-500 italic">
                Covers all features — monitor, terminal, backups, AI, etc.
                Resets at midnight UTC+7 ({formatReset(resetsInSeconds)} from now).
              </span>
            </p>
            {isCritical && (
              <p className="mt-1.5 text-[9px] text-rose-400 font-semibold">
                ⚠ Quota almost depleted — all API calls will be blocked soon.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Track */}
      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
        {/* Tick marks at 25 / 50 / 75 % */}
        {[25, 50, 75].map((t) => (
          <div key={t} className="absolute inset-y-0 w-px bg-white/10 z-10" style={{ left: `${t}%` }} />
        ))}
        {/* Fill */}
        <div
          className={`h-full bg-gradient-to-r ${barColor(percentage)} transition-all duration-700 ease-out relative overflow-hidden`}
          style={{ width: `${barWidth}%` }}
        >
          {!isDepleted && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ animation: 'rl_shimmer 2.5s infinite', transform: 'translateX(-100%)' }}
            />
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex justify-between mt-1.5 px-0.5">
        <span className={`text-[10px] font-black tracking-tight ${isCritical ? 'text-rose-400' : 'text-slate-500'}`}>
          {used.toLocaleString()} / {limit.toLocaleString()} requests
        </span>
        <span className="text-[10px] font-bold text-slate-600 uppercase tabular-nums">
          {percentage}%
        </span>
      </div>

      {/* Depleted banner */}
      {isDepleted && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <ShieldAlert size={12} className="text-rose-400 shrink-0" />
          <span className="text-[10px] text-rose-300 leading-tight">
            Daily quota reached — all API calls are blocked.{' '}
            <span className="text-rose-400 font-semibold">Resets in {formatReset(resetsInSeconds)}.</span>
          </span>
        </div>
      )}

      {/* High-usage warning */}
      {!isDepleted && isHigh && (
        <div className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle size={11} className="text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-300 leading-tight">
            {remaining.toLocaleString()} requests remaining today
          </span>
        </div>
      )}

      <style>{`
        @keyframes rl_shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
