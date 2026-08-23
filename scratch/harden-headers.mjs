import fs from 'fs';
let s = fs.readFileSync('next.config.mjs', 'utf8');
if (s.includes('Content-Security-Policy')) { console.log('already present'); process.exit(0); }
const anchor = "          { key: 'X-Robots-Tag', value: 'noai, noimageai' },";
if (!s.includes(anchor)) { console.error('anchor miss'); process.exit(1); }
const csp = [
  `          {`,
  `            key: 'Content-Security-Policy',`,
  `            value: [`,
  `              "default-src 'self'",`,
  `              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",`,
  `              "style-src 'self' 'unsafe-inline'",`,
  `              "img-src 'self' data: blob: https:",`,
  `              "font-src 'self' data:",`,
  `              "connect-src 'self' ws: wss: https:",`,
  `              "frame-ancestors 'none'",`,
  `              "object-src 'none'",`,
  `              "base-uri 'self'",`,
  `              "form-action 'self'",`,
  `            ].join('; '),`,
  `          },`,
  `          {`,
  `            key: 'Permissions-Policy',`,
  `            value: 'camera=(), microphone=(), geolocation=()'`,
  `          },`,
].join(String.fromCharCode(10));
s = s.replace(anchor, anchor + String.fromCharCode(10) + csp);
fs.writeFileSync('next.config.mjs', s);
console.log('headers added');
