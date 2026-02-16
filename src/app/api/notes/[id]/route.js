import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getNoteModel } from '@/models/Note';

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB();
    const NoteModel = getNoteModel(db);
    const body = await request.json();
    const note = await NoteModel.findByIdAndUpdate(id, {
      title: body.title,
      content: body.content,
    }, { new: true });
    return NextResponse.json({ success: true, data: note });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB();
    const NoteModel = getNoteModel(db);
    await NoteModel.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
