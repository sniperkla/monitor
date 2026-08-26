'use client';
import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldX, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw, ChevronDown, ChevronRight, BadgeCheck } from 'lucide-react';

/**
 * ServerCompatPanel — runs the cross-distro capability probe on a server and
 * shows which app functions will PASS / WARN / FAIL, with impact explanations.
 *
 * UX (collapse fix): the full check list no longer renders as one long wall.
 * - A "Verified Distro Server" banner summarises the result and persists
 *   per-connection in localStorage so returning users see verification instantly.
 * - Only warn/fail items ("Needs attention") are always visible.
 * - Passed checks live inside a collapsed accordion with a scroll cap.
 */
const CACHE_KEY = (connectionId) => `webtop_compat_verified_${connectionId || 'none'}`;

export default function ServerCompatPanel({ connectionId, apiFetch }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showPassed, setShowPassed] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState(null);

  // Hydrate the last verification for this connection from localStorage
  useEffect(() => {
    setResult(null);
    setShowPassed(false);
    setVerifiedAt(null);
    if (!connectionId) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY(connectionId));
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.distro && cached?.summary) {
          setResult(cached);
          setVerifiedAt(cached.at || null);
        }
      }
    } catch { /* ignore corrupt cache */ }
  }, [connectionId]);

  const run = async () => {
    if (!connectionId || loading) return;
    setLoading(true); setError(null);
    try {
      // Use apiFetch when available so vault/user-DB headers (x-mongodb-uri,
      // x-vault-tunnel) ride along — the probe must hit the SAME database
      // the server list came from.
      const doFetch = apiFetch || fetch;
      const res = await doFetch('/api/ssh/compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Check failed');
      const withAt = { ...data, at: Date.now() };
      setResult(withAt);
      setVerifiedAt(withAt.at);
      try { localStorage.setItem(CACHE_KEY(connectionId), JSON.stringify(withAt)); } catch { /* quota */ }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const attention = result ? result.checks.filter(c => c.status === 'warn' || c.status === 'fail') : [];
  const passed = result ? result.checks.filter(c => c.status === 'pass') : [];
  const verified = result && result.summary.fail === 0;

  const CATS = [
    ['runtime', 'Runtime'],
    ['agent', 'Agent hosting'],
    ['process', 'Process tools'],
    ['metrics', 'Metrics collection'],
    ['network', 'Network / installers'],
    ['system', 'System / privilege'],
  ];
  const icon = (s) => s === 'pass'
    ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
    : s === 'warn'
      ? <AlertTriangle size={13} className="text-amber-400 shrink-0" />
      : <XCircle size={13} className="text-red-400 shrink-0" />;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-[var(--accent-indigo)]" size={18} />
          <h2 className="text-sm font-semibold">Compatibility Check</h2>
          {result && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${verified ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {result.summary.pass} pass · {result.summary.warn} warn · {result.summary.fail} fail
            </span>
          )}
        </div>
        <button
          onClick={run}
          disabled={!connectionId || loading}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 disabled:opacity-50 transition-all cursor-pointer"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? 'Probing…' : result ? 'Re-run' : 'Run check'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-2">{error}</div>
      )}

      {/* ── Verified Distro Server banner ───────────────────────────────────── */}
      {result && result.distro && (
        verified ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 mb-3">
            <BadgeCheck size={22} className="text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-emerald-300">Verified Distro Server <span className="text-emerald-400">✓</span></div>
              <div className="text-[11px] text-emerald-200/80 truncate">
                {result.distro} — all critical capabilities verified{verifiedAt ? ` · ${new Date(verifiedAt).toLocaleString()}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 mb-3">
            <ShieldX size={22} className="text-red-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-red-300">Not Verified — {result.summary.fail} critical failure{result.summary.fail > 1 ? 's' : ''}</div>
              <div className="text-[11px] text-red-200/80 truncate">{result.distro} — fix the failing checks below, then re-run.</div>
            </div>
          </div>
        )
      )}

      {!result && !loading && (
        <p className="text-xs text-[var(--text-muted)]">
          Probes this server for every command family the app relies on and shows which functions will pass, warn or fail.
        </p>
      )}
      {/* ── Collapsed details: attention first, passes folded away ──────────── */}
      {result && (
        <div className="space-y-3">
          {attention.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold mb-1">Needs attention ({attention.length})</div>
              <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-1.5">
                {attention.map(c => (
                  <div key={c.id} className="flex items-start gap-2 text-xs bg-black/20 rounded-lg px-2 py-1.5">
                    {icon(c.status)}
                    <div className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      {c.detail && <span className="text-[var(--text-muted)]"> — {c.detail}</span>}
                      {c.impact && <div className="text-[10px] text-amber-300/80 leading-snug mt-0.5">⚠ {c.impact}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {passed.length > 0 && (
            <div className="border border-[var(--border-color)] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowPassed(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-muted)] hover:bg-white/5 transition cursor-pointer"
              >
                {showPassed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="font-semibold">{showPassed ? 'Hide' : 'Show'} {passed.length} passed checks</span>
                <CheckCircle2 size={12} className="text-emerald-400 ml-auto" />
              </button>
              {showPassed && (
                <div className="max-h-56 overflow-y-auto px-3 pb-3 space-y-3">
                  {CATS.map(([cat, label]) => {
                    const items = passed.filter(c => c.category === cat);
                    if (!items.length) return null;
                    return (
                      <div key={cat}>
                        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold mb-1">{label}</div>
                        <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-1.5">
                          {items.map(c => (
                            <div key={c.id} className="flex items-start gap-2 text-xs bg-black/20 rounded-lg px-2 py-1.5">
                              {icon(c.status)}
                              <div className="min-w-0">
                                <span className="font-medium">{c.label}</span>
                                {c.detail && <span className="text-[var(--text-muted)]"> — {c.detail}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
