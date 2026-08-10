# User-Specific Settings - Additional Issues Found

## Date: August 11, 2026

## 🔍 Issues Discovered

After reviewing rclone and mongo sync related code, I found **2 critical issues** that need fixing:

---

## Issue 1: mongoSyncJobRunner.js Missing userId

**File:** `/src/lib/mongoSyncJobRunner.js`

**Problem:**
```javascript
const db = await connectDB(null, true);
const settingRepo = new SystemSettingRepository(db);  // ❌ No userId!
await settingRepo.init();

const jobsSetting = await settingRepo.findOne({ key: 'mongo_sync_jobs' });
```

**Impact:**
- Will fail to find user's sync jobs (queries without userId)
- Jobs won't run properly

**Fix Required:**
```javascript
const session = await getServerSession(authOptions);
const userId = session.user?.id;
if (!userId) {
  return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
}

const db = await connectDB(null, true);
const settingRepo = new SystemSettingRepository(db, userId);  // ✅ Pass userId
```

---

## Issue 2: mongoSyncScheduler.js - Background Process

**File:** `/scripts/mongoSyncScheduler.js`

**Problem:**
This is a **background Node.js process** that runs independently without user sessions:

```javascript
const settingsCol = db.collection('system_settings');
const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });
const driveSetting = await settingsCol.findOne({ key: 'google_drive_config' });
```

**Impact:**
- Queries without `userId` field
- Won't find any user-specific settings
- Scheduler will stop working completely
- Background sync jobs won't run

**Fix Required:**

The scheduler needs to be updated to handle **multi-user** scenarios:

```javascript
// OLD: Query single global setting
const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });

// NEW: Query ALL users' settings
const allJobSettings = await settingsCol.find({ 
  key: 'mongo_sync_jobs' 
}).toArray();

for (const jobSetting of allJobSettings) {
  const userId = jobSetting.userId;
  const jobs = jobSetting.value || [];
  
  // Get this user's Google Drive config
  const driveSetting = await settingsCol.findOne({ 
    key: 'google_drive_config',
    userId: userId 
  });
  
  // Run jobs for this user
  for (const job of jobs) {
    if (shouldRunJob(job)) {
      await runJob(job, userId, driveSetting);
    }
  }
}
```

---

## Issue 3: Rclone - No Issues Found ✅

**Status:** Rclone does NOT use system_settings

**Storage:**
- Rclone config is stored directly on SSH servers in `~/.config/rclone/rclone.conf`
- Cron jobs are stored on SSH servers in `~/.rclone-scripts/`
- UI preferences stored in browser localStorage only

**Conclusion:** No changes needed for rclone

---

## Summary of Findings

| Component | Uses system_settings? | Needs Update? | Status |
|-----------|----------------------|---------------|--------|
| **Google Drive Routes** | ✅ Yes | ✅ **FIXED** | Complete |
| **Sync Jobs Routes** | ✅ Yes | ✅ **FIXED** | Complete |
| **Sync History Routes** | ✅ Yes | ✅ **FIXED** | Complete |
| **mongoSyncJobRunner** | ✅ Yes | ❌ **NOT FIXED** | **TODO** |
| **mongoSyncScheduler** | ✅ Yes | ❌ **NOT FIXED** | **TODO** |
| **Rclone** | ❌ No | N/A | No action needed |

---

## Action Plan

### Step 1: Fix mongoSyncJobRunner.js ⚠️

Update to extract userId from session and pass to SystemSettingRepository.

**Files to modify:**
- `/src/lib/mongoSyncJobRunner.js`

### Step 2: Fix mongoSyncScheduler.js ⚠️

This is **critical** and requires a different approach because it's a background process without session context.

**Options:**

#### Option A: Multi-User Scheduler (Recommended)
Update scheduler to iterate through all users' settings:
- Find all `mongo_sync_jobs` documents (all users)
- For each user, get their Google Drive config
- Run jobs for each user with their respective settings

#### Option B: Per-User Scheduler
Run separate scheduler instances per user (more complex, not recommended)

#### Option C: Store userId with each job
Store userId in the job document itself so scheduler knows which user's Drive config to use

**Recommendation:** Go with **Option A** - it's the simplest and most scalable.

---

## Additional Considerations

### 1. mongoSyncScheduler runs without session
- Cannot use `getServerSession()`
- Must query database directly
- Needs to handle multiple users

### 2. Google Drive tokens per user
- Each user has their own refresh_token
- Scheduler must use correct token for each user's jobs
- Token refresh must be per-user

### 3. History updates per user
- When scheduler runs a job, it must update correct user's history
- Must use userId when updating `mongo_sync_history`

---

## Files That Need Updates

### Critical (Breaks functionality)
1. ✅ `/src/lib/mongoSyncJobRunner.js` - Add userId support
2. ✅ `/scripts/mongoSyncScheduler.js` - Multi-user support

### Already Fixed ✅
1. `/src/app/api/mongo-sync/gdrive/auth/route.js`
2. `/src/app/api/mongo-sync/gdrive/callback/route.js`
3. `/src/app/api/mongo-sync/cron/route.js`
4. `/src/app/api/mongo-sync/jobs/route.js`
5. `/src/app/api/mongo-sync/jobs/[id]/run/route.js`
6. `/src/app/api/mongo-sync/history/route.js`

### No Changes Needed
1. Rclone routes (don't use system_settings)

---

## Next Steps

1. **Fix mongoSyncJobRunner.js** - Add userId support
2. **Fix mongoSyncScheduler.js** - Add multi-user iteration
3. **Test background scheduler** - Ensure it works for multiple users
4. **Update migration notes** - Document these additional fixes

---

## Impact if Not Fixed

### mongoSyncJobRunner
- Manual "Run Now" button in UI will fail
- Error: Cannot find mongo_sync_jobs setting

### mongoSyncScheduler
- Background automated sync jobs will stop working
- Scheduled backups won't run
- No backups will be uploaded to Google Drive automatically

**Priority:** 🔴 **CRITICAL** - Must fix before deploying
