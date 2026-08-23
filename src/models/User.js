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
  password: {
    type: String,
    select: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },

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

  // === EMAIL VERIFICATION & PASSWORD RESET ===
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerification: {
    codeHash: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    lastRequestAt: { type: Date, default: null },
  },
  passwordReset: {
    codeHash: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    lastRequestAt: { type: Date, default: null },
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
    windowLayout: { type: String, default: 'mac' },
    keyboardShortcuts: { type: Object, default: {} },
    desktops: { type: [Object], default: [] },
    currentDesktopId: { type: String, default: 'desktop-1' },
    windowsByDesktop: { type: Object, default: {} },
    terminalSettings: { type: Object, default: {} },
    exportNaming: { type: Object, default: {} },
    aiHistory: { type: [Object], default: [] },
    sshAiHistory: { type: [Object], default: [] },
    sshAiPrefs: { type: Object, default: {} },
    openWindows: { type: [Object], default: [] }, // { id, appType, title, x, y, width, height, isMaximized, isMinimized, zIndex, props }
    timestamp: { type: Number, default: 0 },
    aiUsage: {
      dailyLimit: { type: Number, default: 10000 },
      tokensUsedToday: { type: Number, default: 0 },
      lastUsageReset: { type: Date, default: Date.now },
      lastResetDayKey: { type: String, default: '' }
    }
  },

  // === SUPPORTER (Ko-fi membership — unlocks Local Relay + speed profiles) ===
  // Granted manually by an admin or via activation code. Lazy expiry — no sweeper needed.
  supporter: {
    status: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }, // null = no expiry set yet
    source: { type: String, enum: ['admin', 'code', 'kofi'], default: 'admin' },
    grantedAt: { type: Date, default: null },
    grantedBy: { type: String, default: '' }, // admin email
    note: { type: String, default: '' },
    // Access request submitted by the user after subscribing on Ko-fi
    request: {
      kofiName: { type: String, default: '' },
      kofiEmail: { type: String, default: '' },
      note: { type: String, default: '' },
      requestedAt: { type: Date, default: null },
      status: { type: String, enum: ['pending', 'granted', 'dismissed'], default: 'pending' },
    },
  },

  // === SYNCED CONNECTIONS (Zero-Knowledge Encrypted) ===
  // Encrypted client-side with the vault master password.
  // The server NEVER sees plaintext connection data.
  syncedConnections: [{
    fingerprint: { type: String, required: true },  // hash of name+host+type for dedup
    name: { type: String, default: '' },             // plaintext display name (not sensitive)
    host: { type: String, default: '' },             // plaintext host for display
    type: { type: String, default: 'ssh' },          // ssh or database
    encryptedData: { type: String, required: true }, // AES-256-GCM encrypted JSON blob (hex)
    salt: { type: String, required: true },           // Argon2id salt (hex)
    iv: { type: String, required: true },             // AES-GCM IV (hex)
    syncedAt: { type: Date, default: Date.now },
  }],
}, {
  timestamps: true,
});

// We register this model on the default mongoose instance (DB Center)
export default mongoose.models.User || mongoose.model('User', UserSchema);
