const mongoose = require('mongoose');
const remoteMongoUri = process.env.MONGODB_URI;
if (!remoteMongoUri) throw new Error('Set MONGODB_URI before running this script.');

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
