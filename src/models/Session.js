import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema({
  connectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Connection',
    required: true,
  },
  startTime: {
    type: Date,
    default: Date.now,
  },
  endTime: {
    type: Date,
    default: null,
  },
  duration: {
    type: Number, // in seconds
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'closed', 'error'],
    default: 'active',
  },
  errorMessage: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

export default mongoose.models.Session || mongoose.model('Session', SessionSchema);
