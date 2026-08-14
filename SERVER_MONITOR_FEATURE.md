# Server Monitor Dashboard - Implementation Summary

## Overview
Comprehensive real-time server monitoring dashboard with performance metrics, system information, and installed applications tracking.

## Features Implemented

### 1. Real-Time Performance Metrics
- **CPU Monitoring**
  - Current usage percentage
  - Number of cores
  - CPU model
  - Load average (1m, 5m, 15m)
  - Real-time usage chart with historical data (last 20 data points)
  - Trend indicators (up/down/stable)

- **Memory Monitoring**
  - Total, used, free memory
  - Usage percentage
  - Real-time usage chart
  - Color-coded status (green < 70%, amber < 90%, red >= 90%)

- **Disk Monitoring**
  - All mounted filesystems
  - Mount point, total, used, free space
  - Usage percentage with progress bars
  - Supports multiple disks/partitions

- **Network Monitoring**
  - Real-time download/upload rates (bytes/sec)
  - Total RX/TX bytes per interface
  - Dual-line chart showing both directions
  - Auto-scales to readable units (B, KB, MB, GB, TB)

### 2. System Information
- Hostname
- Operating system (with distribution details)
- Kernel version
- Architecture (x86_64, aarch64, etc.)
- System uptime (formatted as days/hours/minutes)
- Current load average

### 3. Installed Applications Detection
Automatically detects and displays:
- **Docker**
  - Version
  - Service status
  - Running/total container counts
  
- **Docker Compose**
  - Version (both standalone and plugin)

- **Nginx**
  - Version
  - Service status
  - Config file path

- **MongoDB**
  - Version
  - Service status

- **MySQL / MariaDB**
  - Version
  - Service status

- **PostgreSQL**
  - Version
  - Service status

- **Redis**
  - Version
  - Service status

- **Node.js & npm**
  - Versions

- **Python & pip**
  - Versions (python3 or python)

- **PHP**
  - Version

- **Java**
  - Version

- **Go**
  - Version

- **Rust**
  - Version

- **Git**
  - Version

- **rclone**
  - Version

### 4. UI Features
- Server selector dropdown
- Auto-refresh toggle (on/off)
- Manual refresh button
- Configurable refresh interval (default: 5 seconds)
- Tab navigation (Overview / Applications)
- Color-coded status indicators
- Responsive grid layout
- Error handling with user-friendly messages
- Loading states with spinners
- Trend indicators (↑↓−) for CPU/RAM changes

## Technical Implementation

### Frontend Component
**File:** `src/apps/ServerMonitorApp.js`

- Built with React hooks (useState, useEffect, useRef)
- Uses Chart.js with react-chartjs-2 for real-time charts
- Lucide icons for visual elements
- Maintains historical data for smooth chart animations
- Auto-refresh with cleanup on unmount
- Responsive design with Tailwind CSS

### Backend API Routes

#### 1. Metrics Endpoint
**File:** `src/app/api/server-monitor/metrics/route.js`

**Endpoint:** `GET /api/server-monitor/metrics?connectionId=<id>`

**Data Collection:**
- Executes a single optimized shell script via SSH
- Measures CPU usage with 1-second /proc/stat delta
- Parses /proc/meminfo for memory stats
- Uses `df -Pk` for disk information
- Samples /proc/net/dev twice (1 second apart) for network rates
- Reads system info from /proc and /etc/os-release

**Response Format:**
```json
{
  "success": true,
  "timestamp": "2026-08-14T14:50:00.000Z",
  "cpu": {
    "model": "Intel(R) Xeon(R) CPU",
    "cores": 4,
    "usage": 45.2,
    "loadAverage": [1.5, 1.2, 0.9]
  },
  "memory": {
    "total": 8589934592,
    "used": 4294967296,
    "free": 2147483648,
    "available": 3221225472,
    "usedPercent": 50.0
  },
  "disk": {
    "filesystems": [
      {
        "filesystem": "/dev/sda1",
        "mount": "/",
        "total": 107374182400,
        "used": 53687091200,
        "free": 53687091200,
        "usedPercent": 50.0
      }
    ]
  },
  "network": {
    "interfaces": [...],
    "rxRate": 1048576,
    "txRate": 524288,
    "rxTotal": 1073741824,
    "txTotal": 536870912
  },
  "system": {
    "hostname": "server01",
    "os": "Ubuntu 22.04.3 LTS",
    "kernel": "5.15.0-87-generic",
    "arch": "x86_64",
    "uptime": 864000
  }
}
```

