import mongoose from 'mongoose';

const ConnectionSchema = new mongoose.Schema({
  type: { type: String, enum: ['ssh', 'database'], default: 'ssh' },
  dbProvider: { type: String, enum: ['mongodb', 'mysql', 'postgres', 'sqlite'], default: 'mongodb' },
  name: { type: String, required: true, trim: true },
  host: { type: String, required: true, trim: true },
  port: { type: Number, default: 22 },
  username: { type: String, default: '', trim: true },
  authType: { type: String, enum: ['password', 'privateKey', 'none'], default: 'password' },
  password: { type: String, default: null },
  database: { type: String, default: null }, // Database name
  privateKey: { type: String, default: null },
  keyFileName: { type: String, default: null },
  passphrase: { type: String, default: null },
  tags: [{ type: String, trim: true }],
  color: { type: String, default: '#6366f1' },
  lastConnected: { type: Date, default: null },
  status: { type: String, enum: ['online', 'offline', 'testing', 'unknown'], default: 'unknown' },
  isFavorite: { type: Boolean, default: false },
  isSrv: { type: Boolean, default: false }, // For mongodb+srv
  authSource: { type: String, default: null }, // MongoDB auth database
  dbOptions: { type: mongoose.Schema.Types.Mixed, default: null }, // Extra URI query params
  notes: { type: String, default: '' },
  info: { type: String, default: null },
  // SSH Tunnel (for reaching local/private DBs through an SSH jump)
  sshTunnel: { type: Boolean, default: false },
  sshTunnelHost: { type: String, default: null },
  sshTunnelPort: { type: Number, default: 22 },
  sshTunnelUser: { type: String, default: null },
  sshTunnelAuth: { type: String, enum: ['password', 'privateKey'], default: 'password' },
  sshTunnelPassword: { type: String, default: null },
  sshTunnelPrivateKey: { type: String, default: null },
  sshTunnelPassphrase: { type: String, default: null },
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
