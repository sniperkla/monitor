# Troubleshooting: Black Screen on First Site Access

## Issue
Sometimes when accessing the site for the first time (or after clearing cache), users see a black screen instead of the login page or desktop.

---

## Common Causes & Solutions

### 1. **Next.js Build Cache Issue** (Most Common)

**Cause:** Next.js build artifacts or cached JavaScript bundles are stale.

**Solution:**
```bash
# Clear Next.js cache and rebuild
rm -rf .next
npm run build

# Or in development
rm -rf .next
npm run dev

# In Docker
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 2. **JavaScript Loading Failure**

**Cause:** Main JavaScript bundle fails to load or parse error occurs.

**Check:**
- Open browser DevTools (F12)
- Go to Console tab
- Look for errors like:
  - `Uncaught SyntaxError`
  - `Failed to load resource`
  - `net::ERR_CONNECTION_REFUSED`
  - `ChunkLoadError`

**Solutions:**
- **Hard refresh:** Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
- **Clear browser cache**
- **Check if app is running:** `docker compose ps`
- **Check logs:** `docker compose logs -f monitor`

### 3. **Session/Auth Loading Race Condition**

**Cause:** `useSession()` returns `status: 'loading'` for too long, showing black boot screen indefinitely.

**Check in browser console:**
```javascript
// Type this in console to check session status
window.sessionStorage
window.localStorage
```

**Solutions:**
- Clear cookies and session storage
- Check NextAuth configuration
- Verify MongoDB connection is working

**Check logs for auth errors:**
```bash
docker compose logs monitor | grep -i "nextauth\|session\|auth"
```

### 4. **Hyperspace/WebGL Crash (Mobile)**

**Cause:** The warp animation (HyperspaceTransition) crashes on mobile devices without GPU acceleration.

**Evidence:**
- Black screen after boot sequence
- Works on desktop but not mobile
- Console shows WebGL errors

**Built-in Safety:**
The code has a timeout that skips the warp phase:
```javascript
// Mobile: 500ms timeout
// Desktop: 6000ms timeout
```

If stuck longer, it forces transition to desktop.

**Manual Fix:**
Add this to browser console:
```javascript
localStorage.setItem('skip-warp', 'true');
location.reload();
```

### 5. **Dynamic Import Failure**

**Cause:** `DesktopEnvironment` fails to load via `import()`.

**Evidence in console:**
- `Failed to fetch dynamically imported module`
- `ChunkLoadError`

**Solutions:**
```bash
# Rebuild with fresh chunks
rm -rf .next
npm run build

