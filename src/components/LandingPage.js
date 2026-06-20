'use client';

import { signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Terminal, Shield, ChevronRight, Server, Database, Lock, Wifi } from 'lucide-react';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const ASCII_LOGO = `
 ███████╗███████╗██╗  ██╗    ███╗   ███╗ ██████╗ ███╗   ██╗██╗████████╗ ██████╗ ██████╗
 ██╔════╝██╔════╝██║  ██║    ████╗ ████║██╔═══██╗████╗  ██║██║╚══██╔══╝██╔═══██╗██╔══██╗
 ███████╗███████╗███████║    ██╔████╔██║██║   ██║██╔██╗ ██║██║   ██║   ██║   ██║██████╔╝
 ╚════██║╚════██║██╔══██║    ██║╚██╔╝██║██║   ██║██║╚██╗██║██║   ██║   ██║   ██║██╔══██╗
 ███████║███████║██║  ██║    ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██║   ██║   ╚██████╔╝██║  ██║
 ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝`.trim();

const BOOT_LINES = [
  { text: 'SSH Monitor v1.0.0 — Secure Shell Management System', delay: 800, type: 'header' },
  { text: '', delay: 1000 },
  { text: 'POST: Memory test.......... 128MB OK', delay: 1200, type: 'boot' },
  { text: 'POST: CPU check............ ARM64 OK', delay: 1500, type: 'boot' },
  { text: '', delay: 1600 },
  { text: '[BOOT] Loading kernel modules.................', delay: 1700, type: 'boot' },
  { text: '[ OK ] Kernel 6.1.0-sshm loaded', delay: 2100, type: 'ok' },
  { text: '[BOOT] Mounting encrypted filesystem...........', delay: 2300, type: 'boot' },
  { text: '[ OK ] AES-256-GCM vault subsystem ready', delay: 2700, type: 'ok' },
  { text: '[BOOT] Initializing SSH protocol stack........', delay: 2900, type: 'boot' },
  { text: '[ OK ] Terminal multiplexer online (tmux 3.4)', delay: 3300, type: 'ok' },
  { text: '[BOOT] Configuring network interfaces.........', delay: 3500, type: 'boot' },
  { text: '[ OK ] eth0: 10.0.0.1/24  wg0: 10.0.1.1/24', delay: 3900, type: 'ok' },
  { text: '[BOOT] Starting container runtime.............', delay: 4100, type: 'boot' },
  { text: '[ OK ] Docker 24.0.7 — 3 containers running', delay: 4500, type: 'ok' },
  { text: '[BOOT] Loading deployment engine..............', delay: 4700, type: 'boot' },
  { text: '[ OK ] CI/CD pipeline ready', delay: 5000, type: 'ok' },
  { text: '', delay: 5200 },
  { text: '════════════════════════════════════════════════════════════════', delay: 5300, type: 'divider' },
  { text: '  All subsystems operational — SSH Monitor ready', delay: 5500, type: 'ready' },
  { text: '════════════════════════════════════════════════════════════════', delay: 5600, type: 'divider' },
];

/* ── Matrix Rain ── */
function MatrixRain() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width = window.innerWidth * dpr;
    let h = canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const cw = window.innerWidth;
    const ch = window.innerHeight;

    const chars = '01アイウエオカキクケコサシスセソタチツテトABCDEF0123456789'.split('');
    const fontSize = 14;
    const columns = Math.floor(cw / fontSize);
    const drops = Array.from({ length: columns }, () => Math.random() * ch / fontSize);

    let animId;
    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, cw, ch);

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.random();
        if (brightness > 0.85) {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
        } else if (brightness > 0.6) {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        } else {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
        }
        ctx.font = `${fontSize}px monospace`;
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > ch && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    const handleResize = () => {
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    window.addEventListener('resize', handleResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', handleResize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0.3 }} />;
}

/* ── CRT Scanlines ── */
function CRTOverlay() {
  return (
    <>
      <div className="absolute inset-0 pointer-events-none z-30" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
      }} />
      <motion.div
        className="absolute inset-0 pointer-events-none z-30"
        style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)' }}
        animate={{ opacity: [0.4, 0.5, 0.4] }}
        transition={{ duration: 4, repeat: Infinity }}
      />
    </>
  );
}

