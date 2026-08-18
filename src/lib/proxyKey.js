/**
 * proxyKey.js — Server-side proxy key derivation.
 *
 * Derives a per-session AES-256-GCM key from:
 *   HKDF( NEXTAUTH_SECRET, sessionToken, "ssh-monitor-proxy-v1" )
 *
 * The client never sees the raw server secret — it only receives the
 * session-scoped key wrapped (encrypted) with a short-lived transport key.
 * Every new login produces a different proxy key.
 */

import { createHmac, randomBytes } from 'crypto';

const PROXY_INFO = 'ssh-monitor-proxy-v1';

/**
 * Derive a 32-byte AES-256-GCM key for a specific session token.
 * Pure HMAC-SHA256 based HKDF — no external dependencies.
 *
 * @param {string} sessionToken  — raw next-auth JWT cookie value
 * @returns {Buffer}             — 32-byte key
 */
export function deriveProxyKey(sessionToken) {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.ENCRYPTION_KEY ||
    'b5caf31cfa8c03a8ac8350f76e35eee30ed4e1d57f25596f900a558e6c98c04e';

  // HKDF-extract: PRK = HMAC-SHA256(salt=secret, IKM=sessionToken)
  const prk = createHmac('sha256', secret)
    .update(sessionToken)
    .digest();

  // HKDF-expand: OKM = HMAC-SHA256(PRK, info || 0x01)
  const okm = createHmac('sha256', prk)
    .update(PROXY_INFO + '\x01')
    .digest();

  return okm; // 32 bytes = AES-256 key
}

/**
 * Encrypt plaintext bytes with AES-256-GCM using the given key buffer.
 *
 * @param {Buffer} keyBuf        — 32-byte key
 * @param {Buffer|string} data   — plaintext
 * @returns {string}             — base64( iv[12] || authTag[16] || ciphertext )
 */
export function aesEncrypt(keyBuf, data) {
  const { createCipheriv, randomBytes } = require('crypto');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a base64 payload produced by aesEncrypt / the client.
 *
 * @param {Buffer} keyBuf   — 32-byte key
 * @param {string} b64      — base64( iv[12] || authTag[16] || ciphertext )
 * @returns {Buffer}        — plaintext bytes
 */
export function aesDecrypt(keyBuf, b64) {
  const { createDecipheriv } = require('crypto');
  const buf = Buffer.from(b64, 'base64');
  const iv      = buf.subarray(0, 12);
  const tag     = buf.subarray(12, 28);
  const payload = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]);
}
