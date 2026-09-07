'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, LoaderCircle, CircleCheck, TriangleAlert, ArrowRight } from 'lucide-react';
import { getCsrfToken, refreshCsrfToken } from '@/utils/csrfClient';

/**
 * Approve a relay install without ever seeing a token.
 *
 * The install command the user pastes into their terminal carries no secret.
 * The agent asks the server for a device code and prints an 8-character code;
 * the user types that code in here, while already signed in. The agent's next
 * poll receives the token.
 *
 * So the token never appears in argv, shell history, a downloaded .sh/.bat, or
 * the service definition — and the user never has to look at one.
 */
export default function RelayPairingPanel({ onApproved, onSupporterRequired }) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState(null);

  // Accept however they paste it — lowercase, no dash, stray spaces — and
  // reformat to XXXX-XXXX so the field always looks like the terminal.
  const handleChange = (raw) => {
    const clean = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    setCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
    if (error) setError(null);
  };

  const approve = async (userCode) => {
    const doFetch = async () =>
      fetch('/api/relay/device/approve', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken() || '',
        },
        body: JSON.stringify({ userCode }),
      });

    let res = await doFetch();
    // A rotated CSRF token is worth exactly one retry before we give up.
    if (res.status === 403) {
      await refreshCsrfToken();
      res = await doFetch();
    }
    return res;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const raw = code.replace(/[^A-Za-z0-9]/g, '');
    if (raw.length !== 8) {
      setError('Enter the 8-character code shown in your terminal.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await approve(code);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === 'SUPPORTER_REQUIRED') {
          onSupporterRequired?.();
          return;
        }
        setError(data.error || 'Could not approve that code.');
        return;
      }

      setApproved(true);
      onApproved?.(data);
    } catch (err) {
      setError(err.message || 'Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Approved: hand off to the parent's connection watcher ── */
  if (approved) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/25"
      >
        <CircleCheck size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[11px] font-bold text-emerald-300">Approved — waiting for your machine</p>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Your terminal should confirm within a few seconds. This panel updates automatically once
            the relay connects.
          </p>
        </div>
      </motion.div>
    );
  }

  /* ── Waiting for the user to type the code ── */
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-white">2</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[var(--text-secondary)]">Approve your computer</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Enter the code printed by the install command below</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={code}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
              aria-label="Relay pairing code"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700/60 text-center font-mono text-sm tracking-[0.3em] text-[var(--text-primary)] placeholder:text-slate-600 placeholder:tracking-[0.3em] focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || code.replace(/[^A-Za-z0-9]/g, '').length !== 8}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white text-xs font-bold transition-all shadow-lg shadow-amber-500/20 shrink-0"
          >
            {submitting ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <>
                Approve <ArrowRight size={12} />
              </>
            )}
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[11px] text-red-400"
            >
              <TriangleAlert size={12} className="shrink-0" />
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          The code is displayed by the install command and expires in 10 minutes. Approving it links
          that machine to your account — a token is issued straight to the agent, so you never have
          to copy one.
        </p>
      </form>
    </div>
  );
}
