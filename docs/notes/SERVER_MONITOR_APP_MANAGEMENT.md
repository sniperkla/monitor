# Server Monitor - Application Management Feature

## Overview
The Server Monitor now includes application management capabilities, allowing you to control services directly from the dashboard without SSH access.

## Supported Actions

### 1. Start Service
- Starts a stopped service
- Uses `systemctl start` or `service start`
- Requires sudo permissions on the server
- Button appears when service status is "stopped"

### 2. Stop Service  
- Stops a running service
- Uses `systemctl stop` or `service stop`
- Requires sudo permissions
- Button appears when service status is "running"

### 3. Restart Service
- Restarts a running service (stop then start)
- Uses `systemctl restart` or `service restart`
- Useful after configuration changes
- Button appears when service status is "running"

### 4. Enable Service (Future)
- Enables service to start on boot
- Uses `systemctl enable`
- Only works with systemd-based systems

### 5. Disable Service (Future)
- Prevents service from starting on boot
- Uses `systemctl disable`
- Only works with systemd-based systems

### 6. Update Application (Future)
- Updates the application to latest version
- Uses appropriate package manager (apt, yum, dnf, pacman, brew)
- May require server restart depending on the application
- **WARNING: May cause downtime**

### 7. Uninstall Application (Future)
- Removes the application from the server
- Uses appropriate package manager
- **WARNING: Cannot be undone easily**

## Manageable Applications

Currently, the following applications support start/stop/restart actions:
- **Docker** (docker)
- **Nginx** (nginx)
- **MongoDB** (mongod)
- **MySQL / MariaDB** (mysql/mariadb)
- **PostgreSQL** (postgresql)
- **Redis** (redis-server)

## Requirements

### Server Requirements
1. **Sudo Access**: Most actions require sudo permissions
2. **Service Manager**: Either systemd or SysV init
3. **Passwordless Sudo** (recommended): Configure sudoers for seamless operation

### Configure Passwordless Sudo

For the SSH user, add to `/etc/sudoers` (use `visudo`):

```bash
# Allow specific services without password
youruser ALL=(ALL) NOPASSWD: /bin/systemctl start docker
youruser ALL=(ALL) NOPASSWD: /bin/systemctl stop docker
youruser ALL=(ALL) NOPASSWD: /bin/systemctl restart docker
youruser ALL=(ALL) NOPASSWD: /bin/systemctl status docker
youruser ALL=(ALL) NOPASSWD: /bin/systemctl start nginx
youruser ALL=(ALL) NOPASSWD: /bin/systemctl stop nginx
youruser ALL=(ALL) NOPASSWD: /bin/systemctl restart nginx
youruser ALL=(ALL) NOPASSWD: /bin/systemctl status nginx
# ... repeat for other services
```

Or for all systemctl commands (less secure):
```bash
youruser ALL=(ALL) NOPASSWD: /bin/systemctl *
youruser ALL=(ALL) NOPASSWD: /usr/bin/service *
```

## UI Components

### Application Card
Each installed application is displayed as a card showing:
- Application icon
- Name
- Version
- Installation path
- Status badge (running/stopped)
- Action buttons (Start/Stop/Restart)
- Result message after action

### Action Buttons
- **Green "Start"**: Appears when service is stopped
- **Red "Stop"**: Appears when service is running
- **Amber "Restart"**: Appears when service is running
- All buttons show loading state during execution
- Success/error messages appear below buttons

## API Endpoint

### POST `/api/server-monitor/app-action`

**Request Body:**
```json
{
  "connectionId": "507f1f77bcf86cd799439011",
  "appName": "nginx",
  "action": "restart"
}
```

**Response:**
```json
{
  "success": true,
  "action": "restart",
  "appName": "nginx",
  "output": "Restarted nginx.service",
  "exitCode": 0
}
```

**Supported Actions:**
- `start` - Start the service
- `stop` - Stop the service
- `restart` - Restart the service
- `status` - Check service status
- `enable` - Enable service on boot
- `disable` - Disable service on boot
- `update` - Update to latest version (requires package manager)
- `uninstall` - Remove application (requires package manager)

