const mongoose = require('mongoose');
const { decrypt } = require('../src/utils/encryption');

const MAX_DOCS = 100000;
const MAX_DOC_BYTES = 50 * 1024 * 1024; // 50MB JSON limit
const DEFAULT_INTERVAL_MS = 60 * 1000;

// Lazy-loaded ESM modules
let _gdriveHelper = null;
let _connectionRepo = null;

async function getGDriveHelper() {
  if (!_gdriveHelper) _gdriveHelper = await import('../src/lib/gdriveHelper.js');
  return _gdriveHelper;
}

async function getConnectionRepo() {
  if (!_connectionRepo) {
    const mod = await import('../src/lib/repositories/ConnectionRepository.js');
    _connectionRepo = mod.ConnectionRepository;
  }
  return _connectionRepo;
}

// Get connection data from user database using ConnectionRepository
async function getConnectionData(connectionId) {
  const { default: connectDB } = await import('../src/lib/mongodb.js');
  const db = await connectDB();
  const Repo = await getConnectionRepo();
  const repo = new Repo(db);
  await repo.init();
  const conn = await repo.findById(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found.`);
  return conn.toObject ? conn.toObject() : conn;
}

// Main job runner
async function runJob(job, driveConfig) {
  console.log(`[Scheduler] Running backup job: ${job.name} (${job.database}.${job.collection})`);

  const gdrive = await getGDriveHelper();
  let client = null;
  let runStatus = 'success';
  let runMessage = '';
  let count = 0;

  try {
    // 1. Get access token via shared helper (handles refresh + dedup)
    const token = await gdrive.getGoogleAccessToken();

    // 2. Fetch docs and handle "all collections" or single collection
    const allCollectionNames = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'];
    const isAllCollections = allCollectionNames.includes(job.collection);

    // Helper: get target DB handle and list collections
    let targetDb;
    if (job.connectionId === 'default') {
      const { default: connectDB } = await import('../src/lib/mongodb.js');
      await connectDB(null, true);
      const centerDb = mongoose.connection.db;
      targetDb = centerDb.databaseName === job.database ? centerDb : centerDb.client.db(job.database);
    } else {
      const { MongoClient } = require('mongodb');
      const connData = await getConnectionData(job.connectionId);
      const password = connData.password ? decrypt(connData.password) : '';
      const isSrv = connData.isSrv || (connData.host && connData.host.includes('.mongodb.net'));
      const protocol = isSrv ? 'mongodb+srv' : 'mongodb';
      const portPart = (isSrv || !connData.port) ? '' : `:${connData.port}`;

      let uri;
      if (connData.username && password) {
        uri = `${protocol}://${connData.username}:${encodeURIComponent(password)}@${connData.host}${portPart}/${connData.database || ''}`;
      } else {
        uri = `${protocol}://${connData.host}${portPart}/${connData.database || ''}`;
      }
      if (connData.authSource) uri += `?authSource=${connData.authSource}`;

      client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      targetDb = client.db(job.database);
    }

    // Prepare Drive nested folders: Day and Time under configured folder
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const dayFolderName = `${now.getDate()}_${pad(now.getMonth()+1)}_${now.getFullYear()}`;
    const timeFolderName = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

    // Upload per-collection if requested
    if (isAllCollections) {
      const collections = await targetDb.listCollections().toArray();
      const colNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));

      // Ensure nested day/time subfolders under configured Drive folder
      let targetFolder = job.driveFolderId;
      if (job.driveFolderId) {
        const day = await gdrive.ensureDriveFolder(job.driveFolderId, dayFolderName);
        const time = await gdrive.ensureDriveFolder(day.id || job.driveFolderId, timeFolderName);
        targetFolder = time.id || (day.id || targetFolder);
      }

      let totalDocs = 0;
      for (const colName of colNames) {
        const docs = await targetDb.collection(colName).find({}).limit(MAX_DOCS).toArray();
        const jsonContent = JSON.stringify(docs, null, 2);
        if (Buffer.byteLength(jsonContent, 'utf8') > MAX_DOC_BYTES) {
          throw new Error(`Backup data for ${colName} exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit.`);
        }
        const fileName = `${colName}.json`;
        await gdrive.uploadFileToGoogleDrive({ fileName, content: jsonContent, folderId: targetFolder });
        totalDocs += docs.length;
      }

      count = totalDocs;
      runMessage = `Successfully backed up ALL ${colNames.length} collections (${count} total docs).`;
      console.log(`[Scheduler] Backup job completed: ${job.name}`);

    } else {
      // Single collection path (unchanged behavior)
      const docs = await targetDb.collection(job.collection).find({}).limit(MAX_DOCS).toArray();
      count = docs.length;

      const jsonContent = JSON.stringify(docs, null, 2);
      if (Buffer.byteLength(jsonContent, 'utf8') > MAX_DOC_BYTES) {
        throw new Error(`Backup data exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit. Found ${count} documents.`);
      }

      // Ensure nested day/time subfolders under configured Drive folder
      let targetFolder = job.driveFolderId;
      if (job.driveFolderId) {
        const day = await gdrive.ensureDriveFolder(job.driveFolderId, dayFolderName);
        const time = await gdrive.ensureDriveFolder(day.id || job.driveFolderId, timeFolderName);
        targetFolder = time.id || (day.id || targetFolder);
      }

      const fileName = `${job.collection}.json`;
      await gdrive.uploadFileToGoogleDrive({ fileName, content: jsonContent, folderId: targetFolder });

      runMessage = `Successfully backed up ${count} documents.`;
      console.log(`[Scheduler] Backup job completed: ${job.name}`);
    }

    // 5. Retention cleanup — delete backups beyond configured max count
    const maxBackups = job.maxBackups || 0;
    if (maxBackups > 0 && job.driveFolderId) {
      try {
        const files = await gdrive.listDriveFiles(job.driveFolderId);
        // files are sorted by createdTime desc; delete anything beyond maxBackups
        if (files.length > maxBackups) {
          const toDelete = files.slice(maxBackups);
          const accessToken = await gdrive.getGoogleAccessToken();
          for (const f of toDelete) {
            try {
              await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` }
              });
            } catch (_) {}
          }
          console.log(`[Scheduler] Cleaned up ${toDelete.length} old backups for ${job.name}`);
        }
      } catch (cleanupErr) {
        console.warn(`[Scheduler] Retention cleanup failed for ${job.name}:`, cleanupErr.message);
      }
    }

  } catch (err) {
    runStatus = 'failed';
    runMessage = err.message;
    console.error(`[Scheduler] Backup job failed: ${job.name} -`, err.message);
  } finally {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
  }

  // Update job status and history in center DB
  try {
    const { default: connectDB } = await import('../src/lib/mongodb.js');
    await connectDB(null, true);
    const settingsCol = mongoose.connection.db.collection('system_settings');

    const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });
    if (jobsSetting?.value) {
      const updatedJobs = jobsSetting.value.map(j =>
        j.id === job.id
          ? { ...j, lastRun: Date.now(), lastStatus: runStatus, lastMessage: runMessage }
          : j
      );
      await settingsCol.updateOne({ key: 'mongo_sync_jobs' }, { $set: { value: updatedJobs } });
    }

    const historySetting = await settingsCol.findOne({ key: 'mongo_sync_history' });
    const history = historySetting?.value || [];
    const newEntry = {
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
    await settingsCol.updateOne(
      { key: 'mongo_sync_history' },
      { $set: { value: [newEntry, ...history].slice(0, 100) } },
      { upsert: true }
    );
  } catch (dbErr) {
    console.error('[Scheduler] Failed to update job status in DB:', dbErr.message);
  }
}

// Check for due jobs
async function tick() {
  if (mongoose.connection.readyState !== 1) return;

  try {
    const { default: connectDB } = await import('../src/lib/mongodb.js');
    await connectDB(null, true);
    const settingsCol = mongoose.connection.db.collection('system_settings');

    const driveSetting = await settingsCol.findOne({ key: 'google_drive_config' });
    const driveConfig = driveSetting?.value;
    if (!driveConfig?.refreshToken) return;

    const jobsSetting = await settingsCol.findOne({ key: 'mongo_sync_jobs' });
    const jobs = jobsSetting?.value || [];
    const now = Date.now();

    for (const job of jobs) {
      if (!job.enabled || job.schedule === 'manual') continue;

      const lastRun = job.lastRun || 0;
      const timeDiff = now - lastRun;
      const scheduleStr = String(job.schedule || '').toLowerCase().trim();

      const intervals = {
        'every_15_min': 15 * 60 * 1000,
        'every_30_min': 30 * 60 * 1000,
        'hourly': 60 * 60 * 1000,
        'daily': 24 * 60 * 60 * 1000,
        'weekly': 7 * 24 * 60 * 60 * 1000,
      };

      let targetInterval = intervals[scheduleStr];
      if (!targetInterval) {
        if (scheduleStr.includes('15')) targetInterval = 15 * 60 * 1000;
        else if (scheduleStr.includes('30')) targetInterval = 30 * 60 * 1000;
        else if (scheduleStr.includes('hour')) targetInterval = 60 * 60 * 1000;
        else if (scheduleStr.includes('week')) targetInterval = 7 * 24 * 60 * 60 * 1000;
        else targetInterval = 24 * 60 * 60 * 1000; // default to daily
      }

      if (timeDiff >= targetInterval) {
        await runJob(job, driveConfig);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message);
  }
}

function start() {
  const intervalMs = parseInt(process.env.MONGO_SYNC_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  console.log(`[Scheduler] Starting Mongo Sync scheduler (interval: ${intervalMs / 1000}s)...`);
  setInterval(tick, intervalMs);
  setTimeout(tick, 15000);
}

module.exports = { start };
