'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  Mail, Lock, User as UserIcon, UserPlus, ShieldCheck, ShieldAlert,
  Terminal, KeyRound, CheckCircle2, AlertCircle, Eye, EyeOff,
  Sparkles, ArrowRight, Loader2, Cpu, Wifi, Battery,
  Search, ChevronLeft, ChevronRight, Activity, Zap,
} from 'lucide-react';

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
  if (!pass) return { score: 0, label: 'Empty', color: 'bg-slate-700', glow: '', percent: 0, checks: { length: false, upper: false, number: false, special: false } };
  const checks = { length: pass.length >= 8, upper: /[A-Z]/.test(pass) && /[a-z]/.test(pass), number: /[0-9]/.test(pass), special: /[^A-Za-z0-9]/.test(pass) };
  let pts = 0;
  if (pass.length >= 6) pts++;
  if (checks.length) pts++;
  if (checks.upper) pts++;
  if (checks.number) pts++;
  if (checks.special) pts++;
  if (pts <= 1) return { score: 1, label: 'WEAK', color: 'bg-rose-500', glow: 'shadow-rose-500/50', percent: 25, checks };
  if (pts <= 3) return { score: 2, label: 'MODERATE', color: 'bg-amber-500', glow: 'shadow-amber-500/50', percent: 50, checks };
  if (pts === 4) return { score: 3, label: 'ENCRYPTED', color: 'bg-cyan-400', glow: 'shadow-cyan-400/50', percent: 75, checks };
  return { score: 4, label: 'FORTIFIED', color: 'bg-emerald-400', glow: 'shadow-emerald-400/50', percent: 100, checks };
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

