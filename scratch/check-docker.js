const mongoose = require('mongoose');
const remoteMongoUri = 'mongodb://uoteru:AaBb1234%21@3.1.41.227:27020/jeawweaw?authSource=admin';

mongoose.connect(remoteMongoUri).then(async () => {
  const setting = await mongoose.connection.db.collection('systemsettings').findOne({ key: 'auto_deploy_config_test' });
  if (setting) {
    console.log('Found setting auto_deploy_config_test:');
    console.log(JSON.stringify(setting.value, null, 2));
  } else {
    console.log('setting not found');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
