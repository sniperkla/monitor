import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';

// GET all connections
export async function GET() {
  try {
    const db = await connectDB();
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

