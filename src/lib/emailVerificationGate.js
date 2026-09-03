/**
 * Login-time email-verification gate.
 *
 * The registration flow sets `emailVerified: false`, emails a 6-digit code, and
 * flips the flag when the code is confirmed. But `authorize()` in src/lib/auth.js
 * never read the flag, so an account could be created with any address — one
 * the attacker does not control — and used immediately. Verification was
 * decorative.
 *
 * WHY NOT SIMPLY REQUIRE `emailVerified === true`
 *
 * Because it would lock out every account that already exists. The field was
 * added after this deployment was live; every pre-existing row (including the
 * operators' own admin accounts) has `emailVerified: false` and no way back in
 * without manual database surgery. That is a self-inflicted outage dressed up
 * as a security fix.
 *
 * THE DISTINCTION THIS MODULE DRAWS
 *
 * An account is held to verification only when it actually went through the
 * verification flow — that is, when it carries an `emailVerification` record,
 * which registration always writes and which nothing else does.
 *
 *   emailVerified === true                       -> allow
 *   verification record present, flag still false -> BLOCK (never confirmed)
 *   no verification record at all                 -> allow, grandfathered
 *
 * The threat this addresses is mass account creation: an attacker registers,
 * ignores the code, and gets a working session. Those accounts always carry a
 * record, so they are always gated. Long-standing accounts that predate the
 * feature are unaffected.
 *
 * TURNING IT OFF
 *
 * `ALLOW_UNVERIFIED_LOGIN=true` disables the gate for incident response
 * (e.g. the mailer is down and nobody can confirm a code). Denials and bypasses
 * are both worth an audit entry, so callers should record the result.
 */

const BYPASS = process.env.ALLOW_UNVERIFIED_LOGIN === 'true';

/**
 * Decide whether an account may sign in without a verified email.
 *
 * @param {object} user — the user record; needs `emailVerified` and optionally
 *                        `emailVerification`
 * @returns {{
 *   allowed: boolean,
 *   reason: 'verified' | 'unverified' | 'grandfathered' | 'bypassed',
 *   error?: string
 * }}
 */
export function evaluateEmailVerification(user) {
  if (!user) return { allowed: false, reason: 'unverified', error: 'Invalid email or password' };

  if (user.emailVerified === true) {
    return { allowed: true, reason: 'verified' };
  }

  // A record exists => this account was issued a code and never confirmed it.
  const hasObligation = !!user.emailVerification?.codeHash;

  if (!hasObligation) {
    // Predates the verification feature. Allow, but say so: `reason` is
    // audited, so a deployment can count how many accounts are still in this
    // state and decide when to force them through.
    return { allowed: true, reason: 'grandfathered' };
  }

  if (BYPASS) {
    return { allowed: true, reason: 'bypassed' };
  }

  return {
    allowed: false,
    reason: 'unverified',
    error:
      'Please verify your email address before signing in. ' +
      'Check your inbox for the 6-digit code, or request a new one.',
  };
}

/**
 * @returns {boolean} true when the gate is currently disabled by environment.
 */
export function isVerificationBypassed() {
  return BYPASS;
}
