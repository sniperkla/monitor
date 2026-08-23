# Import JSON vs Restore Backup - Detailed Comparison

## Quick Answer

**Import JSON** = Upload ONE file from your computer → Insert into ONE collection
**Restore Backup** = Fetch MULTIPLE files from Google Drive → Restore to MULTIPLE collections

---

## Feature Comparison Table

| Feature | Import JSON | Restore Backup |
|---------|-------------|----------------|
| **Source** | Your local computer | Google Drive |
| **File Selection** | Manual file picker | Google Drive browser |
| **Number of Files** | Single file | Multiple files |
| **Target Options** | Single collection only | Single OR All collections |
| **Use Case** | Manual data import | Automated backup restore |
| **Typical Workflow** | One-time migration | Regular disaster recovery |
| **File Organization** | User manages | Auto-organized by timestamp |

---

## Detailed Comparison

### Import JSON Tab

#### Purpose
- **Import external data** into MongoDB
- **Migrate data** from other systems
- **One-time data loads**
- **Testing with sample data**

#### Workflow
```
1. Click "Choose JSON File"
2. Select customers.json from your computer
3. Choose target database: "shop"
4. Choose target collection: "customers"
5. Choose mode: Replace / Upsert / Insert Only
6. Click "Import"
```

#### Technical Details
```javascript
// Single file upload
<input type="file" accept=".json" />

// Reads file with FileReader
const reader = new FileReader();
reader.onload = (e) => {
  const json = JSON.parse(e.target.result);
  // json = array of documents
};

// Imports to ONE collection
POST /api/mongo-sync/import
{
  database: "shop",
  collection: "customers",
  documents: [...] // from your file
}
```

#### Why No "All Collections"?
Because you're uploading **ONE file**. What would "All Collections" mean?

**Option A:** Import same data into every collection?
```
customers.json → sessions ❌ Makes no sense
customers.json → orders   ❌ Makes no sense
customers.json → products ❌ Makes no sense
```

**Option B:** Split file by some logic?
- Too complex
- Error-prone
- Not what users expect

**Conclusion:** Single file = Single collection makes sense ✅

---

### Restore Backup Tab

#### Purpose
- **Restore from scheduled backups**
- **Disaster recovery**
- **Database replication**
- **Environment sync** (prod → staging)

#### Workflow
```
1. Select Google Drive folder: "2026-08-06_19-05/"
2. Folder contains:
   ├── sessions.json
   ├── users.json
   ├── orders.json
   ├── payments.json
   └── customers.json
   
3. Choose target: "All Collections (Batch Restore)"
4. Choose mode: Replace / Upsert / Insert Only
5. Click "Restore"

Result:
✅ sessions.json  → shop.sessions
✅ users.json     → shop.users
✅ orders.json    → shop.orders
✅ payments.json  → shop.payments
✅ customers.json → shop.customers
```

#### Technical Details
```javascript
// Fetches folder contents from Google Drive
GET /api/mongo-sync/gdrive/list?folderId=xxx
// Returns: [
//   { name: "sessions.json", id: "..." },
//   { name: "users.json", id: "..." },
//   ...
// ]

// For "All Collections" restore:
for (const file of files) {
  const collectionName = file.name.replace('.json', '');
  
  // Download file from Google Drive
  const content = await downloadFromDrive(file.id);
  
  // Restore to matched collection
  await restore({
    database: targetDb,
    collection: collectionName, // Extracted from filename!
    documents: JSON.parse(content)
  });
}
```

#### Why "All Collections" Works Here
Because:
1. **Multiple files available** in the folder
2. **Filename = Collection name** (convention from backup)
3. **Common use case**: Restore entire database state
4. **Makes logical sense**: Each file → Its own collection

---

## Real-World Examples

### Example 1: Migrate Customer Data (Import)
**Scenario:** You have customer data from an old system in CSV, converted to JSON

**What you do:**
1. Go to **Import JSON** tab
2. Upload `legacy_customers.json`
3. Target: `production.customers`
4. Mode: Upsert (merge with existing)
5. Import ✅

**Why not "All Collections"?** You have ONE file for ONE purpose.

---

### Example 2: Restore After Data Loss (Restore)
**Scenario:** Database crashed, need to restore yesterday's backup

**What you do:**
1. Go to **Restore Backup** tab
2. Select folder: `2026-08-05_02-00/` (yesterday's backup)
3. Folder contains all 18 collection backups
4. Target: **All Collections (Batch Restore)**
5. Mode: Replace (fresh restore)
6. Restore ✅

**Why "All Collections"?** You need to restore the entire database state.

---

## Could We Add "All Collections" to Import?

### Possible Implementation

**Multi-File Upload Feature**
```javascript
// Allow selecting multiple files
<input type="file" multiple accept=".json" />

// Map filename to collection
sessions.json → sessions
users.json → users
orders.json → orders
```

**UI Changes:**
```
Import JSON Tab
├─ [x] Import multiple files
│   ├─ Select files: [Choose Files]
│   ├─ Selected: sessions.json, users.json, orders.json
│   └─ Target: Auto-detect from filenames
│
└─ [ ] Import single file (current behavior)
    ├─ Select file: [Choose File]
    ├─ Selected: customers.json
    └─ Target: Manually select collection
```

### Pros
✅ Consistent with Restore behavior
✅ Useful for bulk imports
✅ Faster than importing one-by-one

### Cons
❌ More complex UI
❌ Filename must match collection name (strict convention)
❌ Error if filename doesn't match any collection
❌ Less flexible than current single-file approach

---

## Recommendation

### Keep Current Design ✅

**Import JSON** and **Restore Backup** serve **different purposes**:

| Tab | Purpose | Source | Target |
|-----|---------|--------|--------|
| **Import** | Manual data import | Local file | Single collection |
| **Restore** | Automated recovery | Google Drive | Multiple collections |

**Reasoning:**
1. **Import** is for **ad-hoc, flexible** data loading → Single file, manual target selection makes sense
2. **Restore** is for **structured, automated** recovery → Multi-file, auto-matched collections make sense
3. Different tools for different jobs = Clear, intuitive UX

### Alternative: Add Multi-File Import (Optional)

If you want multi-file capability in Import:

**Option A:** Add checkbox "Batch Import Mode"
- When checked, allows multiple files
- Auto-maps filename → collection name
- Fallback to Restore if you need this often

**Option B:** Keep separate
- Import = Single file, full control
- Restore = Multi-file, auto-mapped
- Users understand the distinction

---

## Summary

**Why Import has no "All Target":**
- You're uploading ONE file
- You manually choose the target collection
- Gives you full control over where data goes

**Why Restore has "All Target":**
- Folder contains MULTIPLE files
- Filenames match collection names (from backup)
- Common use case: restore entire database

**Current design is correct** ✅ - Each tab serves its purpose well.

Would you like me to implement multi-file batch import for the Import tab?
