'use client';

// ── Shared onboarding spotlight ─────────────────────────────────────────────
// Canonical spotlight design used by ALL onboarding tours (matches SSH Manager):
//   1. Full-viewport SVG mask that dims everything except a rounded hole over
 //      the target element (crisp cutout, no giant box-shadow hacks)
//   2. Pulsing colored ring around the target
//   3. Animated corner brackets for a "focus frame" look

export function SpotlightOverlay({ rect, color, show = true }) {
  if (!rect || !show) return null;

  const pad = 12;
  const R = 14;

  return (
    <>
      {/* SVG mask */}
      <svg style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 999991 }}>
        <defs>
          <mask id="ob-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left - pad} y={rect.top - pad}
              width={rect.width + pad * 2} height={rect.height + pad * 2}
              rx={R} ry={R} fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.85)" mask="url(#ob-mask)" />
      </svg>

      {/* Animated ring */}
      <div style={{
        position: 'fixed',
        top: rect.top - pad - 2,
        left: rect.left - pad - 2,
        width: rect.width + (pad + 2) * 2,
        height: rect.height + (pad + 2) * 2,
        borderRadius: R + 2,
        border: `2px solid ${color}`,
        boxShadow: `0 0 20px ${color}60, inset 0 0 20px ${color}20`,
        zIndex: 999992,
        pointerEvents: 'none',
        animation: 'ob-ring-pulse 2s ease-in-out infinite',
      }} />

      {/* Corner brackets */}
      {[
        { top: rect.top - pad - 6, left: rect.left - pad - 6, borderTop: `3px solid ${color}`, borderLeft: `3px solid ${color}`, borderRadius: '4px 0 0 0' },
        { top: rect.top - pad - 6, left: rect.left + rect.width + pad - 8, borderTop: `3px solid ${color}`, borderRight: `3px solid ${color}`, borderRadius: '0 4px 0 0' },
        { top: rect.top + rect.height + pad - 8, left: rect.left - pad - 6, borderBottom: `3px solid ${color}`, borderLeft: `3px solid ${color}`, borderRadius: '0 0 0 4px' },
        { top: rect.top + rect.height + pad - 8, left: rect.left + rect.width + pad - 8, borderBottom: `3px solid ${color}`, borderRight: `3px solid ${color}`, borderRadius: '0 0 4px 0' },
      ].map((style, i) => (
        <div key={i} style={{ position: 'fixed', width: 16, height: 16, zIndex: 999993, pointerEvents: 'none', ...style }} />
      ))}

      <style>{`
        @keyframes ob-ring-pulse {
          0%, 100% { box-shadow: 0 0 20px ${color}60, inset 0 0 20px ${color}20; }
          50% { box-shadow: 0 0 40px ${color}80, inset 0 0 30px ${color}30; }
        }
      `}</style>
    </>
  );
}

export default SpotlightOverlay;
