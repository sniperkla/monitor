# Test Verification: Agentless Mode Fix

## Test Environment

**Server:** server1  
**Initial State:** Foreground test with agentless mode  
**Problem:** Showing "Agent Connected" when using HTTP polling

## Pre-Fix Behavior (ISSUE)

```
✅ Header Status Badge: "Agent Streaming"
✅ Connection Mode: "Live — HTTP Polling" (correct, but contradictory)
✅ Button Status: "Agent Connected" (INCORRECT - no agent is running)
```

## Expected Post-Fix Behavior

```
✅ Header Status Badge: "Agentless Mode"
✅ Connection Mode: "Live — HTTP Polling"
✅ Button Status: "Install Agent" or "Agent (No WS)"
```

## Step-by-Step Verification

### Test 1: Fresh Connection (No Agent Installed)

1. **Setup:**
   - Select server1 connection
   - No monitor agent installed or running

2. **Expected UI State:**
   ```
   Server Monitor
   🟢 Agentless Mode  ← Badge should be green with "Agentless Mode"
   🟢 Live — HTTP Polling  ← Status should show HTTP polling
   
   Button: ⚠️ Install Agent  ← Button should offer installation
   ```

3. **Browser Console Check:**
   ```javascript
   // Should see this log when no agent is available:
   [ServerMonitor] No agent available for selected server — falling back to HTTP polling
   ```

4. **Verification Points:**
   - [ ] Badge shows "Agentless Mode" (not "Agent Streaming")
   - [ ] Status shows "Live — HTTP Polling"
   - [ ] Button shows "Install Agent" (not "Agent Connected")
   - [ ] Metrics update via HTTP polling (check Network tab → see /api/server-monitor/metrics calls)
   - [ ] No WebSocket telemetry:stream events in console

---

### Test 2: Agent Installed but Not Running

1. **Setup:**
   - Monitor agent binary exists on server
   - Agent process is NOT running (`ps aux | grep monitor-agent` shows nothing)

2. **Expected UI State:**
   ```
   Server Monitor
   🟢 Agentless Mode
   🟢 Live — HTTP Polling
   
   Button: 🟠 Agent (No WS)  ← Indicates agent exists but not connected
   ```

3. **Verification Points:**
   - [ ] Badge shows "Agentless Mode"
   - [ ] Button shows "Agent (No WS)" with amber/orange color
   - [ ] HTTP polling continues working
   - [ ] No WebSocket connection from agent

---

### Test 3: Agent Running and Connected (WebSocket)

1. **Setup:**
   - Start monitor agent: `node monitor-agent.js --token=YOUR_TOKEN`
   - Wait for WebSocket connection

2. **Expected UI State:**
   ```
   Server Monitor
   🟢 Agent Streaming  ← NOW it should say "Agent Streaming"
   🟢 Agent WebSocket Stream (<10ms)
   
   Button: 🟢 Agent Connected  ← Green badge with "Agent Connected"
   ```

3. **Browser Console Check:**
   ```javascript
   // Should see these logs:
   [ServerMonitor] Receiving telemetry:stream from agent
   [WebSocket] Connected to monitor agent
   ```

4. **Verification Points:**
   - [ ] Badge changes from "Agentless Mode" to "Agent Streaming"
   - [ ] Status changes from "HTTP Polling" to "Agent WebSocket Stream"
   - [ ] Button shows "Agent Connected" with green badge
   - [ ] Network tab shows NO /api/server-monitor/metrics calls (WebSocket takes over)
   - [ ] Metrics update in real-time via WebSocket

---

### Test 4: Agent Stops While Viewing

1. **Setup:**
   - Agent running and connected (from Test 3)
   - Stop the agent process (Ctrl+C)

2. **Expected Behavior:**
   - UI should automatically fall back to agentless mode
   - Badge should change: "Agent Streaming" → "Agentless Mode"
   - Status should change: "Agent WebSocket Stream" → "Live — HTTP Polling"
   - Button should change: "Agent Connected" → "Agent (No WS)"

3. **Verification Points:**
   - [ ] Automatic fallback happens within 5-10 seconds
   - [ ] HTTP polling resumes automatically
   - [ ] No error messages or UI freeze
   - [ ] Console shows: `No agent available for selected server — falling back to HTTP polling`

---

### Test 5: Switch Between Servers

1. **Setup:**
   - Server A: Has agent running
   - Server B: No agent installed

2. **Test Sequence:**
   ```
   1. Select Server A → Should show "Agent Streaming"
   2. Select Server B → Should show "Agentless Mode"
   3. Select Server A again → Should show "Agent Streaming"
   ```

3. **Verification Points:**
   - [ ] Status updates correctly when switching
   - [ ] No cross-contamination (Server B doesn't show Server A's agent as connected)
   - [ ] Each server maintains its own correct state

---

### Test 6: WebRTC P2P Upgrade (If Available)

1. **Setup:**
   - Agent running with WebRTC support (node-datachannel installed)
   - Local relay configured

2. **Expected UI State:**
   ```
   Server Monitor
   🟢 Agent Streaming
   🟢 WebRTC P2P DataChannel (0ms Direct)  ← Upgraded to P2P
   
   Button: 🟢 Agent Connected
   ```

3. **Browser Console Check:**
   ```javascript
   [WebRTC Telemetry] Negotiating P2P DataChannel for connId: ...
   [WebRTC Telemetry] P2P DataChannels open — streaming directly
   ```

4. **Verification Points:**
   - [ ] Status shows "WebRTC P2P DataChannel"
   - [ ] Badge still shows "Agent Streaming"
   - [ ] Button shows "Agent Connected"
   - [ ] Ultra-low latency metrics updates

---

## Debugging Tips

If the fix doesn't work as expected:

1. **Check Browser Console:**
   ```javascript
   // Look for these key logs:
   [ServerMonitor] No agent available for selected server — falling back to HTTP polling
   [ServerMonitor] Receiving telemetry:stream from agent
   ```

2. **Check Network Tab:**
   - **Agentless mode:** Should see repeated `/api/server-monitor/metrics?connectionId=...` calls
   - **Agent mode:** Should NOT see metrics API calls, only WebSocket frames

3. **Check State Variables:**
   ```javascript
   // In React DevTools, check ServerMonitorApp state:
   isSocketStreaming: false  // Should be false in agentless mode
   isP2PStreaming: false     // Should be false in agentless mode
   connectedAgents: Map(0)   // Should be empty in agentless mode
   ```

4. **Check Server-Side:**
   ```bash
   # Check if agent is actually connected
   curl http://localhost:3000/api/relay/agents
   
   # Should return:
   # - Empty array if no agents: []
   # - Agent list if connected: [{"agentName": "...", "host": "...", ...}]
   ```

---

## Success Criteria

✅ **All 6 tests pass**  
✅ **No false "Agent Connected" in agentless mode**  
✅ **Correct mode indication in all scenarios**  
✅ **Smooth transitions between modes**  
✅ **No UI freezes or errors**

---

## Rollback Plan (If Needed)

If the fix causes issues:

```bash
cd /Users/katanyoo/Desktop/monitor
git diff src/apps/ServerMonitorApp.js  # Review changes
git checkout src/apps/ServerMonitorApp.js  # Revert if needed
npm run build  # Rebuild
```

---

## Notes for Deployment

1. **Development Test:** Test in dev mode first (`npm run dev`)
2. **Production Build:** Build and test (`npm run build && npm start`)
3. **Docker Deployment:** Update and rebuild container
   ```bash
   docker compose up -d --build
   ```
4. **Monitor Logs:** Check for any console errors after deployment
