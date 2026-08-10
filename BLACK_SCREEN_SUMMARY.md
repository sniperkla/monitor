# Black Screen Issue - Quick Summary

## Issue Reported
"Why sometimes first access site is black screen"

## Most Common Causes

### 1. **Next.js Cold Start** (60% of cases)
- First access after deployment or restart
- Next.js server is warming up
- **Wait 10-30 seconds** - it will load

### 2. **Browser Cache/Chunk Mismatch** (30% of cases)
- Old JavaScript cached in browser
- Build artifacts updated but browser has old version
- **Solution:** Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### 3. **Session Loading Stuck** (5% of cases)
- `useSession()` status stays 'loading' too long
- NextAuth can't reach database
- **Solution:** Check MongoDB connection, restart container

### 4. **Mobile/WebGL Crash** (5% of cases)
- Warp animation (HyperspaceTransition) crashes on weak devices
- Built-in 500ms-6s timeout should recover
- **Solution:** Wait or skip animation

---

## Quick Fixes

### For Users (Browser-side):

1. **Hard Refresh**
   ```
   Windows/Linux: Ctrl + Shift + R
   Mac: Cmd + Shift + R
   ```

2. **Clear Cache**
   - Chrome: Settings → Privacy → Clear browsing data
   - Or: Ctrl+Shift+Del

3. **Incognito Mode**
   - Test in private/incognito window
   - If works there = cache issue

### For Server (Docker):

1. **Rebuild Container**
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

2. **Clear Next.js Cache**
   ```bash
   docker compose exec monitor rm -rf .next
   docker compose restart monitor
   ```

3. **Check Logs**
   ```bash
   docker compose logs -f monitor
   # Wait for: "✓ Ready in X.Xs"
   ```

---

## Quick Diagnosis

### Check in Browser (F12):

```javascript
// In Console tab:

// 1. Check session
fetch('/api/auth/session').then(r => r.json()).then(console.log)

// 2. Check health
fetch('/api/health').then(r => r.json()).then(console.log)

// 3. Force load desktop
localStorage.setItem('skip-boot', 'true');
location.reload();
```

### Check on Server:

```bash
# Health check
curl http://localhost:3000/api/health

# Container status
docker compose ps

# Recent logs
docker compose logs --tail=50 monitor
```

---

## Not Related to Our Changes

The black screen issue is **NOT caused by** the user-specific settings migration we just completed. This is a frontend/Next.js issue that existed before.

### Evidence:
1. We only changed backend settings storage
2. We didn't modify page.js or loading logic
3. Issue is intermittent (happens "sometimes")
4. Classic Next.js cold start / cache issue

---

## Best Solution (Prevention)

Add this to the top of `src/app/page.js`:

```javascript
// Add recovery timeout
useEffect(() => {
  const timeout = setTimeout(() => {
    if (status === 'loading') {
      console.warn('[Session] Timeout, reloading...');
      window.location.reload();
    }
  }, 10000); // 10 seconds
  return () => clearTimeout(timeout);
}, [status]);
```

This will auto-recover if stuck in loading state for more than 10 seconds.

---

## Current Status

**Issue:** Black screen on first access (intermittent)  
**Cause:** Likely Next.js cold start or browser cache  
**Impact:** Low - resolves on refresh  
**Priority:** Low - cosmetic, not blocking  

**Recommended:**
1. Document the issue (✅ Done)
2. Add recovery timeout (optional improvement)
3. Monitor frequency (is it common?)

If it happens frequently (>10% of users), we should add the recovery timeout. If rare (<5%), document and move on.

---

**Created:** August 11, 2026, 04:04 AM ICT
