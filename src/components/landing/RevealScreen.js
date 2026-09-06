'use client';

import { signIn } from 'next-auth/react';
import { AnimatePresence } from 'framer-motion';
import {
  Terminal, Shield, Server, Database, Mail, LoaderCircle, Fingerprint,
  ChevronRight, ChevronDown, Lock, BrickWallShield, Bug, CloudCog, Activity,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { DataStreamCanvas, prefersReducedMotion } from './DataStream';
import NeuralWeb from './NeuralWeb';
import { CinematicAuthModal } from './CinematicAuthModal';
import { signInWithPasskey, passkeysSupported } from '@/utils/passkey';

/* ═══════════════════════════════════════════════════════════════════════
   RevealScreen — a scrollable landing story: "one terminal session"

   The page reads as a single SSH session log. The hero is the access
   console; every section below is another command ($ ssh --fleet,
   $ watch --live, …) that documents a real part of the app, and the
   statusline at the bottom follows along as you scroll.

   Resource budget (unchanged philosophy):
   - One rAF loop total: the hex-stream canvas, throttled to 30fps, paused
     when the tab is hidden or the auth modal is open. It reads a scroll-
     velocity ref, so the network "wakes" while you scroll — no re-renders.
   - One passive capture scroll listener, rAF-throttled: writes transforms
     (parallax ghosts, hero fade, progress rail, statusline text) straight
     to the DOM. Zero React state while scrolling. It does no work at all
     when the page is still.
   - One IntersectionObserver: toggles .in-view once per element; every
     reveal, bar growth and typed line after that is pure CSS.
   - Typing, carets, motes, cue bob: CSS keyframes. No WebGL on this page.
   ═══════════════════════════════════════════════════════════════════════ */

const TITLE = 'SSH MONITOR';
const SUBTITLE = 'Terminal & Server Control Center';
const SCRAMBLE_GLYPHS = '0123456789ABCDEF';

const CAPABILITIES = [
  { icon: Terminal, label: 'SSH', color: '#64748b' },
  { icon: Database, label: 'Data', color: '#64748b' },
  { icon: Shield, label: 'Vault', color: '#64748b' },
  { icon: Server, label: 'Deploy', color: '#64748b' },
];

/* ═══ Per-section background scenes ═══
   Every part of the story puts the hex-network field into its own mood,
   and a faint colour wash crossfades behind the content. The scroll
   engine publishes the active scene name; the canvas damps its parameters
   toward that scene every frame, so scrolling between sections melts one
   atmosphere into the next instead of cutting.

   - hero   calm indigo drift — a quiet network, signed out
   - fleet  cyan, faster — sessions opening across the fleet
   - watch  emerald, fast + tunnel glow — metrics streaming through
   - vault  violet, slow + heavy scanlines — locked down, quiet
   - backup amber, steady — bulk transfer in flight
   - agents fuchsia, slightly faster — anomalies being caught
   - grant  pale sky, settling — access granted */
const SCENES = [
  {
    name: 'hero',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 34%, rgba(99,102,241,0.09) 0%, transparent 72%)',
    p: { speed: 1.1, intensity: 0.05, tunnel: 0, exposure: 1, glitch: 0, brightness: 0.5, scanlines: 0.3 },
  },
  {
    name: 'fleet',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 40%, rgba(34,211,238,0.08) 0%, transparent 72%)',
    p: { speed: 1.7, intensity: 0.14, tunnel: 0, exposure: 1.2, glitch: 0, brightness: 0.58, scanlines: 0.26 },
  },
  {
    name: 'watch',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 40%, rgba(52,211,153,0.065) 0%, transparent 72%)',
    p: { speed: 2.3, intensity: 0.22, tunnel: 0.18, exposure: 1.5, glitch: 0, brightness: 0.62, scanlines: 0.22 },
  },
  {
    name: 'vault',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 40%, rgba(129,140,248,0.075) 0%, transparent 72%)',
    p: { speed: 0.45, intensity: 0.06, tunnel: 0, exposure: 1, glitch: 0, brightness: 0.38, scanlines: 0.5 },
  },
  {
    name: 'backup',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 40%, rgba(245,158,11,0.05) 0%, transparent 72%)',
    p: { speed: 1.35, intensity: 0.1, tunnel: 0, exposure: 1, glitch: 0, brightness: 0.55, scanlines: 0.3 },
  },
  {
    name: 'agents',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 40%, rgba(232,121,249,0.055) 0%, transparent 72%)',
    p: { speed: 1.9, intensity: 0.18, tunnel: 0, exposure: 1, glitch: 0, brightness: 0.55, scanlines: 0.35 },
  },
  {
    name: 'grant',
    wash: 'radial-gradient(ellipse 62% 46% at 50% 45%, rgba(125,211,252,0.085) 0%, transparent 72%)',
    p: { speed: 0.9, intensity: 0.1, tunnel: 0.08, exposure: 1, glitch: 0, brightness: 0.55, scanlines: 0.28 },
  },
];
const SCENE_BY_NAME = Object.fromEntries(SCENES.map((s) => [s.name, s]));
const SCENE_KEYS = Object.keys(SCENES[0].p);

/**
 * True when the primary pointer cannot hover — phones, tablets, touch
 * laptops. Gates the tilt/parallax (a drag would leave content stranded at
 * the last offset) and halves the particle field. Resolved in an effect so
 * the first client render still matches the server HTML.
 */
function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouch(window.matchMedia('(hover: none), (pointer: coarse)').matches);
  }, []);
  return touch;
}

