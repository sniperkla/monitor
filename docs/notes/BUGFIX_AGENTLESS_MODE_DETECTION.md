# Bug Fix: Agentless Mode Detection & Status Display

## Issue Description

When testing the Server Monitor in **agentless mode** (no monitor agent installed, using HTTP polling for telemetry), the dashboard incorrectly displayed:
- ✅ "Agent Connected" status badge
- ✅ "Agent Streaming" mode indicator

When it should have shown:
- ⚠️ "Agentless Mode" 
- ⚠️ "Live — HTTP Polling"

## Root Cause

The issue was caused by overly permissive agent detection logic that resulted in false-positive "agent connected" status:

### 1. **Loose Agent Matching Logic** (Lines 959-968)
```javascript
// OLD CODE - Too permissive
const liveAgent = connectedAgents.size > 0 && [...connectedAgents.values()].find(
  a => a.host === connHost || 
       a.ip === connHost ||
       a.agentName === connHost || 
       a.agentName === selectedConn_?.label ||
       (currentHostname && (a.agentName === currentHostname || a.host === currentHostname))
);
const isLive = isSocketStreaming || isP2PStreaming || !!liveAgent;  // ← Problem!
```

**Problem:** The `isLive` flag would be `true` if ANY agent in `connectedAgents` matched, even if `isSocketStreaming` and `isP2PStreaming` were both `false`. This could happen when:
- An agent from a different server was connected
- Hostname matching was too broad
- Stale entries remained in `connectedAgents` Map

### 2. **Automatic Stream State Setting** (Lines 572-577)
```javascript
// OLD CODE - Sets streaming=true on ANY telemetry:stream event
socket.on('telemetry:stream', (raw) => {
  if (!isP2PStreamingRef.current) {
    setIsSocketStreaming(true);  // ← Sets to true unconditionally!
    handleIncomingTelemetry(raw);
  }
});
```

**Problem:** If the socket ever received a `telemetry:stream` event (from any source), it would set `isSocketStreaming = true`, even if the current server had no agent.

## The Fix

### Fix #1: Strict Agent Matching with Streaming State Requirement

```javascript
// NEW CODE - Requires active streaming channels
const liveAgent = (isSocketStreaming || isP2PStreaming) && 
  connectedAgents.size > 0 && 
  [...connectedAgents.values()].find(a => {
    // Strict matching: must match host, IP, label, or hostname
    const matchHost = a.host === connHost || a.ip === connHost;
    const matchName = a.agentName === connHost || a.agentName === connLabel;
    const matchHostname = currentHostname && 
      (a.agentName === currentHostname || a.host === currentHostname);
    return matchHost || matchName || matchHostname;
  });
const isLive = (isSocketStreaming || isP2PStreaming) && !!liveAgent;
```

**Changes:**
- `liveAgent` is only checked if `isSocketStreaming || isP2PStreaming` is true
- `isLive` now **requires both** an active stream AND a matching agent
- Added explicit `connLabel` extraction for clearer logic

### Fix #2: Enhanced telemetry:no_agent Handler

```javascript
socket.on('telemetry:no_agent', () => {
  console.log('[ServerMonitor] No agent available for selected server — falling back to HTTP polling');
  setIsSocketStreaming(false);
  setIsP2PStreaming(false);
  isP2PStreamingRef.current = false;
});
```

**Changes:**
- Added debug logging for better visibility
- Ensures all streaming flags are cleared when no agent is available

### Fix #3: HTTP Polling State Safeguard

```javascript
const runLoop = async () => {
  if (!isMounted) return;
  if (autoRefresh && isTabVisible) {
    // Ensure we're not falsely showing agent connected during HTTP polling
    setIsSocketStreaming(false);
    setIsP2PStreaming(false);
    
    const start = Date.now();
    await fetchMetrics();
    // ... rest of polling logic
  }
};
```

**Changes:**
- Explicitly sets streaming flags to `false` during HTTP polling loop
- Ensures the UI always reflects the correct mode

## Expected Behavior After Fix

### Agentless Mode (No Agent Installed)
```
Server Monitor
🟢 Agentless Mode
🟢 Live — HTTP Polling

Button: ⚠️ Install Agent
```

### Agent Installed but Not Connected
```
Server Monitor
🟢 Agentless Mode
🟢 Live — HTTP Polling

Button: 🟠 Agent (No WS)
```

### Agent Connected via WebSocket
```
Server Monitor
🟢 Agent Streaming
🟢 Agent WebSocket Stream (<10ms)

Button: 🟢 Agent Connected
```

### Agent Connected via WebRTC P2P
```
Server Monitor
🟢 Agent Streaming
🟢 WebRTC P2P DataChannel (0ms Direct)

Button: 🟢 Agent Connected
```

## Testing Checklist

- [ ] Fresh server with no agent → Shows "Agentless Mode" + "Live — HTTP Polling"
- [ ] Agent installed but not running → Shows "Agentless Mode" + button shows "Agent (No WS)"
- [ ] Agent running and connected via WebSocket → Shows "Agent Streaming" + "Agent WebSocket Stream"
- [ ] Agent running and connected via WebRTC → Shows "Agent Streaming" + "WebRTC P2P DataChannel"
- [ ] Switch between servers with/without agents → Status updates correctly
- [ ] Stop agent while viewing → Falls back to "Agentless Mode" gracefully

## Files Modified

- `src/apps/ServerMonitorApp.js` (3 sections)
  - Lines ~959-968: Agent matching logic
  - Lines ~566-569: telemetry:no_agent handler
  - Lines ~572-577: telemetry:stream handler
  - Lines ~700+: HTTP polling loop

## Related Components

- **Server-side:** `server.js` lines 4321-4390 (telemetry:start_stream handler)
- **API Route:** `src/app/api/server-monitor/metrics/route.js` (SSH polling endpoint)
- **Agent Setup:** `src/components/AgentSetupWizard.js` (status checking)

## Implementation Notes

The fix ensures that the **source of truth** for "agent connected" status is:
1. **Primary:** `isSocketStreaming` or `isP2PStreaming` flags (set only when actively receiving agent data)
2. **Secondary:** Matching entry in `connectedAgents` Map (validated only when primary is true)

This two-level validation prevents false positives from stale agent references or cross-server contamination.
