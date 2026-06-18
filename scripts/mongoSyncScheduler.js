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

    // 2. Fetch docs with size guard
    let docs = [];
    if (job.connectionId === 'default') {
      const { default: connectDB } = await import('../src/lib/mongodb.js');
      const centerDb = await connectDB(null, true);
      const targetDb = centerDb.databaseName === job.database
        ? centerDb
        : centerDb.client.db(job.database);
      docs = await targetDb.collection(job.collection).find({}).limit(MAX_DOCS).toArray();
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
      const targetDb = client.db(job.database);
      docs = await targetDb.collection(job.collection).find({}).limit(MAX_DOCS).toArray();
    }

    count = docs.length;

    // 3. Size check
    const jsonContent = JSON.stringify(docs, null, 2);
    if (Buffer.byteLength(jsonContent, 'utf8') > MAX_DOC_BYTES) {
      throw new Error(`Backup data exceeds ${MAX_DOC_BYTES / 1024 / 1024}MB limit. Found ${count} documents.`);
    }

    // 4. Upload to Drive using shared helper
    const fileName = `backup_${job.database}_${job.collection}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await gdrive.uploadFileToGoogleDrive({ fileName, content: jsonContent, folderId: job.driveFolderId });

    runMessage = `Successfully backed up ${count} documents.`;
    console.log(`[Scheduler] Backup job completed: ${job.name}`);

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
    const centerDb = await connectDB(null, true);
    const settingsCol = centerDb.collection('system_settings');

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
    const centerDb = await connectDB(null, true);
    const settingsCol = centerDb.collection('system_settings');

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
      const intervals = {
        hourly: 60 * 60 * 1000,
        daily: 24 * 60 * 60 * 1000,
        weekly: 7 * 24 * 60 * 60 * 1000,
      };

      if (intervals[job.schedule] && timeDiff >= intervals[job.schedule]) {
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
