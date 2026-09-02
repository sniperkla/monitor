# Deployment Checklist - User-Specific Settings Migration

## Date: August 11, 2026

## 🎯 What Changed

System settings migrated from **global scope** to **user-specific scope**, enabling multi-user support for Google Drive sync and MongoDB backup jobs.

---

## ✅ Pre-Deployment Checklist

### 1. Code Changes Verified

- [x] **6 API Routes Updated**
  - [x] `/api/mongo-sync/gdrive/auth/route.js`
  - [x] `/api/mongo-sync/gdrive/callback/route.js`
  - [x] `/api/mongo-sync/cron/route.js`
  - [x] `/api/mongo-sync/jobs/route.js`
  - [x] `/api/mongo-sync/jobs/[id]/run/route.js`
  - [x] `/api/mongo-sync/history/route.js`

- [x] **2 Background Processes Fixed**
  - [x] `/src/lib/mongoSyncJobRunner.js` - Manual job runner
  - [x] `/scripts/mongoSyncScheduler.js` - Automated scheduler

- [x] **All files syntax-checked** ✅

### 2. Migration Scripts Ready

- [x] `/scripts/migrate-all-settings.js` - Migrates settings to user-specific
- [x] `/scripts/verify-settings-migration.js` - Verifies migration success

### 3. Database Backup

- [ ] **CRITICAL**: Backup production database before deployment
  ```bash
  mongodump --uri="mongodb://monitor:<MONGO_PASSWORD>@43.210.134.78:27021/monitor?authSource=admin" --out=backup-$(date +%Y%m%d-%H%M%S)
  ```

---

## 📋 Deployment Steps

### Step 1: Backup Database ⚠️ CRITICAL

```bash
# On server or local machine
mongodump --uri="mongodb://monitor:<MONGO_PASSWORD>@43.210.134.78:27021/monitor?authSource=admin" \
  --out=/backup/monitor-backup-$(date +%Y%m%d-%H%M%S)
```

**Verify backup:**
```bash
ls -lh /backup/monitor-backup-*/
```

### Step 2: Commit and Push Code Changes

```bash
cd /Users/katanyoo/Desktop/monitor

# Review changes
git status
git diff

# Stage all changes
git add .

# Commit with detailed message
git commit -F COMMIT_MESSAGE.txt

# Or use shorter message
git commit -m "feat: Migrate system settings to user-specific scope for multi-user support"

# Push to repository
git push origin main
```

### Step 3: Deploy to Server

```bash
# SSH to server
ssh user@43.210.134.78

# Navigate to project directory
cd /path/to/monitor

# Pull latest changes
git pull origin main

# Rebuild Docker containers
docker compose down
docker compose up -d --build

# Check if containers are running
docker compose ps
```

### Step 4: Run Migration Script

**IMPORTANT:** Get the user ID first:

```bash
# Find the current user's ObjectId
docker compose exec monitor node -e "
require('./src/lib/mongodb.js').default().then(async () => {
  const mongoose = require('mongoose');
  const User = require('./src/models/User.js').default;
  const users = await User.find({});
  users.forEach(u => console.log(\`User: \${u.email} → ID: \${u._id}\`));
  process.exit(0);
});
"
```

**Run migration with the user ID:**

```bash
# Replace USER_ID_HERE with actual ObjectId
docker compose exec monitor sh -c "MONGODB_URI='mongodb://monitor:<MONGO_PASSWORD>@monitor-mongo:27017/monitor?authSource=admin' node scripts/migrate-all-settings.js USER_ID_HERE"
```

**Example:**
```bash
docker compose exec monitor sh -c "MONGODB_URI='mongodb://monitor:<MONGO_PASSWORD>@monitor-mongo:27017/monitor?authSource=admin' node scripts/migrate-all-settings.js 6a5933a8b96fc45faa69184a"
```

### Step 5: Verify Migration

```bash
docker compose exec monitor sh -c "MONGODB_URI='mongodb://monitor:<MONGO_PASSWORD>@monitor-mongo:27017/monitor?authSource=admin' node scripts/verify-settings-migration.js"
```

**Expected output:**
```
✅ All settings are properly scoped! Migration successful.

User-specific settings (OK): 9
User-specific settings (Issues): 0
Global settings (OK): 0
Global settings (Issues): 0
Unknown settings: 0
```

### Step 6: Restart Services

```bash
# Restart all containers to ensure clean state
docker compose restart

# Check logs for errors
docker compose logs -f --tail=100
```

### Step 7: Check mongoSyncScheduler

If you're running the scheduler as a separate process:

```bash
# Stop old scheduler if running
pkill -f mongoSyncScheduler

# Start new scheduler
cd /path/to/monitor
MONGODB_URI='mongodb://monitor:<MONGO_PASSWORD>@monitor-mongo:27017/monitor?authSource=admin' node scripts/mongoSyncScheduler.js &

# Or if using PM2
pm2 restart mongoSyncScheduler
pm2 logs mongoSyncScheduler --lines 50
```

---

## 🧪 Testing Checklist

### Test 1: Google Drive OAuth Flow

- [ ] Log in as the migrated user
- [ ] Go to MongoDB Backup app → Google Drive Setup
- [ ] Click "Connect Google Drive"
- [ ] Complete OAuth flow
- [ ] Verify connection shows correct email

### Test 2: Sync Jobs

- [ ] Create a new sync job
- [ ] Verify job appears in jobs list
- [ ] Click "Run Now"
- [ ] Verify backup completes successfully
- [ ] Check Google Drive folder for backup file

### Test 3: Sync History

- [ ] Navigate to Sync History tab
- [ ] Verify latest backup appears
- [ ] Check status is "success"

