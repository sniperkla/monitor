import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { encrypt } from '@/utils/encryption';
import mongoose from 'mongoose';

const isValidMongoId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

    if (db.type !== 'mysql' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.findById(id);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: connection });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

    if (db.type !== 'mysql' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();

    if (body.password) body.password = encrypt(body.password);
    if (body.privateKey) body.privateKey = encrypt(body.privateKey);
    if (body.passphrase) body.passphrase = encrypt(body.passphrase);

    const success = await repo.update(id, body);

    if (!success) {
      return NextResponse.json({ success: false, error: 'Connection not found or update failed' }, { status: 404 });
    }

    const updated = await repo.findById(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB();
    const repo = new ConnectionRepository(db);

    if (db.type !== 'mysql' && !isValidMongoId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const connection = await repo.delete(id);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

