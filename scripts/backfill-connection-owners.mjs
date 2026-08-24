/**
 * backfill-connection-owners.js
 *
 * 🔐 One-time migration for multi-tenant isolation:
 * Assigns every connection row/document that has NO owner (userId === null)
 * to a single owning account. Required once after the per-user scoping patch,
 * otherwise legacy servers are invisible to everyone.
 *
 * Usage:
 *   node scripts/backfill-connection-owners.js                 # owner = oldest-created user
 *   node scripts/backfill-connection-owners.js someone@x.com   # owner = specific account
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ssh-monitor';
await mongoose.connect(uri);
const col = mongoose.connection.collection('connections');

const ownerEmail = process.argv[2] || null;
let owner;
if (ownerEmail) {
  owner = await mongoose.connection.collection('users').findOne({ email: ownerEmail.toLowerCase() });
  if (!owner) { console.error(`❌ No user found with email ${ownerEmail}`); process.exit(1); }
} else {
  owner = await mongoose.connection.collection('users').findOne({}, { sort: { createdAt: 1 } });
  if (!owner) { console.error('❌ No users exist'); process.exit(1); }
  console.log(`ℹ️  No owner specified — using OLDEST account: ${owner.email}`);
}

const ownerId = String(owner._id);
const result = await col.updateMany(
  { $or: [ { userId: null }, { userId: { $exists: false } } ] },
  { $set: { userId: ownerId } }
);

console.log(`✅ Backfilled ${result.modifiedCount} connection(s) → owner ${owner.email} (${ownerId})`);
const remaining = await col.countDocuments({ $or: [ { userId: null }, { userId: { $exists: false } } ] });
console.log(remaining === 0 ? '✅ No unowned connections remain.' : `⚠️  ${remaining} still unowned.`);
await mongoose.disconnect();
process.exit(0);
