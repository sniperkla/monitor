'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import { LegacyBanner } from './LegacyBanner';
import { useViewportSize } from '@/hooks/useViewportSize';
import { RefreshCw, ShieldAlert, Zap } from 'lucide-react';
import { detectMobileDevice } from '@/hooks/useIsMobileDevice';

//
// Design note — this screen used to be a cockpit HUD: four stage cards with
// icons, a telemetry sidecar, a bank of blinking LEDs, a 48-segment progress
// bar and a chrome window header. All of it was decoration competing with the
// one thing that actually communicates "the machine is starting": the log.
//
// What is left is a terminal. One column, one typeface, real dmesg/systemd
// line formatting, colour used only to mark status. Immersion now comes from
// restraint plus three things that survive the cut:
//   • the typewriter — the log writes itself, it does not appear
//   • the phosphor — a soft bloom and scanlines, no flicker
//   • the light pass-through at the end — the one moment of spectacle
//

const CRT_CSS = `
/* LegacyBanner still animates with this global keyframe name — keep it. */
@keyframes boot-glitch {
  0%, 100% { transform: translate(0); filter: none; }
  5% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
  10% { transform: translate(2px, -1px); filter: hue-rotate(-90deg); }
  15% { transform: translate(0); filter: none; }
}
/* A single slow sweep. One pass every 8s reads as a live CRT; the old
   per-frame flicker just read as noise and made the text harder to read. */
@keyframes boot-sweep {
  0%   { transform: translateY(-14vh); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translateY(114vh); opacity: 0; }
}
@keyframes boot-caret {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0; }
}

/* LegacyBanner draws a fixed 48-column ASCII box, so it cannot reflow — below
   ~334px it is wider than the terminal column and its right border clips.
   Scaling the glyphs keeps the box whole. 29.6 = 48 columns x 0.6021em (the
   measured advance width of this mono face) plus ~2% so integer rounding of
   the layout cannot shave the last column; the -44px is the column padding.
   Capped at the design sizes (10px mobile, 13px from md up). */
.boot-banner { font-size: min(10px, calc((100vw - 44px) / 29.6)); }
@media (min-width: 768px) {
  .boot-banner { font-size: 13px; }
}
`;

// Labels are padded with a dotted leader so every result lands on the same
// column. That alignment is what makes a boot log read as a log rather than a
// pile of sentences — it is the whole reason real dmesg output is scannable.
const LABEL_COL = 47;

// The one-line `label ...dots... result  [ OK ]` format needs ~74 monospace
// columns, i.e. 585px at 12px type. Measured in Chrome: the terminal column
// offers 603px at a 900px viewport but only 563px at 860px and 229px at 390px,
// so from ~877px down the result is unreachable. Shrinking the leader is not
// enough — at 390px the label and result alone are 337px with zero dots.
// Below this width the result therefore moves to its own indented row, which
// is what a real terminal does when a line does not fit.
const COMPACT_MAX = 900;

const mk = (stage, tag, label, result, delay, opts = {}) => ({
  stage,
  tag,
  delay,
  label,
  result,
  status: opts.status ?? 'ok',
  type: opts.type ?? 'line',
  text: `${label} ${'.'.repeat(Math.max(3, LABEL_COL - label.length - 1))} ${result}`,
});

