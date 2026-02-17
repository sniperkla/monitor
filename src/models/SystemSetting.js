import mongoose from 'mongoose';

const SystemSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  value: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

export default mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);
