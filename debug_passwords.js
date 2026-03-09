const fs = require('fs');
const path = require('path');
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const firstEqual = line.indexOf('=');
      if (firstEqual > 0) {
        let key = line.substring(0, firstEqual).trim();
        let value = line.substring(firstEqual + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        if (key && !process.env[key]) process.env[key] = value;
      }
    });
  }
} catch(e) {}

const mongoose = require('mongoose');
const { decrypt } = require('./src/utils/encryption');

async function debugPasswords() {
  let MONGODB_URI = null;
  try {
    const dbConfig = JSON.parse(fs.readFileSync('./db-config.json', 'utf-8'));
    MONGODB_URI = dbConfig.uri;
  } catch(e) {}
  
  if (!MONGODB_URI) { console.log("No MONGODB_URI"); process.exit(1); }
  console.log("Connecting to:", MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  const conns = await mongoose.connection.db.collection('connections').find({}).toArray();
  console.log("Total connections:", conns.length);
  for (const c of conns) {
     console.log('---');
     console.log('Name:', c.name);
     console.log('Host:', c.host);
     console.log('User:', c.username);
     if (c.password) {
       const decrypted = decrypt(c.password);
       console.log(`Password length: ${decrypted ? decrypted.length : 'null'}`);
       console.log(`Password string (hex dump to check spaces):`, Buffer.from(decrypted || '').toString('hex'));
     } else {
       console.log('No password field');
     }
  }
  process.exit(0);
}
debugPasswords();
