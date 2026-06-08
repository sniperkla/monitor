const mongoose = require('mongoose');
const remoteMongoUri = 'mongodb://uoteru:AaBb1234%21@3.1.41.227:27020/jeawweaw?authSource=admin';

mongoose.connect(remoteMongoUri).then(async () => {
  const now = new Date();
  const result = await mongoose.connection.db.collection('systemsettings').findOneAndUpdate(
    { key: 'auto_deploy_config_monitor' },
    {
      $set: {
        'value.status': 'failed',
        'value.deployRunId': null,
        'value.cancelRequested': false,
        'value.lastDeployLog': `[${now.toISOString()}] ⚠️ Deployment interrupted — server was restarted during deployment.\nThe Docker container was rebuilt and restarted, killing the running deployment tracker.\nYour application appears to have deployed successfully based on the build log.\nThis status was reset manually by the diagnostic tool.`
      }
    },
    { returnDocument: 'after' }
  );

  if (result) {
    console.log('✅ Reset auto_deploy_config_monitor status to failed (was stuck at running)');
    console.log('New status:', result.value?.status);
  } else {
    console.log('❌ Document not found');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
