const mongoose = require('mongoose');
const { encrypt } = require('../src/utils/encryption');
const path = require('path');
const fs = require('fs');

// Simple .env parser to avoid dependency on dotenv
function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      });
      console.log('✅ Loaded environment variables from .env');
    } else {
      console.warn('⚠️ .env file not found');
    }
  } catch (error) {
    console.error('❌ Error loading .env:', error);
  }
}

loadEnv();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ssh-monitor';

// Connection schema (Matches server.js implementation more closely since it uses require)
const ConnectionSchema = new mongoose.Schema({
  name: String,
  host: String,
  port: { type: Number, default: 22 },
  username: String,
  authType: String,
  password: String,
  privateKey: String,
  keyFileName: String,
  passphrase: String,
  tags: [String],
  color: { type: String, default: '#6366f1' },
  lastConnected: Date,
  status: { type: String, default: 'unknown' },
  isFavorite: { type: Boolean, default: false },
  notes: String,
}, { timestamps: true });

const ConnectionModel = mongoose.models.Connection || mongoose.model('Connection', ConnectionSchema);

async function migrate() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const connections = await ConnectionModel.find({});
    console.log(`🔍 Found ${connections.length} connections to check.`);

    let updatedCount = 0;

    for (const conn of connections) {
      let modified = false;

      // Check Password
      if (conn.password && !isEncrypted(conn.password)) {
        console.log(`🔒 Encrypting password for: ${conn.name}`);
        conn.password = encrypt(conn.password);
        modified = true;
      }

      // Check Private Key
      if (conn.privateKey && !isEncrypted(conn.privateKey)) {
        // Skip if it looks like a PPK or other formats that might need special handling? 
        // No, just encrypt everything as string.
        console.log(`🔒 Encrypting private key for: ${conn.name}`);
        conn.privateKey = encrypt(conn.privateKey);
        modified = true;
      }

      // Check Passphrase
      if (conn.passphrase && !isEncrypted(conn.passphrase)) {
        console.log(`🔒 Encrypting passphrase for: ${conn.name}`);
        conn.passphrase = encrypt(conn.passphrase);
        modified = true;
      }

      if (modified) {
        await conn.save();
        updatedCount++;
      }
    }

    console.log(`✨ Migration complete. Updated ${updatedCount} connections.`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Helper to check if a string is already encrypted
// Format: 32 hex chars (IV) + ':' + hex string (Data)
function isEncrypted(text) {
  if (!text) return false;
  // Encrypted format: IV(32 hex) : Data(hex)
  // IV is 16 bytes = 32 hex chars.
  // Data is at least 1 block (16 bytes = 32 hex chars) but can be more.
  return /^[0-9a-f]{32}:[0-9a-f]+$/i.test(text);
}

migrate();
