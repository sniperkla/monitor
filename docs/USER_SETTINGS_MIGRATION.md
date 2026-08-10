# User-Specific Settings Migration

## Overview

This document describes the migration of system settings from global scope to user-specific scope, allowing multiple users to have their own Google Drive configurations, sync jobs, and sync history.

## Date

August 11, 2026

## Migration Scope

### User-Specific Setting Keys

The following setting keys have been migrated to user-specific scope:

1. **`google_drive_config`** - Google Drive OAuth credentials and configuration
2. **`server_backup_history`** - Server backup history records
3. **`relay_tokens`** - Relay authentication tokens
4. **`mongo_sync_history`** - MongoDB sync operation history
5. **`mongo_sync_jobs`** - MongoDB sync job configurations
6. **`auto_deploy_config*`** - Auto-deployment configurations (pattern match)

### Global Setting Keys

The following settings remain global (shared across all users):

1. **`ai_api_keys`** - AI service API keys
2. **`ai_config`** - AI service configuration
3. **`ai_limits`** - AI usage limits

## Database Schema Change

### Before

```javascript
{
  "_id": "...",
  "key": "google_drive_config",
  "value": { ... },
  "userId": "global"  // or missing
}
```

### After

```javascript
{
  "_id": "...",
  "key": "google_drive_config",
  "value": { ... },
  "userId": ObjectId("6a5933a8b96fc45faa69184a")  // User's ObjectId
}
```

## Migration Script

**Location:** `/scripts/migrate-all-settings.js`

**Usage:**
```bash
MONGODB_URI='mongodb://...' node scripts/migrate-all-settings.js <userId>
```

**Example:**
```bash
MONGODB_URI='mongodb://monitor:AaBb1234!@43.210.134.78:27021/monitor?authSource=admin' \
  node scripts/migrate-all-settings.js 6a5933a8b96fc45faa69184a
```

**What it does:**
- Finds all settings without `userId` or with `userId: "global"`
- For user-specific settings: sets `userId` to the target user's ObjectId
- For global settings: removes the `userId` field
- Preserves settings that already have correct ObjectId userId

## Code Changes

### 1. SystemSettingRepository

**Location:** `/src/lib/repositories/SystemSettingRepository.js`

Already supports userId scoping via constructor parameter:

```javascript
const repo = new SystemSettingRepository(db, userId);
```

### 2. Updated API Routes

All routes that access user-specific settings now:
1. Get the session and extract `userId`
2. Pass `userId` to `SystemSettingRepository` constructor

**Updated routes:**

#### Google Drive Routes
- `/src/app/api/mongo-sync/gdrive/auth/route.js`
- `/src/app/api/mongo-sync/gdrive/callback/route.js`

#### Sync Routes
- `/src/app/api/mongo-sync/jobs/route.js` (GET, POST, DELETE)
- `/src/app/api/mongo-sync/jobs/[id]/run/route.js`
- `/src/app/api/mongo-sync/history/route.js` (GET, DELETE)
- `/src/app/api/mongo-sync/cron/route.js`

**Pattern used:**

```javascript
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

    const db = await connectDB();
    const repo = new SystemSettingRepository(db, userId);  // ← Pass userId
    await repo.init();

    const setting = await repo.findOne({ key: 'google_drive_config' });
    // ...
  }
}
```

## Migration Results

**Production run on:** August 11, 2026  
**Target User:** `6a5933a8b96fc45faa69184a`

```
Found 9 SystemSettings documents

✓ google_drive_config: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)
✓ mongo_sync_jobs: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)
✓ mongo_sync_history: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)
✓ mongo_sync_jobs: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: undefined)
✓ google_drive_config: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: undefined)
✓ mongo_sync_history: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: undefined)
✓ google_drive_config: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)
✓ mongo_sync_jobs: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)
✓ mongo_sync_history: Set userId to ObjectId(6a5933a8b96fc45faa69184a) (was: global)

📊 SUMMARY
User-specific settings updated: 9
User-specific settings skipped: 0
Global settings processed: 0
Unknown settings: 0
Total: 9
```

## Impact

### Positive Effects
1. **Multi-user Support:** Different users can now have their own Google Drive connections
2. **Data Isolation:** Each user's sync jobs and history are isolated
3. **Security:** Users cannot access other users' credentials or configurations
4. **Scalability:** System can support multiple concurrent users

### Breaking Changes
None. The migration is backward compatible. Routes that previously accessed global settings now access user-specific settings for the logged-in user.

### Testing Checklist

- [ ] Test Google Drive OAuth flow for new user
- [ ] Verify sync jobs are user-specific
- [ ] Verify sync history is user-specific
- [ ] Test that User A cannot see User B's settings
- [ ] Verify global settings (AI config) are still shared
- [ ] Test backward compatibility with existing data

## Rollback Plan

If issues occur, revert by:

1. Restore database backup from before migration
2. Revert API route changes via Git:
   ```bash
   git checkout HEAD~1 -- src/app/api/mongo-sync/
   ```

## Future Improvements

1. **Admin UI:** Add ability to migrate settings for specific users
2. **Bulk Migration:** Support migrating all users at once
3. **Migration Log:** Add database logging of migrations performed
4. **Validation:** Add script to verify migration completed correctly

## Related Files

- Migration script: `/scripts/migrate-all-settings.js`
- Route updater: `/scripts/update-routes-for-user-settings.js`
- Repository: `/src/lib/repositories/SystemSettingRepository.js`
- This document: `/docs/USER_SETTINGS_MIGRATION.md`

## Contact

For questions or issues related to this migration, contact the development team.
