const mongoose = require('mongoose');
const remoteMongoUri = process.env.MONGODB_URI;
if (!remoteMongoUri) throw new Error('Set MONGODB_URI before running this script.');

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
