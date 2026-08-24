'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

function useIsMobileDevice() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

/* ── Interactive Galaxy/Constellation Background — Infinite Pan ── */
export function GalaxyBackground() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: null, y: null });
  const isMobile = useIsMobileDevice();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isMobile) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const starColors = [
      'rgba(173, 210, 255',
      'rgba(240, 248, 255',
      'rgba(255, 250, 220',
      'rgba(255, 200, 160',
      'rgba(255, 180, 180',
      'rgba(224, 231, 255',
    ];

    const generateStar = (layer) => {
      let panSpeed, drift, sizeMin, sizeMax;
      if (layer === 'background') {
        panSpeed = 0.06; drift = 0.02; sizeMin = 0.15; sizeMax = 0.6;
      } else if (layer === 'midground') {
        panSpeed = 0.22; drift = 0.05; sizeMin = 0.6; sizeMax = 1.3;
      } else {
        panSpeed = 0.55; drift = 0.10; sizeMin = 1.3; sizeMax = 2.2;
      }
      return {
        x: Math.random() * w * 4,
        y: Math.random() * h * 4,
        size: Math.random() * (sizeMax - sizeMin) + sizeMin,
        colorPrefix: starColors[Math.floor(Math.random() * starColors.length)],
        panSpeed,
        drift,
        brightness: Math.random() * 0.6 + 0.4,
        twinkleSpeed: 0.01 + Math.random() * 0.03,
        twinkleOffset: Math.random() * Math.PI * 2,
        hasSpikes: layer === 'foreground' && Math.random() > 0.6,
      };
    };

    const stars = [
      ...Array.from({ length: 200 }, () => generateStar('background')),
      ...Array.from({ length: 80 }, () => generateStar('midground')),
      ...Array.from({ length: 20 }, () => generateStar('foreground')),
    ];

    const particleCount = Math.min(40, Math.floor((w * h) / 40000));
    const networkNodes = Array.from({ length: particleCount }, () => ({
      x: Math.random() * w * 4,
      y: Math.random() * h * 4,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      size: Math.random() * 1.5 + 1.0,
      brightness: Math.random() * 0.5 + 0.3,
      panSpeed: 0.28,
    }));

    const cam = { x: 0, y: 0 };
    const vel = { x: 0, y: 0 };
    const INERTIA = 0.90;
    const SENSITIVITY = 0.55;

    let lastMouseX = null;
    let lastMouseY = null;
    let animId, frame = 0;

    const handleMouseMove = (e) => {
      if (lastMouseX !== null) {
        vel.x += (e.clientX - lastMouseX) * SENSITIVITY;
        vel.y += (e.clientY - lastMouseY) * SENSITIVITY;
      }
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseLeave = () => {
      lastMouseX = null; lastMouseY = null;
      mouseRef.current = { x: null, y: null };
    };

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResize);

    const draw = () => {
      frame++;

      // ── GPU throttle: render at ~30fps, not 60. Background parallax/twinkle
      // is slow motion — halving the refresh is invisible but halves fill cost.
      // Motion increments are compensated (x2) so speeds stay identical.
      if (frame % 2 === 1) {
        animId = requestAnimationFrame(draw);
        return;
      }
      const STEP = 2;

      ctx.clearRect(0, 0, w, h);

      vel.x *= Math.pow(INERTIA, STEP);
      vel.y *= Math.pow(INERTIA, STEP);
      cam.x += vel.x * STEP;
      cam.y += vel.y * STEP;

      const mouse = mouseRef.current;
      const linkFrame = frame % 8 < STEP; // recompute node-node links every 4th render (~15fps)

      for (const star of stars) {
        const noise = Math.sin(frame * STEP * star.twinkleSpeed + star.twinkleOffset) * 0.7 +
                      Math.cos(frame * STEP * star.twinkleSpeed * 2.3 + star.twinkleOffset) * 0.3;
        const alpha = star.brightness * (0.35 + 0.65 * (0.5 + 0.5 * noise));

        star.y += star.drift * STEP;

        const rx = ((star.x - cam.x * star.panSpeed) % w + w) % w;
        const ry = ((star.y - cam.y * star.panSpeed) % h + h) % h;

        ctx.beginPath();
        ctx.arc(rx, ry, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `${star.colorPrefix}, ${alpha})`;
        ctx.fill();

        if (star.size > 1.2) {
          ctx.beginPath();
          ctx.arc(rx, ry, star.size * 2.8, 0, Math.PI * 2);
          ctx.fillStyle = `${star.colorPrefix}, ${alpha * 0.12})`;
          ctx.fill();
        }

        if (star.hasSpikes && alpha > 0.4) {
          const sp = star.size * 3.5;
          ctx.strokeStyle = `${star.colorPrefix}, ${alpha * 0.22})`;
          ctx.lineWidth = 0.45;
          ctx.beginPath();
          ctx.moveTo(rx - sp, ry); ctx.lineTo(rx + sp, ry);
          ctx.moveTo(rx, ry - sp); ctx.lineTo(rx, ry + sp);
          ctx.stroke();
        }
      }

      for (let i = 0; i < networkNodes.length; i++) {
        const node = networkNodes[i];
        node.x += node.vx * STEP;
        node.y += node.vy * STEP;

        const rx = ((node.x - cam.x * node.panSpeed) % w + w) % w;
        const ry = ((node.y - cam.y * node.panSpeed) % h + h) % h;

        ctx.beginPath();
        ctx.arc(rx, ry, node.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(129, 140, 248, ${node.brightness})`;
        ctx.fill();

        // O(n²) link pass — the heaviest loop on the boot screen. Run it only
        // every 4th render; links move slowly so the pause is imperceptible.
        if (linkFrame) {
          for (let j = i + 1; j < networkNodes.length; j++) {
            const n2 = networkNodes[j];
            const rx2 = ((n2.x - cam.x * n2.panSpeed) % w + w) % w;
            const ry2 = ((n2.y - cam.y * n2.panSpeed) % h + h) % h;
            const dist = Math.hypot(rx - rx2, ry - ry2);
            if (dist < 130) {
              ctx.beginPath();
              ctx.moveTo(rx, ry); ctx.lineTo(rx2, ry2);
              ctx.strokeStyle = `rgba(99,102,241,${(1 - dist / 130) * 0.11})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }

        if (mouse.x !== null) {
          const dist = Math.hypot(rx - mouse.x, ry - mouse.y);
          if (dist < 180) {
            const a = (1 - dist / 180) * 0.28;
            const g = ctx.createLinearGradient(rx, ry, mouse.x, mouse.y);
            g.addColorStop(0, `rgba(99,102,241,${a})`);
            g.addColorStop(1, `rgba(34,211,238,${a * 0.35})`);
            ctx.beginPath();
            ctx.moveTo(rx, ry); ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = g; ctx.lineWidth = 0.7; ctx.stroke();

            ctx.beginPath();
            ctx.arc(rx, ry, node.size * 2.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(99,102,241,${a * 0.18})`; ctx.fill();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />;
}

/* ── Shooting Stars ── */
export function ShootingStars() {
  const canvasRef = useRef(null);
  const isMobile = useIsMobileDevice();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isMobile) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const spawnMeteor = () => {
      const fromLeft = Math.random() > 0.5;
      const angle = (Math.random() * 20 + 25) * (Math.PI / 180);
      const speed = Math.random() * 14 + 8;
      const length = Math.random() * 220 + 100;
      const size   = Math.random() * 1.8 + 0.6;

      const tempRoll = Math.random();
      const hue   = tempRoll > 0.8 ? 28 : tempRoll > 0.6 ? 200 : 220;
      const light = tempRoll > 0.8 ? 90 : 95;

      return {
        x: fromLeft ? -length : Math.random() * w * 0.8,
        y: fromLeft ? Math.random() * h * 0.55 : -length * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length,
        size,
        hue,
        light,
        alpha: 0,
        life: 0,
        maxLife: (length + Math.max(w, h)) / speed / 60,
        sparks: [],
        sparkTimer: 0,
        active: true,
      };
    };

    let meteors = [];
    let nextSpawn = Math.random() * 3 + 1.5;
    let lastTime = null;
    let animId;
    let sframe = 0;

    const draw = (timestamp) => {
      // ── GPU throttle: ~30fps. Physics is dt-based so motion is unchanged;
      // only the fill rate halves.
      if (++sframe % 2 === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }
      if (!lastTime) lastTime = timestamp;
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;

      ctx.clearRect(0, 0, w, h);

      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        meteors.push(spawnMeteor());
        nextSpawn = Math.random() * 5 + 2.5;
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx;
        m.y += m.vy;
        m.life = Math.min(m.life + dt / m.maxLife, 1);

        const fadeIn  = Math.min(m.life / 0.08, 1);
        const fadeOut = m.life > 0.75 ? 1 - ((m.life - 0.75) / 0.25) : 1;
        m.alpha = fadeIn * fadeOut;

        if (m.life >= 1 || m.x > w + 100 || m.y > h + 100) {
          meteors.splice(i, 1);
          continue;
        }

        m.sparkTimer += dt;
        if (m.sparkTimer > 0.025) {
          m.sparkTimer = 0;
          if (Math.random() > 0.35) {
            m.sparks.push({
              x: m.x,
              y: m.y,
              vx: (Math.random() - 0.5) * 2.5 - m.vx * 0.08,
              vy: (Math.random() - 0.5) * 2.5 + m.vy * 0.05,
              life: 0,
              maxLife: Math.random() * 0.5 + 0.2,
              size: Math.random() * 1.2 + 0.3,
            });
          }
        }

        for (let s = m.sparks.length - 1; s >= 0; s--) {
          const sp = m.sparks[s];
          sp.x += sp.vx;
          sp.y += sp.vy;
          sp.vy += 0.04;
          sp.vx *= 0.96;
          sp.life += dt;
          if (sp.life >= sp.maxLife) { m.sparks.splice(s, 1); continue; }

          const sAlpha = (1 - sp.life / sp.maxLife) * m.alpha * 0.55;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.size * (1 - sp.life / sp.maxLife), 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${m.hue}, 80%, ${m.light}%, ${sAlpha})`;
          ctx.fill();
        }

        const tailX = m.x - Math.cos(Math.atan2(m.vy, m.vx)) * m.length;
        const tailY = m.y - Math.sin(Math.atan2(m.vy, m.vx)) * m.length;

        const tailGrad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
        tailGrad.addColorStop(0,   `hsla(${m.hue}, 90%, ${m.light}%, 0)`);
        tailGrad.addColorStop(0.5, `hsla(${m.hue}, 90%, ${m.light}%, ${m.alpha * 0.12})`);
        tailGrad.addColorStop(0.85,`hsla(${m.hue}, 95%, ${m.light}%, ${m.alpha * 0.55})`);
        tailGrad.addColorStop(1,   `hsla(${m.hue}, 100%, 100%,        ${m.alpha * 0.9})`);

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = tailGrad;
        ctx.lineWidth = m.size * 0.9;
        ctx.lineCap = 'round';
        ctx.stroke();

        const haloLen = m.length * 0.45;
        const haloX = m.x - Math.cos(Math.atan2(m.vy, m.vx)) * haloLen;
        const haloY = m.y - Math.sin(Math.atan2(m.vy, m.vx)) * haloLen;

        const haloGrad = ctx.createLinearGradient(haloX, haloY, m.x, m.y);
        haloGrad.addColorStop(0, `hsla(${m.hue}, 80%, ${m.light}%, 0)`);
        haloGrad.addColorStop(1, `hsla(${m.hue}, 80%, ${m.light}%, ${m.alpha * 0.06})`);

        ctx.beginPath();
        ctx.moveTo(haloX, haloY);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = haloGrad;
        ctx.lineWidth = m.size * 8;
        ctx.lineCap = 'round';
        ctx.stroke();

        const corona = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 5);
        corona.addColorStop(0,   `hsla(${m.hue}, 80%, ${m.light}%, ${m.alpha * 0.35})`);
        corona.addColorStop(0.4, `hsla(${m.hue}, 90%, ${m.light}%, ${m.alpha * 0.1})`);
        corona.addColorStop(1,   `hsla(${m.hue}, 90%, ${m.light}%, 0)`);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * 5, 0, Math.PI * 2);
        ctx.fillStyle = corona;
        ctx.fill();

        const core = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 1.5);
        core.addColorStop(0, `hsla(0, 0%, 100%, ${m.alpha})`);
        core.addColorStop(0.5, `hsla(${m.hue}, 80%, ${m.light}%, ${m.alpha * 0.85})`);
        core.addColorStop(1, `hsla(${m.hue}, 90%, ${m.light}%, 0)`);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />;
}

/* ── Nebula Background ── */
export function Nebula() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(124,58,237,0.06) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(6,182,212,0.04) 0%, transparent 50%)',
      }} />
      <motion.div
        className="absolute w-[800px] h-[800px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 60%)', filter: 'blur(60px)', top: '10%', left: '-10%' }}
        animate={{ x: [0, 80, 0], y: [0, 40, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 60%)', filter: 'blur(50px)', bottom: '10%', right: '-5%' }}
        animate={{ x: [0, -60, 0], y: [0, -30, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

/* ── Matrix Rain ── */
export function MatrixRain() {
  const canvasRef = useRef(null);
  const isMobile = useIsMobileDevice();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isMobile) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const fontSize = 14;
    const columns = Math.floor(w / fontSize);
    const drops = Array.from({ length: columns }, () => Math.random() * -100);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;:,.<>?/~`';

    let animId;
    let frame = 0;

    const draw = () => {
      frame++;
      if (frame % 3 !== 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        const brightness = Math.random();
        if (brightness > 0.96) {
          ctx.fillStyle = 'rgba(180, 255, 180, 0.8)';
          ctx.shadowColor = '#4ade80';
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = `rgba(34, 197, 94, ${0.08 + Math.random() * 0.12})`;
          ctx.shadowBlur = 0;
        }

        ctx.fillText(char, x, y);
        ctx.shadowBlur = 0;

        if (y > h && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5 + Math.random() * 0.5;
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 opacity-40" />;
}

/* ── Floating Orb (planet-like) ── */
export function FloatingOrb({ size, x, y, color, delay = 0, hasRing = false }) {
  return (
    <motion.div
      className="absolute pointer-events-none z-0 hidden md:block"
      style={{
        width: size,
        height: size,
        left: x,
        top: y,
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: 0.85,
        scale: 1,
        y: [0, -20, 0],
      }}
      transition={{
        opacity: { delay, duration: 1.2 },
        scale: { delay, duration: 1.2, type: 'spring' },
        y: { delay: delay + 1.2, duration: 8 + Math.random() * 4, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {hasRing && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: size * 2.2,
            height: size * 0.45,
            border: `3px double ${color}40`,
            transform: 'translate(-50%, -50%) rotate(-15deg)',
            boxShadow: `0 0 15px ${color}15`,
            background: 'transparent',
            zIndex: -1,
          }}
        />
      )}
      <div
        className="w-full h-full rounded-full relative overflow-hidden"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${color}ff 0%, ${color}bb 25%, #02020a 80%)`,
          boxShadow: `
            inset -8px -8px 20px rgba(0, 0, 0, 0.98),
            inset 5px 5px 12px rgba(255, 255, 255, 0.3),
            0 0 25px ${color}35
          `,
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 30% 30%, transparent 40%, ${color}20 80%, ${color}45 100%)`,
            mixBlendMode: 'screen',
          }}
        />
      </div>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: `0 0 20px ${color}30`,
          mixBlendMode: 'screen',
        }}
      />
    </motion.div>
  );
}
