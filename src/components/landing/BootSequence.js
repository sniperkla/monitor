'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import { GalaxyBackground, MatrixRain } from './BackgroundEffects';

const ASCII_LOGO = `
 ███████╗███████╗██╗  ██╗    ███╗   ███╗ ██████╗ ███╗   ██╗██╗████████╗ ██████╗ ██████╗
 ██╔════╝██╔════╝██║  ██║    ████╗ ████║██╔═══██╗████╗  ██║██║╚══██╔══╝██╔═══██╗██╔══██╗
 ███████╗███████╗███████║    ██╔████╔██║██║   ██║██╔██╗ ██║██║   ██║   ██║   ██║██████╔╝
 ╚════██║╚════██║██╔══██║    ██║╚██╔╝██║██║   ██║██║╚██╗██║██║   ██║   ██║   ██║██╔══██╗
 ███████║███████║██║  ██║    ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██║   ██║   ╚██████╔╝██║  ██║
 ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝`.trim();

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

// TypewriterLine — same as BootScreen
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
    }, 10);
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
  const { state: appState, fetchConnections } = useApp();
  const { vaultStatus } = useVault();
  const { data: session } = useSession();

  const [hovered, setHovered] = useState(false);
  const [cursorBlink, setCursorBlink] = useState(true);

  // Static lines tracking
  const staticDoneRef = useRef(0);
  const [staticProgress, setStaticProgress] = useState(0);
  const [staticComplete, setStaticComplete] = useState(false);

  // Fetch status tracking
  const [sessionStatus, setSessionStatus] = useState('pending');
  const [vaultFetchStatus, setVaultFetchStatus] = useState('pending');
  const [connStatus, setConnStatus] = useState('pending');

  // Phase: 'static' → show static lines; 'dynamic' → show dynamic fetch lines; 'complete'
  const [showDynamic, setShowDynamic] = useState(false);
  const [dynamicStep, setDynamicStep] = useState(0); // 0=session, 1=vault, 2=connections
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

  // After static animation completes, start dynamic phase
  useEffect(() => {
    if (staticComplete) setShowDynamic(true);
  }, [staticComplete]);

  // Advance dynamic steps
  useEffect(() => {
    if (!showDynamic) return;
    if (dynamicStep === 0 && sessionStatus === 'ok') setDynamicStep(1);
  }, [showDynamic, dynamicStep, sessionStatus]);

  useEffect(() => {
    if (dynamicStep === 1 && vaultFetchStatus === 'ok') setDynamicStep(2);
  }, [dynamicStep, vaultFetchStatus]);

  useEffect(() => {
    if (dynamicStep === 2 && connStatus === 'ok') setDynamicStep(3);
  }, [dynamicStep, connStatus]);

  // All dynamic steps done → complete
  useEffect(() => {
    if (dynamicStep >= 3 && !completedRef.current) {
      completedRef.current = true;
      setTimeout(onComplete, 600);
    }
  }, [dynamicStep, onComplete]);

  // Hard timeout: 15s max to avoid hanging
  useEffect(() => {
    const t = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [onComplete]);

  // Static lines done handler
  const handleStaticLineDone = useCallback(() => {
    staticDoneRef.current += 1;
    setStaticProgress(staticDoneRef.current);
    if (staticDoneRef.current >= STATIC_BOOT_LINES.length) {
      setTimeout(() => setStaticComplete(true), 300);
    }
  }, []);

  const done = staticDoneRef.current;
  const total = STATIC_BOOT_LINES.length + 3; // +3 dynamic steps
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
          {/* Glitch logo */}
          <motion.pre
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="text-[5px] sm:text-[7px] md:text-[8px] leading-tight font-mono mb-4 select-none text-indigo-500"
            style={{
              textShadow: '0 0 10px rgba(99,102,241,0.4)',
              animation: hovered ? 'boot-glitch 3s infinite' : 'none',
            }}
          >
            {ASCII_LOGO}
          </motion.pre>

          {/* System info bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex gap-4 mb-3 font-mono text-[8px] text-slate-500/60 border-b border-white/5 pb-2"
          >
            <span>CPU: 0.42</span>
            <span>MEM: 1.2G/4G</span>
            <span>DISK: 68%</span>
            <span>NET: UP</span>
            <span className="text-emerald-400/40">SECURE</span>
          </motion.div>

          {/* Static boot lines */}
          {STATIC_BOOT_LINES.map((line, i) => (
            <TypewriterLine key={i} text={line.text} delay={line.delay} type={line.type} onDone={handleStaticLineDone} />
          ))}

          {/* Dynamic fetch lines — appear after static animation */}
          <AnimatePresence>
            {showDynamic && (
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

                {/* Final ready line */}
                {dynamicStep >= 3 && (
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
        <div className="px-5 py-3 shrink-0 relative z-[2]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="flex items-center gap-3 font-mono text-[10px] md:text-xs">
            <span className="text-indigo-400/60 shrink-0">BOOT</span>
            <span className="text-emerald-400/70 flex-1 overflow-hidden">{bar}</span>
            <span className="text-slate-500 shrink-0">{Math.round(progress)}%</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
