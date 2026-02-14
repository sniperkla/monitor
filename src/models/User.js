import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  image: String,
  googleId: String,

  // === VAULT (Zero-Knowledge Encrypted Private DB URI) ===
  // The privateDbUri is encrypted client-side with the user's Master Password.
  // The server NEVER sees the plaintext URI or the Master Password.
  vault: {
    // AES-256-GCM encrypted MongoDB URI (hex)
    encryptedUri: { type: String, default: '' },
    // PBKDF2 salt used for key derivation (hex)
    salt: { type: String, default: '' },
    // AES-GCM initialization vector (hex)
    iv: { type: String, default: '' },
    // SHA-256 hash of (password + salt) for password verification hint
    passwordHash: { type: String, default: '' },
    // Whether vault has been set up
    isConfigured: { type: Boolean, default: false },
  },

  // === RECOVERY ===
  // One-time code sent via email to reset the vault (destroys old encrypted data)
  recovery: {
    // SHA-256 hash of the recovery code
    codeHash: { type: String, default: '' },
    // Expiry (15 minutes from creation)
    expiresAt: { type: Date, default: null },
    // Rate limiting: last recovery request time
    lastRequestAt: { type: Date, default: null },
  },

  // === LEGACY (kept for backward compatibility during migration) ===
  privateDbUri: {
    type: String,
    default: '',
  },

  settings: {
    theme: { type: String, default: 'dark' },
    wallpaper: String,
    glassmorphism: { type: Boolean, default: true },
    iconPositions: { type: Object, default: {} },
    iconSize: { type: String, default: 'medium' },
    iconStyle: { type: String, default: 'glass' },
    sortBy: { type: String, default: 'name' },
    brightness: { type: Number, default: 100 },
    uiScale: { type: Number, default: 100 },
    language: { type: String, default: 'en' },
    notifications: { type: Object, default: { system: true, terminal: false, desktop: true } },
    customWallpapers: { type: [String], default: [] },
    taskbarPosition: { type: String, default: 'bottom' },
    openWindows: { type: [Object], default: [] }, // { id, appType, title, x, y, width, height, isMaximized, isMinimized, zIndex, props }
  }
}, {
  timestamps: true,
});

// We register this model on the default mongoose instance (DB Center)
export default mongoose.models.User || mongoose.model('User', UserSchema);
