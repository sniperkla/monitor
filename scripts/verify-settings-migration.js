#!/usr/bin/env node

/**
 * Verify User-Specific Settings Migration
 * 
 * This script verifies that all settings have been properly migrated:
 * - User-specific settings have ObjectId userId
 * - Global settings have no userId
 * - No orphaned or incorrectly scoped settings remain
 * 
 * Run: MONGODB_URI='...' node scripts/verify-settings-migration.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

// Settings classification
const USER_SPECIFIC_KEYS = [
  /^auto_deploy_config/,
  'google_drive_config',
  'server_backup_history',
  'relay_tokens',
  'mongo_sync_history',
  'mongo_sync_jobs',
];

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

async function verify() {
  try {
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const collection = db.collection('system_settings');

    const docs = await collection.find({}).toArray();

    console.log(`\n📊 Found ${docs.length} system_settings documents\n`);
    console.log('='.repeat(80));

    let userSpecificOk = 0;
    let userSpecificIssues = [];
    let globalOk = 0;
    let globalIssues = [];
    let unknownSettings = [];

    for (const doc of docs) {
      const key = doc.key;
      const userId = doc.userId;
      const isObjectId = userId instanceof mongoose.Types.ObjectId;

      if (isUserSpecific(key)) {
        // Should have ObjectId userId
        if (isObjectId) {
          console.log(`✓ ${key}: User-specific with ObjectId(${userId.toString()})`);
          userSpecificOk++;
        } else {
          const issue = `${key}: ISSUE - User-specific but userId is ${userId ? `"${userId}"` : 'missing'}`;
          console.log(`❌ ${issue}`);
          userSpecificIssues.push({ key, userId, _id: doc._id });
        }
      } else if (isGlobal(key)) {
        // Should NOT have userId
        if (!userId) {
          console.log(`✓ ${key}: Global (no userId)`);
          globalOk++;
        } else {
          const issue = `${key}: ISSUE - Global but has userId: ${isObjectId ? `ObjectId(${userId.toString()})` : `"${userId}"`}`;
          console.log(`❌ ${issue}`);
          globalIssues.push({ key, userId, _id: doc._id });
        }
      } else {
        // Unknown key
        console.log(`⚠️  ${key}: Unknown setting type (userId: ${userId ? (isObjectId ? userId.toString() : userId) : 'none'})`);
        unknownSettings.push({ key, userId, _id: doc._id });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`User-specific settings (OK): ${userSpecificOk}`);
    console.log(`User-specific settings (Issues): ${userSpecificIssues.length}`);
    console.log(`Global settings (OK): ${globalOk}`);
    console.log(`Global settings (Issues): ${globalIssues.length}`);
    console.log(`Unknown settings: ${unknownSettings.length}`);
    console.log(`Total documents: ${docs.length}`);
    console.log('='.repeat(80));

    let hasIssues = false;

    if (userSpecificIssues.length > 0) {
      hasIssues = true;
      console.log('\n❌ User-specific settings with issues:');
      userSpecificIssues.forEach(({ key, userId, _id }) => {
        console.log(`   - ${key} (userId: ${userId || 'MISSING'}, _id: ${_id})`);
      });
      console.log('\nThese settings should have ObjectId userId. Run migration script to fix.');
    }

    if (globalIssues.length > 0) {
      hasIssues = true;
      console.log('\n❌ Global settings with issues:');
      globalIssues.forEach(({ key, userId, _id }) => {
        const isObjectId = userId instanceof mongoose.Types.ObjectId;
        const userIdStr = isObjectId ? `ObjectId(${userId.toString()})` : `"${userId}"`;
        console.log(`   - ${key} (userId: ${userIdStr}, _id: ${_id})`);
      });
      console.log('\nThese settings should NOT have userId. Fix manually or update migration script.');
    }

    if (unknownSettings.length > 0) {
      console.log('\n⚠️  Unknown setting keys (need classification):');
      unknownSettings.forEach(({ key, userId, _id }) => {
        const userIdStr = userId ? (userId instanceof mongoose.Types.ObjectId ? userId.toString() : userId) : 'none';
        console.log(`   - ${key} (userId: ${userIdStr}, _id: ${_id})`);
      });
      console.log('\nAdd these to USER_SPECIFIC_KEYS or GLOBAL_KEYS in the migration script.');
    }

    if (!hasIssues && unknownSettings.length === 0) {
      console.log('\n✅ All settings are properly scoped! Migration successful.\n');
    } else if (!hasIssues) {
      console.log('\n⚠️  Migration complete but some settings need classification.\n');
    } else {
      console.log('\n❌ Issues found. Please review and fix.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

verify();
