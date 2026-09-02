#!/usr/bin/env node

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor';

async function findAllUserIds() {
  try {
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const collection = db.collection('systemsettings');

    const docs = await collection.find({
      key: { $regex: '^auto_deploy_config' }
    }).toArray();

    console.log(`\nFound ${docs.length} documents`);
    
    const userIds = new Set();
    docs.forEach(d => {
      const val = d.userId instanceof mongoose.Types.ObjectId ? d.userId.toString() : String(d.userId);
      userIds.add(val);
    });

    console.log('\nUnique userId values:');
    userIds.forEach(id => {
      const count = docs.filter(d => {
        const val = d.userId instanceof mongoose.Types.ObjectId ? d.userId.toString() : String(d.userId);
        return val === id;
      }).length;
      console.log(`  ${id} (${count} documents)`);
    });

    console.log('\nLooking for session userId: 6a5933a8b96fc45faa69184a');
    const matchingDocs = docs.filter(d => {
      const val = d.userId instanceof mongoose.Types.ObjectId ? d.userId.toString() : String(d.userId);
      return val === '6a5933a8b96fc45faa69184a';
    });
    
    if (matchingDocs.length > 0) {
      console.log(`Found ${matchingDocs.length} documents with session userId:`);
      matchingDocs.forEach(d => console.log(`  - ${d.key}`));
    } else {
      console.log('NO documents found with session userId!');
      console.log('\nThis is why projects are not showing up.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

findAllUserIds();
