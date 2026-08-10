# System Settings Key Structure for New Users

## Question: What happens when a new user creates their first Google Drive config?

When a new user connects their Google Drive account, the system creates a **user-specific** setting document.

## Document Structure

### For a New User

When User B (userId: `6a7123456789abcdef012345`) connects Google Drive for the first time:

```javascript
{
  "_id": ObjectId("6a7999..."),           // Auto-generated MongoDB ID
  "key": "google_drive_config",           // Setting key (same for all users)
  "userId": ObjectId("6a7123456789abcdef012345"),  // User B's ID
  "value": {
    "clientId": "123456789.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-...",
    "accessToken": "ya29.a0...",
    "refreshToken": "1//0g...",
    "expiresAt": 1723334257000,
    "connectedAt": 1723330657000,
    "email": "userb@example.com",
    "name": "User B",
    "picture": "https://lh3.googleusercontent.com/..."
  },
  "createdAt": ISODate("2026-08-11T02:30:57Z"),
  "updatedAt": ISODate("2026-08-11T02:30:57Z")
}
```

### For Existing User (User A)

User A (userId: `6a5933a8b96fc45faa69184a`) already has their own config:

```javascript
{
  "_id": ObjectId("6a71..."),
  "key": "google_drive_config",           // Same key name
  "userId": ObjectId("6a5933a8b96fc45faa69184a"),  // User A's ID (different)
  "value": {
    "clientId": "123456789.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-...",
    "accessToken": "ya29.a0...",
    "refreshToken": "1//0g...",
    "expiresAt": 1723334257000,
    "connectedAt": 1723330657000,
    "email": "usera@example.com",          // Different email
    "name": "User A",
    "picture": "https://lh3.googleusercontent.com/..."
  },
  "createdAt": ISODate("2026-08-10T14:22:15Z"),
  "updatedAt": ISODate("2026-08-10T14:22:15Z")
}
```

## Key Points

### 1. The `key` Field is the Same

Both users have documents with:
```javascript
"key": "google_drive_config"
```

The key identifies **what type** of setting it is, not **who owns** it.

### 2. The `userId` Field Differentiates Users

The `userId` field makes each setting unique per user:

```javascript
// User A's config
{ "key": "google_drive_config", "userId": ObjectId("6a5933...") }

// User B's config  
{ "key": "google_drive_config", "userId": ObjectId("6a7123...") }
```

### 3. Composite Unique Index

The MongoDB collection should have a unique index on `(userId, key)`:

```javascript
db.system_settings.createIndex({ userId: 1, key: 1 }, { unique: true })
```

This ensures:
- Each user can have only ONE `google_drive_config`
- Different users can have their own `google_drive_config`
- Prevents duplicate settings per user

## How SystemSettingRepository Works

### Constructor

```javascript
const repo = new SystemSettingRepository(db, userId);
```

The `userId` is stored in the repository instance and used for all operations.

### Finding a Setting

```javascript
// User A's session
const userId = "6a5933a8b96fc45faa69184a";
const repo = new SystemSettingRepository(db, userId);
const setting = await repo.findOne({ key: 'google_drive_config' });
```

Behind the scenes, this queries:
```javascript
db.system_settings.findOne({ 
  userId: ObjectId("6a5933a8b96fc45faa69184a"),
  key: "google_drive_config" 
})
```

### Creating/Updating a Setting (Upsert)

```javascript
// User B's session
const userId = "6a7123456789abcdef012345";
const repo = new SystemSettingRepository(db, userId);
await repo.upsert('google_drive_config', driveConfigData);
```

MongoDB operation:
```javascript
db.system_settings.updateOne(
  { 
    userId: ObjectId("6a7123456789abcdef012345"),
    key: "google_drive_config" 
  },
  { 
    $set: { 
      userId: ObjectId("6a7123456789abcdef012345"),
      key: "google_drive_config",
      value: driveConfigData,
      updatedAt: new Date()
    }
  },
  { upsert: true }  // ← Create if doesn't exist
)
```

## User Isolation

### Query Scoping

All queries are automatically scoped to the logged-in user:

```javascript
// API route
const session = await getServerSession(authOptions);
const userId = session.user?.id;  // "6a7123456789abcdef012345"

const repo = new SystemSettingRepository(db, userId);
```

### What Each User Sees

**User A queries google_drive_config:**
- Receives their own config with `usera@example.com`
- Cannot see User B's config

**User B queries google_drive_config:**
- Receives their own config with `userb@example.com`
- Cannot see User A's config

## Database Query Examples

### Find All Configs (Admin View)

```javascript
db.system_settings.find({ key: "google_drive_config" })
```

Returns:
```javascript
[
  { _id: "...", key: "google_drive_config", userId: ObjectId("6a5933..."), value: {...} },
  { _id: "...", key: "google_drive_config", userId: ObjectId("6a7123..."), value: {...} },
  { _id: "...", key: "google_drive_config", userId: ObjectId("6a8456..."), value: {...} }
]
```

### Find User B's Config

```javascript
db.system_settings.findOne({ 
  key: "google_drive_config",
  userId: ObjectId("6a7123456789abcdef012345")
})
```

Returns only User B's document.

## Same Pattern for All User-Specific Settings

This same structure applies to all user-specific settings:

```javascript
// User A's sync jobs
{ key: "mongo_sync_jobs", userId: ObjectId("6a5933..."), value: [...jobs...] }

// User B's sync jobs
{ key: "mongo_sync_jobs", userId: ObjectId("6a7123..."), value: [...jobs...] }

// User A's sync history
{ key: "mongo_sync_history", userId: ObjectId("6a5933..."), value: [...history...] }

// User B's sync history  
{ key: "mongo_sync_history", userId: ObjectId("6a7123..."), value: [...history...] }
```

## Summary

**Answer to your question:**

> "If new user creates setting, what should the key be?"

**The key remains the same: `"google_drive_config"`**

What changes is:
- `userId`: The new user's ObjectId
- `_id`: Auto-generated unique MongoDB document ID
- `value`: The new user's specific configuration data

The combination of `(userId, key)` makes each setting unique per user.

---

**Example for clarity:**

| _id | key | userId | value.email |
|-----|-----|--------|-------------|
| 6a71... | `google_drive_config` | ObjectId(6a5933...) | usera@example.com |
| 6a79... | `google_drive_config` | ObjectId(6a7123...) | userb@example.com |
| 6a81... | `google_drive_config` | ObjectId(6a8456...) | userc@example.com |

All have the **same key**, different **userId** and **_id**.
