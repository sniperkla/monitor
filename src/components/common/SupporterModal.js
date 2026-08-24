'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Coffee, Zap, ChevronDown, ChevronRight, Sparkles, Link2, Ticket, Send, CircleCheck, LoaderCircle, LogIn, Crown, Cable, Gauge, FolderSync, Bot, MousePointerClick } from 'lucide-react';
import { useSession, signIn } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { useSupporter } from '@/hooks/useSupporter';

const KOFI_URL = process.env.NEXT_PUBLIC_KOFI_PAGE_URL || 'https://ko-fi.com';

/* Immersive ambient styles */
const AMBIENT_CSS = `
@keyframes sup-float-up {
  0%   { transform: translateY(110%) scale(0.7); opacity: 0; }
  12%  { opacity: 0.9; }
  85%  { opacity: 0.5; }
  100% { transform: translateY(-160%) scale(1.15); opacity: 0; }
}
@keyframes sup-aurora {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes sup-shimmer {
  0%   { transform: translateX(-160%) skewX(-18deg); }
  60%, 100% { transform: translateX(260%) skewX(-18deg); }
}
@keyframes sup-ring {
  0%   { transform: scale(0.85); opacity: 0.55; }
  100% { transform: scale(1.65); opacity: 0; }
}
@keyframes sup-heartbeat {
  0%, 100% { transform: scale(1); }
  14%      { transform: scale(1.14); }
  28%      { transform: scale(1); }
  42%      { transform: scale(1.1); }
  56%      { transform: scale(1); }
}
.sup-aurora-bg {
  background: linear-gradient(120deg, #ec4899 0%, #f43f5e 22%, #a855f7 48%, #6366f1 72%, #ec4899 100%);
  background-size: 300% 300%;
  animation: sup-aurora 9s ease-in-out infinite;
}
`;

const FLOATING_HEARTS = [
  { left: '8%',  size: 10, delay: 0,   dur: 7.5 },
  { left: '20%', size: 7,  delay: 1.4, dur: 9 },
  { left: '33%', size: 12, delay: 2.8, dur: 8 },
  { left: '47%', size: 8,  delay: 0.9, dur: 10 },
  { left: '58%', size: 11, delay: 3.6, dur: 7 },
  { left: '70%', size: 7,  delay: 2.1, dur: 9.5 },
  { left: '82%', size: 10, delay: 4.4, dur: 8.5 },
  { left: '92%', size: 8,  delay: 1.1, dur: 10.5 },
];

/* Interactive: click-to-burst hearts */
let burstId = 0;
function useHeartBursts() {
  const [bursts, setBursts] = useState([]);
  const spawnBurst = useCallback((x, y) => {
    const id = ++burstId;
    setBursts((b) => [...b.slice(-5), { id, x, y }]);
    setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 1100);
  }, []);
  return { bursts, spawnBurst };
}

function BurstHearts({ bursts }) {
  return (
    <>
      {bursts.map((burst) => (
        <span key={burst.id} className="pointer-events-none absolute z-30" style={{ left: burst.x, top: burst.y }}>
          {[...Array(8)].map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const dist = 34 + (i % 3) * 14;
            return (
              <motion.span
                key={i}
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
                animate={{
                  x: Math.cos(angle) * dist,
                  y: Math.sin(angle) * dist - 10,
                  scale: 1.1,
                  opacity: 0,
                  rotate: (i % 2 ? 1 : -1) * 120,
                }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="absolute text-pink-300"
                style={{ fontSize: 11 + (i % 3) * 3 }}
              >
                ♥
              </motion.span>
            );
          })}
        </span>
      ))}
    </>
  );
}

