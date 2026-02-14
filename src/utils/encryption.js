const crypto = require('crypto');

const SECRET_KEY = process.env.ENCRYPTION_KEY || 'development_fallback_secret_key_32_chars';
const SECRET_KEY_OLD = process.env.ENCRYPTION_KEY_OLD;

// Use SHA-256 to ensure key is exactly 32 bytes
const KEY = crypto.createHash('sha256').update(String(SECRET_KEY)).digest();
const OLD_KEY = SECRET_KEY_OLD ? crypto.createHash('sha256').update(String(SECRET_KEY_OLD)).digest() : null;

const IV_LENGTH = 16; 

function encrypt(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
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

function decrypt(text) {
  const result = decryptWithMetadata(text);
  return result.text;
}

function decryptWithMetadata(text) {
  if (!text) return { text, success: true, usedOldKey: false };
  
  // Quick check: if not colon-separated hex, assume plain text (legacy/manual)
  if (!text.includes(':')) return { text, success: true, usedOldKey: false };

  try {
    // Try current key first
    return { text: decryptWithKey(text, KEY), success: true, usedOldKey: false };
  } catch (error) {
    // If current key fails, try old key (Key Rotation)
    if (OLD_KEY) {
      try {
        const decrypted = decryptWithKey(text, OLD_KEY);
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

module.exports = { encrypt, decrypt, decryptWithMetadata };
