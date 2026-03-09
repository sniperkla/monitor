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
const { decrypt, encrypt } = require('./src/utils/encryption');

async function test() {
  let MONGODB_URI = process.env.MONGODB_URI;
  try {
    const dbConfig = JSON.parse(fs.readFileSync('./db-config.json', 'utf-8'));
    MONGODB_URI = dbConfig.uri;
  } catch(e) {}
  
  if (!MONGODB_URI) { console.log('No URI'); process.exit(1); }
  
  await mongoose.connect(MONGODB_URI);
  const conn = await mongoose.connection.db.collection('connections').findOne({ privateKey: { $ne: null } });
  if (conn) {
     console.log("DB Username:", conn.username);
     console.log("DB Host:", conn.host);
     console.log("DB PrivateKey raw starts with:", String(conn.privateKey).substring(0, 50));
     
     const decryptedPK = decrypt(conn.privateKey);
     console.log("DB PrivateKey decrypted starts with:", String(decryptedPK).substring(0, 50));
     console.log("DB PrivateKey decrypted length:", String(decryptedPK).length);
     
  } else {
     console.log("No connection with private key found.");
  }
  process.exit(0);
}
test();
