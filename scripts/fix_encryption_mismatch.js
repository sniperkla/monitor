const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 1. Load Real Env
let REAL_SECRET = '';
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && key.trim() === 'ENCRYPTION_KEY') {
        REAL_SECRET = value.trim();
      }
      if (key && key.trim() === 'MONGODB_URI') {
        process.env.MONGODB_URI = value.trim();
      }
    });
  }
} catch (e) { console.error('Error loading .env', e); }

if (!REAL_SECRET) {
  console.error('❌ Could not find ENCRYPTION_KEY in .env');
  process.exit(1);
}

const FALLBACK_SECRET = 'development_fallback_secret_key_32_chars';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ssh-monitor';

// Crypto Helpers
const IV_LENGTH = 16;
const REAL_KEY = crypto.createHash('sha256').update(String(REAL_SECRET)).digest();
const FALLBACK_KEY = crypto.createHash('sha256').update(String(FALLBACK_SECRET)).digest();

function decrypt(text, key) {
  if (!text) return text;
  try {
    const textParts = text.split(':');
    if (textParts.length < 2) return null; // Not encrypted format
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    return null; // Decryption failed
  }
}

function encrypt(text, key) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Encryption error:', error);
    return text;
  }
}

// Minimal Schema
const ConnectionSchema = new mongoose.Schema({
  name: String,
  password: String,
  privateKey: String,
  passphrase: String,
}, { strict: false });

const ConnectionModel = mongoose.models.Connection || mongoose.model('Connection', ConnectionSchema);

async function fix() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected');

    const connections = await ConnectionModel.find({});
    console.log(`🔍 Found ${connections.length} connections.`);

    let fixedCount = 0;

    for (const conn of connections) {
      let modified = false;
      const fields = ['password', 'privateKey', 'passphrase'];

      for (const field of fields) {
        if (!conn[field]) continue;

        // Try decrypting with FALLBACK key
        const decryptedFallback = decrypt(conn[field], FALLBACK_KEY);
        
        // Try decrypting with REAL key to see if it's already correct
        const decryptedReal = decrypt(conn[field], REAL_KEY);

        if (decryptedReal !== null) {
            // It decrypts with the real key, so it's likely fine?
            // Unless the plaintext just happened to be decryptable garbage.
            // But if fallback also works, we have a conflict.
            // Usually valid text (like private key) is recognizable.
            // Given the history, it's 99% likely incorrect if it was migrated by the broken script.
            console.log(`   ℹ️ Field ${field} for ${conn.name} decrypts with REAL key. Skipping.`);
            continue; 
        }

        if (decryptedFallback !== null) {
           console.log(`   🛠️  Fixing ${field} for ${conn.name} (Decrypts with Fallback Key)`);
           const newEncrypted = encrypt(decryptedFallback, REAL_KEY);
           conn[field] = newEncrypted;
           modified = true;
        } else {
            console.log(`   ⚠️  Field ${field} for ${conn.name} failed to decrypt with EITHER key. It might be plain text or corrupted.`);
            // If it's plain text (not hex:hex), decrypt returns null because of split check.
            // If it's plain text, we should encrypt it with REAL key?
            // The migration script would have encrypted it.
            // If migration script ran, it IS encrypted with fallback key.
            // Why would decrypt fail? Maybe invalid IV length?
        }
      }

      if (modified) {
        await conn.save();
        fixedCount++;
        console.log(`   ✅ Saved ${conn.name}`);
      }
    }

    console.log(`✨ Fix complete. Updated ${fixedCount} connections.`);

  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fix();
