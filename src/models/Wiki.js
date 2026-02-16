import mongoose from 'mongoose';

const WikiSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true
  },
  category: {
    type: String,
    required: true,
    index: true
  },
  os: {
    type: [String],
    default: ['All Linux'],
    index: true
  },
  description: {
    type: String,
    required: true
  },
  commands: [{
    label: String,
    code: String,
    explanation: String,
    result: String
  }],
  tags: [String],
  author: String,
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

WikiSchema.index({ title: 'text', description: 'text', tags: 'text' });

export function getWikiModel(connection) {
  if (connection.models && connection.models.Wiki) {
    return connection.models.Wiki;
  }
  return connection.model('Wiki', WikiSchema);
}

export default mongoose.models.Wiki || mongoose.model('Wiki', WikiSchema);
