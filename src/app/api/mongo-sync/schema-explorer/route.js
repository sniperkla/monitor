import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { getPooledConnection } from '@/lib/dbPool';
import { normalizeMongoConnection } from '@/lib/mongoSyncUtils';
import { attachRequestUserId } from '@/lib/requestUser';
import mongoose from 'mongoose';
import { logger } from '@/lib/logger';

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
      // DEBUG: log before normalization and connection
      logger.info('[schema-explorer] raw connData.type:', connData?.type, '| dbProvider:', connData?.dbProvider, '| port:', connData?.port, '| database:', connData?.database);
      connData = await attachRequestUserId(request, connData);
      connData = normalizeMongoConnection(connData);
      logger.info('[schema-explorer] normalized: sshTunnel:', connData?.sshTunnel, '| host:', connData?.host, '| port:', connData?.port, '| database:', connData?.database);
      pooled = await getPooledConnection(connData);
    }

    const isDefault = connectionId === 'default';
    const dbInstance = isDefault ? pooled.db : pooled.db.db;

    // DEBUG: log exactly what we got
    logger.info('[schema-explorer] connectionId:', connectionId);
    logger.info('[schema-explorer] connData.database:', connData?.database);
    logger.info('[schema-explorer] connData.dbProvider:', connData?.dbProvider);
    logger.info('[schema-explorer] connData.type:', connData?.type);
    logger.info('[schema-explorer] connData.host:', connData?.host);
    logger.info('[schema-explorer] connData.port:', connData?.port);
    logger.info('[schema-explorer] dbInstance.databaseName:', dbInstance?.databaseName);
    logger.info('[schema-explorer] requested database:', database);

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
        logger.warn('schema-explorer listCollections retry on dbInstance:', collErr.message);
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
    // Return that database. BUT also check if it actually has collections — if not,
    // fall back to listing all available databases so the user can pick the right one.
    // (This handles the common mistake of using the Docker service/container name as
    // the database name instead of the actual database name in the URI.)
    if (!isDefault && configuredDb) {
      // Quick check: does the configured DB actually have any collections?
      let hasCollections = false;
      try {
        const checkDb = dbInstance.databaseName === configuredDb
          ? dbInstance
          : (dbInstance.client ? dbInstance.client.db(configuredDb) : dbInstance);
        const colls = await checkDb.listCollections().toArray();
        hasCollections = colls.filter(c => !c.name.startsWith('system.')).length > 0;
      } catch (_) {
        // If we can't check, assume it exists
        hasCollections = true;
      }

      if (hasCollections) {
        return NextResponse.json({ success: true, databases: [configuredDb] });
      }

      // Configured DB is empty — try to list all actual databases so the user can select the right one
      logger.info(`[schema-explorer] configuredDb "${configuredDb}" has no collections, falling back to listDatabases`);
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
      logger.warn('schema-explorer listDatabases warning:', err.message);
    }

    if (dbs.length === 0) {
      dbs = [dbInstance.databaseName || 'monitor'];
    }

    return NextResponse.json({ success: true, databases: dbs });

  } catch (error) {
    logger.error('schema-explorer error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
