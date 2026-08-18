/**
 * proxyClient.js — Client-side proxy encryption layer.
 *
 * Provides the encrypt/decrypt helpers used by apiFetch to tunnel
 * all API calls through POST /api/p as opaque AES-256-GCM blobs.
 *
 * Key lifecycle:
 *   1. On session init, call initProxyKey() — fetches GET /api/p/key once.
 *   2. All subsequent apiFetch calls use the cached CryptoKey automatically.
 *   3. On sign-out, call clearProxyKey().
 */

// Module-level key state — shared across all apiFetch calls
let _cryptoKey = null;       // CryptoKey object (SubtleCrypto)
let _initPromise = null;     // Deduplication — only one fetch at a time
let _sessionEmail = null;    // Track which user the key belongs to

// ── Helpers ────────────────────────────────────────────────────────────────

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

async function importRawKey(rawBase64) {
  const keyBytes = base64ToBytes(rawBase64);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,           // not extractable
    ['encrypt', 'decrypt']
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch the session key from the server and cache it.
 * Safe to call multiple times — only fetches once per session.
 *
 * @param {string} email — current user email (for key invalidation on switch)
 */
export async function initProxyKey(email) {
  // Already initialised for this user
  if (_cryptoKey && _sessionEmail === email) return;

  // Another init is in flight — wait for it
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const res = await fetch('/api/p/key', { credentials: 'include' });
      if (!res.ok) throw new Error(`Key fetch failed: ${res.status}`);
      const { key } = await res.json();
      _cryptoKey = await importRawKey(key);
      _sessionEmail = email;
    } catch (err) {
      console.warn('[proxyClient] key init failed:', err.message);
      _cryptoKey = null;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}

/** Call on sign-out to wipe the cached key. */
export function clearProxyKey() {
  _cryptoKey = null;
  _sessionEmail = null;
  _initPromise = null;
}

/** True when the proxy key is ready to use. */
export function isProxyReady() {
  return !!_cryptoKey;
}

/**
 * Encrypt a JSON-serialisable payload with the session AES-256-GCM key.
 * Returns a base64 string: base64( iv[12] || authTag[16] || ciphertext )
 */
export async function proxyEncrypt(obj) {
  if (!_cryptoKey) throw new Error('Proxy key not initialised');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));

  // SubtleCrypto AES-GCM appends the 16-byte auth tag to the ciphertext
  const cipherWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    _cryptoKey,
    plaintext
  );

  // Layout: iv(12) || tag(16) || ciphertext  — matches server's aesDecrypt()
  const cipherBytes = new Uint8Array(cipherWithTag);
  const ciphertext  = cipherBytes.slice(0, -16);
  const tag         = cipherBytes.slice(-16);

  const combined = new Uint8Array(12 + 16 + ciphertext.length);
  combined.set(iv,         0);
  combined.set(tag,        12);
  combined.set(ciphertext, 28);

  return bytesToBase64(combined);
}

/**
 * Decrypt a base64 response produced by the server's aesEncrypt().
 * Returns the parsed JSON object.
 */
export async function proxyDecrypt(b64) {
  if (!_cryptoKey) throw new Error('Proxy key not initialised');

  const buf = base64ToBytes(b64);
  const iv         = buf.slice(0,  12);
  const tag        = buf.slice(12, 28);
  const ciphertext = buf.slice(28);

  // Reassemble in SubtleCrypto's expected format: ciphertext || tag
  const cipherWithTag = new Uint8Array(ciphertext.length + 16);
  cipherWithTag.set(ciphertext, 0);
  cipherWithTag.set(tag, ciphertext.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    _cryptoKey,
    cipherWithTag
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}
