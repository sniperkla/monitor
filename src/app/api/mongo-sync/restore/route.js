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
import { logger } from '@/lib/logger';

const MAX_RESTORE_DOCS = 100000;

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;

    const { searchParams } = new URL(request.url);
    const driveFolderId = searchParams.get('driveFolderId');

    if (!driveFolderId) {
      return NextResponse.json({ success: false, error: 'Drive Folder ID is required' }, { status: 400 });
    }

    const files = await listDriveFiles(driveFolderId, userId);
    return NextResponse.json({ success: true, files });

  } catch (error) {
    logger.error('List Drive backup files error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;

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
    let matchedCount  = 0;
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
          matchedCount  += r.matchedCount || 0;
        } catch (e) { logger.warn('bulkWrite error:', e.message); }
      } else {
        try {
          const r = await col.insertMany(sanitized, { ordered: false });
          insertedCount += r.insertedCount || sanitized.length;
        } catch (e) { logger.warn('insertMany error:', e.message); }
      }
    };

    // Helper to build human-readable result message
    const buildResultMessage = (collCount) => {
      const processedCount = insertedCount + updatedCount + matchedCount;
      if (insertedCount > 0 || updatedCount > 0) {
        return `Successfully restored ${processedCount || totalCount} documents (${insertedCount} new, ${updatedCount} updated, ${matchedCount} existing) across ${collCount} collection(s).`;
      } else if (totalCount > 0) {
        return `All ${totalCount} documents across ${collCount} collection(s) already exist and match records in MongoDB (0 modified).`;
      } else {
        return `Checked ${collCount} collection(s), but no documents were found in backup files.`;
      }
    };

    // ── Check if this is a Batch Folder Restore (fileId === 'ALL') ──
    if (fileId === 'ALL') {
      const targetFolderId = driveFolderId || body.driveFolderId;
      if (!targetFolderId) {
        return NextResponse.json({ success: false, error: 'Drive Folder ID required for full folder restore' }, { status: 400 });
      }
      const files = await listDriveFiles(targetFolderId, userId);
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
          const fileData = await downloadDriveFile(file.id, userId);
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
          logger.warn(`[Batch Restore] Error restoring file ${file.name}:`, fileErr.message);
        }
      }

      return NextResponse.json({
        success: true,
        insertedCount,
        updatedCount,
        matchedCount,
        totalCount,
        message: buildResultMessage(restoredCollectionsCount)
      });
    }

    // 1. Single File Download from Google Drive
    logger.info(`📥 Downloading backup file ${fileId} from Google Drive...`);
    const backupData = await downloadDriveFile(fileId, userId);

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
      return NextResponse.json({ success: true, message: 'Backup file is empty (0 documents in source collection). No documents imported.', count: 0 });
    }

    if (Array.isArray(backupData) && backupData.length > MAX_RESTORE_DOCS) {
      return NextResponse.json({ success: false, error: `Restore limit exceeded. Maximum ${MAX_RESTORE_DOCS} documents per request.` }, { status: 400 });
    }

    let collsCount = 1;
    if (isAllDbFile) {
      // ── Restore ALL databases: { dbName: { collName: [docs] } } ──
      for (const [dbName, colMap] of Object.entries(backupData)) {
        const dbObj = dbInstance.client ? dbInstance.client.db(dbName) : dbInstance;
        if (typeof colMap !== 'object' || Array.isArray(colMap)) continue;
        for (const [colName, docs] of Object.entries(colMap)) {
          if (!Array.isArray(docs)) continue;
          await restoreCollection(dbObj.collection(colName), docs);
          collsCount++;
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
        collsCount++;
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
      matchedCount,
      totalCount,
      message: buildResultMessage(collsCount)
    });

  } catch (error) {
    logger.error('Restore backup error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
