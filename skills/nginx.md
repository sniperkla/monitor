---
name: nginx
keywords: [nginx, reverse proxy, upstream, ssl, https, certificate]
primary_keywords: [nginx, reverse proxy]
---

# Nginx Management Skill

## Description
Expert at configuring and managing Nginx web server and reverse proxy.

## Detection
```bash
command -v nginx && nginx -v
```

## Service Management
- Status: `systemctl status nginx`
- Start: `systemctl start nginx`
- Stop: `systemctl stop nginx`
- Restart: `systemctl restart nginx`
- Reload: `systemctl reload nginx` (graceful)
- Test config: `nginx -t`

## Configuration Locations
- Main config: `/etc/nginx/nginx.conf`
- Sites-available: `/etc/nginx/sites-available/`
- Sites-enabled: `/etc/nginx/sites-enabled/`
- Conf.d: `/etc/nginx/conf.d/`

## Common Configurations

### Reverse Proxy
```nginx
server {
    listen 80;
    server_name example.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Static Site
```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
}
```

### SSL with Let's Encrypt
```bash
# Install certbot
apt install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d example.com

# Auto-renewal test
certbot renew --dry-run
```

### Load Balancer
```nginx
upstream backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    location / {
        proxy_pass http://backend;
    }
}
```

## Debugging
- Test config: `nginx -t`
- Check error log: `tail -f /var/log/nginx/error.log`
- Check access log: `tail -f /var/log/nginx/access.log`
- Show compiled modules: `nginx -V 2>&1`
- Test specific config: `nginx -t -c /path/to/config`

## Performance Tuning
- Worker processes: `worker_processes auto;`
- Worker connections: `worker_connections 1024;`
- Enable gzip: `gzip on; gzip_types text/plain text/css application/json;`
- Cache: `proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m;`

## Common Issues
- Port 80 in use: Check with `ss -tlnp | grep :80`
- Permission denied: Check file permissions and SELinux
- Config error: Run `nginx -t` to find syntax errors
- 502 Bad Gateway: Backend not running or wrong port
