# MongoDB Reconnection Issue - Multiple Collections

## 🐛 Problem

Current implementation reconnects to MongoDB **for every single collection** being backed up.

### Example from Logs
```
2026-08-07T15:00:19.343+0700  exported 0 records (wikis)
2026-08-07T15:00:21.399+0700  connected to: mongodb://... (connections)
2026-08-07T15:00:21.404+0700  exported 3 records
2026-08-07T15:00:23.332+0700  connected to: mongodb://... (payments)
2026-08-07T15:00:23.339+0700  exported 6 records
2026-08-07T15:00:25.629+0700  connected to: mongodb://... (customers)
2026-08-07T15:00:25.635+0700  exported 3 records
```

**Issue:** If you have 1000 collections, it will reconnect **1000 times**! ❌

---

## 🔍 Root Cause

### Current Implementation (src/app/api/mongo-sync/cron/route.js)

```bash
for COLL in $COLLECTIONS; do
  echo "$(date): DEBUG: Processing collection: $COLL" >> "$LOG"
  DUMP_FILE="$TMP_DIR/${COLL}_$TIMESTAMP.json"
  echo "$(date): Exporting collection: $COLL ..." >> "$LOG"
  
  # ❌ PROBLEM: mongoexport runs for each collection
  #    Each run establishes a new connection!
  "$EXPORT_BIN" --uri="$MONGO_URI" \
    --db="$DB_NAME" \
    --collection="$COLL" \
    --out="$DUMP_FILE" >> "$LOG" 2>&1
  
  # Upload to GDrive
  upload_file "$DUMP_FILE" "$COLL.json" "$SUBFOLDER_ID"
  rm -f "$DUMP_FILE"
done
```

**Why this happens:**
- `mongoexport` is a standalone CLI tool
- Each invocation is a separate process
- Each process opens a new connection to MongoDB
- Connection is closed after export completes

---

## 📊 Performance Impact

### Current (mongoexport per collection)

| Collections | Connections | Connection Time* | Export Time | Total Time |
|-------------|-------------|------------------|-------------|------------|
| 10 | 10 | 20 seconds | 5 seconds | **25 seconds** |
| 100 | 100 | 200 seconds | 30 seconds | **230 seconds** |
| 1000 | 1000 | 2000 seconds | 300 seconds | **2300 seconds** (~38 min!) |

*Assuming ~2 seconds per connection (network latency)

### Improved (single connection)

| Collections | Connections | Connection Time | Export Time | Total Time |
|-------------|-------------|-----------------|-------------|------------|
| 10 | 1 | 2 seconds | 5 seconds | **7 seconds** ✅ |
| 100 | 1 | 2 seconds | 30 seconds | **32 seconds** ✅ |
| 1000 | 1 | 2 seconds | 300 seconds | **302 seconds** (~5 min!) ✅ |

**Savings:** ~87% faster for 1000 collections! 🚀

---

## ✅ Solutions

### Solution 1: Use `mongodump` (Recommended)

**Pros:**
- ✅ Connects once
- ✅ Dumps all collections in parallel
- ✅ Binary format (BSON) - faster
- ✅ Built for bulk exports
- ✅ Includes indexes

**Cons:**
- ❌ Output is BSON (not JSON)
- ❌ Requires conversion to JSON for Google Drive

**Implementation:**
```bash
# Single connection, export all collections
mongodump --uri="$MONGO_URI" \
  --db="$DB_NAME" \
  --out="$TMP_DIR/dump_$TIMESTAMP"

# Convert BSON to JSON and upload
for BSON_FILE in "$TMP_DIR/dump_$TIMESTAMP/$DB_NAME"/*.bson; do
  COLL=$(basename "$BSON_FILE" .bson)
  JSON_FILE="$TMP_DIR/${COLL}_$TIMESTAMP.json"
  
  # Convert BSON to JSON
  bsondump "$BSON_FILE" > "$JSON_FILE"
  
  # Upload
  upload_file "$JSON_FILE" "$COLL.json" "$SUBFOLDER_ID"
  rm -f "$JSON_FILE"
done

rm -rf "$TMP_DIR/dump_$TIMESTAMP"
```

---

### Solution 2: Use Python with `pymongo` (Best for JSON)

**Pros:**
- ✅ Single persistent connection
- ✅ Direct JSON output
- ✅ Full control over export process
- ✅ Can batch/stream large collections
- ✅ Better error handling

**Cons:**
- ❌ Requires pymongo library
- ❌ Custom script needed

**Implementation:**
```python
#!/usr/bin/env python3
import sys
import json
from pymongo import MongoClient
from datetime import datetime

# Connect once
client = MongoClient(sys.argv[1])  # MONGO_URI
db = client[sys.argv[2]]  # DB_NAME
collections = sys.argv[3].split(',')  # COLLECTION_LIST
tmp_dir = sys.argv[4]
timestamp = sys.argv[5]

for coll_name in collections:
    print(f"{datetime.now()}: Exporting {coll_name}...", file=sys.stderr)
    
    collection = db[coll_name]
    documents = list(collection.find({}))
    
    # Convert ObjectId to string for JSON
    for doc in documents:
        if '_id' in doc:
            doc['_id'] = str(doc['_id'])
    
    output_file = f"{tmp_dir}/{coll_name}_{timestamp}.json"
    with open(output_file, 'w') as f:
        json.dump(documents, f, indent=2)
    
    print(f"{datetime.now()}: Exported {len(documents)} records from {coll_name}", file=sys.stderr)
    print(output_file)  # For shell script to capture

# Close connection once
client.close()
```

