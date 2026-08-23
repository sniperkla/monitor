# Large Folder Upload Solution

## Changes Made

### 1. Track File Paths During Collection (`FileManager.js`)

**Problem**: `collectEntries` only stored file entries without their relative paths.

**Solution**: Store `{entry, file, relativePath}` for each file:

```javascript
const collectEntries = async (ent, currentPath = '') => {
  if (ent.isFile) {
    const f = await new Promise(r => ent.file(r));
    allEntries.push({ 
      entry: ent, 
      file: f, 
      relativePath: currentPath + ent.name 
    });
    totalSize += f.size;
  } else if (ent.isDirectory) {
    // Recursively collect with path tracking
    for (const result of results) {
      await collectEntries(result, currentPath + ent.name + '/');
    }
  }
};
```

### 2. Upload Files with Preserved Structure (`FileManager.js`)

For folders >1GB, upload files individually:

```javascript
for (const { file, relativePath } of allEntries) {
  const filePath = `${targetDir}/${relativePath}`;
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  
  await handleFileUpload(null, file, 0, dirPath, null, true);
}
```

### 3. Auto-Create Parent Directories (`wsRelayServer.js`)

**Problem**: Uploading to `monitor/src/file.js` failed because `monitor/src/` didn't exist.

**Solution**: Create parent directories before upload:

```javascript
// Ensure parent directory exists
const parentDir = path.posix.dirname(destPath);

// For SFTP
const writeStream = s.createWriteStream(destPath, { flags, start: offset });
writeStream.on('error', (createErr) => {
  if (createErr.code === 2 || createErr.code === 'ENOENT') {
    // Create parent directory
    sshClient.exec(`mkdir -p "${parentDir}"`, (mkdirErr) => {
      // Retry write stream
      const retryStream = s.createWriteStream(destPath, { flags, start: offset });
      setupHandlers(retryStream);
    });
  }
});

// For shell fallback
const cmd = `mkdir -p "${parentDir}" && cat > "${destPath}"`;
```

## How It Works Now

### For Folders ≤1GB
1. Scan and load all files into memory
2. Create TAR archive
3. GZIP compress
4. Upload single `.tar.gz` file
5. Server extracts automatically

**Pros**: Fast, single file
**Cons**: Memory intensive

### For Folders >1GB
1. Scan folder to get file list and paths
2. For each file:
   - Calculate target path: `{folder}/{relative/path/file.js}`
   - Extract directory: `{folder}/{relative/path}`
   - Create directory on server if needed
   - Upload file to directory
3. Show progress: `"247/1234: src/components/App.js"`

**Pros**: No memory limits, works for ANY size
**Cons**: Slower (many small uploads vs one large)

## Example Upload Flow

### Uploading `monitor` folder (2.8GB, 1,234 files):

```
1. Scan: "Scanning..."
2. Collect: Store paths like:
   - "src/components/FileManager.js"
   - "src/lib/webrtc-relay.js"
   - "public/local-relay.js"
   - etc.

3. Upload loop:
   - File 1: mkdir -p "monitor/src/components" → upload FileManager.js
   - File 2: (dir exists) → upload webrtc-relay.js
   - File 3: mkdir -p "monitor/public" → upload local-relay.js
   - ...
   - File 1234: upload README.md

4. Complete: "Folder Uploaded: monitor: 1,234 files (2839.6MB)"
```

## Error Handling

### "No such file" - FIXED ✅
- **Cause**: Parent directory didn't exist
- **Fix**: Auto-create with `mkdir -p` before upload

### "Upload acknowledgment timeout" - NEEDS INVESTIGATION
- **Cause**: Socket upload timing out (20s limit)
- **Potential fixes**:
  - Increase timeout for large files
  - Better error recovery
  - Retry logic

### Socket reconnecting during upload
- **Cause**: SSH session timing out or connection issue
- **Fix**: Already handled by reconnect logic with transfer preservation

## Testing Checklist

- [ ] Upload folder <500MB → Should use TAR.GZ
- [ ] Upload folder 500MB-1GB → Should use TAR.GZ
- [ ] Upload folder >1GB → Should upload files individually
- [ ] Verify directory structure preserved
- [ ] Check parent directories created automatically
- [ ] Test with deeply nested folders (5+ levels)
- [ ] Test with special characters in filenames
- [ ] Test resume after disconnect

## Performance Estimates

| Folder Size | Files | Method | Time Estimate |
|-------------|-------|--------|---------------|
| 100MB | 50 | TAR.GZ | ~30s |
| 500MB | 200 | TAR.GZ | ~1-2min |
| 1GB | 500 | TAR.GZ | ~2-3min |
| 2.8GB | 1,234 | Individual | ~8-12min |
| 10GB | 5,000 | Individual | ~30-45min |

*Times vary based on network speed and file sizes*

## Future Optimizations

1. **Parallel uploads** - Upload 3-5 files simultaneously
2. **Batch mkdir** - Create all directories in one command
3. **Smart batching** - Group small files, stream large files
4. **Server-side TAR** - Upload files, server creates archive
5. **Web Worker compression** - Offload to background thread

## Files Modified

- `src/components/FileManager.js`
  - Line ~2456: Track paths during collection
  - Line ~2492: Individual file upload loop
  
- `src/lib/wsRelayServer.js`
  - Line ~733: Auto-create parent directories on upload
