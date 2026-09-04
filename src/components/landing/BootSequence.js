'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import { GalaxyBackground } from './BackgroundEffects';
import { LegacyBanner } from './LegacyBanner';
import {
  Cpu,
  ShieldCheck,
  Network,
  Activity,
  Terminal as TerminalIcon,
  RefreshCw,
  ChevronRight,
  Zap,
  Lock,
  Unlock,
  Server,
  CheckCircle2,
  Radio,
  KeyRound,
  Wifi,
  ShieldAlert,
} from 'lucide-react';

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
@keyframes radar-pulse {
  0% { transform: scale(0.85); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 0.2; }
  100% { transform: scale(0.85); opacity: 0.8; }
}
`;

// Boot stages configuration
const BOOT_STAGES = [
  {
    id: 1,
    key: 'post',
    num: '01',
    title: 'CORE POST',
    subtitle: 'Hardware & Kernel Verification',
    icon: Cpu,
    color: '#38bdf8',
  },
  {
    id: 2,
    key: 'crypto',
    num: '02',
    title: 'CRYPTO CORE',
    subtitle: 'Ciphers & Vault Derivation',
    icon: ShieldCheck,
    color: '#a855f7',
  },
  {
    id: 3,
    key: 'fabric',
    num: '03',
    title: 'RUNTIME FABRIC',
    subtitle: 'Network, Firewall & Container Engine',
    icon: Network,
    color: '#6366f1',
  },
  {
    id: 4,
    key: 'sync',
    num: '04',
    title: 'LIVE HANDSHAKE',
    subtitle: 'Host Session & Inventory Uplink',
    icon: Activity,
    color: '#10b981',
  },
];

// Structured static boot lines grouped across Stages 1-3
const STRUCTURED_STATIC_LINES = [
  // STAGE 1: Core Architecture & POST
  { stage: 1, tag: 'INIT', text: 'SSH Monitor v1.0.0 — Secure Shell Management Subsystem', delay: 100, type: 'header' },
  { stage: 1, tag: 'CONF', text: 'Host Architecture: ARM64-v8.2 (8 Cores, NEON SIMD acceleration enabled)', delay: 180, type: 'dim' },
  { stage: 1, tag: 'POST', text: 'POST: Memory integrity verify...... 256MB allocated OK (0 ECC faults)', delay: 280, type: 'boot' },
  { stage: 1, tag: 'POST', text: 'POST: CPU vector registers......... ARM64 instruction set verified OK', delay: 380, type: 'boot' },
  { stage: 1, tag: 'POST', text: 'POST: Storage NVMe controller...... Read/Write throughput benchmark OK', delay: 480, type: 'boot' },
  { stage: 1, tag: 'KERN', text: 'Loading microkernel modules........ Microkernel 6.1.0-sshm active', delay: 580, type: 'ok' },

  // STAGE 2: Cryptographic Subsystem
  { stage: 2, tag: 'CIPH', text: 'Initializing cryptographic engine... Hardware AES-NI cipher detected', delay: 680, type: 'boot' },
  { stage: 2, tag: 'CIPH', text: 'AES-256-GCM encryption engine active (Zero-leakage telemetry)', delay: 780, type: 'ok' },
  { stage: 2, tag: 'AUTH', text: 'Zero-knowledge key derivation ready (PBKDF2/SHA-512 derivation)', delay: 880, type: 'ok' },
  { stage: 2, tag: 'VAULT', text: 'Mounting encrypted vault datastore... Integrity signature validated', delay: 980, type: 'boot' },
  { stage: 2, tag: 'VAULT', text: 'Secure storage subsystem initialized with hardware-backed keying', delay: 1080, type: 'ok' },

  // STAGE 3: Runtime Fabric & Networking
  { stage: 3, tag: 'NET', text: 'Configuring network interfaces...... Binding eth0, lo, and WireGuard wg0', delay: 1180, type: 'boot' },
  { stage: 3, tag: 'FIRE', text: 'State-tracking firewall active (12 ingress/egress rules enforcing)', delay: 1280, type: 'ok' },
  { stage: 3, tag: 'MUX', text: 'Terminal multiplexer online (tmux 3.4 PTY backend initialized)', delay: 1380, type: 'ok' },
  { stage: 3, tag: 'SFTP', text: 'SFTP v3/v4 virtual filesystem subsystem initialized & sandboxed', delay: 1460, type: 'ok' },
  { stage: 3, tag: 'DOCK', text: 'Starting isolated container runtime & CI/CD deployment worker', delay: 1540, type: 'ok' },
];

const TYPE_SPEED = { header: 3, dim: 2, boot: 1, ok: 1 };

function TypewriterLine({ item, onDone }) {
  const { text, delay, type, tag, stage } = item;
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
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

  const isOk = type === 'ok';
  const isBoot = type === 'boot';
  const isHeader = type === 'header';
  const isDim = type === 'dim';

  // Badge styling based on tag
  const tagColor =
    tag === 'INIT' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40' :
    tag === 'POST' ? 'bg-sky-500/20 text-sky-400 border-sky-500/40' :
    tag === 'KERN' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
    tag === 'CIPH' ? 'bg-purple-500/20 text-purple-400 border-purple-500/40' :
    tag === 'VAULT' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
    tag === 'NET' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' :
    tag === 'FIRE' ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' :
    'bg-slate-800 text-slate-400 border-slate-700';

  const lineTextColor = isOk ? '#4ade80' : isHeader ? '#818cf8' : isDim ? '#64748b' : '#cbd5e1';

  return (
    <div className="font-mono text-[10px] md:text-[11.5px] leading-relaxed flex items-center min-h-[20px] group hover:bg-white/[0.02] px-1.5 rounded transition-colors">
      {/* Stage Number Pill */}
      <span className="text-[9px] text-slate-500 font-bold mr-1.5 shrink-0 hidden sm:inline-block w-4 text-center">
        {stage ? `S${stage}` : '··'}
      </span>

      {/* Timestamp */}
      <span className="text-slate-600 text-[9px] md:text-[10px] mr-2 shrink-0 hidden lg:inline-block font-mono">
        [{(delay / 1000).toFixed(6).padStart(10)}]
      </span>

      {/* Tag Badge */}
      {tag && (
        <span className={`text-[8.5px] font-semibold px-1.5 py-0.2 rounded border mr-2 shrink-0 ${tagColor}`}>
          {tag}
        </span>
      )}

      {/* Status Prefix */}
      {isBoot && <span className="text-amber-400/90 font-bold mr-1.5 shrink-0 text-[10px]">[BOOT]</span>}
      {isOk && <span className="text-emerald-400 font-bold mr-1.5 shrink-0 text-[10px]">[ OK ]</span>}

      {/* Content */}
      <span style={{ color: lineTextColor }} className="truncate">
        {done ? text : displayed}
      </span>

      {/* Typing Cursor */}
      {!done && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          className="ml-1 text-emerald-400 font-bold"
        >
          ▊
        </motion.span>
      )}

      {/* Success Indicator */}
      {done && isOk && (
        <motion.span
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500 }}
          className="ml-2 text-emerald-400 shrink-0 text-[11px]"
        >
          ✓
        </motion.span>
      )}
    </div>
  );
}

// Stage 4 Dynamic Fetch Line
function DynamicStageLine({ label, tag, status, resultText, onDone }) {
  const [phase, setPhase] = useState('typing');
  const [displayed, setDisplayed] = useState('');
  const [textDone, setTextDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const calledDone = useRef(false);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i += 2;
      setDisplayed(label.slice(0, i));
      if (i >= label.length) {
        clearInterval(interval);
        setTextDone(true);
        setPhase('waiting');
      }
    }, 4);
    return () => clearInterval(interval);
  }, [label]);

  useEffect(() => {
    if (status === 'ok' && textDone && !calledDone.current) {
      calledDone.current = true;
      setPhase('done');
      setTimeout(() => onDoneRef.current?.(), 160);
    }
  }, [status, textDone]);

  const isWaiting = phase === 'waiting' && status === 'pending';
  const isDone = phase === 'done';

  return (
    <div className="font-mono text-[10px] md:text-[11.5px] leading-relaxed flex items-center min-h-[20px] px-1.5 rounded hover:bg-white/[0.02] transition-colors">
      <span className="text-[9px] text-emerald-400/80 font-bold mr-1.5 shrink-0 hidden sm:inline-block w-4 text-center">
        S4
      </span>
      <span className="text-slate-600 text-[9px] md:text-[10px] mr-2 shrink-0 hidden lg:inline-block font-mono">
        [{(1.62).toFixed(6).padStart(10)}]
      </span>
      <span className="text-[8.5px] font-semibold px-1.5 py-0.2 rounded border mr-2 shrink-0 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
        {tag}
      </span>
      <span className="text-amber-400/90 font-bold mr-1.5 shrink-0 text-[10px]">[BOOT]</span>
      <span className="text-slate-300">{displayed}</span>

      {isWaiting && (
        <motion.span
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.5, repeat: Infinity }}
          className="ml-1 text-emerald-400 font-bold"
        >
          ▊
        </motion.span>
      )}

      {isDone && (
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="ml-2 flex items-center gap-1.5 text-emerald-400 shrink-0"
        >
          <span className="font-bold text-[10px]">[ OK ]</span>
          <span className="text-emerald-300 drop-shadow-[0_0_8px_rgba(74,222,128,0.4)]">
            {resultText}
          </span>
          <span className="text-emerald-400 text-xs font-bold">✓</span>
        </motion.div>
      )}
    </div>
  );
}

// ── Web Audio — Disabled ──
export function stopLightPassSound() {
  // Audio disabled
}

// ── Optimised Relativistic Starfield Warp (3.1s) ──
//
// Performance budget per frame: <4ms GPU, <2ms CPU
//   • 220 stars (was 550)
//   • Offscreen vignette canvas — baked once, composited with drawImage
//   • No per-streak LinearGradient at low/mid beta — solid alpha line
//   • Gradient streak only for long near-trails at beta>0.65 (max ~20/frame)
//   • No chromatic aberration (saves 2 LinearGradient calls per streak)
//   • No per-star RadialGradient bloom — simple second arc instead
//   • Per-frame color tuple computed once, reused across all stars
//   • Transform string skipped if shake delta <0.4px
//   • Beaming glow: globalAlpha + simple fillRect, no RadialGradient
//   • Synchronized cockpit shudder applied to parent viewport
//
function LightPassThrough({ active, containerRef }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);
    let baseCx = W / 2;
    let baseCy = H / 2;
    let baseFov = Math.min(W, H) * 0.70;

    const onResize = () => {
      if (!canvas) return;
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      baseCx = W / 2;
      baseCy = H / 2;
      baseFov = Math.min(W, H) * 0.70;
      lastVigBeta = -1; // force re-bake
    };
    window.addEventListener('resize', onResize, { passive: true });

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── 220 stars — enough for dense feel, within budget ──
    const STAR_COUNT = 220;
    const MAX_Z = 1600;

    // Stellar spectral classes (OBAFGKM) baked at init, not per-frame
    const SPECTRAL = [
      { r: 155, g: 176, b: 255 },
      { r: 170, g: 191, b: 255 },
      { r: 202, g: 215, b: 255 },
      { r: 248, g: 247, b: 255 },
      { r: 255, g: 244, b: 234 },
      { r: 255, g: 210, b: 161 },
      { r: 255, g: 189, b: 111 },
    ];
    const SPECTRAL_CUM = [0.01, 0.05, 0.15, 0.33, 0.70, 0.92, 1.00]; // cumulative weights

    const pickSpectral = (i) => {
      const r = ((i * 73) % 100) / 100;
      for (let s = 0; s < SPECTRAL_CUM.length; s++) {
        if (r < SPECTRAL_CUM[s]) return SPECTRAL[s];
      }
      return SPECTRAL[4];
    };

    const stars = Array.from({ length: STAR_COUNT }, (_, i) => {
      const angle = (i * 137.508 * Math.PI) / 180;
      const radialFrac = Math.pow((i * 61 + 17) % 100 / 100, 0.6);
      const spread = 160 + radialFrac * (Math.max(W, H) * 1.15);
      const x = Math.cos(angle) * spread;
      const y = Math.sin(angle) * spread;
      const z = 40 + ((i * 47) % (MAX_Z - 60));
      const lum = 0.5 + ((i * 29) % 10) * 0.08;
      const color = pickSpectral(i);
      return {
        x, y, z, prevZ: z,
        baseRadius: lum,
        color,
        twinklePhase: (i * 1.7) % (Math.PI * 2),
        magnitude: 0.4 + ((i * 53) % 10) * 0.06,
      };
    });

    // ── Pre-bake vignette into an offscreen canvas ──
    // Composited each frame with drawImage — zero GPU gradient work
    let vigCanvas = null;
    let vigCtx = null;
    let lastVigBeta = -1; // only rebake when beta changes significantly (>0.04)

    const bakeVignette = (beta, cx, cy) => {
      if (!vigCanvas) {
        vigCanvas = document.createElement('canvas');
        vigCanvas.width = W;
        vigCanvas.height = H;
        vigCtx = vigCanvas.getContext('2d');
      }
      vigCtx.clearRect(0, 0, W, H);
      const vigInner = Math.min(W, H) * (0.52 - beta * 0.22);
      const vigOuter = Math.max(W, H) * 0.92;
      const vigAlpha = 0.70 + beta * 0.25;
      const vig = vigCtx.createRadialGradient(cx, cy, Math.max(0, vigInner), cx, cy, vigOuter);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(0.7, `rgba(0,0,6,${(vigAlpha * 0.4).toFixed(3)})`);
      vig.addColorStop(1, `rgba(0,0,6,${vigAlpha.toFixed(3)})`);
      vigCtx.fillStyle = vig;
      vigCtx.fillRect(0, 0, W, H);
      lastVigBeta = beta;
    };

    // Target viewport element for shudder (parent container or canvas)
    const targetEl = containerRef?.current || canvas;
    let lastTransformStr = '';

    const DURATION = 3100;
    let startTime = null;
    const easeIn = (x, p = 2) => Math.pow(x, p);
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const tRange = (t, a, b) => clamp01((t - a) / (b - a));
    let lastTs = null;

    const draw = (ts) => {
      if (!startTime) { startTime = ts; lastTs = ts; }
      const dt = Math.min((ts - lastTs) / 1000, 0.04);
      lastTs = ts;
      const t = Math.min((ts - startTime) / DURATION, 1);

      // ── Beta ──
      const beta = t < 0.28 ? 0
        : t < 0.76 ? easeIn(tRange(t, 0.28, 0.76), 2.3)
        : t < 0.88 ? 1.0
        : Math.max(0, 1.0 - easeIn(tRange(t, 0.88, 1.0), 1.2));

      const speed = 0.6 + beta * 165;
      const trailStretch = beta * 4.2;
      const fov = baseFov * (1 + beta * 0.28);

      // ── Cockpit shudder ──
      const shakeIntensity = t < 0.28 ? 0
        : t < 0.74 ? easeIn(tRange(t, 0.28, 0.74), 2.2)
        : t < 0.86 ? 1.0
        : Math.max(0, 1.0 - easeIn(tRange(t, 0.86, 0.98), 1.6));

      const chatterPhase = ts * 0.054;
      const enginePhase = ts * 0.025;
      const buffetPhase = ts * 0.010;

      const shakeX = (Math.sin(chatterPhase) * 0.48 + Math.sin(enginePhase * 1.3 + 0.5) * 0.34 + Math.cos(buffetPhase) * 0.18) * (shakeIntensity * 6.5);
      const shakeY = (Math.cos(chatterPhase * 1.1) * 0.48 + Math.sin(enginePhase + 0.9) * 0.34 + Math.sin(buffetPhase * 1.3) * 0.18) * (shakeIntensity * 7.5);
      const shakeRot = (Math.sin(chatterPhase * 0.9) * 0.6 + Math.cos(enginePhase) * 0.4) * (shakeIntensity * 0.35);
      const shakeScale = 1.02 + (shakeIntensity * 0.015) + (Math.sin(enginePhase * 2) * 0.005 * shakeIntensity);

      // Apply realistic cockpit vibration to target container
      if (shakeIntensity > 0.02 && !prefersReducedMotion) {
        const newTransform = `translate3d(${shakeX.toFixed(1)}px,${shakeY.toFixed(1)}px,0) rotate(${shakeRot.toFixed(2)}deg) scale(${shakeScale.toFixed(3)})`;
        if (newTransform !== lastTransformStr) {
          if (targetEl) targetEl.style.transform = newTransform;
          lastTransformStr = newTransform;
        }
      } else if (lastTransformStr !== 'scale(1.02)') {
        if (targetEl) targetEl.style.transform = 'scale(1.02)';
        lastTransformStr = 'scale(1.02)';
      }

      const cx = baseCx + shakeX * 0.40;
      const cy = baseCy + shakeY * 0.40;

      // ── Trail persistence ──
      const persistence = t < 0.28 ? 0.92
        : t < 0.76 ? 0.92 - tRange(t, 0.28, 0.76) * 0.55
        : 0.35;
      ctx.fillStyle = `rgba(2,3,9,${persistence})`;
      ctx.fillRect(0, 0, W, H);

      // ── Per-frame Doppler color — computed ONCE, reused for all stars ──
      const blueshift = beta < 0.02 ? 0 : Math.pow(beta, 1.4);

      // Star rendering
      const speedStep = speed * (dt * 60);
      const useGradientStreak = beta > 0.65; // gradients only at high warp
      const PI2 = Math.PI * 2;

      for (let i = 0; i < STAR_COUNT; i++) {
        const star = stars[i];
        star.prevZ = star.z;
        star.z -= speedStep;

        if (star.z <= 12) {
          star.z += (MAX_Z - 12);
          star.prevZ = star.z;
          const a = (i * 137.508 * Math.PI) / 180 + ts * 0.00015;
          const radialFrac = Math.pow((i * 61 + 17) % 100 / 100, 0.6);
          const spread = 160 + radialFrac * (Math.max(W, H) * 1.15);
          star.x = Math.cos(a) * spread;
          star.y = Math.sin(a) * spread;
        }

        const sx = cx + (star.x / star.z) * fov;
        const sy = cy + (star.y / star.z) * fov;
        if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) continue;

        const depthFrac = 1.0 - star.z / MAX_Z;
        const brightness = Math.min(1, star.magnitude * (1 + depthFrac * depthFrac * 3.5));
        const alpha = Math.min(1, Math.max(0.12, brightness));

        // Per-star Doppler (cheap integer math)
        const cr = star.color.r, cg = star.color.g, cb = star.color.b;
        const rS = (cr - ((cr - 140) * blueshift * 0.7)) | 0;
        const gS = (cg + ((240 - cg) * blueshift * 0.5)) | 0;
        const bS = (cb + ((255 - cb) * blueshift * 0.8)) | 0;

        // Tail projection
        const effectivePrevZ = Math.min(MAX_Z, star.z + (star.prevZ - star.z) * (1 + trailStretch));
        const px = cx + (star.x / effectivePrevZ) * fov;
        const py = cy + (star.y / effectivePrevZ) * fov;
        const dx = sx - px;
        const dy = sy - py;
        const len = (dx * dx + dy * dy); // squared to skip sqrt when possible

        if (len < 1.44) {  // len < 1.2px (squared)
          // Point star — one arc draw
          const twinkle = beta < 0.1 ? 0.75 + 0.25 * Math.sin(ts * 0.003 + star.twinklePhase) : 1.0;
          const r = Math.max(0.5, star.baseRadius * (0.6 + depthFrac * 1.2));
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, PI2);
          ctx.fillStyle = `rgba(${rS},${gS},${bS},${(alpha * twinkle).toFixed(2)})`;
          ctx.fill();

          // Simple soft halo — second arc, no RadialGradient
          if (depthFrac > 0.65 && beta < 0.15) {
            ctx.beginPath();
            ctx.arc(sx, sy, r * 3.0, 0, PI2);
            ctx.fillStyle = `rgba(${rS},${gS},${bS},${(alpha * 0.08).toFixed(2)})`;
            ctx.fill();
          }
        } else {
          const streakWidth = Math.max(0.7, 0.6 + depthFrac * 1.6);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(sx, sy);
          ctx.lineWidth = streakWidth;
          ctx.lineCap = 'round';

          if (useGradientStreak && len > 9) {
            // Gradient only for long near-streaks at high beta (~20 stars max)
            const grad = ctx.createLinearGradient(px, py, sx, sy);
            grad.addColorStop(0, `rgba(${rS},${gS},${bS},0)`);
            grad.addColorStop(0.5, `rgba(${rS},${gS},${bS},${(alpha * 0.65).toFixed(2)})`);
            grad.addColorStop(1, `rgba(255,255,255,${alpha.toFixed(2)})`);
            ctx.strokeStyle = grad;
          } else {
            // Solid color stroke — 3-5× cheaper than gradient
            ctx.strokeStyle = `rgba(${rS},${gS},${bS},${alpha.toFixed(2)})`;
          }
          ctx.stroke();
        }
      }

      // ── Vignette: only rebake offscreen canvas when beta changes >0.04 ──
      if (Math.abs(beta - lastVigBeta) > 0.04) bakeVignette(beta, cx, cy);
      if (vigCanvas) ctx.drawImage(vigCanvas, 0, 0);

      // ── Relativistic beaming glow — globalAlpha + fillRect, no RadialGradient ──
      if (beta > 0.40) {
        const coreAlpha = (beta - 0.40) * 0.16;
        ctx.save();
        ctx.globalAlpha = coreAlpha;
        const glowR = Math.min(W, H) * 0.35;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, PI2);
        ctx.fillStyle = 'rgba(190, 230, 255, 0.9)';
        ctx.filter = `blur(${Math.round(glowR * 0.45)}px)`;
        ctx.fill();
        ctx.filter = 'none';
        ctx.restore();
      }

      // ── Final dissolve ──
      if (t > 0.88) {
        const fadeAlpha = easeIn(tRange(t, 0.88, 1.0), 1.4);
        ctx.fillStyle = `rgba(0,0,0,${fadeAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      if (t < 1) rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      if (targetEl) targetEl.style.transform = 'none';
      vigCanvas = null;
    };
  }, [active, containerRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none will-change-transform"
      style={{ width: '100%', height: '100%', transformOrigin: 'center center' }}
    />
  );
}

