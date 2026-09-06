'use client';

/* Shared constants + one-shot CSS for the landing console. */

import { Terminal, Database, Shield, Server } from 'lucide-react';

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


export { TITLE, SUBTITLE, SCRAMBLE_GLYPHS, CAPABILITIES, SCENES, SCENE_BY_NAME, SCENE_KEYS, CONSOLE_CSS };
