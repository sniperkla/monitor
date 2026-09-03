'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
function easeInCubic(x) { return x * x * x; }
function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
function easeOutQuart(x) { return 1 - Math.pow(1 - x, 4); }
function easeInQuart(x) { return x * x * x * x; }

/**
 * Ultra-Lightweight Web Audio Synthesizer
 * Zero memory allocations during animation frames; runs asynchronously on audio thread
 */
function playWarpAudio(durationMs) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const dur = durationMs / 1000;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.linearRampToValueAtTime(0.30, now + 0.15);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    masterGain.connect(ctx.destination);

    // Deep sub-bass hum (40Hz -> 105Hz)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(40, now);
    osc.frequency.exponentialRampToValueAtTime(105, now + dur * 0.15);
    osc.frequency.linearRampToValueAtTime(65, now + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(28, now + dur * 0.85);

    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.35, now + dur * 0.1);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.9);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur);

    // Subtle sonic boom at warp jump
    const boomOsc = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boomOsc.type = 'sine';
    boomOsc.frequency.setValueAtTime(75, now + dur * 0.08);
    boomOsc.frequency.exponentialRampToValueAtTime(25, now + dur * 0.35);

    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.setValueAtTime(0.40, now + dur * 0.08);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.4);

    boomOsc.connect(boomGain);
    boomGain.connect(masterGain);
    boomOsc.start(now + dur * 0.08);
    boomOsc.stop(now + dur * 0.45);

    return () => {
      try { ctx.close(); } catch (_) {}
    };
  } catch (_) {
    return null;
  }
}

