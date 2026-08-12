# Upload Connection Fix - Tab Switch & Reconnection Issues

## Problem Summary
When uploading files and switching browser tabs, the connection would be killed and uploads would fail with no ability to retry. This affected both server-side relay mode and local relay mode.

## Root Causes Identified

### 1. **Aggressive Tab Visibility Handling**
   - The `verifyAfterReturn()` function would immediately check connection health when tab becomes visible
   - This would interrupt active uploads by triggering reconnection checks
   - Ping timeouts during active transfers would falsely indicate dead connections

### 2. **Upload Completion Detection Issues**
   - Server relay: `finish` event had a 2-second delay before sending completion
   - Local relay: `finish` event sent completion immediately without waiting for `close`
   - Both could lead to race conditions where completion wasn't properly signaled

### 3. **Reconnection Not Preserving Upload State**
   - When connection was lost during upload, the relay server would reject reconnection attempts
   - No mechanism to resume existing SSH sessions without full reconnection
   - Upload queue not properly preserved during forced reconnections

## Solutions Implemented

### 1. Server Relay (`src/lib/wsRelayServer.js`)

#### A. Added Resume Support
```javascript
// Allow resuming existing connections without full reconnection
if (opts.resuming && sshClient && sshClient._state !== 'closed' && sshStream) {
  console.log(`[relay] ${socket.id} resuming existing connection`);
  socket.emit('relay:connected', { 
    host: connection?.host || opts.connection?.host,
    resumed: true 
  });
  return;
}
```

#### B. Improved Error Handling on Duplicate Connections
- Now returns recoverable error instead of silently ignoring
- Prevents connection attempt deadlocks

#### C. Fixed Upload Completion Timing
```javascript
// Changed from 2000ms delay to 500ms with proper cleanup
completionTimer = setTimeout(() => {
  if (!completionSent) {
    console.log(`📤 [wsRelay] Finish fallback (500ms) - sending completion`);
    sendCompletion();
  }
}, 500);
```

### 2. Relay Client (`src/lib/relayClient.js`)

#### Added Resume Parameter
```javascript
requestConnection(connectionData, cols, rows, resuming = false) {
  this.socket.emit('relay:connect', {
    connectionId: connectionData._id,
    connection: connectionData,
    cols,
    rows,
    resuming, // NEW: Signal this is a resume attempt
  });
}
```

### 3. FileManager (`src/components/FileManager.js`)

#### A. Smart Visibility Change Handling
```javascript
const verifyAfterReturn = () => {
  // Skip verification if we're actively transferring
  const hasActiveTransfer = transferRef.current && 
    !transferRef.current.waiting && 
    !transferRef.current.error;
  
  if (hasActiveTransfer) {
    console.log('⏭️ Skipping reconnection check - active transfer in progress');
    return;
  }
  // ... rest of verification logic
};
```

**Key Changes:**
- Check for active transfers before triggering any reconnection logic
- Differentiate between active uploads and queued uploads
- Only preserve transfer state when truly necessary

#### B. Better Reconnection Messages
- Now distinguishes between reconnection with/without queued uploads
- Provides clearer user feedback about what's being preserved

### 4. Local Relay (`public/local-relay.js`)

#### Fixed Upload Completion Timing
```javascript
let completionTimer = null;

stream.on('finish', () => {
  if (!completionSent) {
    completionTimer = setTimeout(() => {
      if (!completionSent) {
        sendCompletion();
      }
    }, 500);
  }
});

stream.on('close', () => {
  clearTimeout(completionTimer);
  sendCompletion();
});
```

## Testing Recommendations

### Test Scenario 1: Tab Switch During Upload
1. Start uploading a large file (>50MB)
2. Switch to another tab
3. Wait 10 seconds
4. Switch back to the upload tab
5. **Expected:** Upload continues without interruption

### Test Scenario 2: Network Hiccup During Upload
1. Start uploading a file
2. Briefly disconnect network (2-3 seconds)
3. Reconnect network
4. **Expected:** Upload resumes from last acknowledged chunk

### Test Scenario 3: Browser Minimize During Upload
1. Start uploading files
2. Minimize browser window
3. Wait in background
4. Restore browser window
5. **Expected:** Uploads complete successfully

### Test Scenario 4: Multiple Files in Queue
1. Queue 5 files for upload
2. While first file is uploading, switch tabs
3. Return to tab
4. **Expected:** All files complete in order

## Deployment Notes

### Server-Side Changes
- Restart the Next.js server after deploying these changes
- No database migrations required
- No breaking changes to existing connections

### Client-Side Changes
- Users may need to hard-refresh (Ctrl+Shift+R) to get updated JavaScript
- Local relay users should download the new `local-relay.min.js`

## Backward Compatibility

All changes are backward compatible:
- Old clients will work with new server (just without resume feature)
- New clients will work with old local relay (falls back to full reconnect)
- No API contract changes

## Performance Impact

- **Positive:** Fewer unnecessary reconnections = less overhead
- **Positive:** Faster completion detection = better UX
- **Neutral:** Resume logic adds minimal overhead (one extra check)

## Future Enhancements

1. **Chunk-level Resume:** Currently resumes at file level, could resume mid-file
2. **Upload Queue Persistence:** Save queue to localStorage for browser crash recovery
3. **Network Quality Detection:** Adjust chunk size based on connection stability
4. **Progress Persistence:** Remember progress across full page reloads

## Rollback Plan

If issues arise, revert these commits:
1. `src/lib/wsRelayServer.js` - revert upload completion and resume logic
2. `src/lib/relayClient.js` - revert requestConnection signature
3. `src/components/FileManager.js` - revert verifyAfterReturn function
4. `public/local-relay.js` - revert upload completion timing

---

**Fixed By:** Kiro AI Assistant  
**Date:** 2026-08-11  
**Tested:** Manual testing required (see scenarios above)
