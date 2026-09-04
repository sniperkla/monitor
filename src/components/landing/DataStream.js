'use client';

/**
 * DataStream — shared "network" field engine.
 *
 * Renders a perspective-projected volume of hex bytes drifting toward the
 * camera. The login screen runs it idle and dim (a quiet network); the SSH
 * handshake spins it up until the bytes streak past, then settles it again.
 *
 * Why not reuse the old starfield: rendering is cheap, but the *metaphor* was
 * wrong. This is not travel — it is a connection being established, so the
 * moving particles are data, not stars.
 */

import { useEffect, useRef } from 'react';

const TAU = Math.PI * 2;
const HEX = '0123456789ABCDEF';

// Terminal palette — emerald / cyan / teal / slate, all readable on #02040a.
const PALETTE = [
  [52, 211, 153],
  [34, 211, 238],
  [45, 212, 191],
  [148, 163, 184],
];
const PALETTE_W = [0.42, 0.26, 0.14, 0.18];
const PALETTE_TOTAL = PALETTE_W.reduce((a, b) => a + b, 0);

function randHex() {
  return HEX[(Math.random() * 16) | 0] + HEX[(Math.random() * 16) | 0];
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createDataStream(canvas, opts = {}) {
  const cfg = {
    count: opts.count ?? 240,
    focal: opts.focal ?? 720,
    zNear: opts.zNear ?? 26,
    zFar: opts.zFar ?? 1600,
    dprCap: opts.dprCap ?? 1.25,
  };

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  let W = 1;
  let H = 1;
  let cx = 0;
  let cy = 0;
  let halfDiag = 1;
  let dpr = 1;
  let spawnR = 1;
  let time = 0;

  const state = {
    speed: 0, // forward velocity, world units per 60fps frame
    intensity: 0, // 0..1 handshake progress — brightness, streaks, swirl
    tunnel: 0, // 0..1 vortex strength during key exchange
    exposure: 1, // motion-blur length multiplier
    glitch: 0, // 0..1 chromatic split + row displacement
    shake: 0, // px
    roll: 0, // radians
    parallaxX: 0,
    parallaxY: 0,
    fade: 0.9, // frame persistence
    brightness: 1,
    scanlines: 0.35, // CRT scanline opacity
  };

  // ── Element pool ─────────────────────────────────────────────────────────
  // Each element is a 2-char hex byte at a point in a cylindrical volume ahead
  // of the camera. Pre-allocated and recycled — no per-frame allocation.
  const elems = new Array(cfg.count);

  function spawn(el, initial) {
    const angle = Math.random() * TAU;
    // Uniform in a disc (sqrt keeps area uniform, not radius).
    const radius = spawnR * Math.sqrt(Math.random());
    el.x = Math.cos(angle) * radius;
    el.y = Math.sin(angle) * radius;
    el.z = initial
      ? cfg.zNear + Math.random() * (cfg.zFar - cfg.zNear)
      : cfg.zFar * (0.92 + Math.random() * 0.08);
    // Vary the base size so the field does not read as a uniform grid.
    el.size = 8 + Math.pow(Math.random(), 2.2) * 11;
    // Luminosity: many faint, few bright.
    el.mag = 0.22 + Math.pow(Math.random(), 2.0) * 0.78;

    let pick = Math.random() * PALETTE_TOTAL;
    let idx = PALETTE.length - 1;
    for (let i = 0; i < PALETTE.length; i++) {
      pick -= PALETTE_W[i];
      if (pick <= 0) {
        idx = i;
        break;
      }
    }
    el.ci = idx;
    el.glyph = randHex();
    // How many frames until this byte is re-rolled. Data mutates as it flows.
    el.mutateIn = 4 + Math.random() * 26;
    return el;
  }
  for (let i = 0; i < cfg.count; i++) elems[i] = spawn({}, true);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, cfg.dprCap);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    // Resizing resets the 2D context, so the DPR transform must be re-applied.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2;
    cy = H / 2;
    halfDiag = Math.hypot(W, H) * 0.5;
    spawnR = (halfDiag / cfg.focal) * cfg.zFar * 1.25;
  }

  // Scratch outputs for project() — avoids allocating per element per frame.
  let PX = 0;
  let PY = 0;

  function project(x, y, z) {
    // Guard: at/below the near plane an element is behind the camera.
    if (z <= cfg.zNear * 0.5) return false;
    const invz = cfg.focal / z;
    PX = cx + x * invz;
    PY = cy + y * invz;
    return true;
  }

  function frame(dtMs) {
    const s = state;
    const dt = Math.min(2.5, Math.max(0.2, dtMs / 16.6667));
    time += dtMs;

    // 1 — frame persistence. Kept high; the per-element trail does the blur.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(2, 4, 10, ${s.fade})`;
    ctx.fillRect(0, 0, W, H);

    // 2 — structural vibration. Summed resonances read as machinery; plain
    //     random jitter reads as a handheld camera.
    let shakeX = 0;
    let shakeY = 0;
    if (s.shake > 0.01) {
      const v = s.shake;
      const tt = time / 1000;
      shakeX =
        (Math.sin(tt * 11.3) * 0.55 + Math.sin(tt * 23.7) * 0.3 + Math.sin(tt * 41.9) * 0.15) * v +
        (Math.random() - 0.5) * v * 0.35;
      shakeY =
        (Math.cos(tt * 13.1) * 0.5 + Math.cos(tt * 27.3) * 0.28 + Math.cos(tt * 43.3) * 0.14) * v +
        (Math.random() - 0.5) * v * 0.35;
    }

    // Camera roll around the view axis.
    if (s.roll !== 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.roll);
      ctx.translate(-cx, -cy);
    }
    ctx.save();
    if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
    ctx.translate(s.parallaxX, s.parallaxY);

    // Forward travel.
    const travel = s.speed * dt;
    // Trails get longer the faster the stream moves.
    const sweep = travel * s.exposure;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Batch by palette colour so fillStyle is set 4x per frame, not 240x.
    for (let ci = 0; ci < PALETTE.length; ci++) {
      const col = PALETTE[ci];
      let any = false;

      for (let i = 0; i < cfg.count; i++) {
        const el = elems[i];
        if (el.ci !== ci) continue;

        // Re-roll the byte occasionally so the field looks like moving data.
        el.mutateIn -= dt;
        if (el.mutateIn <= 0) {
          el.glyph = randHex();
          el.mutateIn = 4 + Math.random() * 26;
        }

        if (!project(el.x, el.y, el.z)) {
          if (el.z <= cfg.zNear * 0.5) spawn(el, false);
          continue;
        }
        const hx = PX;
        const hy = PY;

        // Cull well off-screen before doing any text work.
        const pad = 60;
        if (hx < -pad || hx > W + pad || hy < -pad || hy > H + pad) {
          el.z -= travel;
          if (el.z <= cfg.zNear) spawn(el, false);
          continue;
        }

        // Depth fade: elements fade in from the far plane, out at the near one.
        const zt = (el.z - cfg.zNear) / (cfg.zFar - cfg.zNear);
        const depth = 0.25 + 0.75 * Math.min(1, zt * 2.4);
        // Perspective size — real projection, not a fake 1/z ramp.
        const px = (el.size * cfg.focal) / el.z;
        const a = el.mag * depth * s.brightness * (0.55 + s.intensity * 0.55);
        if (a < 0.02 || px < 3) {
          el.z -= travel;
          if (el.z <= cfg.zNear) spawn(el, false);
          continue;
        }

        // Motion trail: project one exposure earlier and draw the segment.
        if (sweep > 0.5 && project(el.x, el.y, el.z + sweep)) {
          const tx = PX;
          const ty = PY;
          const dx = tx - hx;
          const dy = ty - hy;
          if (dx * dx + dy * dy > 4) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${(a * 0.3).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.6, px * 0.16);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(hx, hy);
            ctx.stroke();
          }
        }

        ctx.globalCompositeOperation = 'source-over';
        const size = Math.min(26, Math.max(6, px));
        ctx.font = `${size < 11 ? 500 : 400} ${size.toFixed(1)}px var(--font-jetbrains), "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${Math.min(0.92, a).toFixed(3)})`;
        ctx.fillText(el.glyph, hx, hy);
        any = true;

        el.z -= travel;
        if (el.z <= cfg.zNear) spawn(el, false);
      }
      if (any) ctx.globalAlpha = 1;
    }

    ctx.restore();

    // 3 — Forward-glow: the tunnel mouth the bytes are rushing into.
    if (s.tunnel > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const gr = Math.min(W, H) * (0.08 + s.tunnel * 0.2);
      const ahead = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
      ahead.addColorStop(0, `rgba(52, 211, 153, ${(0.09 * s.tunnel).toFixed(3)})`);
      ahead.addColorStop(0.45, `rgba(34, 211, 238, ${(0.035 * s.tunnel).toFixed(3)})`);
      ahead.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = ahead;
      ctx.fillRect(0, 0, W, H);
    }

    // 4 — Glitch: row displacement + chromatic split during key exchange.
    if (s.glitch > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const bands = 3 + ((s.glitch * 7) | 0);
      for (let b = 0; b < bands; b++) {
        if (Math.random() > s.glitch * 0.85) continue;
        const by = Math.random() * H;
        const bh = 2 + Math.random() * (10 + s.glitch * 26);
        const off = (Math.random() - 0.5) * s.glitch * 46;
        ctx.fillStyle = `rgba(34, 211, 238, ${(0.05 + s.glitch * 0.1).toFixed(3)})`;
        ctx.fillRect(off, by, W, bh);
        ctx.fillStyle = `rgba(248, 113, 113, ${(0.035 + s.glitch * 0.07).toFixed(3)})`;
        ctx.fillRect(-off * 0.6, by, W, bh);
      }
    }

    // 5 — Vignette tightens as the tunnel closes in.
    const vig = 0.5 + s.tunnel * 0.3;
    const vg = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(W, H) * (0.26 - s.tunnel * 0.08),
      cx,
      cy,
      halfDiag * (1.05 - s.tunnel * 0.18)
    );
    vg.addColorStop(0, 'rgba(2, 4, 10, 0)');
    vg.addColorStop(1, `rgba(2, 4, 10, ${vig.toFixed(3)})`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 6 — CRT scanlines. Always present, subtle — this is a terminal.
    if (s.scanlines > 0.01) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0, 0, 0, ${(s.scanlines * 0.5).toFixed(3)})`;
      for (let y = 0; y < H; y += 3) {
        ctx.fillRect(0, y, W, 1);
      }
    }

    if (s.roll !== 0) ctx.restore();
  }

  resize();
  return { state, frame, resize, canvas, cfg };
}

/**
 * React wrapper. Owns the rAF loop, resize handling and a per-frame safety net
 * so one bad frame can never kill the animation.
 */
export function DataStreamCanvas({ count = 240, dprCap = 1.25, focal, className, style, onFrame }) {
  const canvasRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ds = createDataStream(canvas, { count, dprCap, focal });
    if (!ds) return undefined;

    let raf = 0;
    // Wall-clock, not accumulated dt: headless Chrome can tick rAF at a
    // different rate than setTimeout, which makes time-driven sequences race.
    const t0 = Date.now();
    let last = performance.now();

    const loop = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      try {
        onFrameRef.current?.(ds, dt, Date.now() - t0);
        ds.frame(dt);
      } catch (_) {
        // A single bad frame must never kill the loop.
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => ds.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [count, dprCap, focal]);

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}

/** Smoothed, normalized pointer position (-1..1). Safe to read every frame. */
export function useSmoothedPointer(smoothing = 0.07) {
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e) => {
      target.current.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      target.current.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };
    const onTouch = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      target.current.x = (t.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      target.current.y = (t.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });

    let raf = 0;
    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * smoothing;
      current.current.y += (target.current.y - current.current.y) * smoothing;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
    };
  }, [smoothing]);

  return current;
}

/** Applies pointer parallax to a plain div. Larger `depth` = closer to camera. */
export function ParallaxLayer({ pointerRef, depth = 1, className, style, children }) {
  const ref = useRef(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const p = pointerRef && pointerRef.current;
      if (el && p) {
        el.style.transform = `translate3d(${(-p.x * 18 * depth).toFixed(2)}px, ${(
          -p.y * 12 * depth
        ).toFixed(2)}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pointerRef, depth]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

