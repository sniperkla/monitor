# Extraction Progress Fix

## Problem
When extracting zip/tar files, progress shows **0%** for the entire extraction, then jumps to **100%** when complete. You have to wait without any feedback.

## Root Cause
The extraction commands (`tar -xvf`, `unzip`) output file names as they extract, but:
1. **Output is buffered** - Not flushed until process ends
2. **No output at all** - Some systems buffer heavily
3. **Large files** - Extraction takes time but shows no progress

## Solution
Added **time-based progress updates** that work even without command output.

### What Changed (src/lib/wsRelayServer.js)

**Before:**
```javascript
// Only update when receiving output from tar/unzip
stream.on('data', (data) => {
  extractedCount += validLines.length;
  emit('sftp:progress', { progress: ... });
});
```

**After:**
```javascript
// 1. Send initial progress
emit('sftp:progress', { progress: 1 });

// 2. Update every 500ms even without output
const progressInterval = setInterval(() => {
  const estimatedProgress = Math.min(95, ...);
  emit('sftp:progress', { progress: estimatedProgress });
}, 500);

// 3. Update when receiving actual output
stream.on('data', (data) => {
  extractedCount += validLines.length;
  emit('sftp:progress', { progress: ... });
});

// 4. Always clear interval on completion
stream.on('close', () => {
  clearInterval(progressInterval);
  emit('sftp:progress', { progress: 100 });
});
```

## How It Works

### Timeline Example (100-file archive):

```
Time   | Files Extracted | Progress Shown
-------|-----------------|----------------
0ms    | 0               | 1%  (initial)
500ms  | 0 (buffered)    | 5%  (estimated)
1000ms | 0 (buffered)    | 10% (estimated)
1500ms | 20 (output!)    | 20% (actual)
2000ms | 20 (no output)  | 25% (estimated)
2500ms | 50 (output!)    | 50% (actual)
3000ms | 50 (no output)  | 55% (estimated)
3500ms | 80 (output!)    | 80% (actual)
4000ms | 80 (no output)  | 85% (estimated)
4500ms | Complete!       | 100%
```

### Progress Behavior:

1. **Starts at 1%** - User knows extraction started
2. **Updates every 500ms** - Shows activity even if buffered
3. **Jumps on actual output** - Real progress when available
4. **Never exceeds 95%** - Reserves 95-100% for final steps
5. **Reaches 100%** - Only when actually complete

## Benefits

✅ **Immediate feedback** - Shows 1% instantly
✅ **Consistent updates** - Every 500ms, not stuck at 0%
✅ **Estimated progress** - Even when output buffered
✅ **Accurate when possible** - Uses real file count
✅ **Clear completion** - 100% only when done

## User Experience

### Before (Bad):
```
Extracting archive.tar.gz...
Progress: 0%
Progress: 0%
Progress: 0%  ← Looks stuck!
Progress: 0%
Progress: 0%
... (30 seconds of 0%) ...
Progress: 100% ← Sudden jump!
✓ Complete
```

### After (Good):
```
Extracting archive.tar.gz...
Progress: 1%   ← Started!
Progress: 5%   ← Working...
Progress: 15%  ← Still working...
Progress: 25%
Progress: 35%
Progress: 50%
Progress: 68%  ← Real progress!
Progress: 85%
Progress: 95%
Progress: 100% ← Done!
✓ Complete
```

## Edge Cases Handled

1. **Fully buffered output** - Uses time-based estimates
2. **Very fast extraction** - Shows quick progress 1→100%
3. **Very slow extraction** - Updates every 500ms
4. **Extraction failure** - Clears interval, shows error
5. **Large archives** - Progress smoothly increases
6. **Small archives** - Completes quickly with feedback

## Testing

After rebuild, test with:

### Small Archive (~10 files):
```
0ms:   Progress: 1%
500ms: Progress: 100% (complete)
```

### Medium Archive (~100 files):
```
0ms:    Progress: 1%
500ms:  Progress: 10%
1000ms: Progress: 20%
1500ms: Progress: 35%
2000ms: Progress: 50%
2500ms: Progress: 75%
3000ms: Progress: 100%
```

### Large Archive (~1000 files):
```
0ms:    Progress: 1%
500ms:  Progress: 5%
1000ms: Progress: 10%
...
10000ms: Progress: 95%
10500ms: Progress: 100%
```

## Performance Impact

- **Memory**: Minimal (one timer)
- **CPU**: Negligible (emit every 500ms)
- **Network**: Small (few KB of progress messages)
- **Extraction time**: Unchanged (no overhead)

## Logging Added

Server logs now show:
```
[Extract] Starting: archive.tar.gz, expected items: 123
[Extract] Progress update: 0/123 items (5%)
[Extract] Extracted 20/123 files (16%)
[Extract] Progress update: 20/123 items (21%)
[Extract] Extracted 50/123 files (40%)
[Extract] Complete: archive.tar.gz
```

## Files Modified

- `src/lib/wsRelayServer.js` (Lines 577-619)

## How to Apply

Restart your development server:
```bash
npm run dev
```

Or rebuild for production:
```bash
npm run build
npm start
```

Then extract any archive - you'll see smooth progress updates!
