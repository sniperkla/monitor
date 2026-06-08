const mongoose = require('mongoose');
const remoteMongoUri = 'mongodb://uoteru:AaBb1234%21@3.1.41.227:27020/jeawweaw?authSource=admin';

mongoose.connect(remoteMongoUri).then(async () => {
  const settings = await mongoose.connection.db.collection('systemsettings').find({}).toArray();
  console.log(`Found ${settings.length} settings on remote:`);
  for (const s of settings) {
    console.log(`- Key: ${s.key}`);
    if (s.key.includes('deploy')) {
      console.log('Value:', JSON.stringify(s.value, null, 2));
    }
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
