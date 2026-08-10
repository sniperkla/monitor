#!/usr/bin/env node

/**
 * Diagnostic: Check MongoDB Sync Jobs Schedule Settings
 * 
 * This checks if any jobs have incorrect schedule values that might
 * cause them to run automatically when they shouldn't.
 * 
 * Run: MONGODB_URI='...' node scripts/check-job-schedules.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

async function check() {
  try {
    console.log('🔍 Checking MongoDB Sync Job Schedules\n');
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const col = db.collection('system_settings');

    // Find all mongo_sync_jobs settings
    const jobSettings = await col.find({ key: 'mongo_sync_jobs' }).toArray();

    console.log(`\nFound ${jobSettings.length} mongo_sync_jobs setting(s)\n`);
    console.log('='.repeat(80));

    let totalJobs = 0;
    let manualJobs = 0;
    let scheduledJobs = 0;
    let invalidSchedules = [];

    for (const setting of jobSettings) {
      const userId = setting.userId instanceof mongoose.Types.ObjectId 
        ? setting.userId.toString() 
        : (setting.userId || 'GLOBAL');
      
      const jobs = setting.value || [];
      totalJobs += jobs.length;

      console.log(`\nUser: ${userId}`);
      console.log(`Jobs: ${jobs.length}`);
      console.log('-'.repeat(80));

      for (const job of jobs) {
        const schedule = job.schedule || 'undefined';
        const enabled = job.enabled !== false; // default true
        const hasLastRun = !!job.lastRun;
        const lastRunDate = job.lastRun ? new Date(job.lastRun).toISOString() : 'never';

        console.log(`\nJob: ${job.name} (${job.id})`);
        console.log(`  Schedule: ${schedule}`);
        console.log(`  Enabled: ${enabled}`);
        console.log(`  Last Run: ${lastRunDate}`);
        console.log(`  Last Status: ${job.lastStatus || 'none'}`);

        // Check if manual
        if (schedule === 'manual') {
          manualJobs++;
          console.log(`  ✅ Correctly set as MANUAL`);
        } else {
          scheduledJobs++;
          console.log(`  ⏰ SCHEDULED job (will run automatically)`);
        }

        // Check for invalid/unusual schedules
        const validSchedules = ['manual', 'every_5_min', 'every_15_min', 'every_30_min', 'hourly', 'daily', 'weekly'];
        if (!validSchedules.includes(schedule) && schedule !== 'undefined') {
          invalidSchedules.push({
            jobId: job.id,
            jobName: job.name,
            userId,
            schedule,
            enabled
          });
          console.log(`  ⚠️  UNUSUAL SCHEDULE: "${schedule}"`);
        }

        // Warn if enabled but manual
        if (enabled && schedule === 'manual' && hasLastRun) {
          console.log(`  ℹ️  Note: Manual job has run history (last run: ${lastRunDate})`);
        }

        // Warn if auto-run is happening
        if (schedule === 'manual' && hasLastRun) {
          const timeSinceRun = Date.now() - job.lastRun;
          const minutesSince = Math.floor(timeSinceRun / (1000 * 60));
          console.log(`  ℹ️  Last run ${minutesSince} minutes ago`);
          
          if (minutesSince < 30) {
            console.log(`  ⚠️  WARNING: Manual job ran recently! Check if scheduler is running it.`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total jobs: ${totalJobs}`);
    console.log(`Manual jobs: ${manualJobs}`);
    console.log(`Scheduled jobs: ${scheduledJobs}`);
    console.log(`Invalid schedules: ${invalidSchedules.length}`);
    console.log('='.repeat(80));

    if (invalidSchedules.length > 0) {
      console.log('\n⚠️  Jobs with invalid schedule values:');
      invalidSchedules.forEach(({ jobName, jobId, userId, schedule, enabled }) => {
        console.log(`  - ${jobName} (${jobId})`);
        console.log(`    User: ${userId}`);
        console.log(`    Schedule: "${schedule}"`);
        console.log(`    Enabled: ${enabled}`);
      });
      console.log('\nThese jobs might run unexpectedly. Fix by setting schedule to "manual" or a valid schedule.');
    }

    console.log('\n✅ Diagnostic complete\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

check();
