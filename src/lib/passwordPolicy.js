/**
 * Password strength policy, shared by registration and password reset.
 *
 * Previously both routes independently checked `password.length < 6`. Six
 * characters is below every current guideline and is brute-forceable offline
 * against a leaked hash in seconds. The two routes also drifted: they duplicated
 * the number as a literal, so changing policy meant editing both.
 *
 * Policy
 * ------
 *  - Minimum 10 characters. Long enough that a leaked bcrypt hash is not
 *    trivially cracked, short enough to stay usable.
 *  - Maximum 72 BYTES. This is not a usability cap — bcrypt silently truncates
 *    at 72 bytes, so "correct" longer passwords were being shortened before
 *    hashing. Rejecting them is honest; accepting them implies strength that
 *    does not exist.
 *  - Rejected if it matches a common-password blocklist, or the user's own
 *    email local-part (case-insensitive, also checked reversed).
 *
 * Deliberately NO composition rules (must contain a digit, a symbol, ...).
 * NIST SP 800-63B advises against them: they push users toward predictable
 * substitutions like "P@ssw0rd" that add little entropy. Length plus a
 * blocklist is the better trade.
 */

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt's hard input limit, in bytes. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Small, high-yield blocklist. This is not a substitute for a breached-
 * password API (HIBP k-anonymity); it catches the passwords that dominate
 * real credential-stuffing lists and that users actually pick.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx',
  'letmein', 'welcome', 'welcome1', 'admin', 'admin123', 'administrator',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'baseball', 'master', 'shadow', 'superman', 'trustno1', 'whatever',
  'abc123', 'abcdef', 'abcd1234', 'aabb1234', 'aabbccdd', 'aa123456',
  'changeme', 'secret', 'starwars', 'login', 'pass', 'test', 'test123',
  'monitor', 'monitor123', 'eaqdragon', 'katanyoo', 'katanyooang',
]);

/**
 * Validate a password.
 *
 * @param {string} password
 * @param {{ email?: string }} [context] — used for the "same as email" check
 * @returns {{ ok: boolean, error?: string }}
 */
export function validatePassword(password, context = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Password is required' };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    };
  }

  // Measured in bytes, not characters: a 40-character UTF-8 passphrase can
  // exceed 72 bytes and would be silently truncated by bcrypt.
  // TextEncoder rather than Buffer so this module is importable from client
  // components too — the signup form shares MIN_PASSWORD_LENGTH with it.
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return {
      ok: false,
      error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (bcrypt ignores anything longer)`,
    };
  }

  const tooCommon = {
    ok: false,
    error: 'That password is too common. Choose something less predictable.',
  };

  const lower = password.toLowerCase().trim();
  if (COMMON_PASSWORDS.has(lower)) return tooCommon;

  // Strip separators so "p a s s w o r d" and "pass-word" are still caught.
  const squashed = lower.replace(/[\s._-]/g, '');
  if (COMMON_PASSWORDS.has(squashed)) return tooCommon;

  // Strip trailing digits and symbols too. Appending "1" or "123" is the
  // single most common way users satisfy a policy without adding any real
  // entropy, and it is exactly what a blocklist has to see through.
  const unpadded = squashed.replace(/[\d!@#$%^&*+=?]+$/, '');
  if (unpadded && COMMON_PASSWORDS.has(unpadded)) return tooCommon;

  const email = String(context.email || '').trim().toLowerCase();
  if (email) {
    const localPart = email.split('@')[0];
    const domain = email.split('@')[1] || '';
    const domainName = domain.split('.')[0];
    if (
      (localPart && lower === localPart) ||
      (domainName && lower === domainName) ||
      (localPart && lower === [...localPart].reverse().join(''))
    ) {
      return {
        ok: false,
        error: 'Password must not be based on your email address',
      };
    }
  }

  return { ok: true };
}
