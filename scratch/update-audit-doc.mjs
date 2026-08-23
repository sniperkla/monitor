import fs from 'fs';
let s = fs.readFileSync('docs/SECURITY_AUDIT.md', 'utf8');
const start = s.indexOf('## Remaining recommendations');
if (start === -1) { console.error('anchor miss'); process.exit(1); }
const hardened = [
  '## Hardening applied (2026-08-23, round 2)',
  '',
  '| Control | Implementation |',
  '|---|---|',
  '| Login rate limiting & lockout | `src/lib/loginRateLimit.js` — 5 failed attempts per email / 30 per IP within 15 min -> 15 min lockout; wired into the credentials `authorize` callback (`src/lib/auth.js`) |',
  '| Hardcoded fallback secret removed | `NEXTAUTH_SECRET` no longer falls back to a committed literal — a predictable secret would allow session-JWT forgery |',
  '| Content-Security-Policy | `default-src \'self\'`, script/style allowlists, `frame-ancestors \'none\'`, `object-src \'none\'`, `base-uri`, `form-action` (next.config.mjs) |',
  '| Permissions-Policy | camera/microphone/geolocation disabled |',
  '| Audit logging | `src/lib/auditLog.js` -> MongoDB `audit_logs` collection, TTL 90 days, fire-and-forget; wired into `rclone.exec`, `deploy.trigger`, `firewall.apply` |',
  '',
  '## Remaining recommendations',
  '',
  '1. **Move relay tokens & rate limits to persistent storage** (Redis or Mongo TTL collections) if you scale beyond one instance.',
  '2. **HTTPS in production** - ensures `__Secure-` cookies apply.',
  '3. **Rotate `NEXTAUTH_SECRET`** periodically; never commit `.env`.',
  '4. **Tighten CSP over time** - currently allows `unsafe-inline`/`unsafe-eval` for scripts (required by Next.js without nonce plumbing); consider nonce-based CSP later.',
  '5. **UI hardening** - fix remaining react-hooks warnings and add E2E tests for critical flows.',
  ''
].join(String.fromCharCode(10));
s = s.slice(0, start) + hardened;
fs.writeFileSync('docs/SECURITY_AUDIT.md', s);
console.log('doc updated');
