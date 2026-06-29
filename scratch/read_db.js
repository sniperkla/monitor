const { MongoClient } = require('mongodb');
const { decrypt } = require('../src/utils/encryption');

process.env.ENCRYPTION_KEY = '66f462177aa9fa4f38cf4263c6079f4ddd8f21331614b4f14de1b693cd0bcccc';

async function run() {
  const client = new MongoClient('mongodb://127.0.0.1:27017/ssh-monitor');
  try {
    await client.connect();
    const db = client.db('ssh-monitor');
    
    const settings = await db.collection('systemsettings').find({ key: { $regex: '^auto_deploy_config' } }).toArray();
    for (const setting of settings) {
      console.log('--------------------------------------------------');
      console.log('KEY:', setting.key);
      const val = setting.value || {};
      console.log('  name:', val.name);
      console.log('  targetType:', val.targetType);
      console.log('  deployCommand:', JSON.stringify(val.deployCommand));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
