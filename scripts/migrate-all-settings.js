#!/usr/bin/env node

/**
 * Migrate ALL SystemSettings to use ObjectId for userId
 * 
 * User-specific settings:
 * - auto_deploy_config* (already done)
 * - google_drive_config
 * - server_backup_history
 * - relay_tokens
 * 
 * Global settings (system-wide, no userId needed):
 * - ai_api_keys
 * - ai_config
 * - ai_limits
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor';

// Settings that should be user-specific
const USER_SPECIFIC_KEYS = [
  /^auto_deploy_config/,
  'google_drive_config',
  'server_backup_history',
  'relay_tokens',
  'mongo_sync_history',   // Sync history is per-user
  'mongo_sync_jobs',      // Sync jobs are per-user
];

// Settings that should remain global (no userId)
const GLOBAL_KEYS = [
  'ai_api_keys',
  'ai_config',
  'ai_limits',
];

function isUserSpecific(key) {
  return USER_SPECIFIC_KEYS.some(pattern => 
    typeof pattern === 'string' ? key === pattern : pattern.test(key)
  );
}

function isGlobal(key) {
  return GLOBAL_KEYS.includes(key);
}

async function migrateAllSettings(targetUserId) {
  if (!targetUserId) {
    console.error('Usage: node migrate-all-settings.js <targetUserId>');
    console.error('Example: node migrate-all-settings.js 6a5933a8b96fc45faa69184a');
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
    const collection = db.collection('system_settings');

    const docs = await collection.find({}).toArray();

    console.log(`\nFound ${docs.length} SystemSettings documents\n`);
    console.log('='.repeat(80));

    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);
    let userSpecificUpdated = 0;
    let userSpecificSkipped = 0;
    let globalProcessed = 0;
    let unknownKeys = [];

    for (const doc of docs) {
      const key = doc.key;
      const currentUserId = doc.userId;
      const isObjectId = currentUserId instanceof mongoose.Types.ObjectId;
      const currentStr = currentUserId ? (isObjectId ? currentUserId.toString() : String(currentUserId)) : 'undefined';

      // Check if this is a known setting type
      if (isGlobal(key)) {
        // Global setting - should NOT have userId
        if (currentUserId) {
          await collection.updateOne(
            { _id: doc._id },
            { $unset: { userId: '' } }
          );
          console.log(`🌍 ${key}: Removed userId (global setting)`);
          globalProcessed++;
        } else {
          console.log(`🌍 ${key}: Already global (no userId)`);
          globalProcessed++;
        }
        continue;
      }

      if (isUserSpecific(key)) {
        // User-specific setting - should have ObjectId userId

        // Already correct ObjectId for this user
        if (isObjectId && currentStr === targetUserId) {
          console.log(`✓ ${key}: Already ObjectId(${targetUserId})`);
          userSpecificSkipped++;
          continue;
        }

        // String or undefined - convert to ObjectId
        if (!currentUserId || !isObjectId || currentStr !== targetUserId) {
          await collection.updateOne(
            { _id: doc._id },
            { $set: { userId: targetObjectId } }
          );
          console.log(`✓ ${key}: Set userId to ObjectId(${targetUserId}) (was: ${currentStr})`);
          userSpecificUpdated++;
          continue;
        }

        // Different user's ObjectId - skip
        console.log(`⊘ ${key}: Different user ObjectId(${currentStr})`);
        userSpecificSkipped++;
        continue;
      }

      // Unknown key pattern
      unknownKeys.push({ key, currentUserId: currentStr });
      console.log(`❓ ${key}: Unknown setting type (userId: ${currentStr})`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`User-specific settings updated: ${userSpecificUpdated}`);
    console.log(`User-specific settings skipped: ${userSpecificSkipped}`);
    console.log(`Global settings processed: ${globalProcessed}`);
    console.log(`Unknown settings: ${unknownKeys.length}`);
    console.log(`Total: ${docs.length}`);
    console.log('='.repeat(80));

    if (unknownKeys.length > 0) {
      console.log('\n⚠️  Unknown setting keys (need manual classification):');
      unknownKeys.forEach(({ key, currentUserId }) => {
        console.log(`   - ${key} (userId: ${currentUserId})`);
      });
      console.log('\nPlease add these to USER_SPECIFIC_KEYS or GLOBAL_KEYS in the script.');
    }

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const targetUserId = process.argv[2];
migrateAllSettings(targetUserId);
