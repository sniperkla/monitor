import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { checkRateLimit } from '@/lib/serverGuard';

// Lightweight SSH ping - only measures connection time, no commands
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ping:${clientIP}`, 120);
    if (!rateCheck.allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Connection ID required' }, { status: 400 });
    }

    const db = await connectDB();
    const repo = new ConnectionRepository(db);
    const conn = await repo.findById(id);
    if (!conn) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    const sshConfig = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      readyTimeout: 10000,
    };

    if (conn.authType === 'password') {
      sshConfig.password = decrypt(conn.password);
    } else if (conn.authType === 'privateKey') {
      sshConfig.privateKey = decrypt(conn.privateKey);
      if (conn.passphrase) sshConfig.passphrase = decrypt(conn.passphrase);
    }

    const startTime = Date.now();

    const result = await new Promise((resolve) => {
      const sshClient = new Client();
      const timeout = setTimeout(() => {
        sshClient.end();
        resolve({ success: false, latency: Date.now() - startTime, error: 'Timeout (10s)' });
      }, 10000);

      sshClient.on('ready', () => {
        clearTimeout(timeout);
        const latency = Date.now() - startTime;
        sshClient.end();
        resolve({ success: true, latency });
      });

      sshClient.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, latency: Date.now() - startTime, error: err.message });
      });

      try {
        sshClient.connect(sshConfig);
      } catch (err) {
        clearTimeout(timeout);
        resolve({ success: false, latency: Date.now() - startTime, error: err.message });
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Ping error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
