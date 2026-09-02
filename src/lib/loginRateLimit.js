import { logger } from '@/lib/logger';
import { incrementCounter, readCounter, resetCounter } from '@/lib/ratelimit';

/**
 * Login throttling — flat lockout PLUS a progressive delay ladder.
 *
 * Threat model
 * ------------
 * A flat rate limit ("N attempts per 15 minutes") is a throughput cap: an
 * attacker who can rotate source IPs just spreads attempts across addresses
 * and stays under the per-IP ceiling. Credential stuffing toolkits do exactly
 * this — thousands of IPs, one or two attempts each.
 *
 * So the ladder below is keyed on the *identity* (email), not the IP. Rotating
 * IPs buys nothing: the account itself slows down. The IP counter is kept as a
 * secondary, much looser control for spraying many accounts from one source.
 *
 * The ladder
 * ----------
 *   prior failures:  0    1    2    3    4+
 *   next attempt in: 1s   2s   5s   15s  60s
 *
 * Implementation note — why this rejects instead of sleeping
 * ----------------------------------------------------------
 * The delay is enforced as a "minimum interval between attempts" and enforced
 * by rejecting early with a retryAfter, rather than by holding the request
 * open for up to 60 seconds. A 60s sleep per attempt would let an attacker
 * exhaust the connection pool for the price of one request each; an early
 * rejection costs us nothing and denies them the bcrypt comparison entirely.
 *
 * We additionally sleep a *capped* amount after a failed password check (see
 * MAX_FAIL_SLEEP_MS) so a script hammering the endpoint in a tight loop still
 * feels resistance even if it ignores our error message, without ever holding
 * a socket for a full minute.
 *
 * Storage
 * -------
 * Counters go through src/lib/ratelimit.js, so they are Upstash-backed (and
 * therefore shared across instances) whenever Upstash is configured, and
 * in-process otherwise.
 */

/** Delay imposed after the Nth failure. Index = number of *prior* failures. */
const DELAY_LADDER_MS = [1_000, 2_000, 5_000, 15_000, 60_000];

/**
 * Hard lockout, independent of the ladder: this many failures inside
 * LOCKOUT_WINDOW_MS blocks the identity entirely (preserves the previous
 * 5-failures / 15-minutes behaviour).
 */
const IDENTITY_LOCKOUT_THRESHOLD = 5;
const IP_LOCKOUT_THRESHOLD = 30;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Upper bound on how long we will hold a request open after a failed login.
 * Anything above this is enforced by early rejection instead.
 */
const MAX_FAIL_SLEEP_MS = 2_000;

/** Sleep, but never on the hot path for more than MAX_FAIL_SLEEP_MS. */
export function failSleepMs(delayMs) {
  return Math.min(Math.max(0, delayMs || 0), MAX_FAIL_SLEEP_MS);
}

/**
 * @param {number} priorFailures how many failures have already accumulated
 * @returns {number} ms the next attempt must wait
 */
export function delayForFailures(priorFailures) {
  const idx = Math.min(Math.max(0, priorFailures), DELAY_LADDER_MS.length - 1);
  return DELAY_LADDER_MS[idx];
}

const normEmail = (email) => `id:${String(email || '').trim().toLowerCase()}`;
const normIp = (ip) => `ip:${String(ip || '').trim()}`;

const delayKey = (scope) => `login:delay:${scope}`;
const lockKey = (scope) => `login:lock:${scope}`;

/**
 * Call BEFORE verifying credentials.
 *
 * @param {object} p
 * @param {string} [p.email]
 * @param {string} [p.ip]
 * @returns {Promise<{allowed: boolean, retryAfterSec: number, reason: string|null}>}
 */
export async function checkLoginAllowed({ email, ip }) {
  if (process.env.RATE_LIMIT_DISABLE === '1') {
    return { allowed: true, retryAfterSec: 0, reason: null };
  }

  const scopes = [];
  if (email) scopes.push({ key: normEmail(email), threshold: IDENTITY_LOCKOUT_THRESHOLD, kind: 'identity' });
  if (ip) scopes.push({ key: normIp(ip), threshold: IP_LOCKOUT_THRESHOLD, kind: 'ip' });

  for (const scope of scopes) {
    // 1. Progressive delay — the interval gate.
    const delay = await readCounter(delayKey(scope.key));
    if (delay.count > 0 && delay.ttlMs > 0) {
      logger.warn(`Login delayed (${scope.kind}): ${Math.ceil(delay.ttlMs / 1000)}s remaining`);
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(delay.ttlMs / 1000)),
        reason: 'delay',
      };
    }

    // 2. Hard lockout — the throughput gate.
    const lock = await readCounter(lockKey(scope.key));
    if (lock.count >= scope.threshold && lock.ttlMs > 0) {
      logger.warn(`Login locked out (${scope.kind}): ${lock.count} failures`);
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(lock.ttlMs / 1000)),
        reason: 'lockout',
      };
    }
  }

  return { allowed: true, retryAfterSec: 0, reason: null };
}

/**
 * Record a FAILED attempt. Call when password verification fails.
 * Returns how long the caller should sleep before responding (already capped).
 *
 * @returns {Promise<number>} ms to sleep before responding
 */
export async function recordLoginFailure({ email, ip }) {
  let sleepMs = 0;

  if (email) {
    const scope = normEmail(email);

    // The lockout window slides with the most recent failure.
    const lock = await incrementCounter(lockKey(scope), {
      windowMs: LOCKOUT_WINDOW_MS,
      alwaysSetTtl: true,
    });
    if (lock.count >= IDENTITY_LOCKOUT_THRESHOLD) {
      logger.warn(`Account lockout triggered (${lock.count} failures): ${email}`);
    }

    // The delay rung is chosen from the failures recorded *before* this one,
    // and stamped as the key's TTL. While it lives, checkLoginAllowed() blocks.
    const prior = lock.count - 1;
    const delayMs = delayForFailures(prior);
    await incrementCounter(delayKey(scope), { windowMs: delayMs, alwaysSetTtl: true });
    sleepMs = Math.max(sleepMs, failSleepMs(delayMs));
  }

  if (ip) {
    const scope = normIp(ip);
    const lock = await incrementCounter(lockKey(scope), {
      windowMs: LOCKOUT_WINDOW_MS,
      alwaysSetTtl: true,
    });
    if (lock.count >= IP_LOCKOUT_THRESHOLD) {
      logger.warn(`IP login block triggered (${lock.count} failures): ${ip}`);
    }
    // Deliberately no delay ladder for IPs: one office NAT would otherwise
    // throttle every colleague because one person mistyped a password.
  }

  return sleepMs;
}

/**
 * Record a SUCCESSFUL login — clears both counters for the identity.
 * The IP counters are left alone; they protect against account spraying.
 */
export async function recordLoginSuccess({ email }) {
  if (!email) return;
  const scope = normEmail(email);
  await resetCounter(delayKey(scope));
  await resetCounter(lockKey(scope));
}

/**
 * Clear the identity throttle after an out-of-band reset (e.g. an admin
 * unlocking an account, or a successful password reset).
 */
export async function clearLoginThrottle({ email }) {
  await recordLoginSuccess({ email });
}
