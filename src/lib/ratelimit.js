/**
 * Unified rate limiting — Upstash Redis when configured, in-process otherwise.
 *
 * Why this lives in the middleware rather than in 104 individual route files:
 * the app has ~150 API routes and 104 of them mutate state. Hand-editing every
 * handler guarantees drift — the route someone adds next quarter ships with no
 * limit at all. Enforcing centrally in src/proxy.js means a new mutating route
 * is rate limited by default, and the per-route table below is only where we
 * want a tighter or looser bucket than the default.
 *
 * Runtime constraints
 * -------------------
 * This module is imported by src/proxy.js, which runs in the Edge runtime. It
 * therefore must NOT touch `node:*` builtins, mongoose, or `os`. Both backends
 * are fetch/Map based and work identically on Edge and Node.
 *
 * Backends
 * --------
 *  - Upstash  — used when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
 *               set. Distributed, survives restarts, correct behind multiple
 *               instances. @upstash/ratelimit is edge-native (REST over fetch).
 *  - Memory   — fallback. Per-isolate fixed window. Correct for single-instance
 *               deployments (which is how this app runs today) but NOT shared
 *               across instances; a load-balanced deploy needs Upstash.
 *
 * Failure mode: if Upstash is configured but unreachable we fail OPEN and log.
 * Blocking every request because Redis blipped would be a self-inflicted
 * outage, and the in-process limiter still applies as a floor.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLE === '1';

/**
 * How many reverse-proxy hops to trust when reading x-forwarded-for.
 *
 * XFF is client-controlled unless you know exactly how many proxies sit in
 * front of you. The chain is written left-to-right as each proxy appends:
 *
 *     x-forwarded-for: <spoofed>, <spoofed>, <real client>, <proxy1>, <proxy2>
 *
 * With N trusted proxies, the last entry we should trust is at
 * `parts[parts.length - N - 1]` — the rightmost non-trusted hop.
 *
 * Default 0 preserves the historical behaviour (leftmost entry) so enabling
 * this module cannot silently re-bucket an existing deployment's traffic.
 * Set TRUSTED_PROXY_HOPS=1 for a single nginx/Caddy, =2 for nginx behind
 * Cloudflare, etc. Leaving it at 0 means an attacker who sends their own
 * XFF header picks their own rate-limit bucket.
 */
const TRUSTED_PROXY_HOPS = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || '0', 10) || 0;

/**
 * Per-route buckets. First matching rule wins.
 *
 * Ordered most-specific first. `limit` is requests per `window`.
 */
const ROUTE_RULES = [
  // Auth endpoints — brute force / credential stuffing / enumeration.
  { pattern: /^\/api\/auth\/(register|forgot-password|reset-password|verify-email)(\/|$)/, limit: 5, window: '15 m' },
  { pattern: /^\/api\/auth\/signin(\/|$)/, limit: 10, window: '5 m' },
  { pattern: /^\/api\/auth\/webauthn(\/|$)/, limit: 20, window: '5 m' },

  // Admin — privileged and currently completely unlimited. Tight.
  { pattern: /^\/api\/admin(\/|$)/, limit: 30, window: '1 m' },

  // Skill install writes attacker-influenced content to disk under a per-user
  // namespace. Keep it scarce.
  { pattern: /^\/api\/skills\/install(\/|$)/, limit: 10, window: '1 m' },

  // Vault — recovery/reset mint single-use codes; unlock attempts are the
  // prize in a credential-stuffing campaign.
  { pattern: /^\/api\/user\/vault\/(recovery|reset)(\/|$)/, limit: 5, window: '15 m' },

  // API key minting — an attacker with a stolen session would head here first.
  { pattern: /^\/api\/user\/api-keys(\/|$)/, limit: 20, window: '5 m' },

  // MFA enrolment. Verify and disable both accept a 6-digit code, so this
  // endpoint is a small online guessing surface (10^6 space, but a real one).
  { pattern: /^\/api\/user\/mfa(\/|$)/, limit: 15, window: '5 m' },

  // Secret reveal — a decryption oracle. Deliberately scarce.
  { pattern: /^\/api\/utils\/decrypt(\/|$)/, limit: 15, window: '1 m' },

  // Backups — expensive (SSH + SFTP + R2 egress). Per-user, moderate.
  { pattern: /^\/api\/server-backup(\/|$)/, limit: 40, window: '1 m' },

  // Remote command execution. Everything under rclone/ and firewall/ shells
  // out to a user's server.
  { pattern: /^\/api\/(rclone|firewall)(\/|$)/, limit: 40, window: '1 m' },

  // Connections — create/update/delete plus query/export. Higher ceiling
  // because the UI polls these.
  { pattern: /^\/api\/connections(\/|$)/, limit: 120, window: '1 m' },

  // Deployments — HMAC-verified externally, but still bound.
  { pattern: /^\/api\/deploy(\/|$)/, limit: 60, window: '1 m' },
];

