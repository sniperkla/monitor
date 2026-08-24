'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { GalaxyBackground, MatrixRain } from './BackgroundEffects';
import { LegacyBanner } from './LegacyBanner';

const GLITCH_CSS = `
@keyframes boot-glitch {
  0%, 100% { transform: translate(0); filter: none; }
  5% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
  10% { transform: translate(2px, -1px); filter: hue-rotate(-90deg); }
  15% { transform: translate(0); filter: none; }
}
@keyframes boot-scanline {
  0% { top: -2px; }
  100% { top: 100%; }
}
`;

const BOOT_LINES = [
  { text: 'SSH Monitor v1.0.0 — Secure Shell Management System', delay: 300, type: 'header' },
  { text: 'Copyright (c) 2024 SSH Monitor. All rights reserved.', delay: 450, type: 'dim' },
  { text: '', delay: 500 },
  { text: 'POST: Memory test.......... 256MB OK', delay: 600, type: 'boot' },
  { text: 'POST: CPU check............ ARM64 OK', delay: 750, type: 'boot' },
  { text: 'POST: Storage verify....... NVMe OK', delay: 900, type: 'boot' },
  { text: '', delay: 950 },
  { text: '[BOOT] Loading kernel modules.................', delay: 1000, type: 'boot' },
  { text: '[ OK ] Kernel 6.1.0-sshm loaded', delay: 1150, type: 'ok' },
  { text: '[ OK ] AES-256-GCM encryption engine ready', delay: 1300, type: 'ok' },
  { text: '[BOOT] Mounting encrypted filesystem...........', delay: 1400, type: 'boot' },
  { text: '[ OK ] Vault subsystem initialized', delay: 1550, type: 'ok' },
  { text: '[ OK ] Zero-knowledge key derivation ready', delay: 1700, type: 'ok' },
  { text: '[BOOT] Initializing SSH protocol stack........', delay: 1800, type: 'boot' },
  { text: '[ OK ] Terminal multiplexer online (tmux 3.4)', delay: 1950, type: 'ok' },
  { text: '[ OK ] SFTP subsystem ready', delay: 2050, type: 'ok' },
  { text: '[BOOT] Configuring network interfaces.........', delay: 2150, type: 'boot' },
  { text: '[ OK ] eth0: 10.0.0.1/24  wg0: 10.0.1.1/24', delay: 2300, type: 'ok' },
  { text: '[ OK ] Firewall loaded (12 rules active)', delay: 2400, type: 'ok' },
  { text: '[BOOT] Starting container runtime.............', delay: 2500, type: 'boot' },
  { text: '[ OK ] Docker 24.0.7 — 3 containers running', delay: 2650, type: 'ok' },
  { text: '[ OK ] Health checks passing (3/3)', delay: 2750, type: 'ok' },
  { text: '[BOOT] Loading deployment engine..............', delay: 2850, type: 'boot' },
  { text: '[ OK ] CI/CD pipeline ready', delay: 3000, type: 'ok' },
  { text: '[ OK ] Webhook listener active on :9000', delay: 3100, type: 'ok' },
  { text: '', delay: 3150 },
  { text: '════════════════════════════════════════════════════════════════════', delay: 3200, type: 'divider' },
  { text: '  All subsystems operational — SSH Monitor ready', delay: 3350, type: 'ready' },
  { text: '════════════════════════════════════════════════════════════════════', delay: 3400, type: 'divider' },
];

function TypewriterLine({ text, delay, type, onDone }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started || doneRef.current) return;
    if (!text) {
      doneRef.current = true;
      setDone(true);
      setTimeout(() => onDoneRef.current(), 0);
      return;
    }
    let i = 0;
    const speed = type === 'header' ? 2 : type === 'divider' ? 4 : type === 'dim' ? 3 : 8;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        doneRef.current = true;
        setDone(true);
        onDoneRef.current();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [started, text, type]);

  if (!started) return null;
  if (!text) return <div className="h-3" />;

  const cleanText = text.replace(/^\[( ?OK |BOOT)\]\s*/, '');
  const isOk = type === 'ok';
  const isBoot = type === 'boot';
  const isReady = type === 'ready';
  const isDivider = type === 'divider';
  const isHeader = type === 'header';
  const isDim = type === 'dim';

  const lineStyle = {
    color: isReady ? '#4ade80' : isOk ? '#4ade80' : isHeader ? '#818cf8' : isDim ? '#475569' : isDivider ? '#4f46e5' : '#94a3b8',
    textShadow: isReady ? '0 0 10px rgba(74,222,128,0.5)' : isOk ? '0 0 6px rgba(74,222,128,0.3)' : isHeader ? '0 0 8px rgba(129,140,248,0.4)' : 'none',
  };

  return (
    <div className="font-mono text-[9px] md:text-[11px] leading-relaxed flex items-center min-h-[18px]">
      {isBoot && <span className="text-amber-400/80 mr-1.5 shrink-0">[BOOT]</span>}
      {isOk && <span className="text-emerald-400 mr-1.5 shrink-0">[ OK ]</span>}
      <span style={lineStyle}>{done ? (isBoot || isOk ? cleanText : text) : displayed}</span>
      {!done && <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.8, repeat: Infinity }} className="ml-0.5" style={{ color: '#4ade80' }}>▊</motion.span>}
      {done && isOk && <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 500 }} className="ml-2 text-emerald-400 shrink-0">✓</motion.span>}
    </div>
  );
}

