#!/usr/bin/env node

/**
 * Migrate all deploy config documents to use ObjectId for userId
 * 
 * This script:
 * 1. Finds all auto_deploy_config documents
 * 2. Converts string userIds to ObjectId
 * 3. Assigns "global" settings to the specified user
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://monitor:AaBb1234!@localhost:27017/monitor';

async function migrateToObjectId(targetUserId) {
  if (!targetUserId) {
    console.error('Usage: node migrate-to-objectid.js <targetUserId>');
    console.error('Example: node migrate-to-objectid.js 6a5933a8b96fc45faa69184a');
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    console.error('Error: targetUserId must be a valid ObjectId');
    process.exit(1);
  }

  try {
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const collection = db.collection('systemsettings');

    // Find all deploy config documents
    const docs = await collection.find({
      key: { $regex: '^auto_deploy_config' }
    }).toArray();

    console.log(`\nFound ${docs.length} deploy config documents\n`);

    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);
    let updated = 0;
    let skipped = 0;

    for (const doc of docs) {
      const currentUserId = doc.userId;
      const isObjectId = currentUserId instanceof mongoose.Types.ObjectId;
      const currentStr = isObjectId ? currentUserId.toString() : String(currentUserId);

      // Case 1: Already an ObjectId with matching value
      if (isObjectId && currentStr === targetUserId) {
        console.log(`✓ ${doc.key}: Already ObjectId(${targetUserId}) - skip`);
        skipped++;
        continue;
      }

      // Case 2: String matching target userId - convert to ObjectId
      if (!isObjectId && currentStr === targetUserId) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { userId: targetObjectId } }
        );
        console.log(`✓ ${doc.key}: Converted String to ObjectId(${targetUserId})`);
        updated++;
        continue;
      }

      // Case 3: "global" or different string - assign to target user
      if (currentStr === 'global' || !isObjectId) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { userId: targetObjectId } }
        );
        console.log(`✓ ${doc.key}: Migrated "${currentStr}" → ObjectId(${targetUserId})`);
        updated++;
        continue;
      }

      // Case 4: Different ObjectId - keep as is (belongs to another user)
      console.log(`⊘ ${doc.key}: Different user ObjectId(${currentStr}) - keep unchanged`);
      skipped++;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✓ Updated: ${updated}`);
    console.log(`⊘ Skipped: ${skipped}`);
    console.log(`Total: ${docs.length}`);
    console.log('='.repeat(60));
    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const targetUserId = process.argv[2];
migrateToObjectId(targetUserId);
