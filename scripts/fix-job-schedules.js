#!/usr/bin/env node

/**
 * Fix MongoDB Sync Jobs - Schedule and Duplicates
 * 
 * Fixes:
 * 1. Removes duplicate mongo_sync_jobs documents for same user
 * 2. Converts cron format schedules (*/5 * * * *) to proper keywords (every_5_min) or manual
 * 
 * Run: MONGODB_URI='...' node scripts/fix-job-schedules.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

// Map cron expressions to valid schedule keywords
const cronToSchedule = {
  '*/5 * * * *': 'every_5_min',
  '*/15 * * * *': 'every_15_min',
  '*/30 * * * *': 'every_30_min',
  '0 * * * *': 'hourly',
  '0 0 * * *': 'daily',
  '0 0 * * 0': 'weekly',
};

async function fix() {
  try {
    console.log('🔧 Fixing MongoDB Sync Jobs\n');
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const col = db.collection('system_settings');

    console.log('✅ Connected\n');
    console.log('='.repeat(80));

    // Step 1: Remove duplicates
    console.log('STEP 1: Check for duplicate mongo_sync_jobs\n');
    
    const allJobSettings = await col.find({ key: 'mongo_sync_jobs' }).toArray();
    const grouped = {};
    
    for (const setting of allJobSettings) {
      const userId = setting.userId instanceof mongoose.Types.ObjectId 
        ? setting.userId.toString() 
        : (setting.userId || 'GLOBAL');
      
      if (!grouped[userId]) grouped[userId] = [];
      grouped[userId].push(setting);
    }

    let duplicatesRemoved = 0;
    for (const [userId, docs] of Object.entries(grouped)) {
      if (docs.length > 1) {
        console.log(`Found ${docs.length} documents for user ${userId}`);
        
        // Sort by updatedAt (keep most recent)
        docs.sort((a, b) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt) : new Date(0);
          const dateB = b.updatedAt ? new Date(b.updatedAt) : new Date(0);
          return dateB - dateA;
        });

        const keep = docs[0];
        const remove = docs.slice(1);

        console.log(`  Keeping: ${keep._id} (${keep.value?.length || 0} jobs)`);
        
        for (const doc of remove) {
          console.log(`  Removing: ${doc._id} (${doc.value?.length || 0} jobs)`);
          await col.deleteOne({ _id: doc._id });
          duplicatesRemoved++;
        }
      }
    }

    if (duplicatesRemoved > 0) {
      console.log(`\n✅ Removed ${duplicatesRemoved} duplicate(s)\n`);
    } else {
      console.log(`✅ No duplicates found\n`);
    }

    // Step 2: Fix schedule formats
    console.log('='.repeat(80));
    console.log('STEP 2: Fix schedule formats\n');

    const jobSettings = await col.find({ key: 'mongo_sync_jobs' }).toArray();
    let jobsFixed = 0;

    for (const setting of jobSettings) {
      const userId = setting.userId instanceof mongoose.Types.ObjectId 
        ? setting.userId.toString() 
        : (setting.userId || 'GLOBAL');
      
      const jobs = setting.value || [];
      let modified = false;

      for (const job of jobs) {
        const oldSchedule = job.schedule;

        // Convert cron format to keyword
        if (oldSchedule && cronToSchedule[oldSchedule]) {
          job.schedule = cronToSchedule[oldSchedule];
          console.log(`Job: ${job.name}`);
          console.log(`  Changed: "${oldSchedule}" → "${job.schedule}"`);
          modified = true;
          jobsFixed++;
        }
        // Convert undefined/null to manual
        else if (!oldSchedule || oldSchedule === 'undefined') {
          job.schedule = 'manual';
          console.log(`Job: ${job.name}`);
          console.log(`  Set to: "manual" (was ${oldSchedule || 'undefined'})`);
          modified = true;
          jobsFixed++;
        }
      }

      if (modified) {
        await col.updateOne(
          { _id: setting._id },
          { $set: { value: jobs, updatedAt: new Date() } }
        );
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Duplicates removed: ${duplicatesRemoved}`);
    console.log(`Jobs fixed: ${jobsFixed}`);
    console.log('='.repeat(80));
    console.log('\n✅ Fix complete!\n');

    // Verify
    console.log('Verifying...\n');
    const finalSettings = await col.find({ key: 'mongo_sync_jobs' }).toArray();
    
    for (const setting of finalSettings) {
      const userId = setting.userId instanceof mongoose.Types.ObjectId 
        ? setting.userId.toString() 
        : (setting.userId || 'GLOBAL');
      const jobs = setting.value || [];
      
      console.log(`User ${userId}: ${jobs.length} job(s)`);
      jobs.forEach(j => {
        console.log(`  - ${j.name}: schedule="${j.schedule}", enabled=${j.enabled !== false}`);
      });
    }

    console.log('\n✅ All done!\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

fix();