**Shell integration:**
```bash
# Export all collections with single connection
python3 $HOME/.mongosync-scripts/export_collections.py \
  "$MONGO_URI" \
  "$DB_NAME" \
  "$COLLECTIONS" \
  "$TMP_DIR" \
  "$TIMESTAMP" \
  2>> "$LOG" | while read DUMP_FILE; do
    COLL=$(basename "$DUMP_FILE" "_$TIMESTAMP.json")
    upload_file "$DUMP_FILE" "$COLL.json" "$SUBFOLDER_ID"
    rm -f "$DUMP_FILE"
  done
```

---

### Solution 3: Connection Pooling with `mongosh`

**Pros:**
- ✅ Single connection
- ✅ Native MongoDB shell
- ✅ JSON output
- ✅ No extra dependencies

**Cons:**
- ❌ Slower than native drivers
- ❌ Limited to mongosh availability

**Implementation:**
```bash
# Create mongosh script
cat > "$TMP_DIR/export_all.js" <<'EOF'
const collections = db.getCollectionNames();
collections.forEach(collName => {
  print(`EXPORTING:${collName}`);
  const docs = db.getCollection(collName).find().toArray();
  printjson(docs);
  print(`DONE:${collName}`);
});
EOF

# Execute with single connection
mongosh "$MONGO_URI/$DB_NAME" \
  --quiet \
  --file "$TMP_DIR/export_all.js" | \
  awk '/^EXPORTING:/{coll=$0; sub(/^EXPORTING:/,"",coll); json=""; next}
       /^DONE:/{print json > ("'$TMP_DIR'/"coll"_'$TIMESTAMP'.json"); next}
       {json=json $0}'
```

---

## 🎯 Recommended Approach

### For Small to Medium Collections (< 100MB each)
**Use Solution 2 (Python pymongo)**
- Single connection
- Direct JSON output
- Easy to maintain
- Good error handling

### For Large Collections (> 100MB each)
**Use Solution 1 (mongodump + bsondump)**
- Fastest export
- Handles large data efficiently
- Battle-tested tool

### For Minimal Dependencies
**Use Solution 3 (mongosh)**
- No extra tools needed
- Works anywhere mongosh is available

---

## 🔧 Implementation Plan

### Phase 1: Add Python Export Script
1. Create `export_collections.py` in scripts/
2. Add to deployment (include in ~/.mongosync-scripts/)
3. Update cron/route.js to use Python script
4. Add fallback to current method if pymongo not available

### Phase 2: Optimize Connection
1. Add connection reuse parameter
2. Batch collections (export 10 at a time in single connection)
3. Add progress reporting

### Phase 3: Monitor & Tune
1. Add metrics (connection time, export time)
2. Log connection count
3. Optimize batch size based on collection sizes

---

## 📈 Expected Results

### Current Performance (1000 collections)
```
Total time: ~38 minutes
Connections: 1000
Network overhead: ~33 minutes
Actual export: ~5 minutes
```

### After Optimization
```
Total time: ~5 minutes ✅
Connections: 1
Network overhead: ~2 seconds ✅
Actual export: ~5 minutes
```

**Improvement:** 7-8x faster! 🚀

---

## ⚠️ Backwards Compatibility

### Option A: Gradual Migration
- Keep current mongoexport method as fallback
- Use Python method when available
- Auto-detect and choose best method

### Option B: Feature Flag
```javascript
const USE_SINGLE_CONNECTION = true; // New efficient method
```

### Option C: User Choice
- Add setting in UI: "Export Method"
  - "Per Collection (Compatible)" - Current method
  - "Batch (Faster)" - New single-connection method

---

## 🧪 Testing Checklist

- [ ] Export 10 collections → Verify single connection
- [ ] Export 100 collections → Check performance
- [ ] Large collection (>100MB) → Verify streaming works
- [ ] Empty collection → Handle gracefully
- [ ] Connection failure → Proper error handling
- [ ] Partial export → Resume capability
- [ ] Compare output → JSON format matches current

---

## 📝 Code Changes Needed

**Files to modify:**
1. `src/app/api/mongo-sync/cron/route.js` - Update export logic
2. `scripts/export_collections.py` - New Python script (create)
3. `src/app/api/mongo-sync/check-dependencies/route.js` - Add pymongo check
4. `src/app/api/mongo-sync/install-deps/route.js` - Auto-install pymongo

**Estimated effort:** 2-3 hours

---

## 🚀 Quick Fix (Immediate)

If you need a quick improvement right now without code changes:

**Batch collections manually:**
```bash
# Instead of backing up all 1000 collections at once,
# split into 10 jobs of 100 collections each
# Each job runs sequentially within its batch
```

This reduces connections from 1000 to 10 (one per batch).

---

**Status:** ⚠️ Issue Identified  
**Priority:** High (performance impact)  
**Solution:** Use single persistent connection  
**Date:** 2026-08-07