/* Interactive: 3D tilt wrapper for feature cards */
function TiltCard({ children, className }) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const onMove = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -py * 14, ry: px * 14 });
  };
  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      animate={{ rotateX: tilt.rx, rotateY: tilt.ry }}
      transition={{ type: 'spring', damping: 18, stiffness: 260 }}
      style={{ transformStyle: 'preserve-3d', perspective: 500 }}
      whileHover={{ y: -3, scale: 1.03 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Interactive: live speed race demo (ECO vs TURBO) */
const RACE_CYCLE = 5; // seconds per lap
function SpeedRace() {
  const { t } = useTranslation();
  return (
    <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <Gauge size={11} className="text-amber-400" />
          {t('supporter.speedDemo', 'Feel the difference')}
        </p>
        <MousePointerClick size={11} className="text-[var(--text-muted)] animate-pulse" />
      </div>

      {/* ECO lane */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] font-semibold">
          <span className="text-emerald-400">ECO</span>
          <span className="text-[var(--text-muted)]">~1–5 MB/s</span>
        </div>
        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
            animate={{ width: ['4%', '100%'] }}
            transition={{ duration: RACE_CYCLE * 3, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </div>

      {/* TURBO lane */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] font-semibold">
          <span className="text-amber-300 flex items-center gap-1">
            TURBO <Zap size={8} fill="currentColor" />
          </span>
          <span className="text-amber-300">~60 MB/s</span>
        </div>
        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300"
            style={{ boxShadow: '0 0 12px rgba(251,191,36,0.55)' }}
            animate={{ width: ['4%', '100%'] }}
            transition={{ duration: RACE_CYCLE * 0.42, repeat: Infinity, ease: 'linear', repeatDelay: RACE_CYCLE * 0.58 }}
          />
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        {t('supporter.speedDemoHint', 'Live preview — TURBO is up to 20× faster.')}
      </p>
    </div>
  );
}

/**
 * SupporterModal — Ko-fi membership, activation-code redemption and access requests.
 * Optional onGranted callback fires when a redemption flips the user to supporter.
 */
export default function SupporterModal({ open, onClose, onGranted }) {
  const { t } = useTranslation();
  const { data: session, status: sessionStatus } = useSession();
  const { isSupporter, expiresAt, refresh } = useSupporter({ refreshOnFocus: false });

  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null);

  const [kofiName, setKofiName] = useState('');
  const [kofiEmail, setKofiEmail] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState(null);

  const { bursts, spawnBurst } = useHeartBursts();
  const [showDetails, setShowDetails] = useState(false);
  const [openBenefit, setOpenBenefit] = useState(null);

  const isGuest = sessionStatus === 'unauthenticated';

  const handleRedeem = async () => {
    if (!code.trim() || redeeming) return;
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      const res = await fetch('/api/user/supporter/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setRedeemMsg({ ok: true, text: data.message || t('supporter.redeemSuccess', 'Activated!') });
        setCode('');
        await refresh();
        onGranted?.();
      } else {
        setRedeemMsg({ ok: false, text: data.error || t('supporter.redeemFailed', 'Invalid code') });
      }
    } catch (e) {
      setRedeemMsg({ ok: false, text: e.message });
    } finally {
      setRedeeming(false);
    }
  };

  const handleRequest = async () => {
    if (requesting) return;
    if (!kofiName.trim() && !kofiEmail.trim()) {
      setRequestMsg({ ok: false, text: t('supporter.requestNeedName', 'Please enter your Ko-fi name or email') });
      return;
    }
    setRequesting(true);
    setRequestMsg(null);
    try {
      const res = await fetch('/api/user/supporter/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kofiName: kofiName.trim(), kofiEmail: kofiEmail.trim(), note: reqNote.trim() }),
      });
      const data = await res.json();
      setRequestMsg({
        ok: !!data.success,
        text: data.success ? (data.message || t('supporter.requestSent', 'Request sent')) : (data.error || 'Error'),
      });
    } catch (e) {
      setRequestMsg({ ok: false, text: e.message });
    } finally {
      setRequesting(false);
    }
  };

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  /* Staggered feature card variants */
  const featureContainer = useMemo(() => ({
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
  }), []);
  const featureItem = {
    hidden: { opacity: 0, y: 14, scale: 0.96 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', damping: 20, stiffness: 300 } },
  };

  const FEATURES = [
    { icon: Cable,          label: t('supporter.featureRelay', 'Local Relay — SSH/SFTP through your own machine'), short: 'Local Relay', tint: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', detail: t('supporter.detailRelay', 'SSH & SFTP tunnel through your own machine — reach private or NAT-ed servers without exposing any ports publicly.') },
    { icon: Gauge,          label: t('supporter.featureTurbo', 'TURBO / BALANCED / AUTO-COOL transfer speeds'), short: 'TURBO speeds', tint: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', detail: t('supporter.detailTurbo', 'Pick TURBO (~60 MB/s), BALANCED or AUTO-COOL per transfer — tuned to your link quality and device thermals.') },
    { icon: FolderSync,     label: t('supporter.featureCrossServer', 'Cross-server file transfer'), short: 'Cross-server', tint: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', detail: t('supporter.detailCross', 'Move files directly between any two connected servers — no download-to-your-device hop in between.') },
    { icon: Bot,            label: t('supporter.featureAi', 'AI assistant (terminal, wiki, database & deploy)'), short: 'AI assistant', tint: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', detail: t('supporter.detailAi', 'AI help inside the terminal, wiki, database explorer and deploy flow — command suggestions, error analysis and query building.') },
    { icon: Link2,          label: t('supporter.featureConnections', 'More concurrent SSH connections than the free plan'), short: 'More connections', tint: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', detail: t('supporter.detailConnections', 'Keep more SSH sessions open at the same time — the free plan caps concurrent connections, supporters get plenty of headroom for multi-server work.') },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="supporter-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        >
          <style>{AMBIENT_CSS}</style>

          <motion.div
            aria-hidden
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="pointer-events-none absolute w-[520px] h-[520px] rounded-full bg-pink-500/15 blur-[120px]"
          />

          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 26 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 26 }}
            transition={{ type: 'spring', damping: 23, stiffness: 300 }}
            className="relative w-full max-w-md max-h-[88%] bg-[var(--bg-secondary)] border border-pink-500/20 rounded-3xl shadow-[0_20px_80px_-15px_rgba(236,72,153,0.35)] flex flex-col overflow-hidden"
          >
            {/* Immersive hero header (click to burst hearts!) */}
            <div
              className="relative shrink-0 overflow-hidden cursor-pointer select-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                spawnBurst(e.clientX - rect.left, e.clientY - rect.top);
              }}
              title={t('supporter.clickHint', 'Click me ✨')}
            >
              <div className="sup-aurora-bg absolute inset-0 opacity-90" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-[var(--bg-secondary)]" />

              <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
                {FLOATING_HEARTS.map((h, i) => (
                  <span
                    key={i}
                    className="absolute bottom-0 text-white/40"
                    style={{
                      left: h.left,
                      fontSize: h.size,
                      animation: `sup-float-up ${h.dur}s linear ${h.delay}s infinite`,
                    }}
                  >
                    ♥
                  </span>
                ))}
              </div>

              <BurstHearts bursts={bursts} />

              <button
                onClick={(e) => { e.stopPropagation(); onClose?.(); }}
                className="absolute top-3 right-3 z-40 p-1.5 rounded-lg bg-black/25 hover:bg-black/45 backdrop-blur-sm transition-colors"
              >
                <X size={14} className="text-white/90" />
              </button>

              <div className="relative z-10 px-6 pt-7 pb-5 flex flex-col items-center text-center pointer-events-none">
                <div className="relative w-16 h-16 mb-3 flex items-center justify-center">
                  {!isGuest && (
                    <>
                      <span className="absolute inset-0 rounded-full border-2 border-pink-300/60" style={{ animation: 'sup-ring 2.4s ease-out infinite' }} />
                      <span className="absolute inset-0 rounded-full border-2 border-rose-300/50" style={{ animation: 'sup-ring 2.4s ease-out 1.2s infinite' }} />
                    </>
                  )}
                  <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/30 backdrop-blur-md shadow-lg shadow-pink-900/30 flex items-center justify-center">
                    <Coffee
                      size={26}
                      className={`${isSupporter ? 'text-emerald-300' : 'text-pink-200'} drop-shadow-[0_0_10px_rgba(244,114,182,0.8)]`}
                      style={{ animation: isGuest ? undefined : 'sup-heartbeat 1.8s ease-in-out infinite' }}
                    />
                  </div>
                </div>

                <h3 className="text-xl font-black text-white tracking-tight drop-shadow-md flex items-center gap-2">
                  {t('supporter.title', 'Supporter Membership')}
                  {isSupporter && (
                    <motion.span
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', damping: 10, stiffness: 250, delay: 0.2 }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-400/25 text-emerald-200 border border-emerald-300/40 backdrop-blur-sm"
                    >
                      <Crown size={9} /> {t('supporter.activeBadge', 'Active')}
                    </motion.span>
                  )}
                </h3>
                <p className="text-[13px] font-light text-white/85 mt-1.5 max-w-[300px] leading-relaxed drop-shadow">
                  {t('supporter.subtitle', 'Unlock Local Relay + TURBO speeds')}
                </p>
                {!isSupporter && !isGuest && (
                  <motion.p
                    animate={{ opacity: [0.45, 1, 0.45] }}
                    transition={{ duration: 2.4, repeat: Infinity }}
                    className="mt-2.5 text-[11px] font-medium text-white/80 flex items-center gap-1.5"
                  >
                    <MousePointerClick size={10} /> {t('supporter.clickHint', 'Click anywhere up here ✨')}
                  </motion.p>
                )}
              </div>
            </div>

            <div className="p-5 pt-4 overflow-y-auto flex-1 min-h-0 space-y-5">
              {isGuest ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-4 py-6 text-center"
                >
                  <LogIn size={28} className="text-[var(--text-muted)]" />
                  <p className="text-xs text-[var(--text-muted)]">
                    {t('supporter.signInRequired', 'Sign in to manage a supporter membership.')}
                  </p>
                  <button
                    onClick={() => signIn()}
                    className="px-6 py-2 bg-pink-500 hover:bg-pink-600 rounded-xl text-xs font-bold text-white transition-all shadow-lg shadow-pink-500/25"
                  >
                    {t('supporter.signIn', 'Sign In')}
                  </button>
                </motion.div>
              ) : isSupporter ? (
                <motion.div
                  initial="hidden"
                  animate="show"
                  variants={featureContainer}
                  className="flex flex-col items-center gap-4 py-2 text-center"
                >
                  <motion.div variants={featureItem} className="relative">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
                      className="absolute -inset-2 rounded-full border border-dashed border-emerald-500/30"
                    />
                    <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(52,211,153,0.25)]">
                      <CircleCheck size={30} className="text-emerald-400" />
                    </div>
                  </motion.div>
                  <motion.p variants={featureItem} className="text-base font-bold text-[var(--text-primary)]">
                    {t('supporter.thankYou', 'Thank you for your support! 💖')}
                  </motion.p>
                  {expiryLabel && (
                    <motion.p variants={featureItem} className="text-xs text-[var(--text-muted)]">
                      {t('supporter.validUntil', 'Valid until')} <strong className="text-emerald-400">{expiryLabel}</strong>
                    </motion.p>
                  )}
                </motion.div>
              ) : (
                <>
                  {/* Expandable detailed benefits — the single feature list entry point */}
                  <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={12} className="text-pink-400" />
                        {t('supporter.allBenefits', 'See all benefits in detail')}
                      </span>
                      <motion.span animate={{ rotate: showDetails ? 180 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronDown size={13} />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {showDetails && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
                            {FEATURES.map((f, i) => (
                              <div key={f.short}>
                                <button
                                  onClick={() => setOpenBenefit(openBenefit === i ? null : i)}
                                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                  <span className="flex items-center gap-2">
                                    <f.icon size={12} className={f.tint} />
                                    <span className="text-[11px] font-semibold text-[var(--text-primary)]">{f.short}</span>
                                  </span>
                                  <motion.span animate={{ rotate: openBenefit === i ? 90 : 0 }} transition={{ duration: 0.15 }}>
                                    <ChevronRight size={11} className="text-[var(--text-muted)]" />
                                  </motion.span>
                                </button>
                                <AnimatePresence initial={false}>
                                  {openBenefit === i && (
                                    <motion.p
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="overflow-hidden px-3 pb-2.5 pl-[30px] text-[11px] leading-relaxed text-[var(--text-muted)]"
                                    >
                                      {f.detail}
                                    </motion.p>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {/* Live speed race demo — experience TURBO before subscribing */}
                  <SpeedRace />

                  {/* Ko-fi membership CTA — shimmering gradient button */}
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed text-center">
                      {t('supporter.howTo', 'Subscribe to the monthly membership on Ko-fi, then redeem your activation code or request access below.')}
                    </p>
                    <a
                      href={KOFI_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-white text-xs font-extrabold tracking-wide overflow-hidden transition-transform active:scale-[0.98]"
                      style={{
                        background: 'linear-gradient(120deg, #ec4899, #f43f5e, #d946ef)',
                        boxShadow: '0 10px 30px -8px rgba(236,72,153,0.55)',
                      }}
                    >
                      <span
                        aria-hidden
                        className="absolute top-0 bottom-0 w-1/3 bg-white/25 blur-md"
                        style={{ animation: 'sup-shimmer 2.8s ease-in-out infinite' }}
                      />
                      <Coffee size={14} style={{ animation: 'sup-heartbeat 1.8s ease-in-out infinite' }} />
                      <span className="relative">{t('supporter.becomeSupporter', 'Become a Supporter on Ko-fi')}</span>
                    </a>
                  </div>

                  {/* Redeem code */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Ticket size={11} /> {t('supporter.redeemTitle', 'Have an activation code?')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
                        placeholder="SUP-XXXXX-XXXXX-XXXXX"
                        className="flex-1 px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-pink-500/50 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.12)] font-mono transition-all"
                      />
                      <button
                        onClick={handleRedeem}
                        disabled={redeeming || !code.trim()}
                        className="px-4 py-2 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 rounded-xl text-white text-xs font-bold transition-all flex items-center gap-1.5 shrink-0"
                      >
                        {redeeming ? <LoaderCircle size={11} className="animate-spin" /> : <Ticket size={11} />}
                        {t('supporter.redeem', 'Redeem')}
                      </button>
                    </div>
                    {redeemMsg && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`text-xs ${redeemMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {redeemMsg.text}
                      </motion.p>
                    )}
                  </div>

                  {/* Request access */}
                  <div className="space-y-2 pt-1 border-t border-[var(--border-color)]">
                    <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 pt-3">
                      <Send size={11} /> {t('supporter.requestTitle', 'Already subscribed? Request access')}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        value={kofiName}
                        onChange={(e) => setKofiName(e.target.value)}
                        placeholder={t('supporter.kofiName', 'Ko-fi name')}
                        className="px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-pink-500/50 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.12)] transition-all"
                      />
                      <input
                        value={kofiEmail}
                        onChange={(e) => setKofiEmail(e.target.value)}
                        placeholder={t('supporter.kofiEmail', 'Ko-fi / payment email')}
                        className="px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-pink-500/50 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.12)] transition-all"
                      />
                    </div>
                    <textarea
                      value={reqNote}
                      onChange={(e) => setReqNote(e.target.value)}
                      placeholder={t('supporter.requestNote', 'Note for the admin (optional)')}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-pink-500/50 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.12)] resize-none transition-all"
                    />
                    <button
                      onClick={handleRequest}
                      disabled={requesting}
                      className="flex items-center justify-center gap-1.5 w-full px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] disabled:opacity-50 rounded-xl text-[var(--text-secondary)] text-xs font-bold transition-all"
                    >
                      {requesting ? <LoaderCircle size={11} className="animate-spin" /> : <Send size={11} />}
                      {t('supporter.sendRequest', 'Send Request')}
                    </button>
                    {requestMsg && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`text-xs ${requestMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {requestMsg.text}
                      </motion.p>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
