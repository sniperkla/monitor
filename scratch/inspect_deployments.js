const mongoose = require('mongoose');
const localMongoUri = 'mongodb://127.0.0.1:27017/ssh-monitor';

mongoose.connect(localMongoUri).then(async () => {
  const settings = await mongoose.connection.db.collection('systemsettings').find({}).toArray();
  console.log(`Found ${settings.length} settings:`);
  for (const s of settings) {
    console.log(`- Key: ${s.key}`);
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
