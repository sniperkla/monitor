'use client';

import { useState, useEffect } from 'react';
import { TITLE, SCRAMBLE_GLYPHS } from './theme';

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
      className="rise font-mono text-[clamp(1.6rem,6.4vw,2.75rem)] font-extrabold tracking-[0.14em] sm:tracking-[0.2em] text-center uppercase bg-clip-text text-transparent bg-gradient-to-r from-emerald-50 to-emerald-300"
      style={{ animationDelay: `${delay}ms`, minHeight: '1.3em' }}
    >
      {reduced ? TITLE : text || '\u00A0'}
    </h1>
  );
}


export { ScrambleTitle };
