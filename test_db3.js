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
        // Remove surrounding quotes and handle escaping if needed
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
  const conn = await mongoose.connection.db.collection('connections').findOne({ password: { $ne: null } });
  if (conn) {
     console.log("DB Username:", conn.username);
     console.log("DB Host:", conn.host);
     console.log("DB Password raw:", conn.password);
     console.log("DB Password decrypted (server script):", decrypt(conn.password));
     
     // What if we try to connect with SSH using this decrypted password?
     try {
       const ssh2 = require('ssh2');
       const client = new ssh2.Client();
       client.on('ready', () => {
         console.log('SSH connection successful!');
         client.end();
         process.exit(0);
       });
       client.on('error', (err) => {
         console.log('SSH connection failed:', err.message);
         process.exit(0);
       });
       client.connect({
         host: conn.host,
         port: conn.port || 22,
         username: conn.username,
         password: decrypt(conn.password),
         readyTimeout: 5000
       });
     } catch (e) {
       console.log("SSH error", e);
     }
  } else {
     console.log("No connection with password found.");
     process.exit(0);
  }
}
test();
