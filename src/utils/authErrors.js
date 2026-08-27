// ── Permanent error detection (database auth) ────────────────────────────────
//
// Used by DatabaseView's reconnect loop to short-circuit polling when the
// failure is a credentials / permissions problem that will never recover
// on its own. Without this, a typo'd username (e.g. "uoteru" instead of
// "root") would generate an unbounded stream of /api/connections/{id}/schema
// 500s every few seconds, hammering both the API and the upstream database.
//
// Patterns covered:
//   - MongoServerError "Authentication failed" (code 18, codeName
//     "AuthenticationFailed")
//   - Mongo "bad auth" / SCRAM failures
//   - MySQL "Access denied"
//   - Postgres "password authentication failed"
//   - Generic HTTP 401 / "Unauthorized" / "invalid credentials"

const PATTERNS = [
  'authentication failed',
  'auth failed',
  'unauthorized',
  'invalid credentials',
  'authenticate',
  'code 18',                // MongoServerError: AuthenticationFailed
  'bad auth',               // Mongo "bad auth" / SCRAM failures
  'access denied',          // MySQL / Postgres
  'password authentication failed', // Postgres
];

/**
 * @param {string|Error|unknown} msg  the error message or thrown error
 * @returns {boolean}  true if the error is a credentials problem that
 *   retrying with the same config will not fix.
 */
export function isPermanentAuthError(msg) {
  const s = (msg == null)
    ? ''
    : (typeof msg === 'string' ? msg : (msg.message || String(msg)));
  if (!s) return false;
  const m = s.toLowerCase();
  for (const p of PATTERNS) {
    if (m.includes(p)) return true;
  }
  return false;
}
