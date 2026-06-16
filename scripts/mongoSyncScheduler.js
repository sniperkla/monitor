const mongoose = require('mongoose');
const { MongoClient, ObjectId } = require('mongodb');
const { decrypt } = require('../src/utils/encryption');

// Helper to refresh Google Access Token
async function refreshGoogleAccessToken(config) {
  const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || !config.refreshToken) {
    throw new Error('Google OAuth credentials or Refresh Token missing.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }

  const updatedConfig = {
    ...config,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };

  await mongoose.connection.db.collection('system_settings').updateOne(
    { key: 'google_drive_config' },
    { $set: { value: updatedConfig } }
  );

  return data.access_token;
}

// Helper to upload file to Google Drive
async function uploadToDrive(fileName, content, folderId, accessToken) {
  const metadata = {
    name: fileName,
    ...(folderId ? { parents: [folderId] } : {})
  };

  const boundary = 'antigravity_scheduler_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = 
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    (typeof content === 'string' ? content : JSON.stringify(content, null, 2)) +
    closeDelimiter;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message);
  }

  return data;
}

// Main job runner
async function runJob(job, driveConfig) {
  console.log(`[Scheduler] 🏃 Running backup job: ${job.name} (${job.database}.${job.collection})`);
  
  let client = null;
  let runStatus = 'success';
  let runMessage = '';
  let count = 0;

  try {
    // 1. Refresh token
    const token = await refreshGoogleAccessToken(driveConfig);

    // 2. Fetch docs
    let docs = [];
    if (job.connectionId === 'default') {
      // Use existing mongoose connection
      const targetDb = mongoose.connection.db.databaseName === job.database 
        ? mongoose.connection.db 
        : mongoose.connection.db.client.db(job.database);
      docs = await targetDb.collection(job.collection).find({}).toArray();
    } else {
      // Connect to custom MongoDB
      const conn = await mongoose.connection.db.collection('connections').findOne({ _id: new ObjectId(job.connectionId) });
      if (!conn) {
        throw new Error(`Target connection ${job.connectionId} not found.`);
      }

      const password = decrypt(conn.password);
      const isSrv = conn.isSrv || (conn.host && conn.host.includes('.mongodb.net'));
      const protocol = isSrv ? 'mongodb+srv' : 'mongodb';
      const portPart = (isSrv || !conn.port) ? '' : `:${conn.port}`;
      
      let uri;
      if (conn.username && password) {
        uri = `${protocol}://${conn.username}:${encodeURIComponent(password)}@${conn.host}${portPart}/${conn.database || ''}`;
      } else {
        uri = `${protocol}://${conn.host}${portPart}/${conn.database || ''}`;
      }

      if (conn.authSource) {
        uri += `?authSource=${conn.authSource}`;
      }

      client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const targetDb = client.db(job.database);
      docs = await targetDb.collection(job.collection).find({}).toArray();
    }

    count = docs.length;

    // 3. Upload to Drive
    const fileName = `backup_${job.database}_${job.collection}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await uploadToDrive(fileName, docs, job.driveFolderId, token);

    runMessage = `Successfully backed up ${count} documents.`;
    console.log(`[Scheduler] ✅ Backup job completed: ${job.name}`);

  } catch (err) {
    runStatus = 'failed';
    runMessage = err.message;
    console.error(`[Scheduler] ❌ Backup job failed: ${job.name} -`, err.message);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (_) {}
    }
  }

  // Update last run time and stats in jobs list
  try {
    const jobsSetting = await mongoose.connection.db.collection('system_settings').findOne({ key: 'mongo_sync_jobs' });
    if (jobsSetting && jobsSetting.value) {
      const updatedJobs = jobsSetting.value.map(j => {
        if (j.id === job.id) {
          return {
            ...j,
            lastRun: Date.now(),
            lastStatus: runStatus,
            lastMessage: runMessage
          };
        }
        return j;
      });

      await mongoose.connection.db.collection('system_settings').updateOne(
        { key: 'mongo_sync_jobs' },
        { $set: { value: updatedJobs } }
      );
    }

    // Write to history
    const historySetting = await mongoose.connection.db.collection('system_settings').findOne({ key: 'mongo_sync_history' });
    const history = historySetting ? historySetting.value : [];
    const newHistoryEntry = {
      id: `hist-${Date.now()}`,
      jobId: job.id,
      jobName: job.name,
      database: job.database,
      collection: job.collection,
      driveFolderName: job.driveFolderName,
      runAt: Date.now(),
      status: runStatus,
      message: runMessage,
      count
    };

    await mongoose.connection.db.collection('system_settings').updateOne(
      { key: 'mongo_sync_history' },
      { $set: { value: [newHistoryEntry, ...history].slice(0, 100) } },
      { upsert: true }
    );

  } catch (dbErr) {
    console.error('[Scheduler] Failed to update job run status in DB:', dbErr);
  }
}

// Tick checking for due jobs
async function tick() {
  if (mongoose.connection.readyState !== 1) return;

  try {
    // 1. Get Drive Config
    const driveSetting = await mongoose.connection.db.collection('system_settings').findOne({ key: 'google_drive_config' });
    const driveConfig = driveSetting ? driveSetting.value : null;

    if (!driveConfig || !driveConfig.refreshToken) {
      return; // Not linked to Google Drive
    }

    // 2. Get Sync Jobs
    const jobsSetting = await mongoose.connection.db.collection('system_settings').findOne({ key: 'mongo_sync_jobs' });
    const jobs = jobsSetting ? jobsSetting.value : [];

    const now = Date.now();
    for (const job of jobs) {
      if (!job.enabled || job.schedule === 'manual') continue;

      let isDue = false;
      const lastRun = job.lastRun || 0;
      const timeDiff = now - lastRun;

      if (job.schedule === 'hourly' && timeDiff >= 60 * 60 * 1000) {
        isDue = true;
      } else if (job.schedule === 'daily' && timeDiff >= 24 * 60 * 60 * 1000) {
        isDue = true;
      } else if (job.schedule === 'weekly' && timeDiff >= 7 * 24 * 60 * 60 * 1000) {
        isDue = true;
      }

      if (isDue) {
        await runJob(job, driveConfig);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err);
  }
}

// Start Scheduler
function start() {
  console.log('[Scheduler] ⏰ Starting Mongo Sync background scheduler...');
  // Check every 60 seconds
  setInterval(tick, 60 * 1000);
  // Run first check after 15 seconds to allow Next.js boot to settle
  setTimeout(tick, 15 * 1000);
}

module.exports = { start };