#### 2. Applications Endpoint
**File:** `src/app/api/server-monitor/apps/route.js`

**Endpoint:** `GET /api/server-monitor/apps?connectionId=<id>`

**Detection Methods:**
- Checks `which <command>` for existence
- Runs `<command> --version` for version info
- Checks `systemctl status` for service status (with sudo fallback)
- Special handling for Docker (container counts)
- Handles both old and new Docker Compose commands

**Response Format:**
```json
{
  "success": true,
  "timestamp": "2026-08-14T14:50:00.000Z",
  "applications": [
    {
      "name": "docker",
      "installed": true,
      "version": "24.0.7",
      "status": "running",
      "containers": { "running": 5, "total": 8 }
    },
    {
      "name": "nginx",
      "installed": true,
      "version": "1.24.0",
      "status": "running",
      "path": "/usr/sbin/nginx",
      "config": "/etc/nginx/nginx.conf"
    }
  ],
  "installed": ["docker", "nginx", "mongodb", "node", "python"]
}
```

### Integration Points

1. **AppRegistry** (`src/apps/AppRegistry.js`)
   - Registered as 'server-monitor'
   - Uses Activity icon
   - Available for window restoration

2. **Taskbar** (`src/components/Desktop/Taskbar.js`)
   - Added to apps list
   - Can be pinned
   - Opens with 1300x800 window

3. **Desktop Environment** (`src/components/Desktop/DesktopEnvironment.js`)
   - Desktop icon available
   - Drag-and-drop enabled
   - Can be organized in folders

## Usage

1. **Open Server Monitor**
   - Click Activity icon in taskbar or desktop
   - Or search "Server Monitor" in Spotlight (⌘K)

2. **Select a Server**
   - Choose from dropdown at top-right
   - Only shows servers with SSH connections configured

3. **View Metrics**
   - Overview tab shows all real-time metrics
   - Auto-refreshes every 5 seconds by default
   - Charts show last 100 seconds of history (20 data points)

4. **View Applications**
   - Applications tab shows all detected software
   - Click refresh to re-scan
   - Shows version, status, and additional info

5. **Configure Refresh**
   - Toggle auto-refresh on/off
   - Click manual refresh button anytime
   - Interval is configurable in code (default: 5000ms)

## Performance Considerations

- **Single SSH Session per Request**: All commands run in one SSH connection
- **Optimized Shell Scripts**: Commands are combined to minimize latency
- **Historical Data Limit**: Only keeps last 20 data points per metric
- **Auto-cleanup**: Intervals cleared on component unmount
- **Dynamic Imports**: Heavy dependencies loaded only when needed

## Cross-Platform Support

- **Linux**: Full support for all metrics
- **macOS/BSD**: Fallback commands for CPU and memory
- **Service Detection**: Handles both systemd and non-systemd systems
- **Docker**: Works with both standalone Docker and rootless Docker

## Error Handling

- Connection failures shown with clear error messages
- Missing commands gracefully handled (marked as "not installed")
- SSH errors logged and displayed to user
- Timeout protection on all commands
- Sudo fallback for Docker when needed

## Future Enhancements

Potential additions:
- Process list with top consumers
- Historical data storage (database)
- Alert thresholds and notifications
- Docker container management
- Service start/stop controls
- Custom metric collection
- Multi-server comparison view
- Export metrics to CSV/JSON

## Color Coding

- **Green (< 70%)**: Healthy usage
- **Amber (70-90%)**: Warning level
- **Red (≥ 90%)**: Critical level
- **Indigo**: Active/focused items
- **Emerald**: Running services
- **Blue/Amber**: Network RX/TX

## Dependencies

- `chart.js` + `react-chartjs-2`: Real-time charts
- `lucide-react`: Icons
- `framer-motion`: Smooth animations
- `next-auth`: Authentication
- `ssh2`: SSH connections (existing)

All dependencies already present in the project.