/** Pauses the field when the tab is hidden — an unseen canvas is pure waste. */
function useDocumentVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/* ── One-shot CSS: entrance stagger, caret, CSS typing, motes, IO reveals ── */
const CONSOLE_CSS = `
@keyframes riseIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.rise { opacity: 0; animation: riseIn 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) forwards; }

@keyframes caretBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
.caret {
  display: inline-block; width: 9px; height: 1.05em; margin-left: 5px;
  vertical-align: text-bottom; background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
  animation: caretBlink 1.06s step-end infinite;
}

/* Pure-CSS typewriter: monospace means one "ch" unit per character, so a
   width animation with steps(N) is frame-perfect and costs no JavaScript.
   Duration/steps/delay are overridable per element via --td/--sn/--tdel.
   Inside a .io section the animation is held until the section scrolls
   into view. */
@keyframes cssType { to { width: var(--n); } }
.css-type {
  display: inline-block; overflow: hidden; white-space: nowrap;
  vertical-align: bottom; width: 0;
  animation: cssType var(--td, 1.3s) steps(var(--sn, 32), end) var(--tdel, 0ms) forwards;
}
.io:not(.in-view) .css-type { animation: none; }

/* Scroll reveals: the observer only adds a class once; the transition
   below does the actual animating. --d staggers children. */
.io {
  opacity: 0; transform: translateY(26px);
  transition: opacity 0.8s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1);
  transition-delay: var(--d, 0ms);
}
.io.in-view { opacity: 1; transform: translateY(0); }

/* Metric bars grow from zero when their section becomes visible. */
.bar-fill {
  display: block; height: 100%; width: 0; border-radius: 9999px;
  transition: width 1.3s cubic-bezier(0.22, 0.61, 0.36, 1) 0.25s;
}
.in-view .bar-fill { width: var(--w); }

/* Scroll cue bob */
@keyframes cueBob { 0%, 100% { transform: translateY(0); opacity: 0.9; } 50% { transform: translateY(7px); opacity: 0.35; } }
.cue-bob { animation: cueBob 1.8s ease-in-out infinite; }

/* Section scan sweep: a one-shot line that passes over a section the first
   time it scrolls into view — the story "reads" each block as you arrive. */
@keyframes secSweep {
  0%   { top: -2px; opacity: 0; }
  10%  { opacity: 0.55; }
  85%  { opacity: 0.5; }
  100% { top: 100%; opacity: 0; }
}
.sweep {
  position: absolute; left: 0; right: 0; top: -2px; height: 1px;
  opacity: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,0.7) 35%, rgba(129,140,248,0.4) 65%, transparent);
  box-shadow: 0 0 14px rgba(34,211,238,0.35);
}
.in-view > .sweep { animation: secSweep 1.15s cubic-bezier(0.3, 0, 0.4, 1) 0.2s both; }

/* The active story node glows; idle nodes stay dim (transition smooths
   the handoff between sections — a rare repaint on section change only). */
.dot-active {
  background: #22d3ee !important;
  box-shadow: 0 0 12px rgba(34,211,238,0.85) !important;
}

/* Foreground motes: compositor-only drift, negative delays de-sync them. */
@keyframes moteDrift {
  from { transform: translate3d(0, 12vh, 0); opacity: 0; }
  10%  { opacity: var(--mo); }
  90%  { opacity: var(--mo); }
  to   { transform: translate3d(var(--mx), -108vh, 0); opacity: 0; }
}
.mote {
  position: absolute; bottom: -6vh; border-radius: 9999px;
  background: radial-gradient(circle, rgba(205,232,255,0.9) 0%, rgba(150,195,255,0.15) 50%, transparent 75%);
  filter: blur(2px);
  animation: moteDrift linear infinite;
}

.console-card {
  transform: perspective(1200px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))
    translate3d(var(--tx, 0px), var(--ty, 0px), 0);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .rise { animation: none; opacity: 1; }
  .caret { animation: none; }
  .css-type { animation: none !important; width: var(--n) !important; }
  .io { opacity: 1; transform: none; transition: none; }
  .bar-fill { width: var(--w) !important; transition: none; }
  .cue-bob, .mote { animation: none; }
  .sweep { animation: none !important; opacity: 0 !important; }
  .mote { opacity: 0; }
  .console-card { transform: none; }
}
`;

/* ── Title decrypt — a one-shot scramble that resolves left to right ── */
function ScrambleTitle({ reduced, delay }) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (reduced) return undefined;
    let frame = 0;
    const iv = setInterval(() => {
      frame += 1;
      const solved = Math.floor(frame / 2.2);
      let out = '';
      for (let c = 0; c < TITLE.length; c++) {
        if (TITLE[c] === ' ') {
          out += ' ';
        } else if (c < solved) {
          out += TITLE[c];
        } else {
          out += SCRAMBLE_GLYPHS[(Math.random() * SCRAMBLE_GLYPHS.length) | 0];
        }
      }
      setText(out);
      if (solved >= TITLE.length) {
        setText(TITLE);
        clearInterval(iv);
      }
    }, 40);
    return () => clearInterval(iv);
  }, [reduced]);

  return (
    <h1
      className="rise font-mono text-[clamp(1.6rem,6.4vw,2.75rem)] font-extrabold tracking-[0.14em] sm:tracking-[0.2em] text-center uppercase bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-400"
      style={{ animationDelay: `${delay}ms`, minHeight: '1.3em' }}
    >
      {reduced ? TITLE : text || '\u00A0'}
    </h1>
  );
}

/* ── Live uplink — ambient telemetry that never re-renders React ── */
const UPLINK_SCENES = [
  [
    { text: 'ssh monitor@10.0.0.1', type: 'cmd' },
    { text: 'Authenticating... ', type: 'out', suffix: 'OK', sc: '#4ade80' },
    { text: 'Last login: 2h ago from 192.168.1.5', type: 'out' },
    { text: 'uptime', type: 'cmd' },
    { text: ' 14:23:07 up 47 days, load avg: 0.42', type: 'out' },
    { text: 'Disk usage elevated ', type: 'out', suffix: 'WARN', sc: '#eab308' },
  ],
  [
    { text: 'docker ps', type: 'cmd' },
    { text: 'CONTAINER   IMAGE          STATUS', type: 'out' },
    { text: 'a3f2 nginx:alpine    Up 14d', type: 'out' },
    { text: 'b7c1 postgres:16     Up 14d', type: 'out' },
    { text: 'All containers healthy ', type: 'out', suffix: '3/3 RUNNING', sc: '#4ade80' },
  ],
  [
    { text: 'fail2ban-client status sshd', type: 'cmd' },
    { text: 'Currently failed: 2', type: 'out' },
    { text: 'Currently banned: 1', type: 'out' },
    { text: 'Jail active, protecting SSH ', type: 'out', suffix: 'ACTIVE', sc: '#4ade80' },
  ],
  [
    { text: 'vault status', type: 'cmd' },
    { text: 'Seal Type       shamir', type: 'out' },
    { text: 'Sealed          false', type: 'out' },
    { text: 'Vault unsealed and ready ', type: 'out', suffix: 'SECURE', sc: '#4ade80' },
  ],
  [
    { text: 'rclone sync /srv s3:backups', type: 'cmd' },
    { text: 'Transferred: 1.24 GiB (38 MiB/s)', type: 'out' },
    { text: 'Checks: 1042 files, 0 differs', type: 'out' },
    { text: 'Nightly sync complete ', type: 'out', suffix: 'VERIFIED', sc: '#4ade80' },
  ],
  [
    { text: 'mission-control status', type: 'cmd' },
    { text: 'STATION   ORBITAL RELAY 7   NOMINAL', type: 'out' },
    { text: 'DRIVE     HYPERWARP          100%', type: 'out' },
    { text: 'Ready for hyperwarp ', type: 'out', suffix: 'WAITING ON ACCESS', sc: '#22d3ee' },
  ],
];

