'use client';

import { useEffect, useRef } from 'react';

/**
 * NeuralWeb — a synthetic nervous system behind the story.
 *
 * Anatomy, not just decoration:
 * - capillaries: the drifting node field joined by dim synapse lines
 * - trunks: 2–3 pre-computed chains of nodes crossing the screen, drawn
 *   slightly brighter — most pulses travel along these, like signals down
 *   a nerve
 * - hubs (ganglia): a handful of larger nodes with a thin orbit ring that
 *   pings when a pulse arrives
 * - cascade: every 16–28s one node fires and the excitation propagates
 *   hop-by-hop through its neighbors — a wave of glow with light pulses
 *   hopping the edges. The signature moment; rare by design.
 *
 * One canvas, 30fps, DPR-capped, sleeps while the modal is open or the tab
 * is hidden (`active`). Reduced motion: one static frame of the full
 * anatomy, no loop.
 */
export default function NeuralWeb({ count = 60, fps = 30, active = true, reduced = false, className, style }) {
  const canvasRef = useRef(null);
  const webRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const LINK = 150; // max synapse length in CSS px
    let W = 1;
    let H = 1;
    let elapsed = 0;

    const rand = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;

    // Built once; survives pause/resume so the web never resets.
    if (!webRef.current || webRef.current.nodes.length !== count) {
      const nodes = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        vx: rand(-0.007, 0.007),
        vy: rand(-0.006, 0.006),
        r: rand(0.8, 1.9),
        hue: Math.random() < 0.5 ? '99,102,241' : '34,211,238',
        glow: 0,
        hub: false,
      }));
      // Ganglia: a few hubs, larger, with rings — pulse magnets.
      const hubs = new Set();
      const hubCount = Math.max(2, Math.min(5, Math.floor(count / 12)));
      while (hubs.size < hubCount) hubs.add((Math.random() * count) | 0);
      hubs.forEach((i) => {
        nodes[i].hub = true;
        nodes[i].r = rand(2.4, 3.1);
      });
      webRef.current = {
        nodes,
        pulses: [],
        hubs: [...hubs],
        trunks: [],
        cascadeQueue: [],
        visited: new Set(),
        nextCascadeAt: rand(9, 16),
      };
    }
    const web = webRef.current;
    const { nodes, pulses } = web;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      W = Math.max(1, window.innerWidth);
      H = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Trunks need pixel distances; build them once, on the first resize.
      if (web.trunks.length === 0) buildTrunks();
    };

    // Trunk pathways: greedy nearest-neighbour chains starting from hubs —
    // the backbone the pulses prefer to travel.
    const buildTrunks = () => {
      const trunks = [];
      const used = new Set();
      const trunkCount = Math.max(2, Math.min(3, Math.floor(count / 24)));
      for (let t = 0; t < trunkCount; t++) {
        let cur = web.hubs[t % web.hubs.length];
        if (used.has(cur)) cur = (Math.random() * count) | 0;
        const chain = [cur];
        used.add(cur);
        const targetLen = 5 + ((Math.random() * 4) | 0);
        for (let s = 1; s < targetLen; s++) {
          let best = -1;
          let bestD = 320 * 320;
          for (let i = 0; i < nodes.length; i++) {
            if (used.has(i)) continue;
            const dx = (nodes[i].x - nodes[cur].x) * W;
            const dy = (nodes[i].y - nodes[cur].y) * H;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) {
              bestD = d2;
              best = i;
            }
          }
          if (best === -1) break;
          chain.push(best);
          used.add(best);
          cur = best;
        }
        if (chain.length >= 3) {
          const edges = [];
          for (let s = 0; s < chain.length - 1; s++) edges.push([chain[s], chain[s + 1]]);
          trunks.push(edges);
        }
      }
      web.trunks = trunks;
    };

    const drawEdges = () => {
      ctx.lineWidth = 1;
      // Capillaries
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ax = a.x * W;
        const ay = a.y * H;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = (b.x - a.x) * W;
          const dy = (b.y - a.y) * H;
          const d2 = dx * dx + dy * dy;
          if (d2 >= LINK * LINK) continue;
          const t = 1 - Math.sqrt(d2) / LINK;
          ctx.strokeStyle = `rgba(${a.hue}, ${(t * 0.09).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + dx, ay + dy);
          ctx.stroke();
        }
      }
      // Trunks — brighter, so the anatomy reads
      ctx.strokeStyle = 'rgba(94,234,212,0.13)';
      for (let t = 0; t < web.trunks.length; t++) {
        for (let e = 0; e < web.trunks[t].length; e++) {
          const [ai, bi] = web.trunks[t][e];
          ctx.beginPath();
          ctx.moveTo(nodes[ai].x * W, nodes[ai].y * H);
          ctx.lineTo(nodes[bi].x * W, nodes[bi].y * H);
          ctx.stroke();
        }
      }
    };

    const drawNodes = () => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x = n.x * W;
        const y = n.y * H;
        // Edge fade: nodes crossing the viewport border dissolve instead of
        // being clipped mid-shape (a half-drawn hub reads as an artifact).
        const ef = Math.max(0, Math.min(1, Math.min(x, y, W - x, H - y) / 18));
        if (ef <= 0.02) continue;
        ctx.beginPath();
        ctx.arc(x, y, n.r + n.glow * 1.5, 0, TAU);
        ctx.fillStyle = `rgba(165,180,252,${(Math.min(0.85, (n.hub ? 0.42 : 0.3) + n.glow * 0.5) * ef).toFixed(3)})`;
        ctx.fill();
        if (n.glow > 0.02) {
          ctx.beginPath();
          ctx.arc(x, y, n.r * 3, 0, TAU);
          ctx.fillStyle = `rgba(103,232,249,${(n.glow * 0.25 * ef).toFixed(3)})`;
          ctx.fill();
        }
        // Hub orbit rings removed — a lone circle around a dot read as an
        // artifact, not an anchor. Hubs stay distinct via size + brightness.
      }
    };

    const drawPulses = () => {
      for (let i = 0; i < pulses.length; i++) {
        const p = pulses[i];
        const a = nodes[p.a];
        const b = nodes[p.b];
        const x = (a.x + (b.x - a.x) * p.t) * W;
        const y = (a.y + (b.y - a.y) * p.t) * H;
        const ef = Math.max(0, Math.min(1, Math.min(x, y, W - x, H - y) / 18));
        if (ef <= 0.02) continue;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, TAU);
        ctx.fillStyle = `rgba(125,211,252,${(0.9 * ef).toFixed(3)})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, TAU);
        ctx.fillStyle = `rgba(125,211,252,${(0.18 * ef).toFixed(3)})`;
        ctx.fill();
      }
    };

    // Fire a cascade: one node excites, then the wave hops neighbor to
    // neighbor at fixed intervals, capped so it stays a ripple, not a storm.
    const fireCascade = () => {
      const start = Math.random() < 0.6 ? web.hubs[(Math.random() * web.hubs.length) | 0] : (Math.random() * nodes.length) | 0;
      nodes[start].glow = 1;
      web.visited = new Set([start]);
      web.cascadeQueue = [];
      const n = nodes[start];
      for (let i = 0; i < nodes.length; i++) {
        const dx = (nodes[i].x - n.x) * W;
        const dy = (nodes[i].y - n.y) * H;
        if (dx * dx + dy * dy <= LINK * LINK) {
          web.cascadeQueue.push({ node: i, parent: start, depth: 1, at: elapsed + 0.11 });
        }
      }
    };

    const step = (dt) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < -0.02) n.x = 1.02;
        else if (n.x > 1.02) n.x = -0.02;
        if (n.y < -0.02) n.y = 1.02;
        else if (n.y > 1.02) n.y = -0.02;
        if (n.glow > 0) n.glow = Math.max(0, n.glow - dt * 1.4);
      }

      // Ambient pulses — mostly along trunks, in chain order.
      if (Math.random() < 0.6 && web.trunks.length > 0 && pulses.length < 6) {
        const trunk = web.trunks[(Math.random() * web.trunks.length) | 0];
        const e = trunk[(Math.random() * trunk.length) | 0];
        const forward = Math.random() < 0.5;
        pulses.push({ a: forward ? e[0] : e[1], b: forward ? e[1] : e[0], t: 0, speed: rand(0.7, 1.2) });
      } else if (pulses.length < 4) {
        for (let tries = 0; tries < 8; tries++) {
          const a = (Math.random() * nodes.length) | 0;
          const b = (Math.random() * nodes.length) | 0;
          if (a === b) continue;
          const dx = (nodes[a].x - nodes[b].x) * W;
          const dy = (nodes[a].y - nodes[b].y) * H;
          if (dx * dx + dy * dy < LINK * LINK) {
            pulses.push({ a, b, t: 0, speed: rand(0.5, 1.1) });
            break;
          }
        }
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dt;
        if (p.t >= 1) {
          nodes[p.b].glow = 1;
          pulses.splice(i, 1);
        }
      }

      // The cascade clock.
      if (elapsed >= web.nextCascadeAt) {
        fireCascade();
        web.nextCascadeAt = elapsed + rand(16, 28);
      }
      while (web.cascadeQueue.length && web.cascadeQueue[0].at <= elapsed) {
        const ev = web.cascadeQueue.shift();
        if (web.visited.has(ev.node)) continue;
        web.visited.add(ev.node);
        nodes[ev.node].glow = 1;
        if (pulses.length < 12) {
          pulses.push({ a: ev.parent, b: ev.node, t: 0, speed: rand(1.0, 1.5) });
        }
        if (ev.depth < 3 && web.visited.size < 16) {
          const n = nodes[ev.node];
          for (let i = 0; i < nodes.length; i++) {
            if (web.visited.has(i)) continue;
            const dx = (nodes[i].x - n.x) * W;
            const dy = (nodes[i].y - n.y) * H;
            if (dx * dx + dy * dy <= LINK * LINK) {
              web.cascadeQueue.push({ node: i, parent: ev.node, depth: ev.depth + 1, at: ev.at + 0.11 });
            }
          }
          web.cascadeQueue.sort((a, b) => a.at - b.at);
        }
      }
    };

    resize();

    if (reduced) {
      const drawStatic = () => {
        ctx.clearRect(0, 0, W, H);
        drawEdges();
        drawNodes();
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
      elapsed += dt;
      step(dt);
      ctx.clearRect(0, 0, W, H);
      drawEdges();
      drawNodes();
      drawPulses();
    };

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
  }, [count, fps, active, reduced]);

  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}
