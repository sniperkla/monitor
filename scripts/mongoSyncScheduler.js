'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Mongo Sync Scheduler — fully self-contained (no Next.js imports)
// Uses plain mongoose + native fetch for Google Drive operations.
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { decrypt } = require('../src/utils/encryption');

const MAX_DOCS = 100000;
const MAX_DOC_BYTES = 50 * 1024 * 1024; // 50 MB JSON limit
const DEFAULT_INTERVAL_MS = 60 * 1000;
const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024; // 5 MB — Google simple upload cap

// ── Mongoose connection to center DB ─────────────────────────────────────────
let _centerDb = null;

async function getCenterDb() {
  if (_centerDb && mongoose.connection.readyState === 1) return _centerDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env var is not set');

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  }
  _centerDb = mongoose.connection.db;
  return _centerDb;
}

// ── Google Drive helpers (self-contained) ─────────────────────────────────────
async function getDriveConfig(settingsCol) {
  const doc = await settingsCol.findOne({ key: 'google_drive_config' });
  return doc?.value || null;
}

async function saveDriveConfig(settingsCol, config) {
  await settingsCol.updateOne(
    { key: 'google_drive_config' },
    { $set: { value: config } },
    { upsert: true }
  );
}

async function getAccessToken(settingsCol) {
  const config = await getDriveConfig(settingsCol);
  if (!config?.refreshToken) throw new Error('Google Drive not connected — missing refresh token.');

  // Return cached token if still valid (5-min buffer)
  if (config.accessToken && config.expiresAt && config.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return config.accessToken;
  }

  const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing Google OAuth client credentials.');

  console.log('[Scheduler] 🔄 Refreshing Google Drive access token...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);

  const updated = { ...config, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  await saveDriveConfig(settingsCol, updated);
  return data.access_token;
}

async function ensureDriveFolder(settingsCol, parentId, folderName) {
  const token = await getAccessToken(settingsCol);
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents`;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const created = await createRes.json();
  if (created.error) throw new Error(created.error.message);
  return created;
}

async function uploadFileToDrive(settingsCol, { fileName, content, folderId }) {
  const token = await getAccessToken(settingsCol);
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  const metadata = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };

  if (bodyBytes <= SIMPLE_UPLOAD_LIMIT) {
    const boundary = 'mongo_sync_boundary';
    const multipart = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }

  // Resumable upload for large files
  const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(bodyBytes),
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) throw new Error(`Resumable upload init failed: ${initRes.status}`);
  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('No Location header for resumable upload');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(bodyBytes) },
    body,
  });
  const data = await uploadRes.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function listDriveFiles(settingsCol, folderId) {
  const token = await getAccessToken(settingsCol);
  const q = `'${folderId}' in parents and trashed=false and mimeType='application/json'`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.files || [];
}

// ── Connection helper for external Mongo connections ─────────────────────────
async function getExternalMongoDb(connDoc, database) {
  const password = connDoc.password ? decrypt(connDoc.password) : '';
  const isSrv = connDoc.isSrv || (connDoc.host && connDoc.host.includes('.mongodb.net'));
  const protocol = isSrv ? 'mongodb+srv' : 'mongodb';
  const portPart = isSrv || !connDoc.port ? '' : `:${connDoc.port}`;
  let uri = connDoc.username && password
    ? `${protocol}://${connDoc.username}:${encodeURIComponent(password)}@${connDoc.host}${portPart}/${connDoc.database || ''}`
    : `${protocol}://${connDoc.host}${portPart}/${connDoc.database || ''}`;
  if (connDoc.authSource) uri += `?authSource=${connDoc.authSource}`;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  return { client, db: client.db(database) };
}

// ── Main job runner ──────────────────────────────────────────────────────────
async function runJob(job, settingsCol) {
  console.log(`[Scheduler] Running backup job: ${job.name} (${job.database}.${job.collection})`);

  let externalClient = null;
  let runStatus = 'success';
  let runMessage = '';
  let count = 0;

  try {
    const allCollectionNames = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'];
    const isAllCollections = allCollectionNames.includes(job.collection);

    // Connect to target DB
    let targetDb;
    if (job.connectionId === 'default') {
      const centerDb = await getCenterDb();
      targetDb = centerDb.databaseName === job.database
        ? centerDb
        : mongoose.connection.getClient().db(job.database);
    } else {
      const connDoc = await settingsCol.db.collection('connections').findOne({ _id: new mongoose.Types.ObjectId(job.connectionId) });
      if (!connDoc) throw new Error(`Connection ${job.connectionId} not found`);
      const external = await getExternalMongoDb(connDoc, job.database);
      externalClient = external.client;
      targetDb = external.db;
    }

    // Prepare Drive nested folders: day/time under configured folder
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const dayFolderName = `${now.getDate()}_${pad(now.getMonth() + 1)}_${now.getFullYear()}`;
    const timeFolderName = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

    if (isAllCollections) {
      const collections = await targetDb.listCollections().toArray();
      const colNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));

      let targetFolder = job.driveFolderId;
      if (job.driveFolderId) {
        const day = await ensureDriveFolder(settingsCol, job.driveFolderId, dayFolderName);
        const time = await ensureDriveFolder(settingsCol, day.id || job.driveFolderId, timeFolderName);
        targetFolder = time.id || day.id || targetFolder;
      }

      let totalDocs = 0;
      for (const colName of colNames) {
        const docs = await targetDb.collection(colName).find({}).limit(MAX_DOCS).toArray();
        const jsonContent = JSON.stringify(docs, null, 2);
        if (Buffer.byteLength(jsonContent, 'utf8') > MAX_DOC_BYTES) {
          throw new Error(`Backup for ${colName} exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit.`);
        }
        await uploadFileToDrive(settingsCol, { fileName: `${colName}.json`, content: jsonContent, folderId: targetFolder });
        totalDocs += docs.length;
      }

      count = totalDocs;
      runMessage = `Backed up ALL ${colNames.length} collections (${count} total docs).`;
      console.log(`[Scheduler] ✅ Job completed: ${job.name}`);

    } else {
      const docs = await targetDb.collection(job.collection).find({}).limit(MAX_DOCS).toArray();
      count = docs.length;
      const jsonContent = JSON.stringify(docs, null, 2);
      if (Buffer.byteLength(jsonContent, 'utf8') > MAX_DOC_BYTES) {
        throw new Error(`Backup data exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit.`);
      }

      let targetFolder = job.driveFolderId;
      if (job.driveFolderId) {
        const day = await ensureDriveFolder(settingsCol, job.driveFolderId, dayFolderName);
        const time = await ensureDriveFolder(settingsCol, day.id || job.driveFolderId, timeFolderName);
        targetFolder = time.id || day.id || targetFolder;
      }

      await uploadFileToDrive(settingsCol, { fileName: `${job.collection}.json`, content: jsonContent, folderId: targetFolder });
      runMessage = `Backed up ${count} documents from ${job.collection}.`;
      console.log(`[Scheduler] ✅ Job completed: ${job.name}`);
    }

    // Retention cleanup
    const maxBackups = job.maxBackups || 0;
    if (maxBackups > 0 && job.driveFolderId) {
      try {
        const files = await listDriveFiles(settingsCol, job.driveFolderId);
        if (files.length > maxBackups) {
          const token = await getAccessToken(settingsCol);
          const toDelete = files.slice(maxBackups);
          for (const f of toDelete) {
            try {
              await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
            } catch (_) {}
          }
          console.log(`[Scheduler] 🗑 Cleaned up ${toDelete.length} old backups for ${job.name}`);
        }
      } catch (cleanupErr) {
        console.warn(`[Scheduler] Retention cleanup failed:`, cleanupErr.message);
      }
    }

  } catch (err) {
    runStatus = 'failed';
    runMessage = err.message;
    console.error(`[Scheduler] ❌ Job failed: ${job.name} —`, err.message);
  } finally {
    if (externalClient) {
      try { await externalClient.close(); } catch (_) {}
    }
  }

  // Persist job status + history
  try {
    const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });
    if (jobsSetting?.value) {
      const updated = jobsSetting.value.map(j =>
        j.id === job.id
          ? { ...j, lastRun: Date.now(), lastStatus: runStatus, lastMessage: runMessage }
          : j
      );
      await settingsCol.updateOne({ key: 'mongo_sync_jobs' }, { $set: { value: updated } });
    }

    const historySetting = await settingsCol.findOne({ key: 'mongo_sync_history' });
    const history = historySetting?.value || [];
    const entry = {
      id: `hist-${Date.now()}`,
      jobId: job.id, jobName: job.name,
      database: job.database, collection: job.collection,
      driveFolderName: job.driveFolderName,
      runAt: Date.now(), status: runStatus, message: runMessage, count,
    };
    await settingsCol.updateOne(
      { key: 'mongo_sync_history' },
      { $set: { value: [entry, ...history].slice(0, 100) } },
      { upsert: true }
    );
  } catch (dbErr) {
    console.error('[Scheduler] Failed to persist job status:', dbErr.message);
  }
}

