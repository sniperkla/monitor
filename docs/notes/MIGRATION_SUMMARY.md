# Migration Summary - User-Specific Settings

## Date: August 11, 2026

## ✅ Migration Complete

All system settings have been successfully migrated from global scope to user-specific scope.

## 📊 Migration Results

**Database:** `monitor` on production server  
**Target User:** `6a5933a8b96fc45faa69184a`  
**Documents Migrated:** 9 settings

```
✓ google_drive_config (3 instances)
✓ mongo_sync_jobs (3 instances)
✓ mongo_sync_history (3 instances)
```

All settings now have proper `userId: ObjectId("6a5933a8b96fc45faa69184a")`.

## 📁 Files Created

### Migration Scripts
1. **`/scripts/migrate-all-settings.js`**
   - Migrates settings from global to user-specific
   - Usage: `MONGODB_URI='...' node scripts/migrate-all-settings.js <userId>`

2. **`/scripts/verify-settings-migration.js`**
   - Verifies migration was successful
   - Checks all settings are properly scoped
   - Usage: `MONGODB_URI='...' node scripts/verify-settings-migration.js`

3. **`/scripts/update-routes-for-user-settings.js`**
   - Automated script to update API routes
   - Adds session checks and userId passing
   - Usage: `node scripts/update-routes-for-user-settings.js`

### Documentation
4. **`/docs/USER_SETTINGS_MIGRATION.md`**
   - Complete migration documentation
   - Explains changes, impact, and rollback plan
   - Testing checklist and future improvements

5. **`/MIGRATION_SUMMARY.md`** (this file)
   - Quick summary of all changes

## 🔧 Files Modified

### API Routes Updated (7 files)

1. **`/src/app/api/mongo-sync/gdrive/auth/route.js`**
   - Added userId extraction from session
   - Pass userId to SystemSettingRepository

2. **`/src/app/api/mongo-sync/gdrive/callback/route.js`**
   - Added session imports
   - Added userId check
   - Pass userId to SystemSettingRepository

3. **`/src/app/api/mongo-sync/cron/route.js`**
   - Added userId extraction
   - Pass userId to SystemSettingRepository

4. **`/src/app/api/mongo-sync/jobs/route.js`**
   - Updated GET, POST, DELETE handlers
   - Added userId to getSettingRepo()
   - All handlers now user-scoped

5. **`/src/app/api/mongo-sync/jobs/[id]/run/route.js`**
   - Added userId extraction
   - Pass userId to SystemSettingRepository

6. **`/src/app/api/mongo-sync/history/route.js`**
   - Updated GET and DELETE handlers
   - Both handlers now user-scoped

### Critical Background Processes (2 files) ⚠️

7. **`/src/lib/mongoSyncJobRunner.js`** - CRITICAL FIX
   - Added userId extraction from session
   - Pass userId to SystemSettingRepository
   - Fixes "Run Now" button functionality

8. **`/scripts/mongoSyncScheduler.js`** - CRITICAL FIX
   - Complete rewrite for multi-user support
   - Now queries ALL users' mongo_sync_jobs
   - Gets each user's google_drive_config
   - Runs jobs with correct user context
   - Updates each user's history independently
   - All Google Drive functions updated (getDriveConfig, getAccessToken, ensureDriveFolder, uploadFileToDrive, listDriveFiles)

### Pattern Applied

All routes now follow this pattern:

```javascript
const session = await getServerSession(authOptions);
if (!session) {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
const userId = session.user?.id;
if (!userId) {
  return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
}

const db = await connectDB();
const repo = new SystemSettingRepository(db, userId);  // ← User-scoped
```

### Scheduler Multi-User Pattern

```javascript
// OLD: Single global setting
const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });

// NEW: All users' settings
const allJobSettings = await settingsCol.find({ key: 'mongo_sync_jobs' }).toArray();

for (const jobSetting of allJobSettings) {
  const userId = jobSetting.userId;
  const jobs = jobSetting.value || [];
  const driveSetting = await settingsCol.findOne({ 
    key: 'google_drive_config', 
    userId: userId 
  });
  // Run jobs for this user with their Drive config
}
```

