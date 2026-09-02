#!/usr/bin/env node

/**
 * Migrate deploy config userId to match current user
 * 
 * Usage: node scripts/migrate-deploy-userid.js <oldUserId> <newUserId>
 * Example: node scripts/migrate-deploy-userid.js 6a59213f1543c5287a26fa2a 6a5933a8b96fc45faa69184a
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor';

async function migrateUserId(oldUserId, newUserId) {
  if (!oldUserId || !newUserId) {
    console.error('Usage: node migrate-deploy-userid.js <oldUserId> <newUserId>');
    process.exit(1);
  }

  try {
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const collection = db.collection('systemsettings');

    // Find documents with old userId
    const oldDocs = await collection.find({
      key: { $regex: '^auto_deploy_config' },
      userId: oldUserId
    }).toArray();

    console.log(`\nFound ${oldDocs.length} documents with userId: ${oldUserId}`);
    
    if (oldDocs.length === 0) {
      console.log('No documents to migrate.');
      await mongoose.disconnect();
      return;
    }

    oldDocs.forEach(d => console.log(`  - ${d.key}`));

    console.log(`\nUpdating userId to: ${newUserId}`);

    const result = await collection.updateMany(
      {
        key: { $regex: '^auto_deploy_config' },
        userId: oldUserId
      },
      {
        $set: { userId: newUserId }
      }
    );

    console.log(`\n✓ Updated ${result.modifiedCount} documents`);
    console.log('\nMigration complete! Refresh your browser to see the projects.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const oldUserId = process.argv[2];
const newUserId = process.argv[3];

migrateUserId(oldUserId, newUserId);
