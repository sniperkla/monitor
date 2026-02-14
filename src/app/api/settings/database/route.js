import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
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
    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
      return NextResponse.json({ 
        success: false, 
        error: 'URI must start with mongodb:// or mongodb+srv://' 
      }, { status: 400 });
    }

    // 1. Disconnect existing connection
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from previous MongoDB');
      }
    } catch (e) {
      console.error('Disconnect error (non-fatal):', e.message);
    }

    // 2. Clear global cache so lib/mongodb.js picks up the new URI
    if (global.mongoose) {
      global.mongoose = { conn: null, promise: null };
    }

    // 3. Try connecting to the new URI
    try {
      await mongoose.connect(uri, { 
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000, // 5 second timeout
      });
      console.log('✅ Live-connected to new MongoDB:', uri);
    } catch (connectErr) {
      return NextResponse.json({ 
        success: false, 
        error: `Connection failed: ${connectErr.message}` 
      }, { status: 400 });
    }

    // 4. Connection succeeded — save config
    writeConfig({ uri });

    // 5. Update cache for lib/mongodb.js
    global.mongoose = { conn: mongoose, promise: Promise.resolve(mongoose) };

    return NextResponse.json({ 
      success: true, 
      message: 'Connected successfully!' 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