/* ── Screen Flicker ── */
function ScreenFlicker() {
  return (
    <motion.div
      className="absolute inset-0 pointer-events-none z-20"
      style={{ background: 'white' }}
      animate={{ opacity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0] }}
      transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
    />
  );
}

/* ── Typewriter Character ── */
function TypewriterLine({ text, delay, type, onDone }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const firedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started || firedRef.current) return;
    if (!text) {
      firedRef.current = true;
      setDone(true);
      setTimeout(() => onDoneRef.current(), 0);
      return;
    }
    let i = 0;
    const speed = type === 'header' ? 3 : type === 'divider' ? 5 : 18;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        firedRef.current = true;
        setDone(true);
        onDoneRef.current();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [started, text, type]);

  if (!started) return null;
  if (!text) return <div className="h-4" />;

  const cleanText = text.replace(/^\[( ?OK |BOOT)\]\s*/, '');
  const isOk = type === 'ok';
  const isBoot = type === 'boot';
  const isReady = type === 'ready';
  const isDivider = type === 'divider';
  const isHeader = type === 'header';

  const lineStyle = {
    color: isReady ? '#4ade80' : isOk ? '#4ade80' : isHeader ? '#818cf8' : isDivider ? '#4f46e5' : '#94a3b8',
    textShadow: isReady
      ? '0 0 10px rgba(74, 222, 128, 0.5), 0 0 20px rgba(74, 222, 128, 0.2)'
      : isOk
      ? '0 0 6px rgba(74, 222, 128, 0.3)'
      : isHeader
      ? '0 0 8px rgba(129, 140, 248, 0.4)'
      : 'none',
  };

  return (
    <div className="font-mono text-xs leading-relaxed flex items-center min-h-[20px]">
      {isBoot && <span className="text-amber-400/80 mr-1 shrink-0" style={{ textShadow: '0 0 4px rgba(251, 191, 36, 0.3)' }}>[BOOT]</span>}
      {isOk && <span className="text-emerald-400 mr-1 shrink-0" style={{ textShadow: '0 0 4px rgba(74, 222, 128, 0.3)' }}>[ OK ]</span>}
      <span style={lineStyle}>
        {done ? (isBoot || isOk ? cleanText : text) : displayed}
      </span>
      {!done && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          className="ml-0.5"
          style={{ color: '#4ade80', textShadow: '0 0 6px rgba(74, 222, 128, 0.5)' }}
        >▊</motion.span>
      )}
      {done && isOk && (
        <motion.span
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          className="ml-2 text-emerald-400 shrink-0"
          style={{ textShadow: '0 0 6px rgba(74, 222, 128, 0.4)' }}
        >✓</motion.span>
      )}
    </div>
  );
}

