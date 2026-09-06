'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  Mail, Lock, User as UserIcon, UserPlus, ShieldCheck, ShieldAlert,
  Terminal, KeyRound, CircleCheckBig, AlertCircle, Eye, EyeOff,
  Sparkles, ArrowRight, LoaderCircle, Cpu, Wifi, Battery,
  Search, ChevronLeft, ChevronRight, Activity, Zap,
} from 'lucide-react';
// Shared with the server so the form's minimum can never drift from the policy
// enforced by /api/auth/register and /api/auth/reset-password.
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';

/* ═══════════════════════════════════════════════════════
   CANVAS — vibrant particle network with color cycling
═══════════════════════════════════════════════════════ */
function ModalParticleCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    const resize = () => {
      canvas.width  = canvas.parentElement?.clientWidth  || 800;
      canvas.height = canvas.parentElement?.clientHeight || 600;
    };
    resize();
    window.addEventListener('resize', resize);

    // Minimal: ~20 very slow, very dim dots
    const particles = Array.from({ length: 22 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      size: Math.random() * 1.2 + 0.5,
      alpha: Math.random() * 0.18 + 0.06,
      pulse: Math.random() * Math.PI * 2,
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Faint connection lines only between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.strokeStyle = `rgba(99,102,241,${0.06 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Plain dim dots, no glow, no hue shift
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.pulse += 0.012;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        const a = p.alpha + Math.sin(p.pulse) * 0.05;
        ctx.fillStyle = `rgba(129,140,248,${Math.max(0.04, a)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      animId = requestAnimationFrame(render);
    };
    render();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(animId); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 opacity-60" />;
}

/* ═══════════════════════════════════════════════════════
   PASSWORD STRENGTH
═══════════════════════════════════════════════════════ */
function calculatePasswordStrength(pass) {
  if (!pass) return { score: 0, label: 'Empty', color: 'bg-slate-700', percent: 0, checks: { length: false, upper: false, number: false, special: false } };
  const checks = { length: pass.length >= 8, upper: /[A-Z]/.test(pass) && /[a-z]/.test(pass), number: /[0-9]/.test(pass), special: /[^A-Za-z0-9]/.test(pass) };
  let pts = 0;
  if (pass.length >= 6) pts++;
  if (checks.length) pts++;
  if (checks.upper) pts++;
  if (checks.number) pts++;
  if (checks.special) pts++;
  if (pts <= 1) return { score: 1, label: 'WEAK', color: 'bg-rose-500', percent: 25, checks };
  if (pts <= 3) return { score: 2, label: 'MODERATE', color: 'bg-amber-500', percent: 50, checks };
  if (pts === 4) return { score: 3, label: 'ENCRYPTED', color: 'bg-cyan-400', percent: 75, checks };
  return { score: 4, label: 'FORTIFIED', color: 'bg-emerald-400', percent: 100, checks };
}

/* ═══════════════════════════════════════════════════════
   3D TILT
═══════════════════════════════════════════════════════ */
function useModal3DTilt(cardRef) {
  const [tiltStyle, setTiltStyle] = useState({});
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      setTiltStyle({ transform: `perspective(1200px) rotateX(${((y - cy) / cy) * -5}deg) rotateY(${((x - cx) / cx) * 5}deg) scale3d(1.012,1.012,1.012)`, transition: 'transform 0.1s ease-out' });
    };
    const handleLeave = () => setTiltStyle({ transform: 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)', transition: 'transform 0.5s ease-out' });
    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
    return () => { card.removeEventListener('mousemove', handleMove); card.removeEventListener('mouseleave', handleLeave); };
  }, [cardRef]);
  return tiltStyle;
}

/* ── Holographic Border Hook ──
   Removed: the cursor-tracked rainbow conic gradient read as decoration
   rather than interface. The window border is now static slate. */

/* ═══════════════════════════════════════════════════════
   LIVE CLOCK
═══════════════════════════════════════════════════════ */
function useLiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

/* ═══════════════════════════════════════════════════════
   TYPEWRITER HOOK
═══════════════════════════════════════════════════════ */
function useTypewriter(text, speed = 28) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return displayed;
}

