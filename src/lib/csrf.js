/**
 * CSRF protection — HMAC-signed, session-bound double-submit token.
 *
 * Threat model
 * ------------
 * The app authenticates with a cookie (NextAuth JWT). Any state-changing API
 * route is therefore reachable cross-site unless the request carries something
 * an attacker cannot forge or replay.
 *
 * Design
 * ------
 * 1. The server mints `token = <random>.<HMAC(secret, random + userId)>` and
 *    sets it in a JS-readable cookie.
 * 2. The browser reads the cookie and echoes it in the `x-csrf-token` header.
 * 3. The server verifies BOTH:
 *      a. header === cookie          (double submit — an attacker cannot read
 *                                     or set the cookie for our origin), and
 *      b. the HMAC signature matches  (an attacker cannot forge a token even
 *                                     if they can write cookies on a sibling
 *                                     subdomain — no secret, no valid token).
 *
 * Because the HMAC is bound to `userId`, a token minted for one account (or for
 * the anonymous session) cannot be replayed by another authenticated user.
 *
 * Stateless: no server-side store, so it works across restarts and instances.
 *
 * Runtime: Web Crypto only — safe to import from Edge middleware AND Node routes.
 */

import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_ERROR,
} from '@/lib/csrfConstants';

export { CSRF_COOKIE, CSRF_HEADER, CSRF_ERROR };

const encoder = new TextEncoder();
const ANON = 'anon';

/** Unsafe HTTP methods that mutate state and therefore require a token. */
export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths that must stay CSRF-free because they are called by external systems
 * that legitimately never see a token (webhooks, installable agents).
 * These either verify their own signature or use a non-cookie credential.
 */
export const CSRF_EXEMPT_PATTERNS = [
  // NextAuth's own routes enforce their own built-in CSRF token. We exempt
  // only the framework-owned paths — NOT custom routes like /api/auth/register
  // or /api/auth/forgot-password, which are app code and must be protected by
  // our double-submit token. Previously a single /^\/api\/auth(\/|$)/ pattern
  // exempted register too, allowing account creation without a CSRF token.
  /^\/api\/auth\/signin(\/|$)/,
  /^\/api\/auth\/callback(\/|$)/,
  /^\/api\/auth\/session(\/|$)/,
  /^\/api\/auth\/signout(\/|$)/,
  /^\/api\/auth\/providers(\/|$)/,
  /^\/api\/auth\/csrf(\/|$)/,
  /^\/api\/csrf(\/|$)/, // token bootstrap — must be reachable to get a token
  /^\/api\/health(\/|$)/,
  /^\/api\/deploy\/webhook(\/|$)/, // GitHub / Bitbucket (HMAC signature verified in-route)
  /^\/api\/deploy\/telegram(\/|$)/, // Telegram webhook
  /^\/api\/firewall\/agent-sync(\/|$)/, // installed monitor-agent (x-agent-token)
];

function getSecret() {
  // AUTH_SECRET is NextAuth v5's name; ENCRYPTION_KEY is this app's fallback
  // (see authOptions.secret in src/lib/auth.js).
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.ENCRYPTION_KEY ||
    null
  );
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomPart() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time string comparison (length-safe). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Mint a token bound to `userId`.
 * @param {string|null} userId
 * @returns {Promise<string|null>} null when NEXTAUTH_SECRET is not configured
 */
export async function createCsrfToken(userId) {
  const secret = getSecret();
  if (!secret) return null;
  const rand = randomPart();
  const sig = await hmac(secret, `${rand}.${userId || ANON}`);
  return `${rand}.${sig}`;
}

/**
 * Verify a token's signature against `userId`.
 * Does NOT check the header/cookie pair — use `verifyCsrfPair` for that.
 */
export async function verifyCsrfToken(token, userId) {
  const secret = getSecret();
  if (!secret || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [rand, sig] = parts;
  if (!rand || !sig) return false;
  const expected = await hmac(secret, `${rand}.${userId || ANON}`);
  return safeEqual(sig, expected);
}

/**
 * Full double-submit + signature check.
 * @param {string|null} headerToken value of the x-csrf-token header
 * @param {string|null} cookieToken value of the CSRF cookie
 * @param {string|null} userId      session user id the token must be bound to
 */
export async function verifyCsrfPair(headerToken, cookieToken, userId) {
  if (!headerToken || !cookieToken) return false;
  if (!safeEqual(headerToken, cookieToken)) return false;
  return verifyCsrfToken(cookieToken, userId);
}

/** Cookie attributes. Readable by JS by design (double-submit requires it). */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax', // cross-site POSTs never send it; safe for top-level nav
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/**
 * Emergency kill-switch. Set CSRF_ENFORCE=false to downgrade enforcement to a
 * warning (never blocks) if a legitimate client turns out to be incompatible.
 */
export function isCsrfEnforced() {
  return process.env.CSRF_ENFORCE !== 'false';
}

/**
 * Requests carrying an explicit credential are not vulnerable to CSRF:
 * browsers never attach Authorization / api-key headers automatically,
 * so a cross-site page cannot replay them.
 */
export function hasNonCookieCredential(request) {
  return !!(
    request.headers.get('authorization') ||
    request.headers.get('x-agent-token') ||
    request.headers.get('x-api-key')
  );
}

export function isCsrfExemptPath(pathname) {
  return CSRF_EXEMPT_PATTERNS.some((re) => re.test(pathname));
}
