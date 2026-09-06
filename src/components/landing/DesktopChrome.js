'use client';

/* The guest landing backdrop: a pure dark gradient with a faint emerald
   horizon glow and a subtle scanline texture. No photo — nothing that can
   read as an artifact. */

export default function DesktopChrome() {
  return (
    <div className="fixed inset-0 z-0" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, #03070c 0%, #04090f 55%, #030b09 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 24% at 50% 96%, rgba(16,185,129,0.07) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
        }}
      />
    </div>
  );
}
