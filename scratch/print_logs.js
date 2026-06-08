const mongoose = require('mongoose');
const localMongoUri = 'mongodb://127.0.0.1:27017/ssh-monitor';

mongoose.connect(localMongoUri).then(async () => {
  const settings = await mongoose.connection.db.collection('systemsettings').find({
    key: { $regex: /^auto_deploy_config/ }
  }).toArray();

  for (const s of settings) {
    console.log('\n==================================================');
    console.log(`KEY: ${s.key}`);
    console.log(`Name: ${s.value?.name}`);
    console.log(`Enabled: ${s.value?.enabled}`);
    console.log(`Status: ${s.value?.status}`);
    console.log(`Last Deploy At: ${s.value?.lastDeployAt}`);
    console.log(`Deploy Run ID: ${s.value?.deployRunId}`);
    console.log(`Cancel Requested: ${s.value?.cancelRequested}`);
    console.log('-------------------- LOGS ------------------------');
    console.log(s.value?.lastDeployLog || '(no logs)');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
