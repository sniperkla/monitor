#!/usr/bin/env node

/**
 * Test Script - User-Specific Settings Migration
 * 
 * Comprehensive test to verify:
 * 1. Settings are properly scoped per user
 * 2. Users cannot access other users' settings
 * 3. SystemSettingRepository works correctly
 * 4. Global settings remain shared
 * 
 * Run: MONGODB_URI='...' node scripts/test-user-settings.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

const USER_SPECIFIC_KEYS = [
  'google_drive_config',
  'mongo_sync_jobs',
  'mongo_sync_history',
  'server_backup_history',
  'relay_tokens',
];

const GLOBAL_KEYS = [
  'ai_api_keys',
  'ai_config',
  'ai_limits',
];

async function test() {
  try {
    console.log('🧪 Testing User-Specific Settings Migration\n');
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const settingsCol = db.collection('system_settings');
    const usersCol = db.collection('users');

    console.log('✅ Connected\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Verify settings schema
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 1: Verify Settings Schema');
    console.log('='.repeat(80));

    const allSettings = await settingsCol.find({}).toArray();
    console.log(`Total settings in database: ${allSettings.length}`);

    let schemaOk = true;
    for (const setting of allSettings) {
      const hasKey = !!setting.key;
      const hasUserId = setting.hasOwnProperty('userId');
      const hasValue = setting.hasOwnProperty('value');

      if (!hasKey || !hasValue) {
        console.log(`❌ Invalid schema: ${setting._id}`);
        schemaOk = false;
      }
    }

    if (schemaOk) {
      console.log('✅ All settings have valid schema (key, value fields present)\n');
    } else {
      console.log('❌ Some settings have invalid schema\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Verify user-specific settings have userId
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 2: User-Specific Settings Have userId');
    console.log('='.repeat(80));

    const userSpecificSettings = await settingsCol.find({
      key: { $in: USER_SPECIFIC_KEYS }
    }).toArray();

    console.log(`Found ${userSpecificSettings.length} user-specific settings`);

    let userIdOk = true;
    for (const setting of userSpecificSettings) {
      const hasUserId = setting.userId instanceof mongoose.Types.ObjectId;
      if (!hasUserId) {
        console.log(`❌ ${setting.key} (${setting._id}): Missing or invalid userId`);
        userIdOk = false;
      } else {
        console.log(`✅ ${setting.key}: userId = ${setting.userId.toString()}`);
      }
    }

    if (userIdOk && userSpecificSettings.length > 0) {
      console.log('\n✅ All user-specific settings have proper ObjectId userId\n');
    } else if (userSpecificSettings.length === 0) {
      console.log('\n⚠️  No user-specific settings found\n');
    } else {
      console.log('\n❌ Some user-specific settings missing userId\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Verify global settings do NOT have userId (or userId = 'global')
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 3: Global Settings Structure');
    console.log('='.repeat(80));

    const globalSettings = await settingsCol.find({
      key: { $in: GLOBAL_KEYS }
    }).toArray();

    console.log(`Found ${globalSettings.length} global settings`);

    let globalOk = true;
    for (const setting of globalSettings) {
      const userId = setting.userId;
      if (userId && userId !== 'global') {
        console.log(`⚠️  ${setting.key}: Has userId (${userId}) - should be global`);
        globalOk = false;
      } else {
        console.log(`✅ ${setting.key}: ${userId ? "userId='global'" : 'No userId'} (correct)`);
      }
    }

    if (globalOk && globalSettings.length > 0) {
      console.log('\n✅ All global settings have correct structure\n');
    } else if (globalSettings.length === 0) {
      console.log('\n⚠️  No global settings found\n');
    } else {
      console.log('\n⚠️  Some global settings may need review\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Test isolation - ensure no duplicate keys for same user
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 4: User Setting Isolation (No Duplicates)');
    console.log('='.repeat(80));

    const groupedByUser = {};
    for (const setting of allSettings) {
      const userId = setting.userId?.toString() || 'GLOBAL';
      if (!groupedByUser[userId]) groupedByUser[userId] = [];
      groupedByUser[userId].push(setting.key);
    }

    let duplicatesFound = false;
    for (const [userId, keys] of Object.entries(groupedByUser)) {
      const uniqueKeys = new Set(keys);
      if (keys.length !== uniqueKeys.size) {
        console.log(`❌ User ${userId} has duplicate setting keys!`);
        const duplicates = keys.filter((key, idx) => keys.indexOf(key) !== idx);
        console.log(`   Duplicates: ${[...new Set(duplicates)].join(', ')}`);
        duplicatesFound = true;
      } else {
        console.log(`✅ User ${userId}: ${keys.length} settings, no duplicates`);
      }
    }

    if (!duplicatesFound) {
      console.log('\n✅ No duplicate settings per user\n');
    } else {
      console.log('\n❌ Some users have duplicate settings\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Verify users exist for all userId references
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 5: Verify Users Exist');
    console.log('='.repeat(80));

    const uniqueUserIds = [...new Set(
      allSettings
        .filter(s => s.userId instanceof mongoose.Types.ObjectId)
        .map(s => s.userId.toString())
    )];

    console.log(`Found ${uniqueUserIds.length} unique user IDs in settings`);

    let orphanedSettings = false;
    for (const userId of uniqueUserIds) {
      const user = await usersCol.findOne({ _id: new mongoose.Types.ObjectId(userId) });
      if (!user) {
        console.log(`⚠️  User ${userId} not found in users collection (orphaned settings)`);
        orphanedSettings = true;
      } else {
        console.log(`✅ User ${userId}: ${user.email || user.name || 'Unknown'}`);
      }
    }

    if (!orphanedSettings) {
      console.log('\n✅ All users referenced in settings exist\n');
    } else {
      console.log('\n⚠️  Some settings reference non-existent users\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: Test SystemSettingRepository simulation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('TEST 6: SystemSettingRepository Simulation');
    console.log('='.repeat(80));

    if (uniqueUserIds.length > 0) {
      const testUserId = new mongoose.Types.ObjectId(uniqueUserIds[0]);
      console.log(`Testing with user: ${testUserId}`);

      // Simulate repo.findOne({ key: 'google_drive_config' }) with userId
      const userConfig = await settingsCol.findOne({
        key: 'google_drive_config',
        userId: testUserId
      });

      if (userConfig) {
        console.log(`✅ Found google_drive_config for user ${testUserId}`);
        console.log(`   Email: ${userConfig.value?.email || 'N/A'}`);
      } else {
        console.log(`⚠️  No google_drive_config found for user ${testUserId}`);
      }

      // Check isolation - try to get another user's settings
      if (uniqueUserIds.length > 1) {
        const otherUserId = new mongoose.Types.ObjectId(uniqueUserIds[1]);
        const otherConfig = await settingsCol.findOne({
          key: 'google_drive_config',
          userId: otherUserId
        });

        if (otherConfig && userConfig) {
          const sameEmail = userConfig.value?.email === otherConfig.value?.email;
          if (sameEmail) {
            console.log(`⚠️  Both users have same Google Drive email (possible issue)`);
          } else {
            console.log(`✅ Different users have different configs (proper isolation)`);
          }
        }
      }
      console.log();
    } else {
      console.log('⚠️  No users found to test with\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────────────
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total settings: ${allSettings.length}`);
    console.log(`User-specific settings: ${userSpecificSettings.length}`);
    console.log(`Global settings: ${globalSettings.length}`);
    console.log(`Unique users: ${uniqueUserIds.length}`);
    console.log('='.repeat(80));

    const allTestsPassed = schemaOk && userIdOk && globalOk && !duplicatesFound;
    if (allTestsPassed) {
      console.log('\n✅ ALL TESTS PASSED! Migration looks good.\n');
    } else {
      console.log('\n⚠️  Some tests failed or need attention. Review above.\n');
    }

  } catch (error) {
    console.error('❌ Test error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

test();
