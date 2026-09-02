import mongoose from 'mongoose';

/**
 * Per-user API keys.
 *
 * Purpose
 * -------
 * A browser session is an all-powerful bearer credential: whatever the user can
 * do, the session can do, for as long as it lives. That is fine for a human at
 * a keyboard and wrong for a cron job, a CI pipeline, or a script that only
 * ever needs to trigger one backup. Those get a scoped key instead.
 *
 * Properties that matter
 * ----------------------
 *  - Scoped. A key carries an explicit list of permissions. A key that can only
 *    read connections cannot delete them, even if the script using it is
 *    compromised.
 *  - Revocable without a re-login. Revoking a key is a database write. It does
 *    not touch the user's session, so it does not sign them out, and it does
 *    not invalidate their other keys.
 *  - Hashed at rest. Only the SHA-256 of the key is stored, so a database dump
 *    does not yield usable credentials. The plaintext is shown exactly once, at
 *    creation.
 *  - Identifiable. `prefix` is stored in the clear so a user can tell which row
 *    in the list corresponds to which script.
 *
 * Deliberately NOT grantable: admin scopes. Administrative actions require a
 * real interactive session. A leaked key must never be able to escalate.
 */

const ApiKeySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, default: '' },

  /** Non-secret display identifier, e.g. the first 11 chars of the key. */
  prefix: { type: String, required: true },

  /** SHA-256 of the full key. Never store the key itself. */
  keyHash: { type: String, required: true, unique: true },

  /** Permission list — see SCOPES in src/lib/apiAuth.js. */
  scopes: { type: [String], default: [] },

  lastUsedAt: { type: Date, default: null },
  lastUsedIp: { type: String, default: null },
  expiresAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
  versionKey: false,
});

// Listing a user's active keys.
ApiKeySchema.index({ userId: 1, revokedAt: 1, createdAt: -1 });

export default mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema);
