import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPooledConnection } from '@/lib/dbPool';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import SystemSetting from '@/models/SystemSetting';
import { uploadFileToGoogleDrive } from '@/lib/gdriveHelper';

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
        const connData = fullConn.toObject ? fullConn.toObject() : fullConn;
        pooled = await getPooledConnection(connData);
      }

      const dbInstance = job.connectionId === 'default' ? pooled.db : pooled.db.db;
      const targetDb = dbInstance.databaseName === job.database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(job.database) : dbInstance.parentDb ? dbInstance.parentDb.db(job.database) : dbInstance;

      const isAllCollections = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'].includes(job.collection);
      const isAllDatabases = ['All Databases (*)', 'ALL_DATABASES', '*'].includes(job.database);

      if (isAllDatabases) {
        // ── Backup ALL databases on this connection ──
        const adminDb = dbInstance.client ? dbInstance.client.db('admin') : dbInstance;
        const dbList = await adminDb.admin().listDatabases();
        const dbNames = dbList.databases
          .map(d => d.name)
          .filter(n => !['admin', 'local', 'config'].includes(n));

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
        // ── Backup ALL collections in target DB ──
        const collections = await targetDb.listCollections().toArray();
        const colNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));
        let totalDocs = 0;
        const allDbData = {};

        for (const colName of colNames) {
          const docs = await targetDb.collection(colName).find({}).toArray();
          allDbData[colName] = docs;
          totalDocs += docs.length;
        }

        const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup_${job.database}_ALL_COLLECTIONS_${timeStamp}.json`;
        await uploadFileToGoogleDrive({ fileName, content: JSON.stringify(allDbData, null, 2), folderId: job.driveFolderId });
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
      console.error('Backup run error for job:', job.id, err);
      runStatus = 'failed';
      runMessage = err.message;
    }

    // Update job status in DB
    const updatedJobs = [...jobs];
    updatedJobs[jobIndex] = {
      ...job,
      lastRun: Date.now(),
      lastStatus: runStatus,
      lastMessage: runMessage
    };

    await SystemSetting.findOneAndUpdate(
      { key: 'mongo_sync_jobs' },
      { key: 'mongo_sync_jobs', value: updatedJobs },
      { upsert: true, new: true }
    );

    // Also write a history entry
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
    await SystemSetting.findOneAndUpdate(
      { key: 'mongo_sync_history' },
      { key: 'mongo_sync_history', value: [newHistoryEntry, ...history].slice(0, 100) }, // Cap at 100 entries
      { upsert: true, new: true }
    );

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