function pickUplinkScene() {
  return UPLINK_SCENES[Math.floor(Math.random() * UPLINK_SCENES.length)];
}

function LiveUplink({ reduced }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const box = bodyRef.current;
    if (!box) return undefined;

    if (reduced) {
      box.innerHTML = '';
      pickUplinkScene().forEach((line) => {
        if (line.type === 'blank') return;
        const div = document.createElement('div');
        div.className = 'flex items-start';
        div.textContent = (line.type === 'cmd' ? '$ ' : '  ') + line.text + (line.suffix ? ` ${line.suffix}` : '');
        box.appendChild(div);
      });
      return undefined;
    }

    let timer;
    let scene = pickUplinkScene();
    let lineIdx = 0;
    let charIdx = 0;
    let cur = null;

    const appendLine = (line) => {
      const div = document.createElement('div');
      div.className = 'flex items-start';
      const text = document.createElement('span');
      text.className = 'whitespace-pre';
      if (line.type === 'cmd') {
        const prompt = document.createElement('span');
        prompt.className = 'text-emerald-400/80 mr-1 shrink-0';
        prompt.textContent = '$';
        div.append(prompt, text);
      } else {
        div.append(text);
      }
      box.appendChild(div);
      while (box.children.length > 10) box.removeChild(box.firstChild);
      return { div, text };
    };

    const tick = () => {
      if (lineIdx >= scene.length) {
        timer = setTimeout(() => {
          box.style.opacity = '0';
          timer = setTimeout(() => {
            box.innerHTML = '';
            box.style.opacity = '1';
            scene = pickUplinkScene();
            lineIdx = 0;
            charIdx = 0;
            tick();
          }, 450);
        }, 2600);
        return;
      }

      const line = scene[lineIdx];
      if (line.type === 'blank') {
        const { div } = appendLine(line);
        div.style.height = '8px';
        lineIdx += 1;
        charIdx = 0;
        timer = setTimeout(tick, 90);
        return;
      }

      if (charIdx === 0) cur = appendLine(line);
      charIdx += 1;
      cur.text.textContent = line.text.slice(0, charIdx);

      if (charIdx >= line.text.length) {
        if (line.suffix) {
          const badge = document.createElement('span');
          badge.className = 'ml-1.5 font-bold shrink-0';
          badge.style.color = line.sc || '#4ade80';
          badge.textContent = line.suffix;
          cur.div.appendChild(badge);
        }
        lineIdx += 1;
        charIdx = 0;
        timer = setTimeout(tick, line.type === 'cmd' ? 240 : (line.delay || 50));
        return;
      }

      const speed = line.type === 'cmd' ? 14 + Math.random() * 18 : 5 + Math.random() * 8;
      timer = setTimeout(tick, speed);
    };

    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <div className="fixed top-5 left-5 z-[4] pointer-events-none hidden sm:block w-[min(26rem,38vw)]">
      <div
        className="px-3 py-2.5 font-mono text-[9px] leading-relaxed border-l border-slate-600/40"
        style={{
          background:
            'linear-gradient(90deg, rgba(2,4,10,0.68) 0%, rgba(2,4,10,0.28) 74%, transparent 100%)',
          maskImage: 'linear-gradient(90deg, black 0%, black 78%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(90deg, black 0%, black 78%, transparent 100%)',
        }}
      >
        <p className="mb-1.5 text-[8px] tracking-[0.22em] uppercase text-slate-500">Live uplink</p>
        <div ref={bodyRef} style={{ transition: 'opacity 0.4s ease' }} />
      </div>
    </div>
  );
}

/* ── tmux-style statusline; the left-middle slot follows the scroll story ── */
function StatusClock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span suppressHydrationWarning>
      {now ? now.toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--'}
    </span>
  );
}

