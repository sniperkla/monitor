# Debug: 700KB Image Only Uploads 256KB

## Problem
Uploading a 700KB image file results in only 256KB being transferred, causing the image to display 15% with the rest black.

## Why 256KB Exactly?
256KB = `WEBRTC_MAX_CHUNK` = One chunk size
This means **only the first chunk is being sent**.

## Possible Causes

### 1. Loop Exits After First Chunk
The upload loop might be breaking early:
```javascript
while (offset < file.size) {
  // Send chunk
  offset = end;  // If this doesn't update correctly, loop exits
}
```

### 2. File Size Misread
If `file.size` is being read as 256KB instead of 700KB:
```javascript
while (offset < file.size) {  // If file.size = 256KB, exits after 1 chunk
```

### 3. DataChannel Closes Early
If the RTCDataChannel closes after first chunk:
```javascript
if (!fileDc || fileDc.readyState !== 'open') {
  throw new Error('RTCDataChannel closed during upload');
}
```

### 4. Build Not Updated
The fixes might not be in the running build yet.

## Debug Logging Added

I've added extensive logging to `src/lib/webrtc-relay.js`:

```javascript
// At start
console.log(`[WebRTC Upload] File: ${file.name}, Size: ${file.size} bytes, fileView: ${fileView.length} bytes`);

// Each chunk
console.log(`[WebRTC Upload] Chunk ${chunkCount}: offset=${offset}, end=${end}, bufSize=${buf.length}, fileSize=${file.size}`);

// Progress
console.log(`[WebRTC Upload] Progress: ${offset}/${file.size} (${percent}%)`);

// Complete
console.log(`[WebRTC Upload] Complete: ${chunkCount} chunks, ${offset} bytes`);

// Error
console.error(`[WebRTC Upload] Error at offset ${offset}/${file.size}:`, err);
```

## How to Debug

### Step 1: Rebuild
```bash
cd /Users/katanyoo/Desktop/monitor
npm run build
# OR just restart dev server
npm run dev
```

### Step 2: Upload Image Again
Open browser console and look for logs:

**Expected output for 700KB file:**
```
[WebRTC Upload] File: image.jpg, Size: 716800 bytes, fileView: 716800 bytes
[WebRTC Upload] Chunk 1: offset=0, end=262144, bufSize=262144, fileSize=716800
[WebRTC Upload] Progress: 262144/716800 (36.6%)
[WebRTC Upload] Chunk 2: offset=262144, end=524288, bufSize=262144, fileSize=716800
[WebRTC Upload] Progress: 524288/716800 (73.1%)
[WebRTC Upload] Chunk 3: offset=524288, end=716800, bufSize=192512, fileSize=716800
[WebRTC Upload] Progress: 716800/716800 (100.0%)
[WebRTC Upload] Complete: image.jpg, 3 chunks, 716800 bytes
```

**What you're probably seeing:**
```
[WebRTC Upload] File: image.jpg, Size: 716800 bytes, fileView: 716800 bytes
[WebRTC Upload] Chunk 1: offset=0, end=262144, bufSize=262144, fileSize=716800
[WebRTC Upload] Progress: 262144/716800 (36.6%)
[WebRTC Upload] Error at offset 262144/716800: RTCDataChannel closed during upload
```

Or:
```
[WebRTC Upload] File: image.jpg, Size: 262144 bytes, fileView: 262144 bytes  ← WRONG SIZE!
[WebRTC Upload] Chunk 1: offset=0, end=262144, bufSize=262144, fileSize=262144
[WebRTC Upload] Progress: 262144/262144 (100.0%)
[WebRTC Upload] Complete: image.jpg, 1 chunks, 262144 bytes
```

### Step 3: Check Console Output
Share the console logs and we can identify exactly where it's failing.

## Quick Test

Try uploading via **WebSocket (Server relay)** instead of WebRTC to isolate the issue:

1. Disconnect and reconnect SSH session (forces WebSocket mode)
2. Or temporarily disable WebRTC in code
3. Upload same image
4. If it works → WebRTC issue
5. If still 256KB → File reading issue

## Temporary Workaround

If you need to upload images immediately, use **WebSocket mode**:

1. Go to connection settings
2. Disable "Use P2P (WebRTC)" option
3. Reconnect
4. Upload files via server relay

This will be slower but should transfer complete files.

## Files Modified

- `src/lib/webrtc-relay.js` - Added debug logging throughout upload loop

## Next Steps

Once you run the upload with logging enabled, share the console output and we can pinpoint the exact issue.
