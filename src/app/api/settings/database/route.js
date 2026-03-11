import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { migrateConnections } from './migrate/migrator';

const CONFIG_PATH = path.join(process.cwd(), 'db-config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading db-config.json:', e);
  }
  return { uri: '' };
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  const config = readConfig();
  let connected = mongoose.connection.readyState === 1;
  let currentUri = mongoose.connection._connectionString || config.uri || '';

  // If not Mongoose, check the global connection pool from lib/mongodb
  if (!connected && config.uri) {
    if (config.uri.startsWith('postgres') && global.__connectionPool?.has('center:postgres')) {
      connected = true;
    } else if (config.uri.startsWith('mysql') && global.__connectionPool?.has('center:mysql')) {
      connected = true;
    }
  }
  
  return NextResponse.json({ 
    success: true, 
    data: {
      uri: config.uri,
      connected,
      currentUri,
    }
  });
}

// POST — save config AND live-connect (with auto-migration)
export async function POST(request) {
  try {
    const body = await request.json();
    const { uri, skipMigration } = body;

    if (!uri) {
      return NextResponse.json({ success: false, error: 'URI is required' }, { status: 400 });
    }

    // Basic URI validation
    const allowedProtocols = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowedProtocols.some(p => uri.startsWith(p));
    
    if (!isValid) {
      return NextResponse.json({ 
        success: false, 
        error: `URI must start with one of: ${allowedProtocols.join(', ')}` 
      }, { status: 400 });
    }

    // 0. Remember the OLD URI for auto-migration
    const oldConfig = readConfig();
    const oldUri = oldConfig.uri || process.env.MONGODB_URI || '';

    // 1. Disconnect existing connection
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch (e) {}

    // 2. Clear global cache so lib/mongodb.js picks up the new URI
    if (global.mongoose) {
      global.mongoose = { conn: null, promise: null };
    }
    // Clear SQL connection pool entries for clean reconnect
    if (global.__connectionPool) {
      for (const key of ['center:postgres', 'center:mysql']) {
        const c = global.__connectionPool.get(key);
        if (c) {
          try { if (c.pool) c.pool.end(); if (c.end) c.end(); } catch (_) {}
          global.__connectionPool.delete(key);
        }
      }
    }

    // 3. Try connecting
    if (uri.startsWith('mongodb')) {
      try {
        await mongoose.connect(uri, { 
          bufferCommands: false,
          serverSelectionTimeoutMS: 5000,
        });
        console.log('✅ Live-connected to new MongoDB');
      } catch (connectErr) {
        return NextResponse.json({ 
          success: false, 
          error: `MongoDB connection failed: ${connectErr.message}` 
        }, { status: 400 });
      }
    } else if (uri.startsWith('mysql://')) {
      try {
        const connection = await mysql.createConnection(uri);
        await connection.ping();
        await connection.end();
        console.log('✅ Live-connected to new MySQL');
      } catch (connectErr) {
        return NextResponse.json({ 
          success: false, 
          error: `MySQL connection failed: ${connectErr.message}` 
        }, { status: 400 });
      }
    } else if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
      try {
        const client = new Client({ connectionString: uri, connectionTimeoutMillis: 5000 });
        await client.connect();
        await client.end();
        console.log('✅ Live-connected to new PostgreSQL');
      } catch (connectErr) {
        let errorHint = connectErr.message;
        if (connectErr.message.includes('role "postgres" does not exist')) {
          errorHint = 'PostgreSQL error: Role "postgres" does not exist. On macOS, try using your OS username (whoami) instead of "postgres"';
        }
        return NextResponse.json({ 
          success: false, 
          error: `PostgreSQL connection failed: ${errorHint}` 
        }, { status: 400 });
      }
    }

    // 4. Connection succeeded — save config
    writeConfig({ uri });

    // 5. Auto-migrate connections from old DB → new DB (if switching)
    let migration = null;
    if (!skipMigration && oldUri && oldUri !== uri) {
      try {
        console.log(`🔄 Auto-migration: ${oldUri.substring(0, 30)}... → ${uri.substring(0, 30)}...`);
        migration = await migrateConnections(oldUri, uri);
        console.log('✅ Auto-migration result:', migration);
      } catch (migErr) {
        console.error('⚠️ Auto-migration failed (non-fatal):', migErr.message);
        migration = { success: false, error: migErr.message, migrated: 0, skipped: 0 };
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: migration?.migrated > 0 
        ? `Connected! ${migration.migrated} connection(s) auto-migrated from previous database.`
        : 'Connected successfully!',
      migration,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

