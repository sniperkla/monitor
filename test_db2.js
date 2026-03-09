const fs = require('fs');
const path = require('path');
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const firstEqual = line.indexOf('=');
      if (firstEqual > 0) {
        const key = line.substring(0, firstEqual).trim();
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

async function test() {
  let MONGODB_URI = process.env.MONGODB_URI;
  try {
    const dbConfig = JSON.parse(fs.readFileSync('./db-config.json', 'utf-8'));
    MONGODB_URI = dbConfig.uri;
  } catch(e) {}
  
  if (!MONGODB_URI) { console.log('No URI'); process.exit(1); }
  
  await mongoose.connect(MONGODB_URI);
  const conn = await mongoose.connection.db.collection('connections').findOne();
  if (conn) {
     console.log("DB Password raw:", conn.password);
     console.log("DB Password decrypted:", decrypt(conn.password));
  }
  process.exit(0);
}
test();