// The `delay` values double as the timestamps printed on each line, so they
// are the boot timeline — changing them changes both pacing and the log.
const BOOT_LINES = [
  // ── Stage 1: POST & kernel ──
  mk(1, 'init', 'ssh-monitor v1.0.0', 'secure shell management subsystem', 100, { type: 'header' }),
  mk(1, 'conf', 'host architecture', 'arm64-v8.2, 8 cores, neon simd', 180),
  mk(1, 'post', 'memory integrity verify', '256mb allocated, 0 ecc faults', 280),
  mk(1, 'post', 'cpu vector registers', 'arm64 instruction set verified', 380),
  mk(1, 'post', 'storage nvme controller', 'read/write throughput nominal', 480),
  mk(1, 'kern', 'loading microkernel modules', 'microkernel 6.1.0-sshm active', 580),

  // ── Stage 2: cryptography ──
  mk(2, 'ciph', 'initializing cryptographic engine', 'hardware aes-ni detected', 680),
  mk(2, 'ciph', 'aes-256-gcm cipher engine', 'zero-leakage telemetry', 780),
  mk(2, 'auth', 'zero-knowledge key derivation', 'argon2id / sha-512 ready', 880),
  mk(2, 'vault', 'mounting encrypted vault datastore', 'integrity signature valid', 980),
  mk(2, 'vault', 'secure storage subsystem', 'hardware-backed keying', 1080),

  // ── Stage 3: runtime fabric ──
  mk(3, 'net', 'configuring network interfaces', 'eth0, lo, wireguard wg0', 1180),
  mk(3, 'fire', 'state-tracking firewall', '12 ingress/egress rules', 1280),
  mk(3, 'mux', 'terminal multiplexer', 'tmux 3.4 pty backend', 1380),
  mk(3, 'sftp', 'virtual filesystem subsystem', 'sftp v3/v4 sandboxed', 1460),
  mk(3, 'dock', 'isolated container runtime', 'ci/cd deployment worker', 1540),
];

const TYPE_SPEED = { header: 3, line: 1 };

const STATUS_LABEL = { ok: '[  OK  ]', boot: '[ BOOT ]', wait: '[ WAIT ]' };

/**
 * One log line. Types itself out, then settles into its final aligned form
 * with the status token right-aligned at the end of the row.
 */
