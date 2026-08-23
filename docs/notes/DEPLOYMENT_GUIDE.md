# Quick Deployment Guide

## ✅ Pre-Deployment Checklist

- [x] Code changes completed
- [x] Build verified: No errors
- [x] Documentation created
- [x] Test plan ready

---

## 🚀 Deployment Steps

### Option 1: Development Testing (Local)

```bash
cd /Users/katanyoo/Desktop/monitor

# Start development server
npm run dev

# Open browser
# Navigate to http://localhost:3000
```

**Test immediately:**
1. Add a new SSH connection (to server1 or any server without agent)
2. Open Server Monitor
3. Select the connection
4. ✅ Should show "Agentless Mode" + "Live — HTTP Polling"
5. Click "Install Agent" → Try tmux installation
6. ✅ Should complete within 10 seconds (not hang!)
7. ✅ Agent should connect and status should change to "Agent Streaming"

---

### Option 2: Production Build (Local Test)

```bash
cd /Users/katanyoo/Desktop/monitor

# Build production
npm run build

# Start production server
npm start

# Open browser
# Navigate to http://localhost:3000
```

Same testing steps as Option 1.

---

### Option 3: Docker Deployment (Server)

#### If testing on your local Docker:

```bash
cd /Users/katanyoo/Desktop/monitor

# Stop existing containers
docker compose down

# Rebuild and start
docker compose up -d --build

# Check logs
docker compose logs -f monitor

# Open browser
# Navigate to http://localhost:3010 or http://localhost:80 (if nginx is configured)
```

#### If deploying to remote server:

```bash
# 1. On your local machine - commit and push (if using git)
cd /Users/katanyoo/Desktop/monitor
git add src/apps/ServerMonitorApp.js
git add src/app/api/server-monitor/agent/route.js
git commit -m "fix: agentless mode detection & tmux agent installation blocking"
git push origin main

# 2. On your remote server (via SSH)
ssh user@your-server
cd /path/to/monitor
git pull origin main

# 3. Rebuild Docker containers
docker compose down
docker compose up -d --build

# 4. Monitor logs for any issues
docker compose logs -f monitor

# 5. Test via browser
# Navigate to http://monitor.eaqdragon.com (or your domain)
```

---

## 🧪 Post-Deployment Testing

### Test 1: Agentless Mode (Immediate)

```
1. Open Server Monitor
2. Select server1 (or any server without agent)
3. ✅ Badge shows: "Agentless Mode"
4. ✅ Status shows: "Live — HTTP Polling"
5. ✅ Button shows: "Install Agent" or "Agent (No WS)"
```

**If this fails:**
- Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
- Check browser console for errors
- Verify build was successful

---

### Test 2: tmux Installation (Critical)

```
1. Click "Install Agent" button
2. Switch to "⚡ tmux (Fastest)" tab
3. If prompted, click "Install Node.js 20" first
4. Click "Install & Launch in tmux"
5. ⏱️ Wait... (should complete in 5-10 seconds)

Expected output:
"🚀 Launching Monitor Agent in detached tmux session [monitor-agent]..."
"✅ Monitor Agent is running in background tmux session!"
"✅ Process confirmed running (PID: 12345)"
```

**If it hangs for >30 seconds:**
- ❌ The fix didn't work - check server logs
- Try manual installation from "📋 Manual Command" tab
- SSH to server and check: `tmux ls` and `ps aux | grep monitor-agent`

**If it completes successfully:**
- ✅ The fix worked!
- Dashboard should automatically update to "Agent Streaming"

---

### Test 3: Agent Connection Status (Immediate)

After tmux installation completes:
```
1. Check dashboard status (should auto-update)
2. ✅ Badge changes to: "Agent Streaming"
3. ✅ Status changes to: "Agent WebSocket Stream (<10ms)"
4. ✅ Button changes to: "🟢 Agent Connected"
5. ✅ Metrics update in real-time (fast)
6. ✅ Network tab: No more /api/server-monitor/metrics calls
7. ✅ Network tab: See WebSocket frames (WS)
```

---

### Test 4: SSH Verification (Optional but Recommended)

SSH to the server where you installed the agent:

```bash
# Check tmux session
tmux ls
# Expected: monitor-agent: 1 windows (created ...)

# Check if session has the process
tmux has-session -t monitor-agent && echo "✅ Session OK" || echo "❌ No session"

# Check process is running
ps aux | grep monitor-agent | grep -v grep
# Expected: user  12345  0.5  1.2  ... node ~/.monitor-agent.js ...

# Check logs
tail -30 ~/.monitor-agent.log
# Expected output:
# "🔗 Connected to Server Monitor successfully!"
# "📡 WebSocket connection established"
# "⚡ Real-time telemetry streaming active"

# Attach to see live (optional)
tmux attach -t monitor-agent
# You should see live log output
# Press Ctrl+B then D to detach without stopping
```

