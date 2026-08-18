// API Request Deduplication and Caching Utility
// Prevents duplicate API calls and implements caching with TTL

const pendingRequests = new Map(); // Stores ongoing requests
const cache = new Map(); // Stores cached responses
const DEFAULT_TTL = 30000; // 30 seconds default cache time

/**
 * Creates a cache key from URL and options
 */
function getCacheKey(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : '';
  return `${method}:${url}:${body}`;
}

/**
 * Checks if a cached response is still valid
 */
function isCacheValid(cachedItem) {
  if (!cachedItem) return false;
  return Date.now() - cachedItem.timestamp < cachedItem.ttl;
}

/**
 * Makes an API call with deduplication and caching
 * @param {string} url - The API endpoint URL
 * @param {object} options - Fetch options
 * @param {object} cacheOptions - Cache options { ttl, skipCache, forceRefresh }
 * @returns {Promise<Response>}
 */
export async function cachedFetch(url, options = {}, cacheOptions = {}) {
  const { ttl = DEFAULT_TTL, skipCache = false, forceRefresh = false } = cacheOptions;
  const cacheKey = getCacheKey(url, options);

  // Check cache first (unless skipped or force refresh)
  if (!skipCache && !forceRefresh) {
    const cachedItem = cache.get(cacheKey);
    if (cachedItem && isCacheValid(cachedItem)) {
      console.log(`[API Cache] HIT: ${cacheKey}`);
      // Return a new Response from cached data
      return new Response(cachedItem.data, {
        status: cachedItem.status,
        headers: new Headers(cachedItem.headers),
      });
    }
  }

  // Check if there's already a pending request for this key
  if (pendingRequests.has(cacheKey)) {
    console.log(`[API Cache] DEDUPE: ${cacheKey} - waiting for existing request`);
    return pendingRequests.get(cacheKey);
  }

  // Create abort controller for request cancellation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  // Merge signal if provided
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }
  
  const requestOptions = {
    ...options,
    signal: controller.signal
  };

  // Create new request
  const requestPromise = fetch(url, requestOptions)
    .then(async (response) => {
      clearTimeout(timeoutId);
      
      // Clone response to cache it - read body from clone
      const clonedResponse = response.clone();
      let responseData;
      try {
        responseData = await clonedResponse.text();
      } catch (e) {
        console.warn('[API Cache] Failed to read response body for caching:', e);
        responseData = '';
      }
      
      // Cache successful responses with body data
      if (response.ok && !skipCache && responseData) {
        cache.set(cacheKey, {
          data: responseData,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          timestamp: Date.now(),
          ttl,
        });
      }
      
      // Return the original response - body is still readable
      return response;
    })
    .catch(error => {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.log(`[API Cache] Request cancelled: ${cacheKey}`);
        throw new Error('REQUEST_CANCELLED');
      }
      throw error;
    })
    .finally(() => {
      // Remove from pending requests when done
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

/**
 * Clears cache for a specific URL pattern or all cache
 * @param {string} pattern - Optional URL pattern to match
 */
export function clearCache(pattern = null) {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

/**
 * Clears expired cache entries
 */
export function clearExpiredCache() {
  for (const [key, value] of cache.entries()) {
    if (!isCacheValid(value)) {
      cache.delete(key);
    }
  }
}

/**
 * Cancels all pending requests
 */
export function cancelAllRequests() {
  for (const [key, promise] of pendingRequests.entries()) {
    console.log(`[API Cache] Cancelling request: ${key}`);
    // Note: We can't actually cancel fetch promises directly, but we clear the pending map
    // to prevent new consumers from waiting on them
  }
  pendingRequests.clear();
}

// Clear expired cache every minute
if (typeof window !== 'undefined') {
  setInterval(clearExpiredCache, 60000);
  
  // Cancel all requests when page becomes hidden to save resources
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[API Cache] Page hidden, cancelling pending requests');
      cancelAllRequests();
    }
  });
}