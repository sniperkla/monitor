/**
 * PII masking helpers.
 *
 * Admin-facing listings used to return raw emails and full names for every
 * supporter and access requester. That is a real identity-identity linkage
 * (name <-> email) sitting behind a single admin endpoint, which is exactly
 * what makes credential-stuffing and social-engineering lists valuable.
 *
 * These helpers let admin UIs stay *operable* — an admin still needs to tell
 * two requesters apart — without shipping the plaintext identifier to the
 * browser. Actions are keyed off the internal user id instead of the email.
 */

const BULLET = '*';

/**
 * `how2playtlm1@gmail.com` -> `h***********@gmail.com`
 *
 * The domain is preserved on purpose: it is not identifying on its own, and it
 * lets an admin sanity-check that they are granting to the right person
 * (e.g. spotting a typo'd throwaway domain). The local part is fully masked
 * except for a single leading character, which is enough to distinguish
 * entries in a list without disclosing the address.
 */
export function maskEmail(value) {
  if (!value || typeof value !== 'string') return null;
  const at = value.indexOf('@');
  if (at <= 0) return BULLET.repeat(Math.min(value.length, 12));
  const local = value.slice(0, at);
  const domain = value.slice(at); // includes '@'
  const head = local.slice(0, 1);
  const tail = BULLET.repeat(Math.min(Math.max(local.length - 1, 1), 12));
  return `${head}${tail}${domain}`;
}

/**
 * `sawasdee chongchang` -> `S. C.`
 *
 * Initials only. Word count is preserved because an admin may need to tell
 * "one-word vs two-word" entries apart, but nothing recoverable remains.
 */
export function maskName(value) {
  if (!value || typeof value !== 'string') return null;
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => `${word[0].toUpperCase()}.`);
  return initials.length ? initials.join(' ') : null;
}

/**
 * A short, non-reversible hint for a configured-but-not-owned credential.
 * `1099079968623-jm27bjdl5e9pkrpau3bnag5o6qtcc1g1.apps.googleusercontent.com`
 * -> `…c1g1.apps.googleusercontent.com`
 *
 * Used when an OAuth client id comes from the server environment rather than
 * the signed-in user's own stored config: the UI needs to show *that something
 * is configured* without handing out the deployment-wide credential.
 */
export function maskTail(value, keep = 4) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= keep) return BULLET.repeat(value.length);
  return `…${value.slice(-keep)}`;
}

/**
 * Basename of a path — the only part of a server filepath that is safe to
 * show. `/tmp/backup_11074c24.tar.gz` -> `backup_11074c24.tar.gz`.
 */
export function basename(pathValue) {
  if (!pathValue || typeof pathValue !== 'string') return null;
  const clean = pathValue.replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}
