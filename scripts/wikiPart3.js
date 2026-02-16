module.exports = [
  // ─── KUBERNETES ───
  { title:'Kubernetes (kubectl) Basics', category:'Container', os:['All Linux','macOS'],
    description:'Essential kubectl commands for managing Kubernetes clusters.',
    commands:[
      {label:'Get Nodes',code:'kubectl get nodes',explanation:'Lists all nodes in the cluster.',result:'NAME       STATUS   ROLES    AGE   VERSION\nmaster-1   Ready    master   30d   v1.28.0'},
      {label:'Get Pods',code:'kubectl get pods -A',explanation:'Lists all pods across all namespaces.',result:'NAMESPACE   NAME              READY   STATUS    RESTARTS   AGE'},
      {label:'Describe Pod',code:'kubectl describe pod my-pod -n default',explanation:'Shows detailed info about a pod including events.',result:''},
      {label:'Logs',code:'kubectl logs -f my-pod -n default',explanation:'Follow logs from a specific pod.',result:''},
      {label:'Exec Shell',code:'kubectl exec -it my-pod -n default -- /bin/sh',explanation:'Opens a shell inside a running pod.',result:'/ #'},
      {label:'Apply Config',code:'kubectl apply -f deployment.yaml',explanation:'Creates or updates resources from a YAML file.',result:'deployment.apps/myapp created'},
      {label:'Scale',code:'kubectl scale deployment myapp --replicas=3',explanation:'Scales deployment to 3 replicas.',result:'deployment.apps/myapp scaled'},
      {label:'Delete',code:'kubectl delete -f deployment.yaml',explanation:'Removes resources defined in the file.',result:''}
    ], tags:['kubernetes','k8s','kubectl','container','orchestration']
  },
  { title:'K8s Deployment YAML', category:'Container', os:['All Linux','macOS'],
    description:'Sample Kubernetes Deployment and Service manifest files.',
    commands:[
      {label:'Deployment',code:'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: myapp\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: myapp\n  template:\n    metadata:\n      labels:\n        app: myapp\n    spec:\n      containers:\n      - name: myapp\n        image: myapp:latest\n        ports:\n        - containerPort: 3000\n        env:\n        - name: NODE_ENV\n          value: "production"\n        resources:\n          limits:\n            memory: "256Mi"\n            cpu: "500m"',explanation:'Deployment with 2 replicas, resource limits, and env vars.',result:''},
      {label:'Service',code:'apiVersion: v1\nkind: Service\nmetadata:\n  name: myapp-svc\nspec:\n  type: ClusterIP\n  selector:\n    app: myapp\n  ports:\n  - port: 80\n    targetPort: 3000',explanation:'ClusterIP Service exposing port 80 internally.',result:''},
      {label:'Ingress',code:'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: myapp-ingress\n  annotations:\n    nginx.ingress.kubernetes.io/rewrite-target: /\nspec:\n  rules:\n  - host: myapp.example.com\n    http:\n      paths:\n      - path: /\n        pathType: Prefix\n        backend:\n          service:\n            name: myapp-svc\n            port:\n              number: 80',explanation:'Ingress rule to route domain traffic to the service.',result:''}
    ], tags:['kubernetes','k8s','deployment','yaml']
  },

  // ─── VPN ───
  { title:'WireGuard VPN Setup', category:'Network', os:['All Linux'],
    description:'Set up a lightweight, fast VPN using WireGuard.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install wireguard -y',explanation:'Installs WireGuard on Ubuntu.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install epel-release elrepo-release -y\nsudo dnf install kmod-wireguard wireguard-tools -y',explanation:'Installs WireGuard on CentOS (needs elrepo).',result:''},
      {label:'Generate Keys',code:'wg genkey | tee privatekey | wg pubkey > publickey',explanation:'Generates private and public key pair.',result:''},
      {label:'Server Config',code:'# /etc/wireguard/wg0.conf\n[Interface]\nPrivateKey = <SERVER_PRIVATE_KEY>\nAddress = 10.0.0.1/24\nListenPort = 51820\nPostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE\nPostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE\n\n[Peer]\nPublicKey = <CLIENT_PUBLIC_KEY>\nAllowedIPs = 10.0.0.2/32',explanation:'Server configuration with NAT forwarding.',result:''},
      {label:'Start VPN',code:'sudo wg-quick up wg0\nsudo systemctl enable wg-quick@wg0',explanation:'Starts WireGuard and enables on boot.',result:'[#] ip link add wg0 type wireguard'},
      {label:'Check Status',code:'sudo wg show',explanation:'Shows active VPN connections and stats.',result:'interface: wg0\n  public key: ...\n  listening port: 51820\npeer: ...\n  endpoint: 1.2.3.4:51820\n  latest handshake: 5 seconds ago'}
    ], tags:['wireguard','vpn','tunnel','security']
  },

  // ─── BACKUP & RESTORE ───
  { title:'Backup Strategies', category:'System', os:['All Linux'],
    description:'Server backup techniques using rsync, tar, and automated scripts.',
    commands:[
      {label:'Rsync Local',code:'rsync -avz --progress /opt/myapp/ /backup/myapp/',explanation:'Syncs a directory locally with compression and progress.',result:'sent 15,234 bytes  received 312 bytes'},
      {label:'Rsync Remote',code:'rsync -avz -e ssh /opt/myapp/ user@backup-server:/backup/myapp/',explanation:'Syncs directory to a remote server via SSH.',result:''},
      {label:'Tar Backup',code:'tar -czf /backup/myapp_$(date +%Y%m%d).tar.gz /opt/myapp/',explanation:'Creates a dated compressed archive.',result:''},
      {label:'DB Backup Script',code:'#!/bin/bash\nDATE=$(date +%Y%m%d_%H%M)\nmongodump --out /backup/mongo_$DATE\ntar -czf /backup/mongo_$DATE.tar.gz /backup/mongo_$DATE\nrm -rf /backup/mongo_$DATE\nfind /backup -name "mongo_*.tar.gz" -mtime +7 -delete\necho "Backup complete: mongo_$DATE.tar.gz"',explanation:'Full MongoDB backup script with 7-day retention.',result:''},
      {label:'Cron Schedule',code:'0 2 * * * /opt/scripts/backup.sh >> /var/log/backup.log 2>&1',explanation:'Runs backup daily at 2 AM.',result:''},
      {label:'Restore Tar',code:'tar -xzf /backup/myapp_20260215.tar.gz -C /opt/restore/',explanation:'Extracts backup to restore directory.',result:''},
      {label:'Rsync Dry Run',code:'rsync -avzn /opt/myapp/ /backup/myapp/',explanation:'Preview what rsync would do without making changes (-n flag).',result:''}
    ], tags:['backup','rsync','tar','restore','cron']
  },

  // ─── CI/CD ───
  { title:'GitHub Actions CI/CD', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Automate build, test, and deployment with GitHub Actions.',
    commands:[
      {label:'Basic Workflow',code:'# .github/workflows/deploy.yml\nname: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - uses: actions/setup-node@v4\n      with:\n        node-version: 20\n    - run: npm ci\n    - run: npm run build\n    - run: npm test',explanation:'Basic CI pipeline that builds and tests on push to main.',result:''},
      {label:'Deploy via SSH',code:'    - name: Deploy to Server\n      uses: appleboy/ssh-action@v1\n      with:\n        host: ${{ secrets.HOST }}\n        username: ${{ secrets.USER }}\n        key: ${{ secrets.SSH_KEY }}\n        script: |\n          cd /opt/myapp\n          git pull origin main\n          npm ci --production\n          pm2 restart myapp',explanation:'SSH into server and deploy after successful build.',result:''},
      {label:'Docker Build & Push',code:'    - name: Build and Push\n      uses: docker/build-push-action@v5\n      with:\n        push: true\n        tags: user/myapp:latest',explanation:'Builds Docker image and pushes to registry.',result:''},
      {label:'Secrets Setup',code:'# Go to: Repo Settings → Secrets → Actions\n# Add: HOST, USER, SSH_KEY\n# Reference: ${{ secrets.SECRET_NAME }}',explanation:'Store sensitive data as GitHub Secrets.',result:''}
    ], tags:['github-actions','ci-cd','deployment','automation']
  },

  // ─── HAProxy ───
  { title:'HAProxy Load Balancer', category:'Web Server', os:['All Linux'],
    description:'Set up HAProxy for high-availability load balancing.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install haproxy -y',explanation:'Installs HAProxy on Ubuntu.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install haproxy -y',explanation:'Installs HAProxy on CentOS.',result:''},
      {label:'Config',code:'# /etc/haproxy/haproxy.cfg\nfrontend http_front\n  bind *:80\n  default_backend servers\n\nbackend servers\n  balance roundrobin\n  option httpchk GET /health\n  server web1 10.0.0.1:3000 check\n  server web2 10.0.0.2:3000 check\n  server web3 10.0.0.3:3000 check backup',explanation:'Round-robin config with health checks and a backup server.',result:''},
      {label:'Stats Dashboard',code:'listen stats\n  bind *:8404\n  stats enable\n  stats uri /stats\n  stats refresh 10s\n  stats auth admin:password',explanation:'Adds a web-based stats dashboard on port 8404.',result:''},
      {label:'Start',code:'sudo systemctl enable --now haproxy',explanation:'Starts HAProxy.',result:''},
      {label:'Validate',code:'sudo haproxy -c -f /etc/haproxy/haproxy.cfg',explanation:'Validates config before restart.',result:'Configuration file is valid'}
    ], tags:['haproxy','loadbalancer','ha','proxy']
  },

  // ─── PHP ───
  { title:'PHP Setup (Ubuntu)', category:'Installation', os:['Ubuntu/Debian'],
    description:'Install PHP and common extensions for web applications.',
    commands:[
      {label:'Install PHP',code:'sudo apt install php php-fpm php-mysql php-curl php-gd php-mbstring php-xml php-zip -y',explanation:'Installs PHP-FPM with common extensions.',result:''},
      {label:'Check Version',code:'php -v',explanation:'Shows installed PHP version.',result:'PHP 8.1.2'},
      {label:'Nginx Config',code:'location ~ \\.php$ {\n  include snippets/fastcgi-php.conf;\n  fastcgi_pass unix:/run/php/php8.1-fpm.sock;\n}',explanation:'Nginx config block to process PHP files.',result:''},
      {label:'Restart FPM',code:'sudo systemctl restart php8.1-fpm',explanation:'Restarts PHP-FPM service.',result:''},
      {label:'PHP Info',code:'echo "<?php phpinfo(); ?>" | sudo tee /var/www/html/info.php',explanation:'Creates a PHP info page for debugging.',result:''}
    ], tags:['php','web','ubuntu','installation']
  },
  { title:'PHP Setup (CentOS)', category:'Installation', os:['CentOS/RHEL'],
    description:'Install PHP on CentOS/RHEL using Remi repository.',
    commands:[
      {label:'Add Remi Repo',code:'sudo dnf install epel-release -y\nsudo dnf install https://rpms.remirepo.net/enterprise/remi-release-9.rpm -y',explanation:'Adds Remi repository for latest PHP versions.',result:''},
      {label:'Enable PHP 8.2',code:'sudo dnf module reset php\nsudo dnf module enable php:remi-8.2',explanation:'Enables PHP 8.2 module from Remi.',result:''},
      {label:'Install',code:'sudo dnf install php php-fpm php-mysqlnd php-curl php-gd php-mbstring php-xml -y',explanation:'Installs PHP-FPM with common extensions.',result:''},
      {label:'Start',code:'sudo systemctl enable --now php-fpm',explanation:'Starts PHP-FPM service.',result:''},
      {label:'SELinux',code:'sudo setsebool -P httpd_execmem 1',explanation:'Allows PHP memory execution through SELinux.',result:''}
    ], tags:['php','web','centos','installation']
  },

  // ─── PYTHON ───
  { title:'Python & Pip Setup', category:'Installation', os:['All Linux'],
    description:'Install Python 3, pip, and virtual environments.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install python3 python3-pip python3-venv -y',explanation:'Installs Python 3 with pip and venv module.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install python3 python3-pip -y',explanation:'Installs Python 3 on CentOS.',result:''},
      {label:'Create Venv',code:'python3 -m venv /opt/myapp/venv',explanation:'Creates an isolated virtual environment.',result:''},
      {label:'Activate',code:'source /opt/myapp/venv/bin/activate',explanation:'Activates the virtual environment.',result:'(venv) $'},
      {label:'Install Packages',code:'pip install flask gunicorn requests',explanation:'Installs packages inside the venv.',result:'Successfully installed flask-3.0.0'},
      {label:'Freeze',code:'pip freeze > requirements.txt',explanation:'Saves all dependencies to a file.',result:''},
      {label:'Gunicorn Service',code:'gunicorn --workers 4 --bind 0.0.0.0:8000 app:app',explanation:'Runs a Flask/Django app with 4 worker processes.',result:'Listening at: http://0.0.0.0:8000'}
    ], tags:['python','pip','venv','gunicorn']
  },

  // ─── JAVA ───
  { title:'Java JDK Setup', category:'Installation', os:['All Linux'],
    description:'Install OpenJDK for running Java applications.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install openjdk-17-jdk -y',explanation:'Installs OpenJDK 17 on Ubuntu.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install java-17-openjdk-devel -y',explanation:'Installs OpenJDK 17 on CentOS.',result:''},
      {label:'Verify',code:'java -version',explanation:'Shows Java version.',result:'openjdk version "17.0.9"'},
      {label:'Set JAVA_HOME',code:'echo "export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))" >> ~/.bashrc\nsource ~/.bashrc',explanation:'Sets JAVA_HOME environment variable.',result:''},
      {label:'Run JAR',code:'java -jar myapp.jar --server.port=8080',explanation:'Runs a Spring Boot or other JAR application.',result:'Started application in 3.2 seconds'}
    ], tags:['java','jdk','spring','installation']
  },

  // ─── FILE SHARING ───
  { title:'NFS File Sharing', category:'Network', os:['All Linux'],
    description:'Share directories between Linux servers using NFS.',
    commands:[
      {label:'Install Server (Ubuntu)',code:'sudo apt install nfs-kernel-server -y',explanation:'Installs NFS server.',result:''},
      {label:'Install Server (CentOS)',code:'sudo dnf install nfs-utils -y\nsudo systemctl enable --now nfs-server',explanation:'Installs and starts NFS on CentOS.',result:''},
      {label:'Export Directory',code:'echo "/shared 10.0.0.0/24(rw,sync,no_subtree_check)" | sudo tee -a /etc/exports\nsudo exportfs -ra',explanation:'Shares /shared with the 10.0.0.x subnet.',result:''},
      {label:'Client Mount',code:'sudo mount 10.0.0.1:/shared /mnt/shared',explanation:'Mounts the NFS share on a client machine.',result:''},
      {label:'Persist Mount',code:'echo "10.0.0.1:/shared /mnt/shared nfs defaults 0 0" | sudo tee -a /etc/fstab',explanation:'Auto-mounts on boot.',result:''}
    ], tags:['nfs','file-sharing','network','mount']
  },

  // ─── ELASTICSEARCH ───
  { title:'Elasticsearch Setup', category:'Database', os:['All Linux'],
    description:'Install Elasticsearch for full-text search and log analytics.',
    commands:[
      {label:'Import Key',code:'wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg',explanation:'Adds Elastic GPG key.',result:''},
      {label:'Add Repo (Ubuntu)',code:'echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-8.x.list',explanation:'Adds APT repository.',result:''},
      {label:'Install (Ubuntu)',code:'sudo apt update && sudo apt install elasticsearch -y',explanation:'Installs Elasticsearch.',result:''},
      {label:'Install (CentOS)',code:'sudo rpm --import https://artifacts.elastic.co/GPG-KEY-elasticsearch\n# Add /etc/yum.repos.d/elasticsearch.repo then:\nsudo dnf install elasticsearch -y',explanation:'Installs on CentOS via YUM repo.',result:''},
      {label:'Start',code:'sudo systemctl enable --now elasticsearch',explanation:'Starts the service.',result:''},
      {label:'Test',code:'curl -X GET "localhost:9200"',explanation:'Tests the API endpoint.',result:'{"name":"node-1","cluster_name":"elasticsearch","tagline":"You Know, for Search"}'}
    ], tags:['elasticsearch','search','elk','logging']
  },

  // ─── PERFORMANCE TUNING ───
  { title:'Linux Performance Tuning', category:'System', os:['All Linux'],
    description:'Kernel and system-level performance optimizations for servers.',
    commands:[
      {label:'File Limits',code:'echo "* soft nofile 65535\n* hard nofile 65535" | sudo tee -a /etc/security/limits.conf',explanation:'Increases max open files per process (needed for high-traffic servers).',result:''},
      {label:'Sysctl TCP',code:'sudo tee -a /etc/sysctl.conf <<EOF\nnet.core.somaxconn = 65535\nnet.ipv4.tcp_max_syn_backlog = 65535\nnet.ipv4.tcp_tw_reuse = 1\nnet.ipv4.ip_local_port_range = 1024 65535\nvm.swappiness = 10\nEOF\nsudo sysctl -p',explanation:'Optimizes TCP stack for high connections and reduces swap usage.',result:''},
      {label:'Check Limits',code:'ulimit -n',explanation:'Shows current file descriptor limit.',result:'65535'},
      {label:'IO Scheduler',code:'cat /sys/block/sda/queue/scheduler',explanation:'Shows disk I/O scheduler. "none" or "mq-deadline" are best for SSDs.',result:'[none] mq-deadline'},
      {label:'Kernel Info',code:'uname -a',explanation:'Shows kernel version and architecture.',result:'Linux server 5.15.0 x86_64'}
    ], tags:['performance','tuning','sysctl','optimization']
  },

  // ─── ANSIBLE ───
  { title:'Ansible Basics', category:'DevOps', os:['All Linux','macOS'],
    description:'Automate server configuration and deployment with Ansible.',
    commands:[
      {label:'Install',code:'pip3 install ansible',explanation:'Installs Ansible via pip.',result:''},
      {label:'Inventory',code:'# /etc/ansible/hosts\n[webservers]\n10.0.0.1\n10.0.0.2\n\n[dbservers]\n10.0.0.3',explanation:'Defines groups of servers to manage.',result:''},
      {label:'Ping All',code:'ansible all -m ping',explanation:'Tests connectivity to all servers.',result:'10.0.0.1 | SUCCESS => {"ping":"pong"}'},
      {label:'Run Command',code:'ansible webservers -m shell -a "uptime"',explanation:'Runs a shell command on all webservers.',result:'10.0.0.1 | SUCCESS | rc=0 >> up 42 days'},
      {label:'Playbook',code:'# deploy.yml\n- hosts: webservers\n  become: true\n  tasks:\n  - name: Update packages\n    apt:\n      update_cache: yes\n      upgrade: dist\n  - name: Restart nginx\n    service:\n      name: nginx\n      state: restarted',explanation:'Playbook to update and restart Nginx on all web servers.',result:''},
      {label:'Run Playbook',code:'ansible-playbook deploy.yml',explanation:'Executes the playbook.',result:'PLAY RECAP\n10.0.0.1 : ok=3  changed=2  failed=0'}
    ], tags:['ansible','automation','devops','iac']
  }
];
