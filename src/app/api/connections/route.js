import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getConnectionModel } from '@/models/Connection';

import { encrypt } from '@/utils/encryption';

// GET all connections
export async function GET() {
  try {
    const db = await connectDB();
    const ConnectionModel = getConnectionModel(db);
    const connections = await ConnectionModel.find({}).sort({ updatedAt: -1 });
    
    // Sanitize - don't send sensitive data
    const sanitized = connections.map(conn => ({
      _id: conn._id,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
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
    const ConnectionModel = getConnectionModel(db);
    const body = await request.json();

    const connection = await ConnectionModel.create({
      name: body.name,
      host: body.host,
      port: body.port || 22,
      username: body.username,
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