// ── Scheduler tick ────────────────────────────────────────────────────────────
async function tick() {
  if (mongoose.connection.readyState !== 1) return;

  try {
    const db = await getCenterDb();
    const settingsCol = db.collection('system_settings');

    const driveSetting = await settingsCol.findOne({ key: 'google_drive_config' });
    if (!driveSetting?.value?.refreshToken) return;

    const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });
    const jobs = jobsSetting?.value || [];
    const now = Date.now();

    const intervals = {
      every_5_min:  5  * 60 * 1000,
      every_15_min: 15 * 60 * 1000,
      every_30_min: 30 * 60 * 1000,
      hourly:       60 * 60 * 1000,
      daily:        24 * 60 * 60 * 1000,
      weekly:   7 * 24 * 60 * 60 * 1000,
    };

    for (const job of jobs) {
      if (!job.enabled || job.schedule === 'manual') continue;

      const lastRun = job.lastRun || 0;
      const scheduleKey = String(job.schedule || '').toLowerCase().trim().replace(/\s+/g, '_');
      let interval = intervals[scheduleKey];
      if (!interval) {
        if (scheduleKey.includes('5'))    interval = intervals.every_5_min;
        else if (scheduleKey.includes('15')) interval = intervals.every_15_min;
        else if (scheduleKey.includes('30')) interval = intervals.every_30_min;
        else if (scheduleKey.includes('hour')) interval = intervals.hourly;
        else if (scheduleKey.includes('week')) interval = intervals.weekly;
        else interval = intervals.daily;
      }

      if (now - lastRun >= interval) {
        await runJob(job, settingsCol);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message);
  }
}

function start() {
  const intervalMs = parseInt(process.env.MONGO_SYNC_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  console.log(`[Scheduler] Starting Mongo Sync scheduler (tick interval: ${intervalMs / 1000}s)...`);
  setInterval(tick, intervalMs);
  setTimeout(tick, 5000); // first tick after 5s
}

module.exports = { start };
