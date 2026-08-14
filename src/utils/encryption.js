const crypto = require('crypto');

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'development_fallback_secret_key_32_chars';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function getOldKey() {
  const secret = process.env.ENCRYPTION_KEY_OLD;
  return secret ? crypto.createHash('sha256').update(String(secret)).digest() : null;
}

const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Encryption error:', error);
    return text; 
  }
}

function decryptWithKey(text, key) {
  const textParts = text.split(':');
  if (textParts.length < 2) throw new Error('Not encrypted format'); // stricter check for our use-case
  
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

/**
 * Encrypt using a user-provided password.
 * Format: salt:iv:ciphertext
 */
function encryptWithPassword(text, password) {
  if (!text || !password) return text;
  try {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Password encryption error:', error);
    return text;
  }
}

/**
 * Decrypt using a user-provided password.
 */
function decryptWithPassword(encryptedText, password) {
  if (!encryptedText || !password) return null;
  try {
    const parts = encryptedText.split(':');
    if (parts.length < 3) return null; // Expected salt:iv:ciphertext
    
    const salt = Buffer.from(parts.shift(), 'hex');
    const iv = Buffer.from(parts.shift(), 'hex');
    const ciphertext = Buffer.from(parts.join(':'), 'hex');
    
    const key = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Password decryption error:', error.message);
    return null;
  }
}

function decrypt(text) {
  const result = decryptWithMetadata(text);
  if (!result.success) {
    throw new Error('Decryption failed');
  }
  return result.text;
}

function decryptWithMetadata(text) {
  if (!text) return { text, success: true, usedOldKey: false };
  
  // Quick check: if not colon-separated hex, assume plain text (legacy/manual)
  if (!text.includes(':')) return { text, success: true, usedOldKey: false };

  const currentKey = getKey();
  const oldKey = getOldKey();

  try {
    // Try current key first
    return { text: decryptWithKey(text, currentKey), success: true, usedOldKey: false };
  } catch (error) {
    // If current key fails, try old key (Key Rotation)
    if (oldKey) {
      try {
        const decrypted = decryptWithKey(text, oldKey);
        return { text: decrypted, success: true, usedOldKey: true };
      } catch (oldError) {
        // Both failed
        console.error('Decryption error (both keys failed):', error.message);
        return { text, success: false, usedOldKey: false };
      }
    }
    
    // Only current key available and failed
    console.error('Decryption error:', error.message);
    return { text, success: false, usedOldKey: false };
  }
}

module.exports = { 
  encrypt, 
  decrypt, 
  decryptWithMetadata,
  encryptWithPassword,
  decryptWithPassword
};
