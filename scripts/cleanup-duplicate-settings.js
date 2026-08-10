#!/usr/bin/env node

/**
 * Cleanup Duplicate User Settings
 * 
 * After migration, there may be duplicate settings for the same (userId, key) pair.
 * This happens when multiple old documents (with different userId values like "global", 
 * missing, or ObjectId) all got migrated to the same target user.
 * 
 * This script:
 * 1. Finds duplicates for each (userId, key) pair
 * 2. Keeps the most recently updated document
 * 3. Deletes the older duplicates
 * 
 * Run: MONGODB_URI='...' node scripts/cleanup-duplicate-settings.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

async function cleanup() {
  try {
    console.log('🧹 Cleaning Up Duplicate User Settings\n');
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const col = db.collection('system_settings');

    console.log('✅ Connected\n');
    console.log('='.repeat(80));

    // Find all settings and group by (userId, key)
    const allSettings = await col.find({}).toArray();
    console.log(`Total settings: ${allSettings.length}\n`);

    const grouped = {};
    for (const setting of allSettings) {
      const userId = setting.userId?.toString() || 'GLOBAL';
      const key = setting.key;
      const compositeKey = `${userId}:${key}`;
      
      if (!grouped[compositeKey]) {
        grouped[compositeKey] = [];
      }
      grouped[compositeKey].push(setting);
    }

    // Find duplicates
    const duplicates = Object.entries(grouped).filter(([_, docs]) => docs.length > 1);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found! Database is clean.\n');
      return;
    }

    console.log(`Found ${duplicates.length} (userId, key) pairs with duplicates:\n`);

    let totalDeleted = 0;

    for (const [compositeKey, docs] of duplicates) {
      const [userIdStr, key] = compositeKey.split(':');
      console.log(`\n📝 ${key} (userId: ${userIdStr})`);
      console.log(`   Found ${docs.length} duplicate documents`);

      // Sort by updatedAt (most recent first), then by _id as fallback
      docs.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt) : new Date(0);
        const dateB = b.updatedAt ? new Date(b.updatedAt) : new Date(0);
        if (dateB - dateA !== 0) return dateB - dateA;
        return b._id.toString().localeCompare(a._id.toString());
      });

      const keep = docs[0];
      const remove = docs.slice(1);

      console.log(`   ✅ Keeping: ${keep._id} (updated: ${keep.updatedAt || 'N/A'})`);
      
      for (const doc of remove) {
        console.log(`   ❌ Removing: ${doc._id} (updated: ${doc.updatedAt || 'N/A'})`);
        await col.deleteOne({ _id: doc._id });
        totalDeleted++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(80));
    console.log(`Duplicate groups found: ${duplicates.length}`);
    console.log(`Documents deleted: ${totalDeleted}`);
    console.log(`Documents remaining: ${allSettings.length - totalDeleted}`);
    console.log('='.repeat(80));
    console.log('\n✅ Cleanup complete!\n');

    // Verify no duplicates remain
    const remaining = await col.find({}).toArray();
    const groupedAfter = {};
    for (const setting of remaining) {
      const userId = setting.userId?.toString() || 'GLOBAL';
      const key = setting.key;
      const compositeKey = `${userId}:${key}`;
      groupedAfter[compositeKey] = (groupedAfter[compositeKey] || 0) + 1;
    }

    const stillDuplicated = Object.entries(groupedAfter).filter(([_, count]) => count > 1);
    if (stillDuplicated.length > 0) {
      console.log('⚠️  Warning: Some duplicates still remain:');
      stillDuplicated.forEach(([key, count]) => {
        console.log(`   ${key}: ${count} documents`);
      });
    } else {
      console.log('✅ Verification: No duplicates remain\n');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

cleanup();