## 🎯 User-Specific Settings

The following settings are now user-specific:

1. `google_drive_config` - OAuth tokens and Drive configuration
2. `server_backup_history` - Backup operation history
3. `relay_tokens` - Authentication tokens
4. `mongo_sync_history` - Sync operation history
5. `mongo_sync_jobs` - User's sync job definitions
6. `auto_deploy_config*` - Auto-deployment configurations (pattern)

## 🌍 Global Settings

These remain shared across all users:

1. `ai_api_keys` - AI service API keys
2. `ai_config` - AI configuration
3. `ai_limits` - AI usage limits

## ✨ Benefits

1. **Multi-User Support** - Each user can have their own Google Drive connection
2. **Data Isolation** - Users cannot see each other's sync jobs or history
3. **Security** - User credentials are isolated
4. **Scalability** - System ready for multiple concurrent users

## 🧪 Testing

### Verification Passed ✅

```bash
MONGODB_URI='mongodb://monitor:<MONGO_PASSWORD>@43.210.134.78:27021/monitor?authSource=admin' \
  node scripts/verify-settings-migration.js
```

**Result:**
```
User-specific settings (OK): 9
User-specific settings (Issues): 0
Global settings (OK): 0
Global settings (Issues): 0
Unknown settings: 0

✅ All settings are properly scoped! Migration successful.
```

### Manual Testing Required

- [ ] Test Google Drive OAuth flow for current user
- [ ] Verify sync jobs are visible only to owner
- [ ] Test sync history isolation
- [ ] Create a second user and verify they have separate settings
- [ ] Verify global AI settings are still accessible to all users

## 📦 Deployment

### To Deploy Changes:

1. **Review changes:**
   ```bash
   git diff
   ```

2. **Commit changes:**
   ```bash
   git add .
   git commit -m "Migrate system settings to user-specific scope"
   ```

3. **Push to server:**
   ```bash
   git push origin main
   ```

4. **On server, rebuild Docker:**
   ```bash
   cd /path/to/monitor
   git pull
   docker compose up -d --build
   ```

5. **Run migration on server:**
   ```bash
   docker compose exec monitor sh -c "MONGODB_URI='mongodb://...' node scripts/migrate-all-settings.js <userId>"
   ```

6. **Verify on server:**
   ```bash
   docker compose exec monitor sh -c "MONGODB_URI='mongodb://...' node scripts/verify-settings-migration.js"
   ```

## 🔄 Rollback Plan

If issues occur:

1. **Restore database:**
   ```bash
   # Restore from backup taken before migration
   mongorestore --drop --uri="mongodb://..." dump/
   ```

2. **Revert code:**
   ```bash
   git revert HEAD
   git push origin main
   docker compose up -d --build
   ```

## 📞 Support

For questions or issues:
- Review `/docs/USER_SETTINGS_MIGRATION.md` for detailed documentation
- Check verification script output
- Contact development team

## ✅ Completion Checklist

- [x] Created migration script
- [x] Created verification script
- [x] Updated all API routes to use userId
- [x] **Fixed mongoSyncJobRunner (manual job execution)**
- [x] **Fixed mongoSyncScheduler (background automation)**
- [x] **Verified rclone doesn't need changes**
- [x] Ran migration on production database
- [x] Verified migration success
- [x] Created comprehensive documentation
- [ ] Manual testing of Google Drive OAuth
- [ ] Manual testing of sync jobs
- [ ] Manual testing with multiple users
- [ ] Deployment to production server
- [ ] Final verification on production
- [ ] Monitor scheduler logs for 24 hours

---

**Migration code completed on:** August 11, 2026  
**Verified by:** Verification script (all checks passed)  
**Additional fixes:** mongoSyncJobRunner.js, mongoSyncScheduler.js  
**Status:** ✅ Ready for production deployment  

**IMPORTANT:** Follow DEPLOYMENT_CHECKLIST.md for deployment steps
