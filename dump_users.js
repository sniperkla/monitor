const fs = require('fs');
const mongoose = require('mongoose');

async function dump() {
  let MONGODB_URI = null;
  try {
    const dbConfig = JSON.parse(fs.readFileSync('./db-config.json', 'utf-8'));
    MONGODB_URI = dbConfig.uri;
  } catch(e) {}
  
  if (!MONGODB_URI) { console.log("No MONGODB_URI"); process.exit(1); }
  await mongoose.connect(MONGODB_URI);
  
  // Try users collection
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  for (const u of users) {
     console.log('User:', u.email, 'Vault is Configured:', u.vault?.isConfigured);
     if (u.vault?.encryptedUri) {
        console.log('User has encrypted URI');
     }
  }
  process.exit(0);
}
dump();
