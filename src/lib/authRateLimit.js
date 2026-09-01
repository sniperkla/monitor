/**
 * Auth action rate limiting.
 *
 * Complements loginRateLimit.js (which guards the signin credential check).
 * This module guards the OTHER auth endpoints that don't go through the
 * login flow:
 *
 *   - /api/auth/register        — IP-based: caps registrations per IP/window
 *   - /api/auth/verify-email    — IP-based: caps confirm attempts (code
 *                                 brute-force defence) + request attempts
 *   - /api/auth/forgot-password — IP-based: caps requests per IP/window
 *                                 (email spraying defence)
 *   - /api/auth/reset-password  — IP-based: caps reset attempts per IP/window
 *                                 (code brute-force defence)
 *
 * Design:
 *  - In-memory, single-instance (matches loginRateLimit.js).
 *  - Sliding window: count resets when the window expires.
 *  - Periodic cleanup so the map never grows unbounded.
 *  - Returns { allowed, retryAfterSec } so the caller can set a Retry-After
 *    header and a clear error message.
 */

import { logger } from '@/lib/logger';

// Per-action limits: [maxAttempts, windowMs]
const LIMITS = {
  // 5 registrations per IP per 15 min — prevents mass account creation
  register:      { max: 5,  windowMs: 15 * 60 * 1000 },
  // 10 verify-code confirm attempts per IP per 15 min — the code is 6 digits
  // (900k possibilities), so 10 guesses / 15 min makes brute-force infeasible
  verifyCode:    { max: 10, windowMs: 15 * 60 * 1000 },
  // 5 verify-code requests per IP per 15 min — prevents email flooding
  verifyRequest: { max: 5,  windowMs: 15 * 60 * 1000 },
  // 5 forgot-password requests per IP per 15 min — prevents email spraying
  forgotPassword: { max: 5,  windowMs: 15 * 60 * 1000 },
  // 10 reset-password attempts per IP per 15 min — code brute-force defence
  resetPassword: { max: 10, windowMs: 15 * 60 * 1000 },
};

// key -> { count, windowStart }
const attempts = new Map();

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      const limit = LIMITS[key.split(':')[0]];
      if (limit && now - entry.windowStart > limit.windowMs) {
        attempts.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Extract the client IP from a Next.js Request, matching the pattern used
 * elsewhere in the codebase (x-forwarded-for → x-real-ip → 'unknown').
 */
export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
}

/**
 * Check whether an action is allowed for a given IP.
 *
 * @param {string} action  one of the keys in LIMITS
 * @param {string} ip      client IP
 * @returns {{ allowed: boolean, retryAfterSec: number }}
 */
export function checkRateLimit(action, ip) {
  ensureCleanup();
  const limit = LIMITS[action];
  if (!limit) return { allowed: true, retryAfterSec: 0 };

  const key = `${action}:${ip}`;
  const now = Date.now();
  let entry = attempts.get(key);

  if (!entry || now - entry.windowStart > limit.windowMs) {
    entry = { count: 0, windowStart: now };
  }

  entry.count++;
  attempts.set(key, entry);

  if (entry.count > limit.max) {
    const retryAfterSec = Math.ceil((entry.windowStart + limit.windowMs - now) / 1000);
    logger.warn(
      `[rate-limit] ${action} blocked for IP ${ip} (${entry.count}/${limit.max} in window)`
    );
    return { allowed: false, retryAfterSec };
  }

  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Reset the counter for an action+IP. Call on success so a successful action
 * doesn't eat into the budget for failed attempts. (Optional — not all
 * endpoints need this.)
 */
export function resetRateLimit(action, ip) {
  attempts.delete(`${action}:${ip}`);
}