export function HyperspaceTransition({ onComplete }) {
  const canvasRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const starsRef = useRef([]);
  const termRef = useRef(null);
  const termContentRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const smoothMouseRef = useRef({ x: 0, y: 0 });
  const [hudTelemetry, setHudTelemetry] = useState({ speedC: '0.12c', warpFactor: 'WF 0.8', status: 'INITIATING' });

  const TOTAL_DURATION = 3500;

  const getPhase = (t) => {
    if (t < 0.08) return 0; // Spool / Engine Charge
    if (t < 0.16) return 1; // Relativistic Breakthrough
    if (t < 0.52) return 2; // Hyperspace Cruise
    if (t < 0.74) return 3; // Relativistic Redshift Deceleration
    return 4;                // Terminal Glide & Orbital Re-entry
  };

  useEffect(() => {
    const cleanupAudio = playWarpAudio(TOTAL_DURATION);

    // Natural interstellar starfield: 420 stars with authentic astrophysical color temperatures
    // O/B (Blue-white), A (Diamond White), G (Solar Gold), M (Red-Amber)
    starsRef.current = Array.from({ length: 420 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 20 + Math.pow(Math.random(), 1.6) * 880;
      const isLeadStreak = i % 10 === 0;

      const starRand = Math.random();
      let h, s, l;
      if (starRand < 0.28) {
        h = 210; s = '85%'; l = '92%'; // Blue-white
      } else if (starRand < 0.65) {
        h = 200; s = '25%'; l = '96%'; // Pure white
      } else if (starRand < 0.86) {
        h = 42; s = '75%'; l = '88%';  // Solar yellow
      } else {
        h = 16; s = '80%'; l = '78%';  // Warm amber
      }

      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: Math.random() * 1200 + 40,
        r: isLeadStreak ? 1.4 : 0.8,
        isLeadStreak,
        baseHue: h,
        baseSat: s,
        baseLight: l,
        alpha: Math.random() * 0.55 + 0.45,
      };
    });

    return () => {
      if (cleanupAudio) cleanupAudio();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Fast DPR clamping for high-DPI screens to prevent GPU fill-rate throttling
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    let animId;
    const startTime = performance.now();
    let lastTelemetryUpdate = 0;

    const tick = (now) => {
      const elapsed = now - startTime;
      const rawT = Math.min(1, elapsed / TOTAL_DURATION);
      const t = rawT;
      const phase = getPhase(t);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w * 0.5;
      const cy = h * 0.5;

      // Smooth camera interpolation
      smoothMouseRef.current.x += (mouseRef.current.x - smoothMouseRef.current.x) * 0.08;
      smoothMouseRef.current.y += (mouseRef.current.y - smoothMouseRef.current.y) * 0.08;

      // Timeline interpolation parameters
      const easedCharge = easeInCubic(Math.min(1, t / 0.08));
      const easedEngage = easeOutCubic(Math.max(0, Math.min(1, (t - 0.08) / 0.08)));
      const easedCruise = easeInOutSine(Math.max(0, Math.min(1, (t - 0.16) / 0.36)));
      const easedExit = easeInQuart(Math.max(0, Math.min(1, (t - 0.52) / 0.22)));
      const easedArrival = easeOutQuart(Math.max(0, Math.min(1, (t - 0.74) / 0.26)));

      // Smooth relativistic velocity curve
      let speed;
      if (t < 0.08) speed = 3 + easedCharge * 16;
      else if (t < 0.16) speed = 19 + easedEngage * 65;
      else if (t < 0.52) speed = 84 + Math.sin(t * 10) * 4;
      else if (t < 0.74) speed = 84 - easedExit * 72;
      else speed = 12 * (1 - easedArrival);

      // Low-frequency telemetry updates (avoids React re-rendering overhead)
      if (now - lastTelemetryUpdate > 120) {
        lastTelemetryUpdate = now;
        if (phase === 0) {
          setHudTelemetry({ speedC: `${(0.12 + easedCharge * 0.88).toFixed(2)}c`, warpFactor: 'WF 0.9', status: 'SPOOLING DRIVES' });
        } else if (phase === 1) {
          setHudTelemetry({ speedC: `${(1.0 + easedEngage * 8.5).toFixed(1)}c`, warpFactor: 'WF 4.2', status: 'BREAKTHROUGH' });
        } else if (phase === 2) {
          const wf = (9.2 + Math.sin(t * 12) * 0.4).toFixed(1);
          setHudTelemetry({ speedC: `${(32.4 + Math.sin(t * 8) * 1.8).toFixed(1)}c`, warpFactor: `WF ${wf}`, status: 'WARP CRUISE' });
        } else if (phase === 3) {
          setHudTelemetry({ speedC: `${Math.max(0.1, (12.0 * (1 - easedExit))).toFixed(2)}c`, warpFactor: 'DECEL', status: 'REDSHIFT BRAKE' });
        } else {
          setHudTelemetry({ speedC: '0.00c', warpFactor: 'IDLE', status: 'ORBITAL LOCK' });
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      try {
        // ── 1. Clear Frame (Organic Deep Space Fade) ──
        const isHyperspace = phase >= 1 && phase <= 3;
        ctx.fillStyle = isHyperspace ? 'rgba(2, 4, 10, 0.40)' : 'rgba(2, 4, 10, 0.82)';
        ctx.fillRect(0, 0, w, h);

        // ── 2. Subtle Natural Cockpit Motion & Turbulence ──
        const mx = smoothMouseRef.current.x;
        const my = smoothMouseRef.current.y;
        const parallaxX = mx * 32;
        const parallaxY = my * 22;

        let shakeX = 0;
        let shakeY = 0;
        if (speed > 30) {
          const shakeMag = ((speed - 30) / 70) * 4.5;
          shakeX = (Math.random() - 0.5) * shakeMag;
          shakeY = (Math.random() - 0.5) * shakeMag;
        }

        ctx.save();
        ctx.translate(parallaxX + shakeX, parallaxY + shakeY);

        // ── 3. Relativistic Starfield with Doppler Wavelength Shift ──
        ctx.globalCompositeOperation = 'lighter';
        const fov = 250 + speed * 3.4;
        const stars = starsRef.current;

        for (let i = 0; i < stars.length; i++) {
          const star = stars[i];
          star.z -= speed * 0.95;

          if (star.z <= 4) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 20 + Math.pow(Math.random(), 1.6) * 880;
            star.x = Math.cos(angle) * radius;
            star.y = Math.sin(angle) * radius;
            star.z = 1200 + Math.random() * 250;
          }

          const scale = fov / star.z;
          const px = cx + star.x * scale;
          const py = cy + star.y * scale;

          // Realistic elongation tail along the vector of motion
          const tailZ = star.z + speed * (star.isLeadStreak ? 3.0 : 1.6);
          const tailScale = fov / tailZ;
          const px2 = cx + star.x * tailScale;
          const py2 = cy + star.y * tailScale;

          let alpha = star.alpha * Math.min(1, scale * 2.0) * Math.min(1, star.z / 60);
          if (phase === 4) alpha *= (1 - easedArrival);

          const lineWidth = Math.max(0.5, star.r * scale * (star.isLeadStreak ? 1.8 : 1.1));

          // Natural relativistic Doppler shifts:
          // Spool: star natural temperature -> Jump/Cruise: Blueshifted electric cyan/pure white -> Decel: Redshifted warm amber
          let hue = star.baseHue;
          let sat = star.baseSat;
          let light = star.baseLight;

          if (phase === 1 || phase === 2) {
            hue = 205;
            sat = '50%';
            light = '95%'; // brilliant compressed photon white
          } else if (phase === 3) {
            hue = 205 - easedExit * 170; // 205 down to 35 (warm amber/infrared)
            sat = '90%';
            light = '80%';
          }

          if (alpha > 0.02 && px >= -50 && px <= w + 50 && py >= -50 && py <= h + 50) {
            ctx.beginPath();
            ctx.moveTo(px2, py2);
            ctx.lineTo(px, py);
            ctx.strokeStyle = `hsla(${hue}, ${sat}, ${light}, ${alpha})`;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';

        // ── 4. Natural Singularity Event Horizon Core ──
        if (phase >= 1 && phase <= 3) {
          const coreR = 6 + (speed / 85) * 8;
          ctx.beginPath();
          ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // Soft quantum aura
          const auraR = coreR * 5;
          const auraGrad = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, auraR);
          auraGrad.addColorStop(0, 'rgba(186, 230, 253, 0.45)');
          auraGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = auraGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
          ctx.fill();
        }

        // ── 5. Clean Shockwave Burst at Breakthrough ──
        if (t > 0.08 && t < 0.16) {
          const burstT = (t - 0.08) / 0.08;
          const burstRad = burstT * Math.max(w, h) * 0.75;
          const burstAlpha = Math.sin(burstT * Math.PI) * 0.35;
          ctx.beginPath();
          ctx.arc(cx, cy, burstRad, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(186, 230, 253, ${burstAlpha})`;
          ctx.lineWidth = 4 * (1 - burstT);
          ctx.stroke();
        }

        // ── 6. Arrival Flash & Glide ──
        if (phase === 4 && easedArrival < 0.3) {
          const flashA = (1 - easedArrival / 0.3) * 0.35;
          ctx.fillStyle = `rgba(240, 249, 255, ${flashA})`;
          ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();

        // ── 7. Arrival Terminal Window Automation ──
        const termEl = termRef.current;
        const termContent = termContentRef.current;
        if (termEl && termContent) {
          if (phase === 4 && easedArrival > 0.15) {
            const termOpacity = Math.min(1, (easedArrival - 0.15) / 0.35);
            termEl.style.opacity = termOpacity;
            termEl.style.transform = `scale(${0.95 + easedArrival * 0.05})`;

            const lineProgress = (easedArrival - 0.15) / 0.85;
            const cursorVisible = Math.sin(t * 22) > 0;
            const cursor = `<span class="inline-block w-2 h-3.5 bg-emerald-400 ml-0.5" style="opacity:${cursorVisible ? 1 : 0}"></span>`;

            let html = '';
            if (lineProgress > 0.0) html += `<div><span class="text-emerald-500 font-bold">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Warp field collapsed — sub-light velocity normalized</span></div>`;
            if (lineProgress > 0.2) html += `<div><span class="text-emerald-500 font-bold">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Encrypted SSH multiplexer channels bound</span></div>`;
            if (lineProgress > 0.4) html += `<div><span class="text-emerald-500 font-bold">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Telemetry nodes synchronized &amp; online</span></div>`;
            if (lineProgress > 0.6) html += `<div><span class="text-emerald-500 font-bold">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Target host: root@ssh-monitor [SECURE]</span></div>`;
            if (lineProgress > 0.75) html += `<div class="mt-2 text-emerald-400 font-medium">Welcome back, Commander. Initializing workstation console...</div>`;
            if (lineProgress > 0.9) {
              html += `<div class="mt-3 flex items-center text-xs"><span class="text-emerald-300 font-mono">root@ssh-monitor:~$ </span>${cursor}</div>`;
            }
            termContent.innerHTML = html;
          } else {
            termEl.style.opacity = 0;
          }
        }
      } catch (_) {
        // Animation safety catch
      }

      if (rawT < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        onCompleteRef.current?.();
      }
    };

    animId = requestAnimationFrame(tick);

    const safetyTimeout = setTimeout(() => {
      onCompleteRef.current?.();
    }, TOTAL_DURATION + 1000);

    return () => {
      clearTimeout(safetyTimeout);
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[10001] overflow-hidden bg-[#02040a] select-none flex items-center justify-center cursor-crosshair"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* ── Sci-Fi Holographic Cockpit HUD Overlay (Hardware Accelerated CSS) ── */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-6 md:p-10 font-mono text-[11px] text-cyan-400/80">
        {/* Top telemetry bar */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2.5">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              NAV-LOCK // SYS-01
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">SECTOR: 0x7F.00.1</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="tracking-wider">WARP: <span className="text-cyan-300 font-bold">{hudTelemetry.warpFactor}</span></span>
            <span className="tracking-wider">VEL: <span className="text-cyan-300 font-bold">{hudTelemetry.speedC}</span></span>
          </div>
        </div>

        {/* Center navigation reticle & alignment brackets */}
        <div className="relative flex items-center justify-between px-6 opacity-35">
          <div className="w-5 h-20 border-l-2 border-t-2 border-b-2 border-cyan-400/50 rounded-l" />
          <div className="w-5 h-20 border-r-2 border-t-2 border-b-2 border-cyan-400/50 rounded-r" />
        </div>

        {/* Bottom flight status bar */}
        <div className="flex items-center justify-between border-t border-cyan-500/20 pt-2.5">
          <div className="flex items-center gap-4">
            <span className="text-slate-400">STATUS: <span className="text-emerald-400 font-bold">{hudTelemetry.status}</span></span>
          </div>
          <div className="flex items-center gap-2 text-slate-500 text-[10px]">
            <span>WARP DRIVE ENGAGED</span>
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Terminal window (arrival phase) */}
      <div
        ref={termRef}
        style={{ opacity: 0, transform: 'scale(0.95)' }}
        className="relative z-20 w-[540px] max-w-[92vw] rounded-xl bg-[#080d1a]/95 border border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.22)] overflow-hidden backdrop-blur-md transition-all"
      >
        <div className="h-9 bg-[#0b1222] border-b border-emerald-500/20 px-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/90" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/90" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]/90" />
            <span className="text-[11px] text-slate-400 ml-2 font-mono">root@ssh-monitor: ~ (bash)</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            WARP TRANSITION COMPLETE
          </span>
        </div>
        <div
          ref={termContentRef}
          className="p-5 font-mono text-xs md:text-sm min-h-[110px] leading-relaxed text-slate-200"
        />
      </div>
    </motion.div>
  );
}
