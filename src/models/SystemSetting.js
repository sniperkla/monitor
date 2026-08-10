import mongoose from 'mongoose';

const SystemSettingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed, // Support both String and ObjectId during migration
    required: true, // userId is now required - no global fallback
    index: true,
  },
  key: {
    type: String,
    required: true,
  },
  value: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

// Compound unique index: each (userId, key) pair must be unique
SystemSettingSchema.index({ userId: 1, key: 1 }, { unique: true });

export default mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);
