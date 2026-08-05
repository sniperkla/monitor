import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPooledConnection } from '@/lib/dbPool';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { listDriveFiles, downloadDriveFile } from '@/lib/gdriveHelper';
import { sanitizeDocument, normalizeMongoConnection } from '@/lib/mongoSyncUtils';
import { attachRequestUserId } from '@/lib/requestUser';
import mongoose from 'mongoose';

const MAX_RESTORE_DOCS = 100000;

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const driveFolderId = searchParams.get('driveFolderId');

    if (!driveFolderId) {
      return NextResponse.json({ success: false, error: 'Drive Folder ID is required' }, { status: 400 });
    }

    const files = await listDriveFiles(driveFolderId);
    return NextResponse.json({ success: true, files });

  } catch (error) {
    console.error('List Drive backup files error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileId, driveFolderId, connectionId, database, collection, mode = 'insert' } = body;

    if (!fileId || !database) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    const isAllCollectionsSel = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'].includes(collection);
    const isAllDatabasesSel   = ['All Databases (*)', 'ALL_DATABASES', '*'].includes(database);

    // Establish connection to target DB
    let pooled;
    if (connectionId === 'default') {
      const db = await connectDB(null, true);
      pooled = { db };
    } else {
      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      await repo.init();
      const fullConn = await repo.findById(connectionId);
      if (!fullConn) {
        return NextResponse.json({ success: false, error: 'Target connection not found' }, { status: 404 });
      }
      let connData = fullConn.toObject ? fullConn.toObject() : fullConn;
      connData = await attachRequestUserId(request, connData);
      connData = normalizeMongoConnection(connData);
      pooled = await getPooledConnection(connData);
    }

    const dbInstance = connectionId === 'default' ? pooled.db : pooled.db.db;

    let insertedCount = 0;
    let updatedCount  = 0;
    let totalCount    = 0;

    // Helper: restore docs into a single collection
    const restoreCollection = async (col, docs) => {
      if (!docs || docs.length === 0) return;
      const sanitized = docs.map(d => sanitizeDocument(d));
      totalCount += sanitized.length;
      if (mode === 'upsert') {
        const ops = sanitized.map(doc => {
          const filter = doc._id ? { _id: doc._id } : { _id: new mongoose.Types.ObjectId() };
          return { updateOne: { filter, update: { $set: doc }, upsert: true } };
        });
        try {
          const r = await col.bulkWrite(ops, { ordered: false });
          insertedCount += (r.upsertedCount || 0) + (r.insertedCount || 0);
          updatedCount  += r.modifiedCount || 0;
        } catch (e) { console.warn('bulkWrite error:', e.message); }
      } else {
        try {
          const r = await col.insertMany(sanitized, { ordered: false });
          insertedCount += r.insertedCount || sanitized.length;
        } catch (e) { console.warn('insertMany error:', e.message); }
      }
    };

    // ── Check if this is a Batch Folder Restore (fileId === 'ALL') ──
    if (fileId === 'ALL') {
      const targetFolderId = driveFolderId || body.driveFolderId;
      if (!targetFolderId) {
        return NextResponse.json({ success: false, error: 'Drive Folder ID required for full folder restore' }, { status: 400 });
      }
      const files = await listDriveFiles(targetFolderId);
      const jsonFiles = (files || []).filter(f => f.name && f.name.endsWith('.json'));

      if (jsonFiles.length === 0) {
        return NextResponse.json({ success: false, error: 'No JSON backup files found in selected folder' }, { status: 400 });
      }

      let restoredCollectionsCount = 0;
      const targetDb = dbInstance.databaseName === database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(database) : dbInstance;

      for (const file of jsonFiles) {
        try {
          const fileData = await downloadDriveFile(file.id);
          if (!fileData || (Array.isArray(fileData) && fileData.length === 0)) continue;

          const cleanName = file.name.replace(/\.json$/i, '');
          const parts = cleanName.split('_');
          const collName = parts.length >= 3 && parts[0] === 'backup' ? parts[2] : cleanName;

          if (Array.isArray(fileData)) {
            await restoreCollection(targetDb.collection(collName), fileData);
            restoredCollectionsCount++;
          } else if (typeof fileData === 'object' && fileData !== null) {
            for (const [cName, docs] of Object.entries(fileData)) {
              if (Array.isArray(docs) && docs.length > 0) {
                await restoreCollection(targetDb.collection(cName), docs);
                restoredCollectionsCount++;
              }
            }
          }
        } catch (fileErr) {
          console.warn(`[Batch Restore] Error restoring file ${file.name}:`, fileErr.message);
        }
      }

      return NextResponse.json({
        success: true,
        insertedCount,
        updatedCount,
        totalCount,
        message: `Successfully restored ${insertedCount} documents across ${restoredCollectionsCount} collections from Google Drive folder.`
      });
    }

    // 1. Single File Download from Google Drive
    console.log(`📥 Downloading backup file ${fileId} from Google Drive...`);
    const backupData = await downloadDriveFile(fileId);

    // Detect file shape
    const isAllDbFile = !Array.isArray(backupData)
      && typeof backupData === 'object'
      && backupData !== null
      && Object.values(backupData).every(v => !Array.isArray(v) && typeof v === 'object');

    const isAllCollectionsFile = !Array.isArray(backupData)
      && typeof backupData === 'object'
      && backupData !== null
      && !isAllDbFile;

    if (!Array.isArray(backupData) && !isAllCollectionsFile && !isAllDbFile) {
      return NextResponse.json({ success: false, error: 'Downloaded backup file is not a valid JSON document' }, { status: 400 });
    }

    if (Array.isArray(backupData) && backupData.length === 0) {
      return NextResponse.json({ success: true, message: 'Backup file is empty. No documents imported.', count: 0 });
    }

    if (Array.isArray(backupData) && backupData.length > MAX_RESTORE_DOCS) {
      return NextResponse.json({ success: false, error: `Restore limit exceeded. Maximum ${MAX_RESTORE_DOCS} documents per request.` }, { status: 400 });
    }

    if (isAllDbFile) {
      // ── Restore ALL databases: { dbName: { collName: [docs] } } ──
      for (const [dbName, colMap] of Object.entries(backupData)) {
        const dbObj = dbInstance.client ? dbInstance.client.db(dbName) : dbInstance;
        if (typeof colMap !== 'object' || Array.isArray(colMap)) continue;
        for (const [colName, docs] of Object.entries(colMap)) {
          if (!Array.isArray(docs)) continue;
          await restoreCollection(dbObj.collection(colName), docs);
        }
      }
    } else if (isAllCollectionsFile) {
      // ── Restore ALL collections in one DB: { collName: [docs] } ──
      const targetDb = dbInstance.databaseName === database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(database) : dbInstance;
      for (const [colName, docs] of Object.entries(backupData)) {
        if (!Array.isArray(docs)) continue;
        await restoreCollection(targetDb.collection(colName), docs);
      }
    } else {
      // ── Restore single collection (backupData is Array of docs) ──
      let targetColl = collection;
      if (isAllCollectionsSel || !targetColl || targetColl === 'ALL_COLLECTIONS') {
        if (body.fileName) {
          const cleanName = body.fileName.replace(/\.json$/i, '');
          const parts = cleanName.split('_');
          targetColl = parts.length >= 3 && parts[0] === 'backup' ? parts[2] : cleanName;
        }
      }
      if (!targetColl || isAllCollectionsSel) {
        return NextResponse.json({ success: false, error: 'Target collection name required for single-collection restore' }, { status: 400 });
      }
      const targetDb = dbInstance.databaseName === database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(database) : dbInstance;
      await restoreCollection(targetDb.collection(targetColl), backupData);
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      totalCount,
      message: `Successfully restored ${insertedCount} documents across collections (updated ${updatedCount}) from Google Drive.`
    });

  } catch (error) {
    console.error('Restore backup error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
