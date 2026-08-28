# Log Streaming Debug Guide

## Changes Made

### 1. Added Debug Logging
Location: `src/apps/AIAgentsApp.js` lines ~690-725

**What to check in browser console:**
1. `[Agent Logs] SSH connected for {agentId}, sending tail command: ...` 
   - Confirms SSH connection established
   - Shows the exact tail command being sent

2. `[Agent Logs] ssh:data received (X bytes), active=true, paused=false, rtc=false`
   - Confirms data is being received from the SSH connection
   - Shows if logs are being blocked by filters

3. `[Agent Logs] After cleanLogStream: X chars`
   - Shows how much data remains after cleaning ANSI codes
   - If this is 0 but bytes > 0, the cleaner is too aggressive

4. `[Agent Logs] Replacing placeholder with real data`
   - Confirms real log data is replacing the waiting message

### 2. Updated Placeholder Message
Added mention of the Refresh button in the waiting message.

### 3. Refresh Button Already Exists!
Location: Lines 1188-1204
- **Refresh button** - Fetches last 300 lines via HTTP API
- **Pause/Resume** - Controls the live stream
- **Clear** - Clears the buffer
- **Copy** - Copies logs to clipboard

## How to Debug

### Step 1: Open Browser Console
1. Open the AI Agents tab
2. Press `F12` or `Cmd+Option+I` to open DevTools
3. Go to the Console tab
4. Filter for `[Agent Logs]`

### Step 2: Check Log Files on Server
SSH into your target server and run:

```bash
# Check if Hermes log directory exists
ls -la ~/.hermes/logs/

# Check log file contents
tail -f ~/.hermes/logs/*.log

# Or check the exact command being sent
mkdir -p "$HOME/.hermes/logs"
touch "$HOME/.hermes/logs/daemon.log"
LOGF="$(ls -1t "$HOME/.hermes/logs/"*.log 2>/dev/null | head -1)"
[ -z "$LOGF" ] && LOGF="$HOME/.hermes/logs/daemon.log"
tail -n 100 -F "$LOGF"
```

Replace `.hermes` with:
- `.nanobot` for Nanobot
- `.openclaw` for OpenClaw
- `.zeroclaw` for ZeroClaw

### Step 3: Test Tail Command
The tail command being sent:
```bash
stty -echo 2>/dev/null; 
mkdir -p "$HOME/.hermes/logs"; 
touch "$HOME/.hermes/logs/daemon.log"; 
LOGF="$(ls -1t "$HOME/.hermes/logs/"*.log 2>/dev/null | head -1)"; 
[ -z "$LOGF" ] && LOGF="$HOME/.hermes/logs/daemon.log"; 
tail -n 100 -F "$LOGF" 2>/dev/null || journalctl --user -u hermes --no-pager -n 100 -f 2>/dev/null
```

This command:
1. Disables terminal echo
2. Creates log directory if missing
3. Creates daemon.log if missing
4. Finds the most recent log file
5. Tails it with `-F` (follow with retry)
6. Falls back to journalctl if tail fails

### Step 4: Check Agent Is Running
```bash
# Check if the agent gateway is running
systemctl --user status hermes

# Check if logs are being generated
journalctl --user -u hermes -n 50 --no-pager

# Manually start the agent
systemctl --user start hermes

# Watch logs in real-time
journalctl --user -u hermes -f
```

### Step 5: Generate Test Logs
If no logs exist, generate some:
```bash
# Create a test log entry
echo "[$(date)] Test log entry from manual debug" >> ~/.hermes/logs/daemon.log

# Restart the agent to generate logs
systemctl --user restart hermes

# Send a test message to your bot on Telegram/Discord
# This should trigger log activity
```

## Common Issues

### Issue 1: "Waiting for log output" but agent is running
**Cause**: Log file is empty or doesn't exist yet
**Solution**: 
- Click **Refresh** button to fetch via HTTP API
- Generate activity (send bot message, restart gateway)
- Check console for `ssh:data` events

### Issue 2: Console shows `ssh:data received` but nothing appears
**Cause**: `cleanLogStream()` is filtering out all content
**Solution**:
- Check console: `After cleanLogStream: 0 chars` means cleaner is too aggressive
- The cleaner removes ANSI codes, bash prompts, login messages
- May need to adjust the regex patterns

### Issue 3: No `ssh:data` events in console
**Cause**: Tail command is waiting (no logs generated yet)
**Solution**:
- Tail will wait silently if log file exists but is empty
- Generate activity to create log entries
- Check if file exists: `ls -la ~/.hermes/logs/`

### Issue 4: WebRTC path being used
**Cause**: Using P2P connection via Local Relay
**Console check**: Should see `relay:rtc:ready` instead of `ssh:connected`
**Solution**: This is normal and preferred for performance

## Expected Console Output (Working)

```
[Agent Logs] SSH connected for hermes, sending tail command: stty -echo 2>/dev/null; mkdir -p "$HOME/.hermes/logs"; ...
[Agent Logs] ssh:data received (1024 bytes), active=true, paused=false, rtc=false
[Agent Logs] After cleanLogStream: 856 chars
[Agent Logs] Replacing placeholder with real data
[Agent Logs] ssh:data received (512 bytes), active=true, paused=false, rtc=false
[Agent Logs] After cleanLogStream: 423 chars
```

## Expected Console Output (Waiting)

```
[Agent Logs] SSH connected for hermes, sending tail command: stty -echo 2>/dev/null; mkdir -p "$HOME/.hermes/logs"; ...
[Agent Logs] No logs after 3s, showing placeholder for hermes
```
(No `ssh:data` events = tail is waiting for log content)

## Quick Fixes

### Fix 1: Use Refresh Button
**Best for**: Getting historical logs immediately
**How**: Click the **Refresh** button in the logs tab toolbar

### Fix 2: Restart Agent Gateway
**Best for**: Generating fresh logs
**How**: 
1. Go to Overview tab
2. Click "Stop [Agent]"
3. Wait 2 seconds
4. Click "Start [Agent]"
5. Go back to Logs tab

### Fix 3: Create Test Logs Manually
**Best for**: Testing if streaming works at all
**How**:
```bash
# SSH into server
ssh user@your-server

# Create test logs
while true; do
  echo "[$(date)] Test log entry $RANDOM" >> ~/.hermes/logs/daemon.log
  sleep 1
done
```
Watch the logs tab - should update every second

## Next Steps

If logs still don't appear after following this guide:
1. Share the browser console output (filtered for `[Agent Logs]`)
2. Share the output of `ls -la ~/.hermes/logs/` from the server
3. Share the output of `systemctl --user status hermes`
4. Try the manual test log generator above
