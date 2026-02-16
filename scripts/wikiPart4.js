module.exports = [
  // ─── INFRASTRUCTURE AS CODE ───
  { title:'Terraform Basics', category:'DevOps', os:['All Linux','macOS'],
    description:'Provision and manage cloud infrastructure with Terraform.',
    commands:[
      {label:'Install',code:'wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg\necho "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list\nsudo apt update && sudo apt install terraform -y',explanation:'Installs Terraform on Ubuntu.',result:''},
      {label:'Version',code:'terraform version',explanation:'Checks installed version.',result:'Terraform v1.7.0'},
      {label:'Sample main.tf',code:'provider "aws" {\n  region = "ap-southeast-1"\n}\n\nresource "aws_instance" "web" {\n  ami           = "ami-0abcdef1234567890"\n  instance_type = "t3.micro"\n  tags = {\n    Name = "my-server"\n  }\n}',explanation:'Example config to create an EC2 instance.',result:''},
      {label:'Init',code:'terraform init',explanation:'Initializes providers and downloads plugins.',result:'Terraform has been successfully initialized!'},
      {label:'Plan',code:'terraform plan',explanation:'Preview changes before applying.',result:'Plan: 1 to add, 0 to change, 0 to destroy.'},
      {label:'Apply',code:'terraform apply -auto-approve',explanation:'Creates/updates infrastructure.',result:'Apply complete! Resources: 1 added'},
      {label:'Destroy',code:'terraform destroy -auto-approve',explanation:'Tears down all managed resources.',result:'Destroy complete! Resources: 1 destroyed'}
    ], tags:['terraform','iac','cloud','devops','aws']
  },

  // ─── MONITORING STACK ───
  { title:'Prometheus Setup', category:'Monitoring', os:['All Linux'],
    description:'Install Prometheus for metrics collection and alerting.',
    commands:[
      {label:'Download',code:'wget https://github.com/prometheus/prometheus/releases/download/v2.48.1/prometheus-2.48.1.linux-amd64.tar.gz\ntar -xzf prometheus-*.tar.gz\nsudo mv prometheus-*/prometheus /usr/local/bin/\nsudo mv prometheus-*/promtool /usr/local/bin/',explanation:'Downloads and installs Prometheus binaries.',result:''},
      {label:'Config File',code:'# /etc/prometheus/prometheus.yml\nglobal:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: "node"\n    static_configs:\n      - targets: ["localhost:9100"]\n  - job_name: "myapp"\n    static_configs:\n      - targets: ["localhost:3000"]',explanation:'Configures Prometheus to scrape node exporter and your app.',result:''},
      {label:'Systemd Service',code:'[Unit]\nDescription=Prometheus\nAfter=network.target\n[Service]\nType=simple\nExecStart=/usr/local/bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus\n[Install]\nWantedBy=multi-user.target',explanation:'Service unit file for Prometheus.',result:''},
      {label:'Start',code:'sudo systemctl daemon-reload\nsudo systemctl enable --now prometheus',explanation:'Starts Prometheus on port 9090.',result:''},
      {label:'Node Exporter',code:'wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz\ntar -xzf node_exporter-*.tar.gz\nsudo mv node_exporter-*/node_exporter /usr/local/bin/\nnode_exporter &',explanation:'Installs node_exporter for system metrics on port 9100.',result:''}
    ], tags:['prometheus','monitoring','metrics','alerting']
  },
  { title:'Grafana Dashboard', category:'Monitoring', os:['All Linux'],
    description:'Install Grafana for beautiful metrics visualization dashboards.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install -y apt-transport-https software-properties-common\nwget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /usr/share/keyrings/grafana.gpg\necho "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list\nsudo apt update && sudo apt install grafana -y',explanation:'Installs Grafana from official repo.',result:''},
      {label:'Install (CentOS)',code:'sudo tee /etc/yum.repos.d/grafana.repo <<EOF\n[grafana]\nname=grafana\nbaseurl=https://rpm.grafana.com\nrepo_gpgcheck=1\nenabled=1\ngpgcheck=1\ngpgkey=https://rpm.grafana.com/gpg.key\nEOF\nsudo dnf install grafana -y',explanation:'Installs on CentOS.',result:''},
      {label:'Start',code:'sudo systemctl enable --now grafana-server',explanation:'Starts Grafana on port 3000.',result:''},
      {label:'Default Login',code:'# URL: http://your-server:3000\n# Username: admin\n# Password: admin (change on first login)',explanation:'Default credentials for Grafana web UI.',result:''},
      {label:'Add Prometheus',code:'# In Grafana UI:\n# Settings → Data Sources → Add → Prometheus\n# URL: http://localhost:9090\n# Click "Save & Test"',explanation:'Connects Grafana to Prometheus data.',result:''}
    ], tags:['grafana','monitoring','dashboard','visualization']
  },

  // ─── SSH ADVANCED ───
  { title:'SSH Tunnels & Port Forwarding', category:'Network', os:['All Linux','macOS'],
    description:'Create SSH tunnels for secure access to remote services.',
    commands:[
      {label:'Local Forward',code:'ssh -L 8080:localhost:3000 user@server',explanation:'Access remote port 3000 via local port 8080. Browse http://localhost:8080 to reach the remote app.',result:''},
      {label:'Remote Forward',code:'ssh -R 9090:localhost:3000 user@server',explanation:'Expose local port 3000 on the remote server as port 9090.',result:''},
      {label:'Dynamic (SOCKS)',code:'ssh -D 1080 user@server',explanation:'Creates a SOCKS5 proxy. Configure browser to use localhost:1080.',result:''},
      {label:'Jump Host',code:'ssh -J jumpuser@bastion user@internal-server',explanation:'Connects through a bastion/jump host to reach an internal server.',result:''},
      {label:'SSH Config',code:'# ~/.ssh/config\nHost myserver\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519\n\nHost internal\n  HostName 192.168.1.10\n  User admin\n  ProxyJump myserver',explanation:'Named SSH shortcuts with jump host support.',result:''},
      {label:'Keep Alive',code:'# In ~/.ssh/config\nHost *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3',explanation:'Prevents SSH timeout by sending keepalive packets.',result:''}
    ], tags:['ssh','tunnel','port-forwarding','proxy','bastion']
  },

  // ─── DATABASE REPLICATION ───
  { title:'MongoDB Replica Set', category:'Database', os:['All Linux'],
    description:'Set up MongoDB replication for high availability.',
    commands:[
      {label:'Config replSet',code:'# In /etc/mongod.conf add:\nreplication:\n  replSetName: "rs0"',explanation:'Enables replica set mode. Do this on all 3 nodes.',result:''},
      {label:'Restart',code:'sudo systemctl restart mongod',explanation:'Restart all MongoDB instances.',result:''},
      {label:'Init Replica',code:'mongosh --eval \'rs.initiate({\n  _id: "rs0",\n  members: [\n    {_id:0, host:"mongo1:27017"},\n    {_id:1, host:"mongo2:27017"},\n    {_id:2, host:"mongo3:27017"}\n  ]\n})\'',explanation:'Initializes the replica set with 3 members.',result:'{ "ok" : 1 }'},
      {label:'Check Status',code:'mongosh --eval "rs.status()"',explanation:'Shows replica set status and which node is PRIMARY.',result:''},
      {label:'Connection String',code:'mongodb://mongo1:27017,mongo2:27017,mongo3:27017/mydb?replicaSet=rs0',explanation:'Use this connection string in your app for automatic failover.',result:''}
    ], tags:['mongodb','replica','ha','failover']
  },
  { title:'MySQL Replication', category:'Database', os:['All Linux'],
    description:'Set up MySQL primary-replica replication.',
    commands:[
      {label:'Primary Config',code:'# /etc/mysql/mysql.conf.d/mysqld.cnf\n[mysqld]\nserver-id = 1\nlog_bin = /var/log/mysql/mysql-bin.log\nbinlog_do_db = myapp',explanation:'Enables binary logging on primary server.',result:''},
      {label:'Create Repl User',code:"CREATE USER 'repl'@'%' IDENTIFIED BY 'replpass';\nGRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';\nFLUSH PRIVILEGES;\nSHOW MASTER STATUS;",explanation:'Creates replication user and shows binlog position.',result:'File: mysql-bin.000001, Position: 154'},
      {label:'Replica Config',code:'# On replica server:\n[mysqld]\nserver-id = 2\nrelay-log = /var/log/mysql/mysql-relay-bin.log',explanation:'Configures the replica server.',result:''},
      {label:'Start Replication',code:"CHANGE MASTER TO\n  MASTER_HOST='10.0.0.1',\n  MASTER_USER='repl',\n  MASTER_PASSWORD='replpass',\n  MASTER_LOG_FILE='mysql-bin.000001',\n  MASTER_LOG_POS=154;\nSTART SLAVE;",explanation:'Points replica to primary and starts replication.',result:''},
      {label:'Check Status',code:'SHOW SLAVE STATUS\\G',explanation:'Verify replication is running (Slave_IO_Running: Yes).',result:'Slave_IO_Running: Yes\nSlave_SQL_Running: Yes'}
    ], tags:['mysql','replication','ha','primary-replica']
  },

  // ─── CADDY WEB SERVER ───
  { title:'Caddy Web Server', category:'Web Server', os:['All Linux'],
    description:'Modern web server with automatic HTTPS. Zero-config SSL.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https\ncurl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg\ncurl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list\nsudo apt update && sudo apt install caddy -y',explanation:'Installs Caddy from official repo.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install "dnf-command(copr)" -y\nsudo dnf copr enable @caddy/caddy -y\nsudo dnf install caddy -y',explanation:'Installs on CentOS via COPR.',result:''},
      {label:'Caddyfile',code:'# /etc/caddy/Caddyfile\nexample.com {\n  reverse_proxy localhost:3000\n}\n\napi.example.com {\n  reverse_proxy localhost:8080\n}',explanation:'Minimal config — Caddy auto-obtains SSL certificates!',result:''},
      {label:'Reload',code:'sudo systemctl reload caddy',explanation:'Applies config changes.',result:''},
      {label:'Logs',code:'journalctl -u caddy -f',explanation:'Follow Caddy logs.',result:''}
    ], tags:['caddy','webserver','auto-ssl','proxy']
  },

  // ─── IPTABLES ───
  { title:'iptables Rules', category:'Security', os:['All Linux'],
    description:'Low-level firewall rules using iptables (advanced).',
    commands:[
      {label:'List Rules',code:'sudo iptables -L -n --line-numbers',explanation:'Shows all current rules.',result:'Chain INPUT (policy ACCEPT)\nnum  target  prot  source  destination'},
      {label:'Allow SSH',code:'sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT',explanation:'Allows incoming SSH.',result:''},
      {label:'Allow HTTP/S',code:'sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT\nsudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT',explanation:'Allows web traffic.',result:''},
      {label:'Drop All',code:'sudo iptables -A INPUT -j DROP',explanation:'Drops everything else (add AFTER allow rules!).',result:''},
      {label:'Save Rules',code:'sudo iptables-save | sudo tee /etc/iptables.rules',explanation:'Persists rules to a file.',result:''},
      {label:'Restore',code:'sudo iptables-restore < /etc/iptables.rules',explanation:'Loads saved rules.',result:''},
      {label:'Flush All',code:'sudo iptables -F',explanation:'Removes all rules (resets to default).',result:''}
    ], tags:['iptables','firewall','security','advanced']
  },

  // ─── MAIL ───
  { title:'Postfix Mail Server', category:'Installation', os:['All Linux'],
    description:'Set up Postfix to send emails from your server (SMTP relay).',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install postfix mailutils -y',explanation:'Installs Postfix. Choose "Internet Site" during setup.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install postfix mailx -y',explanation:'Installs Postfix on CentOS.',result:''},
      {label:'Gmail Relay',code:'# /etc/postfix/main.cf\nrelayhost = [smtp.gmail.com]:587\nsmtp_sasl_auth_enable = yes\nsmtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd\nsmtp_sasl_security_options = noanonymous\nsmtp_tls_security_level = encrypt',explanation:'Configures Postfix to relay through Gmail SMTP.',result:''},
      {label:'Set Credentials',code:'echo "[smtp.gmail.com]:587 user@gmail.com:app_password" | sudo tee /etc/postfix/sasl_passwd\nsudo postmap /etc/postfix/sasl_passwd\nsudo chmod 600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db',explanation:'Stores Gmail credentials securely.',result:''},
      {label:'Restart',code:'sudo systemctl restart postfix',explanation:'Applies changes.',result:''},
      {label:'Test Send',code:'echo "Test body" | mail -s "Test Subject" recipient@example.com',explanation:'Sends a test email.',result:''}
    ], tags:['postfix','email','smtp','mail']
  },

  // ─── NGINX SECURITY ───
  { title:'Nginx Security Headers', category:'Web Server', os:['All Linux'],
    description:'Harden Nginx with security headers and rate limiting.',
    commands:[
      {label:'Security Headers',code:'# In server block:\nadd_header X-Frame-Options "SAMEORIGIN" always;\nadd_header X-Content-Type-Options "nosniff" always;\nadd_header X-XSS-Protection "1; mode=block" always;\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\nadd_header Content-Security-Policy "default-src \'self\'" always;\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',explanation:'Adds all recommended security headers.',result:''},
      {label:'Rate Limiting',code:'# In http block:\nlimit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;\n\n# In location block:\nlocation /api/ {\n  limit_req zone=api burst=20 nodelay;\n  proxy_pass http://backend;\n}',explanation:'Limits API to 10 requests/second per IP with burst of 20.',result:''},
      {label:'Block Bad Bots',code:'# In server block:\nif ($http_user_agent ~* (bot|crawler|spider|scraper)) {\n  return 403;\n}',explanation:'Returns 403 for common bot user agents.',result:''},
      {label:'Disable Tokens',code:'server_tokens off;',explanation:'Hides Nginx version in response headers.',result:''},
      {label:'Gzip Compression',code:'gzip on;\ngzip_types text/plain text/css application/json application/javascript text/xml;\ngzip_min_length 1000;\ngzip_comp_level 5;',explanation:'Enables compression for faster page loads.',result:''}
    ], tags:['nginx','security','headers','rate-limit','hardening']
  },

  // ─── SAMBA ───
  { title:'Samba File Sharing', category:'Network', os:['All Linux'],
    description:'Share files between Linux and Windows using Samba (SMB/CIFS).',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install samba -y',explanation:'Installs Samba server.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install samba samba-common -y',explanation:'Installs Samba on CentOS.',result:''},
      {label:'Add Share',code:'# /etc/samba/smb.conf\n[shared]\n  path = /srv/shared\n  browsable = yes\n  writable = yes\n  guest ok = no\n  valid users = deploy',explanation:'Creates a password-protected share.',result:''},
      {label:'Set Password',code:'sudo smbpasswd -a deploy',explanation:'Sets SMB password for user.',result:'New SMB password:'},
      {label:'Start',code:'sudo systemctl enable --now smbd  # Ubuntu\nsudo systemctl enable --now smb   # CentOS',explanation:'Starts Samba service.',result:''},
      {label:'Windows Connect',code:'# In Windows Explorer:\n\\\\server-ip\\shared',explanation:'Connect from Windows using UNC path.',result:''}
    ], tags:['samba','smb','file-sharing','windows','cifs']
  },

  // ─── SYSTEMD TIMERS ───
  { title:'Systemd Timers', category:'System', os:['All Linux'],
    description:'Modern alternative to cron using systemd timers.',
    commands:[
      {label:'Timer Unit',code:'# /etc/systemd/system/backup.timer\n[Unit]\nDescription=Daily Backup Timer\n[Timer]\nOnCalendar=*-*-* 02:00:00\nPersistent=true\n[Install]\nWantedBy=timers.target',explanation:'Runs daily at 2 AM. Persistent=true catches up if missed.',result:''},
      {label:'Service Unit',code:'# /etc/systemd/system/backup.service\n[Unit]\nDescription=Backup Job\n[Service]\nType=oneshot\nExecStart=/opt/scripts/backup.sh',explanation:'The actual job that the timer triggers.',result:''},
      {label:'Enable Timer',code:'sudo systemctl daemon-reload\nsudo systemctl enable --now backup.timer',explanation:'Activates the timer.',result:''},
      {label:'List Timers',code:'systemctl list-timers --all',explanation:'Shows all active timers and when they fire next.',result:'NEXT                        LEFT    UNIT\nSun 2026-02-16 02:00:00 UTC 22h     backup.timer'},
      {label:'Check Logs',code:'journalctl -u backup.service',explanation:'View logs from the timer-triggered service.',result:''}
    ], tags:['systemd','timer','cron','schedule']
  },

  // ─── CERTBOT WILDCARD ───
  { title:'Wildcard SSL Certificate', category:'Security', os:['All Linux'],
    description:'Obtain wildcard SSL certificates with DNS challenge.',
    commands:[
      {label:'Install Certbot',code:'sudo apt install certbot -y  # Ubuntu\nsudo dnf install certbot -y  # CentOS',explanation:'Installs Certbot.',result:''},
      {label:'Wildcard Cert',code:'sudo certbot certonly --manual --preferred-challenges dns -d "*.example.com" -d "example.com"',explanation:'Requests wildcard cert. You must add a DNS TXT record.',result:'Please deploy a DNS TXT record:\n_acme-challenge.example.com\nValue: xxxxxxxx'},
      {label:'Verify DNS',code:'dig _acme-challenge.example.com TXT +short',explanation:'Verify the TXT record was added before continuing.',result:'"xxxxxxxx"'},
      {label:'Cert Location',code:'sudo ls /etc/letsencrypt/live/example.com/',explanation:'Shows certificate files after issuance.',result:'cert.pem  chain.pem  fullchain.pem  privkey.pem'},
      {label:'Auto-Renew',code:'# Wildcard with DNS challenge needs a plugin:\nsudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/.secrets/cloudflare.ini -d "*.example.com"',explanation:'Automates renewal with Cloudflare DNS plugin.',result:''}
    ], tags:['ssl','wildcard','certbot','dns-challenge']
  }
];
