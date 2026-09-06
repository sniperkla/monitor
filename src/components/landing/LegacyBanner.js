'use client';

import { motion } from 'framer-motion';

// Old-school legacy terminal banner — ANSI color text, double-line DOS box.
// Readable at all themes (no ASCII-art font tricks).
//
// The box is a fixed 48-column grid, so it cannot reflow: on a 320px screen
// the glyphs are wider than the terminal column and the right border clips.
// The `boot-banner` class (see BootSequence's CRT_CSS) scales the type down to
// keep the box whole instead. Font size lives there, not here, so the box
// width and the size that fits it stay in one place.
const BOX_W = 46;
const topBot = `${'═'.repeat(BOX_W)}`;

function Row({ children }) {
  return (
    <div className="flex whitespace-pre">
      <span style={{ color: 'rgba(34,211,238,0.45)' }}>║  </span>
      {children}
    </div>
  );
}

export function LegacyBanner({ hovered }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="boot-banner font-mono leading-relaxed mb-3 select-none"
      style={{
        textShadow: '0 0 6px rgba(34,211,238,0.25)',
        animation: hovered ? 'boot-glitch 3s infinite' : 'none',
      }}
    >
      <div className="whitespace-pre" style={{ color: 'rgba(34,211,238,0.45)' }}>{`╔${topBot}╗`}</div>

      <Row>
        <span>
          <span className="font-bold" style={{ color: '#22d3ee', textShadow: '0 0 8px rgba(34,211,238,0.5)' }}>██ SSH</span>
          <span className="font-bold" style={{ color: '#4ade80', textShadow: '0 0 8px rgba(74,222,128,0.5)' }}> MONITOR</span>
          <span> </span>
          <span style={{ color: '#fbbf24' }}>v1.0.0</span>
          {/* Row budget: "║  " (3) + content + pad + "║" (1) = 48, so
              content + pad = 44. "██ SSH MONITOR v1.0.0" is 21 columns, hence
              BOX_W - 23. It was -22, which pushed this row's right border a
              column past the box. */}
          <span style={{ color: 'rgba(34,211,238,0.45)' }}>{' '.repeat(BOX_W - 23)}║</span>
        </span>
      </Row>

      <Row>
        <span>
          <span style={{ color: '#64748b' }}>SECURE SHELL MANAGEMENT SYSTEM</span>
          <span style={{ color: 'rgba(34,211,238,0.45)' }}>{' '.repeat(BOX_W - 32)}║</span>
        </span>
      </Row>

      {/* Status strip inside the box */}
      <Row>
        <span>
          <span style={{ color: '#475569' }}>CPU </span>
          <span style={{ color: '#4ade80' }}>0.42</span>
          <span style={{ color: '#334155' }}> │ </span>
          <span style={{ color: '#475569' }}>MEM </span>
          <span style={{ color: '#fbbf24' }}>1.2G/4G</span>
          <span style={{ color: '#334155' }}> │ </span>
          <span style={{ color: '#475569' }}>NET </span>
          <span style={{ color: '#4ade80' }}>UP</span>
          <span style={{ color: '#334155' }}> │ </span>
          <span style={{ color: '#22c55e', textShadow: '0 0 6px rgba(34,197,94,0.5)' }}>● SECURE</span>
          <span style={{ color: 'rgba(34,211,238,0.45)' }}>{' '.repeat(Math.max(0, BOX_W - 44))}║</span>
        </span>
      </Row>

      <div className="whitespace-pre pb-2" style={{ color: 'rgba(34,211,238,0.45)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{`╚${topBot}╝`}</div>
    </motion.div>
  );
}
