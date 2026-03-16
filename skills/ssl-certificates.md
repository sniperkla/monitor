---
name: ssl-certificates
keywords: [ssl, tls, certificate, https, letsencrypt, certbot, openssl]
primary_keywords: [ssl, tls, certbot, let's encrypt, letsencrypt, certificate]
---

# SSL/TLS Certificate Management Skill

## Description
Expert at managing SSL/TLS certificates, including Let's Encrypt, self-signed, and commercial certificates.

## Detection
```bash
command -v certbot && certbot --version
command -v openssl && openssl version
```

## Let's Encrypt (Certbot)

### Install Certbot
- Debian/Ubuntu: `apt install certbot python3-certbot-nginx`
- RHEL/CentOS: `dnf install certbot python3-certbot-nginx`
- Alpine: `apk add certbot`

### Get Certificate
- Nginx auto: `certbot --nginx -d example.com -d www.example.com`
- Apache auto: `certbot --apache -d example.com`
- Standalone: `certbot certonly --standalone -d example.com`
- DNS challenge: `certbot certonly --dns-cloudflare -d example.com`

### Certificate Locations
- Cert: `/etc/letsencrypt/live/example.com/fullchain.pem`
- Key: `/etc/letsencrypt/live/example.com/privkey.pem`
- Chain: `/etc/letsencrypt/live/example.com/chain.pem`

### Renewal
- Dry run: `certbot renew --dry-run`
- Renew all: `certbot renew`
- Force renew: `certbot renew --force-renewal`

### Revoke
- Revoke: `certbot revoke --cert-path /etc/letsencrypt/live/example.com/cert.pem`

## OpenSSL Commands

### Generate Private Key
- RSA 2048: `openssl genrsa -out private.key 2048`
- RSA 4096: `openssl genrsa -out private.key 4096`
- ECC: `openssl ecparam -genkey -name prime256v1 -out private.key`

### Generate CSR
- New CSR: `openssl req -new -key private.key -out request.csr`
- With subject: `openssl req -new -key private.key -out request.csr -subj "/C=US/ST=State/L=City/O=Org/CN=example.com"`

### Self-Signed Certificate
- Quick: `openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes`
- With SAN: `openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=example.com" -addext "subjectAltName=DNS:example.com,DNS:www.example.com"`

### Check Certificate
- View cert: `openssl x509 -in cert.pem -text -noout`
- View CSR: `openssl req -in request.csr -text -noout`
- Check key: `openssl rsa -in private.key -check`
- Verify cert-key match: `openssl x509 -noout -modulus -in cert.pem | openssl md5; openssl rsa -noout -modulus -in private.key | openssl md5`
- Check expiration: `openssl x509 -in cert.pem -noout -dates`
- Check remote server: `openssl s_client -connect example.com:443 -servername example.com`

### Convert Formats
- PEM to DER: `openssl x509 -in cert.pem -outform DER -out cert.der`
- DER to PEM: `openssl x509 -in cert.der -inform DER -out cert.pem`
- PEM to PFX: `openssl pkcs12 -export -out cert.pfx -inkey private.key -in cert.pem`
- PFX to PEM: `openssl pkcs12 -in cert.pfx -out cert.pem -nodes`

## Nginx SSL Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
    
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}
```

## Common Issues
- Port 80 blocked: Check firewall allows port 80 for ACME challenge
- Rate limits: Let's Encrypt has rate limits (5 failures per hour per domain)
- Mixed content: Check all resources load over HTTPS
- Certificate chain: Use fullchain.pem, not cert.pem
