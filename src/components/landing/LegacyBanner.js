'use client';

import { motion } from 'framer-motion';

// Old-school legacy terminal banner — ANSI color text, double-line DOS box.
// Readable at all themes (no ASCII-art font tricks).
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
      className="font-mono text-[10px] md:text-[13px] leading-relaxed mb-3 select-none"
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
          <span style={{ color: 'rgba(34,211,238,0.45)' }}>{' '.repeat(BOX_W - 22)}║</span>
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