## Implementation Details

### Backend Logic
**File:** `/src/app/api/server-monitor/app-action/route.js`

1. **Service Name Mapping**: Maps friendly app names to actual service names
   ```javascript
   {
     'docker': 'docker',
     'nginx': 'nginx',
     'mongodb': 'mongod',
     'mysql': 'mysql',
     'postgresql': 'postgresql',
     'redis': 'redis-server'
   }
   ```

2. **Command Generation**: Dynamically generates shell commands based on:
   - Service manager (systemd vs SysV init)
   - Package manager (apt, yum, dnf, pacman, brew)
   - Sudo availability

3. **Fallback Strategy**: Tries multiple approaches:
   - `sudo systemctl` first
   - Falls back to `systemctl` without sudo
   - Falls back to `service` command
   - Falls back to package-specific commands

### Frontend Component
**File:** `/src/apps/ServerMonitorApp.js`

1. **AppCard Component**: Enhanced with:
   - Action button rendering based on status
   - Loading states during API calls
   - Success/error message display
   - Auto-refresh after successful action

2. **Action Handler**: 
   - Calls API endpoint
   - Shows loading spinner
   - Displays result
   - Refreshes app list after 1.5 seconds

## Security Considerations

### ⚠️ Important Warnings

1. **Sudo Access Required**: Most actions need sudo permissions
2. **Service Interruption**: Stop/restart actions cause downtime
3. **Data Loss Risk**: Uninstall can cause permanent data loss
4. **Update Risks**: Updates may introduce breaking changes
5. **Authentication**: All actions require valid SSH credentials

### Best Practices

1. **Test First**: Test actions on non-production servers
2. **Backup Data**: Always backup before uninstall or major updates
3. **Limited Sudo**: Use granular sudoers rules, not blanket NOPASSWD
4. **Audit Logs**: Monitor server logs for unauthorized actions
5. **User Permissions**: Restrict Server Monitor access to trusted users

## Troubleshooting

### "Permission denied"
- Check sudo configuration
- Verify SSH user has necessary permissions
- Try running command manually via SSH

### "Command not found"
- Service may not be installed
- Service name may be different on your system
- Check PATH environment variable

### Action fails but no error
- Check server logs (`journalctl -xe` or `/var/log/syslog`)
- Verify service dependencies are met
- Check for port conflicts

### "No supported package manager found"
- Update/uninstall requires package manager
- Manually specify commands if using custom package manager
- Consider using `snap`, `flatpak`, or `docker` instead

## Future Enhancements

Planned features:
- [ ] Batch actions (stop multiple services)
- [ ] Scheduled actions (restart at specific time)
- [ ] Action history and audit log
- [ ] Confirmation dialogs for destructive actions
- [ ] Service configuration editor
- [ ] Log viewer for each service
- [ ] Resource limits management
- [ ] Container management (for Docker)
- [ ] Package upgrade notifications
- [ ] Rollback capabilities

## Example Use Cases

### Scenario 1: Restart Nginx after Config Change
1. Open Server Monitor
2. Go to Applications tab
3. Find Nginx card
4. Click "Restart" button
5. Wait for success message
6. Verify service is running

### Scenario 2: Stop MongoDB for Maintenance
1. Open Server Monitor
2. Select target server
3. Go to Applications tab
4. Find MongoDB card
5. Click "Stop" button
6. Perform maintenance via SSH
7. Return to Server Monitor
8. Click "Start" button

### Scenario 3: Update All Services (Future)
1. Open Server Monitor
2. Applications tab shows update notifications
3. Review available updates
4. Click "Update All" or update individually
5. Wait for completion
6. Review changelog
7. Test services

## Related Documentation

- [SERVER_MONITOR_FEATURE.md](./SERVER_MONITOR_FEATURE.md) - Main feature documentation
- [SERVER_MONITOR_DEBUGGING.md](./SERVER_MONITOR_DEBUGGING.md) - Debugging guide
- [SSH Configuration](./skills/ssh.md) - SSH setup instructions

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify sudo configuration
3. Test commands manually via SSH
4. Check application-specific documentation
5. Review security policies and permissions
