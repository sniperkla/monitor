# PM2 Deployment Skill

## Description
Expert at deploying Node.js, Python, and other applications with PM2 process manager.

## Pre-deployment Checklist
Before running `pm2 start`, ALWAYS check:
1. Project structure: `ls -la`
2. Package config: `cat package.json` (for Node.js)
3. Dependencies: `test -d node_modules && echo "installed" || echo "need npm install"`
4. Build step: Check if `npm run build` is needed
5. Existing PM2 config: `test -f ecosystem.config.js && cat ecosystem.config.js`

## Deployment Workflow

### Step 1: Discover Project Type
```bash
ls -la && cat package.json 2>/dev/null | head -30
```

### Step 2: Install Dependencies (if needed)
```bash
test -d node_modules && echo "deps OK" || npm install
```

### Step 3: Build (if needed)
For Next.js, React, Vue, TypeScript projects:
```bash
npm run build
```

### Step 4: Deploy with PM2

#### Node.js Applications
```bash
# With ecosystem config
pm2 start ecosystem.config.js

# Without ecosystem config - use correct entry point
pm2 start src/index.js --name "app-name"

# Next.js
pm2 start npm --name "myapp" -- run start

# Express server
pm2 start server.js --name "api-server"
```

#### Python Applications
```bash
# Simple Python app
pm2 start app.py --name "myapp" --interpreter python3

# Flask
pm2 start "flask run --host 0.0.0.0 --port 5000" --name "flask-app" --interpreter bash

# FastAPI
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name "fastapi-app" --interpreter bash

# With specific Python version
pm2 start app.py --name "myapp" --interpreter /usr/bin/python3.10
```

#### Go Applications
```bash
# Build first
go build -o app .

# Then run with PM2
pm2 start ./app --name "go-app"
```

## PM2 Management Commands
- List processes: `pm2 list`
- Monitor: `pm2 monit`
- Logs: `pm2 logs APPNAME --lines 50`
- Stop: `pm2 stop APPNAME`
- Restart: `pm2 restart APPNAME`
- Delete: `pm2 delete APPNAME`
- Save config: `pm2 save`
- Startup script: `pm2 startup`

## Common Issues
- **Port in use**: Check with `lsof -i :PORT`, kill or change port
- **Module not found**: Run `npm install` or check NODE_PATH
- **Permission denied**: Check file permissions, use correct user
- **Memory limit**: Use `--max-memory-restart 500M`

## Ecosystem Config Example
```javascript
module.exports = {
  apps: [{
    name: "my-app",
    script: "./src/index.js",
    instances: "max",
    exec_mode: "cluster",
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}
```
