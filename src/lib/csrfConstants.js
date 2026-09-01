/**
 * Shared CSRF constants — safe to import from BOTH client and server bundles.
 * Kept in its own module so client code never pulls in the HMAC/crypto logic.
 */

/** JS-readable cookie that holds the minted token. */
export const CSRF_COOKIE = 'monitor_csrf';

/** Header the client must echo the token back in. */
export const CSRF_HEADER = 'x-csrf-token';

/** Error body returned when enforcement rejects a request. */
export const CSRF_ERROR = 'CSRF token missing or invalid';