export function BootSequence({ onComplete, onSkip }) {
  const { state: appState, fetchConnections, relayInfo } = useApp();
  const { vaultStatus } = useVault();
  const { data: session } = useSession();

  const [hovered, setHovered] = useState(false);
  const [cursorBlink, setCursorBlink] = useState(true);
  const [uptime, setUptime] = useState('00:00:00.00');

  // Server / Database health check
  const [serverStatus, setServerStatus] = useState('pending'); // pending | ok | error
  const [serverError, setServerError] = useState(null);
  const [checkKey, setCheckKey] = useState(0);

  // Static lines tracking
  const staticDoneRef = useRef(0);
  const [staticProgress, setStaticProgress] = useState(0);
  const [staticComplete, setStaticComplete] = useState(false);

  // Dynamic fetch status tracking
  const [sessionStatus, setSessionStatus] = useState('pending');
  const [vaultFetchStatus, setVaultFetchStatus] = useState('pending');
  const [connStatus, setConnStatus] = useState('pending');
  const [relayStatus, setRelayStatus] = useState('pending');

  // Flow step control
  const [showDynamic, setShowDynamic] = useState(false);
  const [dynamicStep, setDynamicStep] = useState(0); // 0=session, 1=vault, 2=connections, 3=relay, 4=done
  const [launching, setLaunching] = useState(false);
  const completedRef = useRef(false);
  const cockpitRef = useRef(null);

  // Terminal auto-scroll container
  const terminalScrollRef = useRef(null);

  // Ensure audio is stopped cleanly if component unmounts
  useEffect(() => {
    return () => {
      stopLightPassSound();
    };
  }, []);

  // Cursor blink & live uptime timer
  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const s = Math.floor(elapsed / 1000);
      const ms = Math.floor((elapsed % 1000) / 10);
      const secs = String(s % 60).padStart(2, '0');
      const mins = String(Math.floor(s / 60)).padStart(2, '0');
      setUptime(`00:${mins}:${secs}.${String(ms).padStart(2, '0')}`);
      setCursorBlink((v) => !v);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut listener: ESC or Space skips boot sequence
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        stopLightPassSound();
        onSkip?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopLightPassSound();
    };
  }, [onSkip]);

  // Trigger connections fetch immediately on mount
  useEffect(() => {
    fetchConnections?.();
  }, [fetchConnections]);

  // Session resolution
  useEffect(() => {
    if (session) setSessionStatus('ok');
  }, [session]);

  // Vault resolution (any non-loading state is acceptable)
  useEffect(() => {
    if (vaultStatus !== 'loading') setVaultFetchStatus('ok');
  }, [vaultStatus]);

  // Connection resolution
  useEffect(() => {
    if (!appState.isLoading && (appState.connections?.length > 0 || vaultStatus !== 'loading')) {
      setConnStatus('ok');
    }
  }, [appState.isLoading, appState.connections?.length, vaultStatus]);

  // Relay resolution
  useEffect(() => {
    if (relayInfo?.checkDone) setRelayStatus('ok');
  }, [relayInfo?.checkDone]);

  // Health check: parallel with backoff retries (preserving exact behavior)
  useEffect(() => {
    let cancelled = false;
    const MAX_ATTEMPTS = 6;
    const RETRY_DELAY_MS = 2000;
    const doCheck = async (attempt = 1) => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const dbDown = body.status === 'degraded' || res.status === 503;
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            if (cancelled) return;
            return doCheck(attempt + 1);
          }
          setServerError(
            dbDown
              ? '[ FATAL ] Central database is unreachable. The server has suspended operations to prevent data corruption. Please verify database connectivity.'
              : `[ FATAL ] Server returned HTTP ${res.status}. Diagnostic logs required.`
          );
          setServerStatus('error');
        } else {
          setServerError(null);
          setServerStatus('ok');
        }
      } catch {
        if (cancelled) return;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          if (cancelled) return;
          return doCheck(attempt + 1);
        }
        setServerError('[ FATAL ] Cannot reach server host. It may have crashed or the database link is down.');
        setServerStatus('error');
      }
    };
    doCheck();
    return () => {
      cancelled = true;
    };
  }, [checkKey]);

  // Static phase completion -> activate dynamic phase
  useEffect(() => {
    if (staticComplete) setShowDynamic(true);
  }, [staticComplete]);

  // Dynamic step chain
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

  // Completion handoff with Light Pass-Through transition
  useEffect(() => {
    if (dynamicStep >= 4 && !completedRef.current) {
      completedRef.current = true;
      setLaunching(true);
      const timer = setTimeout(() => {
        onComplete?.();
      }, 3100);
      return () => clearTimeout(timer);
    }
  }, [dynamicStep, onComplete]);

  // 30s hard timeout safeguard
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!completedRef.current) {
        if (serverStatus === 'pending') {
          try {
            const probe = await fetch('/api/health', { cache: 'no-store' });
            if (probe.ok) {
              setServerStatus('ok');
              completedRef.current = true;
              setLaunching(true);
              setTimeout(() => onComplete?.(), 3100);
              return;
            }
          } catch (_) {}
          setServerError('[ FATAL ] Server health check timed out. Database recovery required.');
          setServerStatus('error');
        } else {
          completedRef.current = true;
          setLaunching(true);
          setTimeout(() => onComplete?.(), 950);
        }
      }
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onComplete, serverStatus]);

  // Static line completion handler
  const handleStaticLineDone = useCallback(() => {
    staticDoneRef.current += 1;
    setStaticProgress(staticDoneRef.current);
    if (staticDoneRef.current >= STRUCTURED_STATIC_LINES.length) {
      setTimeout(() => setStaticComplete(true), 240);
    }
  }, []);

  // Auto-scroll terminal smoothly on updates
  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [staticProgress, dynamicStep, showDynamic]);

  // Progress calculations
  const totalSteps = STRUCTURED_STATIC_LINES.length + 4;
  const currentStepCount = staticProgress + dynamicStep;
  const progressPercent = Math.min(Math.round((currentStepCount / totalSteps) * 100), 100);

  // Active stage determination (1, 2, 3, or 4)
  const activeStage = useMemo(() => {
    if (serverStatus === 'error') return 0;
    if (!staticComplete) {
      if (staticProgress < 6) return 1;
      if (staticProgress < 11) return 2;
      return 3;
    }
    return 4;
  }, [staticComplete, staticProgress, serverStatus]);

  // Telemetry status texts
  const connCountText = (appState.connections?.length || 0) > 0
    ? `${appState.connections.length} connection${appState.connections.length !== 1 ? 's' : ''} pooled`
    : 'Default profile loaded';
  const vaultText =
    vaultStatus === 'unlocked' ? 'Vault unlocked & decrypted' :
    vaultStatus === 'locked' ? 'Vault secured (Passphrase required)' :
    'Zero-state (Vault initialization ready)';
  const sessionText = session?.user?.email ? `Session verified (${session.user.email})` : 'Session token authenticated';
  const relayText = relayInfo?.connected
    ? `${relayInfo.relays?.length || 1} edge agent(s) synchronized`
    : 'Local daemon standalone mode';

  // Subsystem LED indicators
  const leds = [
    { label: 'SYS', active: activeStage >= 1 && serverStatus !== 'error', ok: staticProgress >= 6 },
    { label: 'ENC', active: activeStage >= 2 && serverStatus !== 'error', ok: staticProgress >= 11 },
    { label: 'NET', active: activeStage >= 3 && serverStatus !== 'error', ok: staticComplete },
    { label: 'RELAY', active: dynamicStep >= 3, ok: relayStatus === 'ok' },
    { label: 'VAULT', active: dynamicStep >= 1, ok: vaultFetchStatus === 'ok' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative w-full h-screen flex flex-col overflow-hidden bg-black select-none text-slate-200"
    >
      <style>{GLITCH_CSS}</style>
      <GalaxyBackground />

      {/* Radial vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.85) 100%)' }}
      />

      {/* Cinematic Hyperspace Cockpit Viewport */}
      {launching && (
        <div
          ref={cockpitRef}
          className="fixed inset-0 z-[70] pointer-events-none will-change-transform overflow-hidden"
          style={{ width: '100vw', height: '100vh', transformOrigin: 'center center' }}
        >
          <LightPassThrough active={launching} containerRef={cockpitRef} />
        </div>
      )}

      {/* Main Container Shell — fades out during light pass-through */}
      <motion.div
        className="relative z-20 w-full flex-1 flex flex-col overflow-hidden min-h-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        animate={
          launching
            ? {
                opacity: [1, 0.6, 0],
                filter: ['blur(0px)', 'blur(1px)', 'blur(6px)'],
                transition: { duration: 0.75, ease: 'easeInOut' },
              }
            : { opacity: 1, filter: 'blur(0px)' }
        }
        style={{
          background: 'rgba(3, 7, 18, 0.86)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* CRT Overlay Effect */}
        <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
          <div
            style={{
              background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px)',
              position: 'absolute',
              inset: 0,
            }}
          />
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at center, rgba(74,222,128,0.04) 0%, rgba(74,222,128,0.01) 55%, transparent 75%)',
              animation: 'crt-flicker 0.14s steps(2) infinite',
            }}
          />
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute',
              inset: 0,
              boxShadow: 'inset 0 0 90px rgba(0,0,0,0.6), inset 0 0 25px rgba(0,0,0,0.4)',
            }}
          />
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.18), transparent)',
              animation: 'boot-scanline 3.2s linear infinite',
              boxShadow: '0 0 16px rgba(56,189,248,0.12)',
            }}
          />
        </div>

        {/* ── TOP CONSOLE HEADER ── */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0 relative z-[2] border-b border-white/[0.08]"
          style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.7) 0%, rgba(3,7,18,0.85) 100%)' }}
        >
          {/* Left: Window Dots & Node Tag */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 shadow-[0_0_6px_rgba(245,158,11,0.4)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
            </div>
            <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-white/10 font-mono text-[11px] text-slate-400">
              <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-300 font-semibold tracking-wide">NODE:</span>
              <span className="text-cyan-400 font-medium">sshm-host-01</span>
            </div>
          </div>

          {/* Center: System Status & Live Uptime */}
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="text-slate-400 uppercase tracking-widest text-[10px] hidden md:inline">
              SSH MONITOR SYSTEM BOOT
            </span>
            <span className="text-slate-600 hidden md:inline">•</span>
            <span className="text-emerald-400/90 font-mono text-[10px] md:text-[11px]">
              UPTIME: {uptime}
            </span>
            <span
              className="inline-block w-[4px] h-[12px] ml-0.5"
              style={{
                background: cursorBlink ? '#34d399' : 'transparent',
                boxShadow: cursorBlink ? '0 0 6px #34d399' : 'none',
              }}
            />
          </div>

          {/* Right: Quick Skip with ESC badge */}
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="group flex items-center gap-1.5 text-[10.5px] font-mono px-2.5 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 hover:border-indigo-400/70 text-indigo-300 transition-all cursor-pointer shadow-[0_0_12px_rgba(99,102,241,0.15)]"
            >
              <span>Skip</span>
              <span className="text-[9px] px-1 py-0.2 bg-black/40 border border-indigo-400/30 rounded text-indigo-400 group-hover:text-indigo-200">
                ESC
              </span>
              <ChevronRight className="w-3 h-3 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>

        {/* ── STAGE PIPELINE HUD (4 DISTINCT STAGES) ── */}
        <div className="px-4 py-2 shrink-0 relative z-[2] border-b border-white/[0.06] bg-black/40">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {BOOT_STAGES.map((s) => {
              const isPast = activeStage > s.id || (activeStage === 4 && dynamicStep >= 4);
              const isCurrent = activeStage === s.id;
              const Icon = s.icon;

              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded border transition-all duration-300 ${
                    isCurrent
                      ? 'border-emerald-500/50 bg-emerald-500/[0.08] shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                      : isPast
                      ? 'border-white/[0.08] bg-white/[0.02] text-slate-400'
                      : 'border-white/[0.04] bg-black/20 text-slate-600 opacity-60'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border ${
                      isCurrent
                        ? 'border-emerald-400 bg-emerald-400/20 text-emerald-300'
                        : isPast
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-800 bg-slate-900/60 text-slate-600'
                    }`}
                  >
                    {isPast ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-mono text-[9px] font-bold tracking-wider ${
                          isCurrent ? 'text-emerald-300' : isPast ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        STAGE {s.num}
                      </span>
                      {isCurrent && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      )}
                    </div>
                    <div
                      className={`text-[10px] md:text-[11px] font-medium font-mono truncate ${
                        isCurrent ? 'text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]' : isPast ? 'text-slate-400' : 'text-slate-600'
                      }`}
                    >
                      {s.title}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTRAL COMMAND DECK (TERMINAL LOG + TELEMETRY SIDECAR) ── */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 relative z-[2]">
          {/* LEFT: Terminal Log Stream */}
          <div
            ref={terminalScrollRef}
            className="flex-1 overflow-y-auto p-4 md:p-5 space-y-1 custom-scrollbar border-r border-white/[0.06]"
            style={{ minHeight: '280px' }}
          >
            {/* Legacy banner */}
            <LegacyBanner hovered={hovered} />

            {/* Stage 1-3 Structured Lines */}
            {STRUCTURED_STATIC_LINES.map((line, idx) => (
              <TypewriterLine
                key={`static-${idx}`}
                item={line}
                onDone={handleStaticLineDone}
              />
            ))}

            {/* ── EMERGENCY FATAL ERROR STATE ── */}
            <AnimatePresence>
              {serverStatus === 'error' && serverError && (
                <motion.div
                  key="fatal-error"
                  initial={{ opacity: 0, scale: 0.98, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="my-4 rounded-lg border border-red-500/50 p-4 font-mono text-[11px] space-y-3 bg-red-950/20 backdrop-blur-sm shadow-[0_0_35px_rgba(220,38,38,0.2)]"
                >
                  <div className="flex items-center gap-2.5 text-red-400 font-bold text-xs tracking-wider">
                    <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
                    <span>EMERGENCY HALT — DATABASE OFFLINE / UNREACHABLE</span>
                  </div>
                  <p className="text-red-200/90 leading-relaxed font-mono bg-red-950/40 p-2.5 rounded border border-red-500/20">
                    {serverError}
                  </p>
                  <div className="text-slate-400 text-[10px] leading-relaxed">
                    Automatic recovery is polling. Restore MongoDB / cluster connectivity or manually bypass if testing in isolated mode.
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setServerError(null);
                        setServerStatus('pending');
                        setCheckKey((k) => k + 1);
                      }}
                      className="px-3.5 py-1.5 rounded text-xs font-mono font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/50 transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Health Probe
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        completedRef.current = true;
                        setLaunching(true);
                        setTimeout(() => onComplete?.(), 3100);
                      }}
                      className="px-3.5 py-1.5 rounded text-xs font-mono text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer border border-white/10"
                    >
                      Bypass to Desktop ▸
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── STAGE 4 DYNAMIC LINES ── */}
            <AnimatePresence>
              {showDynamic && serverStatus === 'ok' && (
                <motion.div
                  key="dynamic-stage"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-1 pt-1"
                >
                  <div className="my-2 border-t border-emerald-500/20 pt-2 flex items-center gap-2 text-emerald-400/80 font-mono text-[10px] tracking-wider font-semibold">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    <span>STAGE 04 // LIVE HOST SYNCHRONIZATION</span>
                  </div>

                  {/* Step 1: Session */}
                  <DynamicStageLine
                    label="Verifying master session credentials........."
                    tag="AUTH"
                    status={sessionStatus}
                    resultText={sessionText}
                    onDone={() => {}}
                  />

                  {/* Step 2: Vault */}
                  {dynamicStep >= 1 && (
                    <DynamicStageLine
                      label="Probing zero-knowledge security vault.........."
                      tag="VAULT"
                      status={vaultFetchStatus}
                      resultText={vaultText}
                      onDone={() => {}}
                    />
                  )}

                  {/* Step 3: Connections Pool */}
                  {dynamicStep >= 2 && (
                    <DynamicStageLine
                      label="Synchronizing remote SSH inventory pool........"
                      tag="INVT"
                      status={connStatus}
                      resultText={connCountText}
                      onDone={() => {}}
                    />
                  )}

                  {/* Step 4: Local Relay Agent */}
                  {dynamicStep >= 3 && (
                    <DynamicStageLine
                      label="Polling edge local relay agent status.........."
                      tag="RELAY"
                      status={relayStatus}
                      resultText={relayText}
                      onDone={() => {}}
                    />
                  )}

                  {/* Final Handshake Line */}
                  {dynamicStep >= 4 && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="pt-3 pb-1 space-y-1"
                    >
                      <div className="font-mono text-[10px] text-emerald-500/40">
                        {'═'.repeat(64)}
                      </div>
                      <div className="font-mono text-[11px] md:text-[12px] text-center font-bold text-emerald-400 drop-shadow-[0_0_12px_rgba(74,222,128,0.6)] flex items-center justify-center gap-2">
                        <Zap className={`w-4 h-4 ${launching ? 'text-cyan-400 fill-cyan-400 animate-spin' : 'text-emerald-400 fill-emerald-400'}`} />
                        <span>
                          {launching
                            ? 'HYPERWARP DRIVE ENGAGED — JUMPING TO ENVIRONMENT ▸'
                            : 'All host subsystems operational — launching desktop environment ▸'}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-emerald-500/40">
                        {'═'.repeat(64)}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* RIGHT: Live Telemetry & Subsystems HUD (Sidecar) */}
          <div className="w-full md:w-80 shrink-0 p-4 space-y-3 bg-black/30 backdrop-blur-sm border-t md:border-t-0 md:border-l border-white/[0.06] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300 font-semibold tracking-wider">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>TELEMETRY HUD</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                LIVE
              </span>
            </div>

            {/* Architecture Spec Card */}
            <div className="rounded-lg p-3 bg-white/[0.02] border border-white/[0.06] space-y-2 font-mono text-[10.5px]">
              <div className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider">
                Hardware & System
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Kernel</span>
                <span className="text-slate-200 font-semibold">6.1.0-sshm</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Architecture</span>
                <span className="text-cyan-400 font-semibold">ARM64 / NEON</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Cipher Core</span>
                <span className="text-purple-400 font-semibold">AES-256-GCM</span>
              </div>
              <div className="space-y-1 pt-1">
                <div className="flex justify-between items-center text-slate-400 text-[10px]">
                  <span>Heap Memory</span>
                  <span className="text-emerald-400">256MB / 1024MB</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                    initial={{ width: '15%' }}
                    animate={{ width: `${Math.min(25 + progressPercent * 0.45, 70)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            </div>

            {/* Live Subsystem Monitors */}
            <div className="rounded-lg p-3 bg-white/[0.02] border border-white/[0.06] space-y-2.5 font-mono text-[10.5px]">
              <div className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider">
                Subsystem Linkages
              </div>

              {/* Identity / Session */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  Auth State
                </span>
                <span
                  className={`text-[9.5px] px-1.5 py-0.5 rounded border font-semibold ${
                    sessionStatus === 'ok'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse'
                  }`}
                >
                  {sessionStatus === 'ok' ? 'AUTHENTICATED' : 'PROBING'}
                </span>
              </div>

              {/* Vault */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  {vaultStatus === 'unlocked' ? (
                    <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  Master Vault
                </span>
                <span
                  className={`text-[9.5px] px-1.5 py-0.5 rounded border font-semibold ${
                    vaultStatus === 'unlocked'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : vaultStatus === 'locked'
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {vaultStatus === 'unlocked'
                    ? 'UNLOCKED'
                    : vaultStatus === 'locked'
                    ? 'LOCKED'
                    : 'READY'}
                </span>
              </div>

              {/* Connections Pool */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  SSH Hosts
                </span>
                <span className="text-cyan-300 font-semibold">
                  {appState.connections?.length || 0} pooled
                </span>
              </div>

              {/* Relay Uplink */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                  Edge Relay
                </span>
                <span
                  className={`text-[9.5px] px-1.5 py-0.5 rounded border font-semibold ${
                    relayInfo?.connected
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {relayInfo?.connected ? 'CONNECTED' : 'STANDALONE'}
                </span>
              </div>
            </div>

            {/* Security Guarantee Notice */}
            <div className="rounded-lg p-2.5 bg-emerald-500/[0.04] border border-emerald-500/20 font-mono text-[9.5px] text-emerald-400/80 leading-relaxed flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Zero-knowledge environment enforced. Client keys are held in volatile RAM only.
              </span>
            </div>
          </div>
        </div>

        {/* ── BOTTOM STATUS & PROGRESS DECK ── */}
        <div
          className="px-4 py-2.5 shrink-0 relative z-[2] border-t border-white/[0.08]"
          style={{
            background:
              serverStatus === 'error'
                ? 'rgba(220, 38, 38, 0.12)'
                : 'linear-gradient(180deg, rgba(3,7,18,0.85) 0%, rgba(15,23,42,0.9) 100%)',
          }}
        >
          <div className="flex flex-col gap-2 font-mono">
            {/* Top row: Status Readout, LEDs, and Percentage */}
            <div className="flex items-center justify-between text-[10px] md:text-[11px]">
              {/* Active Task / Status */}
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`font-bold px-1.5 py-0.5 rounded ${
                    serverStatus === 'error'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  }`}
                >
                  {serverStatus === 'error' ? 'HALTED' : launching ? 'HYPERWARP' : activeStage === 4 ? 'SYNCING' : 'INITIALIZING'}
                </span>
                <span className="text-slate-400 truncate">
                  {serverStatus === 'error'
                    ? 'Boot sequence suspended — Awaiting database connection'
                    : launching
                    ? 'Hyperwarp drive engaged — transitioning into dashboard...'
                    : activeStage === 4
                    ? 'Finalizing live host handshake and telemetry hooks...'
                    : activeStage === 3
                    ? 'Establishing runtime fabric and multiplexer daemon...'
                    : activeStage === 2
                    ? 'Executing cryptographic derivation & vault integrity...'
                    : 'Running low-level POST hardware validation tests...'}
                </span>
              </div>

              {/* Hardware Subsystem LEDs & Percentage */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex items-center gap-2 pr-2 border-r border-white/10">
                  {leds.map((led, i) => (
                    <div key={i} className="flex items-center gap-1 text-[9px] text-slate-400">
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                          led.ok
                            ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                            : led.active
                            ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24] animate-pulse'
                            : 'bg-slate-800'
                        }`}
                      />
                      <span>{led.label}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-1 font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]">
                  <span>{progressPercent}%</span>
                </div>
              </div>
            </div>

            {/* Bottom row: High-density Segmented Progress Bar */}
            <div className="w-full h-2 rounded bg-slate-900 border border-white/[0.08] p-0.5 overflow-hidden flex gap-0.5">
              {Array.from({ length: 48 }).map((_, i) => {
                const filledRatio = (i + 1) / 48;
                const isFilled = progressPercent / 100 >= filledRatio;
                return (
                  <div
                    key={i}
                    className={`flex-1 h-full rounded-[1px] transition-all duration-150 ${
                      serverStatus === 'error'
                        ? 'bg-red-500/60 shadow-[0_0_4px_rgba(239,68,68,0.5)]'
                        : isFilled
                        ? 'bg-gradient-to-t from-emerald-500 to-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                        : 'bg-slate-800/40'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
