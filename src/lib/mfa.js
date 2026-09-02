import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { encrypt, decrypt } from '@/utils/encryption';

/**
 * TOTP second factor, enforced for privileged accounts.
 *
 * Scope decision
 * --------------
 * MFA is gated on `isAdmin || isSupporter` rather than offered to everyone.
 * Admin accounts can read and mutate every connection in the system; supporter
 * accounts unlock the local relay, which executes commands on the user's own
 * machine. Those are the accounts where a single stolen password is a
 * system-wide incident. Rolling this out to every user is a product decision
 * that needs an enrolment funnel, not just a library.
 *
 * Why TOTP and not SMS/email codes
 * --------------------------------
 * TOTP needs no third-party delivery (no per-message cost, no SIM-swap
 * exposure, no dependency on the mailer being up). It is phishable in
 * principle — which is exactly why WebAuthn is also being added; the two are
 * complementary, not alternatives.
 *
 * Secret handling
 * ---------------
 * The TOTP secret is AES-encrypted at rest with ENCRYPTION_KEY before it
 * reaches Mongo. Without this, read access to the users collection (a backup,
 * a leaked connection string, a support engineer's query) yields live second
 * factors. With it, the attacker also needs the app key.
 */

const ISSUER = process.env.MFA_ISSUER || 'Monitor';
const DIGITS = 6;
const PERIOD = 30;
const ALGORITHM = 'SHA1';
/** Accept one period either side — phones drift, and 30s is a long time. */
const VALIDATION_WINDOW = 1;
const BACKUP_CODE_COUNT = 10;

/**
 * Escalation switch. When true, a privileged account that has NOT enrolled is
 * refused login outright instead of being waved through.
 *
 * Off by default deliberately: flipping it on in an environment where admins
 * have not yet enrolled would lock out the operators. Enable it only after
 * every admin has a factor registered.
 */
const REQUIRE_FOR_UNENROLLED = process.env.MFA_REQUIRE_ADMINS === 'true';

function supporterActive(user) {
  return !!(
    user?.supporter?.status &&
    (!user?.supporter?.expiresAt || new Date(user.supporter.expiresAt).getTime() > Date.now())
  );
}

/**
 * Does this account require a second factor at login?
 *
 * @param {object} user
 * @returns {boolean}
 */
export function requiresMfa(user) {
  if (!user) return false;
  return user.role === 'admin' || supporterActive(user);
}

function totpFromSecret(base32Secret, email) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email || ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/-/g, '').toUpperCase()).digest('hex');
}

function safeEqualHex(a, b) {
  const ab = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Decrypt a stored secret, tolerating legacy plaintext rows. */
function readSecret(stored) {
  if (!stored) return '';
  try {
    // `decrypt` throws when the value is not in iv:ciphertext form.
    return decrypt(stored);
  } catch {
    // Pre-existing rows written before encryption-at-rest was added.
    return stored;
  }
}

/**
 * Generate a fresh TOTP secret plus one-time recovery codes.
 * The caller persists the ENCRYPTED secret; plaintext never leaves this call.
 *
 * @param {string} email
 * @returns {{secret: string, uri: string, backupCodes: string[]}}
 */
export function generateTotpSecret(email) {
  const secret = new OTPAuth.Secret({ size: 20 }); // 160 bits, RFC 4226 recommends >=128
  const base32 = secret.base32;
  const totp = totpFromSecret(base32, email);

  const backupCodes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    backupCodes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }

  return { secret: base32, uri: totp.toString(), backupCodes };
}

/** Encrypt a base32 secret for storage. */
export function sealSecret(base32) {
  return encrypt(base32);
}

/**
 * Verify a TOTP code against an encrypted stored secret.
 *
 * @param {string} storedSecret value from User.mfa.secret (encrypted)
 * @param {string} code         6-digit code as typed
 * @param {string} [email]      only used for the otpauth label
 * @returns {boolean}
 */
export function verifyTotp(storedSecret, code, email) {
  const cleaned = String(code || '').replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return false;

  const base32 = readSecret(storedSecret);
  if (!base32) return false;

  try {
    const delta = totpFromSecret(base32, email).validate({ token: cleaned, window: VALIDATION_WINDOW });
    return delta !== null;
  } catch {
    return false;
  }
}

/**
 * Consume a single-use recovery code.
 *
 * @param {object} user  Mongoose user document (mutated: the code is removed)
 * @param {string} code
 * @returns {boolean}
 */
export function consumeBackupCode(user, code) {
  const stored = user?.mfa?.backupCodes || [];
  if (!stored.length) return false;

  const candidate = hashBackupCode(code);
  const idx = stored.findIndex((h) => safeEqualHex(h, candidate));
  if (idx === -1) return false;

  // Single use: splice it out and persist.
  user.mfa.backupCodes.splice(idx, 1);
  return true;
}

/**
 * Login-time gate. Called from the NextAuth credentials provider AFTER the
 * password has already been verified, so a rejected code cannot be used to
 * probe whether the password was right.
 *
 * @param {object} p
 * @param {object} p.dbUser  plain user object (lean)
 * @param {string} [p.code]  TOTP or recovery code submitted with the login
 * @returns {{ok: boolean, method: string, error?: string, requiresEnrollment?: boolean}}
 */
export function evaluateMfa({ dbUser, code }) {
  if (!requiresMfa(dbUser)) return { ok: true, method: 'none' };

  const enrolled = !!dbUser?.mfa?.enabled && !!dbUser?.mfa?.secret;

  if (!enrolled) {
    if (REQUIRE_FOR_UNENROLLED) {
      return {
        ok: false,
        method: 'required',
        requiresEnrollment: true,
        error:
          'Multi-factor authentication is required for this account. ' +
          'Contact an administrator to complete enrolment.',
      };
    }
    // Enrolment is available but not mandatory — do not lock the operator out.
    return { ok: true, method: 'unenrolled', requiresEnrollment: true };
  }

  const submitted = String(code || '').trim();
  if (!submitted) {
    return { ok: false, method: 'totp', error: 'Enter the 6-digit code from your authenticator app.' };
  }

  if (verifyTotp(dbUser.mfa.secret, submitted, dbUser.email)) {
    return { ok: true, method: 'totp' };
  }

  // Recovery codes carry a hyphen; a 6-digit code never does. Checking them
  // here means a locked-out user with a saved code can still get in.
  if (submitted.includes('-') && (dbUser.mfa.backupCodes || []).length) {
    const candidate = hashBackupCode(submitted);
    const match = (dbUser.mfa.backupCodes || []).some((h) => safeEqualHex(h, candidate));
    // The hash is handed back because this function is given a lean object and
    // cannot persist. The caller MUST $pull it, or the code stays reusable.
    if (match) return { ok: true, method: 'backup_code', consumedCodeHash: candidate };
  }

  return { ok: false, method: 'totp', error: 'Invalid two-factor code.' };
}

export { ISSUER, BACKUP_CODE_COUNT, REQUIRE_FOR_UNENROLLED };
