import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPooledConnection } from '@/lib/dbPool';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { uploadFileToGoogleDrive, ensureDriveFolder } from '@/lib/gdriveHelper';
import { attachRequestUserId } from '@/lib/requestUser';
import { normalizeMongoConnection } from '@/lib/mongoSyncUtils';

export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const db = await connectDB();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();

    const jobsSetting = await settingRepo.findOne({ key: 'mongo_sync_jobs' });
    const jobs = jobsSetting ? jobsSetting.value : [];

    const jobIndex = jobs.findIndex(j => j.id === id);
    if (jobIndex === -1) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const job = jobs[jobIndex];
    let runStatus = 'success';
    let runMessage = '';
    let count = 0;

    try {
      let pooled;
      if (job.connectionId === 'default') {
        await connectDB(null, true);
        pooled = { db: mongoose.connection.db };
      } else {
        const repo = new ConnectionRepository(db);
        await repo.init();
        const fullConn = await repo.findById(job.connectionId);
        if (!fullConn) {
          throw new Error(`Connection ${job.connectionId} not found.`);
        }
        let connData = fullConn.toObject ? fullConn.toObject() : fullConn;
        connData = await attachRequestUserId(request, connData);
        connData = normalizeMongoConnection(connData);
        pooled = await getPooledConnection(connData);
      }

      const isDefault = job.connectionId === 'default';
      const dbInstance = isDefault ? pooled.db : pooled.db.db;

      // Resolve target database:
      // For single-DB URI connections, always use dbInstance directly (don't switch via client.db)
      const configuredDb = isDefault ? null : dbInstance.databaseName;
      let targetDb = dbInstance;
      if (!isDefault && job.database && job.database !== 'All Databases (*)' && job.database !== dbInstance.databaseName) {
        // Only switch if not a single-DB scoped connection
        if (!configuredDb && dbInstance.client) {
          targetDb = dbInstance.client.db(job.database);
        } else if (configuredDb && configuredDb !== job.database && dbInstance.client) {
          targetDb = dbInstance.client.db(job.database);
        }
      }

      const allCollectionNames = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'];
      const allDatabaseNames = ['All Databases (*)', 'ALL_DATABASES', '*'];
      const isAllCollections = allCollectionNames.includes(job.collection);
      const isAllDatabases = allDatabaseNames.includes(job.database);

      console.log(`[mongo-sync] Running backup job ${job.id} db=${job.database} col=${job.collection}`);

      if (isAllDatabases) {
        // ── Backup ALL databases on this connection ──
        let dbNames = [];
        try {
          const adminDb = dbInstance.admin ? dbInstance.admin() : (dbInstance.client ? dbInstance.client.db('admin') : null);
          if (adminDb) {
            const dbList = await adminDb.listDatabases();
            dbNames = dbList.databases.map(d => d.name).filter(n => !['admin', 'local', 'config'].includes(n));
          }
        } catch (_) {
          // fallback: use the connected DB
          dbNames = [dbInstance.databaseName];
        }

        const allData = {};
        let totalDocs = 0;
        for (const dbName of dbNames) {
          const dbObj = dbInstance.client ? dbInstance.client.db(dbName) : dbInstance;
          const collections = await dbObj.listCollections().toArray();
          const colNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));
          allData[dbName] = {};
          for (const colName of colNames) {
            const docs = await dbObj.collection(colName).find({}).toArray();
            allData[dbName][colName] = docs;
            totalDocs += docs.length;
          }
        }

        const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup_ALL_DATABASES_${timeStamp}.json`;
        await uploadFileToGoogleDrive({ fileName, content: JSON.stringify(allData, null, 2), folderId: job.driveFolderId });
        count = totalDocs;
        runMessage = `Successfully backed up ALL ${dbNames.length} databases (${count} total docs) to Google Drive.`;

      } else if (isAllCollections) {
        // ── Backup ALL collections in target DB (one file per collection) ──
        const collections = await targetDb.listCollections().toArray();
        const colNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));
        let totalDocs = 0;

        // Build Day/Time nested folders under configured Drive folder
        const now = new Date();
        const pad = (v) => String(v).padStart(2, '0');
        const dayFolderName = `${now.getDate()}_${pad(now.getMonth()+1)}_${now.getFullYear()}`;
        const timeFolderName = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

        let targetFolder = job.driveFolderId;
        if (job.driveFolderId) {
          const day = await ensureDriveFolder(job.driveFolderId, dayFolderName);
          const time = await ensureDriveFolder(day.id || job.driveFolderId, timeFolderName);
          targetFolder = time.id || (day.id || targetFolder);
        }

        for (const colName of colNames) {
          const docs = await targetDb.collection(colName).find({}).toArray();
          const jsonContent = JSON.stringify(docs, null, 2);
          const fileName = `${colName}.json`;
          await uploadFileToGoogleDrive({ fileName, content: jsonContent, folderId: targetFolder });
          totalDocs += docs.length;
        }

        count = totalDocs;
        runMessage = `Successfully backed up ALL ${colNames.length} collections (${count} total docs) to Google Drive.`;

      } else {
        // ── Backup single collection ──
        const col = targetDb.collection(job.collection);
        const docs = await col.find({}).toArray();
        count = docs.length;

        const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup_${job.database}_${job.collection}_${timeStamp}.json`;
        await uploadFileToGoogleDrive({ fileName, content: JSON.stringify(docs, null, 2), folderId: job.driveFolderId });
        runMessage = `Successfully backed up ${count} documents from '${job.collection}' to Google Drive.`;
      }

    } catch (err) {
      console.error('Backup run error:', err.message, { jobId: job.id, database: job.database, collection: job.collection });
      runStatus = 'error';
      runMessage = err.message;
    }

    // Update job status — use settingRepo.upsert to support all DB backends
    const updatedJobs = [...jobs];
    updatedJobs[jobIndex] = {
      ...job,
      lastRun: Date.now(),
      lastStatus: runStatus,
      lastMessage: runMessage
    };
    await settingRepo.upsert('mongo_sync_jobs', updatedJobs);

    // Write history entry
    const historySetting = await settingRepo.findOne({ key: 'mongo_sync_history' });
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
    await settingRepo.upsert('mongo_sync_history', [newHistoryEntry, ...history].slice(0, 100));

    return NextResponse.json({
      success: runStatus === 'success',
      message: runMessage,
      data: updatedJobs[jobIndex]
    });

  } catch (error) {
    console.error('Run Sync Job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
