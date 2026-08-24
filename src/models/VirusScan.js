import mongoose from 'mongoose';

/**
 * VirusScan — Heuristic security scan runs against a server (via SSH).
 *
 * One document per scan run. Findings are embedded so a scan is an
 * immutable snapshot of what was detected at scan time.
 *
 * Finding severity: critical | high | medium | low
 * Finding status:   open | quarantined | deleted | ignored | resolved
 */
const FindingSchema = new mongoose.Schema({
  _id:        { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  checkId:    { type: String, required: true },   // which heuristic matched, e.g. 'miner-process'
  category:   { type: String, required: true },   // process | file | cron | auth | network | system
  severity:   { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true },
  title:      { type: String, required: true },
  detail:     { type: String, default: '' },
  path:       { type: String, default: null },    // file path / process name involved
  pid:        { type: Number, default: null },    // for process findings
  evidence:   { type: String, default: '' },      // raw matching line(s)
  status:     { type: String, enum: ['open', 'quarantined', 'deleted', 'ignored', 'resolved'], default: 'open' },
  quarantinePath: { type: String, default: null },
  actedAt:    { type: Date, default: null },
}, { _id: false });

const VirusScanSchema = new mongoose.Schema({
  userId:         { type: String, required: true, index: true },
  connectionId:   { type: String, required: true },
  host:           { type: String, default: null },
  status:         { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  mode:           { type: String, enum: ['quick', 'deep', 'full'], default: 'deep' },
  progress:       { type: Number, default: 0 },          // 0-100
  currentCheck:   { type: String, default: null },       // human label of in-flight check
  findings:       { type: [FindingSchema], default: [] },
  summary: {
    critical: { type: Number, default: 0 },
    high:     { type: Number, default: 0 },
    medium:   { type: Number, default: 0 },
    low:      { type: Number, default: 0 },
  },
  error:          { type: String, default: null },
  durationMs:     { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now, index: true },
}, { timestamps: false, versionKey: false });

// Keep only the most recent scans per user (TTL not ideal since we want history;
// the API prunes old runs instead).
VirusScanSchema.index({ userId: 1, createdAt: -1 });

export function getVirusScanModel(dbConnection) {
  const target = dbConnection || mongoose;
  return target.models.VirusScan || target.model('VirusScan', VirusScanSchema);
}

export default mongoose.models.VirusScan || mongoose.model('VirusScan', VirusScanSchema);