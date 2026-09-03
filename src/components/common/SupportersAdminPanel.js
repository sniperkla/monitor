'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, RefreshCw, LoaderCircle, Crown, Ticket, Copy, Check, Ban, Inbox, ShieldCheck, ShieldOff, Clock, AlertCircle, Users, KeyRound, Activity, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function StatusBadge({ status }) {
  const cls =
    status === 'admin'
      ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
      : status === 'active'
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
        : 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${cls}`}>
      {status === 'admin' ? <Crown size={9} className="inline mr-0.5 -mt-0.5" /> : null}
      {status}
    </span>
  );
}

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * SupportersAdminPanel — admin tab body for the Ko-fi membership system.
 * Lists pending access requests and supporters, grants/revokes access
 * (the API also kills the target's active relays on revoke), and
 * generates single-use activation codes. Plaintext codes are shown once.
 */
export default function SupportersAdminPanel() {
  const { t } = useTranslation();

  const [data, setData] = useState(null); // { supporters, requests, defaultGrantDays }
  const [codeStats, setCodeStats] = useState(null); // { total, used, available }
  const [loading, setLoading] = useState(true);
  // Identifiers below are internal user ids, not emails — the API no longer
  // returns plaintext addresses, so actions are addressed by userId.
  const [busy, setBusy] = useState(''); // userId being acted on
  const [flash, setFlash] = useState(null); // { ok, text }
  const [days, setDays] = useState(30);

  const [genCount, setGenCount] = useState(5);
  const [genDays, setGenDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [freshCodes, setFreshCodes] = useState([]);
  const [copiedAll, setCopiedAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [supRes, codeRes] = await Promise.all([
        fetch('/api/admin/supporters', { credentials: 'include' }),
        fetch('/api/admin/supporters/codes', { credentials: 'include' }),
      ]);
      const sup = await supRes.json().catch(() => null);
      const cs = await codeRes.json().catch(() => null);
      if (sup?.success) {
        setData(sup);
        setDays(sup.defaultGrantDays || 30);
      } else if (sup) {
        setFlash({ ok: false, text: sup.error || 'Failed to load' });
      }
      if (cs?.success) setCodeStats(cs);
    } catch (e) {
      setFlash({ ok: false, text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (action, userId) => {
    if (busy || !userId) return;
    setBusy(userId);
    setFlash(null);
    try {
      const res = await fetch('/api/admin/supporters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, userId, days: Number(days) || 30 }),
      });
      const out = await res.json().catch(() => ({}));
      setFlash({ ok: !!out.success, text: out.success ? out.message : (out.error || 'Action failed') });
      if (out.success) await load();
    } catch (e) {
      setFlash({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setFreshCodes([]);
    setCopiedAll(false);
    try {
      const res = await fetch('/api/admin/supporters/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ count: Number(genCount) || 1, planDays: Number(genDays) || 30 }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.success) {
        setFreshCodes(out.codes || []);
        const csRes = await fetch('/api/admin/supporters/codes', { credentials: 'include' });
        const cs = await csRes.json().catch(() => null);
        if (cs?.success) setCodeStats(cs);
      } else {
        setFlash({ ok: false, text: out.error || 'Failed to generate codes' });
      }
    } catch (e) {
      setFlash({ ok: false, text: e.message });
    } finally {
      setGenerating(false);
    }
  };

  const copyAll = async () => {
    if (!freshCodes.length) return;
    try {
      await navigator.clipboard.writeText(freshCodes.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (_) {}
  };

  const requests = data?.requests || [];
  const supporters = data?.supporters || [];
  const activeCount = supporters.filter((s) => s.status === 'active' || s.status === 'admin').length;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
        <LoaderCircle size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Admin header — intentionally distinct from the public Supporter card. */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.12] via-[var(--bg-card)] to-pink-500/[0.08] p-5">
        <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <ShieldCheck size={19} className="text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {t('supporter.admin.heading', 'Membership Administration')}
              </h2>
              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-[8px] font-extrabold uppercase tracking-widest text-amber-300">Admin</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {t('supporter.admin.subtitle', { defaultValue: '{{active}} active memberships · {{pending}} requests awaiting review', active: activeCount, pending: requests.length })}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            title={t('supporter.admin.refresh', 'Refresh')}
            className="p-2 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={`text-[var(--text-secondary)] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {[
            { label: t('supporter.admin.metricMembers', 'Active members'), value: activeCount, icon: Users, color: 'text-emerald-400' },
            { label: t('supporter.admin.metricPending', 'Pending review'), value: requests.length, icon: Inbox, color: 'text-amber-300' },
            { label: t('supporter.admin.metricCodes', 'Codes available'), value: codeStats?.available ?? '—', icon: KeyRound, color: 'text-pink-300' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-[var(--border-color)] bg-black/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2"><Icon size={13} className={color} /><span className={`text-lg font-bold ${color}`}>{value}</span></div>
              <p className="mt-1 text-[9px] text-[var(--text-muted)] truncate">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {flash && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`px-3 py-2 rounded-xl text-[11px] font-medium border ${
            flash.ok
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
              : 'bg-red-500/10 text-red-400 border-red-500/25'
          }`}
        >
          {flash.text}
        </motion.div>
      )}

      {/* Admin policy controls */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-indigo-400" />
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{t('supporter.admin.policyTitle', 'Membership policy')}</h3>
            <p className="text-[10px] text-[var(--text-muted)]">{t('supporter.admin.policyHint', 'Set the default duration used when approving or extending access.')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
        <Clock size={13} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
          {t('supporter.admin.daysLabel', 'Grant duration')}
        </span>
        <input
          type="number"
          min={1}
          max={3650}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20 px-2 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-pink-500/40 text-center"
        />
        <span className="text-[11px] text-[var(--text-muted)]">
          {t('supporter.admin.daysUnit', 'days — stacks on remaining time')}
        </span>
      </div>
      </section>

      {/* Pending requests */}
      <section className="space-y-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Inbox size={12} /> {t('supporter.admin.requestsTitle', 'Pending Access Requests')}
        </h3>
        {requests.length === 0 ? (
          <p className="px-3 py-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[11px] text-[var(--text-muted)] text-center">
            {t('supporter.admin.requestsEmpty', 'No pending requests.')}
          </p>
        ) : (
          requests.map((r) => (
            <motion.div
              key={r.userId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                    {r.maskedName || r.maskedEmail || 'unknown'}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">{r.maskedEmail}</p>
                </div>
                {r.requestedAt && (
                  <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0">
                    {fmtDate(r.requestedAt)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {r.kofiName && (
                  <span className="px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20">
                    Ko-fi: {r.kofiName}
                  </span>
                )}
                {r.kofiEmail && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-color)]">
                    {r.kofiEmail}
                  </span>
                )}
              </div>
              {r.note && (
                <p className="text-[11px] text-[var(--text-secondary)] italic">&ldquo;{r.note}&rdquo;</p>
              )}
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => act('grant', r.userId)}
                  disabled={busy === r.userId}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/25 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50"
                >
                  {busy === r.userId ? <LoaderCircle size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                  {t('supporter.admin.grant', 'Grant')}
                </button>
                <button
                  onClick={() => act('dismiss', r.userId)}
                  disabled={busy === r.userId}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[var(--text-muted)] rounded-lg text-[11px] font-bold transition-all disabled:opacity-50"
                >
                  <Ban size={11} /> {t('supporter.admin.dismiss', 'Dismiss')}
                </button>
              </div>
            </motion.div>
          ))
        )}
      </section>

      {/* Unmatched Ko-fi webhook payments */}
      {(data?.kofiUnmatched || []).length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <AlertCircle size={12} /> {t('supporter.admin.kofiUnmatchedTitle', 'Unmatched Ko-fi Payments')}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)] px-1 leading-relaxed">
            {t('supporter.admin.kofiUnmatchedHint', 'These payments matched no account. Ask the supporter to submit an access request with their Ko-fi name/email, then grant manually.')}
          </p>
          {data.kofiUnmatched.map((p) => (
            <div key={p.messageId} className="p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
              <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                {p.fromName || t('supporter.admin.kofiAnonymous', 'anonymous')}
                {p.amount ? <span className="text-amber-400 font-mono"> · {p.amount} {p.currency}</span> : null}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] truncate">
                {p.fromEmail || t('supporter.admin.kofiAnonymous', 'anonymous')}
                {` · ${p.tierName || p.type}`}
                {(p.kofiTimestamp || p.receivedAt) && ` · ${fmtDate(p.kofiTimestamp || p.receivedAt) || ''}`}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Supporters list */}
      <section className="space-y-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Heart size={12} /> {t('supporter.admin.supportersTitle', 'Supporters')}
        </h3>
        {supporters.length === 0 ? (
          <p className="px-3 py-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[11px] text-[var(--text-muted)] text-center">
            {t('supporter.admin.supportersEmpty', 'No supporters yet.')}
          </p>
        ) : (
          supporters.map((s) => {
            const expiry = fmtDate(s.expiresAt);
            return (
              <div
                key={s.userId}
                className="p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shrink-0 text-[11px] font-bold text-pink-400 uppercase">
                  {(s.maskedName || s.maskedEmail || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-[var(--text-primary)] truncate">{s.maskedName || s.maskedEmail || 'unknown'}</p>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">
                    {s.maskedEmail}
                    {expiry
                      ? ` · ${s.status === 'expired' ? t('supporter.admin.expiredOn', 'expired on') : t('supporter.admin.expires', 'expires')} ${expiry}`
                      : s.isAdmin ? '' : ` · ${t('supporter.admin.noExpiry', 'no expiry set')}`}
                    {s.grantedBy ? ` · ${t('supporter.admin.by', 'by')} ${s.grantedBy}` : ''}
                  </p>
                  {s.note && <p className="text-[10px] text-[var(--text-muted)] truncate italic">{s.note}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => act('grant', s.userId)}
                    disabled={busy === s.userId || s.isAdmin}
                    title={s.isAdmin ? t('supporter.admin.adminNoRevoke', 'Admins always have access') : t('supporter.admin.extendHint', 'Extend membership')}
                    className="px-2.5 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[var(--text-secondary)] rounded-lg text-[11px] font-bold transition-all disabled:opacity-40"
                  >
                    {busy === s.userId ? <LoaderCircle size={11} className="animate-spin" /> : '+30'}
                  </button>
                  {!s.isAdmin && (
                    <button
                      onClick={() => act('revoke', s.userId)}
                      disabled={busy === s.userId}
                      title={t('supporter.admin.revokeHint', 'Revoke — also disconnects active relays')}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-all disabled:opacity-50"
                    >
                      {busy === s.userId ? <LoaderCircle size={11} className="animate-spin" /> : <ShieldOff size={12} />}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Activation codes */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Ticket size={12} /> {t('supporter.admin.codesTitle', 'Activation Codes')}
        </h3>

        {codeStats && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('supporter.admin.codesAvailable', 'Available'), value: codeStats.available, cls: 'text-emerald-400' },
              { label: t('supporter.admin.codesUsed', 'Used'), value: codeStats.used, cls: 'text-amber-400' },
              { label: t('supporter.admin.codesTotal', 'Total'), value: codeStats.total, cls: 'text-[var(--text-secondary)]' },
            ].map((stat) => (
              <div key={stat.label} className="px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                <p className={`text-lg font-bold ${stat.cls}`}>{stat.value}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('supporter.admin.genCount', 'How many')}
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-pink-500/40 text-center"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {t('supporter.admin.genDays', 'Days per code')}
              </span>
              <input
                type="number"
                min={1}
                max={3650}
                value={genDays}
                onChange={(e) => setGenDays(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-pink-500/40 text-center"
              />
            </label>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center justify-center gap-1.5 w-full px-4 py-2 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 rounded-xl text-white text-xs font-bold transition-all"
          >
            {generating ? <LoaderCircle size={12} className="animate-spin" /> : <Ticket size={12} />}
            {t('supporter.admin.generate', 'Generate Codes')}
          </button>

          {freshCodes.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-1 border-t border-[var(--border-color)] overflow-hidden">
              <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-[10px] font-bold text-amber-400">
                  {t('supporter.admin.codesOnce', 'Shown only once — copy now. Only hashes are stored.')}
                </p>
                <button
                  onClick={copyAll}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[10px] font-bold text-[var(--text-secondary)] transition-all shrink-0"
                >
                  {copiedAll ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                  {copiedAll ? t('supporter.admin.copied', 'Copied!') : t('supporter.admin.copyAll', 'Copy all')}
                </button>
              </div>
              <div className="grid gap-1">
                {freshCodes.map((code) => (
                  <div
                    key={code}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
                  >
                    <code className="text-[11px] font-mono text-pink-300 tracking-wide">{code}</code>
                    <Copyable text={code} label={t('supporter.admin.copy', 'Copy')} copiedLabel={t('supporter.admin.copied', 'Copied!')} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </div>
  );
}

function Copyable({ text, label, copiedLabel }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--border-color)] text-[10px] font-bold text-[var(--text-muted)] transition-all shrink-0"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? copiedLabel : label}
    </button>
  );
}