### Test 4: Automated Scheduler

- [ ] Wait for next scheduled run (or adjust schedule to every 5 min)
- [ ] Check scheduler logs for job execution
- [ ] Verify backup appears in Google Drive
- [ ] Verify history is updated

### Test 5: Multiple Users (if applicable)

- [ ] Create second user account
- [ ] Log in as second user
- [ ] Connect their own Google Drive
- [ ] Create sync job
- [ ] Verify User A cannot see User B's jobs
- [ ] Verify User B cannot see User A's jobs

---

## 🔍 Verification Queries

### Check Settings in Database

```javascript
// Connect to mongo shell
mongosh "mongodb://monitor:<MONGO_PASSWORD>@43.210.134.78:27021/monitor?authSource=admin"

// Check all settings
db.system_settings.find({}).pretty()

// Check specific user's settings
db.system_settings.find({ userId: ObjectId("6a5933a8b96fc45faa69184a") }).pretty()

// Count settings by type
db.system_settings.aggregate([
  { $group: { _id: "$key", count: { $sum: 1 } } }
])
```

### Check Scheduler is Running

```bash
# Check process
ps aux | grep mongoSyncScheduler

# Check recent logs
tail -f /var/log/mongo-sync-scheduler.log

# Or if using PM2
pm2 list
pm2 logs mongoSyncScheduler
```

---

## ⚠️ Troubleshooting

### Issue: Migration script fails

**Symptoms:**
```
Error: settings not found
```

**Solution:**
1. Verify MongoDB connection string is correct
2. Check user ID is valid ObjectId
3. Ensure database is accessible

### Issue: API routes return "Unauthorized"

**Symptoms:**
```
{ success: false, error: 'Unauthorized' }
```

**Solution:**
1. Clear browser cookies
2. Log out and log back in
3. Check session is being created properly

### Issue: Scheduler not running jobs

**Symptoms:**
- No logs appearing
- Jobs not executing

**Solution:**
1. Check scheduler is running: `ps aux | grep mongoSyncScheduler`
2. Check logs: `pm2 logs mongoSyncScheduler` or check log file
3. Verify MongoDB connection in scheduler
4. Check user has valid Google Drive config:
   ```javascript
   db.system_settings.findOne({ 
     key: 'google_drive_config', 
     userId: ObjectId("USER_ID") 
   })
   ```

### Issue: "User ID not found in session"

**Symptoms:**
```
{ success: false, error: 'User ID not found in session' }
```

**Solution:**
1. Check User model has `_id` field
2. Verify session configuration in `/src/lib/auth.js`
3. Check NextAuth callbacks are setting user.id correctly

### Issue: Jobs running but using wrong Google Drive

**Symptoms:**
- Backups appear in wrong Google Drive account
- Multiple users see same backups

**Solution:**
1. Verify migration completed: run verification script
2. Check each user has their own google_drive_config:
   ```javascript
   db.system_settings.find({ key: 'google_drive_config' })
   ```
3. Ensure each document has correct userId

---

## 🔄 Rollback Plan

If issues occur and you need to rollback:

### Step 1: Restore Database

```bash
# Stop application
docker compose down

# Restore from backup
mongorestore --drop --uri="mongodb://monitor:<MONGO_PASSWORD>@43.210.134.78:27021/monitor?authSource=admin" \
  /backup/monitor-backup-TIMESTAMP/monitor/
```

### Step 2: Revert Code

```bash
cd /path/to/monitor

# Revert to previous commit
git log --oneline -10  # Find the commit before migration
git revert HEAD        # Or git reset --hard PREVIOUS_COMMIT

# Rebuild
docker compose up -d --build
```

### Step 3: Restart Scheduler

```bash
# If using PM2
pm2 restart mongoSyncScheduler

# Or kill and restart manually
pkill -f mongoSyncScheduler
MONGODB_URI='...' node scripts/mongoSyncScheduler.js &
```

---

## 📞 Support

### Documentation References

- **Complete Guide:** `/docs/USER_SETTINGS_MIGRATION.md`
- **Key Structure:** `/docs/SETTINGS_KEY_STRUCTURE.md`
- **Examples:** `/docs/SETTINGS_EXAMPLES.txt`
- **Additional Issues:** `/docs/USER_SETTINGS_ADDITIONAL_ISSUES.md`

### Key Files

- Migration: `/scripts/migrate-all-settings.js`
- Verification: `/scripts/verify-settings-migration.js`
- Job Runner: `/src/lib/mongoSyncJobRunner.js`
- Scheduler: `/scripts/mongoSyncScheduler.js`

---

## ✅ Post-Deployment Verification

After deployment is complete, verify these indicators:

- [ ] Application starts without errors
- [ ] Users can log in successfully
- [ ] Google Drive OAuth flow works
- [ ] Sync jobs can be created and run
- [ ] Scheduler is processing jobs
- [ ] Backups appear in correct Google Drive folders
- [ ] Each user sees only their own jobs/history
- [ ] No error logs related to settings

---

## 📊 Success Metrics

The deployment is successful when:

1. ✅ Migration verification script passes
2. ✅ All tests in testing checklist pass
3. ✅ No errors in application logs
4. ✅ Scheduler successfully runs jobs for all users
5. ✅ Users can independently connect their Google Drive
6. ✅ Data isolation is verified (users can't see each other's data)

---

## 🎉 Completion

Once all checklist items are complete and verified:

1. Update MIGRATION_SUMMARY.md with deployment date
2. Mark this deployment as complete
3. Monitor logs for 24 hours for any issues
4. Document any issues encountered and resolutions

**Deployment Completed:** _______________  
**Verified By:** _______________  
**Notes:** _______________