# Or rebuild Docker
docker compose build --no-cache
docker compose up -d
```

### 6. **CSS Not Loading**

**Cause:** Tailwind CSS or global styles fail to load.

**Check:**
- View page source (right-click → View Page Source)
- Look for `<style>` tags or `<link rel="stylesheet">` tags
- Should see Tailwind classes like `.bg-\[#0a0e1a\]`

**Solutions:**
```bash
# Rebuild Tailwind
npm run build

# Check postcss.config.js exists
# Check tailwind.config.js is correct
```

### 7. **Server Not Ready**

**Cause:** Docker container is starting but Next.js server isn't ready yet.

**Check:**
```bash
# Check container status
docker compose ps

# Check if port 3000 is accessible
curl http://localhost:3000

# Watch startup logs
docker compose logs -f monitor
```

**Wait for:**
```
✓ Ready in 2.3s
```

---

## Quick Diagnosis Steps

### Step 1: Open Browser DevTools

Press **F12** and check:

1. **Console tab** - Any JavaScript errors?
2. **Network tab** - Are files loading? (Filter: JS, CSS)
3. **Application tab** → Storage → Clear all data
4. Hard refresh: **Ctrl+Shift+R**

### Step 2: Check Server

```bash
# Is the app running?
docker compose ps

# Recent logs
docker compose logs --tail=50 monitor

# Test health endpoint
curl http://localhost:3000/api/health
```

### Step 3: Check Session

In browser console:
```javascript
// Check session
fetch('/api/auth/session').then(r => r.json()).then(console.log)

// Should return either:
// {} (not logged in)
// or
// { user: {...}, expires: "..." } (logged in)
```

---

## Solutions by Symptom

### "Black screen immediately"
→ JavaScript not loading  
→ Clear browser cache, hard refresh

### "Black screen after boot sequence"
→ Warp animation crashed (mobile)  
→ Wait 6 seconds or clear localStorage

### "Black screen, then loads after refresh"
→ Build cache issue  
→ Rebuild: `docker compose build --no-cache`

### "Black screen only on first visit"
→ Cold start delay  
→ Next.js server warming up, wait 10-30 seconds

### "Black screen, console shows 'ChunkLoadError'"
→ Build artifacts mismatch  
→ `rm -rf .next && docker compose build --no-cache`

---

## Prevention

### 1. Add Loading Indicator

Update `src/app/page.js` to show a minimal loading state:

```javascript
if (status === 'loading') {
  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
      <div className="text-white text-center space-y-4">
        <div className="w-12 h-12 mx-auto border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm">Loading SSH Monitor...</p>
      </div>
    </div>
  );
}
```

### 2. Add Error Recovery

```javascript
// Add to page.js
useEffect(() => {
  const timeout = setTimeout(() => {
    if (status === 'loading') {
      console.warn('[Session] Loading timeout, forcing reload');
      window.location.reload();
    }
  }, 10000); // 10 second timeout
  return () => clearTimeout(timeout);
}, [status]);
```

### 3. Skip Warp on Slow Devices

```javascript
// Detect slow device
const isSlowDevice = () => {
  const ua = navigator.userAgent.toLowerCase();
  return /mobile|android|iphone|ipad/.test(ua) || 
         navigator.hardwareConcurrency < 4;
};

// Skip warp if slow
if (isSlowDevice() && bootPhase === 'boot') {
  setBootPhase('desktop');
}
```

---

## Emergency Fix

If nothing works and users keep seeing black screen:

### Option 1: Skip Boot Sequence

Edit `src/app/page.js`:

```javascript
// Comment out boot phases
// const [bootPhase, setBootPhase] = useState('boot');
const [bootPhase, setBootPhase] = useState('desktop'); // ← Start directly at desktop
```

### Option 2: Disable Dynamic Import

Edit `src/app/page.js`:

```javascript
// Replace dynamic import with static
import DesktopEnvironment from '@/components/Desktop/DesktopEnvironment';

// Remove dynamic import code
// useEffect(() => {
//   import('@/components/Desktop/DesktopEnvironment').then(...);
// }, []);
```

### Option 3: Add Fallback

```javascript
// Add timeout to force show content
useEffect(() => {
  const forceShow = setTimeout(() => {
    if (!DesktopEnvironment) {
      console.warn('Force-loading desktop after timeout');
      import('@/components/Desktop/DesktopEnvironment').then((mod) => {
        setDesktopEnvironment(() => mod.default);
        setBootPhase('desktop');
      });
    }
  }, 5000);
  return () => clearTimeout(forceShow);
}, [DesktopEnvironment]);
```

---

## Monitoring

### Add Telemetry

```javascript
// In page.js
useEffect(() => {
  console.log('[Page] Status:', status);
  console.log('[Page] Session:', session?.user?.email || 'none');
  console.log('[Page] Boot Phase:', bootPhase);
  console.log('[Page] Desktop Loaded:', !!DesktopEnvironment);
}, [status, session, bootPhase, DesktopEnvironment]);
```

### Track Load Times

```javascript
useEffect(() => {
  const startTime = performance.now();
  return () => {
    const loadTime = performance.now() - startTime;
    console.log('[Page] Total load time:', loadTime.toFixed(2), 'ms');
  };
}, []);
```

---

## Still Black Screen?

1. Check browser compatibility (requires modern browser)
2. Check if ad blocker is interfering
3. Check if corporate firewall is blocking WebSocket
4. Try incognito/private mode
5. Try different browser
6. Check if JavaScript is enabled

### Report Issue

If persistent, collect:
- Browser version
- Console errors (screenshot)
- Network tab (screenshot)
- Server logs: `docker compose logs monitor > logs.txt`

---

**Last Updated:** August 11, 2026
