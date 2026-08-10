#!/usr/bin/env node

/**
 * Check and display userId types in auto_deploy_config settings
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://monitor:AaBb1234!@localhost:27017/monitor';

async function checkUserIds() {
  try {
    console.log('Connecting to MongoDB:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const collection = db.collection('systemsettings');

    console.log('\n========== AUTO DEPLOY CONFIG DOCUMENTS ==========\n');

    const docs = await collection.find({
      key: { $regex: '^auto_deploy_config' }
    }).toArray();

    console.log(`Found ${docs.length} deploy config documents:\n`);

    docs.forEach(doc => {
      const userIdType = doc.userId instanceof mongoose.Types.ObjectId ? 'ObjectId' : typeof doc.userId;
      const userIdValue = doc.userId instanceof mongoose.Types.ObjectId ? doc.userId.toString() : doc.userId;
      
      console.log(`Key: ${doc.key}`);
      console.log(`  userId: ${userIdValue}`);
      console.log(`  Type: ${userIdType}`);
      console.log(`  _id: ${doc._id}`);
      console.log('');
    });

    console.log('========== SUMMARY ==========\n');
    const stringUserIds = docs.filter(d => typeof d.userId === 'string');
    const objectIdUserIds = docs.filter(d => d.userId instanceof mongoose.Types.ObjectId);
    
    console.log(`String userIds: ${stringUserIds.length}`);
    console.log(`ObjectId userIds: ${objectIdUserIds.length}`);
    console.log('');

    if (objectIdUserIds.length > 0) {
      console.log('Documents with ObjectId userId:');
      objectIdUserIds.forEach(d => console.log(`  - ${d.key}`));
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

checkUserIds();
