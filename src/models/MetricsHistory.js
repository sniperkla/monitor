import mongoose from 'mongoose';

/**
 * MetricsHistory — Time-series snapshots for the Server Monitor.
 * 
 * One document per poll cycle per connection.
 * TTL index auto-purges documents older than 24 hours.
 * Indexed on (connectionId + recordedAt) for efficient range queries.
 */
const MetricsHistorySchema = new mongoose.Schema({
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
  cpu:     { type: Number, default: null }, // percentage 0-100
  ram:     { type: Number, default: null }, // percentage 0-100
  rxBytes: { type: Number, default: null }, // bytes/s receive rate
  txBytes: { type: Number, default: null }, // bytes/s transmit rate
  disk:    { type: Number, default: null }, // primary disk used percentage 0-100
}, {
  // No createdAt/updatedAt overhead — recordedAt is enough
  timestamps: false,
  versionKey: false,
});

// Compound indexes for fast range queries per server (both ascending and descending scans)
MetricsHistorySchema.index({ connectionId: 1, recordedAt: 1 });
MetricsHistorySchema.index({ connectionId: 1, recordedAt: -1 });

// TTL: auto-delete after 30 days (2,592,000 seconds)
MetricsHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.models.MetricsHistory
  || mongoose.model('MetricsHistory', MetricsHistorySchema);
