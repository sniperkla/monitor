import fs from 'fs';
const NL = String.fromCharCode(10);
let s = fs.readFileSync('src/context/OSContext.js', 'utf8');

if (s.includes('isMobileViewport')) { console.log('already patched'); process.exit(0); }

// Match the whole newWindow construction block (tolerant of trailing spaces)
const re = /const newWindow = \{[\s\S]*?zIndex: nextZIndex\s*\};/;
const m = s.match(re);
if (!m) { console.error('newWindow block not found'); process.exit(1); }

const replacement = [
  '      // Mobile: open windows fullscreen; desktop: cascade but never exceed viewport',
  '      const vw = typeof window !== \'undefined\' ? window.innerWidth : 1280;',
  '      const vh = typeof window !== \'undefined\' ? window.innerHeight : 800;',
  '      const isMobileViewport = vw < 768;',
  '',
  '      const newWindow = {',
  '        ...action.payload,',
  '        x: isMobileViewport ? 0 : (action.payload.x ?? Math.min(defaultX, Math.max(0, vw - 320))),',
  '        y: isMobileViewport ? 0 : (action.payload.y ?? defaultY),',
  '        width: isMobileViewport ? vw : Math.min(action.payload.width ?? 800, vw - 20),',
  '        height: isMobileViewport ? vh - 60 : Math.min(action.payload.height ?? 600, vh - 80),',
  '        isMinimized: false,',
  '        // On phones/tablets every app opens fullscreen - floating windows are unusable',
  '        isMaximized: isMobileViewport ? true : !!action.payload.isMaximized,',
  '        zIndex: nextZIndex',
  '      };'
].join(NL);

s = s.replace(re, replacement);
fs.writeFileSync('src/context/OSContext.js', s);
console.log('OSContext patched');
