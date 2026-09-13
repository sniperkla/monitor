/**
 * Server Protection Utilities
 * 
 * Provides rate limiting, concurrency control, memory guards,
 * and request timeout — all designed to keep the server light
 * under heavy multi-user load.
 */

// ==========================================
// 1. RATE LIMITER (per-IP sliding window)
// ==========================================
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 120;     // 120 requests per minute per IP

/**
 * Check if a request should be rate-limited.
 * @param {string} identifier - Usually the client IP or user ID
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export function checkRateLimit(identifier, maxRequests = RATE_LIMIT_MAX_REQUESTS) {
  const now = Date.now();
  
  if (!rateLimitStore.has(identifier)) {
    rateLimitStore.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }
  
  const entry = rateLimitStore.get(identifier);
  
  // Reset window if expired
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
    return { allowed: true, remaining: maxRequests - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }
  
  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetIn = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
  
  return { allowed: entry.count <= maxRequests, remaining, resetIn };
}

// Cleanup old rate limit entries every 5 minutes
if (!global.__rateLimitCleanupStarted) {
  global.__rateLimitCleanupStarted = true;
  // unref: a background sweep must never keep the process alive. Without it
  // this timer holds the event loop open and `node --test` never exits.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}


// ==========================================
// 2. CONCURRENCY LIMITER (for heavy operations)
// ==========================================
const concurrencyCounters = new Map();

/**
 * Limit concurrent heavy operations (e.g., exports, imports).
 * @param {string} operation - Operation name (e.g., 'export', 'import')
 * @param {number} maxConcurrent - Max allowed concurrent operations
 * @returns {{ allowed: boolean, current: number, acquire: Function, release: Function }}
 */
export function getConcurrencyLimiter(operation, maxConcurrent = 5) {
  if (!concurrencyCounters.has(operation)) {
    concurrencyCounters.set(operation, 0);
  }
  
  const current = concurrencyCounters.get(operation);
  
  return {
    allowed: current < maxConcurrent,
    current,
    max: maxConcurrent,
    acquire: () => {
      concurrencyCounters.set(operation, concurrencyCounters.get(operation) + 1);
    },
    release: () => {
      const val = concurrencyCounters.get(operation);
      concurrencyCounters.set(operation, Math.max(0, val - 1));
    }
  };
}


import os from 'os';
import fs from 'fs';
import { logger } from './logger.js';

/**
 * Free memory in MB, as the kernel would report it to a new allocation.
 *
 * `os.freemem()` on its own is not a usable "is there room?" signal on either
 * platform this runs on:
 *
 *   • Linux — libuv returns sysinfo(2).freeram, i.e. MemFree. That counter
 *     excludes page cache and reclaimable slab, so a box that has served any
 *     real I/O sits at a few hundred MB "free" while MemAvailable is still
 *     gigabytes. Comparing MemFree against a 512MB floor therefore trips on
 *     machines that are not remotely out of memory.
 *   • macOS — excludes purgeable/compressed pages and reports near-zero on
 *     healthy machines (hence the 64MB darwin threshold below).
 *
 * On Linux, prefer MemAvailable from /proc/meminfo: it is the kernel's own
 * estimate of what can be allocated without swapping, which is precisely the
 * question this guard means to ask. Everything else falls back to os.freemem().
 */
function getFreeMemMB() {
  if (process.platform === 'linux') {
    try {
      const match = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (match) return Math.round(Number(match[1]) / 1024);
    } catch (_) {
      // No /proc (unusual container) — fall through to os.freemem().
    }
  }
  return Math.round(os.freemem() / 1024 / 1024);
}

/**
 * Check if the server has enough free memory to handle a heavy request.
 * 
 * We check two things:
 * 1. Process RSS (Physical RAM the server is using)
 * 2. System Free Memory (RAM available on the OS)
 * 
 * @param {number} minFreeMB - Minimum free MB required (default: 512 MB)
 * @returns {{ safe: boolean, freeMemMB: number, usedMemMB: number, totalMemMB: number, usagePercent: number }}
 */
export function checkMemory(minFreeMB = 512) {
  const isDev = process.env.NODE_ENV !== 'production';
  const used = process.memoryUsage();
  const rssMB = Math.round(used.rss / 1024 / 1024);
  
  // Reclaim-aware on Linux — see getFreeMemMB. os.freemem() is MemFree there,
  // which reads as "almost full" on a healthy host that is merely using its
  // RAM for page cache.
  const sysFreeMB = getFreeMemMB();
  const sysTotalMB = Math.round(os.totalmem() / 1024 / 1024);
  
  // RSS limit: 1.5GB in production, 2.5GB in Dev (Next.js dev is heavy)
  const rssLimitMB = isDev ? 2560 : 1536; 
  
  // Relaxed threshold for Dev mode since OS handles swap well
  // macOS: os.freemem() excludes purgeable/compressed memory and reports
  // near-zero on healthy machines — use a tiny threshold there instead.
  const threshold = isDev ? 16 : (process.platform === 'darwin' ? 64 : minFreeMB);
  
  const safe = sysFreeMB > threshold && rssMB < rssLimitMB;

  if (!safe) {
    logger.warn(`🛡️ Memory Guard Warning: RSS=${rssMB}MB, SysFree=${sysFreeMB}MB (${process.platform === 'linux' ? 'MemAvailable' : 'os.freemem'}), Threshold=${threshold}MB`);
    // In development mode, we only WARN. We don't block the request.
    // This prevents the 503 error from stopping your workflow.
    if (isDev) return { safe: true, warning: true, rssMB, sysFreeMB };
  }
  
  return {
    safe,
    sysFreeMB,
    sysTotalMB,
    rssMB,
    usagePercent: Math.round(((sysTotalMB - sysFreeMB) / sysTotalMB) * 100),
  };
}


// ==========================================
// 4. REQUEST TIMEOUT WRAPPER
// ==========================================

/**
 * Wrap an async function with a timeout.
 * If the function takes longer than `timeoutMs`, it rejects.
 * @param {Function} fn - Async function to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns {Promise}
 */
export function withTimeout(fn, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    
    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}


// ==========================================
// 5. SAFE DATA SIZE ESTIMATOR
// ==========================================

/**
 * Estimate the approximate size of a JSON-serializable object in MB.
 * Used to check if a response would be too large before sending it.
 * @param {any} data
 * @returns {number} Approximate size in MB
 */
export function estimateDataSizeMB(data) {
  if (!data) return 0;
  
  // Quick estimate: number of items * average record size
  if (Array.isArray(data)) {
    if (data.length === 0) return 0;
    // Sample the first record to estimate size
    const sampleSize = JSON.stringify(data[0]).length;
    return (sampleSize * data.length) / (1024 * 1024);
  }
  
  return JSON.stringify(data).length / (1024 * 1024);
}


// ==========================================
// 6. RESPONSE SIZE LIMITS
// ==========================================
export const LIMITS = {
  MAX_EXPORT_RECORDS: 10000,      // Max records per single export
  MAX_EXPORT_ALL_RECORDS: 5000,   // Max records per table in "Export All"
  MAX_IMPORT_BATCH_SIZE: 500,     // Max records per import batch
  MAX_QUERY_RESULT_ROWS: 200,     // Max rows returned from a query
  MAX_RESPONSE_SIZE_MB: 50,       // Max response size in MB
  REQUEST_TIMEOUT_MS: 30000,      // 30 second timeout
  HEAVY_OP_TIMEOUT_MS: 120000,    // 2 minute timeout for exports/imports
};