/* ── Holographic Border Hook ── */
function useHolographicBorder(cardRef) {
  const [holoStyle, setHoloStyle] = useState({});
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      setHoloStyle({
        background: `conic-gradient(from ${px * 3.6}deg at ${px}% ${py}%, #ff006a22, #ff6b0022, #ffd70022, #00ff8822, #00d4ff22, #6366f122, #ff006a22)`,
        opacity: 1,
      });
    };
    const handleLeave = () => setHoloStyle({ opacity: 0 });
    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
    return () => { card.removeEventListener('mousemove', handleMove); card.removeEventListener('mouseleave', handleLeave); };
  }, [cardRef]);

  return holoStyle;
}

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
function TrafficLight({ color, glowColor, symbol, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className={`w-3 h-3 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${color}`}
      style={{ boxShadow: hovered ? `0 0 8px 3px ${glowColor}` : `0 0 3px 1px ${glowColor}55` }}>
      {hovered && symbol && <span className="text-[6px] text-black font-black leading-none select-none">{symbol}</span>}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   SIDEBAR ITEM
═══════════════════════════════════════════════════════ */
function SidebarItem({ icon: Icon, label, active, ping, onClick }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ x: 2 }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-medium cursor-pointer transition-all text-left ${
        active ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/30' : 'text-white/35 hover:text-white/65 hover:bg-white/5'
      }`}>
      <div className="relative shrink-0">
        <Icon size={13} className={active ? 'text-indigo-300' : ''} />
        {ping && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />}
      </div>
      <span>{label}</span>
      {active && <motion.div layoutId="sidebarActive" className="ml-auto w-1 h-4 rounded-full bg-indigo-400" />}
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
function BreathingGlowBorder() {
  return (
    <motion.div
      className="absolute inset-0 rounded-[14px] pointer-events-none z-20"
      style={{
        boxShadow: '0 0 0 1px rgba(56,189,248,0.3), 0 0 40px rgba(56,189,248,0.12)',
      }}
      animate={{ opacity: [0.4, 0.95, 0.4] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

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
  const holoStyle = useHolographicBorder(cardRef);
  const now = useLiveClock();
  const [hovered, setHovered] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const handleToggleMaximize = () => setIsMaximized(v => !v);
  const [showPassword, setShowPassword] = useState(false);
  const [activeFocus, setActiveFocus] = useState(null);
  const [latency, setLatency] = useState(12);
  const [packets, setPackets] = useState(847);
  const [cpuLoad, setCpuLoad] = useState(23);

  // Jitter live metrics
  useEffect(() => {
    const id = setInterval(() => {
      setLatency(Math.round(10 + Math.random() * 8));
      setPackets(p => p + Math.round(Math.random() * 15));
      setCpuLoad(Math.round(18 + Math.random() * 20));
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
              isMaximized ? 'max-w-[98vw] h-[92vh]' : 'max-w-[920px] h-[580px] sm:h-[620px] max-h-[85vh]'
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
                background: 'rgba(14,17,44,0.85)',
                backdropFilter: 'blur(32px) saturate(1.5)',
                WebkitBackdropFilter: 'blur(32px) saturate(1.5)',
                borderRadius: isMaximized ? '18px' : '14px',
                border: hovered ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(99,102,241,0.25)',
                boxShadow: hovered
                  ? '0 0 50px rgba(74,222,128,0.1), 0 0 100px rgba(99,102,241,0.08), 0 32px 80px rgba(0,0,0,0.75), inset 0 0 30px rgba(74,222,128,0.03), inset 0 1px 0 rgba(255,255,255,0.06)'
                  : '0 32px 80px rgba(0,0,0,0.75), 0 0 80px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.07)',
                transition: 'border 0.4s, box-shadow 0.4s, border-radius 0.3s',
              }}
            >
          {/* Particle canvas */}
          <ModalParticleCanvas />

          {/* Breathing border */}
          <BreathingGlowBorder />

          {/* Holographic Border Overlay (conic gradient tracking cursor) */}
          <div
            className="absolute inset-0 rounded-[14px] pointer-events-none z-[2]"
            style={{ ...holoStyle, mixBlendMode: 'screen', transition: 'opacity 0.3s' }}
          />



          {/* Ambient glows (shift green on hover) */}
          <div
            className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-[130px] pointer-events-none z-0"
            style={{
              background: hovered ? 'rgba(74,222,128,0.12)' : 'rgba(99,102,241,0.18)',
              transition: 'background 0.6s',
            }}
          />
          <motion.div animate={{ opacity: [0.1, 0.22, 0.1] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-500 rounded-full blur-[130px] pointer-events-none z-0" />

          {/* ── macOS Menu Bar ── */}
          <div
            className="flex items-center justify-between px-4 h-7 shrink-0 border-b border-white/5 z-10 relative cursor-grab active:cursor-grabbing select-none"
            onPointerDown={(e) => { if (!isMaximized) dragControls.start(e); }}
            style={{ background: 'rgba(18,22,58,0.96)', backdropFilter: 'blur(10px)' }}
          >
            <div className="flex items-center gap-4">
              <span className="text-white/80 text-sm">&#63743;</span>
              {['Monitor', 'File', 'View', 'Security', 'Help'].map((m) => (
                <span
                  key={m}
                  className="relative text-[11px] cursor-default font-medium transition-all duration-150 group"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #6366f1, #06b6d4)';
                    e.currentTarget.style.webkitBackgroundClip = 'text';
                    e.currentTarget.style.webkitTextFillColor = 'transparent';
                    e.currentTarget.style.backgroundClip = 'text';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'none';
                    e.currentTarget.style.webkitBackgroundClip = 'unset';
                    e.currentTarget.style.webkitTextFillColor = 'unset';
                    e.currentTarget.style.backgroundClip = 'unset';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                  }}
                >{m}</span>
              ))}
            </div>
            <div className="flex items-center gap-2.5 text-white/45">
              {/* Wifi with animated bars */}
              <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}>
                <Wifi size={11} />
              </motion.div>
              {/* Battery */}
              <Battery size={11} />
              <span className="text-[11px] font-medium text-white/50">{dateStr}</span>
              {/* Live clock */}
              <span className="text-[11px] font-mono font-medium text-white/80 tabular-nums">
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
              <TrafficLight color="bg-[#FF5F56]" glowColor="#FF5F56" symbol="×" onClick={onClose} />
              <TrafficLight color="bg-[#FEBC2E]" glowColor="#FEBC2E" symbol="−" onClick={() => setIsMinimized(true)} />
              <TrafficLight color="bg-[#28C840]" glowColor="#28C840" symbol={isMaximized ? '−' : '+'} onClick={handleToggleMaximize} />
            </div>
            {/* Nav arrows */}
            <div className="flex items-center gap-0.5 ml-4 z-10">
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
                  className="text-[11px] font-semibold text-white/70 tracking-wide"
                >
                  {authMode === 'register' && '✦ New Agent — Initialization'}
                  {authMode === 'signin'   && '⬡ Monitor — Authentication Gateway'}
                  {authMode === 'forgot'   && '↺ Monitor — Access Recovery'}
                  {authMode === 'verify'   && '⬡ Monitor — Biometric Verification'}
                </motion.span>
              </AnimatePresence>
            </div>
            {/* Search pill */}
            <div className="ml-auto flex items-center gap-1.5 bg-white/6 border border-white/10 hover:border-indigo-500/40 rounded-md px-2.5 py-1 z-10 cursor-text transition-colors duration-150">
              <Search size={10} className="text-white/30" />
              <span className="text-[10px] text-white/22">Search</span>
            </div>
          </div>

          {/* ── Window body ── */}
          <div className="flex flex-col md:flex-row flex-1 z-10 relative overflow-hidden" style={{ minHeight: 0 }}>

            {/* ── SIDEBAR ── */}
            <div className="w-full md:w-[192px] shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-white/5 py-3 px-2 gap-0.5"
              style={{ background: 'rgba(12,15,38,0.72)' }}>
              <p className="text-[9px] font-bold tracking-widest text-white/18 uppercase px-3 pt-1 pb-2">Security</p>
              <SidebarItem icon={ShieldCheck} label="Authentication" active={authMode === 'signin'}   onClick={() => { setAuthMode('signin');    setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={UserIcon}    label="New Agent"       active={authMode === 'register'} onClick={() => { setAuthMode('register'); setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={KeyRound}    label="Access Recovery" active={authMode === 'forgot'}   onClick={() => { setAuthMode('forgot');   setAuthError(null); setAuthSuccess(null); }} />
              <SidebarItem icon={ShieldAlert} label="Verification"    active={authMode === 'verify'}   ping={authMode === 'verify'} />

              <p className="text-[9px] font-bold tracking-widest text-white/18 uppercase px-3 pt-4 pb-2">Live Telemetry</p>

              {/* Live metrics bar */}
              <div className="mx-1 rounded-xl border border-white/6 overflow-hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
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

              {/* Console log */}
              <div className="mx-1 mt-2 rounded-xl bg-black/30 border border-white/5 p-2.5">
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

              {/* Sidebar footer */}
              <div className="mt-auto pt-3 px-2 border-t border-white/5 space-y-1">
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
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/5 shrink-0"
                style={{ background: 'rgba(20,24,60,0.55)' }}>
                {authMode !== 'verify' && (
                  <div className="flex items-center gap-0.5 bg-white/5 border border-white/8 rounded-md p-0.5">
                    {['signin', 'register'].map((mode) => (
                      <button key={mode} type="button"
                        onClick={() => { setAuthMode(mode); setAuthError(null); setAuthSuccess(null); }}
                        className={`relative px-3 py-1 rounded text-[10px] font-semibold transition-all cursor-pointer ${authMode === mode ? 'text-white' : 'text-white/30 hover:text-white/60'}`}>
                        {authMode === mode && (
                          <motion.div layoutId="macTabPill"
                            className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded shadow-md -z-10" />
                        )}
                        {mode === 'signin' ? 'Sign In' : 'Create Account'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/15 text-[9px] font-mono tracking-widest text-cyan-400">
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

                    <form onSubmit={handleAuthSubmit} className="space-y-4">

                      {/* Settings pane card */}
                      <div className="rounded-xl border border-white/8 overflow-hidden divide-y divide-white/5"
                        style={{ background: 'rgba(255,255,255,0.025)' }}>

                        {/* Display Name */}
                        {authMode === 'register' && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center px-4 py-3 gap-3">
                            <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Display Name</label>
                            <div className="relative flex-1">
                              <UserIcon size={13} className={`absolute left-2.5 top-2.5 transition-colors ${activeFocus === 'name' ? 'text-cyan-400' : 'text-white/18'}`} />
                              <input type="text" placeholder="Agent Codename" value={name}
                                onFocus={() => setActiveFocus('name')} onBlur={() => setActiveFocus(null)} onChange={(e) => setName(e.target.value)}
                                className="w-full py-2 pl-8 pr-3 text-xs bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-500/25 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                            </div>
                          </motion.div>
                        )}

                        {/* Email */}
                        {authMode !== 'verify' && (
                          <div className="flex items-center px-4 py-3 gap-3">
                            <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Email</label>
                            <div className="relative flex-1">
                              <Mail size={13} className={`absolute left-2.5 top-2.5 transition-colors ${activeFocus === 'email' ? 'text-cyan-400' : 'text-white/18'}`} />
                              <input type="email" required placeholder="agent@monitor.io" value={email}
                                onFocus={() => setActiveFocus('email')} onBlur={() => setActiveFocus(null)} onChange={(e) => setEmail(e.target.value)}
                                className="w-full py-2 pl-8 pr-3 text-xs bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-500/25 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                            </div>
                          </div>
                        )}

                        {/* Password */}
                        {(authMode === 'signin' || authMode === 'register') && (
                          <div className="flex items-center px-4 py-3 gap-3">
                            <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Passphrase</label>
                            <div className="relative flex-1">
                              <Lock size={13} className={`absolute left-2.5 top-2.5 transition-colors ${activeFocus === 'password' ? 'text-cyan-400' : 'text-white/18'}`} />
                              <input type={showPassword ? 'text' : 'password'} required minLength={6} placeholder="••••••••••••" value={password}
                                onFocus={() => setActiveFocus('password')} onBlur={() => setActiveFocus(null)} onChange={(e) => setPassword(e.target.value)}
                                className="w-full py-2 pl-8 pr-9 text-xs bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-500/25 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                              <button type="button" onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2.5 top-2.5 text-white/22 hover:text-white/60 transition-colors cursor-pointer">
                                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>
                            {authMode === 'signin' && (
                              <button type="button" onClick={() => { setAuthMode('forgot'); setAuthError(null); setAuthSuccess(null); }}
                                className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors font-mono cursor-pointer shrink-0">Forgot?</button>
                            )}
                          </div>
                        )}

                        {/* Confirm Password */}
                        {authMode === 'register' && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center px-4 py-3 gap-3">
                            <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Confirm Pass</label>
                            <div className="relative flex-1">
                              <Lock size={13} className={`absolute left-2.5 top-2.5 transition-colors ${activeFocus === 'confirmPassword' ? 'text-cyan-400' : 'text-white/18'}`} />
                              <input type={showPassword ? 'text' : 'password'} required minLength={6} placeholder="Re-enter passphrase" value={confirmPassword}
                                onFocus={() => setActiveFocus('confirmPassword')} onBlur={() => setActiveFocus(null)} onChange={(e) => setConfirmPassword(e.target.value)}
                                className={`w-full py-2 pl-8 pr-3 text-xs bg-white/5 border rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none ${
                                  confirmPassword ? (confirmPassword === password ? 'border-emerald-500/50 focus:border-emerald-400' : 'border-rose-500/50 focus:border-rose-400') : 'border-white/10 focus:border-cyan-400/60'
                                }`} />
                            </div>
                            <AnimatePresence>
                              {confirmPassword && (
                                <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0 }}
                                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                    confirmPassword === password ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
                                  }`}>
                                  {confirmPassword === password ? '✓ OK' : '✕ NO'}
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        )}

                        {/* 6-Digit PIN */}
                        {authMode === 'verify' && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 py-5 flex flex-col items-center gap-4">
                            <label className="text-[11px] font-mono uppercase tracking-widest text-white/40">Security Code (6 Digits)</label>
                            <div className="flex justify-center gap-2">
                              {[0,1,2,3,4,5].map((idx) => {
                                const val = (verifyCodeInput || '')[idx] || '';
                                return (
                                  <motion.input key={idx} id={`pin-input-${idx}`} type="text" inputMode="numeric" maxLength={1} value={val}
                                    onChange={(e) => handlePinChange(idx, e.target.value)} onKeyDown={(e) => handlePinKeyDown(idx, e)}
                                    whileFocus={{ scale: 1.08, boxShadow: '0 0 16px rgba(56,189,248,0.5)' }}
                                    className="w-10 h-12 text-center text-lg font-bold font-mono bg-white/5 border border-white/10 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 rounded-lg text-cyan-300 transition-all outline-none" />
                                );
                              })}
                            </div>
                          </motion.div>
                        )}

                        {/* Forgot fields */}
                        {authMode === 'forgot' && (
                          <>
                            <div className="flex items-center px-4 py-3 gap-3">
                              <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">Reset Code</label>
                              <input type="text" maxLength={6} placeholder="6-digit code from email" value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                className="flex-1 py-2 px-3 text-xs font-mono tracking-widest bg-white/5 border border-white/10 focus:border-cyan-400/60 rounded-lg text-slate-100 placeholder-white/18 transition-all outline-none" />
                            </div>
                            {resetCode && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center px-4 py-3 gap-3">
                                <label className="w-36 shrink-0 text-[11px] font-medium text-white/40 font-mono uppercase tracking-wide">New Passphrase</label>
                                <input type="password" required minLength={6} placeholder="Min 6 characters" value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
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
                                    className={`h-full ${pwdStrength.color}`}
                                    style={{ boxShadow: step <= pwdStrength.score ? `0 0 6px var(--tw-shadow-color)` : 'none' }} />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                              {[[pwdStrength.checks.length,'8+ Characters'],[pwdStrength.checks.upper,'Uppercase & Lower'],[pwdStrength.checks.number,'Number (0-9)'],[pwdStrength.checks.special,'Special Symbol']].map(([ok, label]) => (
                                <div key={label}
                                  className={`flex items-center gap-1 transition-colors duration-300 ${ok ? 'text-emerald-400 font-medium' : 'text-white/20'}`}>
                                  <motion.div animate={ok ? { scale: [1, 1.3, 1] } : {}} transition={{ duration: 0.4 }}>
                                    <CheckCircle2 size={9} />
                                  </motion.div>
                                  {label}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Submit button */}
                      <motion.button whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.975 }} type="submit" disabled={authLoading}
                        className="w-full relative group overflow-hidden py-3 px-6 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-indigo-600 via-cyan-600 to-emerald-500 hover:opacity-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ boxShadow: '0 0 30px rgba(79,70,229,0.35), 0 4px 16px rgba(0,0,0,0.4)' }}>
                        {/* Shimmer */}
                        <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out pointer-events-none skew-x-12" />
                        {/* Animated bottom glow pulse */}
                        <motion.div animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 2, repeat: Infinity }}
                          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />
                        <div className="flex items-center justify-center gap-2">
                          {authLoading
                            ? <Loader2 size={14} className="animate-spin" />
                            : <motion.span animate={{ x: [0, 3, 0] }} transition={{ duration: 1.5, repeat: Infinity }}>
                                <ArrowRight size={14} />
                              </motion.span>
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
