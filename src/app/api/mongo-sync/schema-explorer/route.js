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

    // The database name configured in the connection (e.g. the URI's default DB)
    const configuredDb = connData?.database || dbInstance?.databaseName;

    // ── Handle "list collections" request ──────────────────────────────────
    if (database) {
      if (database === 'All Databases (*)' || database === 'ALL_DATABASES' || database === '*') {
        return NextResponse.json({ success: true, collections: ['All Collections (*)'] });
      }

      // Use dbInstance directly if it already matches, OR if this connection
      // is scoped to a single database (configuredDb matches requested DB).
      let targetDb = dbInstance;
      if (dbInstance.databaseName !== database) {
        if (configuredDb && configuredDb === database) {
          // Single-DB connection, already connected to this DB — just use dbInstance
          targetDb = dbInstance;
        } else if (dbInstance.client) {
          // Multi-DB connection: switch to the requested database
          targetDb = dbInstance.client.db(database);
        }
        // else: keep dbInstance (only accessible DB)
      }

      try {
        const collections = await targetDb.listCollections().toArray();
        const collectionNames = [
          'All Collections (*)',
          ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()
        ];
        return NextResponse.json({ success: true, collections: collectionNames });
      } catch (collErr) {
        console.warn('schema-explorer listCollections error, retrying on dbInstance:', collErr.message);
        // Last resort: list on the directly connected dbInstance
        const collections = await dbInstance.listCollections().toArray();
        const collectionNames = [
          'All Collections (*)',
          ...collections.map(c => c.name).filter(n => !n.startsWith('system.')).sort()
        ];
        return NextResponse.json({ success: true, collections: collectionNames });
      }
    }

    // ── Handle "list databases" request ─────────────────────────────────────
    // For single-database URI connections (configuredDb set), return that DB immediately —
    // these connections often have no admin privileges to run listDatabases.
    let dbs = configuredDb ? [configuredDb] : [];

    // Try admin listDatabases — works for connections with admin/root access
    try {
      const adminDb = dbInstance.admin
        ? dbInstance.admin()
        : dbInstance.client ? dbInstance.client.db('admin') : null;
      if (adminDb) {
        const listRes = await adminDb.listDatabases();
        if (listRes?.databases) {
          const allDbs = listRes.databases
            .map(d => d.name)
            .filter(n => !['admin', 'local', 'config'].includes(n));
          if (allDbs.length > 0) {
            // Put configuredDb first so the dropdown defaults to it
            dbs = configuredDb
              ? [configuredDb, ...allDbs.filter(d => d !== configuredDb)]
              : allDbs;
          }
        }
      }
    } catch (_) {
      // User doesn't have listDatabases permission — use configuredDb fallback above
    }

    if (dbs.length === 0) {
      dbs = [configuredDb || dbInstance.databaseName || 'monitor'];
    }

    return NextResponse.json({ success: true, databases: dbs });

  } catch (error) {
    console.error('schema-explorer error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