/** Soft motes drifting IN FRONT of the content — sells real depth. */
export function ForegroundDust({ count = 14, pointerRef, className }) {
  const nodesRef = useRef([]);
  const motesRef = useRef(null);

  useEffect(() => {
    const reduced = prefersReducedMotion();

    // Built after mount: Math.random() must never run during render.
    if (!motesRef.current || motesRef.current.length !== count) {
      motesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        z: 0.3 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 0.006,
        vy: -0.004 - Math.random() * 0.013,
        size: 3 + Math.random() * 8,
        a: 0.05 + Math.random() * 0.16,
        phase: Math.random() * TAU,
      }));
    }
    const motes = motesRef.current;

    // Size the nodes imperatively so the markup stays static.
    for (let i = 0; i < motes.length; i++) {
      const el = nodesRef.current[i];
      if (!el) continue;
      el.style.width = `${motes[i].size}px`;
      el.style.height = `${motes[i].size}px`;
      el.style.opacity = motes[i].a;
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const tick = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      t += dt;
      const k = reduced ? 0.15 : 1;
      const p = (pointerRef && pointerRef.current) || { x: 0, y: 0 };

      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.x += m.vx * dt * k;
        m.y += m.vy * dt * k;
        if (m.y < -10) {
          m.y = 110;
          m.x = Math.random() * 100;
        }
        if (m.x < -10) m.x = 110;
        if (m.x > 110) m.x = -10;

        const el = nodesRef.current[i];
        if (!el) continue;
        const bob = Math.sin(t * 0.0006 + m.phase) * 7 * m.z;
        const px = p.x * 52 * m.z;
        const py = p.y * 34 * m.z;
        el.style.transform = `translate3d(calc(${m.x.toFixed(2)}vw + ${px.toFixed(
          1
        )}px), calc(${m.y.toFixed(2)}vh + ${(py + bob).toFixed(1)}px), 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count, pointerRef]);

  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            nodesRef.current[i] = el;
          }}
          className="absolute top-0 left-0 block rounded-full will-change-transform"
          style={{
            width: 6,
            height: 6,
            background:
              'radial-gradient(circle, rgba(205,232,255,0.95) 0%, rgba(150,195,255,0.18) 45%, transparent 70%)',
            filter: 'blur(2.5px)',
          }}
        />
      ))}
    </div>
  );
}
