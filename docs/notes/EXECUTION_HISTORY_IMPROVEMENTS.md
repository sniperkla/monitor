# MongoBackupApp Execution History Improvements

## Changes Made

### 1. ✅ Collapsible Execution Logs

Each SSH cron execution log can now be collapsed/expanded individually.

**Features:**
- Click the chevron icon (▼/►) to toggle each job's log
- Default state: **Expanded** (logs visible)
- State persists per job during the session
- Independent collapse for each job

**UI Changes:**
- Added chevron button to the left of each job header
- Chevron rotates 90° when collapsed
- Smooth transition animation

### 2. ✅ Live Auto-Refresh

Execution history now updates automatically without manual refresh.

**How it works:**
- **Polling interval:** Every 10 seconds
- **Smart activation:** Only polls when on the History tab (saves resources)
- **Auto-stop:** Stops polling when you switch to another tab
- **Initial fetch:** Immediately fetches on tab open

**What updates live:**
- Manual run history (in-app executions)
- SSH cron logs (from remote servers)
- Last run timestamps
- Success/error status

### 3. State Management

Added new state variable:
```javascript
const [cronLogExpanded, setCronLogExpanded] = useState({});
// { [jobId]: bool } - tracks collapse state per job
```

### 4. Auto-Refresh Implementation

```javascript
useEffect(() => {
  if (activeSubTab !== 'history') return;
  
  // Initial fetch
  fetchHistory();
  fetchAllCronLogs();
  
  // Set up 10-second polling
  const interval = setInterval(() => {
    fetchHistory();
    fetchAllCronLogs();
  }, 10000);
  
  return () => clearInterval(interval); // Cleanup
}, [activeSubTab]);
```

## User Experience

**Before:**
- All logs always visible (cluttered)
- Need manual refresh to see new executions
- No indication of updates

**After:**
- Clean, collapsible interface
- Live updates every 10 seconds
- Can expand only the jobs you care about
- See new backups appear automatically

## Usage

### Collapse/Expand Logs
Click the **▼** chevron icon next to any job name to collapse its log.
Click again to expand.

### Live Updates
Just stay on the History tab - updates happen automatically every 10 seconds.
You'll see:
- New backup executions appear
- Status changes (running → success/error)
- Updated log output
- Latest timestamps

### Stop Live Updates
Switch to any other tab (Backup, Restore, Schedule) and polling stops automatically.

## Performance

- **Efficient:** Only polls when viewing History tab
- **Lightweight:** Fetches compact data (not full logs)
- **Resource-friendly:** 10-second interval prevents server spam
- **Clean cleanup:** Properly cancels interval on unmount

## Files Modified

- `src/apps/MongoBackupApp.js`
  - Added `cronLogExpanded` state
  - Added auto-refresh `useEffect`
  - Added chevron button to log headers
  - Added conditional render for log content
