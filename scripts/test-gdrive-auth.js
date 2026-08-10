#!/usr/bin/env node

/**
 * Quick Diagnostic - Google Drive Auth Flow
 * 
 * Tests the Google Drive authentication endpoints to diagnose issues.
 * 
 * Run: MONGODB_URI='...' node scripts/test-gdrive-auth.js
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is required');
  process.exit(1);
}

async function test() {
  try {
    console.log('🔍 Testing Google Drive Auth Setup\n');
    console.log('Connecting to:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(MONGODB_URI);

    const db = mongoose.connection.db;
    const settingsCol = db.collection('system_settings');
    const usersCol = db.collection('users');

    console.log('✅ Connected\n');
    console.log('='.repeat(80));
    console.log('TEST: Google Drive Configuration Check');
    console.log('='.repeat(80));

    // Check if any users exist
    const users = await usersCol.find({}).toArray();
    console.log(`\nFound ${users.length} user(s) in database:`);
    users.forEach(u => {
      console.log(`  - ${u.email || u.name} (${u._id})`);
    });

    if (users.length === 0) {
      console.log('\n❌ No users found! Cannot test auth without users.');
      return;
    }

    // Check each user's Google Drive config
    console.log('\n' + '-'.repeat(80));
    for (const user of users) {
      const userId = user._id;
      console.log(`\nUser: ${user.email || user.name} (${userId})`);
      
      const config = await settingsCol.findOne({
        key: 'google_drive_config',
        userId: userId
      });

      if (!config) {
        console.log('  ⚠️  No google_drive_config found');
        console.log('  → User needs to connect Google Drive');
      } else {
        console.log('  ✅ google_drive_config exists');
        console.log(`     Email: ${config.value?.email || 'N/A'}`);
        console.log(`     Has clientId: ${!!config.value?.clientId}`);
        console.log(`     Has clientSecret: ${!!config.value?.clientSecret}`);
        console.log(`     Has accessToken: ${!!config.value?.accessToken}`);
        console.log(`     Has refreshToken: ${!!config.value?.refreshToken}`);
        
        if (config.value?.expiresAt) {
          const expired = config.value.expiresAt < Date.now();
          console.log(`     Token expired: ${expired ? '❌ YES' : '✅ NO'}`);
          if (expired) {
            console.log('     → Token needs refresh');
          }
        }
      }
    }

    // Check environment variables
    console.log('\n' + '='.repeat(80));
    console.log('Environment Variables Check');
    console.log('='.repeat(80));
    
    const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    const hasRedirectUri = !!process.env.GDRIVE_REDIRECT_URI;
    const hasNextAuthUrl = !!process.env.NEXTAUTH_URL;

    console.log(`\nGOOGLE_CLIENT_ID: ${hasClientId ? '✅ Set' : '❌ Missing'}`);
    console.log(`GOOGLE_CLIENT_SECRET: ${hasClientSecret ? '✅ Set' : '❌ Missing'}`);
    console.log(`GDRIVE_REDIRECT_URI: ${hasRedirectUri ? '✅ Set' : '⚠️  Not set (will auto-detect)'}`);
    console.log(`NEXTAUTH_URL: ${hasNextAuthUrl ? '✅ Set' : '⚠️  Not set'}`);

    if (hasNextAuthUrl) {
      console.log(`  Value: ${process.env.NEXTAUTH_URL}`);
    }

    // Check for common issues
    console.log('\n' + '='.repeat(80));
    console.log('Common Issues Check');
    console.log('='.repeat(80));

    let hasIssues = false;

    if (!hasClientId || !hasClientSecret) {
      console.log('\n❌ ISSUE: Google OAuth credentials not configured');
      console.log('   Solution: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
      hasIssues = true;
    }

    // Check if userId field format is correct
    const allConfigs = await settingsCol.find({ key: 'google_drive_config' }).toArray();
    for (const config of allConfigs) {
      if (typeof config.userId === 'string') {
        console.log(`\n⚠️  ISSUE: google_drive_config has string userId: ${config.userId}`);
        console.log('   Solution: Run fix script to convert to ObjectId');
        hasIssues = true;
      } else if (!config.userId) {
        console.log(`\n⚠️  ISSUE: google_drive_config missing userId`);
        console.log('   Solution: Run migration script');
        hasIssues = true;
      }
    }

    if (!hasIssues) {
      console.log('\n✅ No configuration issues found!');
    }

    console.log('\n' + '='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    console.log(`Users: ${users.length}`);
    console.log(`Google Drive configs: ${allConfigs.length}`);
    console.log(`Environment configured: ${hasClientId && hasClientSecret ? 'Yes' : 'No'}`);
    console.log('='.repeat(80));

    if (hasClientId && hasClientSecret && users.length > 0) {
      console.log('\n✅ Ready to test Google Drive auth flow');
      console.log('\nTo test:');
      console.log('1. Start the application');
      console.log('2. Log in as a user');
      console.log('3. Navigate to MongoDB Backup → Google Drive Setup');
      console.log('4. Click "Connect Google Drive"');
      console.log('5. Check browser console for errors');
    } else {
      console.log('\n⚠️  Not ready for testing. Fix issues above first.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

test();
