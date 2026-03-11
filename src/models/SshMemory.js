import mongoose from 'mongoose';

/**
 * SshMemory — per-user, per-host persistent AI brain.
 * Each document is a "brain cell" for one user on one host.
 * The AI reads & writes this to remember facts across sessions.
 */
const SshMemorySchema = new mongoose.Schema({
  // Owner — stored per user so no cross-user leaks
  userId: {
    type: String,
    required: true,
    index: true,
  },

  // Identifies the target server (hostname or IP)
  host: {
    type: String,
    required: true,
    index: true,
  },

  // Human label, e.g. "Production Web Server"
  label: {
    type: String,
    default: '',
  },

  // ── Core Facts ─────────────────────────────────────────────────────────────
  // Detected OS / distro
  os: { type: String, default: '' },

  // Login user
  loginUser: { type: String, default: '' },

  // Default working directory or project root the user cares about
  workingDir: { type: String, default: '' },

  // Key paths the user mentioned or were discovered
  keyPaths: [{ type: String }],

  // Installed tools / packages confirmed present on this host
  installedTools: [{ type: String }],

  // Running services confirmed on this host
  runningServices: [{ type: String }],

  // Package manager detected (apt / dnf / brew / apk / yum / pacman)
  packageManager: { type: String, default: '' },

  // ── Session History ─────────────────────────────────────────────────────────
  // Past goals that were completed — capped to last 20
  completedGoals: [{
    goal: String,
    summary: String,       // 1-sentence AI summary of what was done
    stepsCount: Number,
    completedAt: { type: Date, default: Date.now },
  }],

  // ── Free-form Notes ─────────────────────────────────────────────────────────
  // Anything the AI or user wants to remember — max 50 entries
  notes: [{
    content: String,
    source: { type: String, enum: ['ai', 'user'], default: 'ai' },
    addedAt: { type: Date, default: Date.now },
  }],

  // ── Reminders ──────────────────────────────────────────────────────────────
  // Persistent diagnostic commands or maintenance tips — max 30 entries
  reminders: [{
    title: { type: String, required: true },
    command: { type: String, required: true },
    category: { type: String, default: 'general' }, // ‘nginx’, ‘pm2’, ‘system’
    addedAt: { type: Date, default: Date.now },
  }],

  // ── Meta ───────────────────────────────────────────────────────────────────
  lastSeenAt: { type: Date, default: Date.now },
  sessionCount: { type: Number, default: 0 },

}, { timestamps: true });

// Compound index — one brain per user per host
SshMemorySchema.index({ userId: 1, host: 1 }, { unique: true });

export function getSshMemoryModel(dbConnection) {
  // If no specific connection provided, fallback to default global mongoose
  const target = dbConnection || mongoose;
  
  // Safety check for SQL connections that might be passed accidentally
  if (!target || typeof target !== 'object' || (!target.models && target.type)) {
    console.warn('[SshMemory] Requested model for non-Mongoose connection. Use SshMemoryRepository instead.');
    return null;
  }

  return target.models?.SshMemory || target.model?.('SshMemory', SshMemorySchema);
}

export default mongoose.models.SshMemory || mongoose.model('SshMemory', SshMemorySchema);
