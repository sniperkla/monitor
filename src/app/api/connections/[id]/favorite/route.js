import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getConnectionModel } from '@/models/Connection';
import mongoose from 'mongoose';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// PUT toggle favorite
export async function PUT(request, { params }) {
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

    connection.isFavorite = !connection.isFavorite;
    await connection.save();

    return NextResponse.json({ success: true, data: connection });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
