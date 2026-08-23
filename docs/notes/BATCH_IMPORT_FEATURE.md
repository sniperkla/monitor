# Batch Import Feature - Documentation

## Overview

Added multi-file batch import capability to the Import JSON tab, allowing you to upload and import multiple JSON files at once with automatic collection name mapping.

---

## Features

### ✅ What's New

1. **Batch Import Mode Toggle**
   - Checkbox to enable/disable batch mode
   - Clearly shows current mode status

2. **Multi-File Selection**
   - Select multiple `.json` files at once
   - Drag-and-drop support for multiple files
   - File browser shows all selected files

3. **Automatic Collection Mapping**
   - Filename automatically maps to collection name
   - Example: `users.json` → `users` collection
   - Example: `orders.json` → `orders` collection

4. **File Validation**
   - Each file validated independently
   - Shows success (✅) or error (❌) status
   - Displays document count for valid files

5. **Batch Progress Tracking**
   - Live log output during batch import
   - Shows success/failure for each file
   - Summary statistics at the end

6. **Single File Mode** (Original Behavior)
   - Still available when batch mode is OFF
   - Manual collection name selection
   - Full backward compatibility

---

## Usage

### Single File Import (Original)

**When to use:** Importing one file with custom collection name

**Steps:**
1. Keep "Batch Import Mode" checkbox **unchecked**
2. Click or drag ONE JSON file
3. Manually enter collection name (or use auto-suggested name)
4. Click "Import Collection"

**Example:**
```
File: legacy_customers.json
Target: production.customers  (manually typed)
Result: Data → production.customers
```

---

### Batch Import (New Feature)

**When to use:** Importing multiple backup files at once

**Steps:**
1. Check "Batch Import Mode" checkbox ✅
2. Click or drag MULTIPLE JSON files
3. Review the file list (filenames auto-map to collections)
4. Click "Import X Collection(s)"

**Example:**
```
Files selected:
├─ users.json      → users (100 docs) ✅
├─ orders.json     → orders (500 docs) ✅
├─ products.json   → products (250 docs) ✅
└─ invalid.json    → Error: Invalid JSON ❌

Result after import:
✅ users.json → mydb.users (100 docs imported)
✅ orders.json → mydb.orders (500 docs imported)  
✅ products.json → mydb.products (250 docs imported)
❌ invalid.json → Skipped (invalid JSON)

Summary:
✅ Succeeded: 3
❌ Failed: 1
📊 Total: 4
```

---

## UI Changes

### Batch Mode Toggle
```
┌─────────────────────────────────────────────────────┐
│ [✓] Batch Import Mode                               │
│     Multi-file: auto-map filename → collection      │
└─────────────────────────────────────────────────────┘
```

### File List (Batch Mode)
```
┌─────────────────────────────────────────────────────┐
│ ✅ users.json     →  users    (100 docs)            │
│ ✅ orders.json    →  orders   (500 docs)            │
│ ❌ bad.json       Invalid JSON format                │
└─────────────────────────────────────────────────────┘
```

### Import Button
- **Single mode:** "Import Collection"
- **Batch mode:** "Import 3 Collection(s)" (shows count)

---

## Technical Details

### File Processing

```javascript
// Batch mode: processes multiple files in parallel
const filePromises = Array.from(files).map(file => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const parsed = JSON.parse(evt.target.result);
      const collectionName = file.name.replace(/\.json$/i, '');
      resolve({
        file,
        name: file.name,
        data: parsed,
        collection: collectionName,
        size: parsed.length,
        error: null
      });
    };
    reader.readAsText(file);
  });
});
```

### Import Execution

```javascript
// Sequential import with live progress
for (const fileObj of validFiles) {
  const res = await apiFetch('/api/mongo-sync/import', {
    method: 'POST',
    body: JSON.stringify({
      database: importDbName,
      collection: fileObj.collection,  // Auto-mapped!
      documents: fileObj.data,
      mode: importMode
    })
  });
  
  // Update logs in real-time
  logs.push(`✅ ${fileObj.name} imported successfully`);
}
```

---

## Validation Rules

### Filename to Collection Mapping

| Filename | Collection Name | Valid? |
|----------|-----------------|--------|
| `users.json` | `users` | ✅ |
| `my-orders.json` | `my-orders` | ✅ |
| `data_2024.json` | `data_2024` | ✅ |
| `test.JSON` | `test` | ✅ (case-insensitive) |
| `file.txt` | ❌ | ❌ (not .json) |

### File Content Validation

Each file must contain:
```json
[
  { "_id": 1, "name": "Item 1" },
  { "_id": 2, "name": "Item 2" }
]
```

**Requirements:**
- ✅ Top-level must be an array
- ✅ Each element is a document object
- ❌ Single object: `{ "name": "Item" }` (not an array)
- ❌ String/number: `"data"` or `123` (not an array)

