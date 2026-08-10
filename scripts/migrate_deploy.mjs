import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

let uri = process.env.MONGODB_URI;

if (!uri) {
  try {
    const envFile = fs.readFileSync(path.resolve('.env'), 'utf-8');
    const match = envFile.match(/MONGODB_URI=(.+)/);
    if (match) uri = match[1].trim();
  } catch (e) {}
}

if (!uri) uri = 'mongodb://monitor:AaBb1234%21@43.210.134.78:27021/monitor?authSource=admin';

const UserSchema = new mongoose.Schema({
  email: String,
}, { strict: false });

const SystemSettingSchema = new mongoose.Schema({
  userId: String,
  key: String,
  value: mongoose.Schema.Types.Mixed,
}, { strict: false });

async function migrate() {
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  const collection = db.collection('systemsettings');

  // Check and fix indexes
  console.log('Checking indexes on systemsettings collection...');
  const indexes = await collection.indexes();
  console.log('Existing indexes:', indexes.map(i => i.name));

  // Drop old unique index on key alone if it exists
  const legacyIndex = indexes.find(i => i.key && i.key.key === 1 && !i.key.userId);
  if (legacyIndex) {
    console.log(`Dropping legacy unique index "${legacyIndex.name}"...`);
    try {
      await collection.dropIndex(legacyIndex.name);
      console.log('Legacy index dropped successfully.');
    } catch (e) {
      console.warn('Drop index warning:', e.message);
    }
  }

  // Create compound unique index on { userId: 1, key: 1 }
  try {
    await collection.createIndex({ userId: 1, key: 1 }, { unique: true, background: true });
    console.log('Compound unique index { userId: 1, key: 1 } created.');
  } catch (e) {
    console.warn('Create compound index note:', e.message);
  }

  const User = mongoose.models.User || mongoose.model('User', UserSchema);
  const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);

  const targetEmail = 'sniperkla@eaqdragon.com';
  let targetUser = await User.findOne({
    $or: [{ email: targetEmail }, { email: 'sniperkla@eaqdrgon.com' }]
  });

  const targetDbId = targetUser ? targetUser._id.toString() : '6a5933a8b96fc45faa69184a';
  console.log(`Target User found -> Email: "${targetEmail}", DB ID: "${targetDbId}"`);

  const validUserIds = [targetEmail, targetDbId, 'sniperkla@eaqdrgon.com'];

  // 1. Remove all unassigned or 'global' auto_deploy_config documents so only valid user-owned documents remain
  const deletedRes = await SystemSetting.deleteMany({
    key: { $regex: '^auto_deploy_config' },
    $or: [
      { userId: 'global' },
      { userId: 'undefined' },
      { userId: null },
      { userId: '' },
      { userId: { $exists: false } },
      { userId: { $nin: validUserIds } }
    ]
  });
  console.log(`Cleaned up ${deletedRes.deletedCount} unassigned/global/other deploy config document(s).`);

  // 2. Ensure every valid project exists under BOTH targetEmail AND targetDbId
  const currentSettings = await SystemSetting.find({
    key: { $regex: '^auto_deploy_config' },
    userId: { $in: validUserIds }
  });

  console.log(`Found ${currentSettings.length} setting(s) owned by user.`);

  // Group by project key to avoid missing any project config
  const projectsByKey = new Map();
  currentSettings.forEach(s => {
    if (!projectsByKey.has(s.key)) {
      projectsByKey.set(s.key, s.value);
    }
  });

  for (const [key, value] of projectsByKey.entries()) {
    console.log(`Ensuring ownership for project key "${key}" (${value?.name || 'N/A'})...`);
    for (const uId of [targetEmail, targetDbId]) {
      await SystemSetting.findOneAndUpdate(
        { userId: uId, key: key },
        { $set: { userId: uId, key: key, value: value } },
        { upsert: true }
      );
      console.log(`  -> Configured key "${key}" with userId: "${uId}"`);
    }
  }

  // Print final clean state
  const finalSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
  console.log(`\nFinal SystemSetting auto deploy documents (${finalSettings.length} total):`);
  finalSettings.forEach(doc => {
    console.log(`- ID: ${doc._id}, Key: "${doc.key}", userId: "${doc.userId}", Project: "${doc.value?.name || 'N/A'}"`);
  });

  console.log('\nMigration completed successfully!');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
