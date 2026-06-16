import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPooledConnection } from '@/lib/dbPool';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import mongoose from 'mongoose';

function sanitizeObjectId(id) {
  if (!id) return id;
  if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
    try {
      return new mongoose.Types.ObjectId(id);
    } catch (e) {}
  }
  if (typeof id === 'object' && id.$oid) {
    try {
      return new mongoose.Types.ObjectId(id.$oid);
    } catch (e) {}
  }
  return id;
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { connectionId, database, collection, documents, mode = 'insert' } = body;

    if (!database || !collection) {
      return NextResponse.json({ success: false, error: 'Database and Collection names are required' }, { status: 400 });
    }

    if (!Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json({ success: false, error: 'Documents array is empty or invalid' }, { status: 400 });
    }

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

    // Connect to the specific database
    const dbInstance = connectionId === 'default' ? pooled.db.connection.db : pooled.db.db;
    const targetDb = dbInstance.databaseName === database ? dbInstance : dbInstance.parentDb ? dbInstance.parentDb.db(database) : dbInstance.client.db(database);
    const col = targetDb.collection(collection);

    // Sanitize document IDs (converting $oid structures or 24-character hex strings to ObjectIds)
    const sanitizedDocs = documents.map(doc => {
      const cleanDoc = { ...doc };
      if (cleanDoc._id) {
        cleanDoc._id = sanitizeObjectId(cleanDoc._id);
      }
      // Recursively clean up nested $oid values if present in the document
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === 'object') {
            if (v.$oid) {
              obj[k] = sanitizeObjectId(v.$oid);
            } else {
              walk(v);
            }
          }
        }
      };
      walk(cleanDoc);
      return cleanDoc;
    });

    let insertedCount = 0;
    let updatedCount = 0;

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
      // mode === 'insert'
      const res = await col.insertMany(sanitizedDocs, { ordered: false });
      insertedCount = res.insertedCount;
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      totalCount: sanitizedDocs.length
    });

  } catch (error) {
    console.error('Import collection error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
