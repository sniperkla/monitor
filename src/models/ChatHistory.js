import mongoose from 'mongoose';

const ChatHistorySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  guideId: {
    type: String,
    required: false,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

export function getChatHistoryModel(connection) {
  if (connection.models && connection.models.ChatHistory) {
    return connection.models.ChatHistory;
  }
  return connection.model('ChatHistory', ChatHistorySchema);
}

export default mongoose.models.ChatHistory || mongoose.model('ChatHistory', ChatHistorySchema);