---

## Error Handling

### Invalid JSON Files
- **Behavior:** Marked with ❌ in file list
- **Message:** "Invalid JSON format"
- **Result:** Skipped during import

### Failed Imports
- **Behavior:** Logged with ❌ in console
- **Message:** Shows error from API
- **Result:** Continues to next file

### Success Summary
```
=== Batch Import Complete ===
✅ Succeeded: 15
❌ Failed: 2
📊 Total: 17
```

---

## Comparison: Single vs Batch

| Feature | Single Mode | Batch Mode |
|---------|-------------|------------|
| **Files** | 1 file | Multiple files |
| **Collection Name** | Manual entry | Auto-mapped from filename |
| **Target Selection** | Custom per import | Same database for all |
| **Progress** | Simple success/fail | Detailed per-file logs |
| **Use Case** | Flexible imports | Bulk restore |
| **Speed** | N/A | Sequential (one-by-one) |

---

## Best Practices

### When to Use Batch Mode

✅ **Good for:**
- Restoring from local backup folder
- Migrating multiple collections at once
- Importing standardized data exports
- Testing with multiple sample files

❌ **Not good for:**
- Files with non-standard names
- Need custom collection names
- Importing subsets of data
- Single file imports

### Tips

1. **Name files consistently:** Use collection name as filename
   ```
   ✅ users.json, orders.json, products.json
   ❌ data1.json, backup.json, temp.json
   ```

2. **Validate files first:** Check one file in single mode before batch
3. **Use same database:** All files import to same target database
4. **Check logs:** Monitor progress for large batches
5. **Choose mode correctly:** Upsert for updates, Insert for new data

---

## Limitations

1. **Sequential Processing:** Files import one-by-one (not parallel)
   - Reason: Prevents database overload
   - Benefit: Clear progress tracking

2. **Same Database Target:** All files go to the same database
   - Reason: Simplified UI and use case
   - Workaround: Run multiple batch imports

3. **Filename = Collection Name:** No custom mapping per file
   - Reason: Automatic convenience
   - Workaround: Rename files before import or use single mode

4. **No Resume:** If batch fails mid-way, restart from beginning
   - Reason: Simplicity
   - Mitigation: Use Upsert mode (safe to re-run)

---

## Future Enhancements (Optional)

- [ ] Parallel imports (faster for large batches)
- [ ] Custom filename → collection mapping table
- [ ] Resume failed batches
- [ ] Import to different databases per file
- [ ] Progress bar with percentage
- [ ] Cancel batch mid-execution
- [ ] Export batch results as report

---

## Files Modified

- `src/apps/MongoBackupApp.js`
  - Added `batchImportMode`, `batchFiles`, `batchImporting` state
  - Updated `handleFileChange()` for multi-file support
  - Updated `executeImport()` for batch processing
  - Added batch mode UI with file list display
  - Added batch import progress logging

---

## Testing Checklist

- [x] Single file import still works (backward compatibility)
- [x] Multiple file selection works
- [x] Filename to collection mapping correct
- [x] Invalid files properly marked
- [x] Import progress logs appear
- [x] Success/failure count accurate
- [x] Toggle between modes clears state
- [x] UI shows correct button text
- [x] File list scrollable (many files)
- [x] Syntax validation passed

---

## Example Workflows

### Workflow 1: Restore Local Backup

**Scenario:** You have a local backup folder with 10 collection files

**Steps:**
1. Open Import JSON tab
2. Enable Batch Import Mode ✅
3. Select target database: `production`
4. Click file selector → Select all 10 `.json` files
5. Review file list (all mapped correctly)
6. Choose mode: Upsert (safe restore)
7. Click "Import 10 Collection(s)"
8. Monitor logs for completion
9. ✅ All 10 collections restored!

### Workflow 2: Migrate from Old System

**Scenario:** Export from old system created `customers.json`, `orders.json`

**Steps:**
1. Enable Batch Import Mode
2. Upload both files
3. Files auto-map:
   - customers.json → customers
   - orders.json → orders
4. Import to new database
5. ✅ Migration complete!

### Workflow 3: Mix Single + Batch

**Scenario:** Import most files in batch, one file needs custom collection

**Steps:**
1. **Batch:** Import 9 files with standard names
2. **Disable batch mode**
3. **Single:** Import `special_data.json` → `custom_collection`
4. ✅ All data imported with flexibility!

---

## Summary

The batch import feature makes it **fast and easy** to import multiple JSON files at once, perfect for:
- Bulk restores
- Database migrations  
- Testing with multiple datasets
- Regular data loads

**Key Benefits:**
- ⚡ Faster than one-by-one imports
- 🎯 Automatic collection name mapping
- 📊 Clear progress tracking
- ✅ Backward compatible with single file mode

Enjoy the productivity boost! 🚀
