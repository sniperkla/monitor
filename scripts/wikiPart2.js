module.exports = [
  // ─── DOCKER ───
  { title:'Docker Install (Ubuntu)', category:'Container', os:['Ubuntu/Debian'],
    description:'Install Docker Engine on Ubuntu/Debian using the official repository.',
    commands:[
      {label:'Prerequisites',code:'sudo apt install ca-certificates curl gnupg -y',explanation:'Installs required dependencies.',result:''},
      {label:'Add GPG Key',code:'sudo install -m 0755 -d /etc/apt/keyrings\ncurl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg',explanation:'Adds Docker official GPG key.',result:''},
      {label:'Add Repo',code:'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list',explanation:'Adds Docker APT repository.',result:''},
      {label:'Install',code:'sudo apt update && sudo apt install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y',explanation:'Installs Docker Engine, CLI, and Compose plugin.',result:''},
      {label:'Add User',code:'sudo usermod -aG docker $USER',explanation:'Allows running Docker without sudo. Log out/in to apply.',result:''},
      {label:'Verify',code:'docker run hello-world',explanation:'Runs a test container.',result:'Hello from Docker!'}
    ], tags:['docker','container','ubuntu']
  },
  { title:'Docker Install (CentOS)', category:'Container', os:['CentOS/RHEL'],
    description:'Install Docker Engine on CentOS/RHEL.',
    commands:[
      {label:'Add Repo',code:'sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo',explanation:'Adds Docker repository.',result:''},
      {label:'Install',code:'sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y',explanation:'Installs Docker packages.',result:''},
      {label:'Start',code:'sudo systemctl enable --now docker',explanation:'Starts Docker and enables on boot.',result:''},
      {label:'Add User',code:'sudo usermod -aG docker $USER',explanation:'Allows running Docker without sudo.',result:''},
      {label:'Verify',code:'docker run hello-world',explanation:'Tests the installation.',result:'Hello from Docker!'}
    ], tags:['docker','container','centos','rhel']
  },
  { title:'Docker Commands', category:'Container', os:['All Linux','macOS'],
    description:'Essential Docker commands for managing containers and images.',
    commands:[
      {label:'List Containers',code:'docker ps -a',explanation:'Shows all containers including stopped.',result:'CONTAINER ID   IMAGE   STATUS'},
      {label:'Run Container',code:'docker run -d --name myapp -p 8080:80 --restart unless-stopped nginx:alpine',explanation:'Runs Nginx in background, mapping port 8080.',result:''},
      {label:'Logs',code:'docker logs -f --tail 100 myapp',explanation:'Follow last 100 lines of container logs.',result:''},
      {label:'Shell Access',code:'docker exec -it myapp /bin/sh',explanation:'Opens interactive shell inside container.',result:'/ #'},
      {label:'Stop & Remove',code:'docker stop myapp && docker rm myapp',explanation:'Stops then removes a container.',result:''},
      {label:'Build Image',code:'docker build -t myapp:latest .',explanation:'Builds an image from Dockerfile in current directory.',result:''},
      {label:'Cleanup All',code:'docker system prune -af --volumes',explanation:'Removes ALL unused containers, images, networks, volumes.',result:'Total reclaimed space: 2.3GB'}
    ], tags:['docker','container','commands']
  },
  { title:'Docker Compose', category:'Container', os:['All Linux','macOS'],
    description:'Define and run multi-container applications.',
    commands:[
      {label:'Sample File',code:'# docker-compose.yml\nservices:\n  web:\n    image: nginx:alpine\n    ports: ["80:80"]\n    depends_on: [api]\n  api:\n    build: ./api\n    ports: ["3000:3000"]\n    environment:\n      - DB_HOST=db\n  db:\n    image: mongo:7\n    volumes:\n      - mongo_data:/data/db\nvolumes:\n  mongo_data:',explanation:'Complete compose file with web, API, and database.',result:''},
      {label:'Start',code:'docker compose up -d',explanation:'Starts all services in detached mode.',result:'✔ Container db Started\n✔ Container api Started'},
      {label:'Logs',code:'docker compose logs -f api',explanation:'Follow logs for specific service.',result:''},
      {label:'Stop',code:'docker compose down -v',explanation:'Stops all services and removes volumes.',result:''},
      {label:'Rebuild',code:'docker compose up -d --build --force-recreate',explanation:'Forces rebuild of all containers.',result:''}
    ], tags:['docker','compose','devops']
  },

  // ─── SECURITY ───
  { title:'SSH Hardening', category:'Security', os:['All Linux'],
    description:'Secure SSH against brute-force and unauthorized access.',
    commands:[
      {label:'Generate Key',code:'ssh-keygen -t ed25519 -C "admin@server"',explanation:'Creates a modern ED25519 SSH key pair.',result:''},
      {label:'Copy Key',code:'ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server',explanation:'Copies public key to remote server for passwordless login.',result:'Number of key(s) added: 1'},
      {label:'Disable Password',code:'sudo sed -i "s/#PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config',explanation:'Disables password-based login (key-only).',result:''},
      {label:'Disable Root',code:'sudo sed -i "s/PermitRootLogin yes/PermitRootLogin no/" /etc/ssh/sshd_config',explanation:'Prevents direct root login.',result:''},
      {label:'Change Port',code:'sudo sed -i "s/#Port 22/Port 2222/" /etc/ssh/sshd_config',explanation:'Changes SSH port to reduce automated attacks.',result:''},
      {label:'Apply',code:'sudo sshd -t && sudo systemctl restart sshd',explanation:'Validates config then restarts SSH.',result:''}
    ], tags:['ssh','security','hardening']
  },
  { title:'Firewall UFW (Ubuntu)', category:'Security', os:['Ubuntu/Debian'],
    description:'Manage firewall rules with Uncomplicated Firewall on Ubuntu.',
    commands:[
      {label:'Default Policy',code:'sudo ufw default deny incoming\nsudo ufw default allow outgoing',explanation:'Blocks all incoming, allows outgoing.',result:''},
      {label:'Allow Ports',code:'sudo ufw allow 22/tcp\nsudo ufw allow 80/tcp\nsudo ufw allow 443/tcp',explanation:'Opens SSH, HTTP, HTTPS.',result:'Rule added'},
      {label:'Allow Subnet',code:'sudo ufw allow from 10.0.0.0/24 to any port 3306',explanation:'Allow MySQL only from internal network.',result:''},
      {label:'Enable',code:'sudo ufw enable',explanation:'Activates firewall.',result:'Firewall is active'},
      {label:'Status',code:'sudo ufw status verbose',explanation:'Shows all rules.',result:'Status: active'},
      {label:'Delete Rule',code:'sudo ufw status numbered\nsudo ufw delete 3',explanation:'Lists numbered rules, deletes #3.',result:''}
    ], tags:['ufw','firewall','ubuntu','security']
  },
  { title:'Firewalld (CentOS/RHEL)', category:'Security', os:['CentOS/RHEL'],
    description:'Manage firewall rules using firewalld on CentOS/RHEL.',
    commands:[
      {label:'Status',code:'sudo firewall-cmd --state',explanation:'Check if firewalld is running.',result:'running'},
      {label:'List Rules',code:'sudo firewall-cmd --list-all',explanation:'Shows all active zone rules.',result:'services: ssh dhcpv6-client'},
      {label:'Add Service',code:'sudo firewall-cmd --permanent --add-service={http,https}',explanation:'Opens HTTP and HTTPS permanently.',result:'success'},
      {label:'Add Port',code:'sudo firewall-cmd --permanent --add-port=3000/tcp',explanation:'Opens a custom port.',result:'success'},
      {label:'Remove',code:'sudo firewall-cmd --permanent --remove-port=3000/tcp',explanation:'Removes a port rule.',result:''},
      {label:'Reload',code:'sudo firewall-cmd --reload',explanation:'Applies all pending changes.',result:'success'}
    ], tags:['firewalld','firewall','centos','security']
  },
  { title:'SELinux Management', category:'Security', os:['CentOS/RHEL'],
    description:'Manage Security-Enhanced Linux contexts and policies on CentOS/RHEL.',
    commands:[
      {label:'Check Status',code:'sestatus',explanation:'Shows current SELinux mode (Enforcing/Permissive/Disabled).',result:'SELinux status: enabled\nCurrent mode: enforcing'},
      {label:'Permissive Mode',code:'sudo setenforce 0',explanation:'Temporarily sets Permissive (logs but doesnt block). Good for debugging.',result:''},
      {label:'View Context',code:'ls -Z /var/www/html',explanation:'Shows security labels on files.',result:'httpd_sys_content_t index.html'},
      {label:'Restore Context',code:'sudo restorecon -Rv /var/www/html',explanation:'Resets file contexts to defaults.',result:''},
      {label:'Allow HTTP Proxy',code:'sudo setsebool -P httpd_can_network_connect 1',explanation:'Lets Nginx/Apache connect to backends.',result:''},
      {label:'Allow Port',code:'sudo semanage port -a -t http_port_t -p tcp 3000',explanation:'Registers custom port for HTTP service.',result:''},
      {label:'Audit Logs',code:'sudo ausearch -m avc -ts recent | audit2why',explanation:'Finds SELinux denials and explains why they were blocked.',result:''}
    ], tags:['selinux','security','centos','rhel']
  },
  { title:'Fail2Ban Protection', category:'Security', os:['All Linux'],
    description:'Automatically ban IPs showing malicious behavior.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install fail2ban -y',explanation:'Installs on Ubuntu/Debian.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install epel-release -y && sudo dnf install fail2ban -y',explanation:'Installs on CentOS (requires EPEL).',result:''},
      {label:'Local Config',code:'sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local',explanation:'Creates local config that survives updates.',result:''},
      {label:'SSH Jail',code:'# In /etc/fail2ban/jail.local:\n[sshd]\nenabled = true\nport = 22\nmaxretry = 3\nbantime = 3600\nfindtime = 600',explanation:'Bans IP for 1 hour after 3 failed SSH attempts.',result:''},
      {label:'Start',code:'sudo systemctl enable --now fail2ban',explanation:'Enables and starts Fail2Ban.',result:''},
      {label:'Status',code:'sudo fail2ban-client status sshd',explanation:'Shows SSH jail status.',result:'Currently banned: 1\nTotal banned: 5'},
      {label:'Unban',code:'sudo fail2ban-client set sshd unbanip 1.2.3.4',explanation:'Manually unbans an IP address.',result:''}
    ], tags:['fail2ban','security','brute-force']
  },

  // ─── SYSTEM ADMINISTRATION ───
  { title:'Linux Essentials', category:'System', os:['All Linux'],
    description:'Fundamental Linux commands for files, navigation, and system info.',
    commands:[
      {label:'List Files',code:'ls -lah',explanation:'Lists all files with sizes and permissions.',result:'drwxr-xr-x 2 user user 4.0K ...'},
      {label:'Find Files',code:'find / -name "*.conf" -type f 2>/dev/null | head -20',explanation:'Searches filesystem for config files.',result:''},
      {label:'Create Path',code:'mkdir -p /opt/myapp/config',explanation:'Creates nested directories.',result:''},
      {label:'Permissions',code:'chmod 755 script.sh\nchown www-data:www-data /var/www -R',explanation:'Sets permissions and ownership.',result:''},
      {label:'Search in Files',code:"grep -rn 'error' /var/log/ --include='*.log' | tail -10",explanation:'Recursively searches for text in log files.',result:''},
      {label:'Tar Archive',code:'tar -czf backup.tar.gz /opt/myapp/',explanation:'Creates a compressed archive.',result:''},
      {label:'Extract',code:'tar -xzf backup.tar.gz -C /opt/restore/',explanation:'Extracts archive to directory.',result:''},
      {label:'Disk Usage',code:'du -sh /var/log/* | sort -rh | head -10',explanation:'Shows largest items in a directory.',result:''}
    ], tags:['linux','bash','files','permissions']
  },
  { title:'User Management', category:'System', os:['All Linux'],
    description:'Create, manage, and secure system users and groups.',
    commands:[
      {label:'Add User',code:'sudo adduser deploy',explanation:'Creates user with home directory.',result:''},
      {label:'Add to Sudo',code:'sudo usermod -aG sudo deploy',explanation:'Grants sudo access (use "wheel" on CentOS).',result:''},
      {label:'CentOS Sudo',code:'sudo usermod -aG wheel deploy',explanation:'On CentOS/RHEL, the sudo group is called "wheel".',result:''},
      {label:'Switch User',code:'sudo su - deploy',explanation:'Switches to the user with their environment.',result:''},
      {label:'List Users',code:'cat /etc/passwd | grep -v nologin | grep -v false',explanation:'Shows users who can login.',result:''},
      {label:'Delete User',code:'sudo deluser --remove-home olduser',explanation:'Removes user and home directory.',result:''},
      {label:'Lock Account',code:'sudo passwd -l username',explanation:'Locks a user account (disables login).',result:''}
    ], tags:['users','groups','sudo','admin']
  },
  { title:'Cron Jobs & Scheduling', category:'System', os:['All Linux'],
    description:'Schedule automated tasks using crontab.',
    commands:[
      {label:'Edit Crontab',code:'crontab -e',explanation:'Opens crontab editor.',result:''},
      {label:'List Jobs',code:'crontab -l',explanation:'Shows all scheduled jobs.',result:''},
      {label:'Every 5 Min',code:'*/5 * * * * /opt/scripts/check.sh >> /var/log/check.log 2>&1',explanation:'Runs every 5 minutes, logs output.',result:''},
      {label:'Daily 2AM',code:'0 2 * * * /opt/scripts/backup.sh',explanation:'Runs daily at 2:00 AM.',result:''},
      {label:'Weekly Cleanup',code:'0 0 * * 0 find /tmp -mtime +7 -delete',explanation:'Deletes /tmp files older than 7 days every Sunday.',result:''},
      {label:'Cron Syntax',code:'# ┌─── minute (0-59)\n# │ ┌─── hour (0-23)\n# │ │ ┌─── day of month (1-31)\n# │ │ │ ┌─── month (1-12)\n# │ │ │ │ ┌─── day of week (0-6)\n# * * * * * command',explanation:'Reference for cron expressions.',result:''}
    ], tags:['cron','schedule','automation']
  },
  { title:'Swap Memory', category:'System', os:['All Linux'],
    description:'Create and manage swap space for servers with limited RAM.',
    commands:[
      {label:'Check',code:'sudo swapon --show && free -h',explanation:'Shows current swap and memory.',result:''},
      {label:'Create 2GB',code:'sudo fallocate -l 2G /swapfile\nsudo chmod 600 /swapfile\nsudo mkswap /swapfile\nsudo swapon /swapfile',explanation:'Creates and activates a 2GB swap file.',result:''},
      {label:'Persist',code:'echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab',explanation:'Makes swap permanent across reboots.',result:''},
      {label:'Tune',code:'sudo sysctl vm.swappiness=10\necho "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf',explanation:'Sets swappiness to 10 (prefer RAM). Default is 60.',result:''}
    ], tags:['swap','memory','ram','performance']
  },
  { title:'Disk Management (LVM)', category:'System', os:['All Linux'],
    description:'Manage logical volumes for flexible storage.',
    commands:[
      {label:'List Disks',code:'lsblk',explanation:'Lists block devices.',result:'sda  50G  disk\n└─sda1  50G  part /'},
      {label:'Show PV/VG/LV',code:'sudo pvs && sudo vgs && sudo lvs',explanation:'Shows Physical/Volume/Logical volumes.',result:''},
      {label:'Create LV',code:'sudo lvcreate -n data_vol -L 10G my_vg',explanation:'Creates a 10GB logical volume.',result:''},
      {label:'Format',code:'sudo mkfs.ext4 /dev/my_vg/data_vol',explanation:'Formats with ext4 filesystem.',result:''},
      {label:'Mount',code:'sudo mkdir -p /mnt/data\nsudo mount /dev/my_vg/data_vol /mnt/data',explanation:'Mounts the volume.',result:''},
      {label:'Persist Mount',code:'echo "/dev/my_vg/data_vol /mnt/data ext4 defaults 0 0" | sudo tee -a /etc/fstab',explanation:'Makes mount permanent.',result:''}
    ], tags:['lvm','disk','storage','partition']
  },
  { title:'Environment Variables', category:'System', os:['All Linux','macOS'],
    description:'Manage environment variables and .env files.',
    commands:[
      {label:'View All',code:'printenv',explanation:'Lists all environment variables.',result:'HOME=/home/user\nPATH=/usr/local/bin:...'},
      {label:'Set Temp',code:'export MY_VAR="hello"',explanation:'Sets variable for current session.',result:''},
      {label:'Set Permanent',code:'echo \'export MY_VAR="hello"\' >> ~/.bashrc && source ~/.bashrc',explanation:'Persists across sessions.',result:''},
      {label:'Create .env',code:'cat > .env <<EOF\nNODE_ENV=production\nPORT=3000\nDB_HOST=localhost\nSECRET=your-secret\nEOF',explanation:'Creates a .env file.',result:''},
      {label:'Load .env',code:'export $(cat .env | xargs)',explanation:'Loads .env into current session.',result:''}
    ], tags:['env','environment','config']
  },

  // ─── MONITORING & TOOLS ───
  { title:'System Monitoring', category:'Monitoring', os:['All Linux'],
    description:'Monitor CPU, memory, disk, and processes.',
    commands:[
      {label:'htop',code:'htop',explanation:'Interactive process viewer.',result:'(Interactive TUI)'},
      {label:'Disk',code:'df -h',explanation:'Filesystem disk space usage.',result:'Filesystem  Size  Used  Avail  Use%\n/dev/sda1    50G   12G    36G   25%'},
      {label:'Memory',code:'free -h',explanation:'RAM and swap usage.',result:'total  7.7G\nused   2.1G\nfree   4.2G'},
      {label:'Top Processes',code:'ps aux --sort=-%mem | head -10',explanation:'Top 10 by memory.',result:''},
      {label:'Uptime',code:'uptime',explanation:'System uptime and load average.',result:'up 42 days, load average: 0.15'},
      {label:'IO Stats',code:'iostat -x 1 3',explanation:'Disk I/O statistics.',result:''}
    ], tags:['monitoring','cpu','memory','disk']
  },
  { title:'Log Management', category:'Monitoring', os:['All Linux'],
    description:'View, search, and manage system logs.',
    commands:[
      {label:'Follow Logs',code:'journalctl -f',explanation:'Stream all logs live.',result:''},
      {label:'Service Logs',code:'journalctl -u nginx --since "1 hour ago"',explanation:'View specific service logs.',result:''},
      {label:'Kernel Logs',code:'journalctl -k',explanation:'Shows kernel messages.',result:''},
      {label:'Search Logs',code:'grep -i "error" /var/log/syslog | tail -20',explanation:'Find errors in syslog.',result:''},
      {label:'Vacuum',code:'sudo journalctl --vacuum-size=500M',explanation:'Limits journal to 500MB.',result:'freed 500.0M'}
    ], tags:['logs','journalctl','debug']
  },
  { title:'PM2 Process Manager', category:'Process', os:['All Linux','macOS'],
    description:'Manage Node.js apps in production with PM2.',
    commands:[
      {label:'Install',code:'npm install -g pm2',explanation:'Installs PM2 globally.',result:''},
      {label:'Start App',code:'pm2 start app.js --name "myapp" -i max',explanation:'Starts in cluster mode using all CPU cores.',result:''},
      {label:'List',code:'pm2 list',explanation:'Shows all managed processes.',result:''},
      {label:'Logs',code:'pm2 logs myapp --lines 50',explanation:'Shows last 50 lines.',result:''},
      {label:'Auto-Start',code:'pm2 startup && pm2 save',explanation:'Configures PM2 to start on boot.',result:''},
      {label:'Restart',code:'pm2 restart myapp',explanation:'Restarts the app.',result:''},
      {label:'Monitor',code:'pm2 monit',explanation:'Opens real-time dashboard.',result:''}
    ], tags:['pm2','node','process','production']
  },
  { title:'Systemd Services', category:'Process', os:['Ubuntu/Debian','CentOS/RHEL'],
    description:'Create custom systemd services for any application.',
    commands:[
      {label:'Create Service',code:'sudo nano /etc/systemd/system/myapp.service',explanation:'Creates a new service file.',result:''},
      {label:'Template',code:'[Unit]\nDescription=My Application\nAfter=network.target\n\n[Service]\nType=simple\nUser=www-data\nWorkingDirectory=/opt/myapp\nExecStart=/usr/bin/node server.js\nRestart=on-failure\nRestartSec=5\nEnvironment=NODE_ENV=production\n\n[Install]\nWantedBy=multi-user.target',explanation:'Complete unit file for a Node.js app.',result:''},
      {label:'Enable',code:'sudo systemctl daemon-reload\nsudo systemctl enable --now myapp',explanation:'Loads and starts the service.',result:''},
      {label:'Status',code:'sudo systemctl status myapp',explanation:'Check service status.',result:'Active: active (running)'},
      {label:'Logs',code:'journalctl -u myapp -f',explanation:'Follow service logs.',result:''}
    ], tags:['systemd','service','daemon']
  },

  // ─── TOOLS & MISC ───
  { title:'Tmux Multiplexer', category:'Tools', os:['All Linux','macOS'],
    description:'Run multiple terminal sessions that persist after disconnecting.',
    commands:[
      {label:'Install',code:'sudo apt install tmux -y  # Ubuntu\nsudo dnf install tmux -y  # CentOS',explanation:'Installs tmux.',result:''},
      {label:'New Session',code:'tmux new -s deploy',explanation:'Creates named session.',result:''},
      {label:'Detach',code:'Ctrl+B then D',explanation:'Detaches without stopping.',result:'[detached]'},
      {label:'Reattach',code:'tmux attach -t deploy',explanation:'Reconnects to session.',result:''},
      {label:'List',code:'tmux ls',explanation:'Lists all sessions.',result:'deploy: 1 windows'},
      {label:'Split H',code:'Ctrl+B then "',explanation:'Horizontal split.',result:''},
      {label:'Split V',code:'Ctrl+B then %',explanation:'Vertical split.',result:''}
    ], tags:['tmux','terminal','session']
  },
  { title:'Vim Quick Reference', category:'Tools', os:['All Linux','macOS'],
    description:'Essential Vim commands for editing files on servers.',
    commands:[
      {label:'Insert',code:'i',explanation:'Enter insert mode.',result:'-- INSERT --'},
      {label:'Save & Quit',code:':wq',explanation:'Write and quit.',result:''},
      {label:'Quit No Save',code:':q!',explanation:'Quit without saving.',result:''},
      {label:'Search',code:'/search_term',explanation:'Press / then type. n=next match.',result:''},
      {label:'Replace All',code:':%s/old/new/g',explanation:'Replace all occurrences.',result:''},
      {label:'Line Numbers',code:':set number',explanation:'Shows line numbers.',result:''},
      {label:'Go to Line',code:':42',explanation:'Jumps to line 42.',result:''},
      {label:'Delete Line',code:'dd',explanation:'Deletes current line.',result:''}
    ], tags:['vim','editor','terminal']
  },
  { title:'Curl & Wget', category:'Tools', os:['All Linux','macOS'],
    description:'Download files and interact with APIs from the command line.',
    commands:[
      {label:'Download',code:'wget https://example.com/file.tar.gz',explanation:'Downloads a file.',result:'file.tar.gz 100%[=====>] 50.00M'},
      {label:'GET JSON',code:'curl -s https://api.example.com/status | jq .',explanation:'GET request with formatted JSON.',result:'{"status":"ok"}'},
      {label:'POST JSON',code:"curl -X POST https://api.example.com/data \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"test\"}'",explanation:'Sends JSON POST request.',result:''},
      {label:'With Auth',code:"curl -H 'Authorization: Bearer TOKEN' https://api.example.com/me",explanation:'Authenticated request.',result:''},
      {label:'Speed Test',code:'curl -o /dev/null -w "Speed: %{speed_download}\\nTime: %{time_total}s\\n" https://example.com',explanation:'Measures download speed.',result:''}
    ], tags:['curl','wget','download','api']
  },
  { title:'Git Operations', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Essential Git commands for deployment and server operations.',
    commands:[
      {label:'Clone',code:'git clone git@github.com:user/repo.git',explanation:'Clones via SSH.',result:'Cloning into repo...'},
      {label:'Pull',code:'git pull origin main',explanation:'Fetches and merges latest.',result:''},
      {label:'Force Sync',code:'git fetch origin && git reset --hard origin/main',explanation:'Force-syncs to match remote (deployment).',result:''},
      {label:'Log',code:'git log --oneline -10',explanation:'Last 10 commits.',result:''},
      {label:'Stash',code:'git stash && git pull && git stash pop',explanation:'Saves changes, pulls, re-applies.',result:''},
      {label:'Deploy Key',code:'ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""',explanation:'Creates passwordless deploy key for CI/CD.',result:''}
    ], tags:['git','deployment','devops']
  },
  { title:'Node.js (NVM)', category:'Installation', os:['All Linux','macOS'],
    description:'Install and manage Node.js versions with NVM.',
    commands:[
      {label:'Install NVM',code:'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',explanation:'Downloads and installs NVM.',result:''},
      {label:'Reload Shell',code:'source ~/.bashrc',explanation:'Makes nvm command available.',result:''},
      {label:'Install LTS',code:'nvm install --lts',explanation:'Installs latest LTS version.',result:'Now using node v20.11.0'},
      {label:'Use Version',code:'nvm use 18',explanation:'Switches to Node.js 18.',result:'Now using node v18.19.0'},
      {label:'Set Default',code:'nvm alias default 20',explanation:'Sets v20 as default.',result:''},
      {label:'List',code:'nvm ls',explanation:'Lists installed versions.',result:'-> v20.11.0\n   v18.19.0'}
    ], tags:['node','nvm','javascript']
  },
  { title:'AWS CLI Essentials', category:'Cloud', os:['All Linux','macOS'],
    description:'Common AWS CLI commands for managing cloud infrastructure.',
    commands:[
      {label:'Install',code:'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"\nunzip awscliv2.zip && sudo ./aws/install',explanation:'Installs AWS CLI v2.',result:''},
      {label:'Configure',code:'aws configure',explanation:'Sets up credentials and region.',result:'AWS Access Key ID: ****'},
      {label:'List EC2',code:'aws ec2 describe-instances --query "Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress]" --output table',explanation:'Lists EC2 instances.',result:''},
      {label:'S3 Upload',code:'aws s3 cp ./backup.tar.gz s3://my-bucket/backups/',explanation:'Uploads file to S3.',result:'upload: ./backup.tar.gz to s3://...'},
      {label:'S3 Sync',code:'aws s3 sync ./dist s3://my-bucket/website --delete',explanation:'Syncs directory to S3.',result:''}
    ], tags:['aws','cloud','ec2','s3']
  },

  // ─── NETWORK ───
  { title:'Network Diagnostics', category:'Network', os:['All Linux','macOS'],
    description:'Commands for debugging network connectivity issues.',
    commands:[
      {label:'Public IP',code:'curl -s ifconfig.me',explanation:'Gets server public IP.',result:'93.184.216.34'},
      {label:'Listen Ports',code:'sudo ss -tulpn',explanation:'Shows all listening ports and processes.',result:'LISTEN  0.0.0.0:80  nginx'},
      {label:'DNS Lookup',code:'dig example.com +short',explanation:'Resolves domain to IP.',result:'93.184.216.34'},
      {label:'Traceroute',code:'traceroute example.com',explanation:'Shows network path.',result:''},
      {label:'Test Port',code:'nc -zv example.com 443',explanation:'Tests if port is open.',result:'Connection succeeded!'},
      {label:'Interfaces',code:'ip addr show',explanation:'Shows network interfaces and IPs.',result:'eth0: inet 10.0.0.5/24'}
    ], tags:['network','dns','debug','ports']
  },
  { title:'NetworkManager (CentOS)', category:'Network', os:['CentOS/RHEL'],
    description:'Configure network interfaces using nmcli on CentOS/RHEL.',
    commands:[
      {label:'List Devices',code:'nmcli device status',explanation:'Shows all network interfaces.',result:'eth0  ethernet  connected  System eth0'},
      {label:'Show Connection',code:'nmcli connection show "System eth0"',explanation:'Displays full connection details.',result:''},
      {label:'Set Static IP',code:'sudo nmcli con mod "System eth0" ipv4.addresses 10.0.0.5/24\nsudo nmcli con mod "System eth0" ipv4.gateway 10.0.0.1\nsudo nmcli con mod "System eth0" ipv4.dns "8.8.8.8 8.8.4.4"\nsudo nmcli con mod "System eth0" ipv4.method manual',explanation:'Configures a static IP address.',result:''},
      {label:'Apply',code:'sudo nmcli con up "System eth0"',explanation:'Applies the new network configuration.',result:'Connection successfully activated.'},
      {label:'TUI Mode',code:'sudo nmtui',explanation:'Opens a text-based UI for easier network configuration.',result:'(Interactive TUI)'}
    ], tags:['network','nmcli','centos','static-ip']
  },
  { title:'Netplan (Ubuntu)', category:'Network', os:['Ubuntu/Debian'],
    description:'Configure network interfaces using Netplan on Ubuntu.',
    commands:[
      {label:'View Config',code:'cat /etc/netplan/*.yaml',explanation:'Shows current network configuration.',result:''},
      {label:'Static IP',code:'# /etc/netplan/01-netcfg.yaml\nnetwork:\n  version: 2\n  ethernets:\n    eth0:\n      addresses: [10.0.0.5/24]\n      gateway4: 10.0.0.1\n      nameservers:\n        addresses: [8.8.8.8, 8.8.4.4]',explanation:'Example static IP configuration.',result:''},
      {label:'Apply',code:'sudo netplan apply',explanation:'Applies the configuration.',result:''},
      {label:'Test',code:'sudo netplan try',explanation:'Tests config for 120 seconds, auto-reverts if no confirmation.',result:''}
    ], tags:['netplan','network','ubuntu','static-ip']
  }
];
