module.exports = [
  // ─── GITHUB ───
  { title:'Git Basics', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Essential Git commands for version control: add, commit, push, and more.',
    commands:[
      {label:'Initialize',code:'git init',explanation:'Initialize a new Git repository.',result:'Initialized empty Git repository in /path/to/repo/.git/'},
      {label:'Status',code:'git status',explanation:'Check the status of your working directory.',result:'On branch main\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)'},
      {label:'Add File',code:'git add filename.js',explanation:'Add a specific file to the staging area.',result:''},
      {label:'Add All',code:'git add .',explanation:'Add all changed files to the staging area.',result:''},
      {label:'Commit',code:'git commit -m "Initial commit"',explanation:'Record changes to the repository with a message.',result:'[main (root-commit) 1234abc] Initial commit'},
      {label:'Remote Add',code:'git remote add origin https://github.com/user/repo.git',explanation:'Connect your local repo to a remote server.',result:''},
      {label:'Push',code:'git push -u origin main',explanation:'Upload local commits to the remote repository.',result:'Branch main set up to track remote branch main from origin.'},
      {label:'Pull',code:'git pull',explanation:'Fetch and merge changes from the remote repository.',result:'Already up to date.'},
      {label:'Clone',code:'git clone https://github.com/user/repo.git',explanation:'Download a repository from a remote server.',result:'Cloning into \'repo\'...'},
      {label:'Log',code:'git log --oneline',explanation:'View commit history in a compact format.',result:'1234abc Initial commit\n5678def Added feature X'}
    ], tags:['git','basic','version-control','beginner']
  },
  { title:'GitHub CLI (gh)', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Manage GitHub repositories, PRs, and issues from the terminal.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install gh -y',explanation:'Installs GitHub CLI on Ubuntu.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install gh -y',explanation:'Installs on CentOS (requires EPEL or direct repo).',result:''},
      {label:'Install (macOS)',code:'brew install gh',explanation:'Installs via Homebrew.',result:''},
      {label:'Login',code:'gh auth login',explanation:'Authenticates with GitHub. Select HTTPS or SSH.',result:'✓ Logged in as username'},
      {label:'Clone Repo',code:'gh repo clone owner/repo',explanation:'Clones a repository.',result:'Cloning into repo...'},
      {label:'Create Repo',code:'gh repo create my-project --public --clone',explanation:'Creates a new public repo and clones it.',result:'✓ Created repository owner/my-project'},
      {label:'Create PR',code:'gh pr create --title "Feature X" --body "Description" --base main',explanation:'Creates a Pull Request from current branch.',result:'https://github.com/owner/repo/pull/42'},
      {label:'List PRs',code:'gh pr list',explanation:'Shows open pull requests.',result:'#42  Feature X  feature-x  OPEN'},
      {label:'Merge PR',code:'gh pr merge 42 --squash --delete-branch',explanation:'Squash-merges PR #42 and deletes the branch.',result:'✓ Merged pull request #42'},
      {label:'View Issues',code:'gh issue list --label bug',explanation:'Lists open bug issues.',result:''}
    ], tags:['github','gh','cli','pull-request','issues']
  },
  { title:'Git Advanced Operations', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Advanced Git commands for rebasing, cherry-picking, and debugging.',
    commands:[
      {label:'Interactive Rebase',code:'git rebase -i HEAD~5',explanation:'Edit, squash, or reorder the last 5 commits.',result:'pick abc1234 First commit\npick def5678 Second commit'},
      {label:'Rebase on Main',code:'git checkout feature\ngit rebase main',explanation:'Replays feature branch commits on top of latest main.',result:'Successfully rebased'},
      {label:'Cherry Pick',code:'git cherry-pick abc1234',explanation:'Applies a specific commit from another branch.',result:'[feature abc1234] Fix: resolved bug'},
      {label:'Bisect',code:'git bisect start\ngit bisect bad HEAD\ngit bisect good v1.0.0',explanation:'Binary search to find which commit introduced a bug.',result:'Bisecting: 15 revisions left to test'},
      {label:'Stash Named',code:'git stash push -m "work in progress"',explanation:'Saves work with a descriptive name.',result:'Saved working directory'},
      {label:'Stash Pop',code:'git stash list\ngit stash pop stash@{0}',explanation:'Lists stashes and restores one.',result:''},
      {label:'Reflog',code:'git reflog -10',explanation:'Shows history of HEAD movements. Useful for recovering lost commits.',result:'abc1234 HEAD@{0}: commit: latest change'},
      {label:'Clean Untracked',code:'git clean -fd',explanation:'Removes all untracked files and directories.',result:'Removing build/\nRemoving temp.log'}
    ], tags:['git','rebase','cherry-pick','bisect','advanced']
  },
  { title:'Git Branch Strategy', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Best practices for Git branching workflows (GitFlow & GitHub Flow).',
    commands:[
      {label:'GitHub Flow',code:'# Simple workflow:\n# 1. main (always deployable)\n# 2. Create feature branch from main\n# 3. Commit, push, open PR\n# 4. Review & merge to main\n# 5. Deploy\ngit checkout -b feature/login-page\ngit push -u origin feature/login-page',explanation:'GitHub Flow: simple trunk-based development.',result:''},
      {label:'GitFlow',code:'# Branches:\n# main     → production releases\n# develop  → integration branch\n# feature/ → new features\n# release/ → release prep\n# hotfix/  → urgent production fixes\ngit checkout -b feature/new-api develop',explanation:'GitFlow: structured branching for larger teams.',result:''},
      {label:'Hotfix',code:'git checkout -b hotfix/fix-crash main\n# ... fix the bug ...\ngit commit -m "fix: resolve crash on login"\ngit checkout main && git merge hotfix/fix-crash\ngit checkout develop && git merge hotfix/fix-crash\ngit branch -d hotfix/fix-crash',explanation:'Emergency fix merged to both main and develop.',result:''},
      {label:'Tags',code:'git tag -a v1.2.0 -m "Release 1.2.0"\ngit push origin v1.2.0',explanation:'Creates an annotated tag for releases.',result:''},
      {label:'List Tags',code:'git tag -l "v1.*" --sort=-creatordate',explanation:'Lists version tags sorted by date.',result:'v1.2.0\nv1.1.0\nv1.0.0'}
    ], tags:['git','branching','gitflow','workflow']
  },
  { title:'.gitignore Templates', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Common .gitignore patterns for various project types.',
    commands:[
      {label:'Node.js',code:'# .gitignore for Node.js\nnode_modules/\n.env\n.env.local\ndist/\nbuild/\n*.log\nnpm-debug.log*\n.DS_Store\ncoverage/',explanation:'Ignores dependencies, environment files, and build output.',result:''},
      {label:'Python',code:'# .gitignore for Python\n__pycache__/\n*.py[cod]\n*.so\nvenv/\n.env\n*.egg-info/\ndist/\nbuild/\n.tox/',explanation:'Ignores compiled files, virtualenvs, and build artifacts.',result:''},
      {label:'Java',code:'# .gitignore for Java/Spring\ntarget/\n*.class\n*.jar\n*.war\n.idea/\n*.iml\n.gradle/\nbuild/',explanation:'Ignores build output and IDE files.',result:''},
      {label:'Docker',code:'# .gitignore for Docker projects\n.env\ndocker-compose.override.yml\n*.log\ndata/\nvolumes/',explanation:'Ignores environment and persistent data.',result:''},
      {label:'Generate',code:'curl -sL https://www.toptal.com/developers/gitignore/api/node,python,macos,linux,visualstudiocode > .gitignore',explanation:'Auto-generates .gitignore from gitignore.io API.',result:''}
    ], tags:['git','gitignore','templates']
  },
  { title:'GitHub Actions Workflows', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Advanced GitHub Actions patterns: matrix builds, caching, Docker, and releases.',
    commands:[
      {label:'Matrix Build',code:'jobs:\n  test:\n    strategy:\n      matrix:\n        node: [18, 20, 22]\n        os: [ubuntu-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps:\n    - uses: actions/checkout@v4\n    - uses: actions/setup-node@v4\n      with:\n        node-version: ${{ matrix.node }}\n    - run: npm ci && npm test',explanation:'Tests across multiple Node versions and operating systems.',result:''},
      {label:'Cache Dependencies',code:'    - uses: actions/cache@v4\n      with:\n        path: ~/.npm\n        key: ${{ runner.os }}-npm-${{ hashFiles("**/package-lock.json") }}\n        restore-keys: ${{ runner.os }}-npm-',explanation:'Caches npm dependencies for faster builds.',result:''},
      {label:'Docker Push',code:'    - uses: docker/login-action@v3\n      with:\n        registry: ghcr.io\n        username: ${{ github.actor }}\n        password: ${{ secrets.GITHUB_TOKEN }}\n    - uses: docker/build-push-action@v5\n      with:\n        push: true\n        tags: ghcr.io/${{ github.repository }}:latest',explanation:'Builds and pushes Docker image to GitHub Container Registry.',result:''},
      {label:'Auto Release',code:'on:\n  push:\n    tags: ["v*"]\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - uses: softprops/action-gh-release@v1\n      with:\n        generate_release_notes: true',explanation:'Automatically creates GitHub Release when a version tag is pushed.',result:''},
      {label:'Scheduled',code:'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  weekly:\n    runs-on: ubuntu-latest\n    steps:\n    - run: echo "Weekly job"',explanation:'Runs every Monday at 6 AM UTC.',result:''}
    ], tags:['github-actions','ci-cd','docker','matrix','cache']
  },
  { title:'GitHub Repository Settings', category:'DevOps', os:['All Linux','macOS','Windows'],
    description:'Optimize your GitHub repo with branch protection, templates, and security.',
    commands:[
      {label:'Branch Protection',code:'# Settings → Branches → Add Rule:\n# Branch name pattern: main\n# ✅ Require pull request reviews (1+)\n# ✅ Require status checks to pass\n# ✅ Require linear history\n# ✅ Include administrators',explanation:'Prevents direct pushes to main. All changes go through PRs.',result:''},
      {label:'PR Template',code:'# .github/pull_request_template.md\n## Description\n<!-- What does this PR do? -->\n\n## Checklist\n- [ ] Tests added\n- [ ] Documentation updated\n- [ ] No breaking changes\n\n## Screenshots\n<!-- If applicable -->',explanation:'Auto-fills PR descriptions with a checklist.',result:''},
      {label:'Issue Templates',code:'# .github/ISSUE_TEMPLATE/bug_report.md\n---\nname: Bug Report\nabout: Report a bug\nlabels: bug\n---\n\n## Describe the bug\n\n## Steps to reproduce\n\n## Expected behavior\n\n## Screenshots',explanation:'Structured issue templates for bug reports.',result:''},
      {label:'CODEOWNERS',code:'# .github/CODEOWNERS\n*.js    @frontend-team\n*.py    @backend-team\n/docs/  @docs-team\n*       @lead-dev',explanation:'Auto-assigns reviewers based on file paths.',result:''},
      {label:'Dependabot',code:'# .github/dependabot.yml\nversion: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n    schedule:\n      interval: "weekly"',explanation:'Auto-creates PRs for dependency updates.',result:''}
    ], tags:['github','settings','security','templates','codeowners']
  },

  // ─── MORE SYSTEM TOPICS ───
  { title:'Logrotate Configuration', category:'System', os:['All Linux'],
    description:'Automatically rotate, compress, and manage log files.',
    commands:[
      {label:'App Config',code:'# /etc/logrotate.d/myapp\n/var/log/myapp/*.log {\n  daily\n  missingok\n  rotate 14\n  compress\n  delaycompress\n  notifempty\n  create 0640 www-data www-data\n  postrotate\n    systemctl reload myapp > /dev/null 2>&1 || true\n  endscript\n}',explanation:'Rotates logs daily, keeps 14 days, compresses old ones.',result:''},
      {label:'Test Config',code:'sudo logrotate -d /etc/logrotate.d/myapp',explanation:'Dry-run to test configuration without actually rotating.',result:'rotating pattern: /var/log/myapp/*.log'},
      {label:'Force Rotate',code:'sudo logrotate -f /etc/logrotate.d/myapp',explanation:'Forces immediate rotation.',result:''},
      {label:'Check Status',code:'cat /var/lib/logrotate/status',explanation:'Shows when each log was last rotated.',result:'"/var/log/myapp/app.log" 2026-2-15'}
    ], tags:['logrotate','logs','maintenance','cleanup']
  },
  { title:'RAID Setup (mdadm)', category:'System', os:['All Linux'],
    description:'Create software RAID arrays for redundancy and performance.',
    commands:[
      {label:'Install',code:'sudo apt install mdadm -y   # Ubuntu\nsudo dnf install mdadm -y   # CentOS',explanation:'Installs mdadm for software RAID management.',result:''},
      {label:'RAID 1 (Mirror)',code:'sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sdb /dev/sdc',explanation:'Creates a mirrored RAID 1 array from 2 disks.',result:'mdadm: array /dev/md0 started'},
      {label:'RAID 5 (Stripe+Parity)',code:'sudo mdadm --create /dev/md0 --level=5 --raid-devices=3 /dev/sdb /dev/sdc /dev/sdd',explanation:'Creates RAID 5 with 3 disks (can survive 1 disk failure).',result:''},
      {label:'Check Status',code:'cat /proc/mdstat',explanation:'Shows RAID status and sync progress.',result:'md0 : active raid1 sdb[1] sdc[0]\n      1048576 blocks [2/2] [UU]'},
      {label:'Save Config',code:'sudo mdadm --detail --scan | sudo tee -a /etc/mdadm/mdadm.conf',explanation:'Saves array config for reboot persistence.',result:''},
      {label:'Replace Disk',code:'sudo mdadm /dev/md0 --remove /dev/sdc\nsudo mdadm /dev/md0 --add /dev/sdd',explanation:'Hot-replace a failed disk in the array.',result:''}
    ], tags:['raid','mdadm','storage','redundancy']
  },
  { title:'DNS with BIND', category:'Network', os:['All Linux'],
    description:'Set up a DNS server using BIND9.',
    commands:[
      {label:'Install (Ubuntu)',code:'sudo apt install bind9 bind9-utils -y',explanation:'Installs BIND9 DNS server.',result:''},
      {label:'Install (CentOS)',code:'sudo dnf install bind bind-utils -y',explanation:'Installs on CentOS.',result:''},
      {label:'Forward Zone',code:'# /etc/bind/named.conf.local (Ubuntu)\n# /etc/named.conf (CentOS)\nzone "example.local" {\n  type master;\n  file "/etc/bind/zones/db.example.local";\n};',explanation:'Defines a forward lookup zone.',result:''},
      {label:'Zone File',code:'$TTL 604800\n@   IN  SOA ns1.example.local. admin.example.local. (\n        2024021501 ; Serial\n        3600       ; Refresh\n        1800       ; Retry\n        604800     ; Expire\n        86400 )    ; Min TTL\n@   IN  NS  ns1.example.local.\nns1 IN  A   10.0.0.1\nweb IN  A   10.0.0.10\ndb  IN  A   10.0.0.20',explanation:'Zone file mapping hostnames to IPs.',result:''},
      {label:'Check Config',code:'sudo named-checkconf\nsudo named-checkzone example.local /etc/bind/zones/db.example.local',explanation:'Validates DNS configuration.',result:'zone example.local/IN: loaded serial 2024021501\nOK'},
      {label:'Restart',code:'sudo systemctl restart named  # CentOS\nsudo systemctl restart bind9  # Ubuntu',explanation:'Applies DNS changes.',result:''}
    ], tags:['dns','bind','nameserver','network']
  },
  { title:'Docker Registry (Private)', category:'Container', os:['All Linux'],
    description:'Run a private Docker image registry for your team.',
    commands:[
      {label:'Run Registry',code:'docker run -d -p 5000:5000 --restart always --name registry \\\n  -v /opt/registry:/var/lib/registry \\\n  registry:2',explanation:'Starts a private registry on port 5000.',result:''},
      {label:'Tag Image',code:'docker tag myapp:latest localhost:5000/myapp:latest',explanation:'Tags an image for the private registry.',result:''},
      {label:'Push',code:'docker push localhost:5000/myapp:latest',explanation:'Pushes image to private registry.',result:'latest: digest: sha256:...'},
      {label:'Pull',code:'docker pull localhost:5000/myapp:latest',explanation:'Pulls from private registry.',result:''},
      {label:'List Images',code:'curl -s http://localhost:5000/v2/_catalog | jq .',explanation:'Lists all images in the registry.',result:'{"repositories":["myapp"]}'},
      {label:'With Auth',code:'docker run -d -p 5000:5000 --restart always \\\n  -v /opt/auth:/auth \\\n  -e REGISTRY_AUTH=htpasswd \\\n  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \\\n  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \\\n  registry:2',explanation:'Registry with basic HTTP authentication.',result:''}
    ], tags:['docker','registry','private','container']
  },
  { title:'SSL/TLS Best Practices', category:'Security', os:['All Linux'],
    description:'Optimize SSL/TLS configuration for security and performance.',
    commands:[
      {label:'Strong Ciphers',code:'ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384;\nssl_prefer_server_ciphers on;',explanation:'Nginx config for strong encryption only (disables TLSv1.0/1.1).',result:''},
      {label:'OCSP Stapling',code:'ssl_stapling on;\nssl_stapling_verify on;\nresolver 8.8.8.8 8.8.4.4 valid=300s;',explanation:'Speeds up SSL validation by stapling OCSP responses.',result:''},
      {label:'Session Cache',code:'ssl_session_cache shared:SSL:10m;\nssl_session_timeout 1d;\nssl_session_tickets off;',explanation:'Improves SSL performance with session caching.',result:''},
      {label:'Test Grade',code:'# Visit: https://www.ssllabs.com/ssltest/\n# Enter your domain to get an A+ rating report',explanation:'Use SSL Labs to verify your SSL configuration.',result:''},
      {label:'Check Cert',code:'echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates -subject',explanation:'Checks certificate expiry and subject from command line.',result:'notBefore=Feb 15 00:00:00 2026\nnotAfter=May 16 00:00:00 2026'}
    ], tags:['ssl','tls','security','ciphers','nginx']
  },
  // ─── ADVANCED TOOLS ───
  { title:'Traefik Proxy', category:'Web Server', os:['All Linux'],
    description:'Modern reverse proxy for Docker that auto-discovers containers.',
    commands:[
      {label:'docker-compose.yml',code:'version: "3"\nservices:\n  traefik:\n    image: "traefik:v2.10"\n    command:\n      - "--api.insecure=true"\n      - "--providers.docker=true"\n      - "--entrypoints.web.address=:80"\n    ports:\n      - "80:80"\n      - "8080:8080"\n    volumes:\n      - "/var/run/docker.sock:/var/run/docker.sock:ro"',explanation:'Standard Traefik setup listening on port 80.',result:''},
      {label:'Add Service',code:'  whoami:\n    image: "traefik/whoami"\n    labels:\n      - "traefik.http.routers.whoami.rule=Host(`whoami.localhost`)"',explanation:'Labels automatically configure routing. Browse whoami.localhost!',result:''},
      {label:'Dashboard',code:'http://localhost:8080/dashboard/',explanation:'View routes and services in the web UI.',result:''},
      {label:'Middleware',code:'labels:\n  - "traefik.http.middlewares.auth.basicauth.users=user:password_hash"\n  - "traefik.http.routers.app.middlewares=auth"',explanation:'Adds Basic Auth to a service.',result:''}
    ], tags:['traefik','proxy','docker','loadbalancer']
  },
  { title:'JSON Processing (jq)', category:'Tools', os:['All Linux','macOS'],
    description:'Command-line JSON processor. Essential for API data.',
    commands:[
      {label:'Install',code:'sudo apt install jq -y  # Ubuntu',explanation:'Installs jq.',result:''},
      {label:'Pretty Print',code:'echo \'{"foo": "bar"}\' | jq .',explanation:'Formats JSON for readability.',result:'{\n  "foo": "bar"\n}'},
      {label:'Extract Value',code:'curl -s https://api.github.com/users/octocat | jq .name',explanation:'Get specific field from JSON response.',result:'"The Octocat"'},
      {label:'Filter List',code:'kubectl get pods -o json | jq \'.items[].metadata.name\'',explanation:'Extract names from a list of objects.',result:'"pod-1"\n"pod-2"'},
      {label:'Complex Filter',code:'cat data.json | jq \'.users[] | select(.age > 30) | .name\'',explanation:'Selects objects based on a condition.',result:''}
    ], tags:['jq','json','parsing','api']
  },
  { title:'Network Debug (tcpdump/nmap)', category:'Network', os:['All Linux'],
    description:'Advanced network analysis and packet capture.',
    commands:[
      {label:'Capture Port 80',code:'sudo tcpdump -i eth0 port 80 -A',explanation:' sniff traffic on port 80 (ASCII mode). See HTTP headers.',result:''},
      {label:'Scan Network',code:'nmap -sn 192.168.1.0/24',explanation:'Ping scan to find live hosts on the subnet.',result:'Nmap scan report for 192.168.1.1\nHost is up.'},
      {label:'Scan Ports',code:'nmap -p 22,80,443 192.168.1.5',explanation:'Check specific open ports on a target.',result:'80/tcp open http'},
      {label:'Check Listening',code:'sudo netstat -tulpn | grep LISTEN',explanation:'Show all processes listening for connections.',result:'tcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN 1234/nginx'},
      {label:'Track Route',code:'mtr google.com',explanation:'Real-time traceroute with packet loss stats.',result:'(Interactive TUI)'}
    ], tags:['network','tcpdump','nmap','debug']
  },
  { title:'System Tracing (strace/lsof)', category:'System', os:['All Linux'],
    description:'Debug processes by tracing system calls and open files.',
    commands:[
      {label:'Trace Command',code:'strace ls',explanation:'Shows every system call "ls" makes (open, read, write).',result:'execve("/usr/bin/ls", ...)\nopenat(...)'},
      {label:'Attach to PID',code:'sudo strace -p 1234',explanation:'Debug a running process (e.g. why is Nginx hanging?).',result:''},
      {label:'List Open Files',code:'sudo lsof -p 1234',explanation:'List all files/sockets opened by a process ID.',result:'nginx 1234 root 3u IPv4 0x... TCP *:80 (LISTEN)'},
      {label:'Who Uses File?',code:'sudo lsof /var/log/syslog',explanation:'Find which process is holding a file open.',result:'rsyslogd 890 syslog 5w REG ...'}
    ], tags:['debug','strace','lsof','kernel','syscall']
  }
];
