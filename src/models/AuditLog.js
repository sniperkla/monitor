import mongoose from 'mongoose';

/**
 * AuditLog — Immutable trail of privileged actions (app start/stop/update/etc.)
 *
 * One document per executed action. TTL index auto-purges after 90 days.
 * Never updated after insert; only queried for review/compliance.
 */
const AuditLogSchema = new mongoose.Schema({
  userId:    { type: String, default: null, index: true },
  username:  { type: String, default: null },
  connectionId: { type: String, default: null, index: true },
  host:      { type: String, default: null },   // target server host (no credentials)
  appName:   { type: String, default: null },
  action:    { type: String, required: true },
  version:   { type: String, default: null },
  success:   { type: Boolean, default: false },
  exitCode:  { type: Number, default: null },
  error:     { type: String, default: null },   // truncated failure reason
  ip:        { type: String, default: null },   // client IP (x-forwarded-for aware)
  createdAt: { type: Date, default: Date.now, index: true },
}, {
  timestamps: false,
  versionKey: false,
});

// TTL: auto-delete after 90 days (7,776,000 seconds)
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// Recent-first queries per user / per server
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ connectionId: 1, createdAt: -1 });

export function getAuditLogModel(dbConnection) {
  const target = dbConnection || mongoose;
  return target.models.AuditLog || target.model('AuditLog', AuditLogSchema);
}

export default mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);