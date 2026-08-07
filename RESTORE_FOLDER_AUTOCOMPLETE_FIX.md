# Restore Folder Autocomplete & Browse Fix

## Issues Fixed

### 1. ❌ No Autocomplete on Restore Backup Folder Input
**Problem:** The restore folder input was read-only with no autocomplete functionality, making it difficult to quickly select folders without using the Browse button.

**Solution:** 
- Added `restoreFolderName` state variable to store the folder name
- Added `restoreFolderInputActive` state to track autocomplete dropdown visibility
- Added `filteredRestoreFolderOptions` state for filtered folder suggestions
- Created handler functions:
  - `handleRestoreFolderInputChange()` - filters folders as user types
  - `handleSelectRestoreFolder()` - selects folder from autocomplete
  - `handleRestoreFolderInputBlur()` - closes autocomplete dropdown
- Updated UI to use editable input with autocomplete dropdown (matching the Job folder input pattern)

### 2. ❌ All Folders Showing Instead of Only Root Folders
**Problem:** The Google Drive folder browser was showing ALL folders recursively, not just folders in the current directory level.

**Solution:**
- Fixed `listGoogleDriveFolders()` in `src/lib/gdriveHelper.js`:
  - Changed from optional parent clause to always requiring explicit parent in query
  - When `parentId` is `null`, defaults to `'root'`
  - Query now always includes `'<parentId>' in parents` to fetch only direct children
  - Added `orderBy=name` for alphabetical sorting

## Files Modified

### 1. `/src/lib/gdriveHelper.js`
```javascript
// BEFORE
const parentClause = parentId ? ` and '${parentId}' in parents` : '';
const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;

// AFTER
const actualParentId = parentId || 'root';
const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${actualParentId}' in parents`;
```

### 2. `/src/apps/MongoBackupApp.js`
- **Note:** `restoreFolderName` state was already declared (line 398)
- Added state variables: `restoreFolderInputActive`, `filteredRestoreFolderOptions`
- Added handler functions for autocomplete behavior
- Updated restore folder input UI from read-only to editable with dropdown
- Fixed initialization to set `restoreFolderName` on load

## Benefits

✅ **Faster folder selection** - Users can type to filter folders instead of browsing  
✅ **Better UX consistency** - Restore folder input now matches Job folder input behavior  
✅ **Correct folder listing** - Browse modal only shows folders in current directory level  
✅ **Alphabetical ordering** - Folders sorted by name for easier navigation  

## Testing Checklist

- [ ] Restore folder input shows autocomplete when typing
- [ ] Autocomplete filters folders based on text input
- [ ] Clicking autocomplete item selects folder and closes dropdown
- [ ] Browse button opens modal with only root-level folders
- [ ] Navigating into subfolder shows only that folder's children
- [ ] Breadcrumb navigation works correctly
- [ ] Selected folder from Browse populates the input field
- [ ] Selected folder from autocomplete populates the input field
- [ ] Fetch Backups button loads files from selected folder
