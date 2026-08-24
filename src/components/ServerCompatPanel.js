'use client';
import { useState } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from 'lucide-react';

/**
 * ServerCompatPanel — runs the cross-distro capability probe on a server and
 * shows which app functions will PASS / WARN / FAIL, with impact explanations.
 */
export default function ServerCompatPanel({ connectionId, apiFetch }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

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
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

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
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold">
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

      {!result && !loading && (
        <p className="text-xs text-[var(--text-muted)]">
          Probes this server for every command family the app relies on and shows which functions will pass, warn or fail.
        </p>
      )}

      {result && (
        <div className="space-y-3">
          {result.distro && (
            <div className="text-[11px] text-[var(--text-muted)]">Detected: <span className="font-semibold text-[var(--text-primary)]">{result.distro}</span></div>
          )}
          {CATS.map(([cat, label]) => {
            const items = result.checks.filter(c => c.category === cat);
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
                        {c.impact && <div className="text-[10px] text-amber-300/80 leading-snug mt-0.5">⚠ {c.impact}</div>}
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
  );
}
