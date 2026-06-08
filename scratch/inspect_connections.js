const mongoose = require('mongoose');
const localMongoUri = 'mongodb://127.0.0.1:27017/ssh-monitor';

mongoose.connect(localMongoUri).then(async () => {
  const connections = await mongoose.connection.db.collection('connections').find({}).toArray();
  console.log(`Found ${connections.length} connections:`);
  for (const c of connections) {
    console.log(`- ID: ${c._id}`);
    console.log(`  Name: ${c.name}`);
    console.log(`  Host: ${c.host}`);
    console.log(`  Port: ${c.port}`);
    console.log(`  Username: ${c.username}`);
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
