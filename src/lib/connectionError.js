/**
 * Client-safe messages for database connection failures.
 *
 * The /api/connections/test-uri endpoint used to return the raw driver error
 * text whenever the error code wasn't one of the few it recognised. Driver
 * messages are far more descriptive than that sounds: the MongoDB driver in
 * particular embeds topology detail, e.g.
 *
 *   "connection <monitor> to 127.0.0.1:33653 closed"
 *
 * which hands out an internal hostname and an ephemeral relay port. That is
 * an information-disclosure path that does not require SSRF at all — any
 * authenticated user can trigger it with a malformed URI.
 *
 * Policy: recognise what we can and answer with a useful message; log the
 * raw detail server-side (where the server owner can still read it) and give
 * the client a generic message for everything else.
 */

export const CONNECTION_ERROR_MESSAGES = {
  refused: 'ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้ โปรดตรวจสอบ URI และตรวจสอบว่าฐานข้อมูลกำลังทำงานอยู่',
  timeout: 'การเชื่อมต่อหมดเวลา ตรวจสอบที่อยู่โฮสต์และพอร์ต',
  auth: 'การยืนยันตัวตนล้มเหลว ตรวจสอบชื่อผู้ใช้และรหัสผ่าน',
  missingDb: 'ไม่พบฐานข้อมูลที่ระบุ โปรดตรวจสอบชื่อฐานข้อมูล',
  dns: 'ไม่สามารถแปลงชื่อโฮสต์เป็น IP ได้ โปรดตรวจสอบชื่อโฮสต์',
  generic: 'ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้ โปรดตรวจสอบ URI และการตั้งค่าเครือข่าย',
};

/**
 * Map a driver error to a message that is safe to return to the client.
 *
 * Codes are driver-specific (mysql2 uses ER_*, pg uses SQLSTATE strings,
 * the mongo driver mostly relies on message text), so we match on both.
 *
 * @param {unknown} error
 * @param {{ onWithheld?: (raw: string) => void }} [options] — optional hook so
 *   the caller can route the withheld detail to its own logger. Kept optional
 *   to keep this module dependency-free and directly unit-testable.
 * @returns {string} one of CONNECTION_ERROR_MESSAGES
 */
export function safeConnectionError(error, options = {}) {
  const code = error?.code;
  const raw = String(error?.message || '');
  // Message text is matched case-insensitively: the MongoDB driver emits
  // "Authentication failed." with a capital A, and the previous inline check
  // (lowercase 'authentication failed') missed it entirely, which meant that
  // very common failure fell through to the raw driver text.
  const text = raw.toLowerCase();

  if (code === 'ECONNREFUSED' || text.includes('econnrefused')) {
    return CONNECTION_ERROR_MESSAGES.refused;
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    text.includes('etimedout') ||
    text.includes('timed out')
  ) {
    return CONNECTION_ERROR_MESSAGES.timeout;
  }

  if (
    code === 'ER_ACCESS_DENIED_ERROR' ||
    code === '28P01' ||
    code === '28000' ||
    text.includes('authentication failed') ||
    text.includes('access denied')
  ) {
    return CONNECTION_ERROR_MESSAGES.auth;
  }

  if (code === '3D000' || code === 'ER_BAD_DB_ERROR' || text.includes('does not exist')) {
    return CONNECTION_ERROR_MESSAGES.missingDb;
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || text.includes('getaddrinfo')) {
    return CONNECTION_ERROR_MESSAGES.dns;
  }

  // Unrecognised. The raw text may carry internal topology — keep it out of
  // the response and record it where the operator can still read it.
  if (typeof options.onWithheld === 'function') {
    options.onWithheld(raw);
  }
  return CONNECTION_ERROR_MESSAGES.generic;
}
