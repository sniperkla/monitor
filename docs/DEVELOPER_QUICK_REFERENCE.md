# Quick Reference: User-Specific Settings

## For Developers

Quick guide for working with user-specific system settings after migration.

---

## 🔑 Key Concepts

### Settings Are Now User-Scoped

- ✅ Each user has their own `google_drive_config`, `mongo_sync_jobs`, etc.
- ✅ Same setting **key** for all users, different **userId**
- ✅ Composite unique index: `(userId, key)`

### User-Specific Setting Keys

```javascript
// These settings are PER USER:
'google_drive_config'     // Google Drive OAuth tokens
'mongo_sync_jobs'         // Sync job definitions
'mongo_sync_history'      // Sync operation history
'server_backup_history'   // Server backup records
'relay_tokens'            // Authentication tokens
'auto_deploy_config*'     // Deployment configs (pattern match)
```

### Global Setting Keys

```javascript
// These settings are SHARED across all users:
'ai_api_keys'   // AI service API keys
'ai_config'     // AI configuration
'ai_limits'     // AI usage limits
```

---

## 📖 How To Use

### In API Routes

**Template for user-specific settings:**

```javascript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';

export async function GET(request) {
  // 1. Get session
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  
  // 2. Extract userId
  const userId = session.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
  }

  // 3. Create repository WITH userId
  const db = await connectDB();
  const repo = new SystemSettingRepository(db, userId);  // ← Pass userId here
  await repo.init();

  // 4. Query user's settings
  const setting = await repo.findOne({ key: 'google_drive_config' });
  
  return NextResponse.json({ success: true, data: setting?.value });
}
```

### For Global Settings

```javascript
// For global settings (AI config, etc.), pass 'global' or no userId
const repo = new SystemSettingRepository(db, 'global');
// or
const repo = new SystemSettingRepository(db);  // defaults to 'global'

const aiConfig = await repo.findOne({ key: 'ai_config' });
```

---

## 🗂️ Database Queries

### MongoDB Direct Queries

```javascript
const mongoose = require('mongoose');
const db = mongoose.connection.db;
const col = db.collection('system_settings');

// Get specific user's setting
const userSetting = await col.findOne({
  key: 'google_drive_config',
  userId: new mongoose.Types.ObjectId(userId)
});

// Get all users' jobs (for scheduler/admin)
const allJobs = await col.find({ 
  key: 'mongo_sync_jobs' 
}).toArray();

// Get global setting (no userId)
const aiConfig = await col.findOne({ 
  key: 'ai_config'
  // No userId field for global settings
});
```

---

## ⚠️ Common Mistakes

### ❌ Don't Do This

```javascript
// WRONG: No userId passed
const repo = new SystemSettingRepository(db);
const config = await repo.findOne({ key: 'google_drive_config' });
// This will query userId='global' and won't find user's config!
```

```javascript
// WRONG: Querying without userId in direct DB query
const config = await col.findOne({ key: 'google_drive_config' });
// This will return RANDOM user's config (first one found)!
```

```javascript
// WRONG: Assuming one global config
const allUsers = await User.find({});
const config = await repo.findOne({ key: 'google_drive_config' });
// Each user needs their OWN config!
```

### ✅ Do This Instead

```javascript
// CORRECT: Pass userId from session
const userId = session.user?.id;
const repo = new SystemSettingRepository(db, userId);
const config = await repo.findOne({ key: 'google_drive_config' });
```

```javascript
// CORRECT: Include userId in query
const config = await col.findOne({ 
  key: 'google_drive_config',
  userId: new mongoose.Types.ObjectId(userId)
});
```

```javascript
// CORRECT: Each user gets their own config
const allUsers = await User.find({});
for (const user of allUsers) {
  const repo = new SystemSettingRepository(db, user._id.toString());
  const config = await repo.findOne({ key: 'google_drive_config' });
  // Process user's config
}
```

---

## 🔄 Migration Reference

### When Adding New User-Specific Settings

1. **Add to USER_SPECIFIC_KEYS** in migration script:

```javascript
// scripts/migrate-all-settings.js
const USER_SPECIFIC_KEYS = [
  'google_drive_config',
  'mongo_sync_jobs',
  'your_new_setting_key',  // ← Add here
];
```

2. **Use with userId** in your code:

```javascript
const repo = new SystemSettingRepository(db, userId);
await repo.upsert('your_new_setting_key', data);
```

3. **Run migration** for existing data:

