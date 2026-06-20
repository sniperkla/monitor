import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import mongoose from 'mongoose';

const isValidMongoId = (id) => mongoose.Types.ObjectId.isValid(id);

// PUT toggle favorite
export async function PUT(request, { params }) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

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

    const newStatus = !connection.isFavorite;
    await repo.update(id, { isFavorite: newStatus });

    const updated = await repo.findById(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

