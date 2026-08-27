// ── Request Deduplication (client-side) ─────────────────────────────────────
//
// Solves a class of bugs seen across the apps where:
//   • Two intervals / useEffects both poll the same endpoint
//   • One useEffect re-fires on every callback identity change
//   • An immediate "fetch on mount" races with an "interval fetch"
//
// The strategy is two-tiered:
//
//  1. **In-flight coalescing** — if the same URL (and method) is already
//     being requested, the second caller awaits the same promise instead
//     of issuing a new network request. This is the strongest guarantee
//     and works for GET, POST, etc.
//
//  2. **Short-window short-circuit (GET only)** — once a GET has resolved,
//     subsequent identical GETs within `WINDOW_MS` are returned from a
//     cached clone of the original response, avoiding redundant network
//     round-trips when several components poll the same endpoint at
//     slightly offset intervals (e.g. 30s and 33s for two different
//     effects on the same tab). This is intentionally opt-out via the
//     `options.dedup` flag for callers that need fresh data every time.
//
// Non-GET methods (POST / PUT / DELETE / PATCH) are NEVER short-circuited
// by the time-window logic — only by the in-flight coalescer.
//
// The cache is keyed by `${METHOD} ${URL}` so different methods to the
// same URL do not collide. This module is intentionally framework-free so
// it can be used from anywhere (AppContext, hooks, lib/*, etc.).

const WINDOW_MS = 1000; // 1s short-circuit window for GET requests

// In-flight registry: key -> { promise, completedAt? }
const inflight = new Map();

// Recent-response registry: key -> { response, headers, completedAt }
const recent = new Map();

const isPlainGet = (method) => !method || String(method).toUpperCase() === 'GET';

const keyFor = (url, method) => `${String(method || 'GET').toUpperCase()} ${url}`;

const cloneResponse = (res) => {
  // Response bodies can only be consumed once — clone before reading so we
  // can hand out independent Response objects to every caller.
  return res.clone();
};

const storeRecent = (key, res) => {
  recent.set(key, { response: res, completedAt: Date.now() });
  // Opportunistic cleanup — drop entries older than 5× the window so the
  // map doesn't grow unbounded over a long session.
  if (recent.size > 200) {
    const cutoff = Date.now() - WINDOW_MS * 5;
    for (const [k, v] of recent) {
      if (v.completedAt < cutoff) recent.delete(k);
    }
  }
};

const getRecent = (key) => {
  const entry = recent.get(key);
  if (!entry) return null;
  if (Date.now() - entry.completedAt > WINDOW_MS) {
    recent.delete(key);
    return null;
  }
  return entry.response;
};

/**
 * Wrap a fetch-style function with request-dedup.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {boolean} [options.dedup=true]  set false to bypass dedup
 * @param {Function} doFetch  the underlying fetch (receives merged options)
 * @returns {Promise<Response>}
 */
export async function dedupedFetch(url, options, doFetch) {
  const method = (options && options.method) || 'GET';
  const dedup = options && options.dedup === false ? false : true;
  const key = keyFor(url, method);

  // 1) In-flight coalescing — strongest, works for any method.
  // If a request for the same key is already in flight, share the response.
  if (dedup) {
    const existing = inflight.get(key);
    if (existing) {
      try {
        const shared = await existing.promise;
        return cloneResponse(shared);
      } catch (_) {
        // The in-flight request errored. Fall through to issue a fresh
        // one so the caller isn't blocked by a sibling's failure.
      }
    }
  }

  // 2) Short-window short-circuit (GET only) — return a clone of the
  // most recent successful response for this key if it's still fresh.
  if (dedup && isPlainGet(method)) {
    const cached = getRecent(key);
    if (cached) {
      return cloneResponse(cached);
    }
  }

  // 3) Issue the real request. We store the promise in `inflight` BEFORE
  // returning so that any synchronous re-entry from a parent component
  // (e.g. an effect firing twice in the same tick) can coalesce on us.
  const innerPromise = (async () => {
    try {
      const res = await doFetch(url, options);
      if (dedup && isPlainGet(method)) {
        storeRecent(key, res);
      }
      return res;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, { promise: innerPromise });
  // Return a clone so the caller can consume the body without affecting
  // any future cache hits on the same key.
  const result = await innerPromise;
  return cloneResponse(result);
}

/**
 * Clear all dedup state. Useful on logout / sign-out.
 */
export function clearDedupCache() {
  inflight.clear();
  recent.clear();
}

/**
 * Test-only / debug helper — returns current sizes.
 */
export function _dedupStats() {
  return { inflight: inflight.size, recent: recent.size };
}
