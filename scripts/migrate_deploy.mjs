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
  userId: mongoose.Schema.Types.Mixed,
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

  const targetObjectId = targetUser._id; // BSON ObjectId
  const targetObjectIdStr = targetUser._id.toString();
  console.log(`Target User found -> Email: "${targetUser.email}", BSON ObjectId: ObjectId("${targetObjectIdStr}")`);

  // Fetch all auto_deploy_config documents
  const allSettings = await SystemSetting.find({
    key: { $regex: '^auto_deploy_config' }
  });

  console.log(`Found ${allSettings.length} total auto deploy setting document(s):`);
  allSettings.forEach(s => {
    console.log(`  - ID: ${s._id}, key: ${s.key}, userId: ${JSON.stringify(s.userId)}, name: ${s.value?.name}`);
  });

  // Group settings by project key (keep the latest/best one)
  const projectsMap = new Map();
  allSettings.forEach(s => {
    if (!projectsMap.has(s.key)) {
      projectsMap.set(s.key, s.value);
    }
  });

  // Delete ALL auto_deploy_config documents (clean slate)
  const deleteRes = await SystemSetting.deleteMany({
    key: { $regex: '^auto_deploy_config' }
  });
  console.log(`\nCleared ${deleteRes.deletedCount} old auto_deploy_config document(s).`);

  // Re-insert each unique project strictly with BSON ObjectId
  for (const [key, value] of projectsMap.entries()) {
    await SystemSetting.create({
      userId: targetObjectId,
      key: key,
      value: value
    });
    console.log(`Saved project "${value?.name || key}" -> userId: ObjectId("${targetObjectIdStr}")`);
  }

  // Print final clean DB state
  const finalSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
  console.log(`\nFinal SystemSetting auto deploy documents (${finalSettings.length} total):`);
  finalSettings.forEach(doc => {
    const type = doc.userId instanceof mongoose.Types.ObjectId ? 'BSON ObjectId' : typeof doc.userId;
    console.log(`- Key: "${doc.key}", userId: ObjectId("${doc.userId}"), type: ${type}, Project: "${doc.value?.name || 'N/A'}"`);
  });

  console.log('\nMigration completed successfully!');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
