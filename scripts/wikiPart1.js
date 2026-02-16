module.exports = [
  // ─── PACKAGE MANAGEMENT ───
  { title:'APT Package Manager', category:'System', os:['Ubuntu/Debian'],
    description:'Manage software packages on Debian-based systems using APT.',
    commands:[
      {label:'Update',code:'sudo apt update',explanation:'Refreshes the list of available packages from repositories.',result:'Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\nReading package lists... Done'},
      {label:'Upgrade All',code:'sudo apt upgrade -y',explanation:'Upgrades all installed packages to their latest version.',result:'Calculating upgrade... Done\n0 upgraded, 0 newly installed'},
      {label:'Full Upgrade',code:'sudo apt full-upgrade -y',explanation:'Like upgrade but also handles changing dependencies with new versions.',result:''},
      {label:'Install',code:'sudo apt install nginx curl git -y',explanation:'Install one or more packages. -y auto-confirms.',result:'Setting up nginx...'},
      {label:'Remove',code:'sudo apt remove package_name',explanation:'Removes a package but keeps configuration files.',result:''},
      {label:'Purge',code:'sudo apt purge package_name && sudo apt autoremove',explanation:'Removes package AND configs, then cleans unused dependencies.',result:''},
      {label:'Search',code:'apt search keyword',explanation:'Search for packages matching keyword.',result:''},
      {label:'Show Info',code:'apt show nginx',explanation:'Display detailed package information.',result:'Package: nginx\nVersion: 1.18.0\nDescription: ...'}
    ], tags:['apt','dpkg','debian','ubuntu','package']
  },
  { title:'DNF/YUM Package Manager', category:'System', os:['CentOS/RHEL'],
    description:'Manage software packages on RHEL-based systems (CentOS, Rocky, AlmaLinux, Fedora).',
    commands:[
      {label:'Update All',code:'sudo dnf update -y',explanation:'Updates the system and all installed packages.',result:'Complete!'},
      {label:'Install',code:'sudo dnf install nginx curl git -y',explanation:'Install packages.',result:''},
      {label:'Remove',code:'sudo dnf remove package_name',explanation:'Uninstalls a package.',result:''},
      {label:'Search',code:'dnf search keyword',explanation:'Search for packages.',result:''},
      {label:'Info',code:'dnf info nginx',explanation:'Show detailed package information.',result:'Name : nginx\nVersion : 1.20.1\nRepo : epel'},
      {label:'List Installed',code:'dnf list installed',explanation:'Shows all installed packages.',result:''},
      {label:'Add EPEL Repo',code:'sudo dnf install epel-release -y',explanation:'Enables the Extra Packages for Enterprise Linux repository (required for many tools).',result:''},
      {label:'Clean Cache',code:'sudo dnf clean all',explanation:'Clears cached package data to fix repo issues.',result:''}
    ], tags:['dnf','yum','rpm','centos','rhel','package']
  },

  // ─── NGINX ───
  { title:'Nginx Setup (Ubuntu/Debian)', category:'Web Server', os:['Ubuntu/Debian'],
    description:'Complete Nginx installation, configuration, and management on Ubuntu/Debian.',
    commands:[
      {label:'Install',code:'sudo apt update && sudo apt install nginx -y',explanation:'Installs Nginx web server.',result:'Setting up nginx (1.18.0)...'},
      {label:'Start & Enable',code:'sudo systemctl enable --now nginx',explanation:'Starts Nginx and ensures it starts on boot.',result:''},
      {label:'Check Status',code:'sudo systemctl status nginx',explanation:'Verify the service is running.',result:'● nginx.service - A high performance web server\n   Active: active (running)'},
      {label:'Test Config',code:'sudo nginx -t',explanation:'Validates Nginx configuration syntax before reloading.',result:'nginx: configuration file /etc/nginx/nginx.conf test is successful'},
      {label:'Reload',code:'sudo systemctl reload nginx',explanation:'Reloads configuration without dropping connections.',result:''},
      {label:'Create Site',code:'sudo nano /etc/nginx/sites-available/myapp',explanation:'Create a new virtual host configuration file.',result:''},
      {label:'Enable Site',code:'sudo ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/',explanation:'Enables the site by creating a symlink.',result:''},
      {label:'Disable Default',code:'sudo rm /etc/nginx/sites-enabled/default',explanation:'Removes the default welcome page.',result:''},
      {label:'View Error Log',code:'sudo tail -f /var/log/nginx/error.log',explanation:'Stream error logs in real-time for debugging.',result:''},
      {label:'View Access Log',code:'sudo tail -f /var/log/nginx/access.log',explanation:'Stream access logs.',result:'192.168.1.1 - - "GET / HTTP/1.1" 200'}
    ], tags:['nginx','webserver','proxy','ubuntu']
  },
  { title:'Nginx Setup (CentOS/RHEL)', category:'Web Server', os:['CentOS/RHEL'],
    description:'Install and configure Nginx on CentOS, RHEL, Rocky, or AlmaLinux.',
    commands:[
      {label:'Install EPEL',code:'sudo dnf install epel-release -y',explanation:'Nginx is available in the EPEL repository.',result:''},
      {label:'Install Nginx',code:'sudo dnf install nginx -y',explanation:'Installs Nginx.',result:'Complete!'},
      {label:'Start & Enable',code:'sudo systemctl enable --now nginx',explanation:'Starts and enables on boot.',result:''},
      {label:'Open Firewall',code:'sudo firewall-cmd --permanent --add-service={http,https}\nsudo firewall-cmd --reload',explanation:'Opens ports 80 and 443 in firewalld.',result:'success'},
      {label:'SELinux Proxy',code:'sudo setsebool -P httpd_can_network_connect 1',explanation:'Allows Nginx to proxy to backend apps (required by SELinux).',result:''},
      {label:'Config Path',code:'sudo nano /etc/nginx/conf.d/myapp.conf',explanation:'CentOS uses conf.d directory instead of sites-available.',result:''},
      {label:'Test & Reload',code:'sudo nginx -t && sudo systemctl reload nginx',explanation:'Validate config then reload.',result:''}
    ], tags:['nginx','webserver','centos','rhel']
  },
  { title:'Nginx Reverse Proxy Config', category:'Web Server', os:['All Linux'],
    description:'Configure Nginx as a reverse proxy for any backend application with WebSocket support.',
    commands:[
      {label:'Basic Proxy',code:'server {\n  listen 80;\n  server_name example.com;\n\n  location / {\n    proxy_pass http://127.0.0.1:3000;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n  }\n}',explanation:'Full reverse proxy with WebSocket support and real IP forwarding.',result:''},
      {label:'With SSL',code:'server {\n  listen 443 ssl http2;\n  server_name example.com;\n  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;\n  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;\n\n  location / {\n    proxy_pass http://127.0.0.1:3000;\n    proxy_set_header Host $host;\n  }\n}\nserver {\n  listen 80;\n  server_name example.com;\n  return 301 https://$host$request_uri;\n}',explanation:'HTTPS proxy with HTTP-to-HTTPS redirect.',result:''},
      {label:'Load Balancer',code:'upstream backend {\n  least_conn;\n  server 10.0.0.1:3000;\n  server 10.0.0.2:3000;\n  server 10.0.0.3:3000 backup;\n}\nserver {\n  listen 80;\n  location / {\n    proxy_pass http://backend;\n  }\n}',explanation:'Distributes traffic across multiple servers. least_conn sends to server with fewest active connections.',result:''}
    ], tags:['nginx','proxy','loadbalancer','ssl','websocket']
  },

  // ─── APACHE ───
  { title:'Apache Setup (Ubuntu/Debian)', category:'Web Server', os:['Ubuntu/Debian'],
    description:'Install and configure Apache2 HTTP server on Ubuntu.',
    commands:[
      {label:'Install',code:'sudo apt install apache2 -y',explanation:'Installs Apache2.',result:''},
      {label:'Enable Modules',code:'sudo a2enmod rewrite proxy proxy_http ssl headers',explanation:'Enables essential modules for proxying and SSL.',result:'Enabling module rewrite.'},
      {label:'Create VHost',code:'sudo nano /etc/apache2/sites-available/mysite.conf',explanation:'Create virtual host config.',result:''},
      {label:'Enable Site',code:'sudo a2ensite mysite.conf',explanation:'Enables the virtual host.',result:''},
      {label:'Disable Default',code:'sudo a2dissite 000-default.conf',explanation:'Disables the default site.',result:''},
      {label:'Restart',code:'sudo systemctl restart apache2',explanation:'Applies all changes.',result:''}
    ], tags:['apache','httpd','webserver','ubuntu']
  },
  { title:'Apache Setup (CentOS/RHEL)', category:'Web Server', os:['CentOS/RHEL'],
    description:'Install and configure Apache (httpd) on CentOS/RHEL.',
    commands:[
      {label:'Install',code:'sudo dnf install httpd mod_ssl -y',explanation:'Installs Apache and SSL module.',result:''},
      {label:'Start & Enable',code:'sudo systemctl enable --now httpd',explanation:'Starts Apache and enables on boot.',result:''},
      {label:'Firewall',code:'sudo firewall-cmd --permanent --add-service={http,https}\nsudo firewall-cmd --reload',explanation:'Opens web ports.',result:'success'},
      {label:'SELinux',code:'sudo setsebool -P httpd_can_network_connect 1',explanation:'Allows Apache to connect to network (needed for reverse proxy).',result:''},
      {label:'Config',code:'sudo nano /etc/httpd/conf.d/mysite.conf',explanation:'CentOS uses conf.d directory for vhosts.',result:''},
      {label:'Restart',code:'sudo systemctl restart httpd',explanation:'Applies changes.',result:''}
    ], tags:['apache','httpd','centos','rhel']
  },

  // ─── SSL / TLS ───
  { title:'SSL with Certbot (Ubuntu)', category:'Security', os:['Ubuntu/Debian'],
    description:'Obtain free SSL certificates from Let\'s Encrypt using Certbot on Ubuntu.',
    commands:[
      {label:'Install Certbot',code:'sudo apt install certbot python3-certbot-nginx -y',explanation:'Installs Certbot with Nginx plugin.',result:''},
      {label:'Get Certificate',code:'sudo certbot --nginx -d example.com -d www.example.com',explanation:'Obtains and auto-configures SSL for Nginx.',result:'Successfully received certificate.'},
      {label:'Auto-Renew Test',code:'sudo certbot renew --dry-run',explanation:'Tests automatic renewal process.',result:'Congratulations, all simulated renewals succeeded'},
      {label:'Check Expiry',code:'sudo certbot certificates',explanation:'Lists certificates and expiry dates.',result:'Expiry Date: 2026-05-16'},
      {label:'For Apache',code:'sudo apt install python3-certbot-apache -y\nsudo certbot --apache -d example.com',explanation:'Use Apache plugin instead of Nginx.',result:''}
    ], tags:['ssl','tls','https','certbot','letsencrypt']
  },
  { title:'SSL with Certbot (CentOS)', category:'Security', os:['CentOS/RHEL'],
    description:'Obtain free SSL certificates from Let\'s Encrypt on CentOS/RHEL.',
    commands:[
      {label:'Install',code:'sudo dnf install epel-release -y\nsudo dnf install certbot python3-certbot-nginx -y',explanation:'Installs Certbot from EPEL repository.',result:''},
      {label:'Get Certificate',code:'sudo certbot --nginx -d example.com',explanation:'Obtains SSL for your domain.',result:'Successfully received certificate.'},
      {label:'Auto-Renew',code:'sudo certbot renew --dry-run',explanation:'Tests renewal.',result:''},
      {label:'Cron Renewal',code:'echo "0 0,12 * * * root certbot renew -q" | sudo tee -a /etc/crontab',explanation:'Adds auto-renewal cron job (checks twice daily).',result:''}
    ], tags:['ssl','certbot','centos','rhel']
  },
  { title:'Self-Signed SSL Certificate', category:'Security', os:['All Linux','macOS'],
    description:'Create a self-signed SSL certificate for development or internal servers.',
    commands:[
      {label:'Generate',code:'sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\\n  -keyout /etc/ssl/private/selfsigned.key \\\n  -out /etc/ssl/certs/selfsigned.crt \\\n  -subj "/C=US/ST=State/L=City/O=Org/CN=localhost"',explanation:'Creates a 2048-bit self-signed certificate valid for 1 year.',result:'Generating a RSA private key'},
      {label:'DH Params',code:'sudo openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048',explanation:'Generates Diffie-Hellman parameters for stronger security.',result:''},
      {label:'Verify',code:'openssl x509 -in /etc/ssl/certs/selfsigned.crt -text -noout | head -15',explanation:'View certificate details.',result:'Issuer: CN = localhost\nValidity\n  Not After: Feb 15 2027'}
    ], tags:['ssl','openssl','self-signed','development']
  },

  // ─── DATABASES ───
  { title:'MongoDB Setup (Ubuntu)', category:'Database', os:['Ubuntu/Debian'],
    description:'Install MongoDB 7.0 Community Edition on Ubuntu/Debian.',
    commands:[
      {label:'Import Key',code:'curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg',explanation:'Adds MongoDB GPG key.',result:''},
      {label:'Add Repo',code:'echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list',explanation:'Adds the official repository.',result:''},
      {label:'Install',code:'sudo apt update && sudo apt install mongodb-org -y',explanation:'Installs MongoDB server, shell, and tools.',result:''},
      {label:'Start & Enable',code:'sudo systemctl enable --now mongod',explanation:'Starts MongoDB and enables on boot.',result:''},
      {label:'Connect Shell',code:'mongosh',explanation:'Opens interactive MongoDB shell.',result:'Current Mongosh Log ID: ...'},
      {label:'Show Databases',code:'show dbs',explanation:'Lists all databases (inside mongosh).',result:'admin  40.00 KiB\nconfig  72.00 KiB'},
      {label:'Create User',code:'use admin\ndb.createUser({\n  user: "myAdmin",\n  pwd: "securePassword",\n  roles: [{ role: "root", db: "admin" }]\n})',explanation:'Creates an admin user for authentication.',result:'Successfully added user'},
      {label:'Enable Auth',code:'sudo nano /etc/mongod.conf\n# Add:\n# security:\n#   authorization: "enabled"',explanation:'Edit config to require authentication.',result:''}
    ], tags:['mongodb','nosql','database','ubuntu']
  },
  { title:'MongoDB Setup (CentOS/RHEL)', category:'Database', os:['CentOS/RHEL'],
    description:'Install MongoDB 7.0 on CentOS, RHEL, Rocky Linux, or AlmaLinux.',
    commands:[
      {label:'Create Repo',code:'sudo tee /etc/yum.repos.d/mongodb-org-7.0.repo <<EOF\n[mongodb-org-7.0]\nname=MongoDB Repository\nbaseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/7.0/x86_64/\ngpgcheck=1\nenabled=1\ngpgkey=https://www.mongodb.org/static/pgp/server-7.0.asc\nEOF',explanation:'Creates the YUM repository file.',result:''},
      {label:'Install',code:'sudo dnf install mongodb-org -y',explanation:'Installs MongoDB packages.',result:'Complete!'},
      {label:'Start & Enable',code:'sudo systemctl enable --now mongod',explanation:'Starts and enables MongoDB.',result:''},
      {label:'Status',code:'sudo systemctl status mongod',explanation:'Verify it is running.',result:'Active: active (running)'},
      {label:'Connect',code:'mongosh',explanation:'Opens MongoDB shell.',result:'>'},
      {label:'Firewall',code:'sudo firewall-cmd --permanent --add-port=27017/tcp\nsudo firewall-cmd --reload',explanation:'Opens MongoDB port (only if remote access needed).',result:'success'},
      {label:'SELinux',code:'sudo semanage port -a -t mongod_port_t -p tcp 27017',explanation:'Allows MongoDB port through SELinux.',result:''}
    ], tags:['mongodb','nosql','database','centos','rhel']
  },
  { title:'PostgreSQL (Ubuntu)', category:'Database', os:['Ubuntu/Debian'],
    description:'Install and manage PostgreSQL relational database on Ubuntu.',
    commands:[
      {label:'Install',code:'sudo apt install postgresql postgresql-contrib -y',explanation:'Installs PostgreSQL server and utilities.',result:''},
      {label:'Enter PSQL',code:'sudo -u postgres psql',explanation:'Access PostgreSQL shell as superuser.',result:'psql (14.5)'},
      {label:'Create User',code:"CREATE USER myuser WITH PASSWORD 'secret123';",explanation:'Creates a new DB user.',result:'CREATE ROLE'},
      {label:'Create DB',code:'CREATE DATABASE mydb OWNER myuser;',explanation:'Creates database owned by the user.',result:'CREATE DATABASE'},
      {label:'Grant Access',code:'GRANT ALL PRIVILEGES ON DATABASE mydb TO myuser;',explanation:'Gives full access.',result:'GRANT'},
      {label:'Backup',code:'pg_dump -U postgres mydb > backup.sql',explanation:'Creates a SQL dump backup.',result:''},
      {label:'Restore',code:'psql -U postgres mydb < backup.sql',explanation:'Restores from backup.',result:''}
    ], tags:['postgresql','sql','database','ubuntu']
  },
  { title:'PostgreSQL (CentOS/RHEL)', category:'Database', os:['CentOS/RHEL'],
    description:'Install PostgreSQL on CentOS/RHEL using official repository.',
    commands:[
      {label:'Disable Module',code:'sudo dnf -qy module disable postgresql',explanation:'Disables default system module to use official repo version.',result:''},
      {label:'Add Repo',code:'sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm',explanation:'Adds official PostgreSQL YUM repository.',result:''},
      {label:'Install',code:'sudo dnf install -y postgresql15-server postgresql15',explanation:'Installs PostgreSQL 15.',result:''},
      {label:'Init DB',code:'sudo /usr/pgsql-15/bin/postgresql-15-setup initdb',explanation:'Initializes the database cluster (required once).',result:'Initializing database ... OK'},
      {label:'Start',code:'sudo systemctl enable --now postgresql-15',explanation:'Starts the service.',result:''},
      {label:'Firewall',code:'sudo firewall-cmd --permanent --add-port=5432/tcp\nsudo firewall-cmd --reload',explanation:'Opens PostgreSQL port.',result:''}
    ], tags:['postgresql','sql','database','centos','rhel']
  },
  { title:'MySQL Setup (Ubuntu)', category:'Database', os:['Ubuntu/Debian'],
    description:'Install and configure MySQL 8.0 on Ubuntu/Debian.',
    commands:[
      {label:'Install',code:'sudo apt install mysql-server -y',explanation:'Installs MySQL server.',result:''},
      {label:'Secure',code:'sudo mysql_secure_installation',explanation:'Runs security wizard to set root password and remove defaults.',result:''},
      {label:'Login',code:'sudo mysql -u root -p',explanation:'Login to MySQL shell.',result:'Welcome to the MySQL monitor.'},
      {label:'Create DB & User',code:"CREATE DATABASE myapp;\nCREATE USER 'appuser'@'localhost' IDENTIFIED BY 'password';\nGRANT ALL PRIVILEGES ON myapp.* TO 'appuser'@'localhost';\nFLUSH PRIVILEGES;",explanation:'Creates database and grants access.',result:'Query OK'},
      {label:'Backup',code:'mysqldump -u root -p myapp > backup.sql',explanation:'Creates a full database backup.',result:''},
      {label:'Restore',code:'mysql -u root -p myapp < backup.sql',explanation:'Restores from backup.',result:''}
    ], tags:['mysql','sql','database','ubuntu']
  },
  { title:'MySQL Setup (CentOS/RHEL)', category:'Database', os:['CentOS/RHEL'],
    description:'Install MySQL on CentOS/RHEL.',
    commands:[
      {label:'Add Repo',code:'sudo dnf install https://dev.mysql.com/get/mysql80-community-release-el9-1.noarch.rpm -y',explanation:'Adds official MySQL repository.',result:''},
      {label:'Install',code:'sudo dnf install mysql-community-server -y',explanation:'Installs MySQL server.',result:''},
      {label:'Start',code:'sudo systemctl enable --now mysqld',explanation:'Starts MySQL.',result:''},
      {label:'Temp Password',code:'sudo grep "temporary password" /var/log/mysqld.log',explanation:'MySQL generates a temporary root password on first start.',result:'A temporary password is generated: Ab1!xxxxx'},
      {label:'Secure',code:'sudo mysql_secure_installation',explanation:'Change temp password and secure the installation.',result:''},
      {label:'Firewall',code:'sudo firewall-cmd --permanent --add-port=3306/tcp\nsudo firewall-cmd --reload',explanation:'Opens MySQL port if remote access needed.',result:''}
    ], tags:['mysql','sql','database','centos','rhel']
  },
  { title:'Redis Setup (Ubuntu)', category:'Database', os:['Ubuntu/Debian'],
    description:'Install Redis in-memory cache on Ubuntu.',
    commands:[
      {label:'Install',code:'sudo apt install redis-server -y',explanation:'Installs Redis.',result:''},
      {label:'Configure systemd',code:"sudo sed -i 's/supervised no/supervised systemd/' /etc/redis/redis.conf",explanation:'Configures Redis to be managed by systemd.',result:''},
      {label:'Start',code:'sudo systemctl restart redis && sudo systemctl enable redis',explanation:'Restarts and enables Redis.',result:''},
      {label:'Test',code:'redis-cli ping',explanation:'Verifies Redis is running.',result:'PONG'},
      {label:'Set/Get',code:'redis-cli SET hello "world"\nredis-cli GET hello',explanation:'Basic key-value operations.',result:'"world"'},
      {label:'Memory Info',code:'redis-cli INFO memory | head -5',explanation:'Check memory usage.',result:'used_memory_human:1.00M'}
    ], tags:['redis','cache','nosql','ubuntu']
  },
  { title:'Redis Setup (CentOS/RHEL)', category:'Database', os:['CentOS/RHEL'],
    description:'Install Redis on CentOS/RHEL.',
    commands:[
      {label:'Install',code:'sudo dnf install epel-release -y && sudo dnf install redis -y',explanation:'Redis is in the EPEL repository.',result:''},
      {label:'Start',code:'sudo systemctl enable --now redis',explanation:'Starts and enables Redis.',result:''},
      {label:'Test',code:'redis-cli ping',explanation:'Checks connectivity.',result:'PONG'},
      {label:'Bind IP',code:'sudo sed -i "s/bind 127.0.0.1/bind 0.0.0.0/" /etc/redis.conf',explanation:'Allow external connections (secure with firewall!).',result:''},
      {label:'Firewall',code:'sudo firewall-cmd --permanent --add-port=6379/tcp\nsudo firewall-cmd --reload',explanation:'Opens Redis port.',result:''}
    ], tags:['redis','cache','nosql','centos']
  }
];