/* ── Boot Screen ── */
function BootScreen({ onComplete }) {
  const [renderTick, setRenderTick] = useState(0);
  const doneCountRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const handleLineDone = useCallback(() => {
    doneCountRef.current += 1;
    setRenderTick(t => t + 1);
    if (doneCountRef.current >= BOOT_LINES.length) {
      setTimeout(() => onCompleteRef.current(), 800);
    }
  }, []);

  const done = doneCountRef.current;
  const progress = Math.min((done / BOOT_LINES.length) * 100, 100);
  const blocks = 30;
  const filled = Math.round((progress / 100) * blocks);
  const bar = '█'.repeat(filled) + '░'.repeat(blocks - filled);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="relative w-full h-full flex items-center justify-center p-4 md:p-8 overflow-hidden"
    >
      <MatrixRain />
      <CRTOverlay />
      <ScreenFlicker />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none z-10" style={{
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
      }} />

      {/* Terminal Window */}
      <div className="relative z-20 w-full max-w-4xl flex flex-col rounded-xl overflow-hidden"
        style={{
          background: 'rgba(2, 2, 8, 0.95)',
          border: '1px solid rgba(99, 102, 241, 0.15)',
          boxShadow: '0 0 80px rgba(99, 102, 241, 0.1), 0 25px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
          maxHeight: '85vh',
        }}
      >
        {/* Title Bar */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)' }}
        >
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.3)' }} />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" style={{ boxShadow: '0 0 6px rgba(234,179,8,0.3)' }} />
            <div className="w-3 h-3 rounded-full bg-green-500/80" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.3)' }} />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[11px] font-mono" style={{ color: '#64748b' }}>ssh-monitor — boot sequence</span>
          </div>
          <div className="flex items-center gap-2">
            <Wifi size={11} style={{ color: '#4ade80' }} />
            <Lock size={11} style={{ color: '#818cf8' }} />
          </div>
        </div>

        {/* Terminal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-0.5 custom-scrollbar" style={{ minHeight: '300px' }}>
          {/* ASCII Logo */}
          <pre
            className="text-[7px] md:text-[9px] leading-tight font-mono mb-3 select-none"
            style={{
              color: '#6366f1',
              textShadow: '0 0 10px rgba(99, 102, 241, 0.4), 0 0 30px rgba(99, 102, 241, 0.1)',
            }}
          >
            {ASCII_LOGO}
          </pre>

          {/* Boot lines */}
          {BOOT_LINES.map((line, i) => (
            <TypewriterLine
              key={i}
              text={line.text}
              delay={line.delay}
              type={line.type}
              onDone={handleLineDone}
            />
          ))}
        </div>

        {/* Status Bar */}
        <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span style={{ color: '#6366f1', textShadow: '0 0 4px rgba(99, 102, 241, 0.3)' }}>
              [{bar}]
            </span>
            <span style={{ color: '#4ade80', textShadow: '0 0 4px rgba(74, 222, 128, 0.3)' }}>
              {Math.round(progress)}%
            </span>
            <span style={{ color: '#64748b' }}>
              {done}/{BOOT_LINES.length} modules
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Shatter Dissolve Transition ── */
function ShatterDissolve({ onComplete }) {
  const cols = 12;
  const rows = 8;
  const total = cols * rows;

  const shards = useMemo(() =>
    Array.from({ length: total }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col + 0.5) / cols * 100;
      const cy = (row + 0.5) / rows * 100;
      const angle = Math.atan2(cy - 50, cx - 50);
      const dist = 200 + Math.random() * 400;
      return {
        id: i,
        x: (col / cols) * 100,
        y: (row / rows) * 100,
        w: 100 / cols + 0.5,
        h: 100 / rows + 0.5,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        rot: (Math.random() - 0.5) * 720,
        delay: Math.random() * 0.15,
        duration: 0.6 + Math.random() * 0.4,
      };
    }), []);

  useEffect(() => {
    const t = setTimeout(onComplete, 1400);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-[10001] overflow-hidden"
      style={{ background: '#000' }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {shards.map((s) => (
        <motion.div
          key={s.id}
          className="absolute"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            background: '#020208',
          }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: s.tx, y: s.ty, rotate: s.rot, opacity: 0 }}
          transition={{ duration: s.duration, delay: s.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
      <motion.div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)' }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 2] }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
    </motion.div>
  );
}

/* ── Particle Burst ── */
function ParticleBurst() {
  const particles = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => {
      const angle = (i / 60) * Math.PI * 2;
      const speed = 100 + Math.random() * 300;
      return {
        id: i,
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
        size: Math.random() * 3 + 1,
        duration: 0.8 + Math.random() * 0.6,
        delay: Math.random() * 0.2,
      };
    }), []);

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: Math.random() > 0.5 ? '#6366f1' : '#4ade80',
            boxShadow: `0 0 6px ${Math.random() > 0.5 ? '#6366f1' : '#4ade80'}`,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/* ── Shockwave Ripple ── */
function Shockwave() {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-0">
      {[0, 0.15, 0.3].map((delay, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border"
          style={{ borderColor: 'rgba(99, 102, 241, 0.3)' }}
          initial={{ width: 0, height: 0, opacity: 0.6 }}
          animate={{ width: 600, height: 600, opacity: 0 }}
          transition={{ duration: 1.2, delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/* ── Ambient Particles ── */
function AmbientParticles() {
  const particles = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      duration: Math.random() * 12 + 8,
      delay: Math.random() * 5,
    })), []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: '#6366f1' }}
          animate={{ opacity: [0, 0.4, 0], scale: [0, 1, 0], y: [0, -120, -240] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/* ── Floating Orbs ── */
function FloatingOrbs() {
  const orbs = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: i,
      size: 80 + Math.random() * 120,
      x: 10 + Math.random() * 80,
      y: 10 + Math.random() * 80,
      color: ['#6366f1', '#7c3aed', '#4ade80', '#f59e0b', '#06b6d4', '#f43f5e'][i],
      duration: 15 + Math.random() * 10,
      delay: Math.random() * 3,
    })), []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {orbs.map((o) => (
        <motion.div
          key={o.id}
          className="absolute rounded-full"
          style={{
            width: o.size,
            height: o.size,
            left: `${o.x}%`,
            top: `${o.y}%`,
            background: o.color,
            filter: 'blur(80px)',
          }}
          animate={{
            x: [0, 30, -20, 0],
            y: [0, -20, 30, 0],
            opacity: [0.03, 0.08, 0.03],
          }}
          transition={{ duration: o.duration, delay: o.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/* ── Glowing Ring ── */
function GlowRing() {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        width: 300,
        height: 300,
        left: '50%',
        top: '50%',
        marginLeft: -150,
        marginTop: -200,
        borderRadius: '50%',
        border: '1px solid rgba(99, 102, 241, 0.1)',
      }}
      animate={{ rotate: 360, scale: [1, 1.1, 1] }}
      transition={{ rotate: { duration: 20, repeat: Infinity, ease: 'linear' }, scale: { duration: 8, repeat: Infinity } }}
    >
      {[0, 90, 180, 270].map((deg) => (
        <motion.div
          key={deg}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{
            background: '#6366f1',
            boxShadow: '0 0 8px #6366f1',
            top: '50%',
            left: '50%',
            transform: `rotate(${deg}deg) translateY(-150px) translate(-50%, -50%)`,
          }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2, delay: deg / 360, repeat: Infinity }}
        />
      ))}
    </motion.div>
  );
}

/* ── Floating Code Snippets ── */
function FloatingCode() {
  const snippets = useMemo(() => [
    'ssh connect root@server',
    'SELECT * FROM users',
    'docker compose up -d',
    'mongod --replSet rs0',
    'git push origin main',
    'curl -X POST /api/deploy',
    'npm run build',
    'pg_dump dbname > backup',
    'rsync -avz ./dist user@host:',
    'openssl req -new -x509',
  ], []);

  const items = useMemo(() =>
    snippets.map((text, i) => ({
      id: i,
      text,
      x: Math.random() * 90,
      y: Math.random() * 90,
      duration: 20 + Math.random() * 15,
      delay: Math.random() * 8,
      rotate: (Math.random() - 0.5) * 10,
    })), [snippets]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {items.map((item) => (
        <motion.div
          key={item.id}
          className="absolute font-mono text-[9px] whitespace-nowrap select-none"
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            color: '#6366f1',
            opacity: 0,
            transform: `rotate(${item.rotate}deg)`,
          }}
          animate={{
            opacity: [0, 0.06, 0.06, 0],
            x: [0, -30, -60],
          }}
          transition={{
            duration: item.duration,
            delay: item.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        >
          {item.text}
        </motion.div>
      ))}
    </div>
  );
}

/* ── Mouse Follower ── */
function MouseFollower() {
  const ref = useRef(null);

  useEffect(() => {
    const handleMove = (e) => {
      if (ref.current) {
        ref.current.style.left = `${e.clientX}px`;
        ref.current.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  return (
    <div
      ref={ref}
      className="fixed pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
      style={{
        width: 300,
        height: 300,
        background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
        transition: 'left 0.15s ease-out, top 0.15s ease-out',
      }}
    />
  );
}

/* ── Glitch Title ── */
function GlitchTitle({ children }) {
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.92) {
        setGlitch(true);
        setTimeout(() => setGlitch(false), 150);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!glitch) return <>{children}</>;

  return (
    <div className="relative">
      <div className="absolute inset-0" style={{ clipPath: 'inset(20% 0 60% 0)', transform: 'translateX(-2px)' }}>
        <span style={{ color: '#f43f5e' }}>{children}</span>
      </div>
      <div className="absolute inset-0" style={{ clipPath: 'inset(60% 0 10% 0)', transform: 'translateX(2px)' }}>
        <span style={{ color: '#06b6d4' }}>{children}</span>
      </div>
      <span>{children}</span>
    </div>
  );
}

/* ── Typing Subtitle ── */
function TypingSubtitle() {
  const text = 'Terminal & Server Management Platform';
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const startDelay = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, 40);
      return () => clearInterval(interval);
    }, 1000);
    return () => clearTimeout(startDelay);
  }, []);

  return (
    <span className="font-mono">
      {displayed}
      {!done && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.7, repeat: Infinity }}
          style={{ color: '#6366f1' }}
        >▊</motion.span>
      )}
    </span>
  );
}

