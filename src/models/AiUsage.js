import mongoose from 'mongoose';

/**
 * AiUsage Model — Tracks per-user daily AI token consumption.
 * 
 * Stored in the CENTRAL database (default mongoose connection).
 * Each user has at most ONE document, upserted automatically.
 * 
 * Daily reset happens at midnight UTC+7 by comparing `dayKey`.
 * The global daily limit (e.g. 10,000) is stored in SystemSetting key='ai_limits'.
 */
const AiUsageSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // The UTC+7 day string, e.g. "2026-02-18"
  dayKey: {
    type: String,
    default: '',
  },
  // Tokens used today (resets when dayKey changes)
  tokensUsed: {
    type: Number,
    default: 0,
  },
  // Last time usage was updated
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

export default mongoose.models.AiUsage || mongoose.model('AiUsage', AiUsageSchema);
