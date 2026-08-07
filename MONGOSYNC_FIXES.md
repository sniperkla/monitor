# MongoSync Backup Script Fixes — 2026-08-06

## Issues Fixed

### 1. ✅ Subfolder Creation JSON Error
**Symptom:** `Invalid JSON payload received. Unable to parse number`  
**Root Cause:** Passing JSON as shell variable `-d "$SUBFOLDER_BODY"` caused bash expansion issues  
**Fix:** Write JSON to temp file and use `-d @tempfile`  
**Files:** `src/app/api/mongo-sync/cron/route.js`

### 2. ✅ Collection Listing — mongosh Quote Escaping
**Symptom:** mongosh receives literal string `$DB_NAME` instead of database name  
**Root Cause:** Used `'$DB_NAME'` with single quotes inside double-quoted bash string  
**Fix:** Changed to `\"$DB_NAME\"` so bash expands variable before mongosh sees it  
**Files:** `src/app/api/mongo-sync/cron/route.js`

### 3. ✅ Python Syntax Error in pymongo Error Logging
**Symptom:** `SyntaxError: invalid syntax` in Python error handling  
**Root Cause:** `print(..., file=sys.stderr)` caused bash quoting issues  
**Fix:** Changed to `sys.stderr.write(...)`  
**Files:** `src/app/api/mongo-sync/cron/route.js`

### 4. ✅ Missing authSource Parameter (Authentication Failures)
**Symptom:** `MongoServerError: Authentication failed.`  
**Root Cause:** MongoDB requires `authSource` parameter when using username/password, but connections without explicit authSource were not getting the default  
**Fix:** Default to `authSource=admin` when username/password are present but authSource is not explicitly set  
**Files:**
- `src/app/api/mongo-sync/cron/route.js` (buildMongoUri)
- `src/lib/dbPool.js` (buildMongoUri)
- `scripts/mongoSyncScheduler.js` (getExternalMongoDb)

### 5. ✅ Improved Diagnostic Logging
**Added:**
- Sanitized MongoDB URI (password masked) to logs
- Database name to logs
- Raw mongosh output before filtering
- Pymongo error messages with full details
- Better collection filtering with regex for valid collection names

**Files:** `src/app/api/mongo-sync/cron/route.js`

## Generated Bash Script Changes

### Before (buggy):
```bash
# Subfolder creation
SUBFOLDER_BODY=$(python3 -c "..." "$FOLDER_DATE" "$GDRIVE_FOLDER_ID")
curl ... -d "$SUBFOLDER_BODY" ...

# Collection listing
COLLS=$("$SHELL_BIN" "$MONGO_URI" --eval "db.getSiblingDB('$DB_NAME').getCollectionNames()..." ...)

# MongoDB URI
MONGO_URI='mongodb://user:pass@host:port/db'
```

### After (fixed):
```bash
# Subfolder creation
_SUBFOLDER_JSON_FILE="$TMP_DIR/subfolder_meta_$TIMESTAMP.json"
python3 -c "..." > "$_SUBFOLDER_JSON_FILE"
curl ... -d @"$_SUBFOLDER_JSON_FILE" ...

# Collection listing
_MONGOSH_OUT=$("$SHELL_BIN" "$MONGO_URI" --eval "db.getSiblingDB(\"$DB_NAME\").getCollectionNames().forEach(function(n){print(n)})" --quiet --norc 2>&1)
COLLS=$(echo "$_MONGOSH_OUT" | grep -E "^[a-zA-Z_][a-zA-Z0-9._-]*$" | grep -v "^Current" ...)

# MongoDB URI with authSource
_SANITIZED_URI=$(echo "$MONGO_URI" | sed "s#://[^:]*:[^@]*@#://***:***@#")
echo "$(date): MongoDB URI: $_SANITIZED_URI" >> "$LOG"

# Pymongo with error capture
_PYMONGO_OUT=$(python3 -c "
...
except Exception as e:
  sys.stderr.write(str(e) + chr(10))
  sys.exit(1)
" "$MONGO_URI" "$DB_NAME" 2>&1)
```

## Expected Log Output (After Fixes)

```
Thu Aug  6 18:55:01 +07 2026: MongoDB URI: mongodb://***:***@3.1.41.227:27020/jeawweaw?authSource=admin
Thu Aug  6 18:55:01 +07 2026: Database: jeawweaw
Thu Aug  6 18:55:01 +07 2026: Disk usage: 44% — OK
=== MongoSync: job-name | 20260806_185501 ===
Thu Aug  6 18:55:01 +07 2026: OAuth token obtained.
Thu Aug  6 18:55:01 +07 2026: Using mongoexport: /home/ec2-user/.local/bin/mongoexport
Thu Aug  6 18:55:01 +07 2026: Using mongo shell: /home/ec2-user/.local/bin/mongosh
Thu Aug  6 18:55:01 +07 2026: pymongo already available.
Thu Aug  6 18:55:03 +07 2026: Subfolder ready: 2026-08-06_18-55 (1Iv5aPYYxildqre9y0tS6RmP3Le3bonbl)
Thu Aug  6 18:55:03 +07 2026: Resource limits: nice=nice -n 19 ionice=ionice -c 3
Thu Aug  6 18:55:03 +07 2026: Listing collections in mydb ...
Thu Aug  6 18:55:03 +07 2026: Trying mongosh: /home/ec2-user/.local/bin/mongosh
Thu Aug  6 18:55:03 +07 2026: mongosh raw output:
users
orders
products
Thu Aug  6 18:55:03 +07 2026: mongosh collections: users orders products
Thu Aug  6 18:55:03 +07 2026: Collections found: users orders products
Thu Aug  6 18:55:05 +07 2026: Exporting collection: users ...
Thu Aug  6 18:55:06 +07 2026: Uploading users.json.gz (1.2M) ...
Thu Aug  6 18:55:08 +07 2026: Uploaded: users.json.gz
...
=== Done | Thu Aug  6 18:55:15 +07 2026 ===
```

## User Action Required

1. **Re-install the cron job** on the SSH server to deploy the fixed script:
   - Open MongoBackupApp UI
   - Find your backup job
   - Go to Schedule tab
   - Click "Install/Update Schedule"

2. **Verify the next run** shows `authSource=admin` in the log:
   ```
   MongoDB URI: mongodb://***:***@host:port/db?authSource=admin
   ```

3. **If authentication still fails**, check:
   - Username/password are correct
   - User has proper permissions on the target database
   - If your MongoDB users are in a different auth database, explicitly set `authSource` in the connection settings

## Files Modified

- `src/app/api/mongo-sync/cron/route.js` — Main cron script generator
- `src/lib/dbPool.js` — Shared MongoDB URI builder
- `scripts/mongoSyncScheduler.js` — Background scheduler

## Testing

All modified files passed syntax validation:
```bash
✅ src/app/api/mongo-sync/cron/route.js
✅ src/lib/dbPool.js
✅ scripts/mongoSyncScheduler.js
```