/** Anything mutating that matched no rule above. */
const DEFAULT_RULE = { limit: 60, window: '1 m' };

/** Paths with no meaningful abuse surface (health probes, token bootstrap). */
const EXEMPT_PATTERNS = [
  /^\/api\/health(\/|$)/,
];

// ---------------------------------------------------------------------------
// Client IP resolution
// ---------------------------------------------------------------------------

/**
 * Best-effort client IP.
 *
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const xff = request?.headers?.get?.('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) {
      if (TRUSTED_PROXY_HOPS > 0) {
        const idx = parts.length - TRUSTED_PROXY_HOPS - 1;
        if (idx >= 0 && parts[idx]) return parts[idx];
      }
      // Legacy behaviour: leftmost.
      return parts[0];
    }
  }
  return (
    request?.headers?.get?.('x-real-ip') ||
    request?.headers?.get?.('cf-connecting-ip') ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

let _upstashRedis = null;
let _upstashEnabled = null; // null = not yet determined
const _upstashLimiters = new Map();

function upstashConfigured() {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Memoised per (limit, window) so we don't rebuild a limiter per request. */
function getUpstashLimiter(limit, window) {
  const cacheKey = `${limit}:${window}`;
  const cached = _upstashLimiters.get(cacheKey);
  if (cached) return cached;

  if (_upstashEnabled === null) {
    _upstashEnabled = upstashConfigured();
    if (_upstashEnabled) {
      _upstashRedis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  }
  if (!_upstashEnabled || !_upstashRedis) return null;

  const limiter = new Ratelimit({
    redis: _upstashRedis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: 'monitor:rl',
    // Analytics doubles the Redis round-trips per call for no benefit here.
    analytics: false,
  });
  _upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

// --- In-process fallback ---------------------------------------------------

const memoryStore = new Map();
let callsSinceSweep = 0;

function sweep(now) {
  callsSinceSweep = 0;
  for (const [key, entry] of memoryStore) {
    if (now >= entry.resetAt) memoryStore.delete(key);
  }
  // Absolute ceiling so a key-flooding attacker cannot exhaust isolate memory.
  if (memoryStore.size > 50_000) memoryStore.clear();
}

function memoryLimit(key, limit, windowMs) {
  const now = Date.now();
  let entry = memoryStore.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryStore.set(key, entry);
  }
  entry.count += 1;
  if (++callsSinceSweep > 500) sweep(now);

  const reset = Math.max(0, entry.resetAt - now);
  return {
    success: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    reset,
    source: 'memory',
  };
}

// ---------------------------------------------------------------------------
// Window parsing
// ---------------------------------------------------------------------------

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * '15 m' -> 900000. Falls back to 60s for anything unparseable.
 */
export function parseWindow(window) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(window || '').trim());
  if (!match) return 60_000;
  return Number.parseInt(match[1], 10) * UNIT_MS[match[2]];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Consume one token from `key`'s bucket.
 *
 * @param {string} key    Bucket identifier, already scoped by the caller.
 * @param {object} opts
 * @param {number} opts.limit
 * @param {string} opts.window  e.g. '1 m', '15 m'
 * @returns {Promise<{success: boolean, limit: number, remaining: number, reset: number, source: string}>}
 */
export async function rateLimit(key, { limit, window } = {}) {
  const effectiveLimit = limit ?? DEFAULT_RULE.limit;
  const effectiveWindow = window ?? DEFAULT_RULE.window;

  if (RATE_LIMIT_DISABLED) {
    return { success: true, limit: effectiveLimit, remaining: effectiveLimit, reset: 0, source: 'disabled' };
  }

  const limiter = getUpstashLimiter(effectiveLimit, effectiveWindow);
  if (limiter) {
    try {
      const res = await limiter.limit(key);
      return {
        success: res.success,
        limit: res.limit,
        remaining: res.remaining,
        // Upstash returns an absolute epoch ms; normalise to "ms from now".
        reset: Math.max(0, res.reset - Date.now()),
        source: 'upstash',
      };
    } catch (err) {
      // Fail open — a Redis blip must not become a site-wide outage. The
      // in-process limiter below still applies as a floor.
      console.warn(`[ratelimit] Upstash unavailable, falling back to memory: ${err?.message}`);
    }
  }

  return memoryLimit(key, effectiveLimit, parseWindow(effectiveWindow));
}

