/**
 * globalRateLimit.js
 *
 * Per-user daily request counter with burst bundling.
 *
 * BUNDLING: Multiple API requests arriving within BUNDLE_WINDOW_MS are counted
 * as a single "action". This means a page load that fires 15 parallel requests
 * counts as 1, not 15. Only the first request in each window increments the counter.
 *
 * Limit: 500 actions/day per user, resets at midnight UTC+7.
 * Override via GLOBAL_DAILY_LIMIT environment variable.
 *
 * Storage: module-level Map — persists for the server process lifetime.
 */

const DEFAULT_LIMIT = 500;

// How long a burst window lasts — requests within this window count as 1 action
const BUNDLE_WINDOW_MS = 1000; // 1 second

const UTC7_OFFSET_MS = 7 * 60 * 60 * 1000;

function getDayKeyUTC7() {
  const d = new Date(Date.now() + UTC7_OFFSET_MS);
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

export function secondsUntilMidnightUTC7() {
  const now = Date.now();
  const shifted = new Date(now + UTC7_OFFSET_MS);
  const nextMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return Math.max(0, Math.floor((nextMidnight - now) / 1000));
}

function getLimit() {
  const env = Number(process.env.GLOBAL_DAILY_LIMIT);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_LIMIT;
}

/**
 * Per-user state:
 *   dayKey       — UTC+7 date string for today
 *   count        — number of actions counted today
 *   lastCountedAt — timestamp (ms) of the last increment
 */
const store = new Map();

/**
 * Check and optionally increment the global daily counter for `email`.
 *
 * When increment=true, the counter only advances if at least BUNDLE_WINDOW_MS
 * has elapsed since the last increment (burst bundling). Multiple rapid
 * parallel requests count as one action.
 *
 * @param {string}  email     - User email from the JWT
 * @param {boolean} increment - true = count this request (default), false = peek only
 * @returns {{ allowed, used, limit, remaining, resetsInSeconds, percentage, bundled }}
 */
export function checkGlobalDailyLimit(email, increment = true) {
  const now = Date.now();
  const todayKey = getDayKeyUTC7();
  const limit = getLimit();
  const resetsInSeconds = secondsUntilMidnightUTC7();

  if (!email) {
    return { allowed: true, used: 0, limit, remaining: limit, resetsInSeconds, percentage: 0, bundled: false };
  }

  let entry = store.get(email);

  if (!entry || entry.dayKey !== todayKey) {
    entry = { dayKey: todayKey, count: 0, lastCountedAt: 0 };
    store.set(email, entry);
  }

  let bundled = false;

  if (increment) {
    const timeSinceLast = now - entry.lastCountedAt;
    if (timeSinceLast < BUNDLE_WINDOW_MS) {
      // Inside the bundle window — this request is free, don't increment
      bundled = true;
    } else {
      // Outside the window — this starts a new action, increment
      entry.count++;
      entry.lastCountedAt = now;
    }
  }

  const used      = entry.count;
  const remaining = Math.max(0, limit - used);
  const allowed   = used <= limit;
  const percentage = Math.min(100, Math.round((used / limit) * 100));

  return { allowed, used, limit, remaining, resetsInSeconds, percentage, bundled };
}

// Hourly cleanup of stale entries
try {
  if (typeof global !== 'undefined' && !global.__globalRLCleanupStarted) {
    global.__globalRLCleanupStarted = true;
    setInterval(() => {
      const today = getDayKeyUTC7();
      for (const [email, entry] of store.entries()) {
        if (entry.dayKey !== today) store.delete(email);
      }
    }, 60 * 60 * 1000);
  }
} catch { /* Edge runtime — ephemeral */ }
