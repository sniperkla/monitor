import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { getPooledConnection } from '@/lib/dbPool';
import { normalizeMongoConnection } from '@/lib/mongoSyncUtils';
import { attachRequestUserId } from '@/lib/requestUser';
import mongoose from 'mongoose';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { connectionId, database } = await request.json();

    let pooled;
    let connData = null;
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
      connData = fullConn.toObject ? fullConn.toObject() : fullConn;
      connData = await attachRequestUserId(request, connData);
      connData = normalizeMongoConnection(connData);
      pooled = await getPooledConnection(connData);
    }

    const dbInstance = connectionId === 'default' ? pooled.db : pooled.db.db;

    // If database parameter is provided and is a specific DB name (not "All Databases (*)")
    if (database) {
      if (database === 'All Databases (*)' || database === 'ALL_DATABASES' || database === '*') {
        return NextResponse.json({ success: true, collections: ['All Collections (*)'] });
      }

      const targetDb = dbInstance.databaseName === database
        ? dbInstance
        : dbInstance.client ? dbInstance.client.db(database) : dbInstance.parentDb ? dbInstance.parentDb.db(database) : dbInstance;

      const collections = await targetDb.listCollections().toArray();
      const collectionNames = ['All Collections (*)', ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()];
      return NextResponse.json({ success: true, collections: collectionNames });
    }

    // Otherwise list databases
    let dbs = [];
    const configuredDb = connData?.database || dbInstance?.databaseName;

    try {
      const adminDb = dbInstance.admin ? dbInstance.admin() : (dbInstance.client ? dbInstance.client.db('admin') : null);
      if (adminDb) {
        const listRes = await adminDb.listDatabases();
        if (listRes?.databases) {
          dbs = listRes.databases.map(d => d.name).filter(name => !['admin', 'local', 'config'].includes(name));
        }
      }
    } catch (err) {
      console.warn('schema-explorer listDatabases warning:', err.message);
    }

    if (configuredDb && !dbs.includes(configuredDb) && !['admin', 'local', 'config'].includes(configuredDb)) {
      dbs.unshift(configuredDb);
    }

    if (dbs.length === 0) {
      dbs = [configuredDb || 'monitor'];
    }

    return NextResponse.json({ success: true, databases: dbs });

  } catch (error) {
    console.error('schema-explorer error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