/* ── Reveal Screen ── */
function RevealScreen({ onDismiss }) {
  const features = [
    { icon: Terminal, label: 'SSH Terminal', desc: 'Multi-session management', color: '#4ade80' },
    { icon: Database, label: 'Database', desc: 'Browse & query data', color: '#818cf8' },
    { icon: Shield, label: 'Encrypted Vault', desc: 'Zero-knowledge security', color: '#fbbf24' },
    { icon: Server, label: 'Auto Deploy', desc: 'CI/CD pipeline', color: '#a78bfa' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="relative z-10 flex flex-col items-center max-w-lg mx-auto px-6"
    >
      <AmbientParticles />
      <FloatingOrbs />
      <FloatingCode />
      <GlowRing />
      <MouseFollower />

      {/* Logo with shockwave */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 12, delay: 0.3 }}
        className="relative mb-8"
      >
        <Shockwave />
        <motion.div
          className="absolute inset-0 rounded-3xl"
          style={{ background: '#6366f1', filter: 'blur(60px)' }}
          animate={{ opacity: [0.2, 0.4, 0.2], scale: [0.8, 1.4, 0.8] }}
          transition={{ duration: 6, repeat: Infinity }}
        />
        <motion.div
          className="relative w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
            boxShadow: '0 0 80px rgba(99, 102, 241, 0.4), 0 30px 100px rgba(0,0,0,0.5)',
          }}
          animate={{
            boxShadow: [
              '0 0 80px rgba(99, 102, 241, 0.4), 0 30px 100px rgba(0,0,0,0.5)',
              '0 0 120px rgba(99, 102, 241, 0.6), 0 30px 100px rgba(0,0,0,0.5)',
              '0 0 80px rgba(99, 102, 241, 0.4), 0 30px 100px rgba(0,0,0,0.5)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Monitor size={44} className="text-white" />
        </motion.div>
      </motion.div>

      {/* Title with glitch + letter stagger */}
      <motion.div className="mb-2 overflow-hidden">
        <GlitchTitle>
          <motion.h1
            className="text-5xl font-bold tracking-tight"
            style={{ color: '#f1f5f9' }}
          >
            {'SSH Monitor'.split('').map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.04, type: 'spring', stiffness: 200, damping: 15 }}
                className="inline-block"
                style={char === ' ' ? { width: '0.3em' } : {}}
              >
                {char === ' ' ? '\u00A0' : char}
              </motion.span>
            ))}
          </motion.h1>
        </GlitchTitle>
      </motion.div>

      <motion.p
        initial={{ opacity: 0, letterSpacing: '0.3em' }}
        animate={{ opacity: 0.8, letterSpacing: '0.15em' }}
        transition={{ delay: 1, duration: 0.8 }}
        className="text-sm mb-10 text-center font-mono"
        style={{ color: '#94a3b8' }}
      >
        <TypingSubtitle />
      </motion.p>

      {/* Features with animated border */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.5 }}
        className="grid grid-cols-2 gap-3 w-full mb-10"
      >
        {features.map((f, i) => (
          <motion.div
            key={f.label}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 1.2 + i * 0.12, type: 'spring', stiffness: 220, damping: 20 }}
            whileHover={{ scale: 1.05, y: -4 }}
            className="relative flex items-center gap-3 p-3.5 rounded-xl cursor-default overflow-hidden group"
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <motion.div
              className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${f.color}08, ${f.color}15)` }}
            />
            <motion.div
              className="absolute inset-0 rounded-xl"
              style={{ border: `1px solid ${f.color}00` }}
              whileHover={{ borderColor: `${f.color}30` }}
              transition={{ duration: 0.3 }}
            />
            <div className="relative w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${f.color}12`, border: `1px solid ${f.color}20` }}
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 3, delay: i * 0.5, repeat: Infinity }}
              >
                <f.icon size={18} style={{ color: f.color }} />
              </motion.div>
            </div>
            <div className="relative min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: '#f1f5f9' }}>{f.label}</p>
              <p className="text-[10px] truncate" style={{ color: '#94a3b8' }}>{f.desc}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Buttons with animated glow */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.6, duration: 0.5 }}
        className="w-full space-y-3"
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => signIn('google')}
          className="relative w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl text-sm font-semibold cursor-pointer overflow-hidden group"
          style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', backdropFilter: 'blur(8px)' }}
        >
          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(124,58,237,0.1))' }}
          />
          <motion.div
            className="absolute inset-0 rounded-xl"
            style={{ boxShadow: '0 0 0px rgba(99,102,241,0)' }}
            whileHover={{ boxShadow: '0 0 30px rgba(99,102,241,0.2), inset 0 0 30px rgba(99,102,241,0.05)' }}
            transition={{ duration: 0.3 }}
          />
          <svg className="relative" width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          <span className="relative">Sign in with Google</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={onDismiss}
          className="relative w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-medium cursor-pointer overflow-hidden group"
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8' }}
        >
          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          />
          <ChevronRight size={14} className="relative" />
          <span className="relative">Continue without login</span>
        </motion.button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        transition={{ delay: 2, duration: 0.5 }}
        className="mt-6 text-[10px] text-center max-w-xs leading-relaxed"
        style={{ color: '#94a3b8' }}
      >
        Login to sync settings, connections, and vault across devices. Local-only mode available without login.
      </motion.p>
    </motion.div>
  );
}

