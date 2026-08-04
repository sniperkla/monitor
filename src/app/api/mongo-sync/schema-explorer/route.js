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

    const isDefault = connectionId === 'default';
    const dbInstance = isDefault ? pooled.db : pooled.db.db;

    // The database this connection is scoped to:
    // - For default (system): dbInstance.databaseName (the system DB)
    // - For external connection: connData.database or the databaseName from the pooled connection
    const configuredDb = isDefault
      ? null  // system DB: allow listing all databases via admin
      : (connData?.database || dbInstance?.databaseName || null);

    // ── Handle "list collections" request ──────────────────────────────────
    if (database) {
      if (database === 'All Databases (*)' || database === 'ALL_DATABASES' || database === '*') {
        return NextResponse.json({ success: true, collections: ['All Collections (*)'] });
      }

      // Use dbInstance directly when: it IS the target database, or the connection is single-DB scoped
      let targetDb = dbInstance;
      if (dbInstance.databaseName !== database) {
        if (!configuredDb && dbInstance.client) {
          // System or multi-DB admin connection: can freely switch databases
          targetDb = dbInstance.client.db(database);
        }
        // else: single-DB scoped connection — always use dbInstance (it is the only accessible DB)
      }

      try {
        const collections = await targetDb.listCollections().toArray();
        const collectionNames = [
          'All Collections (*)',
          ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()
        ];
        return NextResponse.json({ success: true, collections: collectionNames });
      } catch (collErr) {
        console.warn('schema-explorer listCollections retry on dbInstance:', collErr.message);
        try {
          const collections = await dbInstance.listCollections().toArray();
          const collectionNames = [
            'All Collections (*)',
            ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()
          ];
          return NextResponse.json({ success: true, collections: collectionNames });
        } catch (e2) {
          return NextResponse.json({ success: false, error: e2.message }, { status: 500 });
        }
      }
    }

    // ── Handle "list databases" request ─────────────────────────────────────

    // For external (non-default) connections that have a configured database:
    // Just return that single database — don't call listDatabases() which may return
    // ALL system databases (even when authSource=admin is used just for authentication).
    if (!isDefault && configuredDb) {
      return NextResponse.json({ success: true, databases: [configuredDb] });
    }

    // For the system default connection (or connections without a configured DB):
    // Use admin listDatabases to get the full list.
    let dbs = [];
    try {
      const adminDb = dbInstance.admin
        ? dbInstance.admin()
        : dbInstance.client ? dbInstance.client.db('admin') : null;
      if (adminDb) {
        const listRes = await adminDb.listDatabases();
        if (listRes?.databases) {
          dbs = listRes.databases
            .map(d => d.name)
            .filter(n => !['admin', 'local', 'config'].includes(n));
        }
      }
    } catch (err) {
      console.warn('schema-explorer listDatabases warning:', err.message);
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
