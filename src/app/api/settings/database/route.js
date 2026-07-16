import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { migrateConnections } from './migrate/migrator';
import { getActiveRelayInfo } from '@/lib/mongodb';
import { rewriteUriForTunnel, normalizeRelayDatabaseUri } from '@/lib/sshTunnel';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const currentUri = process.env.MONGODB_URI || '';
  let connected = mongoose.connection.readyState === 1;

  return NextResponse.json({ 
    success: true, 
    data: {
      uri: currentUri,
      connected,
      currentUri,
    }
  });
}

// POST — test a connection URI (does not persist, only validates)
export async function POST(request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { uri } = body;

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

    // Rewrite localhost URIs through Local Relay Agent if one is active
    const normalizedUri = normalizeRelayDatabaseUri(uri);
    let effectiveUri = normalizedUri;
    let usedRelay = false;
    const isLocalhost = /localhost|127\.0\.0\.1/.test(normalizedUri);
    if (isLocalhost) {
      const relayInfo = await getActiveRelayInfo(normalizedUri);
      if (relayInfo) {
        effectiveUri = rewriteUriForTunnel(normalizedUri, relayInfo.port);
        usedRelay = true;
        console.log(`🔗 [settings/database] Relay active: ${normalizedUri} → ${effectiveUri}`);
      } else if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({
          success: false,
          error: 'Local Relay Agent is not connected. Run local-relay.js on your machine to test localhost databases.'
        }, { status: 400 });
      }
    }

    // Test connection
    if (effectiveUri.startsWith('mongodb')) {
      try {
        const testConn = await mongoose.createConnection(effectiveUri, { 
          bufferCommands: false,
          serverSelectionTimeoutMS: usedRelay ? 15000 : 5000,
          connectTimeoutMS: usedRelay ? 15000 : 10000,
          ...(usedRelay ? { directConnection: true } : {}),
        }).asPromise();
        await testConn.close();
        console.log('✅ MongoDB connection test passed');
      } catch (connectErr) {
        return NextResponse.json({ 
          success: false, 
          error: `MongoDB connection failed: ${connectErr.message}` 
        }, { status: 400 });
      }
    } else if (effectiveUri.startsWith('mysql://')) {
      try {
        const connection = await mysql.createConnection(effectiveUri);
        await connection.ping();
        await connection.end();
        console.log('✅ MySQL connection test passed');
      } catch (connectErr) {
        return NextResponse.json({ 
          success: false, 
          error: `MySQL connection failed: ${connectErr.message}` 
        }, { status: 400 });
      }
    } else if (effectiveUri.startsWith('postgres://') || effectiveUri.startsWith('postgresql://')) {
      try {
        const client = new Client({ connectionString: effectiveUri, connectionTimeoutMillis: 5000 });
        await client.connect();
        await client.end();
        console.log('✅ PostgreSQL connection test passed');
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

    return NextResponse.json({ 
      success: true, 
      message: 'Connection test passed! Set MONGODB_URI in your .env file to use this database.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
