import mongoose from 'mongoose';

/**
 * ActivityLog — Human-readable "what did I do" timeline.
 *
 * One document per user-visible event (opened an app, uploaded a file,
 * restarted nginx, deploy finished, backup completed...).
 *
 * Categories: app | file | server | deploy | backup | sync | auth
 * Status:     success | error | info
 *
 * TTL index auto-purges entries older than 90 days.
 */
const ActivityLogSchema = new mongoose.Schema({
  userId:    { type: String, default: null, index: true },
  username:  { type: String, default: null },
  category:  { type: String, enum: ['app', 'file', 'server', 'deploy', 'backup', 'sync', 'auth'], default: 'app', index: true },
  action:    { type: String, required: true },   // e.g. 'app.open', 'upload.success', 'service.restart'
  message:   { type: String, required: true },   // human-readable, e.g. "Opened Server Monitor"
  target:    { type: String, default: null },    // e.g. app name / file name / server host
  status:    { type: String, enum: ['success', 'error', 'info'], default: 'success', index: true },
  meta:      { type: mongoose.Schema.Types.Mixed, default: null }, // extra structured details
  ip:        { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
}, {
  timestamps: false,
  versionKey: false,
});

// TTL: auto-delete after 90 days (7,776,000 seconds)
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// Recent-first queries per user and per category
ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ userId: 1, category: 1, createdAt: -1 });

export function getActivityLogModel(dbConnection) {
  const target = dbConnection || mongoose;
  return target.models.ActivityLog || target.model('ActivityLog', ActivityLogSchema);
}

export default mongoose.models.ActivityLog || mongoose.model('ActivityLog', ActivityLogSchema);