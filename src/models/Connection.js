import mongoose from 'mongoose';

const ConnectionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  host: { type: String, required: true, trim: true },
  port: { type: Number, default: 22 },
  username: { type: String, required: true, trim: true },
  authType: { type: String, enum: ['password', 'privateKey'], required: true },
  password: { type: String, default: null },
  privateKey: { type: String, default: null },
  keyFileName: { type: String, default: null },
  passphrase: { type: String, default: null },
  tags: [{ type: String, trim: true }],
  color: { type: String, default: '#6366f1' },
  lastConnected: { type: Date, default: null },
  status: { type: String, enum: ['online', 'offline', 'unknown'], default: 'unknown' },
  isFavorite: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  info: { type: String, default: null },
}, {
  timestamps: true,
});

/**
 * Helper to get the Connection model for a specific database connection.
 * This is required for Multi-tenant (Private Browser Mode).
 */
export function getConnectionModel(dbConnection) {
  // If no specific connection provided, fallback to default global mongoose
  const target = dbConnection || mongoose;
  return target.models.Connection || target.model('Connection', ConnectionSchema);
}

// Keep the default export for backward compatibility where possible,
// but it will default to the global mongoose instance.
export default mongoose.models.Connection || mongoose.model('Connection', ConnectionSchema);
export { ConnectionSchema };