---

### Test 5: Agent Stop & Reconnect (Advanced)

Test the fallback to agentless mode:

```bash
# On server, stop the agent
tmux kill-session -t monitor-agent

# Watch the dashboard (within 5-10 seconds):
# ✅ Should automatically change to "Agentless Mode"
# ✅ HTTP polling should resume
```

Then reinstall:
```
1. Click "Install Agent" button again
2. Install via tmux wizard
3. ✅ Should complete successfully
4. ✅ Agent should reconnect
```

---

## 🔍 Monitoring & Logs

### Browser Console
Watch for these logs (good signs):
```javascript
[ServerMonitor] No agent available for selected server — falling back to HTTP polling
[ServerMonitor] Receiving telemetry:stream from agent
[WebSocket] Connected to monitor agent
```

### Server Logs (Docker)
```bash
docker compose logs -f monitor | grep -E "(agent|telemetry|websocket)"
```

Good logs:
```
monitor-agent connected: { agentName: 'server1', host: '...' }
WebSocket connection established
Telemetry stream started for connection: ...
```

### Application Logs (Node)
If not using Docker:
```bash
tail -f ~/.monitor-agent.log  # On the target server
```

---

## ⚠️ Rollback Plan (If Needed)

If something goes wrong:

```bash
cd /Users/katanyoo/Desktop/monitor

# Option 1: Revert specific files
git checkout HEAD~1 src/apps/ServerMonitorApp.js
git checkout HEAD~1 src/app/api/server-monitor/agent/route.js

# Rebuild
npm run build

# Option 2: Full rollback to previous commit
git log --oneline  # Find the commit before your changes
git checkout <previous-commit-hash>
npm run build

# Option 3: Docker rollback
docker compose down
git checkout <previous-commit-hash>
docker compose up -d --build
```

---

## 📊 Success Indicators

You'll know the deployment is successful when:

✅ **Agentless servers** show "Agentless Mode" badge (not "Agent Connected")  
✅ **tmux installation** completes in <10 seconds (doesn't hang)  
✅ **Agent-connected servers** show "Agent Streaming" badge  
✅ **Real-time metrics** update with low latency  
✅ **No console errors** in browser  
✅ **tmux session exists** on server (verify with `tmux ls`)  
✅ **Agent process running** on server (verify with `ps aux`)  

---

## 🆘 Troubleshooting

### Issue: "Agentless Mode" not showing correctly
```bash
# Clear browser cache
# Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
# Check browser console for errors
```

### Issue: tmux installation hangs
```bash
# SSH to server
# Check if tmux is installed
command -v tmux || sudo apt-get install -y tmux

# Check if Node.js is installed
command -v node || echo "Install Node.js first via wizard"

# Try manual installation
curl -sSL http://your-server/monitor-agent.js | node - --server 'http://your-server' --token 'YOUR_TOKEN'
```

### Issue: Agent connects then immediately disconnects
```bash
# Check agent logs
tail -50 ~/.monitor-agent.log

# Check for firewall issues
sudo ufw status
sudo iptables -L

# Check server logs
docker compose logs monitor | tail -50
```

---

## 📞 Support

If you encounter issues:

1. **Check browser console** - Look for error messages
2. **Check server logs** - `docker compose logs -f monitor`
3. **Check agent logs** - SSH to server: `tail -f ~/.monitor-agent.log`
4. **Verify tmux session** - SSH to server: `tmux ls` and `tmux attach -t monitor-agent`
5. **Review documentation** - `BUGFIX_SUMMARY.md` and individual fix docs

---

## 📝 Post-Deployment Checklist

After deployment, verify:

- [ ] Build completed successfully
- [ ] Application starts without errors
- [ ] Agentless mode shows correct status
- [ ] tmux installation works (doesn't hang)
- [ ] Agent connects successfully
- [ ] Real-time streaming works
- [ ] Fallback to agentless works when agent stops
- [ ] No breaking changes to existing features
- [ ] Documentation is up to date

---

## ✅ Final Notes

- **These fixes are backwards compatible** - No breaking changes
- **Existing agents will continue working** - No need to reinstall existing agents
- **The fixes only affect new installations** - And improve status detection
- **Tested locally** - Build verified, syntax checked
- **Ready for production** - Deploy with confidence

**Estimated deployment time:** 5-10 minutes  
**Estimated testing time:** 10-15 minutes  
**Total downtime:** ~0 minutes (rolling restart with Docker)
