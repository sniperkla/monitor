import { logger } from '@/lib/logger';

/**
 * Login rate limiting & account lockout.
 *
 * Two layers:
 *  - Per-identity (email): 5 failed attempts within 15 min -> 15 min lockout.
 *    Prevents targeted password guessing / credential stuffing on one account.
 *  - Per-IP: 30 failed attempts within 15 min -> 15 min block.
 *    Prevents spraying many accounts from one source.
 *
 * In-memory by design (single-instance deployment); entries self-expire so the
 * map cannot grow unbounded.
 */

const IDENTITY_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 30;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

// key -> { count, windowStart, lockedUntil }
const attempts = new Map();

function getEntry(key) {
  let entry = attempts.get(key);
  const now = Date.now();
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: 0 };
    attempts.set(key, entry);
  }
  return entry;
}

// Periodic cleanup so the map does not grow forever
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (
        now - entry.windowStart > WINDOW_MS &&
        (!entry.lockedUntil || entry.lockedUntil < now)
      ) {
        attempts.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Returns { allowed, retryAfterSec } - call BEFORE verifying credentials.
 */
export function checkLoginAllowed({ email, ip }) {
  ensureCleanup();
  const now = Date.now();
  const keys = [];
  if (email) keys.push(`id:${String(email).trim().toLowerCase()}`);
  if (ip) keys.push(`ip:${ip}`);

  for (const key of keys) {
    const entry = getEntry(key);
    if (entry.lockedUntil && entry.lockedUntil > now) {
      logger.warn(`Login blocked (rate limit) for ${key.split(':')[0]} key`);
      return {
        allowed: false,
        retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Records a FAILED attempt. Call when password verification fails.
 */
export function recordLoginFailure({ email, ip }) {
  const now = Date.now();
  if (email) {
    const entry = getEntry(`id:${String(email).trim().toLowerCase()}`);
    entry.count += 1;
    if (entry.count >= IDENTITY_MAX_FAILURES) {
      entry.lockedUntil = now + LOCKOUT_MS;
      logger.warn(
        `Account lockout triggered (${entry.count} failures): ${email}`
      );
    }
  }
  if (ip) {
    const entry = getEntry(`ip:${ip}`);
    entry.count += 1;
    if (entry.count >= IP_MAX_FAILURES) {
      entry.lockedUntil = now + LOCKOUT_MS;
      logger.warn(`IP login block triggered (${entry.count} failures): ${ip}`);
    }
  }
}

/**
 * Records a SUCCESSFUL login - clears the identity failure counter.
 */
export function recordLoginSuccess({ email }) {
  if (email) attempts.delete(`id:${String(email).trim().toLowerCase()}`);
}
