import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';

// GET all connections
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connections_get:${clientIP}`, 200);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    let db;
    try {
      db = await connectDB();
    } catch (dbErr) {
      // Localhost URI without relay — return empty list with relay hint instead of crashing
      if (dbErr.message?.includes('Local Relay Agent')) {
        return NextResponse.json({
          success: true,
          data: [],
          relayRequired: true,
          relayMessage: dbErr.message,
        });
      }
      throw dbErr;
    }

    const repo = new ConnectionRepository(db);
    await repo.init();
    const connections = await repo.findAll();
    
    // Sanitize - don't send sensitive data
    const sanitized = connections.map(conn => ({
      _id: conn._id,
      name: conn.name,
      type: conn.type || 'ssh',
      dbProvider: conn.dbProvider || 'mongodb',
      host: conn.host,
      port: conn.port,
      username: conn.username,
      database: conn.database,
      authType: conn.authType,
      keyFileName: conn.keyFileName,
      tags: conn.tags,
      color: conn.color,
      lastConnected: conn.lastConnected,
      status: conn.status,
      isFavorite: conn.isFavorite,
      notes: conn.notes,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      // SSH Tunnel metadata (no secrets)
      sshTunnel: !!conn.sshTunnel,
      sshTunnelHost: conn.sshTunnelHost || null,
      sshTunnelPort: conn.sshTunnelPort || 22,
      sshTunnelUser: conn.sshTunnelUser || null,
      sshTunnelAuth: conn.sshTunnelAuth || 'password',
    }));

    return NextResponse.json({ success: true, data: sanitized });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST create new connection
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`connections_post:${clientIP}`, 50);
    if (!rateCheck.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const db = await connectDB();
    const repo = new ConnectionRepository(db);
    await repo.init();
    const body = await request.json();

    const connection = await repo.create({
      name: body.name,
      type: body.type || 'ssh',
      dbProvider: body.dbProvider || 'mongodb',
      host: body.host,
      port: body.port,
      username: body.username,
      database: body.database || null,
      authType: body.authType,
      password: body.authType === 'password' ? encrypt(body.password) : null,
      privateKey: body.authType === 'privateKey' ? encrypt(body.privateKey) : null,
      keyFileName: body.keyFileName || null,
      passphrase: encrypt(body.passphrase) || null,
      tags: body.tags || [],
      color: body.color || '#6366f1',
      notes: body.notes || '',
      // SSH Tunnel
      sshTunnel: !!body.sshTunnel,
      sshTunnelHost: body.sshTunnelHost || null,
      sshTunnelPort: body.sshTunnelPort || 22,
      sshTunnelUser: body.sshTunnelUser || null,
      sshTunnelAuth: body.sshTunnelAuth || 'password',
      sshTunnelPassword: body.sshTunnelPassword ? encrypt(body.sshTunnelPassword) : null,
      sshTunnelPrivateKey: body.sshTunnelPrivateKey ? encrypt(body.sshTunnelPrivateKey) : null,
      sshTunnelPassphrase: body.sshTunnelPassphrase ? encrypt(body.sshTunnelPassphrase) : null,
    });

    return NextResponse.json(
      { success: true, data: { _id: connection._id, name: connection.name } },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

