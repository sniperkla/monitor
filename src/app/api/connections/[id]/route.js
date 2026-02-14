import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getConnectionModel } from '@/models/Connection';
import { encrypt } from '@/utils/encryption';
import mongoose from 'mongoose';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const db = await connectDB();
    const ConnectionModel = getConnectionModel(db);
    const connection = await ConnectionModel.findById(id);

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
    if (!isValidId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const db = await connectDB();
    const ConnectionModel = getConnectionModel(db);
    const body = await request.json();

    if (body.password) body.password = encrypt(body.password);
    if (body.privateKey) body.privateKey = encrypt(body.privateKey);
    if (body.passphrase) body.passphrase = encrypt(body.passphrase);

    const connection = await ConnectionModel.findByIdAndUpdate(
      id,
      { ...body },
      { new: true, runValidators: true }
    );

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: connection });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const db = await connectDB();
    const ConnectionModel = getConnectionModel(db);
    const connection = await ConnectionModel.findByIdAndDelete(id);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
