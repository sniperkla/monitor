'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
function easeInCubic(x) { return x * x * x; }
function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
function easeOutQuart(x) { return 1 - Math.pow(1 - x, 4); }
function easeInQuart(x) { return x * x * x * x; }

export function HyperspaceTransition({ onComplete }) {
  const canvasRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const starsRef = useRef([]);
  const rainRef = useRef(null);
  const termRef = useRef(null);
  const termContentRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 }); // -1 to 1 range
  const TOTAL_DURATION = 3500;

  const getPhase = (t) => {
    if (t < 0.07) return 0;  // Charge
    if (t < 0.14) return 1;  // Engage
    if (t < 0.40) return 2;  // Cruise (full speed)
    if (t < 0.60) return 3;  // Exit (deceleration begins)
    return 4;                 // Arrival (long glide to stop)
  };

  useEffect(() => {
    // Spawn stars in a cylinder around the viewer for tunnel effect
    starsRef.current = Array.from({ length: 500 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 50 + Math.random() * 600; // Concentrated closer to center
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: Math.random() * 800 + 50,
        r: Math.random() * 0.8 + 0.2,
        hue: Math.random() > 0.5 ? 230 : Math.random() > 0.4 ? 190 : 275,
        alpha: Math.random() * 0.5 + 0.5,
      };
    });

    const fontSize = 16;
    const cols = Math.floor(window.innerWidth / fontSize);
    rainRef.current = {
      fontSize,
      cols,
      drops: Array.from({ length: cols }, () => Math.random() * -100),
      chars: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01ABCDEF{}[]<>/*+=#@%',
      frame: 0,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx2 = canvas.getContext('2d');
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (rainRef.current) {
        rainRef.current.cols = Math.floor(w / rainRef.current.fontSize);
        rainRef.current.drops = Array.from({ length: rainRef.current.cols }, () => Math.random() * -100);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Mouse-look: track mouse position as -1 to 1
    const handleMouseMove = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', handleMouseMove);

    let animId;
    let startTime = null;

    const tick = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const rawT = elapsed / TOTAL_DURATION;
      const t = Math.min(rawT, 1);
      const phase = getPhase(t);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;

      const easedCharge = easeOutCubic(Math.min(1, t / 0.07));
      const easedEngage = easeOutQuart(Math.min(1, Math.max(0, (t - 0.07) / 0.07)));
      const easedCruise = easeInOutSine(Math.min(1, Math.max(0, (t - 0.14) / 0.26)));
      const easedExit = easeInOutSine(Math.min(1, Math.max(0, (t - 0.40) / 0.20)));
      const easedArrival = easeOutQuart(Math.min(1, Math.max(0, (t - 0.60) / 0.40)));

      // Speed: ramp up → cruise → braking → long glide to stop
      let speed;
      if (t < 0.07) speed = 2 + easedCharge * 14;
      else if (t < 0.14) speed = 16 + easedEngage * 24;
      else if (t < 0.40) speed = 40 + easedCruise * 25;
      else if (t < 0.60) {
        // Braking phase
        speed = 65 - easedExit * 50;
      } else {
        // Arrival: long glide — speed drops very slowly at first, then settles
        // easeOutQuart makes it linger at higher speeds then ease to zero
        speed = 15 * (1 - easedArrival);
      }

      // ── Clear ──
      try {
      ctx.fillStyle = '#01020a';
      ctx.fillRect(0, 0, w, h);

      // ── Mouse-look parallax & High-Speed Warp Shake ──
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      // Smooth lerp for less jitter
      const parallaxX = mx * 30; // max 30px shift
      const parallaxY = my * 20; // max 20px shift
      
      // Calculate high-speed vibration/shake intensity
      let shakeX = 0;
      let shakeY = 0;
      if (speed > 25) {
        const shakeIntensity = ((speed - 25) / 40) * 5.0; // Max 5px shake at max speed (65)
        shakeX = (Math.random() - 0.5) * shakeIntensity;
        shakeY = (Math.random() - 0.5) * shakeIntensity;
      }

      ctx.save();
      ctx.translate(parallaxX + shakeX, parallaxY + shakeY);

      // ── Deep space nebula ──
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 6; i++) {
        const angle = i * (Math.PI / 3) + t * 0.15;
        const radius = 300 + (1 - t * 0.4) * 150;
        const dist = (1 - t * 0.25) * 140 + 30;
        const nX = cx + Math.cos(angle) * dist;
        const nY = cy + Math.sin(angle) * dist;
        const alpha = 0.08 * (phase < 3 ? 1 : (1 - easedExit));
        const hue = i * 50 + 200;
        const grad = ctx.createRadialGradient(nX, nY, 0, nX, nY, radius);
        grad.addColorStop(0, `hsla(${hue}, 80%, 45%, ${alpha})`);
        grad.addColorStop(0.4, `hsla(${hue}, 60%, 30%, ${alpha * 0.4})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';

      // ── Matrix Rain ──
      if (rainRef.current) {
        const rain = rainRef.current;
        rain.frame++;
        const rainAlpha = phase < 3 ? 1 : Math.max(0, 1 - easedExit);
        if (rainAlpha > 0.01) {
          ctx.font = `${rain.fontSize}px monospace`;
          for (let i = 0; i < rain.cols; i++) {
            const char = rain.chars[Math.floor(Math.random() * rain.chars.length)];
            const x = i * rain.fontSize;
            const y = rain.drops[i] * rain.fontSize;

            const brightness = Math.random();
            if (brightness > 0.92) {
              ctx.fillStyle = `rgba(220, 255, 220, ${0.9 * rainAlpha})`;
              ctx.shadowColor = '#4ade80';
              ctx.shadowBlur = 14;
            } else if (brightness > 0.6) {
              ctx.fillStyle = `rgba(80, 255, 80, ${(0.25 + Math.random() * 0.3) * rainAlpha})`;
              ctx.shadowBlur = 0;
            } else {
              ctx.fillStyle = `rgba(34, 197, 94, ${(0.12 + Math.random() * 0.18) * rainAlpha})`;
              ctx.shadowBlur = 0;
            }
            ctx.fillText(char, x, y);
            ctx.shadowBlur = 0;

            if (y > h && Math.random() > 0.97) rain.drops[i] = 0;
            rain.drops[i] += 0.2 + Math.random() * 0.25;
          }
        }
      }

      // ── 3D Stars (flying toward viewer) ──
      ctx.globalCompositeOperation = 'lighter';
      const fov = 200 + speed * 2;
      starsRef.current.forEach((star) => {
        star.z -= speed * 0.7;
        if (star.z <= 5) {
          // Respawn far away in a cylinder
          const angle = Math.random() * Math.PI * 2;
          const radius = 50 + Math.random() * 600;
          star.x = Math.cos(angle) * radius;
          star.y = Math.sin(angle) * radius;
          star.z = 900 + Math.random() * 300;
        }

        // Project 3D → 2D
        const scale = fov / star.z;
        const px = cx + star.x * scale;
        const py = cy + star.y * scale;

        // Tail length proportional to speed
        const tailZ = star.z + speed * 1.2;
        const tailScale = fov / tailZ;
        const px2 = cx + star.x * tailScale;
        const py2 = cy + star.y * tailScale;

        // Brightness: close = bright, far = dim
        let alpha = star.alpha * Math.min(1, scale * 1.5) * Math.min(1, star.z / 50);
        if (phase === 4) alpha *= (1 - easedArrival);

        // Size
        const lineWidth = Math.max(0.3, star.r * scale * 1.2);

        // Color shift
        let hue = star.hue;
        if (phase === 2) hue += easedCruise * 25;
        if (phase === 3) hue += 40 + easedExit * 70;
        if (phase === 4) hue = 50 + easedArrival * 20;

        if (alpha > 0.01) {
          // Streak
          const grad = ctx.createLinearGradient(px2, py2, px, py);
          grad.addColorStop(0, `hsla(${hue}, 90%, 80%, 0)`);
          grad.addColorStop(0.2, `hsla(${hue}, 95%, 88%, ${alpha * 0.3})`);
          grad.addColorStop(1, `hsla(${hue}, 100%, 100%, ${alpha})`);
          ctx.beginPath();
          ctx.moveTo(px2, py2);
          ctx.lineTo(px, py);
          ctx.strokeStyle = grad;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }
      });
      ctx.globalCompositeOperation = 'source-over';

      // ── Vanishing point glow (where you're flying toward) ──
      const glowI = phase === 0 ? easedCharge * 0.5
        : phase === 1 ? 0.5 + easedEngage * 0.3
        : phase === 2 ? 0.8 - easedCruise * 0.1
        : phase === 3 ? 0.7 + easedExit * 0.3
        : 1 - easedArrival;
      if (glowI > 0.01) {
        // Large soft halo
        const haloR = 120 + speed * 2;
        const haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
        haloGrad.addColorStop(0, `rgba(220, 235, 255, ${glowI * 0.3})`);
        haloGrad.addColorStop(0.15, `rgba(180, 200, 255, ${glowI * 0.15})`);
        haloGrad.addColorStop(0.4, `rgba(99, 102, 241, ${glowI * 0.06})`);
        haloGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.fill();

        // Bright hot core
        const coreR = 15 + speed * 0.5;
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
        coreGrad.addColorStop(0, `rgba(255, 255, 255, ${glowI * 0.6})`);
        coreGrad.addColorStop(0.5, `rgba(200, 220, 255, ${glowI * 0.2})`);
        coreGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Lens flare streaks (cruise & exit) ──
      if (phase >= 2 && phase < 4) {
        const flareI = phase === 2 ? easedCruise * 0.3 : (1 - easedExit) * 0.3;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const fAngle = (i / 4) * Math.PI + t * 0.5;
          const fLen = 80 + speed * 2;
          const fX = cx + Math.cos(fAngle) * fLen;
          const fY = cy + Math.sin(fAngle) * fLen;
          const grad = ctx.createLinearGradient(cx, cy, fX, fY);
          grad.addColorStop(0, `rgba(180, 200, 255, ${flareI * 0.4})`);
          grad.addColorStop(0.5, `rgba(99, 102, 241, ${flareI * 0.1})`);
          grad.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(fX, fY);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── Engage flash ──
      if (t > 0.08 && t < 0.16) {
        const flashA = Math.sin(((t - 0.08) / 0.08) * Math.PI) * 0.2;
        ctx.fillStyle = `rgba(165, 180, 252, ${flashA})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Exit flash ──
      if (phase === 3) {
        const flashA = Math.sin(easedExit * Math.PI) * 0.35;
        ctx.fillStyle = `rgba(200, 220, 255, ${flashA})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Arrival whiteout ──
      if (phase === 4) {
        const flashA = easedArrival < 0.3
          ? easedArrival / 0.3 * 0.55
          : 0.55 * (1 - (easedArrival - 0.3) / 0.7);
        ctx.fillStyle = `rgba(230, 240, 255, ${flashA})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Chromatic aberration ──
      if (phase >= 2 && phase < 4) {
        const abI = phase === 2 ? easedCruise * 0.06 : (1 - easedExit) * 0.06;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 40, 40, ${abI})`;
        ctx.fillRect(3, 0, w, h);
        ctx.fillStyle = `rgba(40, 40, 255, ${abI})`;
        ctx.fillRect(-3, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── Cinematic vignette ──
      const vigGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.65);
      vigGrad.addColorStop(0, 'transparent');
      vigGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.2)');
      vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Film grain (quarter-res for performance) ──
      const gW = Math.ceil(w / 2);
      const gH = Math.ceil(h / 2);
      const grainData = ctx.createImageData(gW, gH);
      const grainBuf = grainData.data;
      for (let i = 0; i < grainBuf.length; i += 4) {
        if (Math.random() < 0.06) {
          const v = Math.random() * 200;
          grainBuf[i] = v;
          grainBuf[i + 1] = v;
          grainBuf[i + 2] = v;
          grainBuf[i + 3] = Math.floor(Math.random() * 22 + 6);
        }
      }
      // Draw grain to an offscreen canvas then scale onto main
      try {
        if (typeof OffscreenCanvas !== 'undefined') {
          const offscreen = new OffscreenCanvas(gW, gH);
          offscreen.getContext('2d').putImageData(grainData, 0, 0);
          ctx.drawImage(offscreen, 0, 0, w, h);
        } else {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = gW;
          tmpCanvas.height = gH;
          tmpCanvas.getContext('2d').putImageData(grainData, 0, 0);
          ctx.drawImage(tmpCanvas, 0, 0, w, h);
        }
      } catch (e) {
        // Skip grain if canvas fails
      }

      // ── Terminal overlay (arrival phase) ──
      const termEl = termRef.current;
      const termContent = termContentRef.current;
      if (termEl && termContent) {
        if (phase === 4 && easedArrival > 0.2) {
          const termOpacity = Math.min(1, (easedArrival - 0.2) / 0.35);
          const termScale = 0.92 + easedArrival * 0.08;
          termEl.style.opacity = termOpacity;
          termEl.style.transform = `scale(${termScale})`;

          // Progressively reveal lines based on arrival progress
          const lineProgress = (easedArrival - 0.2) / 0.8;
          const cursorVisible = Math.sin(t * 20) > 0;
          const cursor = `<span class="inline-block w-2 h-3.5 bg-emerald-400 ml-0.5" style="opacity:${cursorVisible ? 1 : 0}"></span>`;

          let html = '';
          if (lineProgress > 0.0) html += `<div><span class="text-emerald-500">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Warp drive disengaged</span></div>`;
          if (lineProgress > 0.15) html += `<div><span class="text-emerald-500">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">SSH tunnel established</span></div>`;
          if (lineProgress > 0.3) html += `<div><span class="text-emerald-500">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">Terminal multiplexer online</span></div>`;
          if (lineProgress > 0.45) html += `<div><span class="text-emerald-500">[<span class="text-emerald-400">OK</span>]</span> <span class="text-slate-300">All systems operational</span></div>`;
          if (lineProgress > 0.6) html += `<div class="mt-2 text-emerald-400">Welcome back, root.</div>`;
          if (lineProgress > 0.75) {
            html += `<div class="mt-3 flex items-center"><span class="text-emerald-300">root@ssh-monitor:~$ </span>${cursor}</div>`;
          }
          termContent.innerHTML = html;
        } else {
          termEl.style.opacity = 0;
        }
      }

      // Restore parallax transform
      ctx.restore();
      } catch (e) {
        // If animation crashes on a frame, skip rendering but keep ticking
      }

      // Continue or complete
      if (rawT < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        onCompleteRef.current?.();
      }
    };

    animId = requestAnimationFrame(tick);

    // Hard timeout: complete even if animation crashes on mobile
    const safetyTimeout = setTimeout(() => {
      onCompleteRef.current?.();
    }, TOTAL_DURATION + 2000);

    return () => {
      clearTimeout(safetyTimeout);
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[10001] overflow-hidden bg-[#01020a] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, exit: { duration: 1.2 } }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Terminal (arrival phase) */}
      <div
        ref={termRef}
        style={{ opacity: 0, transform: 'scale(0.9)' }}
        className="relative z-10 w-[500px] max-w-[90vw] rounded-xl bg-[#0a0f1a]/95 border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.15)] overflow-hidden backdrop-blur-md"
      >
        <div className="h-8 bg-[#0d1117] border-b border-emerald-500/20 px-3 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] opacity-80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-80" />
          <span className="text-[10px] text-slate-500 ml-2 font-mono">bash</span>
        </div>
        <div
          ref={termContentRef}
          className="p-4 font-mono text-sm min-h-[60px]"
        />
      </div>
    </motion.div>
  );
}
