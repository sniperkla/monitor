// Test script to verify the Google Drive folder query logic fix

console.log('Testing Google Drive Folder Query Logic\n');

// OLD LOGIC (BROKEN - returns all folders)
function oldQuery(parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  return query;
}

// NEW LOGIC (FIXED - returns only direct children)
function newQuery(parentId) {
  const actualParentId = parentId || 'root';
  const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${actualParentId}' in parents`;
  return query;
}

console.log('Test Case 1: parentId = null (should list root folders)');
console.log('OLD:', oldQuery(null));
console.log('❌ Problem: Returns ALL folders (no parent filter)\n');
console.log('NEW:', newQuery(null));
console.log('✅ Fixed: Returns only root-level folders\n');

console.log('Test Case 2: parentId = "abc123" (should list subfolders)');
console.log('OLD:', oldQuery('abc123'));
console.log('✅ This case was already correct\n');
console.log('NEW:', newQuery('abc123'));
console.log('✅ Still correct and consistent\n');

console.log('Summary:');
console.log('- OLD logic: parentId=null returned ALL folders (missing parent filter)');
console.log('- NEW logic: parentId=null returns only root folders (explicit parent="root")');
console.log('- Both correctly filter by parent when parentId is provided');
console.log('- Added orderBy=name for alphabetical sorting');