/* ── Main Landing Page ── */
export default function LandingPage({ onDismiss }) {
  const [phase, setPhase] = useState('boot');
  const [showPowerOff, setShowPowerOff] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

  const handleBootComplete = useCallback(() => {
    setShowPowerOff(true);
  }, []);

  const handleShatterComplete = useCallback(() => {
    setShowPowerOff(false);
    setPhase('reveal');
    setShowReveal(true);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden" style={{ background: '#000' }}>
      {/* Boot phase */}
      <AnimatePresence>
        {phase === 'boot' && !showPowerOff && (
          <motion.div
            key="boot"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute inset-0"
            style={{ background: '#000' }}
          >
            <BootScreen onComplete={handleBootComplete} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shatter Dissolve */}
      <AnimatePresence>
        {showPowerOff && (
          <ShatterDissolve key="shatter" onComplete={handleShatterComplete} />
        )}
      </AnimatePresence>

      {/* Reveal phase */}
      <AnimatePresence>
        {showReveal && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0"
            style={{ background: '#000' }}
          >
            {/* Background nebula */}
            <div className="absolute inset-0 overflow-hidden">
              <motion.div
                className="absolute w-[700px] h-[700px] rounded-full blur-[200px]"
                style={{ background: '#6366f1', top: '10%', left: '-10%' }}
                animate={{ x: [0, 50, 0], y: [0, 30, 0], opacity: [0.08, 0.15, 0.08] }}
                transition={{ duration: 10, repeat: Infinity }}
              />
              <motion.div
                className="absolute w-[600px] h-[600px] rounded-full blur-[180px]"
                style={{ background: '#7c3aed', bottom: '10%', right: '-10%' }}
                animate={{ x: [0, -40, 0], y: [0, -20, 0], opacity: [0.06, 0.12, 0.06] }}
                transition={{ duration: 12, repeat: Infinity }}
              />
              <motion.div
                className="absolute w-[500px] h-[500px] rounded-full blur-[150px]"
                style={{ background: '#4ade80', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                animate={{ opacity: [0, 0.04, 0], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 8, repeat: Infinity }}
              />
            </div>

            <ParticleBurst />

            <div className="absolute inset-0 flex items-center justify-center">
              <RevealScreen onDismiss={onDismiss} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
