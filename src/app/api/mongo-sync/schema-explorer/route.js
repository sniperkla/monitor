import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { getPooledConnection } from '@/lib/dbPool';
import mongoose from 'mongoose';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { connectionId, database } = await request.json();

    let pooled;
    if (connectionId === 'default') {
      await connectDB(null, true);
      pooled = { db: mongoose.connection.db };
    } else {
      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      await repo.init();
      const fullConn = await repo.findById(connectionId);
      if (!fullConn) {
        return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
      }
      const connData = fullConn.toObject ? fullConn.toObject() : fullConn;
      pooled = await getPooledConnection(connData);
    }

    const dbInstance = connectionId === 'default' ? pooled.db : pooled.db.db;

    // If database parameter is provided, return collections for that database
    if (database) {
      const targetDb = dbInstance.databaseName === database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(database) : dbInstance.parentDb ? dbInstance.parentDb.db(database) : dbInstance;

      const collections = await targetDb.listCollections().toArray();
      const collectionNames = ['All Collections (*)', ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()];
      return NextResponse.json({ success: true, collections: collectionNames });
    }

    // Otherwise list databases
    const adminDb = dbInstance.admin ? dbInstance.admin() : dbInstance.client ? dbInstance.client.db('admin') : null;
    let dbs = [];
    if (adminDb) {
      try {
        const listRes = await adminDb.listDatabases();
        dbs = listRes.databases.map(d => d.name).filter(name => !['admin', 'local', 'config'].includes(name));
      } catch (_) {
        // Fallback to current db name if admin command fails (e.g. limited user permissions)
        dbs = [dbInstance.databaseName || 'monitor'];
      }
    } else {
      dbs = [dbInstance.databaseName || 'monitor'];
    }

    if (dbs.length === 0) {
      dbs = [dbInstance.databaseName || 'monitor'];
    }

    return NextResponse.json({ success: true, databases: dbs });

  } catch (error) {
    console.error('schema-explorer error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
