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

async function test() {
  let MONGODB_URI = process.env.MONGODB_URI;
  try {
    const dbConfig = JSON.parse(fs.readFileSync('./db-config.json', 'utf-8'));
    MONGODB_URI = dbConfig.uri;
  } catch(e) {}
  
  await mongoose.connect(MONGODB_URI);
  const conns = await mongoose.connection.db.collection('connections').find({}).toArray();
  console.log("Total connections:", conns.length);
  for (let c of conns) {
     console.log('Host:', c.host, '| Auth:', c.authType, '| pass:', !!c.password, '| pk:', !!c.privateKey);
  }
  process.exit(0);
}
test();
