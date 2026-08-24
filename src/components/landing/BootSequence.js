'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
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
@keyframes crt-flicker {
  0%, 100% { opacity: 0.05; }
  50% { opacity: 0.075; }
  72% { opacity: 0.045; }
}
/* Matrix-glitch launch — hard digital corruption that decays into the dissolve */
@keyframes launch-glitch {
  0%, 100% { transform: translate(0) skewX(0deg); }
  10% { transform: translate(-9px, 3px) skewX(4deg); }
  20% { transform: translate(7px, -5px) skewX(-3deg); }
  30% { transform: translate(-11px, -2px) skewY(1deg); }
  40% { transform: translate(9px, 4px); }
  50% { transform: translate(-6px, -3px) skewX(-4deg) scaleY(1.02); }
  60% { transform: translate(10px, 1px) skewX(2deg); }
  70% { transform: translate(-8px, 4px) scaleY(0.99); }
  80% { transform: translate(5px, -2px) skewY(-1deg); }
  90% { transform: translate(-3px, 1px); }
}
@keyframes launch-tear {
  0%   { top: 8%;  height: 4%; opacity: 0;    transform: translateX(-45px); }
  12%  { opacity: 1;  transform: translateX(35px); }
  24%  { top: 62%; height: 9%; opacity: 0.6;  transform: translateX(-60px); }
  36%  { top: 22%; height: 2%; opacity: 0.95; transform: translateX(50px); }
  48%  { top: 74%; height: 7%; opacity: 0.55; transform: translateX(-30px); }
  60%  { top: 40%; height: 12%; opacity: 1;   transform: translateX(65px); }
  72%  { top: 52%; height: 3%; opacity: 0.85; transform: translateX(-40px); }
  86%  { top: 82%; height: 6%; opacity: 0.7;  transform: translateX(25px); }
  100% { top: 15%; height: 2%; opacity: 0;    transform: translateX(70px); }
}
@keyframes rgb-split {
  0%, 100% { opacity: 0; transform: translateX(0); }
  15% { opacity: 0.55; transform: translateX(-14px); }
  30% { opacity: 0.2; transform: translateX(10px); }
  45% { opacity: 0.6; transform: translateX(-18px); }
  60% { opacity: 0.15; transform: translateX(6px); }
  75% { opacity: 0.5; transform: translateX(-10px); }
}
@keyframes corrupt-blocks {
  0%, 100% { background-position: 0 0; opacity: 0.25; }
  20% { background-position: 40px 120px; opacity: 0.6; }
  40% { background-position: -60px 40px; opacity: 0.3; }
  60% { background-position: 90px -80px; opacity: 0.65; }
  80% { background-position: -30px 160px; opacity: 0.35; }
}
/* Tear bands stretching into warp star-trails as the screen dissolves */
@keyframes launch-streak {
  0%   { transform: scaleY(0.12) translateY(50%); opacity: 0; }
  30%  { opacity: 1; transform: scaleY(0.8) translateY(10%); }
  100% { transform: scaleY(4) translateY(-70%); opacity: 0.85; }
}
@keyframes matrix-dissolve {
  0% { opacity: 0; }
  30% { opacity: 1; }
  100% { opacity: 1; }
}
`;

// Static system boot lines — completes in ~2.4s
const STATIC_BOOT_LINES = [
  { text: 'SSH Monitor v1.0.0 — Secure Shell Management System', delay: 200, type: 'header' },
  { text: 'Copyright (c) 2024 SSH Monitor. All rights reserved.', delay: 320, type: 'dim' },
  { text: '', delay: 360 },
  { text: 'POST: Memory test.......... 256MB OK', delay: 420, type: 'boot' },
  { text: 'POST: CPU check............ ARM64 OK', delay: 540, type: 'boot' },
  { text: 'POST: Storage verify....... NVMe OK', delay: 660, type: 'boot' },
  { text: '', delay: 700 },
  { text: '[BOOT] Loading kernel modules.................', delay: 740, type: 'boot' },
  { text: '[ OK ] Kernel 6.1.0-sshm loaded', delay: 860, type: 'ok' },
  { text: '[ OK ] AES-256-GCM encryption engine ready', delay: 960, type: 'ok' },
  { text: '[BOOT] Mounting encrypted filesystem...........', delay: 1040, type: 'boot' },
  { text: '[ OK ] Vault subsystem initialized', delay: 1140, type: 'ok' },
  { text: '[ OK ] Zero-knowledge key derivation ready', delay: 1240, type: 'ok' },
  { text: '[BOOT] Initializing SSH protocol stack........', delay: 1320, type: 'boot' },
  { text: '[ OK ] Terminal multiplexer online (tmux 3.4)', delay: 1420, type: 'ok' },
  { text: '[ OK ] SFTP subsystem ready', delay: 1490, type: 'ok' },
  { text: '[BOOT] Configuring network interfaces.........', delay: 1560, type: 'boot' },
  { text: '[ OK ] Firewall loaded (12 rules active)', delay: 1680, type: 'ok' },
  { text: '[BOOT] Starting container runtime.............', delay: 1760, type: 'boot' },
  { text: '[ OK ] Docker runtime ready', delay: 1860, type: 'ok' },
  { text: '[BOOT] Loading deployment engine..............', delay: 1940, type: 'boot' },
  { text: '[ OK ] CI/CD pipeline ready', delay: 2040, type: 'ok' },
];

// Timelapse cadence — lines burst in rapid-fire like an accelerated boot recording
const LINE_STAGGER_MS = 42; // gap between consecutive lines
const TYPE_SPEED = { header: 3, divider: 3, dim: 2, boot: 1, ok: 1 };

function staticDelay(i, original) {
  // Compress the original choreography into a dense timelapse timeline
  return original.type === 'header' ? 120 : 320 + i * LINE_STAGGER_MS;
}

const TIMELAPSE_LINES = STATIC_BOOT_LINES.map((line, i) => ({ ...line, delay: staticDelay(i, line) }));

// TypewriterLine — timelapse variant: ultra-fast character feed
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
    const speed = TYPE_SPEED[type] ?? 1;
    const interval = setInterval(() => {
      // Feed multiple chars per tick for the timelapse blur effect
      i += speed <= 1 ? 4 : 1;
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
      {(isBoot || isOk) && (
        <span className="text-slate-600 mr-1.5 shrink-0 hidden sm:inline">[{(delay / 1000).toFixed(6).padStart(10)}]</span>
      )}
      {isBoot && <span className="text-amber-400/80 mr-1.5 shrink-0">[BOOT]</span>}
      {isOk && <span className="text-emerald-400 mr-1.5 shrink-0">[ OK ]</span>}
      <span style={lineStyle}>{done ? (isBoot || isOk ? cleanText : text) : displayed}</span>
      {!done && <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.8, repeat: Infinity }} className="ml-0.5" style={{ color: '#4ade80' }}>▊</motion.span>}
      {done && isOk && <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 500 }} className="ml-2 text-emerald-400 shrink-0">✓</motion.span>}
    </div>
  );
}

// Dynamic fetch status line — waits for status then shows result
function FetchLine({ label, status, resultText, onDone }) {
  const [phase, setPhase] = useState('typing'); // typing | waiting | done
  const [displayed, setDisplayed] = useState('');
  const [textDone, setTextDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const calledDone = useRef(false);

  // Type out the label
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(label.slice(0, i));
      if (i >= label.length) {
        clearInterval(interval);
        setTextDone(true);
        setPhase('waiting');
      }
    }, 3);
    return () => clearInterval(interval);
  }, [label]);

  // When status resolves and text is done, call done
  useEffect(() => {
    if (status === 'ok' && textDone && !calledDone.current) {
      calledDone.current = true;
      setPhase('done');
      setTimeout(() => onDoneRef.current(), 200);
    }
  }, [status, textDone]);

  const isWaiting = phase === 'waiting' && status === 'pending';
  const isDone = phase === 'done';

  return (
    <div className="font-mono text-[9px] md:text-[11px] leading-relaxed flex items-center min-h-[18px]">
      <span className="text-amber-400/80 mr-1.5 shrink-0">[BOOT]</span>
      <span style={{ color: '#94a3b8' }}>{displayed}</span>
      {isWaiting && (
        <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="ml-0.5" style={{ color: '#4ade80' }}>▊</motion.span>
      )}
      {isDone && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="ml-2 flex items-center gap-1"
        >
          <span className="text-emerald-400">[ OK ]</span>
          <span style={{ color: '#4ade80', textShadow: '0 0 6px rgba(74,222,128,0.3)' }}>{resultText}</span>
          <span className="text-emerald-400">✓</span>
        </motion.span>
      )}
    </div>
  );
}

export function BootSequence({ onComplete, onSkip }) {
  const { state: appState, fetchConnections, relayInfo } = useApp();
  const { vaultStatus } = useVault();
  const { data: session } = useSession();

  const [hovered, setHovered] = useState(false);
  const [cursorBlink, setCursorBlink] = useState(true);

  // Server / DB health check
  const [serverStatus, setServerStatus] = useState('pending'); // pending | ok | error
  const [serverError, setServerError] = useState(null); // null or error message string

  // Static lines tracking
  const staticDoneRef = useRef(0);
  const [staticProgress, setStaticProgress] = useState(0);
  const [staticComplete, setStaticComplete] = useState(false);

  // Fetch status tracking
  const [sessionStatus, setSessionStatus] = useState('pending');
  const [vaultFetchStatus, setVaultFetchStatus] = useState('pending');
  const [connStatus, setConnStatus] = useState('pending');
  const [relayStatus, setRelayStatus] = useState('pending');

  // Phase: 'static' → show static lines; 'dynamic' → show dynamic fetch lines; 'complete'
  const [showDynamic, setShowDynamic] = useState(false);
  const [dynamicStep, setDynamicStep] = useState(0); // 0=session, 1=vault, 2=connections, 3=relay
  const [launching, setLaunching] = useState(false); // warp-zoom exit transition
  const completedRef = useRef(false);

  // Cursor blink
  useEffect(() => {
    const blink = setInterval(() => setCursorBlink(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

  // Kick off a fetch as soon as we mount (supplement AppContext auto-fetch)
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Resolve session status
  useEffect(() => {
    if (session) setSessionStatus('ok');
  }, [session]);

  // Resolve vault status (any non-loading state is acceptable to proceed)
  useEffect(() => {
    if (vaultStatus !== 'loading') setVaultFetchStatus('ok');
  }, [vaultStatus]);

  // Resolve connection status
  useEffect(() => {
    if (!appState.isLoading && (appState.connections.length > 0 || vaultStatus !== 'loading')) {
      setConnStatus('ok');
    }
  }, [appState.isLoading, appState.connections.length, vaultStatus]);

  // Resolve relay status
  useEffect(() => {
    if (relayInfo.checkDone) setRelayStatus('ok');
  }, [relayInfo.checkDone]);

  // Health check: first thing we do after static animation finishes
  useEffect(() => {
    if (!staticComplete) return;
    let cancelled = false;
    const doCheck = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const dbDown = body.status === 'degraded' || res.status === 503;
          setServerError(dbDown
            ? '[ FATAL ] Central database is unreachable. The server has shut down to prevent data corruption. Please restore the database connection and restart the server.'
            : `[ FATAL ] Server returned HTTP ${res.status}. Please check server logs.`);
          setServerStatus('error');
        } else {
          setServerStatus('ok');
        }
      } catch {
        if (cancelled) return;
        setServerError('[ FATAL ] Cannot reach the server. It may have crashed or the central database is down. Please restore the database and restart the server.');
        setServerStatus('error');
      }
    };
    doCheck();
    return () => { cancelled = true; };
  }, [staticComplete]);

  // After static animation completes, start dynamic phase (health check gating is separate)
  useEffect(() => {
    if (staticComplete) setShowDynamic(true);
  }, [staticComplete]);

  // Advance dynamic steps — health check must pass first
  useEffect(() => {
    if (!showDynamic) return;
    if (dynamicStep === 0 && sessionStatus === 'ok' && serverStatus === 'ok') setDynamicStep(1);
  }, [showDynamic, dynamicStep, sessionStatus, serverStatus]);

  useEffect(() => {
    if (dynamicStep === 1 && vaultFetchStatus === 'ok') setDynamicStep(2);
  }, [dynamicStep, vaultFetchStatus]);

  useEffect(() => {
    if (dynamicStep === 2 && connStatus === 'ok') setDynamicStep(3);
  }, [dynamicStep, connStatus]);

  useEffect(() => {
    if (dynamicStep === 3 && relayStatus === 'ok') setDynamicStep(4);
  }, [dynamicStep, relayStatus]);

  // All dynamic steps done → launch zoom transition, then hand off
  useEffect(() => {
    if (dynamicStep >= 4 && !completedRef.current) {
      completedRef.current = true;
      setLaunching(true);
      setTimeout(onComplete, 500);
    }
  }, [dynamicStep, onComplete]);

  // Hard timeout: 15s max — but show error if server never responded
  useEffect(() => {
    const t = setTimeout(() => {
      if (!completedRef.current) {
        if (serverStatus === 'pending') {
          // Server never replied — treat as fatal
          setServerError('[ FATAL ] Server health check timed out. The central database may be down. Please restore the database and restart the server.');
          setServerStatus('error');
        } else {
          completedRef.current = true;
          onComplete();
        }
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [onComplete, serverStatus]);

  // Static lines done handler
  const handleStaticLineDone = useCallback(() => {
    staticDoneRef.current += 1;
    setStaticProgress(staticDoneRef.current);
    if (staticDoneRef.current >= STATIC_BOOT_LINES.length) {
      setTimeout(() => setStaticComplete(true), 300);
    }
  }, []);

  const done = staticDoneRef.current;
  const total = STATIC_BOOT_LINES.length + 4; // +4 dynamic steps
  const dynamicDone = dynamicStep;
  const progress = Math.min(((done + dynamicDone) / total) * 100, 100);
  const blocks = 40;
  const filled = Math.round((progress / 100) * blocks);
  const bar = '█'.repeat(filled) + '░'.repeat(blocks - filled);

  const connCountText = appState.connections.length > 0
    ? `${appState.connections.length} connection${appState.connections.length !== 1 ? 's' : ''} loaded`
    : 'No connections found';
  const vaultText = vaultStatus === 'unlocked' ? 'Vault unlocked' : vaultStatus === 'locked' ? 'Vault locked — enter master password' : 'No vault configured';
  const sessionText = session?.user?.email ? `Authenticated as ${session.user.email}` : 'Session active';
  const relayText = relayInfo.connected
    ? `${relayInfo.relays.length} relay${relayInfo.relays.length !== 1 ? 's' : ''} connected`
    : 'No relay agent detected';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={launching ? { opacity: [1, 0.96, 0.85] } : { opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={launching ? { duration: 0.5, times: [0, 0.5, 1], ease: 'easeInOut' } : { duration: 0.3 }}
      className="relative w-full h-screen flex flex-col overflow-hidden bg-black"
      style={{
        animation: launching ? 'launch-glitch 0.12s steps(2) infinite' : 'none',
        filter: launching ? 'blur(1.5px) brightness(1.25) contrast(1.15)' : 'none',
        transition: launching ? 'filter 1.1s ease-in' : 'none',
        willChange: launching ? 'transform, opacity' : 'auto',
      }}
    >
      <style>{GLITCH_CSS}</style>
      <GalaxyBackground />
      <MatrixRain />

      <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.75) 100%)' }} />

      {/* High-intensity glitch launch — RGB channel split + corrupt data blocks + hard tear bands */}
      <AnimatePresence>
        {launching && (
          <>
            {/* Red channel ghost */}
            <motion.div
              key="rgb-r"
              className="fixed inset-0 z-[60] pointer-events-none mix-blend-screen"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.7] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{
                background: 'linear-gradient(90deg, rgba(255,0,60,0.22), transparent 30%, transparent 70%, rgba(255,0,60,0.18))',
                animation: 'rgb-split 0.19s steps(2) infinite',
              }}
            />
            {/* Cyan channel ghost */}
            <motion.div
              key="rgb-c"
              className="fixed inset-0 z-[60] pointer-events-none mix-blend-screen"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.7] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{
                background: 'linear-gradient(90deg, transparent 20%, rgba(0,240,255,0.2) 50%, transparent 80%)',
                animation: 'rgb-split 0.16s steps(2) 0.04s infinite reverse',
              }}
            />
            {/* Corrupt data blocks — chunky misaligned memory slices */}
            <motion.div
              key="corrupt"
              className="fixed inset-0 z-[60] pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{
                background:
                  'repeating-linear-gradient(0deg, transparent 0 38px, rgba(74,222,128,0.12) 38px 41px), repeating-linear-gradient(90deg, transparent 0 110px, rgba(16,185,129,0.08) 110px 118px)',
                backgroundSize: 'auto, 220px 100%',
                animation: 'corrupt-blocks 0.24s steps(3) infinite',
                mixBlendMode: 'screen',
              }}
            />
            {/* Matrix scanline wash */}
            <motion.div
              key="glitch-wash"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.4] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="fixed inset-0 z-[61] pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(0deg, rgba(34,197,94,0.2), rgba(34,197,94,0.2) 2px, transparent 2px, transparent 6px)',
                mixBlendMode: 'screen',
              }}
            />
            {/* Hard tear bands */}
            {[0, 1, 2, 3].map((i) => (
              <motion.div
                key={`tear-${i}`}
                className="fixed left-0 right-0 z-[62] pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut', delay: i * 0.07 }}
                style={{
                  background: i % 2 === 1
                    ? 'linear-gradient(90deg, rgba(16,185,129,0.45), rgba(134,239,172,0.7), rgba(16,185,129,0.45))'
                    : i === 0
                      ? 'rgba(255,0,60,0.28)'
                      : 'rgba(0,240,255,0.26)',
                  boxShadow: i % 2 === 1 ? '0 0 28px rgba(74,222,128,0.55)' : 'none',
                  mixBlendMode: 'screen',
                  animation: `launch-tear ${0.32 + (i % 2) * 0.14}s steps(4) ${i * 0.06}s infinite`,
                }}
              />
            ))}
            {/* Streak lines — tear bands stretching into warp star-trails */}
            {[
              { left: '30%', w: 2, d: 0.55, delay: 0.1 },
              { left: '52%', w: 3, d: 0.45, delay: 0.18 },
              { left: '68%', w: 2, d: 0.62, delay: 0.05 },
              { left: '44%', w: 1, d: 0.5, delay: 0.24 },
            ].map((s, i) => (
              <motion.div
                key={`streak-${i}`}
                className="fixed z-[63] pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, delay: s.delay }}
                style={{
                  left: s.left,
                  top: '28%',
                  width: s.w,
                  height: '44vh',
                  background: 'linear-gradient(180deg, transparent, rgba(134,239,172,0.85) 40%, rgba(255,255,255,0.9) 50%, rgba(52,211,153,0.7) 60%, transparent)',
                  boxShadow: '0 0 14px rgba(74,222,128,0.5)',
                  transformOrigin: 'center',
                  animation: `launch-streak ${s.d}s ease-in ${s.delay}s infinite`,
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      <div
        className="relative z-20 w-full flex-1 flex flex-col overflow-hidden min-h-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: launching ? 'transparent' : 'rgba(4, 5, 15, 0.82)',
          backdropFilter: 'blur(10px)',
          transition: 'background 0.3s',
        }}
      >
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
          <div style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px)', position: 'absolute', inset: 0 }} />
          {/* CRT phosphor glow — faint emerald wash that flickers like a real tube */}
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(ellipse at center, rgba(74,222,128,0.05) 0%, rgba(74,222,128,0.015) 55%, transparent 75%)',
              animation: 'crt-flicker 0.12s steps(2) infinite',
            }}
          />
          {/* CRT vignette — dark rounded corners like a curved tube */}
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute', inset: 0,
              boxShadow: 'inset 0 0 90px rgba(0,0,0,0.45), inset 0 0 18px rgba(0,0,0,0.3)',
              borderRadius: '10px',
            }}
          />
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

          {/* Static boot lines — timelapse cadence */}
          {TIMELAPSE_LINES.map((line, i) => (
            <TypewriterLine key={i} text={line.text} delay={line.delay} type={line.type} onDone={handleStaticLineDone} />
          ))}

          {/* ── FATAL ERROR PANEL — server or DB is down ── */}
          <AnimatePresence>
            {serverStatus === 'error' && serverError && (
              <motion.div
                key="fatal-error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mt-4 rounded-lg border border-red-500/40 p-4 font-mono text-[10px] md:text-[11px] space-y-2"
                style={{
                  background: 'rgba(220, 38, 38, 0.08)',
                  boxShadow: '0 0 30px rgba(220,38,38,0.15), inset 0 0 20px rgba(220,38,38,0.05)',
                }}
              >
                <motion.div
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="text-red-400 font-bold text-[12px] flex items-center gap-2"
                >
                  <span>⛔</span>
                  <span>BOOT FAILURE — SYSTEM HALTED</span>
                </motion.div>
                <div className="text-red-300/80 leading-relaxed whitespace-pre-wrap">{serverError}</div>
                <div className="text-slate-400/60 pt-1 border-t border-red-500/20">
                  Waiting for database to recover... The server will restart automatically once the connection is restored.
                </div>
                <motion.div
                  className="flex items-center gap-2 pt-1"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <span className="text-red-500">▐▌</span>
                  <span className="text-red-400/70 text-[9px]">SYSTEM SUSPENDED — AWAITING DATABASE</span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dynamic fetch lines — appear after static animation & health check passes */}
          <AnimatePresence>
            {showDynamic && serverStatus === 'ok' && (
              <motion.div
                key="dynamic"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-0.5 pt-0.5"
              >
                <div className="h-3" />

                {/* Step 1: Session */}
                <FetchLine
                  label="Verifying session credentials........."
                  status={sessionStatus}
                  resultText={sessionText}
                  onDone={() => {}}
                />

                {/* Step 2: Vault — only after step 1 */}
                {dynamicStep >= 1 && (
                  <FetchLine
                    label="Initializing security vault............"
                    status={vaultFetchStatus}
                    resultText={vaultText}
                    onDone={() => {}}
                  />
                )}

                {/* Step 3: Connections — only after step 2 */}
                {dynamicStep >= 2 && (
                  <FetchLine
                    label="Fetching SSH connections..............."
                    status={connStatus}
                    resultText={connCountText}
                    onDone={() => {}}
                  />
                )}

                {/* Step 4: Relay — only after step 3 */}
                {dynamicStep >= 3 && (
                  <FetchLine
                    label="Checking local relay agent................"
                    status={relayStatus}
                    resultText={relayText}
                    onDone={() => {}}
                  />
                )}

                {/* Final ready line */}
                {dynamicStep >= 4 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="pt-2 space-y-0.5"
                  >
                    <div className="font-mono text-[9px] md:text-[11px]" style={{ color: '#4f46e5' }}>{'═'.repeat(68)}</div>
                    <div className="font-mono text-[9px] md:text-[11px] text-center" style={{ color: '#4ade80', textShadow: '0 0 10px rgba(74,222,128,0.5)' }}>
                      All subsystems operational — launching desktop ▸
                    </div>
                    <div className="font-mono text-[9px] md:text-[11px]" style={{ color: '#4f46e5' }}>{'═'.repeat(68)}</div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 shrink-0 relative z-[2]" style={{ borderTop: `1px solid ${serverStatus === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(0,0,0,0.4)' }}>
          <div className="flex items-center gap-3 font-mono text-[10px] md:text-xs">
            <motion.span
              className="shrink-0"
              animate={serverStatus === 'error' ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ duration: 1, repeat: Infinity }}
              style={{ color: serverStatus === 'error' ? '#f87171' : 'rgba(129,140,248,0.6)' }}
            >{serverStatus === 'error' ? 'HALT' : 'BOOT'}</motion.span>
            <motion.span
              className="flex-1 overflow-hidden"
              animate={serverStatus === 'error' ? { opacity: [1, 0.4, 1] } : {}}
              transition={{ duration: 1, repeat: Infinity }}
              style={{ color: serverStatus === 'error' ? 'rgba(248,113,113,0.7)' : 'rgba(74,222,128,0.7)' }}
            >{bar}</motion.span>
            <span className="shrink-0" style={{ color: serverStatus === 'error' ? '#f87171' : '#64748b' }}>{serverStatus === 'error' ? 'ERROR' : `${Math.round(progress)}%`}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
