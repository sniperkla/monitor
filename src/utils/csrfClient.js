'use client';

/**
 * Client-side CSRF interceptor.
 *
 * Rather than patching the ~57 individual `fetch()` call sites (easy to miss
 * one, and new code would ship unprotected), this installs a single shim over
 * `window.fetch` that transparently attaches the CSRF header to every
 * same-origin state-changing request — including calls made by third-party
 * libraries.
 *
 * The token is read from the cookie on every request instead of being cached
 * in JS memory, so silent server-side rotation (e.g. after login/logout, when
 * the token is re-bound to a different user) can never desync the client.
 */

import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/csrfConstants';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let installed = false;
let bootstrapPromise = null;

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

/** Current token from the cookie, or null if not minted yet. */
export function getCsrfToken() {
  return readCookie(CSRF_COOKIE);
}

/** Force-mint a fresh token (used when the server rejects ours). */
export function refreshCsrfToken() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = fetch('/api/csrf', { credentials: 'include', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => (data && data.csrfToken ? data.csrfToken : readCookie(CSRF_COOKIE)))
    .catch(() => null)
    .finally(() => {
      bootstrapPromise = null;
    });
  return bootstrapPromise;
}

async function ensureCsrfToken() {
  const existing = getCsrfToken();
  if (existing) return existing;
  return refreshCsrfToken();
}

function resolveUrl(input) {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href);
    if (input instanceof Request) return new URL(input.url, window.location.href);
    if (input instanceof URL) return input;
  } catch {
    /* fall through */
  }
  return null;
}

function isSameOrigin(input) {
  const url = resolveUrl(input);
  return !!url && url.origin === window.location.origin;
}

function getMethod(input, options) {
  if (options && options.method) return String(options.method).toUpperCase();
  if (input instanceof Request) return String(input.method).toUpperCase();
  return 'GET';
}

/** Merge the CSRF header into the request without mutating the caller's object. */
function withCsrfHeader(input, options, token) {
  const headers = new Headers();

  if (input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  if (options && options.headers) {
    const h = options.headers;
    if (h instanceof Headers) {
      h.forEach((value, key) => headers.set(key, value));
    } else if (Array.isArray(h)) {
      h.forEach(([key, value]) => headers.set(key, value));
    } else if (typeof h === 'object') {
      Object.entries(h).forEach(([key, value]) => headers.set(key, value));
    }
  }

  if (token) headers.set(CSRF_HEADER, token);
  return { ...(options || {}), headers };
}

function looksLikeCsrfRejection(response) {
  if (response.status !== 403) return false;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json');
}

/**
 * Prime the token on mount so the first POST does not pay an extra roundtrip.
 * Fire-and-forget: the shim transparently fetches it if this has not landed yet.
 */
export function ensureCsrfTokenOnMount() {
  if (typeof window === "undefined") return;
  if (!getCsrfToken()) refreshCsrfToken();
}

/**
 * Install the shim. Safe to call multiple times — only the first takes effect.
 */
export function installCsrfFetch() {
  if (installed) return false;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return false;

  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, options) {
    const needsToken = UNSAFE_METHODS.has(getMethod(input, options)) && isSameOrigin(input);
    if (!needsToken) return originalFetch(input, options);

    const token = await ensureCsrfToken();
    const response = await originalFetch(input, withCsrfHeader(input, options, token));

    // The token may have been rotated (login/logout re-binds it to a new user).
    // Refresh once and retry before surfacing the failure to the caller.
    if (token && looksLikeCsrfRejection(response)) {
      const probe = response.clone();
      const body = await probe.json().catch(() => null);
      if (body && typeof body.error === 'string' && body.error.includes('CSRF')) {
        const fresh = await refreshCsrfToken();
        if (fresh) return originalFetch(input, withCsrfHeader(input, options, fresh));
      }
    }

    return response;
  };

  return true;
}

// Install as early as possible. Module is 'use client' but still evaluated
// during SSR prerender, hence the window guard.
installCsrfFetch();
