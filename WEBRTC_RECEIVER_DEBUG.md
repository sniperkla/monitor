# WebRTC Receiver Debug Guide

## What We Know

From your client log:
```
[WebRTC Upload] File: image.jpg, Size: 126798 bytes, fileView: 126798 bytes
[WebRTC Upload] Chunk 1: offset=0, end=126798, bufSize=126798, fileSize=126798
[WebRTC Upload] Progress: 126798/126798 (100.0%)
[WebRTC Upload] Complete: image.jpg, 1 chunks, 126798 bytes
```

**Client is sending 126,798 bytes correctly.**

## The Problem

If the file on the server is smaller (e.g., 256KB or incomplete), the issue is on the **receiver side** (local-relay.js).

## Added Logging

I've added comprehensive logging to `public/local-relay.js`:

```javascript
// When chunk received
[FILE DC] Received chunk: 126798 bytes, total received: 0/126798, connId=xxx
[FILE DC] Stream not ready, queued chunk (1 pending)

// When stream ready
[FILE DC] Stream ready, flushing 1 pending chunks
[FILE DC] Flushed queued chunk: 126798 bytes
[FILE DC] Total after flush: 126798/126798 bytes
[FILE DC] Written to stream: 126798 bytes, progress: 126798/126798 (100.0%)
[FILE DC] Upload session ready for image.jpg
```

## How to Debug

### Step 1: Rebuild local-relay
```bash
cd /Users/katanyoo/Desktop/monitor

# Manual build (if npm script fails)
cp public/local-relay.js public/local-relay.min.js
```

### Step 2: Restart local-relay
```bash
# Find and kill existing relay
ps aux | grep local-relay
kill <PID>

# Start fresh
node public/local-relay.js --server <your-server> --token <your-token>
```

### Step 3: Upload file via WebRTC

Watch the **local-relay terminal output** for the `[FILE DC]` logs.

## Expected vs Problem Scenarios

### ✅ Expected (Working):
```
Client: Sending 126798 bytes
Relay:  [FILE DC] Received chunk: 126798 bytes
Relay:  [FILE DC] Stream not ready, queued chunk
Relay:  [FILE DC] Stream ready, flushing 1 pending chunks
Relay:  [FILE DC] Flushed queued chunk: 126798 bytes
Relay:  [FILE DC] Written to stream: 126798 bytes
Server: File is 126798 bytes ✓
```

### ❌ Problem 1: Chunk never arrives
```
Client: Sending 126798 bytes ✓
Relay:  (no logs at all)
Server: File is 0 bytes or missing
```
**Cause**: DataChannel not working, data lost in transit

### ❌ Problem 2: Partial chunk
```
Client: Sending 126798 bytes ✓
Relay:  [FILE DC] Received chunk: 65536 bytes  ← WRONG SIZE
Server: File is 65536 bytes
```
**Cause**: DataChannel message size limit exceeded, chunk truncated

### ❌ Problem 3: Stream not writing
```
Client: Sending 126798 bytes ✓
Relay:  [FILE DC] Received chunk: 126798 bytes ✓
Relay:  [FILE DC] Stream not ready, queued chunk ✓
Relay:  [FILE DC] Stream ready, flushing 1 pending chunks ✓
Relay:  [FILE DC] Flushed queued chunk: 126798 bytes ✓
Relay:  (but file on server is 0 bytes or smaller)
```
**Cause**: SFTP write stream failing silently

## Quick Fix: Reduce Chunk Size

If chunks >64KB are being truncated, the DataChannel might have a message size limit.

**Edit `src/lib/webrtc-relay.js`:**

```javascript
// Line 260 - Reduce from 256KB to 64KB
chunkSize = 64 * 1024,  // 64 KB chunks instead of 256 KB
```

This will send smaller chunks, avoiding any message size limits.

## Alternative: Force WebSocket Mode

To bypass WebRTC issues entirely:

**Edit `src/components/FileManager.js`**, find the WebRTC check and temporarily disable it:

```javascript
// Around line 1876
if (false && rtcPeer && rtcPeer.isConnected()) {  // Add "false &&" to disable
  // WebRTC path...
}
```

Or use the UI to disable WebRTC in connection settings.

## What to Share

Please share:
1. **Client logs** (browser console) - you already did ✓
2. **Local-relay logs** (terminal where relay is running)
3. **File size on server** - `ls -lh <uploaded-file>`
4. **Whether file is complete or partial** - Can you open it? Is it corrupted?

This will tell us exactly where the data is being lost!
