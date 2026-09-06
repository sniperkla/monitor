'use client';

/* Shared constants + one-shot CSS for the landing console. */

const TITLE = 'SSH MONITOR';
const SUBTITLE = 'Terminal & Server Control Center';
const SCRAMBLE_GLYPHS = '0123456789ABCDEF';

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
  background: linear-gradient(90deg, transparent, rgba(52,211,153,0.7) 35%, rgba(16,185,129,0.4) 65%, transparent);
  box-shadow: 0 0 14px rgba(52,211,153,0.35);
}
.in-view > .sweep { animation: secSweep 1.15s cubic-bezier(0.3, 0, 0.4, 1) 0.2s both; }

/* The active story node glows; idle nodes stay dim (transition smooths
   the handoff between sections — a rare repaint on section change only). */
.dot-active {
  background: #34d399 !important;
  box-shadow: 0 0 12px rgba(52,211,153,0.85) !important;
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
  .sweep { animation: none !important; opacity: 0 !important; }
  .console-card { transform: none; }
}
`;

export { TITLE, SUBTITLE, SCRAMBLE_GLYPHS, CONSOLE_CSS };
