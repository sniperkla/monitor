# Additional Recommended Optimizations

## Memory Leak Prevention

### Issue: Download Buffers Not Cleaned on Error

The `downloadBufferRef` accumulates chunks in memory but may not be properly cleaned up if:
- Upload/download is cancelled
- Connection drops mid-transfer
- Page is navigated away

### Recommended Fix:

Add cleanup in `FileManager.js`:

```javascript
// Add to useEffect cleanup (around line 600):
return () => {
  // Clean up download buffers on unmount
  Object.keys(downloadBufferRef.current).forEach(filename => {
    delete downloadBufferRef.current[filename];
  });
  downloadBufferRef.current = {};
  
  // Clear upload queue
  setUploadQueue([]);
};
```

### Issue: Large File Objects Held in Upload Queue

When files >1GB are queued, the File object references are held in state, preventing garbage collection.

### Recommended Fix:

Store only essential metadata in queue:

```javascript
// Instead of storing entire File object:
const queueItem = {
  file: file,  // ❌ Holds entire file in memory
  path: path,
  offset: 0
};

// Store metadata only:
const queueItem = {
  filename: file.name,     // ✅ Just metadata
  size: file.size,
  type: file.type,
  lastModified: file.lastModified,
  fileHandle: file,        // Keep reference but mark for cleanup
  path: path,
  offset: 0
};
```

## Performance Improvements

### 1. Chunk Size Optimization

Current: Fixed 64KB chunks for all files

**Recommended**: Adaptive chunk size based on file size and network speed

```javascript
function getOptimalChunkSize(fileSize, networkSpeed) {
  if (fileSize < 10 * 1024 * 1024) {
    return 64 * 1024;  // 64KB for small files
  } else if (fileSize < 100 * 1024 * 1024) {
    return 128 * 1024; // 128KB for medium files
  } else if (fileSize < 1024 * 1024 * 1024) {
    return 256 * 1024; // 256KB for large files
  } else {
    return 512 * 1024; // 512KB for huge files (but still within RTCDataChannel limits)
  }
}
```

### 2. Directory Listing Pagination

Current: Loads all 10,000 files at once

**Recommended**: Virtual scrolling with lazy loading

```javascript
// Only load visible items + buffer
const VISIBLE_ITEMS = 50;
const BUFFER_SIZE = 20;

function getVisibleFiles(allFiles, scrollTop, itemHeight) {
  const startIndex = Math.floor(scrollTop / itemHeight) - BUFFER_SIZE;
  const endIndex = startIndex + VISIBLE_ITEMS + (BUFFER_SIZE * 2);
  return allFiles.slice(Math.max(0, startIndex), endIndex);
}
```

### 3. Upload Resume Optimization

Current: Resumes from last byte, but re-validates entire file

**Recommended**: Checksum validation of completed chunks only

```javascript
// Store chunk checksums during upload
const uploadState = {
  completedChunks: [
    { offset: 0, length: 65536, sha256: 'abc123...' },
    { offset: 65536, length: 65536, sha256: 'def456...' }
  ],
  nextOffset: 131072
};

// On resume, only re-validate chunks after last confirmed offset
```

## Resource Management

### 1. Connection Pooling

Current: One connection per FileManager instance

**Recommended**: Share connection pool across all instances

```javascript
// Global connection pool (similar to socket pool)
const sftpConnectionPool = new Map();

function getOrCreateSftpConnection(connectionId) {
  if (sftpConnectionPool.has(connectionId)) {
    return sftpConnectionPool.get(connectionId);
  }
  // Create new connection
  const conn = createConnection(connectionId);
  sftpConnectionPool.set(connectionId, conn);
  return conn;
}
```

### 2. Memory Pressure Detection

**Recommended**: Monitor and adapt to memory pressure

```javascript
// Detect memory pressure and reduce buffers
if ('memory' in performance) {
  const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
  const memoryUsageRatio = usedJSHeapSize / jsHeapSizeLimit;
  
  if (memoryUsageRatio > 0.8) {
    // Reduce buffer sizes
    WEBRTC_MAX_CHUNK = 32 * 1024;  // Cut in half
    console.warn('High memory pressure detected - reducing chunk size');
  }
}
```

## Monitoring Enhancements

### Add Performance Metrics

```javascript
// Track upload performance
const uploadMetrics = {
  startTime: Date.now(),
  bytesTransferred: 0,
  chunksTotal: 0,
  chunksFailed: 0,
  averageSpeed: 0,
  peakMemory: 0
};

// Update periodically
setInterval(() => {
  const elapsed = (Date.now() - uploadMetrics.startTime) / 1000;
  uploadMetrics.averageSpeed = uploadMetrics.bytesTransferred / elapsed;
  
  if (performance.memory) {
    uploadMetrics.peakMemory = Math.max(
      uploadMetrics.peakMemory,
      performance.memory.usedJSHeapSize
    );
  }
}, 1000);
```

### Add Upload Health Check

```javascript
// Detect stalled uploads
let lastProgressTime = Date.now();
let lastProgressBytes = 0;

const uploadHealthCheck = setInterval(() => {
  const timeSinceProgress = Date.now() - lastProgressTime;
  const bytesSinceProgress = currentBytes - lastProgressBytes;
  
  if (timeSinceProgress > 30000 && bytesSinceProgress === 0) {
    console.error('Upload stalled for 30 seconds - triggering reconnect');
    requestReconnect('Upload stalled', { preserveTransfer: true });
  }
  
  lastProgressTime = Date.now();
  lastProgressBytes = currentBytes;
}, 5000);
```

## Implementation Priority

### High Priority (Do Now):
1. ✅ WebRTC buffer size reduction (DONE)
2. ✅ Socket backpressure control (DONE)
3. ✅ Directory listing timeout (DONE)
4. 🔲 Download buffer cleanup on unmount
5. 🔲 Upload queue memory optimization

### Medium Priority (Next Sprint):
6. 🔲 Adaptive chunk sizing
7. 🔲 Memory pressure detection
8. 🔲 Upload health monitoring

### Low Priority (Future):
9. 🔲 Virtual scrolling for large directories
10. 🔲 Chunk checksum validation
11. 🔲 Connection pooling across instances

## Testing Checklist

After implementing additional optimizations:

- [ ] Upload 10GB file without crash
- [ ] Monitor memory stays under 300MB
- [ ] Cancel upload mid-way → memory is freed
- [ ] Refresh page during upload → no memory leak
- [ ] List directory with 100,000 files → responsive UI
- [ ] Upload queue with 50 files → doesn't hang browser
- [ ] Resume after network loss → continues from correct offset
- [ ] Stress test: 5 concurrent uploads → all complete successfully

---

**These optimizations are OPTIONAL but recommended for production deployment of very large file transfers (>10GB) or high-concurrency scenarios.**
