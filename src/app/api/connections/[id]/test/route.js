import { NextResponse } from 'next/server';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import { getConnectionModel } from '@/models/Connection';
import { decrypt, isEncrypted } from '@/utils/encryption';

// POST test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    let connection;
    let ConnectionModel;
    
    // 1. Determine if it's a DB connection or a direct payload (for local/manual)
    if (id && !id.startsWith('local-')) {
      const db = await connectDB();
      ConnectionModel = getConnectionModel(db);
      connection = await ConnectionModel.findById(id).lean();
      if (!connection) {
        return NextResponse.json({ success: false, error: 'Connection not found in DB' }, { status: 404 });
      }
    } else {
      // For local/manual, the client MUST send the connection object in the body
      const body = await request.json();
      connection = body.connection;
      if (!connection) {
        return NextResponse.json({ success: false, error: 'Connection data required for local test' }, { status: 400 });
      }
    }

    // 2. Prepare config (Decrypt fields)
    const sshConfig = {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      readyTimeout: 10000,
    };

    if (connection.authType === 'password') {
      sshConfig.password = decrypt(connection.password);
    } else if (connection.authType === 'privateKey') {
      sshConfig.privateKey = decrypt(connection.privateKey);
      if (connection.passphrase) {
        sshConfig.passphrase = decrypt(connection.passphrase);
      }
    }

    const result = await testSSHConnection(sshConfig);

    // 3. Update DB if it's a DB connection
    if (id && !id.startsWith('local-')) {
      await ConnectionModel.findByIdAndUpdate(id, {
        status: result.success ? 'online' : 'offline',
        lastConnected: result.success ? new Date() : connection.lastConnected,
        info: result.success ? result.info : connection.info,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Test connection error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

function testSSHConnection(config) {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: 'Connection timed out (10s)' });
    }, 10000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn.exec('uptime', (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: true, info: 'Connected' });
          return;
        }
        let output = '';
        stream.on('data', (data) => output += data.toString());
        stream.on('close', () => {
          conn.end();
          resolve({ success: true, info: output.trim() || 'Connected' });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    try {
      conn.connect(config);
    } catch (err) {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    }
  });
}
