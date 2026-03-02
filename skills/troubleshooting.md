# System Troubleshooting Skill

## Description
Expert at diagnosing and fixing Linux system issues.

## Initial Diagnosis Workflow
Always start with these commands to understand the situation:
```bash
# System overview
uptime && free -h && df -h

# Check for errors
dmesg | tail -30
journalctl -p err -n 30 --no-pager

# Running processes
ps auxf --sort=-%mem | head -20
ps auxf --sort=-%cpu | head -20
```

## Performance Issues

### High CPU Usage
- Top processes: `top -b -n1 | head -20`
- CPU by process: `ps aux --sort=-%cpu | head -10`
- Load average: `cat /proc/loadavg`
- CPU info: `lscpu`
- Find CPU hogs: `pidstat -u 1 5`

### High Memory Usage
- Memory info: `free -h`
- Top memory: `ps aux --sort=-%mem | head -10`
- Detailed: `cat /proc/meminfo`
- Find memory leak: `valgrind --leak-check=full program`
- Check swap: `swapon --show`

### High Disk I/O
- Disk usage: `df -hT`
- Directory sizes: `du -sh /* 2>/dev/null | sort -rh | head -10`
- I/O stats: `iostat -x 1 5`
- Find large files: `find / -type f -size +100M 2>/dev/null | head -20`
- Find deleted but open files: `lsof +L1`
- Disk health: `smartctl -a /dev/sda`

### Network Issues
- Connectivity: `ping -c 4 google.com`
- DNS: `dig google.com` or `nslookup google.com`
- Open ports: `ss -tlnp`
- Connections: `ss -tupn`
- Network stats: `netstat -s`
- Packet capture: `tcpdump -i eth0 -n port 80`
- Bandwidth: `iftop` or `nload`
- Latency: `mtr google.com`

## Service Issues

### Service Won't Start
```bash
# Check status
systemctl status SERVICE -l

# Check logs
journalctl -u SERVICE -n 50 --no-pager

# Check config (if applicable)
nginx -t  # for nginx
apachectl configtest  # for apache
sshd -t  # for ssh

# Check dependencies
systemctl list-dependencies SERVICE

# Check if port is in use
ss -tlnp | grep :PORT
```

### Service Keeps Crashing
```bash
# Recent crashes
journalctl -u SERVICE --since "1 hour ago"

# Core dumps
coredumpctl list
coredumpctl info PID

# Check OOM killer
dmesg | grep -i "out of memory"
grep -i "oom" /var/log/syslog
```

## Permission Issues
- Check ownership: `ls -la FILE`
- Check permissions: `stat FILE`
- Current user: `id`
- Fix ownership: `chown -R user:group /path`
- Fix permissions: `chmod -R 755 /path`
- Check SELinux: `getenforce` and `ls -Z`
- Check ACL: `getfacl FILE`

## Boot Issues
- Boot time: `systemd-analyze time`
- Slow boot: `systemd-analyze blame | head -20`
- Critical chain: `systemd-analyze critical-chain`
- Failed services: `systemctl list-units --state=failed`
- Boot logs: `journalctl -b`

## Common Error Patterns

### "No space left on device"
```bash
df -h
du -sh /* 2>/dev/null | sort -rh | head -10
# Clean package cache
apt clean || dnf clean all
# Clean journal
journalctl --vacuum-size=100M
# Clean old kernels
apt autoremove || dnf autoremove
```

### "Too many open files"
```bash
# Check limits
ulimit -a
# Check open files
lsof | wc -l
# Check per process
lsof -p PID | wc -l
# Increase limit
ulimit -n 65535
```

### "Connection refused"
```bash
# Check if service running
systemctl status SERVICE
# Check port binding
ss -tlnp | grep :PORT
# Check firewall
iptables -L -n || firewall-cmd --list-all || ufw status
# Check from outside
nc -zv HOST PORT
```

### "Permission denied"
```bash
# Check file permissions
ls -la FILE
# Check user
id
# Try with sudo
sudo COMMAND
# Check SELinux/AppArmor
getenforce || aa-status
```

## System Repair

### Fix Broken Packages
- Debian/Ubuntu: `dpkg --configure -a && apt --fix-broken install`
- RHEL/CentOS: `dnf clean all && dnf check`

### Reset Service
```bash
systemctl stop SERVICE
systemctl reset-failed SERVICE
systemctl start SERVICE
```

### Emergency Shell
- At boot: Add `init=/bin/bash` to kernel params
- Single user: Add `single` or `1` to kernel params
