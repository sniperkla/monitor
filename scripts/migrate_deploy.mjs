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

if (!uri) uri = 'mongodb://127.0.0.1:27017/ssh-monitor';

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

  const userEmails = ['sniperkla@eaqdragon.com', 'sniperkla@eaqdrgon.com'];
  let targetUser = await User.findOne({
    $or: userEmails.map(e => ({ email: { $regex: new RegExp(`^${e}$`, 'i') } }))
  });

  const targetDbId = targetUser ? targetUser._id.toString() : '6a59213f1543c5287a26fa2a';
  const targetEmail = targetUser ? targetUser.email : 'sniperkla@eaqdragon.com';
  console.log(`Target User found in DB -> DB ID: "${targetDbId}", Email: "${targetEmail}"`);

  // Target IDs to associate
  const allUserIds = Array.from(new Set([targetDbId, targetEmail, 'sniperkla@eaqdrgon.com']));

  const autoDeploySettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
  console.log(`Found ${autoDeploySettings.length} auto deploy setting(s) in DB.`);

  for (const doc of autoDeploySettings) {
    console.log(`Migrating project "${doc.value?.name || doc.key}" (Key: "${doc.key}")...`);
    for (const uId of allUserIds) {
      await SystemSetting.findOneAndUpdate(
        { userId: uId, key: doc.key },
        { $set: { userId: uId, key: doc.key, value: doc.value } },
        { upsert: true }
      );
      console.log(`  -> Saved key "${doc.key}" under userId: "${uId}"`);
    }
  }

  console.log('\nMigration to sniperkla@eaqdragon.com completed successfully!');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
