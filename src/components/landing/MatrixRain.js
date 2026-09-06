'use client';

import { useEffect, useRef } from 'react';

/**
 * MatrixRain — the hacker classic: vertical columns of glyphs falling down
 * the screen, bright head, fading tail.
 *
 * Transparent-canvas friendly: instead of painting a translucent black veil
 * (which would darken the layers behind), each column fades its own strip
 * with 'destination-out' — old glyphs dissolve, nothing behind is touched.
 * Columns drift through run → fade → dormant phases, so the rain breathes
 * rather than hammering every column forever.
 *
 * One canvas, 30fps, DPR-capped, sleeps with the modal/hidden tab.
 * Reduced motion: one static frame of dim columns, no loop.
 */

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEF$#@%&';

function MatrixRain({ fps = 30, active = true, reduced = false, density = 0.55, exclude = '', className, style }) {
  const canvasRef = useRef(null);
  const colsRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const FS = 14; // glyph size / column width, CSS px
    let W = 1;
    let H = 1;
    let rows = 1;

    const rand = (a, b) => a + Math.random() * (b - a);
    const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

    if (!colsRef.current) {
      colsRef.current = [];
    }
    let cols = colsRef.current;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      W = Math.max(1, window.innerWidth);
      H = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rows = Math.ceil(H / FS);

      // Reconcile the column list with the current width (keeps state on
      // resize instead of restarting the rain from scratch).
      const target = Math.max(1, Math.floor(W / FS));
      while (cols.length < target) {
        cols.push({
          x: cols.length * FS + FS / 2,
          row: rand(-rows, rows),
          speed: rand(3.5, 9),
          phase: Math.random() < density ? 'run' : 'dorm',
          timer: rand(0.5, 5),
        });
      }
      if (cols.length > target) cols.length = target;
      for (let i = 0; i < cols.length; i++) cols[i].x = i * FS + FS / 2;
    };

    const fadeStrip = (c) => {
      // Erase a little of the column's own strip — dissolves the tail
      // without painting anything over the layers behind.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(c.x - FS / 2, 0, FS, H);
      ctx.globalCompositeOperation = 'source-over';
    };

    const stepCol = (c, dt) => {
      if (c.phase === 'dorm') {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.phase = 'run';
          c.row = -rand(2, 24);
          c.speed = rand(3.5, 9);
        }
        return;
      }
      if (c.phase === 'fade') {
        fadeStrip(c);
        c.timer -= dt;
        if (c.timer <= 0) {
          // Hard-clear the strip: the 1.2s fade leaves ~15% ghost glyphs that
          // would otherwise sit frozen mid-screen for the whole dormant phase.
          ctx.clearRect(c.x - FS / 2, 0, FS, H);
          c.phase = 'dorm';
          c.timer = rand(1, 5);
        }
        return;
      }
      // run
      fadeStrip(c);
      const prev = Math.floor(c.row);
      c.row += c.speed * dt;
      const cur = Math.floor(c.row);
      for (let r = prev + 1; r <= cur; r++) {
        if (r >= 0 && r <= rows) drawGlyph(c, r, false);
      }
      if (cur >= 1 && cur <= rows) drawGlyphAt(c, cur, true);
      if (cur > rows + 4) {
        c.phase = 'fade';
        c.timer = 1.2;
      }
    };

    resize();

    if (reduced) {
      const drawStatic = () => {
        ctx.clearRect(0, 0, W, H);
        ctx.font = `${FS - 2}px ui-monospace, "JetBrains Mono", monospace`;
        for (let i = 0; i < cols.length; i++) {
          if (Math.random() > density * 0.7) continue;
          const len = 4 + ((Math.random() * 9) | 0);
          const start = (Math.random() * rows) | 0;
          for (let r = start; r < start + len && r < rows; r++) {
            ctx.fillStyle = r === start ? 'rgba(134,239,172,0.55)' : 'rgba(74,222,128,0.22)';
            ctx.fillText(glyph(), cols[i].x, r * FS);
          }
        }
      };
      drawStatic();
      const onResize = () => {
        resize();
        drawStatic();
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let raf = 0;
    let last = performance.now();
    const minFrame = fps >= 58 ? 0 : 1000 / fps;

    // Glyphs dim to near-zero inside excluded UI rects (uplink panel,
    // console card) so the rain never fights real text. Rects refresh every
    // rendered frame (cheap: two selectors).
    let excludeRects = [];
    const dimAt = (x, y) => {
      let f = 1;
      for (let i = 0; i < excludeRects.length; i++) {
        const r = excludeRects[i];
        if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) {
          f = Math.min(f, 0.1);
        }
      }
      return f;
    };
    const drawGlyphAt = (c, row, bright) => {
      const y = row * FS;
      const f = dimAt(c.x, y);
      if (f <= 0.02) return;
      ctx.font = `${FS - 2}px ui-monospace, "JetBrains Mono", "Cascadia Mono", monospace`;
      ctx.fillStyle = bright ? `rgba(134,239,172,${(0.85 * f).toFixed(3)})` : `rgba(74,222,128,${(0.4 * f).toFixed(3)})`;
      ctx.fillText(glyph(), c.x, y);
    };

    const frame = (now) => {
      excludeRects = (exclude ? exclude.split(',') : [])
        .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
        .filter(Boolean);
      raf = requestAnimationFrame(frame);
      const raw = now - last;
      if (raw < minFrame) return;
      last = now;
      const dt = Math.min(0.1, raw / 1000);
      for (let i = 0; i < cols.length; i++) stepCol(cols[i], dt);
    };

    // Pausing clears the canvas — frozen glyphs behind an open modal would
    // read as artifacts.
    if (!active) ctx.clearRect(0, 0, W, H);

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    if (active) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [fps, active, reduced, density, exclude]);

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}

export default MatrixRain;
