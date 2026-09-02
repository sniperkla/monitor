const mongoose = require('mongoose');
const remoteMongoUri = process.env.MONGODB_URI;
if (!remoteMongoUri) throw new Error('Set MONGODB_URI before running this script.');

mongoose.connect(remoteMongoUri).then(async () => {
  const s = await mongoose.connection.db.collection('systemsettings').findOne({
    key: 'auto_deploy_config_monitor'
  });

  if (s) {
    console.log(`KEY: ${s.key}`);
    console.log(`Status: ${s.value?.status}`);
    console.log(`Last Deploy At: ${s.value?.lastDeployAt}`);
    console.log('-------------------- LOGS ------------------------');
    console.log(s.value?.lastDeployLog || '(no logs)');
  } else {
    console.log('Not found');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
