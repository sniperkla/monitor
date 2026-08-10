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

  const User = mongoose.models.User || mongoose.model('User', UserSchema);
  const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);

  const targetEmail = 'sniperkla@eaqdragon.com';
  let targetUser = await User.findOne({
    $or: [{ email: targetEmail }, { email: 'sniperkla@eaqdrgon.com' }]
  });

  if (!targetUser) {
    console.error(`User with email "${targetEmail}" not found in database!`);
    process.exit(1);
  }

  const targetObjectIdStr = targetUser._id.toString();
  console.log(`Target User found -> Email: "${targetUser.email}", User ObjectId string: "${targetObjectIdStr}"`);

  const validUserIds = [targetObjectIdStr, targetEmail, 'sniperkla@eaqdrgon.com'];

  // Fetch all auto_deploy_config documents
  const allSettings = await SystemSetting.find({
    key: { $regex: '^auto_deploy_config' }
  });

  // Group settings by project key to keep the best configuration
  const projectsMap = new Map();
  allSettings.forEach(s => {
    if (!projectsMap.has(s.key)) {
      projectsMap.set(s.key, s.value);
    }
  });

  // Delete all legacy/duplicate auto_deploy_config documents
  const deleteRes = await SystemSetting.deleteMany({
    key: { $regex: '^auto_deploy_config' }
  });
  console.log(`Cleared ${deleteRes.deletedCount} old auto_deploy_config document(s).`);

  // Re-insert each project exclusively with userId set to the User's ObjectId string
  for (const [key, value] of projectsMap.entries()) {
    await SystemSetting.create({
      userId: targetObjectIdStr,
      key: key,
      value: value
    });
    console.log(`Saved project "${value?.name || key}" -> userId: "${targetObjectIdStr}" (User ObjectId string)`);
  }

  // Print final clean DB state
  const finalSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
  console.log(`\nFinal SystemSetting auto deploy documents (${finalSettings.length} total):`);
  finalSettings.forEach(doc => {
    console.log(`- ID: ${doc._id}, Key: "${doc.key}", userId: "${doc.userId}" (User ObjectId), Project: "${doc.value?.name || 'N/A'}"`);
  });

  console.log('\nMigration completed successfully! All auto deploy projects now strictly use User ObjectId string.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
