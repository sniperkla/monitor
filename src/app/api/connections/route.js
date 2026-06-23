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
    let connections = await repo.findAll();

    // Filter localhost connections: only show if matching relay is active
    const userId = session.user?.id || session.user?.sub;
    const userRelays = global.__activeRelays?.get(userId);
    const activeRelayNames = new Set();
    if (userRelays instanceof Map) {
      for (const [relayId, relay] of userRelays) {
        activeRelayNames.add(relayId);
        if (relay.relayName) activeRelayNames.add(relay.relayName);
      }
    }

    const isLocalhost = (host) => /localhost|127\.0\.0\.1/.test(host);
    const hasAnyRelay = activeRelayNames.size > 0;
    connections = connections.filter(conn => {
      if (!isLocalhost(conn.host)) return true;
      // Localhost connection — show if any relay is active (routing handles the rest)
      return hasAnyRelay;
    });
    
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
      authSource: conn.authSource || null,
      notes: conn.notes,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      // SSH Tunnel metadata (no secrets)
      sshTunnel: !!conn.sshTunnel,
      sshTunnelHost: conn.sshTunnelHost || null,
      sshTunnelPort: conn.sshTunnelPort || 22,
      sshTunnelUser: conn.sshTunnelUser || null,
      sshTunnelAuth: conn.sshTunnelAuth || 'password',
      relayName: conn.relayName || null,
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
      relayName: body.relayName || null,
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

