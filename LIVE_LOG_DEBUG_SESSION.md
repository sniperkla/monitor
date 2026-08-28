# 🔍 Live Log Streaming Debug Session

## What We Know
✅ Your Hermes logs EXIST and have content (you showed them)
✅ The `cleanLogStream` function works correctly (tested - doesn't filter out Python logs)
✅ The Refresh button already exists and works

## What We're Testing Now
We've added comprehensive debug logging to track:
1. When the useEffect triggers
2. Socket.IO connection lifecycle
3. WebRTC vs WebSocket path selection
4. Data flow through the pipeline

---

## 🚀 Testing Steps

### Step 1: Restart Dev Server
```bash
cd /Users/katanyoo/Desktop/monitor
npm run dev
```

Wait for: `✓ Ready in Xms`

### Step 2: Open Browser with Console
1. Open http://localhost:3000
2. **Press F12** (or Cmd+Option+I on Mac)
3. Go to **Console tab**
4. **Click the filter icon** and type: `Agent`
   - This will show only `[Agent Logs]` messages

### Step 3: Navigate to AI Agents
1. Click "AI Agents" in the sidebar
2. Select your server (fc-fedora40)
3. Click the **"Agent Logs"** tab

### Step 4: Watch Console Output

You should see messages in this order:

#### ✅ Expected Flow (Working):
```
[Agent Logs] useEffect triggered: tab=logs, target=xxx, agentId=hermes
[Agent Logs] Selected connection: fc-fedora40
[Agent Logs] Socket.IO client created, waiting for connect event...
[Agent Logs] Socket connected! Emitting ssh:connect for fc-fedora40
```

Then EITHER:

**Path A: WebRTC (Preferred)**
```
[Agent Logs] relay:rtc:ready received, initializing WebRTC peer for xxx
[Agent Logs] WebRTC peer established, setting up SSH channel...
[Agent Logs] Sent ssh:start control message via WebRTC
[Agent Logs] Sending tail command via WebRTC: stty -echo 2>/dev/null; mkdir...
[Agent Logs] WebRTC data received: 1024 bytes
[Agent Logs] After cleanLogStream (WebRTC): 856 chars
```

**Path B: WebSocket Fallback**
```
[Agent Logs] SSH connected for hermes, sending tail command: stty -echo...
[Agent Logs] ssh:data received (1024 bytes), active=true, paused=false, rtc=false
[Agent Logs] After cleanLogStream: 856 chars
[Agent Logs] Replacing placeholder with real data
```

---

## 🐛 Troubleshooting by Console Output

### Issue 1: No messages at all
**Console shows**: (nothing)

**Problem**: useEffect isn't triggering
**Check**:
- Is the server selector showing a server?
- Are you on the "Agent Logs" tab (not Overview/Config)?
- Check browser console for React errors

### Issue 2: "No selected connection found"
**Console shows**: 
```
[Agent Logs] useEffect triggered: tab=logs, target=xxx, agentId=hermes
[Agent Logs] No selected connection found, aborting
```

**Problem**: Connection not found in state
**Fix**: Try reloading the page (the connections might not have loaded yet)

### Issue 3: Socket won't connect
**Console shows**:
```
[Agent Logs] Socket.IO client created, waiting for connect event...
[Agent Logs] Socket connection error: ...
```

**Problem**: WebSocket server not responding
**Check**:
- Is `npm run dev` running?
- Is the custom server.js working? (Look for server errors in terminal)
- Try refreshing the page

### Issue 4: SSH connection doesn't establish
**Console shows**:
```
[Agent Logs] Socket connected! Emitting ssh:connect for fc-fedora40
(then nothing)
```

**Problem**: SSH backend isn't connecting
**Check**:
- Can you connect to this server from the Terminal tab?
- Check the server terminal for SSH errors
- Verify SSH credentials are correct

### Issue 5: Connected but no data
**Console shows**:
```
[Agent Logs] SSH connected for hermes, sending tail command: ...
(then nothing - no ssh:data events)
```

**Problem**: Tail command is waiting (log file empty or no new logs)
**Fix**:
1. Click the **Refresh button** to fetch historical logs
2. Generate activity:
   ```bash
   # SSH into your server
   ssh user@fc-fedora40
   
   # Generate test logs
   echo "[$(date)] Test log" >> ~/.hermes/logs/daemon.log
   ```
3. Or restart Hermes:
   ```bash
   systemctl --user restart hermes
   ```

### Issue 6: Data received but filtered out
**Console shows**:
```
[Agent Logs] ssh:data received (1024 bytes), active=true, paused=false, rtc=false
[Agent Logs] After cleanLogStream: 0 chars
```

**Problem**: cleanLogStream is filtering everything (shouldn't happen based on our test)
**Debug**: Copy the actual log content and test it with test-log-cleaner.js

---

## 📊 What to Report Back

Please share:

1. **What you see in the console** (copy/paste the [Agent Logs] lines)

2. **Which path is being used**:
   - WebRTC (relay:rtc:ready)
   - WebSocket (ssh:connected)
   - Neither (stuck at "Socket.IO client created")

3. **If data is being received**:
   - `ssh:data received` or `WebRTC data received` messages
   - Byte counts
   - Character counts after cleaning

4. **Screenshot** of:
   - The console with filter applied to show only `[Agent Logs]`
   - The Agent Logs tab UI

5. **Terminal output** from the server running `npm run dev`

---

## 🎯 Quick Fixes

### Fix 1: Use Refresh Button
**Works for**: Getting historical logs immediately
**Location**: Logs tab toolbar, button with refresh icon

### Fix 2: Generate Test Logs
```bash
# SSH into fc-fedora40
ssh user@fc-fedora40

# Generate continuous logs to test streaming
while true; do
  echo "[$(date)] Test log entry $RANDOM" >> ~/.hermes/logs/daemon.log
  sleep 1
done
```

Then watch the UI - logs should appear every second.

### Fix 3: Check Log File Exists
```bash
# SSH into fc-fedora40
ls -la ~/.hermes/logs/

# If directory doesn't exist
mkdir -p ~/.hermes/logs
touch ~/.hermes/logs/daemon.log

# Verify Hermes is running
systemctl --user status hermes

# If not running, start it
systemctl --user start hermes
```

---

## 🔥 Nuclear Option

If nothing works:

1. **Stop everything**:
   ```bash
   # On server
   systemctl --user stop hermes
   
   # On dev machine
   # Ctrl+C to stop npm run dev
   ```

2. **Clear logs**:
   ```bash
   # On server
   rm -f ~/.hermes/logs/*.log
   ```

3. **Restart everything**:
   ```bash
   # On server
   systemctl --user start hermes
   
   # On dev machine
   npm run dev
   ```

4. **Open UI and watch console from the start**

---

## Expected Behavior (When Working)

1. Open Logs tab
2. See "Connecting..." briefly
3. See placeholder message for 2-3 seconds
4. **Logs auto-appear** as they're generated
5. Console shows regular `ssh:data received` or `WebRTC data received` messages
6. UI scrolls automatically to bottom
7. Clicking Refresh fetches last 300 lines immediately

---

Ready to test! Follow steps 1-4 and report what you see in the console. 🚀
