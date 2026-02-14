import { argon2id } from 'hash-wasm';

/**
 * Client-side Zero-Knowledge Encryption Utilities
 * 
 * UPGRADED: Now uses Argon2id (WebAssembly) for elite-tier key derivation.
 * - Argon2id: Memory-hard, resistant to GPU/ASIC brute-force
 * - AES-256-GCM: Authenticated encryption
 */

const ARGON2_CONFIG = {
  iterations: 3,
  memorySize: 65536, // 64 MB
  parallelism: 1,
  hashLength: 32, // 256 bits for AES-256
};

const SALT_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * Convert an ArrayBuffer to a hex string
 */
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string to a Uint8Array
 */
function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Derive an AES-256-GCM key from a master password + salt using Argon2id
 */
async function deriveKey(masterPassword, salt) {
  // Generate a high-security hash using Argon2id (WebAssembly)
  const hash = await argon2id({
    password: masterPassword,
    salt: salt,
    ...ARGON2_CONFIG,
    outputType: 'binary',
  });

  // Import the hash as a raw key for AES-256-GCM
  const key = await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  // SECURE WIPE: Clear the raw hash buffer from memory
  hash.fill(0);

  return key;
}

/**
 * Encrypt plaintext with a master password.
 * Returns: { encrypted (hex), salt (hex), iv (hex) }
 * 
 * The server stores these 3 values. Without the master password,
 * it's computationally infeasible to recover the plaintext.
 */
export async function encryptWithPassword(plaintext, masterPassword) {
  const encoder = new TextEncoder();

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive key from password
  const key = await deriveKey(masterPassword, salt);

  // Encrypt with AES-256-GCM (provides both confidentiality AND integrity)
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  const result = {
    encrypted: bufferToHex(encryptedBuffer),
    salt: bufferToHex(salt),
    iv: bufferToHex(iv),
  };

  // SECURE WIPE: Clear sensitive byte arrays from memory
  salt.fill(0);
  iv.fill(0);

  return result;
}

/**
 * Decrypt encrypted data with a master password.
 * Returns the plaintext string, or throws if password is wrong.
 * 
 * AES-GCM will throw an error if the password is wrong (authentication tag mismatch),
 * so we can detect incorrect passwords.
 */
export async function decryptWithPassword(encryptedHex, saltHex, ivHex, masterPassword) {
  const decoder = new TextDecoder();

  const salt = hexToBuffer(saltHex);
  const iv = hexToBuffer(ivHex);
  const encryptedData = hexToBuffer(encryptedHex);

  // Derive the same key from password
  const key = await deriveKey(masterPassword, salt);

  try {
    // Decrypt — AES-GCM will throw if password is wrong (auth tag mismatch)
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedData
    );

    const decryptedStr = decoder.decode(decryptedBuffer);

    // SECURE WIPE: Clear sensitive byte arrays from memory
    salt.fill(0);
    iv.fill(0);
    encryptedData.fill(0);

    return decryptedStr;
  } catch (error) {
    // SECURE WIPE: Clear on failure too
    salt.fill(0);
    iv.fill(0);
    encryptedData.fill(0);
    
    // OperationError = wrong password (GCM auth tag mismatch)
    throw new Error('WRONG_PASSWORD');
  }
}

/**
 * Hash the master password for verification purposes.
 * Uses Argon2id for maximum security against brute-force.
 */
export async function hashPassword(password, saltHex) {
  const salt = hexToBuffer(saltHex || bufferToHex(crypto.getRandomValues(new Uint8Array(SALT_LENGTH))));
  
  const hash = await argon2id({
    password: password,
    salt: salt,
    ...ARGON2_CONFIG,
    outputType: 'hex',
  });

  // Wipe salt if it was converted
  if (saltHex) salt.fill(0);
  
  return hash;
}