// ---------------------------------------------------------------------------
// Counters (for progressive delays, which need a *count*, not just a bucket)
// ---------------------------------------------------------------------------

const memoryCounters = new Map();

/**
 * Atomically increment `key` and return the new count.
 *
 * Used by the login throttle: a rate-limit bucket can only answer "over the
 * line or not", whereas a progressive delay ladder needs to know *how many*
 * failures have accumulated so it can pick the right rung.
 *
 * Upstash path uses INCR + PEXPIRE + PTTL (three round-trips, but only on
 * auth paths where correctness across instances matters more than latency).
 *
 * @param {string} key
 * @param {object} opts
 * @param {number} opts.windowMs  TTL applied on first increment
 * @returns {Promise<{count: number, ttlMs: number, source: string}>}
 */
export async function incrementCounter(key, { windowMs, alwaysSetTtl = false } = {}) {
  const ttl = windowMs || 15 * 60 * 1000;

  if (!RATE_LIMIT_DISABLED) {
    const limiter = getUpstashLimiter(1, '1 m'); // forces client init
    if (limiter && _upstashRedis) {
      try {
        const count = await _upstashRedis.incr(key);
        // Default: TTL is set once, on first increment (classic fixed window).
        // alwaysSetTtl: refresh the TTL every time, so the window slides with
        // the most recent event. The login throttle needs this — a delay must
        // be measured from the last failure, not the first.
        if (count === 1 || alwaysSetTtl) await _upstashRedis.pexpire(key, ttl);
        const pttl = await _upstashRedis.pttl(key);
        return { count, ttlMs: pttl > 0 ? pttl : ttl, source: 'upstash' };
      } catch (err) {
        console.warn(`[ratelimit] counter fell back to memory: ${err?.message}`);
      }
    }
  }

  // Memory fallback
  const now = Date.now();
  let entry = memoryCounters.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + ttl };
    memoryCounters.set(key, entry);
  }
  entry.count += 1;
  if (++callsSinceSweep > 500) {
    callsSinceSweep = 0;
    for (const [k, v] of memoryCounters) if (now >= v.resetAt) memoryCounters.delete(k);
  }
  return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - now), source: 'memory' };
}

/** Read a counter without incrementing. */
export async function readCounter(key) {
  if (!RATE_LIMIT_DISABLED) {
    const limiter = getUpstashLimiter(1, '1 m');
    if (limiter && _upstashRedis) {
      try {
        const raw = await _upstashRedis.get(key);
        const pttl = await _upstashRedis.pttl(key);
        return { count: Number(raw) || 0, ttlMs: pttl > 0 ? pttl : 0, source: 'upstash' };
      } catch {
        /* fall through to memory */
      }
    }
  }
  const now = Date.now();
  const entry = memoryCounters.get(key);
  if (!entry || now >= entry.resetAt) return { count: 0, ttlMs: 0, source: 'memory' };
  return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - now), source: 'memory' };
}

/** Delete a counter (called on successful login). */
export async function resetCounter(key) {
  memoryCounters.delete(key);
  if (!RATE_LIMIT_DISABLED) {
    const limiter = getUpstashLimiter(1, '1 m');
    if (limiter && _upstashRedis) {
      try {
        await _upstashRedis.del(key);
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Resolve the bucket rule for a pathname.
 * @param {string} pathname
 */
export function ruleForPath(pathname) {
  for (const rule of ROUTE_RULES) {
    if (rule.pattern.test(pathname)) return rule;
  }
  return DEFAULT_RULE;
}

export function isRateLimitExempt(pathname) {
  return EXEMPT_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Bucket key for a request.
 *
 * Authenticated requests key on the user id so that rotating IPs (botnet,
 * residential proxy pool) buys an attacker nothing. Unauthenticated requests
 * have no stable identity, so they fall back to IP.
 *
 * The route rule is part of the key so two routes sharing a user do not
 * contend for the same bucket.
 */
export function bucketKey({ userId, ip, rule, pathname }) {
  const identity = userId ? `u:${userId}` : `ip:${ip || 'unknown'}`;
  return `${rule.pattern.source}:${identity}`;
}

export { ROUTE_RULES, DEFAULT_RULE };
