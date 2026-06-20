'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

export function HyperspaceTransition({ onComplete }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const cx = w / 2;
    const cy = h / 2;

    const stars = Array.from({ length: 180 }, () => ({
      angle: Math.random() * Math.PI * 2,
      r: Math.random() * 1.2 + 0.3,
      dist: Math.random() * 60 + 10,
      speed: Math.random() * 12 + 6,
      length: Math.random() * 0.12 + 0.04,
      hue: Math.random() > 0.6 ? 230 : Math.random() > 0.5 ? 190 : 270,
      alpha: Math.random() * 0.35 + 0.15,
    }));

    // Matrix rain columns
    const fontSize = 14;
    const columns = Math.floor(w / fontSize);
    const drops = Array.from({ length: columns }, () => Math.random() * -100);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*_+-=[]{}|;:<>?~`';
    let rainFrame = 0;

    let startTime = null;
    const TOTAL_DURATION = 4000;
    let animId;

    const draw = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / TOTAL_DURATION, 1);

      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const trailOpacity = 0.18 + eased * 0.12;
      ctx.fillStyle = `rgba(2, 3, 14, ${trailOpacity})`;
      ctx.fillRect(0, 0, w, h);

      // Matrix Rain
      rainFrame++;
      if (rainFrame % 2 === 0) {
        ctx.font = `${fontSize}px monospace`;
        for (let i = 0; i < drops.length; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          const brightness = Math.random();
          if (brightness > 0.96) {
            ctx.fillStyle = 'rgba(180, 255, 180, 0.7)';
            ctx.shadowColor = '#4ade80';
            ctx.shadowBlur = 6;
          } else {
            ctx.fillStyle = `rgba(34, 197, 94, ${0.06 + Math.random() * 0.1})`;
            ctx.shadowBlur = 0;
          }
          ctx.fillText(char, x, y);
          ctx.shadowBlur = 0;

          if (y > h && Math.random() > 0.975) drops[i] = 0;
          drops[i] += 0.5 + Math.random() * 0.5;
        }
      }

      if (t >= 1) {
        cancelAnimationFrame(animId);
        onComplete();
        return;
      }

      // Warp streaks
      const warpFactor = Math.pow(eased, 2.2) * 8 + 0.3;
      ctx.globalCompositeOperation = 'lighter';

      for (const star of stars) {
        star.dist += star.speed * warpFactor * 0.016 * 16.67;
        if (star.dist > Math.max(w, h) * 0.85) {
          star.dist = Math.random() * 15 + 3;
          star.angle = Math.random() * Math.PI * 2;
        }

        const x  = cx + Math.cos(star.angle) * star.dist;
        const y  = cy + Math.sin(star.angle) * star.dist;
        const streakLen = Math.max(1.5, star.dist * star.length * warpFactor * 0.6);
        const x2 = cx + Math.cos(star.angle) * (star.dist - streakLen);
        const y2 = cy + Math.sin(star.angle) * (star.dist - streakLen);

        const distFade = Math.min(1, star.dist / 80);
        const timeFade = t > 0.7 ? 1 - ((t - 0.7) / 0.3) : 1;
        const alpha = star.alpha * distFade * timeFade;

        const grad = ctx.createLinearGradient(x2, y2, x, y);
        grad.addColorStop(0, `hsla(${star.hue}, 90%, 80%, 0)`);
        grad.addColorStop(0.6, `hsla(${star.hue}, 90%, 85%, ${alpha * 0.4})`);
        grad.addColorStop(1, `hsla(${star.hue}, 100%, 95%, ${alpha})`);

        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x, y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = star.r * Math.min(1.2, warpFactor * 0.2);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';

      // Central glow
      if (t < 0.75) {
        const glowRadius = 20 + eased * 120;
        const glowAlpha = (1 - eased) * 0.18;
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
        coreGrad.addColorStop(0, `rgba(180, 200, 255, ${glowAlpha})`);
        coreGrad.addColorStop(0.5, `rgba(99, 102, 241, ${glowAlpha * 0.4})`);
        coreGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
        ctx.beginPath();
        ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();
      }

      // Peak flash
      if (t > 0.55 && t < 0.75) {
        const flashT = (t - 0.55) / 0.2;
        const flashAlpha = Math.sin(flashT * Math.PI) * 0.15;
        ctx.fillStyle = `rgba(200, 220, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
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
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-[10001] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, exit: { duration: 1.2 } }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </motion.div>
  );
}