function Statusline({ cmdRef }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[5] pointer-events-none flex items-center justify-between px-3 sm:px-5 font-mono text-[9px] sm:text-[10px] tracking-wide"
      style={{
        paddingBottom: 'calc(0.35rem + env(safe-area-inset-bottom))',
        background: 'linear-gradient(0deg, rgba(2,4,10,0.85) 0%, rgba(2,4,10,0.45) 70%, transparent 100%)',
      }}
    >
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-emerald-400/80">[0]</span>
        <span>monitor@orbit:~/access*</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <span ref={cmdRef} className="hidden sm:inline text-cyan-300/50">
          auth: PENDING
        </span>
        <span className="text-slate-500">AES-256</span>
        <span className="text-slate-400 tabular-nums">
          <StatusClock />
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════ Scroll engine ═══════════════════
   One capture-phase scroll listener (the scroll root is a fixed div, so
   window listeners never fire), rAF-throttled. Everything is measured in
   content coordinates once and then cheap math per scroll frame. */
function useScrollStory({ motionOff, sceneRef, heroRef, cueRef, railRef, storyRailRef, cmdRef }) {
  useEffect(() => {
    const root = document.querySelector('[data-scroll-root]') || document.scrollingElement;
    if (!root) return undefined;

    let px = []; // parallax ghosts + mocks: { node, speed, docCenter }
    let sections = []; // [{ cmd, docTop }]
    let scenes = []; // [{ name, docTop }]
    let washes = []; // [HTMLElement]
    let dots = []; // [HTMLElement]
    let queued = false;
    let raf = 0;
    let lastActiveCmd = null;

    // offsetTop chains are unreliable here (transformed ancestors become
    // offsetParents in some engines); rects are exact and this page only
    // carries a ≤26px pre-reveal offset on measured nodes.
    const docTop = (node) => node.getBoundingClientRect().top + root.scrollTop;

    const measure = () => {
      px = Array.from(root.querySelectorAll('[data-px]')).map((node) => ({
        node,
        speed: parseFloat(node.dataset.px) || 0.08,
        docCenter: docTop(node) + node.offsetHeight / 2,
      }));
      sections = Array.from(root.querySelectorAll('[data-cmd]'))
        .map((node) => ({ cmd: node.dataset.cmd, docTop: docTop(node) }))
        .sort((a, b) => a.docTop - b.docTop);
      scenes = Array.from(root.querySelectorAll('[data-scene]'))
        .map((node) => ({ name: node.dataset.scene, docTop: docTop(node) }))
        .sort((a, b) => a.docTop - b.docTop);
      washes = Array.from(root.querySelectorAll('[data-wash]'));
      dots = Array.from(root.querySelectorAll('[data-dot]'));
      apply();
    };

    const apply = () => {
      const st = root.scrollTop;
      const vh = window.innerHeight;

      // Hero recedes and docks away: slight lag, fade and a scale step so it
      // reads as depth — the console pulling back as the story takes over.
      if (heroRef.current) {
        const p = Math.min(1, st / vh);
        heroRef.current.style.opacity = Math.max(0, 1 - p * 1.15).toFixed(3);
        heroRef.current.style.transform =
          `translate3d(0, ${(st * 0.3).toFixed(1)}px, 0) scale(${(1 - p * 0.07).toFixed(4)})`;
      }
      if (cueRef.current) {
        cueRef.current.style.opacity = Math.max(0, 1 - st / 220).toFixed(3);
      }

      if (!motionOff) {
        const mid = st + vh / 2;
        for (let i = 0; i < px.length; i++) {
          const it = px[i];
          const rel = it.docCenter - mid;
          if (rel > vh * 1.4 || rel < -vh * 1.4) continue;
          it.node.style.transform = `translate3d(0, ${(rel * it.speed).toFixed(1)}px, 0)`;
        }
      }

      if (railRef.current) {
        const max = Math.max(1, root.scrollHeight - vh);
        railRef.current.style.transform = `scaleY(${Math.min(1, st / max).toFixed(4)})`;
      }

      // The statusline follows the story like a shell prompt would.
      if (cmdRef.current && sections.length) {
        let cur = null;
        for (let i = 0; i < sections.length; i++) {
          if (sections[i].docTop <= st + vh * 0.55) cur = sections[i].cmd;
        }
        const next = cur || 'auth: PENDING';
        if (cmdRef.current.textContent !== next) cmdRef.current.textContent = next;

        // The timeline node of the active section lights up. data-cmd carries
        // the "$ " prompt but data-dot does not, so normalize before matching.
        if (cur !== lastActiveCmd) {
          lastActiveCmd = cur;
          const bare = cur ? cur.replace(/^\$ /, '') : null;
          for (let i = 0; i < dots.length; i++) {
            const on = bare !== null && dots[i].dataset.dot === bare;
            if (dots[i].classList.contains('dot-active') !== on) {
              dots[i].classList.toggle('dot-active', on);
            }
          }
        }
      }

      // Story rail: fills along the timeline between the first and last
      // sections as the reader advances.
      if (storyRailRef.current && scenes.length >= 2) {
        const start = scenes[0].docTop - vh * 0.5;
        const end = scenes[scenes.length - 1].docTop + vh * 0.4;
        const p = Math.min(1, Math.max(0, (st + vh * 0.55 - start) / Math.max(1, end - start)));
        storyRailRef.current.style.transform = `scaleY(${p.toFixed(4)})`;
      }

      // Active scene: publish the name for the canvas, crossfade the washes.
      if (scenes.length) {
        let cur = 'hero';
        for (let i = 0; i < scenes.length; i++) {
          if (scenes[i].docTop <= st + vh * 0.55) cur = scenes[i].name;
        }
        if (sceneRef.current !== cur) sceneRef.current = cur;
        if (!motionOff) {
          for (let i = 0; i < washes.length; i++) {
            const w = washes[i];
            const on = w.dataset.wash === cur ? '1' : '0';
            if (w.style.opacity !== on) w.style.opacity = on;
          }
        }
      }
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(() => {
        queued = false;
        apply();
      });
    };

    // Reveals: one observer, one class, CSS does the rest.
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('in-view');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    root.querySelectorAll('.io').forEach((el) => io.observe(el));

    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', onScroll, { capture: true });
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [motionOff, sceneRef, heroRef, cueRef, railRef, storyRailRef, cmdRef]);
}

/* ── Auth actions — shared by the hero console and the closing CTA ── */
function AuthActions({
  passkeySupported,
  passkeyLoading,
  passkeyError,
  onPasskey,
  onEmail,
  onDemo,
  compact = false,
}) {
  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-2.5'}>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl: '/' })}
        className="relative w-full flex items-center justify-center gap-3 px-5 py-3 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer bg-white text-slate-900 transition-colors duration-200 hover:bg-slate-200 active:bg-slate-300"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
      >
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
        </span>
        <span className="font-semibold tracking-wide text-slate-800">Continue with Google</span>
      </button>

      {passkeySupported && (
        <>
          <button
            type="button"
            onClick={onPasskey}
            disabled={passkeyLoading}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer text-slate-300 transition-colors duration-200 bg-slate-900/60 hover:bg-slate-800/70 border border-slate-700/50 disabled:opacity-60"
          >
            {passkeyLoading ? (
              <LoaderCircle size={15} className="text-slate-400 animate-spin" />
            ) : (
              <Fingerprint size={15} className="text-slate-400" />
            )}
            <span>{passkeyLoading ? 'Verifying Passkey…' : 'Sign in with Passkey'}</span>
          </button>
          {passkeyError && (
            <p className="text-[10px] text-red-400/90 text-center -mt-1">{passkeyError}</p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onEmail}
                  className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold cursor-pointer text-slate-200 transition-colors duration-200 bg-slate-900/60 hover:bg-slate-800/70 border border-slate-700/50 hover:border-slate-500/60"
      >
        <Mail size={14} className="text-cyan-400" />
        <span>Email &amp; Password Login</span>
      </button>

      <button
        type="button"
        onClick={onDemo}
        className="w-full flex items-center justify-center gap-1.5 px-5 py-2 min-h-[40px] rounded-lg text-[11px] font-medium cursor-pointer text-slate-400 hover:text-slate-200 transition-colors bg-white/[0.03] hover:bg-white/[0.07] border border-white/5"
      >
        <span>Continue to Demo Mode</span>
        <ChevronRight size={13} className="opacity-60" />
      </button>
    </div>
  );
}

/* ── Story section primitives ── */
function SectionHead({ cmd, index, title, sub }) {
  const typed = `$ ${cmd}`;
  return (
    <div className="io relative mb-8 sm:mb-10">
      <span
        data-px="0.13"
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 sm:-top-16 right-0 font-mono text-[84px] sm:text-[130px] font-bold leading-none text-white/[0.03] select-none"
      >
        {index}
      </span>
      <div className="flex items-center gap-3 mb-3">
        <span
          data-dot={cmd}
          className="h-2 w-2 rounded-full bg-slate-600 transition-all duration-500"
        />
        {/* The command "executes" as the section arrives: it types itself via
            the CSS typewriter gated by this head's .in-view class. Letter
            spacing is left normal — tracking would break the ch-width math. */}
        <span className="font-mono text-[10px] sm:text-[11px] text-slate-500">
          <span
            className="css-type"
            style={{ '--n': `${typed.length}ch`, '--td': '0.9s', '--sn': typed.length, '--tdel': '150ms' }}
          >
            {typed}
          </span>
          <span className="caret" style={{ width: '6px', height: '0.9em', animationDelay: '1.05s' }} />
        </span>
      </div>
      <h2 className="font-mono text-[clamp(1.25rem,3.4vw,1.9rem)] font-bold text-slate-100 tracking-wide">
        {title}
      </h2>
      <p className="mt-2.5 max-w-xl text-xs sm:text-sm text-slate-400 leading-relaxed">{sub}</p>
    </div>
  );
}

function Ghost({ children, className, speed }) {
  return (
    <span
      data-px={speed}
      aria-hidden="true"
      className={`pointer-events-none absolute font-mono select-none text-white/[0.025] ${className || ''}`}
    >
      {children}
    </span>
  );
}

/* ── Section mocks (pure divs, no images) ── */

const FLEET_TILES = [
  { host: 'web-01', tag: 'nginx', lines: '$ systemctl status nginx\n● active (running) since Mon\n▲ 0 reloads needed' },
  { host: 'db-01', tag: 'postgres', lines: '$ psql -c "select 1"\n?column?\n----------\n1' },
  { host: 'cache-01', tag: 'redis', lines: '$ redis-cli info\nused_memory: 12.4M\nconnected_slaves: 0' },
  { host: 'edge-01', tag: 'caddy', lines: '$ tmux attach -t edge' },
];

function FleetMock() {
  return (
    <div className="io mt-9 grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ '--d': '120ms' }}>
      {FLEET_TILES.map((t, i) => (
        <div
          key={t.host}
          data-px={i % 2 ? '-0.035' : '0.05'}
          className="relative rounded-lg border border-slate-700/50 bg-slate-950/60 p-3.5 font-mono text-[10px] leading-relaxed overflow-hidden"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
            <span className="text-slate-300">{t.host}</span>
            <span className="text-slate-600">· {t.tag}</span>
            <span className="ml-auto text-[8px] tracking-[0.2em] text-slate-600">LIVE</span>
          </div>
          <div className="text-slate-500 whitespace-pre-wrap">{t.lines}</div>
          {i === 3 && (
            <div className="mt-1 text-cyan-300/80">
              <span className="css-type" style={{ '--n': '28ch', '--td': '1.8s', '--sn': 28, '--tdel': '0.5s' }}>
                tail -f /var/log/access.log
              </span>
              <span className="caret" style={{ width: '6px', height: '0.9em' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const METRICS = [
  { k: 'CPU', v: 34 },
  { k: 'MEM', v: 61 },
  { k: 'DISK', v: 68 },
  { k: 'NET', v: 22 },
];

const CONTAINERS = [
  { name: 'nginx:alpine', id: 'a3f2', port: '443→443' },
  { name: 'postgres:16', id: 'b7c1', port: '5432' },
  { name: 'redis:7', id: 'e9d4', port: '6379' },
];

function MonitorMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-slate-500">
          server-monitor · web-01
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] text-emerald-400/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          STREAMING
        </span>
      </div>
      <div className="space-y-3">
        {METRICS.map((m, i) => (
          <div key={m.k} className="flex items-center gap-3" style={{ '--d': `${i * 90}ms` }}>
            <span className="w-9 font-mono text-[9px] text-slate-500">{m.k}</span>
            <span className="bar-track relative flex-1 h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
              <span className="bar-fill" style={{ '--w': `${m.v}%`, background: '#94a3b8', opacity: 0.75 }} />
            </span>
            <span className="w-9 text-right font-mono text-[10px] tabular-nums text-slate-400">
              {m.v}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-1.5">
        {CONTAINERS.map((c) => (
          <div key={c.id} className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
            <span className="text-slate-400">{c.name}</span>
            <span className="text-slate-600">Up 14d · {c.port}</span>
            <span className="ml-auto text-slate-700">{c.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SECURITY_ROWS = [
  { icon: Lock, title: 'Vault', detail: 'AES-256 · Shamir 3-of-5 · unsealed' },
  { icon: BrickWallShield, title: 'Firewall Blocklist', detail: '23 IPs banned · fail2ban jail ACTIVE' },
  { icon: Bug, title: 'Virus Scanner', detail: 'ClamAV sweep 04:00 · 0 threats' },
];

function SecurityMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="space-y-3">
        {SECURITY_ROWS.map((r, i) => (
          <div key={r.title} className="flex items-center gap-3" style={{ '--d': `${i * 110}ms` }}>
            <span className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 bg-slate-800/40 border border-slate-700/40">
              <r.icon size={14} className="text-slate-400" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-200">{r.title}</p>
              <p className="font-mono text-[9px] text-slate-500 truncate">{r.detail}</p>
            </div>
            <span className="ml-auto font-mono text-[8px] tracking-[0.2em] text-emerald-400/70 shrink-0">
              OK
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[10px] text-slate-500">
        <span className="text-emerald-400/80 mr-1.5">$</span>
        <span className="css-type" style={{ '--n': '34ch', '--td': '2.2s', '--sn': 34, '--tdel': '0.4s' }}>
          fail2ban-client set sshd banip 45.33.22.11
        </span>
        <span className="caret" style={{ width: '6px', height: '0.9em' }} />
      </div>
    </div>
  );
}

const BACKUPS = [
  { icon: CloudCog, label: 'Rclone → S3', detail: '1.24 GiB @ 38 MiB/s · verified', v: 100 },
  { icon: Database, label: 'Mongo snapshot', detail: 'daily · oplog tailing', v: 100 },
  { icon: Server, label: 'Bare-metal image', detail: 'weekly · 84% uploading', v: 84 },
];

function BackupMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="space-y-4">
        {BACKUPS.map((b, i) => (
          <div key={b.label} style={{ '--d': `${i * 110}ms` }}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <b.icon size={13} className="text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-200">{b.label}</span>
              <span className="ml-auto font-mono text-[9px] text-slate-500 tabular-nums">{b.detail}</span>
            </div>
            <span className="bar-track flex h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
              <span className="bar-fill" style={{ '--w': `${b.v}%`, background: '#94a3b8', opacity: 0.75 }} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[10px] text-slate-500">
        <span className="text-emerald-400/80 mr-1.5">cron</span>
        <span className="css-type" style={{ '--n': '30ch', '--td': '1.9s', '--sn': 30, '--tdel': '0.4s' }}>
          0 4 * * * backup --all --verify
        </span>
        <span className="caret" style={{ width: '6px', height: '0.9em' }} />
      </div>
    </div>
  );
}

const AGENTS = [
  { name: 'Hermes Agent', status: 'IDLE', color: '#64748b', logo: '/agents/hermes.png' },
  { name: 'Nanobot', status: 'WATCHING', color: '#4ade80', logo: '/agents/nanobot.svg' },
  { name: 'OpenClaw', status: 'IDLE', color: '#64748b', logo: '/agents/openclaw.png' },
  { name: 'ZeroClaw', status: 'IDLE', color: '#64748b', logo: '/agents/zeroclaw.jpg' },
];

function AgentMock() {
  return (
    <div className="io mt-9 rounded-xl border border-slate-700/50 bg-slate-950/60 p-4 sm:p-5" data-px="0.045">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {AGENTS.map((a, i) => (
          <div
            key={a.name}
            className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
            style={{
              '--d': `${i * 80}ms`,
              borderColor: 'rgba(100,116,139,0.28)',
              background: 'rgba(15,23,42,0.45)',
            }}
          >
            {/* Real agent artwork from /public/agents, same assets the app uses */}
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-black/40 border border-white/5 shrink-0 overflow-hidden">
              <img src={a.logo} alt="" className="w-[18px] h-[18px] object-contain" loading="lazy" />
            </span>
            <span className="text-[10px] font-semibold text-slate-300 truncate">{a.name}</span>
            <span
              className="ml-auto font-mono text-[7px] tracking-[0.18em]"
              style={{ color: a.color }}
            >
              {a.status}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-black/40 border border-slate-800/80 p-3 font-mono text-[10px] leading-relaxed">
        <p className="flex items-center gap-1.5 text-[8px] tracking-[0.22em] uppercase text-slate-600 mb-2">
          <img src="/agents/nanobot.svg" alt="" className="w-3 h-3 object-contain opacity-70" loading="lazy" />
          nanobot · task log
        </p>
        <p className="text-slate-500">&gt; tail -f /var/log/auth.log</p>
        <p className="text-amber-300/80">&gt; anomaly: 5 failed ssh · 45.33.22.11</p>
        <p className="text-slate-500">
          &gt; action: banip + report{' '}
          <span className="css-type text-emerald-400/90" style={{ '--n': '9ch', '--td': '1s', '--sn': 9, '--tdel': '1.2s' }}>
            … done ✓
          </span>
          <span className="caret" style={{ width: '5px', height: '0.85em' }} />
        </p>
      </div>
    </div>
  );
}

/* ── Main Reveal Screen ── */
export function RevealScreen({ onDismiss }) {
  const [reduced] = useState(() => prefersReducedMotion());
  const isTouch = useIsTouch();
  const docVisible = useDocumentVisible();
  const motionOff = reduced || isTouch;

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'register' | 'forgot' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [name, setName] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);

  const [passkeySupported] = useState(() => (typeof window !== 'undefined' ? passkeysSupported() : false));
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState(null);

  const cardRef = useRef(null);
  const heroRef = useRef(null);
  const cueRef = useRef(null);
  const railRef = useRef(null);
  const storyRailRef = useRef(null);
  const cmdRef = useRef(null);
  const sceneRef = useRef('hero');
  // Live canvas parameters — damped toward the active scene every frame,
  // which is what makes one atmosphere melt into the next.
  const sceneCurRef = useRef({ ...SCENES[0].p });

  /* Pointer tilt on the hero card: CSS variables from a rAF-throttled
     pointermove. No idle loop — work happens only while the pointer moves. */
  useEffect(() => {
    if (motionOff) return undefined;
    const el = cardRef.current;
    if (!el) return undefined;

    let raf = 0;
    let queued = false;
    let px = 0;
    let py = 0;

    const apply = () => {
      queued = false;
      el.style.setProperty('--rx', `${(-py * 1.4).toFixed(3)}deg`);
      el.style.setProperty('--ry', `${(px * 1.8).toFixed(3)}deg`);
      el.style.setProperty('--tx', `${(-px * 7).toFixed(2)}px`);
      el.style.setProperty('--ty', `${(-py * 5).toFixed(2)}px`);
    };
    const onMove = (e) => {
      px = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      py = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      if (!queued) {
        queued = true;
        raf = requestAnimationFrame(apply);
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [motionOff]);

  useScrollStory({ motionOff, sceneRef, heroRef, cueRef, railRef, storyRailRef, cmdRef });

  const handlePasskeySignIn = async () => {
    setPasskeyError(null);
    setPasskeyLoading(true);
    try {
      await signInWithPasskey({ callbackUrl: '/' });
    } catch (err) {
      setPasskeyError(err.message || 'Passkey sign-in failed.');
      setPasskeyLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        if (!email || !password || !confirmPassword) {
          setAuthError('Please fill in all required fields.');
          setAuthLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setAuthError('Passphrases do not match. Please verify your password.');
          setAuthLoading(false);
          return;
        }

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Registration failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Account registered! Verification code sent to your email.');
        setAuthMode('verify');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'verify') {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'confirm',
            email: email.trim().toLowerCase(),
            code: verifyCodeInput,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Email verification failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Email verified successfully! You can now sign in.');
        setAuthMode('signin');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'forgot') {
        if (!email) {
          setAuthError('Please enter your email address.');
          setAuthLoading(false);
          return;
        }
        if (!resetCode) {
          const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          const data = await res.json();
          if (!data.success) {
            setAuthError(data.error || 'Failed to send password reset code.');
            setAuthLoading(false);
            return;
          }
          setAuthSuccess('Password reset code sent to your email. Please enter it below.');
          setAuthLoading(false);
          return;
        }

        if (!newPassword) {
          setAuthError('Please enter your new password.');
          setAuthLoading(false);
          return;
        }
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: resetCode,
            newPassword,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Failed to reset password.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Password reset successfully! You can now sign in.');
        setAuthMode('signin');
        setResetCode('');
        setNewPassword('');
        setAuthLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setAuthError(
          result.error === 'CredentialsSignin' ? 'Invalid email or password' : result.error
        );
        setAuthLoading(false);
      } else if (result?.ok) {
        window.location.href = result.url || '/';
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please try again.');
      setAuthLoading(false);
    }
  };

  const fieldActive = !showAuthModal && docVisible;
  const authProps = {
    passkeySupported,
    passkeyLoading,
    passkeyError,
    onPasskey: handlePasskeySignIn,
    onEmail: () => setShowAuthModal(true),
    onDemo: onDismiss,
  };

  return (
    // Horizontal overflow (tilt, ghosts) is clipped; vertical scrolling
    // belongs to the parent wrapper ([data-scroll-root]).
    <div className="relative w-full overflow-x-hidden bg-black">
      <style>{CONSOLE_CSS}</style>

      {/* ── The one animated layer: a quiet hex-byte network, 30fps, paused
              while the modal is open or the tab is hidden. Its mood follows
              the active story scene only — never the scroll itself. ── */}
      <DataStreamCanvas
        className="fixed inset-0 z-0 block"
        count={motionOff ? 55 : 120}
        fps={30}
        active={fieldActive}
        onFrame={(ds, dt) => {
          const s = ds.state;

          // Damp toward the active scene: the background morphs between
          // section moods instead of switching. Exponential damping is
          // framerate-independent, so the melt looks the same at any fps.
          // Deliberately independent of scroll velocity — the field never
          // reacts to the wheel, only to where you are in the story.
          const target = motionOff ? SCENES[0].p : (SCENE_BY_NAME[sceneRef.current] || SCENES[0]).p;
          const cur = sceneCurRef.current;
          const k = 1 - Math.exp(-dt / 550);
          for (let i = 0; i < SCENE_KEYS.length; i++) {
            const key = SCENE_KEYS[i];
            cur[key] += (target[key] - cur[key]) * k;
          }

          s.speed = motionOff ? 0.3 : cur.speed;
          s.intensity = cur.intensity;
          s.tunnel = cur.tunnel;
          s.exposure = cur.exposure;
          s.glitch = cur.glitch;
          s.fade = 0.9;
          s.brightness = cur.brightness;
          s.scanlines = cur.scanlines;
          s.parallaxX = 0;
          s.parallaxY = 0;
          s.shake = 0;
          s.roll = 0;
        }}
      />

      {/* Static light: vignette + horizon glow + faint grid. Painted once. */}
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 30%, rgba(2,4,10,0.55) 0%, rgba(2,4,10,0.25) 55%, rgba(2,4,10,0) 80%),' +
            'radial-gradient(ellipse 45% 26% at 50% 100%, rgba(34,211,238,0.05) 0%, transparent 70%),' +
            'repeating-linear-gradient(0deg, rgba(148,163,184,0.025) 0 1px, transparent 1px 56px),' +
            'repeating-linear-gradient(90deg, rgba(148,163,184,0.025) 0 1px, transparent 1px 56px)',
        }}
      />

      {/* Synthetic nervous system: sparse nodes, dim synapses, occasional
          pulses — sits above the static light so the scene washes tint it.
          30fps, sleeps with the modal/tab; one frozen frame under
          reduced motion. */}
      <NeuralWeb
        className="fixed inset-0 z-[1] block"
        count={motionOff ? 36 : 64}
        active={fieldActive}
        reduced={motionOff}
      />

      {/* Per-section colour washes. Fixed, painted once, crossfaded by the
          scroll engine via opacity only — compositor work, no repaint. */}
      <div className="fixed inset-0 z-[1] pointer-events-none" aria-hidden="true">
        {SCENES.map((scene) => (
          <div
            key={scene.name}
            data-wash={scene.name}
            className="absolute inset-0"
            style={{ background: scene.wash, opacity: scene.name === 'hero' ? 1 : 0, transition: 'opacity 1.6s ease' }}
          />
        ))}
      </div>

      <LiveUplink reduced={motionOff} />

      {/* Session progress rail (right edge) */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 z-[5] hidden md:block h-44 w-px bg-white/10 pointer-events-none">
        <span
          ref={railRef}
          className="block w-px h-full bg-slate-400/70 origin-top"
          style={{ transform: 'scaleY(0)' }}
        />
      </div>

      {/* ═══ Hero — the access console ═══ */}
      <div
        ref={heroRef}
        data-scene="hero"
        className="relative z-10 min-h-[100dvh] flex flex-col items-center will-change-transform"
      >
        <div
          className="m-auto w-full flex flex-col items-center px-4 sm:px-6"
          style={{
            paddingTop: 'calc(3rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
          }}
        >
          <div
            ref={cardRef}
            className="console-card rise relative w-full max-w-md rounded-xl border border-slate-700/60 overflow-hidden"
            style={{
              animationDelay: '120ms',
              background: 'rgba(3, 7, 15, 0.72)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            {/* Etched hardware traces — static circuit art so the console
                reads as a physical device. Pure SVG, no animation. */}
            <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
              <svg className="absolute top-2.5 right-3 w-24 h-20" viewBox="0 0 96 80" fill="none">
                <path d="M96 6 H64 L54 16 H40" stroke="rgba(34,211,238,0.15)" strokeWidth="1" />
                <path d="M96 18 H70 L58 30 H48" stroke="rgba(129,140,248,0.11)" strokeWidth="1" />
                <circle cx="40" cy="16" r="2" stroke="rgba(34,211,238,0.3)" strokeWidth="1" />
                <circle cx="48" cy="30" r="2" stroke="rgba(129,140,248,0.24)" strokeWidth="1" />
              </svg>
              <svg className="absolute bottom-2.5 left-3 w-24 h-20 rotate-180" viewBox="0 0 96 80" fill="none">
                <path d="M96 6 H64 L54 16 H40" stroke="rgba(34,211,238,0.13)" strokeWidth="1" />
                <path d="M96 18 H70 L58 30 H48" stroke="rgba(129,140,248,0.1)" strokeWidth="1" />
                <circle cx="40" cy="16" r="2" stroke="rgba(34,211,238,0.26)" strokeWidth="1" />
                <circle cx="48" cy="30" r="2" stroke="rgba(129,140,248,0.2)" strokeWidth="1" />
              </svg>
            </div>

            {/* Title bar */}
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-700/50 bg-slate-900/60">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
              </span>
              <span className="flex-1 text-center font-mono text-[9px] sm:text-[10px] text-slate-500 tracking-wider truncate">
                monitor@orbit — /access
              </span>
              <span className="font-mono text-[9px] text-slate-600">ssh:22</span>
            </div>

            <div className="px-5 sm:px-7 pt-6 pb-6 sm:pb-7">
              <div className="rise flex items-center gap-2 mb-4" style={{ animationDelay: '260ms' }} aria-hidden="true">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-[0.26em] text-emerald-300/60">
                  Access gateway online
                </span>
              </div>

              <ScrambleTitle reduced={motionOff} delay={320} />

              <div
                // No letter-spacing on this line: the CSS typewriter sizes
                // itself in `ch` units, which exclude tracking — any
                // letter-spacing here would clip the last few characters
                // behind the overflow mask.
                className="rise mt-2.5 mb-5 flex items-baseline font-mono text-[10px] sm:text-[11px] text-slate-400 min-h-[16px]"
                style={{ animationDelay: '480ms' }}
              >
                <span className="text-emerald-400/80 mr-1.5">&gt;</span>
                <span className="css-type uppercase" style={{ '--n': '32ch', '--tdel': '1.35s' }}>
                  {SUBTITLE}
                </span>
                <span className="caret" style={{ animationDelay: '1.35s' }} />
              </div>

              <div
                className="rise mb-5 h-px bg-slate-500/15"
                style={{ animationDelay: '560ms' }}
              />

              <div className="rise" style={{ animationDelay: '640ms' }}>
                <AuthActions {...authProps} compact />
              </div>

              <div className="rise mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2" style={{ animationDelay: '760ms' }}>
                {CAPABILITIES.map((cap) => (
                  <span key={cap.label} className="flex items-center gap-1.5" title={cap.label}>
                    <cap.icon size={13} style={{ color: cap.color }} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                      {cap.label}
                    </span>
                  </span>
                ))}
              </div>

              <p className="rise mt-5 text-center text-[9px] sm:text-[10px] text-slate-500 leading-relaxed" style={{ animationDelay: '860ms' }}>
                Login to sync settings, connections, and vault across devices.
              </p>
            </div>
          </div>
        </div>

        {/* Scroll cue */}
        <div
          ref={cueRef}
          className="cue absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none"
        >
          <span className="font-mono text-[8px] tracking-[0.34em] uppercase text-slate-500">
            scroll
          </span>
          <span className="cue-bob">
            <ChevronDown size={15} className="text-slate-500" />
          </span>
        </div>
      </div>

      {/* ═══ The session log — scroll story ═══ */}
      <div className="relative z-10">
        {/* Timeline rail connecting every section (desktop) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[27px] top-0 bottom-0 hidden md:block w-px"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.16) 6%, rgba(34,211,238,0.16) 94%, transparent 100%)',
          }}
        />

        {/* ── 01 · SSH fleet ── */}
        <section data-cmd="$ ssh --fleet" data-scene="fleet" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="ssh --fleet"
            index="01"
            title="Every machine. One glass."
            sub="Open a live terminal to any box in your fleet straight from the browser — SSH sessions, tmux panes, files and logs, no local client required."
          />
          <FleetMock />
        </section>

        {/* ── 02 · Server monitor ── */}
        <section data-cmd="$ watch --live" data-scene="watch" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="watch --live"
            index="02"
            title="Metrics without the noise."
            sub="Server Monitor streams CPU, memory, disk and network next to container health — one calm view that tells you before it breaks."
          />
          <MonitorMock />
        </section>

        {/* ── 03 · Vault & security ── */}
        <section data-cmd="$ vault --audit" data-scene="vault" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="vault --audit"
            index="03"
            title="Locked down by default."
            sub="An encrypted vault for every credential, a firewall blocklist fed by fail2ban, scheduled ClamAV sweeps, and passkey-first sign-in."
          />
          <SecurityMock />
        </section>

        {/* ── 04 · Backups ── */}
        <section data-cmd="$ backup --sync" data-scene="backup" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="backup --sync"
            index="04"
            title="Backups that run themselves."
            sub="Rclone cloud sync, MongoDB snapshots and full server images on a cron — scheduled, verified, one click to restore."
          />
          <BackupMock />
        </section>

        {/* ── 05 · AI agents ── */}
        <section data-cmd="$ agent --spawn" data-scene="agents" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 py-20 sm:py-28">
          <span className="sweep" aria-hidden="true" />
          <SectionHead
            cmd="agent --spawn"
            index="05"
            title="AI agents on watch."
            sub="Spawn Hermes, Nanobot, OpenClaw or ZeroClaw on your servers. Agents watch logs, run repairs and report back while you sleep."
          />
          <AgentMock />
        </section>

        {/* ═══ Closing CTA ═══ */}
        <section data-cmd="$ access --grant" data-scene="grant" className="io story-sec relative mx-auto w-full max-w-3xl px-5 sm:px-8 pt-10 pb-24 sm:pb-28">
          <span className="sweep" aria-hidden="true" />
          <div className="io mx-auto w-full max-w-md rounded-xl border border-slate-700/60 overflow-hidden bg-slate-950/70" style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-700/50 bg-slate-900/60">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
              </span>
              <span className="flex-1 text-center font-mono text-[9px] sm:text-[10px] text-slate-500 tracking-wider">
                monitor@orbit — ~/access
              </span>
              <Activity size={12} className="text-slate-600" />
            </div>
            <div className="px-5 sm:px-7 py-6 sm:py-7">
              <p className="font-mono text-[10px] text-slate-500 mb-2">
                <span className="text-slate-600">$</span> access --grant
              </p>
              <h2 className="font-mono text-xl sm:text-2xl font-bold text-slate-100 tracking-wide">
                Ready when you are.
              </h2>
              <p className="mt-2 mb-6 text-xs sm:text-sm text-slate-400 leading-relaxed">
                Sign in and your terminals, vault and fleet light up. Your first
                server is sixty seconds away.
              </p>
              <AuthActions {...authProps} />
            </div>
          </div>
        </section>

        <footer className="relative pb-14 pt-2 text-center">
          <p className="font-mono text-[9px] tracking-[0.24em] uppercase text-slate-600">
            SSH Monitor — terminal &amp; server control
          </p>
          <p className="mt-1.5 font-mono text-[8px] text-slate-700">
            session closed · [0] exit 0
          </p>
        </footer>
      </div>

      {/* CSS-only motes drifting in front of everything */}
      <div className="fixed inset-0 z-[6] pointer-events-none overflow-hidden" aria-hidden="true">
        {[
          { left: '8%', size: 5, dur: 26, delay: -4, mx: '6vw', mo: 0.14 },
          { left: '24%', size: 3, dur: 34, delay: -17, mx: '-4vw', mo: 0.1 },
          { left: '55%', size: 4, dur: 30, delay: -9, mx: '5vw', mo: 0.12 },
          { left: '72%', size: 6, dur: 24, delay: -21, mx: '-6vw', mo: 0.15 },
          { left: '90%', size: 3, dur: 38, delay: -13, mx: '3vw', mo: 0.09 },
        ].map((m, i) => (
          <span
            key={i}
            className="mote"
            style={{
              left: m.left,
              width: m.size,
              height: m.size,
              animationDuration: `${m.dur}s`,
              animationDelay: `${m.delay}s`,
              '--mx': m.mx,
              '--mo': m.mo,
            }}
          />
        ))}
      </div>

      <Statusline cmdRef={cmdRef} />

      {/* ── Cinematic Email & Password Authentication Modal ── */}
      <AnimatePresence>
        {showAuthModal && (
          <CinematicAuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
            authMode={authMode}
            setAuthMode={setAuthMode}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            name={name}
            setName={setName}
            resetCode={resetCode}
            setResetCode={setResetCode}
            verifyCodeInput={verifyCodeInput}
            setVerifyCodeInput={setVerifyCodeInput}
            authLoading={authLoading}
            authError={authError}
            setAuthError={setAuthError}
            authSuccess={authSuccess}
            setAuthSuccess={setAuthSuccess}
            handleAuthSubmit={handleAuthSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
