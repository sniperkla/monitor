const mongoose = require('mongoose');
const fs = require('fs');
const { decrypt } = require('./src/utils/encryption');

async function test() {
  const dbConfigPath = './db-config.json';
  if (fs.existsSync(dbConfigPath)) {
    const dbConfig = JSON.parse(fs.readFileSync(dbConfigPath, 'utf-8'));
    await mongoose.connect(dbConfig.uri);
    const conn = await mongoose.connection.db.collection('connections').findOne();
    if (conn) {
       console.log("DB Password raw:", conn.password);
       console.log("DB Password decrypted:", decrypt(conn.password));
    }
  } else {
    console.log('No db-config.json');
  }
  process.exit(0);
}
test();
