'use client';

import { useEffect, useRef } from 'react';

/**
 * MatrixRain — the hacker classic: a continuous wall of vertical glyph
 * columns. Every column always falls (respawning at the top with a new
 * speed), so there are never lone/stray glyphs floating in empty space —
 * any character you see belongs to a full column with a trail.
 *
 * Transparent-canvas friendly: each column fades its own strip with
 * 'destination-out' — old glyphs dissolve, nothing behind is darkened.
 * Glyphs dim inside `exclude` selector rects (uplink panel, console card)
 * so the rain never fights real text.
 *
 * One canvas, 30fps, DPR-capped, sleeps with the modal/hidden tab.
 * Reduced motion: one static frame of dim columns, no loop.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function MatrixRain({ fps = 30, active = true, reduced = false, density = 0.55, exclude = '', className, style }) {
  const canvasRef = useRef(null);
  const colsRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const FS = 14; // glyph size / column width, CSS px
    const TRAIL = 5; // visible tail length, in rows
    let W = 1;
    let H = 1;
    let rows = 1;

    const rand = (a, b) => a + Math.random() * (b - a);
    const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

    if (!colsRef.current) colsRef.current = [];
    const cols = colsRef.current;

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

    const drawGlyph = (c, row, ch, bright, scale = 1) => {
      const y = row * FS;
      const f = dimAt(c.x, y) * scale;
      if (f <= 0.02) return;
      ctx.font = `${FS - 2}px ui-monospace, "JetBrains Mono", "Cascadia Mono", monospace`;
      ctx.fillStyle = bright ? `rgba(134,239,172,${(0.85 * f).toFixed(3)})` : `rgba(74,222,128,${(0.4 * f).toFixed(3)})`;
      ctx.fillText(ch, c.x, y);
    };

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
        const col = {
          x: cols.length * FS + FS / 2,
          row: rand(-rows * 0.5, rows),
          speed: rand(3.5, 9),
          chars: new Map(), // row -> glyph; stable so redraws don't flicker
        };
        cols.push(col);
      }
      if (cols.length > target) cols.length = target;
      for (let i = 0; i < cols.length; i++) cols[i].x = i * FS + FS / 2;
    };

    const fadeStrip = (c) => {
      // Erase the column's own strip fast enough that anything behind the
      // redraw window is gone within ~0.5s — no lingering ghost letters.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(c.x - FS / 2, 0, FS, H);
      ctx.globalCompositeOperation = 'source-over';
    };

    const stepCol = (c, dt) => {
      fadeStrip(c);
      const prev = Math.floor(c.row);
      c.row += c.speed * dt;
      const cur = Math.floor(c.row);

      // Assign a stable glyph to each new row the head crosses.
      for (let r = prev + 1; r <= cur; r++) {
        if (r >= 1 && !c.chars.has(r)) c.chars.set(r, glyph());
      }

      // Redraw the fixed-length trail: bright head, linear falloff behind.
      // Rows outside the window just decay via fadeStrip — no remnants.
      const from = Math.max(1, cur - TRAIL);
      for (let r = from; r <= cur; r++) {
        if (r > rows) break;
        const ch = c.chars.get(r) || glyph();
        const d = cur - r;
        drawGlyph(c, r, ch, d === 0, d === 0 ? Math.min(1, cur / 4) : Math.max(0, 1 - d * 0.18));
      }

      if (c.chars.size > TRAIL + 24) {
        for (const k of c.chars.keys()) if (k < cur - TRAIL - 8) c.chars.delete(k);
      }

      if (cur > rows + 4) {
        // Continuous wall: respawn at the top immediately, no gaps.
        c.row = -rand(0, 6);
        c.speed = rand(3.5, 9);
        c.chars.clear();
      }
    };

    resize();
    // Fresh columns get an instant tail so the wall is coherent from frame
    // one — never a lone floating head.
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const start = Math.max(1, Math.floor(c.row - TRAIL));
      for (let r = start; r <= Math.min(Math.floor(c.row), rows); r++) {
        const ch = c.chars.has(r) ? c.chars.get(r) : glyph();
        c.chars.set(r, ch);
        drawGlyph(c, r, ch, r === Math.floor(c.row));
      }
    }

    if (reduced) {
      const drawStatic = () => {
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < cols.length; i++) {
          if (Math.random() > density) continue;
          const top = rand(1, Math.max(2, rows - 10));
          const len = rand(4, 12);
          for (let r = top; r < top + len && r <= rows; r++) {
            drawGlyph(cols[i], r, glyph(), r === top);
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

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const raw = now - last;
      if (raw < minFrame) return;
      last = now;
      const dt = Math.min(0.1, raw / 1000);
      excludeRects = (exclude ? exclude.split(',') : [])
        .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
        .filter(Boolean);
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
