const mongoose = require('mongoose');
const remoteMongoUri = 'mongodb://uoteru:AaBb1234%21@3.1.41.227:27020/jeawweaw?authSource=admin';

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