/* ═══════════════════════════════════════════════════════
   LIVE METRIC COUNTER
═══════════════════════════════════════════════════════ */
function LiveMetric({ label, value, unit, color = 'text-cyan-400' }) {
  const [displayed, setDisplayed] = useState(value);
  useEffect(() => {
    const jitter = setInterval(() => {
      setDisplayed(Math.round(value + (Math.random() - 0.5) * value * 0.1));
    }, 1200 + Math.random() * 800);
    return () => clearInterval(jitter);
  }, [value]);
  return (
    <div className="flex flex-col items-center">
      <span className={`text-[13px] font-black font-mono ${color} tabular-nums`}>{displayed}<span className="text-[9px] font-medium opacity-60 ml-0.5">{unit}</span></span>
      <span className="text-[8px] text-white/25 font-mono uppercase tracking-wider">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TRAFFIC LIGHT
═══════════════════════════════════════════════════════ */
function TrafficLight({ color, glowColor, symbol, onClick, label }) {
  const [hovered, setHovered] = useState(false);
  return (
    // Generous 20px hit area around the 12px dot — the visible light stays
    // identical, but the button is actually clickable on the first try.
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      className="relative w-5 h-5 flex items-center justify-center cursor-pointer"
    >
      <span
        className={`w-3 h-3 rounded-full flex items-center justify-center transition-all duration-200 ${color}`}
        style={{ boxShadow: hovered ? `0 0 8px 3px ${glowColor}` : `0 0 3px 1px ${glowColor}55` }}
      >
        {hovered && symbol && <span className="text-[7px] text-black font-black leading-none select-none">{symbol}</span>}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   SIDEBAR ITEM
═══════════════════════════════════════════════════════ */
function SidebarItem({ icon: Icon, label, active, ping, onClick }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ x: 2 }}
      className={`shrink-0 md:shrink flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-medium cursor-pointer transition-all text-left md:w-full whitespace-nowrap ${
        active ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/30' : 'text-white/35 hover:text-white/65 hover:bg-white/5 border border-transparent'
      }`}>
      <div className="relative shrink-0">
        <Icon size={13} className={active ? 'text-indigo-300' : ''} />
        {ping && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />}
      </div>
      <span>{label}</span>
      {active && <motion.div layoutId="sidebarActive" className="hidden md:block ml-auto w-1 h-4 rounded-full bg-indigo-400" />}
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════
   ANIMATED CONSOLE LOG ENTRY
═══════════════════════════════════════════════════════ */
function ConsoleEntry({ log, isLatest, index }) {
  const typed = useTypewriter(isLatest ? log : log, isLatest ? 22 : 0);
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-1 leading-relaxed"
    >
      <span className="text-cyan-500 text-[8px] select-none mt-px shrink-0">›</span>
      <span className={`text-[8px] break-all ${isLatest ? 'text-cyan-300 font-semibold' : 'text-slate-500'}`}>
        {isLatest ? typed : log}
        {isLatest && typed.length < log.length && <span className="inline-block w-1 h-2 bg-cyan-400 ml-0.5 animate-pulse" />}
      </span>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════
   BREATHING GLOW BORDER
═══════════════════════════════════════════════════════ */
/* ── Breathing border removed: a pulsing neon outline around a login form
   is the definition of AI slop. The static window border carries it. ── */

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════ */
export function CinematicAuthModal({
  isOpen, onClose,
  authMode, setAuthMode,
  email, setEmail,
  password, setPassword,
  confirmPassword, setConfirmPassword,
  newPassword, setNewPassword,
  name, setName,
  resetCode, setResetCode,
  verifyCodeInput, setVerifyCodeInput,
  authLoading,
  authError, setAuthError,
  authSuccess, setAuthSuccess,
  handleAuthSubmit,
}) {
  const cardRef = useRef(null);
  const dragControls = useDragControls();
  const tiltStyle = useModal3DTilt(cardRef);
  const now = useLiveClock();
  const [hovered, setHovered] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Escape closes the window — standard desktop behavior, unless the user
  // docked it to the pill.
  useEffect(() => {
    if (isMinimized) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMinimized, onClose]);

  // Focus the first field when the window opens or the mode changes, so
  // signing in is type → tab → type → Enter without touching the mouse.
  const formRef = useRef(null);
  useEffect(() => {
    if (isMinimized) return undefined;
    const t = setTimeout(() => {
      formRef.current?.querySelector('input:not([type=hidden])')?.focus();
    }, 380); // let the open spring settle
    return () => clearTimeout(t);
  }, [authMode, isMinimized]);

  // Caps Lock watch, shared by every passphrase field.
  const [capsLockOn, setCapsLockOn] = useState(false);
  const trackCapsLock = (e) => {
    if (e.getModifierState) setCapsLockOn(e.getModifierState('CapsLock'));
  };

  // Catch malformed emails before the network round-trip; the server still
  // re-validates everything.
  const onFormSubmit = (e) => {
    if (authMode !== 'verify' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim())) {
      e.preventDefault();
      setAuthError('Please enter a valid email address.');
      return;
    }
    handleAuthSubmit(e);
  };

  const handleToggleMaximize = () => setIsMaximized(v => !v);
  const [showPassword, setShowPassword] = useState(false);
  const [activeFocus, setActiveFocus] = useState(null);
  const [latency, setLatency] = useState(12);
  const [packets, setPackets] = useState(847);
  const [cpuLoad, setCpuLoad] = useState(23);

  // Drift the live metrics like a real machine would — smooth random walk
  // with clamps, packets monotonically increasing. Pure dice rolls read as
  // fake within seconds.
  useEffect(() => {
    const id = setInterval(() => {
      setLatency((v) => Math.round(Math.min(28, Math.max(8, v + (Math.random() - 0.5) * 4))));
      setPackets((p) => p + Math.round(2 + Math.random() * 9));
      setCpuLoad((v) => Math.round(Math.min(42, Math.max(12, v + (Math.random() - 0.5) * 6))));
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const pwdStrength = calculatePasswordStrength(password);

  const consoleLogs = useMemo(() => {
    const logs = [];
    logs.push(`[SYS_INIT] ESTABLISHED SECURE CHANNEL // TLS_v1.3`);
    if (authMode === 'register') {
      logs.push(`[IDENTITY] PROTOCOL: NEW AGENT REGISTRATION`);
      if (name) logs.push(`[ALIAS] "${name.toUpperCase()}"`);
      if (email) logs.push(`[COMM_LINK] ${email}`);
      if (password) {
        logs.push(`[PASSPHRASE_ENTROPY] RATING: ${pwdStrength.label} (${pwdStrength.percent}%)`);
        if (confirmPassword) logs.push(`[PASSPHRASE_VERIFY] ${confirmPassword === password ? 'MATCH VERIFIED ✓' : 'MISMATCH DETECTED ✕'}`);
      } else {
        logs.push(`[SECURITY] AWAITING MASTER PASSPHRASE`);
      }
    } else if (authMode === 'signin') {
      logs.push(`[AUTHENTICATION] STANDBY FOR AGENT CREDENTIALS`);
      if (email) logs.push(`[COMM_LINK] ${email}`);
    } else if (authMode === 'verify') {
      logs.push(`[VERIFICATION_GATEWAY] 6-DIGIT BIOMETRIC TOKEN REQ`);
      if (verifyCodeInput) logs.push(`[TOKEN_INPUT] ${verifyCodeInput.padEnd(6, '•')}`);
    } else if (authMode === 'forgot') {
      logs.push(`[RECOVERY_MODE] DISPATCHING ACCESS OVERRIDE`);
    }
    return logs;
  }, [authMode, name, email, password, confirmPassword, verifyCodeInput, pwdStrength.label, pwdStrength.percent]);

  const handlePinChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const currentCode = (verifyCodeInput || '').padEnd(6, ' ').split('');
    currentCode[index] = value.slice(-1) || ' ';
    const updated = currentCode.join('').trimEnd();
    setVerifyCodeInput(updated);
    if (value && index < 5) { const nextEl = document.getElementById(`pin-input-${index + 1}`); if (nextEl) nextEl.focus(); }
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !verifyCodeInput[index] && index > 0) { const prevEl = document.getElementById(`pin-input-${index - 1}`); if (prevEl) prevEl.focus(); }
  };

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <AnimatePresence>
      {isMinimized ? (
        <motion.div
          key="minimized-dock-pill"
          initial={{ y: 60, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 60, opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-950/90 border border-amber-500/40 text-xs font-mono text-amber-300 shadow-2xl backdrop-blur-xl cursor-pointer hover:border-amber-400 hover:scale-105 transition-all group"
          onClick={() => setIsMinimized(false)}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="font-semibold text-slate-200">Monitor Gateway (Minimized)</span>
          <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20 group-hover:bg-cyan-500/20 transition-colors">
            Click to Restore ↗
          </span>
        </motion.div>
      ) : (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto ${
            isMaximized ? 'p-2 sm:p-4' : 'p-4 sm:p-8'
          }`}
          style={{ background: 'rgba(0,0,0,0.1)' }}
        >
          <div
            ref={cardRef}
            style={{ perspective: '1200px', ...(isMaximized ? {} : tiltStyle) }}
            className={`my-auto w-full transition-all duration-300 ease-out ${
              isMaximized
                ? 'max-w-[98vw] h-[92vh]'
                // Mobile lets the card grow to fit content (sidebar + form stacked) and
                // lets the outer overflow-y-auto scroll; desktop keeps the fixed window size.
                : 'max-w-[920px] h-auto sm:h-[620px] max-h-[92vh] sm:max-h-[85vh]'
            }`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <motion.div
              key={isMaximized ? 'win-max' : 'win-normal'}
              drag={!isMaximized}
              dragControls={dragControls}
              dragListener={false}
              dragMomentum={false}
              dragElastic={0.05}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}
              className="relative w-full h-full overflow-hidden text-slate-100 flex flex-col z-10"
              style={{
                background: 'rgba(10,13,20,0.94)',
                backdropFilter: 'blur(28px) saturate(1.3)',
                WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
                borderRadius: isMaximized ? '18px' : '14px',
                border: hovered ? '1px solid rgba(148,163,184,0.35)' : '1px solid rgba(71,85,105,0.5)',
                boxShadow: '0 32px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05)',
                transition: 'border 0.3s, border-radius 0.3s',
              }}
            >
          {/* Particle canvas */}
          <ModalParticleCanvas />

          {/* ── macOS Menu Bar ── */}
          <div
            className="flex items-center justify-between px-4 h-7 shrink-0 border-b border-white/5 z-10 relative cursor-grab active:cursor-grabbing select-none"
            onPointerDown={(e) => { if (!isMaximized) dragControls.start(e); }}
            style={{ background: 'rgba(13,17,26,0.96)', backdropFilter: 'blur(10px)' }}
          >
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <span className="text-white/80 text-sm shrink-0">&#63743;</span>
              {['Monitor', 'File', 'View', 'Security', 'Help'].map((m) => (
                <span
                  key={m}
                  className="relative text-[11px] cursor-default font-medium transition-colors duration-150 hidden md:inline text-white/55 hover:text-white/90"
                >{m}</span>
              ))}
            </div>
            <div className="flex items-center gap-2 md:gap-2.5 text-white/45 shrink-0">
              {/* Mobile: clock only. Desktop: full status strip. */}
              <span className="md:hidden text-[11px] font-mono font-medium text-white/80 tabular-nums">
                {timeStr}
              </span>
              <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} className="hidden md:block">
                <Wifi size={11} />
              </motion.div>
              <Battery size={11} className="hidden md:block" />
              <span className="hidden md:inline text-[11px] font-medium text-white/50">{dateStr}</span>
              <span className="hidden md:inline text-[11px] font-mono font-medium text-white/80 tabular-nums">
                {timeStr}
              </span>
            </div>
          </div>

          {/* ── macOS Title Bar ── */}
          <div
            className="flex items-center px-4 h-11 shrink-0 select-none border-b border-white/5 relative z-10 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => { if (!isMaximized) dragControls.start(e); }}
            style={{ background: 'linear-gradient(180deg, rgba(34,40,80,0.98) 0%, rgba(22,28,60,0.98) 100%)' }}
          >
            {/* Traffic lights */}
            <div className="flex items-center gap-2 z-10">
              <TrafficLight color="bg-[#FF5F56]" glowColor="#FF5F56" symbol="×" onClick={onClose} label="Close" />
              <TrafficLight color="bg-[#FEBC2E]" glowColor="#FEBC2E" symbol="−" onClick={() => setIsMinimized(true)} label="Minimize" />
              <TrafficLight color="bg-[#28C840]" glowColor="#28C840" symbol={isMaximized ? '−' : '+'} onClick={handleToggleMaximize} label={isMaximized ? 'Restore' : 'Maximize'} />
            </div>
            {/* Nav arrows — desktop only; too cramped on mobile */}
            <div className="hidden md:flex items-center gap-0.5 ml-4 z-10">
              <button type="button" className="p-1 rounded hover:bg-white/10 text-white/20 hover:text-white/50 transition-colors cursor-pointer"><ChevronLeft size={12} /></button>
              <button type="button" className="p-1 rounded hover:bg-white/10 text-white/20 hover:text-white/50 transition-colors cursor-pointer"><ChevronRight size={12} /></button>
            </div>
            {/* Centered title */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.span
                  key={authMode}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.25 }}
                  className="text-[11px] font-semibold text-white/70 tracking-wide px-12 truncate max-w-full"
                >
                  {authMode === 'register' && '✦ New Agent — Initialization'}
                  {authMode === 'signin'   && '⬡ Monitor — Authentication Gateway'}
                  {authMode === 'forgot'   && '↺ Monitor — Access Recovery'}
                  {authMode === 'verify'   && '⬡ Monitor — Biometric Verification'}
                </motion.span>
              </AnimatePresence>
            </div>
            {/* Search pill — desktop only; collides with the centered title on mobile */}
            <div className="hidden md:flex ml-auto items-center gap-1.5 bg-white/6 border border-white/10 hover:border-indigo-500/40 rounded-md px-2.5 py-1 z-10 cursor-text transition-colors duration-150">
              <Search size={10} className="text-white/30" />
              <span className="text-[10px] text-white/22">Search</span>
            </div>
          </div>

          {/* ── Window body ── */}
          <div className="flex flex-col md:flex-row flex-1 z-10 relative overflow-hidden" style={{ minHeight: 0 }}>

            {/* ── SIDEBAR ──
                Mobile (<md): horizontal compact nav strip — 4 mode chips in a row, no
                decorative telemetry / console / footer (those consume ~400px of vertical
                space and push the form below the fold).
                Desktop (md+): full sidebar with live metrics, console log, footer. */}
            <div className="w-full md:w-[192px] shrink-0 flex flex-row md:flex-col border-b md:border-b-0 md:border-r border-white/5 py-2 md:py-3 px-2 gap-1 md:gap-0.5 overflow-x-auto md:overflow-visible"
              style={{ background: 'rgba(12,15,38,0.72)' }}>
              <p className="hidden md:block text-[9px] font-bold tracking-widest text-white/18 uppercase px-3 pt-1 pb-2">Security</p>
              <SidebarItem icon={ShieldCheck} label="Authentication" active={authMode === 'signin'}   onClick={() => { setAuthMode('signin');    setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={UserIcon}    label="New Agent"       active={authMode === 'register'} onClick={() => { setAuthMode('register'); setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={KeyRound}    label="Access Recovery" active={authMode === 'forgot'}   onClick={() => { setAuthMode('forgot');   setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={ShieldAlert} label="Verification"    active={authMode === 'verify'}   ping={authMode === 'verify'} />

              <p className="hidden md:block text-[9px] font-bold tracking-widest text-white/18 uppercase px-3 pt-4 pb-2">Live Telemetry</p>

              {/* Live metrics bar — desktop only */}
              <div className="hidden md:block mx-1 rounded-xl border border-white/6 overflow-hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                  <div className="flex items-center gap-1.5">
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                      <Activity size={10} className="text-emerald-400" />
                    </motion.div>
                    <span className="text-[9px] text-white/35 font-mono">NETWORK</span>
                  </div>
                  <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                    className="text-[8px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">LIVE</motion.span>
                </div>
                <div className="flex items-center justify-around px-2 py-3 gap-1">
                  <LiveMetric label="LATENCY" value={latency} unit="ms" color="text-cyan-400" />
                  <div className="w-px h-8 bg-white/8" />
                  <LiveMetric label="PKTS" value={packets} unit="" color="text-indigo-400" />
                  <div className="w-px h-8 bg-white/8" />
                  <LiveMetric label="CPU" value={cpuLoad} unit="%" color="text-emerald-400" />
                </div>
              </div>

              {/* Console log — desktop only */}
              <div className="hidden md:block mx-1 mt-2 rounded-xl bg-black/30 border border-white/5 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1 text-[9px] text-slate-500">
                    <Terminal size={9} className="text-cyan-400" /><span>SYS_LOG</span>
                  </div>
                  <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                    className="text-[8px] text-emerald-400 bg-emerald-500/10 px-1 rounded font-mono">LIVE</motion.span>
                </div>
                <AnimatePresence>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {consoleLogs.map((log, i) => (
                      <ConsoleEntry key={`${log}-${i}`} log={log} isLatest={i === consoleLogs.length - 1} index={i} />
                    ))}
                  </div>
                </AnimatePresence>
              </div>

              {/* Sidebar footer — desktop only */}
              <div className="hidden md:block mt-auto pt-3 px-2 border-t border-white/5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ opacity: [1, 0.3, 1], scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[9px] text-white/22 font-mono">GATEWAY v4.2</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-cyan-400/45 font-mono tabular-nums">LATENCY: {latency}ms</span>
                  <span className="text-[9px] text-white/18 font-mono">TLS 1.3</span>
                </div>
              </div>
            </div>

            {/* ── MAIN CONTENT ── */}
            <div className="flex-1 flex flex-col min-w-0">

              {/* Toolbar strip */}
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/5 shrink-0 overflow-x-auto"
                style={{ background: 'rgba(20,24,60,0.55)' }}>
                {authMode !== 'verify' && (
                  <div className="flex items-center gap-0.5 bg-white/5 border border-white/8 rounded-md p-0.5 shrink-0">
                    {['signin', 'register'].map((mode) => (
                      <button key={mode} type="button"
                        onClick={() => { setAuthMode(mode); setAuthError(null); setAuthSuccess(null); }}
                        className={`relative px-3 py-1 rounded text-[10px] font-semibold transition-all cursor-pointer whitespace-nowrap ${authMode === mode ? 'text-white' : 'text-white/30 hover:text-white/60'}`}>
                        {authMode === mode && (
                          <motion.div layoutId="macTabPill"
                            className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded shadow-md -z-10" />
                        )}
                        {mode === 'signin' ? 'Sign In' : 'Create Account'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/15 text-[9px] font-mono tracking-widest text-cyan-400 shrink-0 whitespace-nowrap">
                  <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1.1, repeat: Infinity }}
                    className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
                  <span>SECURE // 256-BIT</span>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6">

                <AnimatePresence mode="wait">
                  <motion.div
                    key={authMode}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                  >
                    {/* Header */}
                    <div className="mb-5">
                      <h2 className="text-lg font-extrabold text-white tracking-tight flex items-center gap-2">
                        {authMode === 'register' && <><span>Initialize Agent Account</span><UserPlus size={16} className="text-cyan-400 shrink-0 ml-1" /></>}
                        {authMode === 'signin'   && 'Welcome Back, Agent'}
                        {authMode === 'forgot'   && 'Reset Access Key'}
                        {authMode === 'verify'   && 'Biometric Verification'}
                      </h2>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {authMode === 'register' && 'Create your credentials to sync connections and vault keys.'}
                        {authMode === 'signin'   && 'Sign in to access your dashboard, terminal, and encrypted vault.'}
                        {authMode === 'forgot'   && 'Request a 6-digit verification code to reset your password.'}
                        {authMode === 'verify'   && 'Enter the 6-digit code transmitted to your email inbox.'}
                      </p>
                    </div>

                    {/* Alerts — macOS notification style */}
                    <AnimatePresence>
                      {authError && (
                        <motion.div
                          key="error"
                          initial={{ opacity: 0, y: -8, scaleY: 0.85 }}
                          animate={{ opacity: 1, y: 0, scaleY: 1 }}
                          exit={{ opacity: 0, y: -6, scaleY: 0.9 }}
                          transition={{ duration: 0.2 }}
                          className="mb-4 flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg font-mono text-[10px] tracking-wide"
                          style={{
                            background: 'rgba(239,68,68,0.07)',
                            borderLeft: '3px solid rgba(239,68,68,0.7)',
                            border: '1px solid rgba(239,68,68,0.15)',
                            borderLeft: '3px solid rgba(239,68,68,0.6)',
                          }}
                        >
                          <span className="text-rose-500 font-bold shrink-0 mt-px">✕</span>
                          <div>
                            <div className="text-rose-400/60 text-[8px] uppercase tracking-widest mb-0.5">SYS_ERR // AUTH_FAILURE</div>
                            <div className="text-rose-300 leading-snug">{authError}</div>
                          </div>
                        </motion.div>
                      )}
                      {authSuccess && (
                        <motion.div
                          key="success"
                          initial={{ opacity: 0, y: -8, scaleY: 0.85 }}
                          animate={{ opacity: 1, y: 0, scaleY: 1 }}
                          exit={{ opacity: 0, y: -6, scaleY: 0.9 }}
                          transition={{ duration: 0.2 }}
                          className="mb-4 flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg font-mono text-[10px] tracking-wide"
                          style={{
                            background: 'rgba(52,211,153,0.07)',
                            border: '1px solid rgba(52,211,153,0.15)',
                            borderLeft: '3px solid rgba(52,211,153,0.6)',
                          }}
                        >
                          <span className="text-emerald-400 font-bold shrink-0 mt-px">✓</span>
                          <div>
                            <div className="text-emerald-400/60 text-[8px] uppercase tracking-widest mb-0.5">SYS_OK // OPERATION_SUCCESS</div>
                            <div className="text-emerald-300 leading-snug">{authSuccess}</div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <form ref={formRef} onSubmit={onFormSubmit} className="space-y-4">

                      {/* Settings pane card */}
                      <div className="rounded-xl border border-white/8 overflow-hidden divide-y divide-white/5"
                        style={{ background: 'rgba(255,255,255,0.025)' }}>

                        {/* Display Name */}
                        {authMode === 'register' && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                            <label className="sm:w-32 shrink-0 text-[11px] font-medium text-slate-300 font-mono uppercase tracking-wider">Display Name</label>
                            <div className="relative flex-1">
                              <UserIcon size={13} className={`absolute left-3 top-3 transition-colors ${activeFocus === 'name' ? 'text-cyan-400' : 'text-slate-500'}`} />
                              <input type="text" placeholder="Agent Codename" value={name}
                                onFocus={() => setActiveFocus('name')} onBlur={() => setActiveFocus(null)} onChange={(e) => setName(e.target.value)}
                                className="w-full py-2 pl-9 pr-3 text-xs bg-slate-900/60 border border-slate-700/60 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-500/20 rounded-lg text-slate-100 placeholder-slate-500 transition-all outline-none" />
                            </div>
                          </motion.div>
                        )}

                        {/* Email */}
                        {authMode !== 'verify' && (
                          <div className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                            <label className="sm:w-32 shrink-0 text-[11px] font-medium text-slate-300 font-mono uppercase tracking-wider">Email Address</label>
                            <div className="relative flex-1">
                              <Mail size={13} className={`absolute left-3 top-3 transition-colors ${activeFocus === 'email' ? 'text-cyan-400' : 'text-slate-500'}`} />
                              <input type="email" required placeholder="agent@monitor.io" value={email}
                                onFocus={() => setActiveFocus('email')} onBlur={() => setActiveFocus(null)} onChange={(e) => setEmail(e.target.value)}
                                className="w-full py-2 pl-9 pr-3 text-xs bg-slate-900/60 border border-slate-700/60 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-500/20 rounded-lg text-slate-100 placeholder-slate-500 transition-all outline-none" />
                            </div>
                          </div>
                        )}

                        {/* Password */}
                        {(authMode === 'signin' || authMode === 'register') && (
                          <div className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                            <div className="sm:w-32 shrink-0 flex items-center justify-between">
                              <label className="text-[11px] font-medium text-slate-300 font-mono uppercase tracking-wider">Passphrase</label>
                              {capsLockOn && (
                                <span className="hidden sm:inline text-[8px] font-mono tracking-widest text-amber-400/90" title="Caps Lock is on">
                                  ⇪ CAPS
                                </span>
                              )}
                              {authMode === 'signin' && (
                                <button type="button" onClick={() => { setAuthMode('forgot'); setAuthError(null); setAuthSuccess(null); }}
                                  className="sm:hidden text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors font-mono cursor-pointer">Forgot?</button>
                              )}
                            </div>
                            <div className="relative flex-1">
                              <Lock size={13} className={`absolute left-3 top-3 transition-colors ${activeFocus === 'password' ? 'text-cyan-400' : 'text-slate-500'}`} />
                              <input type={showPassword ? 'text' : 'password'} required minLength={MIN_PASSWORD_LENGTH} placeholder="••••••••••••" value={password}
                                onFocus={() => setActiveFocus('password')} onBlur={() => setActiveFocus(null)} onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={trackCapsLock} onKeyUp={trackCapsLock}
                                className="w-full py-2 pl-9 pr-9 text-xs bg-slate-900/60 border border-slate-700/60 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-500/20 rounded-lg text-slate-100 placeholder-slate-500 transition-all outline-none" />
                              <button type="button" onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
                                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>
                            {authMode === 'signin' && (
                              <button type="button" onClick={() => { setAuthMode('forgot'); setAuthError(null); setAuthSuccess(null); }}
                                className="hidden sm:inline-block text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors font-mono cursor-pointer shrink-0">Forgot?</button>
                            )}
                          </div>
                        )}

                        {/* Confirm Password */}
                        {authMode === 'register' && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                            <label className="sm:w-32 shrink-0 text-[11px] font-medium text-slate-300 font-mono uppercase tracking-wider">Confirm Pass</label>
                            <div className="relative flex-1">
                              <Lock size={13} className={`absolute left-3 top-3 transition-colors ${activeFocus === 'confirmPassword' ? 'text-cyan-400' : 'text-slate-500'}`} />
                              <input type={showPassword ? 'text' : 'password'} required minLength={MIN_PASSWORD_LENGTH} placeholder="Re-enter passphrase" value={confirmPassword}
                                onFocus={() => setActiveFocus('confirmPassword')} onBlur={() => setActiveFocus(null)} onChange={(e) => setConfirmPassword(e.target.value)}
                                onKeyDown={trackCapsLock} onKeyUp={trackCapsLock}
                                className={`w-full py-2 pl-9 pr-3 text-xs bg-slate-900/60 border rounded-lg text-slate-100 placeholder-slate-500 transition-all outline-none ${
                                  confirmPassword ? (confirmPassword === password ? 'border-emerald-500/70 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20' : 'border-rose-500/70 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20') : 'border-slate-700/60 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-500/20'
                                }`} />
                            </div>
                            <AnimatePresence>
                              {confirmPassword && (
                                <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0 }}
                                  className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded shrink-0 ${
                                    confirmPassword === password ? 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/30' : 'text-rose-300 bg-rose-500/15 border border-rose-500/30'
                                  }`}>
                                  {confirmPassword === password ? '✓ MATCH' : '✕ NO MATCH'}
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        )}

                        {/* 6-Digit PIN */}
                        {authMode === 'verify' && (
                          // On mobile the form pane leaves ~216px for the row.
                          // 6 × w-10 (40) + 5 × gap-2 (8) = 280px, so the 5th and
                          // 6th digits are clipped by the pane's overflow-hidden.
                          // Shrink both dimensions on mobile; desktop keeps the
                          // original spacing.
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-0 sm:px-4 py-5 flex flex-col items-center gap-4">
                            <label className="text-[11px] font-mono uppercase tracking-widest text-white/40">Security Code (6 Digits)</label>
                            <div className="flex justify-center gap-1 sm:gap-2">
                              {[0,1,2,3,4,5].map((idx) => {
                                const val = (verifyCodeInput || '')[idx] || '';
                                return (
                                  <motion.input key={idx} id={`pin-input-${idx}`} type="text" inputMode="numeric" maxLength={1} value={val}
                                    onChange={(e) => handlePinChange(idx, e.target.value)} onKeyDown={(e) => handlePinKeyDown(idx, e)}
                                    whileFocus={{ scale: 1.08, boxShadow: '0 0 16px rgba(56,189,248,0.5)' }}
                                    className="w-9 sm:w-10 h-12 text-center text-lg font-bold font-mono bg-white/5 border border-white/10 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 rounded-lg text-cyan-300 transition-all outline-none" />
                                );
                              })}
                            </div>
                          </motion.div>
                        )}

                        {/* Forgot fields */}
                        {authMode === 'forgot' && (
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                              <label className="sm:w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Reset Code</label>
                              <input type="text" maxLength={6} placeholder="6-digit code from email" value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                className="flex-1 py-2 px-3 text-xs font-mono tracking-widest bg-white/5 border border-white/10 focus:border-cyan-400/60 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                            </div>
                            {resetCode && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1.5 sm:gap-3">
                                <label className="sm:w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">New Passphrase</label>
                                <input type="password" required minLength={MIN_PASSWORD_LENGTH} placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`} value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
                                  onKeyDown={trackCapsLock} onKeyUp={trackCapsLock}
                                  className="flex-1 py-2 px-3 text-xs bg-white/5 border border-white/10 focus:border-cyan-400/60 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                              </motion.div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Password strength */}
                      <AnimatePresence>
                        {authMode === 'register' && password && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                            className="rounded-xl border border-white/8 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <div className="flex items-center justify-between text-[10px] font-mono mb-2.5">
                              <span className="text-white/30 flex items-center gap-1.5"><Cpu size={11} className="text-indigo-400" /> PASSPHRASE SHIELD</span>
                              <motion.span animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.5, repeat: Infinity }}
                                className={`font-bold px-2 py-0.5 rounded text-[9px] ${pwdStrength.score >= 3 ? 'text-emerald-300 bg-emerald-500/15' : 'text-white/35 bg-white/5'}`}>
                                {pwdStrength.label}
                              </motion.span>
                            </div>
                            <div className="grid grid-cols-4 gap-1 mb-3">
                              {[1,2,3,4].map((step) => (
                                <div key={step} className="h-1 rounded-full bg-white/8 overflow-hidden">
                                  <motion.div initial={{ width: 0 }} animate={{ width: step <= pwdStrength.score ? '100%' : '0%' }}
                                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                                    className={`h-full ${pwdStrength.color}`} />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                              {[[pwdStrength.checks.length,'8+ Characters'],[pwdStrength.checks.upper,'Uppercase & Lower'],[pwdStrength.checks.number,'Number (0-9)'],[pwdStrength.checks.special,'Special Symbol']].map(([ok, label]) => (
                                <div key={label}
                                  className={`flex items-center gap-1 transition-colors duration-300 ${ok ? 'text-emerald-400 font-medium' : 'text-white/20'}`}>
                                  <motion.div animate={ok ? { scale: [1, 1.3, 1] } : {}} transition={{ duration: 0.4 }}>
                                    <CircleCheckBig size={9} />
                                  </motion.div>
                                  {label}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Submit button */}
                      <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} type="submit" disabled={authLoading}
                        className="w-full relative py-3 px-6 rounded-xl font-bold text-xs text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                        <div className="flex items-center justify-center gap-2">
                          {authLoading
                            ? <LoaderCircle size={14} className="animate-spin" />
                            : <ArrowRight size={14} />
                          }
                          <span className="tracking-wider uppercase font-mono text-[10px]">
                            {authLoading ? 'Transmitting...' : (
                              authMode === 'register' ? 'Register & Verify Email' :
                              authMode === 'verify'   ? 'Confirm Verification Code' :
                              authMode === 'forgot'   ? (resetCode ? 'Reset Passphrase' : 'Send Reset Code') :
                              'Sign In to Dashboard'
                            )}
                          </span>
                        </div>
                      </motion.button>

                      {authMode === 'forgot' && (
                        <button type="button" onClick={() => { setAuthMode('signin'); setAuthError(null); setAuthSuccess(null); }}
                          className="w-full text-center text-[10px] font-mono text-white/22 hover:text-white/55 transition-colors cursor-pointer">
                          ← Back to Sign In Gateway
                        </button>
                      )}
                    </form>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* macOS Status Bar */}
              <div className="flex items-center justify-between px-5 py-1.5 border-t border-white/5 shrink-0"
                style={{ background: 'rgba(10,13,35,0.72)' }}>
                <div className="flex items-center gap-2">
                  <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }}
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[9px] font-mono text-white/20">
                    {authMode === 'register' && name ? `Agent: ${name}` : 'No agent selected'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[9px] font-mono text-white/18">
                  <span>TLS 1.3</span>
                  <span>AES-256-GCM</span>
                  <motion.span animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="text-emerald-400 font-medium">
                    ● Connected
                  </motion.span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )}
</AnimatePresence>
  );
}
