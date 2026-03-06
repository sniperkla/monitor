---
name: nginx-fail-recovery
description: Diagnose and fix Nginx service failures, config errors, permission issues, port conflicts, and restart loops on Linux
tags: [nginx, systemctl, service, recovery, troubleshooting]
---

# Nginx Failure Recovery Playbook

> **GOLDEN RULE**: NEVER retry `systemctl restart nginx` without first reading the journal.
> Blind restarts = infinite loop. Read → Diagnose → Fix → Restart.

---

## Step 0 — Quick Triage (always run this first)

```bash
# 1. What did systemctl say?
systemctl status nginx.service --no-pager -l

# 2. What does the journal say? (most detailed)
journalctl -xeu nginx.service -n 80 --no-pager

# 3. What does nginx itself say?
nginx -t 2>&1
```

Read the output carefully before doing anything else.

---

## Failure Class 1 — Config Syntax Error

**Symptoms in journal/status:**
- `nginx: [emerg] unexpected "}" in /etc/nginx/nginx.conf:42`
- `nginx: configuration file /etc/nginx/nginx.conf test failed`
- `nginx: [emerg] directive "..." is not terminated by ";"`

**Fix:**
```bash
# Find the exact error line
nginx -t 2>&1

# Edit the reported file and line
nano /etc/nginx/nginx.conf
# — or —
nano /etc/nginx/conf.d/default.conf

# Re-test after edit
nginx -t && systemctl restart nginx
```

**Common config mistakes:**
- Missing `;` at end of directive
- Mismatched `{}` braces
- Typo in directive name (`serever_name` instead of `server_name`)
- Duplicate `server_name` or `listen` blocks

---

## Failure Class 2 — Permission / Cannot Open Error Log

**Symptoms in journal:**
- `nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)`
- `open() "/run/nginx.pid" failed (13: Permission denied)`

**Fix:**
```bash
# Check who owns the log and pid dirs
ls -ld /var/log/nginx /run/nginx.pid 2>/dev/null

# Fix log directory ownership
sudo chown -R nginx:nginx /var/log/nginx
sudo chmod 755 /var/log/nginx

# Fix pid file location (if wrong)
# Check what nginx.conf says:
grep -E 'pid|error_log|user' /etc/nginx/nginx.conf

# If /run/nginx.pid is the issue:
sudo mkdir -p /run/nginx
sudo chown nginx:nginx /run/nginx

# On SELinux systems (RHEL/CentOS/Amazon Linux):
# Check SELinux denials
sudo ausearch -m avc -ts recent 2>/dev/null | grep nginx
# Restore default contexts
sudo restorecon -Rv /var/log/nginx /etc/nginx /run/nginx.pid 2>/dev/null
```

---

## Failure Class 3 — Port Already in Use

**Symptoms in journal:**
- `nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)`
- `nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address already in use)`

**Fix:**
```bash
# Find what is using the port
sudo ss -tlnp | grep ':80\|:443'
# — or —
sudo lsof -i :80
sudo lsof -i :443

# If it's an old nginx master still running:
sudo pkill -f nginx
sleep 2
sudo systemctl start nginx

# If it's another process (apache2, node, etc.), either:
# a) Stop that process
sudo systemctl stop apache2
# b) Change nginx listen port in config
nano /etc/nginx/conf.d/default.conf  # change listen 80 → listen 8080

nginx -t && sudo systemctl restart nginx
```

---

## Failure Class 4 — Worker Process Runs as Wrong User

**Symptoms in journal:**
- `[warn] the "user" directive makes sense only if the master process runs with super-user privileges`
- `(13: Permission denied) while connecting to upstream`

**Fix:**
```bash
# See current user directive
grep '^user' /etc/nginx/nginx.conf

# If running without root, comment out the user directive
sudo sed -i 's/^user /#user /' /etc/nginx/nginx.conf

# Or set it to the actual running user
whoami  # note the username
sudo nano /etc/nginx/nginx.conf
# Change: user nginx; → user ec2-user;  (or whatever your username is)

nginx -t && sudo systemctl restart nginx
```

---

## Failure Class 5 — Upstream / Backend Not Running (502 Bad Gateway)

**Symptoms:**
- Browser shows `502 Bad Gateway`
- `connect() failed (111: Connection refused) while connecting to upstream`

**Fix:**
```bash
# Check what's on the expected backend port
sudo ss -tlnp | grep '3000\|8080\|5000'

# Check if the app process is running
ps aux | grep -E 'node|python|ruby|gunicorn|pm2'

# Start the backend app
pm2 start ecosystem.config.js
# — or —
systemctl start myapp

# Verify nginx proxy_pass matches the port the app is listening on
grep proxy_pass /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null
```

---

## Failure Class 6 — Missing Include File or Module

**Symptoms in journal:**
- `nginx: [emerg] open() "/etc/nginx/sites-enabled/default" failed`
- `nginx: [emerg] unknown directive "..." in /etc/nginx/nginx.conf`

**Fix:**
```bash
# Check what files are being included
grep -r 'include' /etc/nginx/nginx.conf

# List what actually exists
ls /etc/nginx/sites-enabled/ 2>/dev/null
ls /etc/nginx/conf.d/ 2>/dev/null

# If sites-enabled is missing but sites-available exists, create symlink
sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# If the include path doesn't exist, create it or remove the include line
sudo mkdir -p /etc/nginx/sites-enabled
nginx -t && sudo systemctl restart nginx
```

---

## Failure Class 7 — Nginx Not Installed / Command Not Found

**Symptoms:**
- `bash: nginx: command not found`
- `Unit nginx.service could not be found`

**Fix:**
```bash
# Detect distro and install
cat /etc/os-release | grep -E '^ID='

# Amazon Linux 2023 / RHEL / CentOS:
sudo dnf install -y nginx

# Ubuntu / Debian:
sudo apt-get update && sudo apt-get install -y nginx

# Enable and start on boot
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Full Reset (last resort — wipe and reinstall nginx config)

Only do this if config is completely broken and you want a clean slate:

```bash
# Backup existing config
sudo cp -r /etc/nginx /etc/nginx.bak.$(date +%s)

# Reinstall nginx (keeps service, replaces default config)
# Amazon Linux / RHEL:
sudo dnf reinstall -y nginx

# Ubuntu:
sudo apt-get install --reinstall nginx

# Restore a minimal working config
sudo tee /etc/nginx/conf.d/default.conf > /dev/null <<'EOF'
server {
    listen 80 default_server;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

nginx -t && sudo systemctl restart nginx
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/
```

---

## Quick Reference — Most Common Commands

| Task | Command |
|---|---|
| Test config | `nginx -t` |
| View journal (best logs) | `journalctl -xeu nginx.service -n 80 --no-pager` |
| View service status | `systemctl status nginx --no-pager -l` |
| View error log live | `tail -f /var/log/nginx/error.log` |
| Reload without downtime | `systemctl reload nginx` |
| Full restart | `systemctl restart nginx` |
| Check port 80 usage | `ss -tlnp \| grep :80` |
| Check nginx process | `ps aux \| grep nginx` |
| Check SELinux denials | `ausearch -m avc -ts recent 2>/dev/null \| grep nginx` |
