import mongoose from 'mongoose';

const AiHistorySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String, // 'terminal', 'database', 'wiki', 'general'
    required: true,
    index: true
  },
  title: {
    type: String, // e.g. the goal or prompt title
    required: true
  },
  context: {
    type: mongoose.Schema.Types.Mixed, // store metadata like connectionId, host, etc.
    required: false
  },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed }, // store model used, tokens, etc.
    timestamp: { type: Date, default: Date.now }
  }],
  lastActive: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

export default mongoose.models.AiHistory || mongoose.model('AiHistory', AiHistorySchema);
