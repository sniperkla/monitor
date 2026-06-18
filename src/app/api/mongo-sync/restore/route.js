import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPooledConnection } from '@/lib/dbPool';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { listDriveFiles, downloadDriveFile } from '@/lib/gdriveHelper';
import { sanitizeDocument } from '@/lib/mongoSyncUtils';
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
    const { fileId, connectionId, database, collection, mode = 'insert' } = body;

    if (!fileId || !database || !collection) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Download file from Google Drive
    console.log(`📥 Downloading backup file ${fileId} from Google Drive...`);
    const backupData = await downloadDriveFile(fileId);

    if (!Array.isArray(backupData)) {
      return NextResponse.json({ success: false, error: 'Downloaded backup file is not a valid JSON array of documents' }, { status: 400 });
    }

    if (backupData.length === 0) {
      return NextResponse.json({ success: true, message: 'Backup file is empty. No documents imported.', count: 0 });
    }

    if (backupData.length > MAX_RESTORE_DOCS) {
      return NextResponse.json({ success: false, error: `Restore limit exceeded. Maximum ${MAX_RESTORE_DOCS} documents per request.` }, { status: 400 });
    }

    // 2. Establish connection to target DB
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
      const connData = fullConn.toObject ? fullConn.toObject() : fullConn;
      pooled = await getPooledConnection(connData);
    }

    const dbInstance = connectionId === 'default' ? pooled.db.connection.db : pooled.db.db;
    const targetDb = dbInstance.databaseName === database ? dbInstance : dbInstance.parentDb ? dbInstance.parentDb.db(database) : dbInstance.client.db(database);
    const col = targetDb.collection(collection);

    // 3. Sanitize IDs
    const sanitizedDocs = backupData.map(doc => sanitizeDocument(doc));

    let insertedCount = 0;
    let updatedCount = 0;

    // 4. Perform import
    if (mode === 'upsert') {
      const ops = sanitizedDocs.map(doc => {
        const filter = doc._id ? { _id: doc._id } : { _id: new mongoose.Types.ObjectId() };
        return {
          updateOne: {
            filter,
            update: { $set: doc },
            upsert: true
          }
        };
      });

      const res = await col.bulkWrite(ops, { ordered: false });
      insertedCount = res.upsertedCount + (res.insertedCount || 0);
      updatedCount = res.modifiedCount;
    } else {
      const res = await col.insertMany(sanitizedDocs, { ordered: false });
      insertedCount = res.insertedCount;
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      totalCount: sanitizedDocs.length,
      message: `Successfully restored ${insertedCount} documents (updated ${updatedCount}) from Google Drive.`
    });

  } catch (error) {
    console.error('Restore backup error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
