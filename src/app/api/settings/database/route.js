import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

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

// GET current database config + connection status
export async function GET() {
  const config = readConfig();
  const connected = mongoose.connection.readyState === 1;
  const currentUri = mongoose.connection._connectionString || config.uri || '';
  
  return NextResponse.json({ 
    success: true, 
    data: {
      uri: config.uri,
      connected,
      currentUri,
    }
  });
}

// POST — save config AND live-connect
export async function POST(request) {
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
    } else {
      console.log('📝 PostgreSQL selected. Configuration saved, but live sync requires specific drivers.');
    }

    // 4. Connection succeeded — save config
    writeConfig({ uri });

    return NextResponse.json({ 
      success: true, 
      message: 'Connected successfully!' 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

