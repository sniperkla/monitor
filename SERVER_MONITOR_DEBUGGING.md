# Server Monitor - Bug Fixes and Testing Guide

## Issues Fixed

### 1. CPU Data Not Showing
**Problem:** Frontend was accessing `data.cpu.usage` but backend returned `data.cpu.usagePercent`
**Fix:** Changed backend to return `cpu.usage` (line 232 in metrics/route.js)

### 2. Memory Data Field Mismatch
**Problem:** Frontend expected `memory.total`, `memory.used` but backend returned `memory.totalBytes`, `memory.usedBytes`
**Fix:** Changed backend to return correct field names (lines 236-240 in metrics/route.js)

### 3. Disk Data Not Showing
**Problem:** Frontend expected `disk.filesystems` array but backend returned flat `disk` array
**Fix:** Wrapped disk array in `filesystems` object (line 242 in metrics/route.js)

### 4. Network Data Missing
**Problem:** Frontend expected aggregated `network.rxRate` and `network.txRate` but backend only returned individual interfaces
**Fix:** Added aggregation of all interface rates (lines 227-230 in metrics/route.js)

### 5. Load Average Format
**Problem:** Frontend expected array `[1m, 5m, 15m]` but backend returned object `{1m, 5m, 15m}`
**Fix:** Changed to return array format (line 234 in metrics/route.js)

### 6. Applications Not Fetching
**Problem:** Frontend expected `apps.applications` but backend returned `apps.apps`
**Fix:** Changed frontend to access `apps.apps` (line 542 in ServerMonitorApp.js)

### 7. Added Debug Logging
- Backend now logs SSH command results and output previews
- Frontend logs received data for easier debugging
- Console logs prefixed with `[server-monitor/metrics]` and `[server-monitor/apps]`

## Testing Instructions

### 1. Check Server Logs
After opening Server Monitor and selecting a server, check the terminal/console for:

```
[server-monitor/metrics] SSH result: { code: 0, stdoutLength: 2543, stderrLength: 0 }
[server-monitor/metrics] Output preview: ===CPU_INFO===...
```

### 2. Check Browser Console
Open DevTools Console and look for:

```javascript
[ServerMonitorApp] Metrics data received: {
  success: true,
  cpu: { usage: 45.2, cores: 4, ... },
  memory: { total: 8589934592, used: 4294967296, ... },
  disk: { filesystems: [...] },
  network: { rxRate: 1048576, txRate: 524288, ... }
}

[ServerMonitorApp] Apps data received: {
  success: true,
  apps: [ { name: 'Docker', installed: true, version: '24.0.7', status: 'running' }, ... ]
}
```

### 3. Verify Data Display

**CPU Card:**
- Should show usage percentage (e.g., "45.2%")
- Should show trend indicator (↑ ↓ or −)
- Chart should animate with blue line
- Cores count should display
- CPU model should show

**Memory Card:**
- Should show usage percentage
- Chart should animate with green line
- Used and Total should show in human-readable format (GB, MB)

**Disk Card:**
- Should show mount points (/, /home, etc.)
- Progress bars should fill based on usage
- Should show used/total space

**Network Card:**
- Chart should show two lines (download/upload)
- Download and upload rates should update
- Values should be in KB/s, MB/s, etc.

**Applications Tab:**
- Should show installed apps with icons
- Version numbers should display
- Status badges (running/stopped) should show
- Docker should show container counts if installed

## Common Issues

### Issue: "No data" or zeros everywhere
**Check:**
1. Server logs for SSH connection errors
2. Browser console for API errors
3. Connection credentials are correct
4. Server has proper Linux commands installed (df, grep, awk, etc.)

### Issue: Apps tab empty
**Check:**
1. Applications are actually installed on the server
2. Commands are in PATH
3. User has permission to run systemctl/service status

### Issue: CPU or Network shows 0%
**Check:**
1. Server is Linux (macOS/BSD have fallback commands but may not work perfectly)
2. /proc filesystem is available
3. Commands take 1 second to measure delta (network and CPU)

## File Locations

- Frontend: `/src/apps/ServerMonitorApp.js`
- Backend Metrics API: `/src/app/api/server-monitor/metrics/route.js`
- Backend Apps API: `/src/app/api/server-monitor/apps/route.js`
- SSH Helper: `/src/app/api/server-backup/_ssh.js`

## Next Steps

After verifying data fetching works:
1. Test with different servers (Ubuntu, Debian, CentOS, etc.)
2. Test with servers that have/don't have various apps installed
3. Monitor for performance issues with auto-refresh
4. Consider adding more metrics (swap, temperature, processes)
