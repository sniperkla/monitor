# Troubleshooting: "Link Your Google Account" Not Working

## Issue: Google Drive authentication fails or doesn't work

---

## ✅ Quick Fix (Most Common Issues)

### 1. Check Database for String userId

After the migration, some settings may have string `userId` instead of ObjectId.

**Run this fix:**
```bash
MONGODB_URI='mongodb://...' node -e "
import('mongoose').then(async (mongoose) => {
  await mongoose.default.connect(process.env.MONGODB_URI);
  const col = mongoose.default.connection.db.collection('system_settings');
  
  const docs = await col.find({ userId: { \$type: 'string' } }).toArray();
  console.log(\`Found \${docs.length} settings with string userId\`);
  
  for (const doc of docs) {
    if (doc.userId === 'global') {
      await col.updateOne({ _id: doc._id }, { \$unset: { userId: '' } });
      console.log(\`Fixed \${doc.key} - removed 'global' string\`);
    } else if (mongoose.default.Types.ObjectId.isValid(doc.userId)) {
      await col.updateOne(
        { _id: doc._id },
        { \$set: { userId: new mongoose.default.Types.ObjectId(doc.userId) } }
      );
      console.log(\`Fixed \${doc.key} - converted to ObjectId\`);
    }
  }
  
  console.log('✅ Done');
  await mongoose.default.disconnect();
});
"
```

### 2. Check for Duplicates

Run the cleanup script:
```bash
MONGODB_URI='mongodb://...' node scripts/cleanup-duplicate-settings.js
```

### 3. Verify Your Session

The auth routes require a valid session with `user.id`. Check if:
- You're logged in
- Your session has `user.id` field
- The session hasn't expired

---

## 🔍 Diagnostic Steps

### Step 1: Run Diagnostic Script

```bash
MONGODB_URI='mongodb://...' node scripts/test-gdrive-auth.js
```

This will check:
- ✅ Users exist in database
- ✅ Google Drive configs are properly structured
- ✅ Environment variables are set
- ✅ No string userIds exist

### Step 2: Check Browser Console

1. Open browser developer tools (F12)
2. Go to Console tab
3. Click "Connect Google Drive"
4. Look for errors

**Common errors:**

#### "Unauthorized" (401)
- **Cause:** Not logged in or session expired
- **Fix:** Log out and log back in

#### "User ID not found in session" (400)
- **Cause:** Session doesn't have `user.id` field
- **Fix:** Check NextAuth configuration in `/src/lib/auth.js`

#### "Google Client ID is not configured" (400)
- **Cause:** Missing environment variables
- **Fix:** Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

### Step 3: Check Network Tab

1. Open developer tools (F12)
2. Go to Network tab
3. Click "Connect Google Drive"
4. Look at the request to `/api/mongo-sync/gdrive/auth`

**What to check:**
- Status code (should be 302 redirect)
- Response headers (should have `Location` header)
- Request headers (should have valid cookies)

---

## 🐛 Common Issues & Solutions

### Issue 1: Button does nothing

**Symptoms:**
- Click "Connect Google Drive" button
- Nothing happens
- No errors in console

**Possible causes:**
1. JavaScript error preventing click
2. Button event handler not attached
3. Frontend needs rebuild

**Solution:**
```bash
# Restart development server
npm run dev

# Or rebuild production
docker compose up -d --build
```

### Issue 2: Redirects to Google but callback fails

**Symptoms:**
- Redirects to Google OAuth page
- Authorize successfully
- Callback returns error

**Check:**
1. Redirect URI configuration
2. Callback route is working
3. Database connection in callback

**Test callback manually:**
```bash
# Check if callback route exists
curl http://localhost:3000/api/mongo-sync/gdrive/callback
# Should return HTML page or error, not 404
```

### Issue 3: "Missing refresh token"

**Symptoms:**
- First connection works
- Subsequent connections fail
- Error about missing refresh token

**Cause:**
Google only returns `refresh_token` on first authorization with `prompt=consent`.

**Solution:**
1. Revoke app access: https://myaccount.google.com/permissions
2. Try connecting again

### Issue 4: Multiple configs for same user

**Symptoms:**
- User has multiple `google_drive_config` documents
- Duplicates shown in database

**Solution:**
```bash
MONGODB_URI='mongodb://...' node scripts/cleanup-duplicate-settings.js
```

### Issue 5: Wrong user's config being used

**Symptoms:**
- User A sees User B's Google Drive email
- Backups go to wrong Drive folder

**Cause:**
API routes not passing `userId` to SystemSettingRepository

**Check routes:**
```bash
# Routes should have this pattern:
grep -r "new SystemSettingRepository(db, userId)" src/app/api/mongo-sync/
```

---

## 🔧 Manual Database Fix

If automated scripts don't work, manually fix the database:

### Delete all Google Drive configs

```javascript
// mongosh
use monitor
db.system_settings.deleteMany({ key: 'google_drive_config' })
```

### Then reconnect Google Drive through UI

This creates a fresh config with correct structure.

---

## 📋 Verification Checklist

After fixing, verify:

- [ ] Run diagnostic: `node scripts/test-gdrive-auth.js` → No issues
- [ ] Run tests: `node scripts/test-user-settings.js` → All pass
- [ ] No duplicates: Database has exactly 1 `google_drive_config` per user
- [ ] Proper userId: All configs have ObjectId userId (not string)
- [ ] Session works: Can log in and see user email
- [ ] Button works: Click "Connect Google Drive" → redirects to Google
- [ ] Callback works: After Google auth → redirects back with success

---

## 🆘 Still Not Working?

### Check these files:

1. **Auth route:** `/src/app/api/mongo-sync/gdrive/auth/route.js`
   - Should extract `userId` from session
   - Should pass `userId` to SystemSettingRepository

2. **Callback route:** `/src/app/api/mongo-sync/gdrive/callback/route.js`
   - Should extract `userId` from session
   - Should pass `userId` to SystemSettingRepository
   - Should save config with userId

3. **NextAuth config:** `/src/lib/auth.js`
   - Should set `session.user.id` from token
   - Check callbacks are correct

### Enable debug logging:

In affected routes, add:
```javascript
console.log('Session:', session);
console.log('User ID:', userId);
console.log('Config query:', { key: 'google_drive_config', userId });
```

---

## 📞 Emergency Rollback

If nothing works and you need to rollback:

```bash
# Restore database from backup
mongorestore --drop --uri="mongodb://..." /path/to/backup

# Revert code
git revert HEAD
docker compose up -d --build
```

---

## ✅ Success Indicators

You know it's working when:

1. ✅ Click button → Redirects to Google
2. ✅ Authorize on Google → Redirects back
3. ✅ Success message appears
4. ✅ Email shows in UI: "Connected as user@example.com"
5. ✅ Can create and run sync jobs
6. ✅ Backups appear in Google Drive

---

**Last Updated:** August 11, 2026
