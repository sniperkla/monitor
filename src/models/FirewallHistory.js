import mongoose from 'mongoose';

/**
 * FirewallHistory — time-series of cumulative kernel block counters.
 *
 * Written by the ServerMonitor agent running on the target server (background
 * sampler, 24/7) so attack history is recorded even when no dashboard is open.
 * Mirrors MetricsHistory conventions: indexed on (connectionId + recordedAt),
 * TTL auto-purges old samples.
 */
const FirewallHistorySchema = new mongoose.Schema({
  connectionId: {
    type: String,
    required: true,
    index: true,
  },
  recordedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  packets: { type: Number, default: 0 }, // cumulative blocked packets (INPUT + DOCKER-USER + FORWARD)
  bytes:   { type: Number, default: 0 }, // cumulative blocked bytes
  source:  { type: String, default: 'agent', enum: ['agent', 'app'] }, // who recorded the sample
}, {
  timestamps: false,
  versionKey: false,
});

FirewallHistorySchema.index({ connectionId: 1, recordedAt: 1 });
FirewallHistorySchema.index({ connectionId: 1, recordedAt: -1 });

// TTL: auto-delete after 7 days (604800 seconds)
FirewallHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 604800 });

export default mongoose.models.FirewallHistory
  || mongoose.model('FirewallHistory', FirewallHistorySchema);
