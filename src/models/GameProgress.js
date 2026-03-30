import mongoose from 'mongoose';

const GameProgressSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    default: '',
    index: true
  },
  gameKey: {
    type: String,
    required: true,
    default: 'fallout',
    index: true
  },
  highestLevelReached: {
    type: Number,
    default: 1
  },
  currentLevel: {
    type: Number,
    default: 1
  },
  totalWins: {
    type: Number,
    default: 0
  },
  totalLosses: {
    type: Number,
    default: 0
  },
  totalGamesPlayed: {
    type: Number,
    default: 0
  },
  totalNukesLaunched: {
    type: Number,
    default: 0
  },
  totalKaijuKilled: {
    type: Number,
    default: 0
  },
  lastOutcome: {
    type: String,
    enum: ['playing', 'won', 'lost', 'abandoned'],
    default: 'playing'
  },
  lastTheme: {
    type: String,
    default: 'village'
  },
  lastPlayedAt: {
    type: Date,
    default: Date.now
  },
  lastStats: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

GameProgressSchema.index({ userEmail: 1, gameKey: 1 }, { unique: true });

export default mongoose.models.GameProgress || mongoose.model('GameProgress', GameProgressSchema);