function BootLine({ item, compact, onDone }) {
  const { label, result, text, delay, tag, status, type } = item;

  // Compact mode has no column to pad to, so the leader goes and the
  // typewriter types a shorter string. The halves are split apart again at
  // render time — progress is still a single running prefix of `target`, so
  // the caret crosses the row break without stuttering.
  const target = compact ? `${label} ${result}` : text;
  const splitAt = label.length + 1;

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
    if (!target) {
      doneRef.current = true;
      setDone(true);
      setTimeout(() => onDoneRef.current(), 0);
      return;
    }
    let i = 0;
    const speed = TYPE_SPEED[type] ?? 1;
    const interval = setInterval(() => {
      i += speed <= 1 ? 4 : 1;
      setDisplayed(target.slice(0, i));
      if (i >= target.length) {
        clearInterval(interval);
        doneRef.current = true;
        setDone(true);
        onDoneRef.current();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [started, target, type]);

  if (!started) return null;

  const isHeader = type === 'header';
  const statusColor =
    status === 'ok'
      ? 'text-emerald-500/80'
      : status === 'boot'
      ? 'text-amber-500/80'
      : 'text-slate-600';
  const statusToken = done ? STATUS_LABEL[status] ?? '' : '';

  const caret = !done && (
    <span
      className="ml-0.5 inline-block w-[0.5em] translate-y-[0.1em] bg-emerald-400/80 align-baseline"
      style={{ height: '0.95em', animation: 'boot-caret 0.9s steps(1) infinite' }}
    />
  );

  // `pre-wrap`, not `pre`, in both modes. Identical output while the line
  // fits; a wrap instead of a clip if the installed mono face is wider than
  // the one COMPACT_MAX was measured against. `break-words` covers the dotted
  // leader, which is a single unbreakable run that `pre-wrap` alone will not
  // split.
  const body = 'whitespace-pre-wrap break-words';

  if (compact) {
    const head = displayed.slice(0, splitAt).replace(/\s+$/, '');
    const tail = displayed.length > splitAt ? displayed.slice(splitAt) : '';
    return (
      <div
        className="flex items-baseline gap-2 font-mono text-[11px] leading-[1.5] md:text-[12px]"
        style={{ textShadow: '0 0 10px rgba(148,163,184,0.10)' }}
      >
        {/* 5.5ch, not a px width: the longest tags ("vault", "relay") are
                five characters, and a fixed 32px gutter clipped them once the
                type stepped up to 12px. `ch` tracks the font instead. */}
        <span className="w-[5.5ch] shrink-0 uppercase tracking-wider text-slate-600">
          {tag}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`${body} ${isHeader ? 'text-slate-200' : 'text-slate-400'}`}>
            {head}
            {tail === '' && caret}
          </div>
          {/* Result on its own indented row, status beside it — the verdict
              stays next to the thing it is a verdict on. */}
          <div className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 ${body} text-slate-400`}>
              {tail}
              {tail !== '' && caret}
            </span>
            <span className={`shrink-0 tabular-nums ${statusColor}`}>{statusToken}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] md:text-[12px]">
      {/* Timestamp — doubles as the boot timeline */}
      <span className="hidden shrink-0 text-slate-700 tabular-nums sm:inline">
        [{String((delay / 1000).toFixed(6)).padStart(10)}]
      </span>

      {/* Tag — uniform dim grey. The old version rainbow-coded these into
          coloured pills, which is exactly the HUD look we are dropping. */}
      <span className="w-10 shrink-0 uppercase tracking-wider text-slate-600 md:w-12">
        {tag}
      </span>

      <span
        className={`min-w-0 flex-1 ${body} ${isHeader ? 'text-slate-200' : 'text-slate-400'}`}
        style={{ textShadow: '0 0 10px rgba(148,163,184,0.10)' }}
      >
        {done ? text : displayed}
        {caret}
      </span>

      {/* Status token — right-aligned so the column reads cleanly */}
      <span className={`shrink-0 tabular-nums ${statusColor}`}>{statusToken}</span>
    </div>
  );
}

/**
 * Stage 4 line: types its label, then holds a blinking caret until the real
 * async work resolves, at which point the result and [  OK  ] land.
 */
function DynamicStageLine({ label, tag, status, resultText, compact, onDone }) {
  // These labels arrive with their own dotted leader baked in
  // ("Verifying master session credentials......"). Compact mode breaks the
  // row in two, so the leader has to come off with the single-line layout.
  const typedLabel = compact ? label.replace(/\.+$/, '') : label;

  const [phase, setPhase] = useState('typing');
  const [displayed, setDisplayed] = useState('');
  const [textDone, setTextDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const calledDone = useRef(false);

  useEffect(() => {
    let i = 0;
    const typed = typedLabel;
    const interval = setInterval(() => {
      i += 2;
      setDisplayed(typed.slice(0, i));
      if (i >= typed.length) {
        clearInterval(interval);
        setTextDone(true);
        setPhase('waiting');
      }
    }, 4);
    return () => clearInterval(interval);
  }, [typedLabel]);

  useEffect(() => {
    if (status === 'ok' && textDone && !calledDone.current) {
      calledDone.current = true;
      setPhase('done');
      setTimeout(() => onDoneRef.current?.(), 160);
    }
  }, [status, textDone]);

  const isWaiting = phase === 'waiting' && status === 'pending';
  const isDone = phase === 'done';
  const statusToken = isDone ? STATUS_LABEL.ok : phase === 'typing' ? '' : STATUS_LABEL.wait;

  const caret = isWaiting && (
    <span
      className="ml-0.5 inline-block w-[0.5em] translate-y-[0.1em] bg-emerald-400/80"
      style={{ height: '0.95em', animation: 'boot-caret 0.9s steps(1) infinite' }}
    />
  );

  if (compact) {
    return (
      <div
        className="flex items-baseline gap-2 font-mono text-[11px] leading-[1.5] md:text-[12px]"
        style={{ textShadow: '0 0 10px rgba(148,163,184,0.10)' }}
      >
        {/* 5.5ch, not a px width: the longest tags ("vault", "relay") are
                five characters, and a fixed 32px gutter clipped them once the
                type stepped up to 12px. `ch` tracks the font instead. */}
        <span className="w-[5.5ch] shrink-0 uppercase tracking-wider text-slate-600">
          {tag}
        </span>
        <div className="min-w-0 flex-1">
          <div className="whitespace-pre-wrap break-words text-slate-400">
            {isDone ? typedLabel : displayed}
            {!isDone && caret}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-400">
              {isDone ? resultText : ''}
            </span>
            <span
              className={`shrink-0 tabular-nums ${
                isDone ? 'text-emerald-500/80' : 'text-slate-600'
              }`}
            >
              {statusToken}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] md:text-[12px]">
      <span className="hidden shrink-0 text-slate-700 tabular-nums sm:inline">
        [{String((1.62).toFixed(6)).padStart(10)}]
      </span>
      <span className="w-10 shrink-0 uppercase tracking-wider text-slate-600 md:w-12">{tag}</span>

      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-400">
        {isDone ? `${typedLabel} ${resultText}` : displayed}
        {caret}
      </span>

      <span className={`shrink-0 tabular-nums ${isDone ? 'text-emerald-500/80' : 'text-slate-600'}`}>
        {statusToken}
      </span>
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
    if (detectMobileDevice() || (typeof window !== 'undefined' && window.innerWidth < 768)) return;
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
      lastVigBeta = -1;   // force re-bake
      glowGrad = null;    // radius is viewport-derived, so the sprite is stale
      glowR = Math.min(W, H) * 0.42;
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
        x, y, z,
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

    // ── Pre-baked glow sprite (forward beaming + arrival bloom) ──
    // Built once at the origin and positioned each frame with translate().
    // Replaces the old `ctx.filter = blur(Npx)`, which re-ran a full-screen
    // blur every frame and was the single biggest cost in this effect.
    let glowGrad = null;
    let glowR = Math.min(W, H) * 0.42;

    const ensureGlow = () => {
      if (glowGrad) return;
      glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
      glowGrad.addColorStop(0, 'rgba(214,240,255,0.85)');
      glowGrad.addColorStop(0.22, 'rgba(168,220,255,0.34)');
      glowGrad.addColorStop(0.55, 'rgba(120,180,255,0.10)');
      glowGrad.addColorStop(0.80, 'rgba(90,150,255,0.03)');
      glowGrad.addColorStop(1, 'rgba(70,130,255,0)');
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

    // Shutter time, in seconds. Trails are derived from speed × this, so a
    // streak is the distance the star covered while the "shutter" was open.
    // Deriving it from time rather than frame count is what keeps streak
    // length identical on a 60Hz and a 144Hz display.
    const EXPOSURE_SEC = 0.02;

    const draw = (ts) => {
      if (!startTime) { startTime = ts; lastTs = ts; }
      const dt = Math.min((ts - lastTs) / 1000, 0.04);
      lastTs = ts;
      const t = Math.min((ts - startTime) / DURATION, 1);

      // ── Beta: hold → accelerate → cruise → decelerate to a full stop ──
      //
      // The deceleration leg is what makes the ending read as *arriving*
      // somewhere. The old curve slammed beta to 0 while a black veil faded
      // in at the same time — two endings fighting, which is why the handoff
      // felt like a cut. Now beta eases to zero by t=0.95, the streaks
      // retract on their own, and the last 5% is already a calm picture.
      const beta = t < 0.16 ? 0
        : t < 0.62 ? easeIn(tRange(t, 0.16, 0.62), 2.4)
        : t < 0.78 ? 1.0
        : t < 0.95 ? Math.pow(1 - tRange(t, 0.78, 0.95), 2.0)
        : 0;

      const speed = 0.6 + beta * 165;
      // z-distance covered during one shutter opening. Grows with speed, so
      // trails stretch as we accelerate and retract as we decelerate.
      const trailZ = speed * 60 * EXPOSURE_SEC * (1 + beta * 0.4);
      const fov = baseFov * (1 + beta * 0.30);

      // ── Cockpit shudder ──
      const shakeIntensity = t < 0.16 ? 0
        : t < 0.60 ? easeIn(tRange(t, 0.16, 0.60), 2.2)
        : t < 0.80 ? 1.0
        : Math.max(0, 1.0 - easeIn(tRange(t, 0.80, 0.95), 1.6));

      // Amplitudes cut roughly 3.5× from the original (6.5px / 7.5px / 0.35°)
      // and the scale jitter removed outright — that was the single most
      // nauseating component. Frequencies are also lower: the old 0.054 chatter
      // read as a rattle, this reads as a hull you feel rather than see.
      const chatterPhase = ts * 0.030;
      const enginePhase = ts * 0.017;
      const buffetPhase = ts * 0.008;

      const shakeX = (Math.sin(chatterPhase) * 0.40 + Math.sin(enginePhase * 1.3 + 0.5) * 0.42 + Math.cos(buffetPhase) * 0.18) * (shakeIntensity * 1.9);
      const shakeY = (Math.cos(chatterPhase * 1.1) * 0.40 + Math.sin(enginePhase + 0.9) * 0.42 + Math.sin(buffetPhase * 1.3) * 0.18) * (shakeIntensity * 2.1);
      const shakeRot = (Math.sin(chatterPhase * 0.9) * 0.5 + Math.cos(enginePhase) * 0.5) * (shakeIntensity * 0.10);
      // Constant. Just enough overscan to hide the edges under translation.
      const shakeScale = 1.008;

      // Apply realistic cockpit vibration to target container
      if (shakeIntensity > 0.02 && !prefersReducedMotion) {
        const newTransform = `translate3d(${shakeX.toFixed(2)}px,${shakeY.toFixed(2)}px,0) rotate(${shakeRot.toFixed(3)}deg) scale(${shakeScale})`;
        if (newTransform !== lastTransformStr) {
          if (targetEl) targetEl.style.transform = newTransform;
          lastTransformStr = newTransform;
        }
      } else if (lastTransformStr !== `scale(${shakeScale})`) {
        if (targetEl) targetEl.style.transform = `scale(${shakeScale})`;
        lastTransformStr = `scale(${shakeScale})`;
      }

      const cx = baseCx + shakeX * 0.40;
      const cy = baseCy + shakeY * 0.40;

      // ── Trail persistence ──
      // At rest the frame is cleared completely (crisp points); at cruise most
      // of the previous frame is retained so the streaks smear. Tying this to
      // beta rather than to t means the smear unwinds during deceleration.
      const clearAlpha = 1 - beta * 0.80;
      ctx.fillStyle = `rgba(2,3,9,${clearAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);

      // Star rendering
      const speedStep = speed * (dt * 60);
      const useGradientStreak = beta > 0.65; // gradients only at high warp
      const PI2 = Math.PI * 2;
      // Radial normaliser for relativistic beaming (see below).
      const halfMin = Math.min(W, H) * 0.5;

      for (let i = 0; i < STAR_COUNT; i++) {
        const star = stars[i];
        star.z -= speedStep;

        if (star.z <= 12) {
          star.z += (MAX_Z - 12);
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
        let alpha = Math.min(1, Math.max(0.12, brightness));

        // Relativistic beaming: the forward hemisphere collects the light, so
        // the periphery dims as beta climbs. This is the effect that turns a
        // flat radial starfield into a tunnel you are moving *through*.
        const rad = Math.sqrt((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy)) / halfMin;
        if (rad > 1) alpha *= 1 - beta * 0.38;
        else alpha *= 1 - beta * 0.38 * rad;

        // Doppler is angle-dependent, not a flat value: cos of the angle
        // between the star and the velocity vector. Stars dead ahead (cosT→1)
        // blue-shift hardest; the limb barely shifts at all. The old code
        // applied one uniform shift to every star, which is why the whole
        // field turned the same colour at once.
        const cosT = star.z / Math.sqrt(star.x * star.x + star.y * star.y + star.z * star.z);
        const shift = beta * cosT;

        // Per-star Doppler (cheap integer math)
        const cr = star.color.r, cg = star.color.g, cb = star.color.b;
        const rS = (cr - ((cr - 140) * shift * 0.7)) | 0;
        const gS = (cg + ((240 - cg) * shift * 0.5)) | 0;
        const bS = (cb + ((255 - cb) * shift * 0.8)) | 0;

        // Tail projection — where the star sat one shutter-opening ago.
        const tailZ = star.z + trailZ;
        const px = cx + (star.x / tailZ) * fov;
        const py = cy + (star.y / tailZ) * fov;
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

      // ── Vignette: only rebake offscreen canvas when beta changes >0.05 ──
      if (Math.abs(beta - lastVigBeta) > 0.05) bakeVignette(beta, cx, cy);
      if (vigCanvas) ctx.drawImage(vigCanvas, 0, 0);

      // ── Forward beaming + arrival bloom ──
      //
      // Two effects sharing one baked gradient. It is created once at the
      // origin and positioned with translate(), so the (now tiny) cockpit
      // shake no longer forces a rebuild every frame.
      //
      // The old version used `ctx.filter = blur(...)`, which was by far the
      // most expensive call on the frame — a full-screen blur every frame is
      // what caused visible hitching on weaker GPUs.
      const beaming = beta > 0.30 ? (beta - 0.30) * 0.22 : 0;
      // Swells as the streaks retract and eases back before the handoff, so
      // the destination "resolves" ahead of us instead of the effect simply
      // stopping. Peaks near t=0.90 and keeps a soft residual at t=1.
      const arrival = tRange(t, 0.80, 1.0);
      const arrivalGlow = arrival > 0 ? Math.sin(arrival * Math.PI * 0.85) * 0.45 : 0;
      const glowA = Math.min(0.9, beaming + arrivalGlow);

      if (glowA > 0.005) {
        ensureGlow();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = glowA;
        ctx.fillStyle = glowGrad;
        ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
        ctx.restore();
      }
      // No black dissolve. The canvas now ends on a calm, settled starfield
      // with a soft bloom, and the parent's own 0.5s crossfade carries it into
      // the desktop — so there is no black gap to read as a cut.

      if (t < 1) rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      if (targetEl) targetEl.style.transform = 'none';
      vigCanvas = null;
      glowGrad = null;
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

// Footer phase readout. The four stage cards are gone; this is all that is
// left of them, and it costs one line instead of a whole HUD row.
const STAGE_LABEL = [
  'halted',
  'core post',
  'crypto core',
  'runtime fabric',
  'live handshake',
];

export function BootSequence({ onComplete, onSkip }) {
  const { state: appState, fetchConnections, relayInfo } = useApp();
  const { vaultStatus } = useVault();
  const { data: session } = useSession();

  // Below COMPACT_MAX the log rows break in two. This has to be a JS branch
  // rather than a media query because the two layouts are structurally
  // different, not just restyled.
  const { w: viewportWidth } = useViewportSize();
  const compact = viewportWidth < COMPACT_MAX;

  const [hovered, setHovered] = useState(false);

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
    if (staticDoneRef.current >= BOOT_LINES.length) {
      setTimeout(() => setStaticComplete(true), 240);
    }
  }, []);

  // Follow the log as it writes. Pinning on line *completion* is not enough:
  // a line also grows while it types, and in compact mode every line is two
  // rows tall, so the gap between the last completion and the final height
  // left the tail below the fold — measured 33px short at 320x480, i.e. the
  // last log line clipped. Observing the DOM pins on every write instead,
  // which is what a terminal should do anyway.
  useEffect(() => {
    const el = terminalScrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    const mo = new MutationObserver(pin);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    // A window resize re-wraps the compact rows without mutating the DOM.
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, []);

  // Progress calculations
  const totalSteps = BOOT_LINES.length + 4;
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

  const footerText = serverStatus === 'error'
    ? 'boot suspended — awaiting database connection'
    : launching
    ? 'light pass-through engaged — transitioning into desktop'
    : `${STAGE_LABEL[activeStage]} · ${serverStatus === 'ok' ? 'link nominal' : 'probing link'}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative w-full h-screen overflow-hidden bg-[#04060a] select-none text-slate-200"
    >
      <style>{CRT_CSS}</style>

      {/* ── Ambient layers ──
          No starfield. A live parallax galaxy behind monospace text is what
          made the old screen feel like a dashboard; the phosphor bloom and
          the vignette are enough to keep it from feeling flat. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {/* Phosphor bloom behind the text column */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 42%, rgba(45,212,191,0.055) 0%, transparent 70%)',
          }}
        />
        {/* Static scanlines — 3px period, barely there */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.013) 2px, rgba(255,255,255,0.013) 3px)',
          }}
        />
        {/* Slow CRT sweep — one pass every 8s */}
        <div
          className="absolute left-0 right-0 h-[18vh]"
          style={{
            background:
              'linear-gradient(180deg, transparent, rgba(148,163,184,0.045), transparent)',
            animation: 'boot-sweep 8s linear infinite',
          }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)',
          }}
        />
      </div>

      {/* Cinematic Hyperspace Cockpit Viewport */}
      {launching && (
        <div
          ref={cockpitRef}
          className="fixed inset-0 z-[70] pointer-events-none will-change-transform overflow-hidden"
          // `dvh`, not `vh`: LightPassThrough sizes its backing store from
          // window.innerHeight, which on iOS Safari is the *visible* viewport.
          // A `vh` container is the larger one, so the canvas got stretched
          // vertically and the warp elongated. Browsers without dvh support
          // drop the declaration and fall back to `inset-0`, which is correct.
          style={{ width: '100vw', height: '100dvh', transformOrigin: 'center center' }}
        >
          <LightPassThrough active={launching} containerRef={cockpitRef} />
        </div>
      )}

      {/* ── Terminal column — fades out during light pass-through ── */}
      <motion.div
        className="relative z-20 mx-auto flex h-full w-full max-w-[980px] flex-col px-5 py-6 md:px-8 md:py-10"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        animate={
          launching
            ? {
                // Push *through* the text rather than just fading it: the
                // scale ramp is what ties the terminal's disappearance to the
                // starfield's acceleration, so the two read as one motion.
                opacity: [1, 0.55, 0],
                filter: ['blur(0px)', 'blur(2px)', 'blur(9px)'],
                scale: [1, 1.04, 1.09],
                transition: { duration: 0.85, ease: 'easeIn' },
              }
            : { opacity: 1, filter: 'blur(0px)', scale: 1 }
        }
      >
        {/* Header — one line, no chrome */}
        <div className="mb-5 flex shrink-0 items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">
          <span>
            ssh-monitor<span className="text-slate-700"> / preflight</span>
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="cursor-pointer lowercase tracking-normal text-slate-700 transition-colors hover:text-slate-400"
          >
            esc to skip
          </button>
        </div>

        {/* Log stream */}
        <div
          ref={terminalScrollRef}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <LegacyBanner hovered={hovered} />

          {/* Stages 1-3 */}
          <div className="mt-3 space-y-[3px]">
            {BOOT_LINES.map((line, idx) => (
              <BootLine
                key={`static-${idx}`}
                item={line}
                compact={compact}
                onDone={handleStaticLineDone}
              />
            ))}
          </div>

          {/* ── FATAL ERROR ── */}
          <AnimatePresence>
            {serverStatus === 'error' && serverError && (
              <motion.div
                key="fatal-error"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-5 space-y-3 font-mono text-[11px] md:text-[12px]"
              >
                <div className="flex items-center gap-2 text-red-400">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span className="uppercase tracking-wider">boot halted</span>
                </div>
                <p className="whitespace-pre-wrap border-l-2 border-red-500/40 pl-3 leading-relaxed text-red-300/80">
                  {serverError}
                </p>
                <p className="pl-3 text-slate-600">
                  Automatic recovery is polling. Restore database connectivity, or bypass if you are
                  testing in isolated mode.
                </p>
                <div className="flex items-center gap-4 pl-3">
                  <button
                    type="button"
                    onClick={() => {
                      setServerError(null);
                      setServerStatus('pending');
                      setCheckKey((k) => k + 1);
                    }}
                    className="flex cursor-pointer items-center gap-1.5 text-red-300/90 transition-colors hover:text-red-200"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    retry health probe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      completedRef.current = true;
                      setLaunching(true);
                      setTimeout(() => onComplete?.(), 3100);
                    }}
                    className="cursor-pointer text-slate-500 transition-colors hover:text-slate-300"
                  >
                    bypass to desktop ▸
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── STAGE 4: live host synchronization ── */}
          <AnimatePresence>
            {showDynamic && serverStatus === 'ok' && (
              <motion.div
                key="dynamic-stage"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="space-y-[3px] pt-3"
              >
                <div className="pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-700">
                  {'// live host synchronization'}
                </div>

                <DynamicStageLine
                  label="Verifying master session credentials......"
                  tag="auth"
                  status={sessionStatus}
                  resultText={sessionText}
                  compact={compact}
                  onDone={() => {}}
                />

                {dynamicStep >= 1 && (
                  <DynamicStageLine
                    label="Probing zero-knowledge security vault....."
                    tag="vault"
                    status={vaultFetchStatus}
                    resultText={vaultText}
                    compact={compact}
                    onDone={() => {}}
                  />
                )}

                {dynamicStep >= 2 && (
                  <DynamicStageLine
                    label="Synchronizing remote ssh inventory pool..."
                    tag="invt"
                    status={connStatus}
                    resultText={connCountText}
                    compact={compact}
                    onDone={() => {}}
                  />
                )}

                {dynamicStep >= 3 && (
                  <DynamicStageLine
                    label="Polling edge local relay agent status....."
                    tag="relay"
                    status={relayStatus}
                    resultText={relayText}
                    compact={compact}
                    onDone={() => {}}
                  />
                )}

                {/* Handoff line */}
                {dynamicStep >= 4 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="pt-5 font-mono text-[11px] md:text-[12px]"
                  >
                    {/* A rule of 72 box-drawing characters was an unbreakable
                        token that ran off-screen below ~530px. A border is the
                        same hairline and scales to any width. */}
                    <div className="my-3 border-t border-slate-800" />
                    <div className="flex items-center gap-2 py-1.5 text-emerald-400/90">
                      <Zap
                        className={`h-3.5 w-3.5 ${
                          launching ? 'animate-spin text-cyan-400' : 'text-emerald-400'
                        }`}
                      />
                      <span>
                        {launching
                          ? 'light pass-through engaged — jumping to environment ▸'
                          : 'all host subsystems operational — launching desktop environment ▸'}
                      </span>
                    </div>
                    <div className="my-3 border-t border-slate-800" />
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom padding so the last line never sits flush against the rule */}
          <div className="h-6" />
        </div>

        {/* Footer — phase readout, percentage, 1px progress rule */}
        <div className="mt-4 shrink-0">
          <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] text-slate-600">
            <span className="truncate lowercase">{footerText}</span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {String(progressPercent).padStart(3, ' ')}%
            </span>
          </div>
          <div className="h-px w-full overflow-hidden bg-white/[0.06]">
            <motion.div
              className={`h-px ${serverStatus === 'error' ? 'bg-red-500/70' : 'bg-emerald-400/70'}`}
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
