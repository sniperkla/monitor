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

  // Group settings by project key to keep configuration values
  const projectsMap = new Map();
  allSettings.forEach(s => {
    if (!projectsMap.has(s.key)) {
      projectsMap.set(s.key, s.value);
    }
  });

  // Delete all legacy auto_deploy_config documents
  const deleteRes = await SystemSetting.deleteMany({
    key: { $regex: '^auto_deploy_config' }
  });
  console.log(`Cleared ${deleteRes.deletedCount} old auto_deploy_config document(s).`);

  // Re-insert each project strictly with BSON ObjectId
  for (const [key, value] of projectsMap.entries()) {
    await SystemSetting.create({
      userId: targetObjectId, // BSON ObjectId("6a5933a8b96fc45faa69184a")
      key: key,
      value: value
    });
    console.log(`Saved project "${value?.name || key}" -> userId: ObjectId("${targetObjectIdStr}")`);
  }

  // Print final clean DB state
  const finalSettings = await SystemSetting.find({ key: { $regex: '^auto_deploy_config' } });
  console.log(`\nFinal SystemSetting auto deploy documents (${finalSettings.length} total):`);
  finalSettings.forEach(doc => {
    const isObjectId = doc.userId instanceof mongoose.Types.ObjectId || (doc.userId && typeof doc.userId === 'object');
    console.log(`- ID: ${doc._id}, Key: "${doc.key}", userId: ObjectId("${doc.userId}"), Type: ${isObjectId ? 'BSON ObjectId' : typeof doc.userId}, Project: "${doc.value?.name || 'N/A'}"`);
  });

  console.log('\nMigration completed successfully! All auto deploy projects now strictly use BSON ObjectId.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