export function BootScreen({ onComplete, onSkip }) {
  const [renderTick, setRenderTick] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [cursorBlink, setCursorBlink] = useState(true);
  const doneCountRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const handleLineDone = useCallback(() => {
    doneCountRef.current += 1;
    setRenderTick(t => t + 1);
    if (doneCountRef.current >= BOOT_LINES.length) {
      setTimeout(() => onCompleteRef.current(), 600);
    }
  }, []);

  useEffect(() => {
    const blink = setInterval(() => setCursorBlink(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

  const done = doneCountRef.current;
  const progress = Math.min((done / BOOT_LINES.length) * 100, 100);
  const blocks = 40;
  const filled = Math.round((progress / 100) * blocks);
  const bar = '█'.repeat(filled) + '░'.repeat(blocks - filled);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="relative w-full min-h-screen flex items-center justify-center p-4 md:p-8 overflow-hidden bg-black"
    >
      <style>{GLITCH_CSS}</style>
      <GalaxyBackground />
      <MatrixRain />

      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)' }} />

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 80, damping: 15 }}
        className="relative z-20 w-full max-w-4xl flex flex-col rounded-xl overflow-hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: 'rgba(4, 5, 15, 0.85)',
          border: hovered ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid rgba(99, 102, 241, 0.2)',
          boxShadow: hovered
            ? '0 0 80px rgba(74, 222, 128, 0.08), 0 25px 100px rgba(0,0,0,0.8), inset 0 0 30px rgba(74, 222, 128, 0.02)'
            : '0 0 80px rgba(99, 102, 241, 0.1), 0 25px 100px rgba(0,0,0,0.8)',
          maxHeight: '85vh',
          backdropFilter: 'blur(12px)',
          transition: 'border 0.4s, box-shadow 0.4s',
        }}
      >
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden rounded-xl">
          <div style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px)', position: 'absolute', inset: 0 }} />
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.12), transparent)',
              animation: 'boot-scanline 3s linear infinite',
              boxShadow: '0 0 15px rgba(99,102,241,0.08)',
            }}
          />
        </div>

        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0 relative z-[2]" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="flex gap-2 w-20">
            <div className="w-3 h-3 rounded-full bg-red-500/80" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.3)' }} />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" style={{ boxShadow: '0 0 6px rgba(234,179,8,0.3)' }} />
            <div className="w-3 h-3 rounded-full bg-green-500/80" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.3)' }} />
          </div>
          <div className="text-center flex-1 flex items-center justify-center gap-2">
            <span className="text-[11px] font-mono text-slate-500">ssh-monitor — boot sequence</span>
            <span
              className="inline-block w-[5px] h-[11px]"
              style={{
                background: cursorBlink ? 'rgba(74,222,128,0.6)' : 'transparent',
                boxShadow: cursorBlink ? '0 0 4px rgba(74,222,128,0.3)' : 'none',
              }}
            />
          </div>
          <div className="flex justify-end w-20">
            <button
              onClick={onSkip}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-indigo-500/35 hover:border-indigo-400 hover:bg-indigo-500/10 text-indigo-400/85 hover:text-indigo-300 transition-all cursor-pointer"
            >
              Skip ▸
            </button>
          </div>
        </div>

        {/* Boot content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-0.5 custom-scrollbar relative z-[2]" style={{ minHeight: '300px' }}>
          {/* Legacy terminal banner */}
          <LegacyBanner hovered={hovered} />

          {/* Boot lines */}
          {BOOT_LINES.map((line, i) => (
            <TypewriterLine key={i} text={line.text} delay={line.delay} type={line.type} onDone={handleLineDone} />
          ))}
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 shrink-0 relative z-[2]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="flex items-center gap-3 font-mono text-[10px] md:text-xs">
            <span style={{ color: '#6366f1', textShadow: '0 0 4px rgba(99,102,241,0.3)' }}>[{bar}]</span>
            <span style={{ color: '#4ade80', textShadow: '0 0 4px rgba(74,222,128,0.3)' }}>{Math.round(progress)}%</span>
            <span className="text-slate-500">{done}/{BOOT_LINES.length} modules</span>
            <span className="ml-auto text-slate-600 text-[8px]">PID 1</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