```bash
node scripts/migrate-all-settings.js <userId>
```

---

## 🧪 Testing

### Test User Isolation

```javascript
// User A's session
const userA = session.user.id; // "6a5933a8b96fc45faa69184a"
const repoA = new SystemSettingRepository(db, userA);
await repoA.upsert('google_drive_config', { email: 'userA@example.com' });

// User B's session
const userB = session.user.id; // "6a7123456789abcdef012345"
const repoB = new SystemSettingRepository(db, userB);
await repoB.upsert('google_drive_config', { email: 'userB@example.com' });

// Verify isolation
const configA = await repoA.findOne({ key: 'google_drive_config' });
const configB = await repoB.findOne({ key: 'google_drive_config' });

console.log(configA.value.email); // "userA@example.com"
console.log(configB.value.email); // "userB@example.com"
// ✅ Each user has their own config
```

---

## 📊 Debugging

### Check What's in Database

```javascript
// mongosh or Node.js
const col = db.collection('system_settings');

// List all settings
const all = await col.find({}).toArray();
console.table(all.map(s => ({ 
  key: s.key, 
  userId: s.userId?.toString() || 'NONE',
  _id: s._id.toString()
})));

// Check specific user's settings
const userId = "6a5933a8b96fc45faa69184a";
const userSettings = await col.find({ 
  userId: new mongoose.Types.ObjectId(userId) 
}).toArray();
console.log(`User ${userId} has ${userSettings.length} settings`);
userSettings.forEach(s => console.log(`  - ${s.key}`));
```

### Check if Setting Exists

```javascript
const repo = new SystemSettingRepository(db, userId);
const exists = await repo.findOne({ key: 'google_drive_config' });

if (!exists) {
  console.log('User has not connected Google Drive yet');
} else {
  console.log('User connected:', exists.value.email);
}
```

---

## 📝 Examples

### Create User's First Setting

```javascript
// When user connects Google Drive for first time
const userId = session.user.id;
const repo = new SystemSettingRepository(db, userId);

await repo.upsert('google_drive_config', {
  clientId: "...",
  clientSecret: "...",
  accessToken: "...",
  refreshToken: "...",
  email: "user@example.com"
});

// Creates new document:
// { _id: ObjectId("..."), key: "google_drive_config", userId: ObjectId(userId), value: {...} }
```

### Update Existing Setting

```javascript
// User updates their sync job
const userId = session.user.id;
const repo = new SystemSettingRepository(db, userId);

const jobsSetting = await repo.findOne({ key: 'mongo_sync_jobs' });
const jobs = jobsSetting?.value || [];

jobs.push({
  id: 'job-123',
  name: 'Daily Backup',
  schedule: 'daily'
});

await repo.upsert('mongo_sync_jobs', jobs);
// Updates existing document for this user
```

### Query All Users' Settings (Admin/Scheduler)

```javascript
// Background scheduler needs to run jobs for ALL users
const col = db.collection('system_settings');

const allJobSettings = await col.find({ key: 'mongo_sync_jobs' }).toArray();

for (const jobSetting of allJobSettings) {
  const userId = jobSetting.userId;
  const jobs = jobSetting.value || [];
  
  // Get this user's Google Drive config
  const driveConfig = await col.findOne({ 
    key: 'google_drive_config', 
    userId: userId 
  });
  
  // Process jobs for this user
  console.log(`Processing ${jobs.length} jobs for user ${userId}`);
}
```

---

## 🆘 Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot find setting` | Not passing userId | Pass userId to SystemSettingRepository |
| `User ID not found in session` | Session doesn't have user.id | Check NextAuth configuration |
| `Multiple configs found` | Direct query without userId | Always include userId in queries |
| `Setting appears empty` | Querying global instead of user | Verify userId is being passed |

---

## 📚 Documentation

- **Complete Guide:** `/docs/USER_SETTINGS_MIGRATION.md`
- **Key Structure:** `/docs/SETTINGS_KEY_STRUCTURE.md`
- **Examples:** `/docs/SETTINGS_EXAMPLES.txt`
- **Deployment:** `/DEPLOYMENT_CHECKLIST.md`

---

## ✅ Checklist for New Code

When writing code that uses settings:

- [ ] Import getServerSession and authOptions
- [ ] Extract userId from session
- [ ] Validate userId exists
- [ ] Pass userId to SystemSettingRepository
- [ ] Handle case where setting doesn't exist
- [ ] Test with multiple users

**Last Updated:** August 11, 2026
