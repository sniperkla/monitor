import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getNoteModel } from '@/models/Note';

export async function GET() {
  try {
    const db = await connectDB();
    const NoteModel = getNoteModel(db);
    const notes = await NoteModel.find({}).sort({ updatedAt: -1 });
    return NextResponse.json({ success: true, data: notes });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = await connectDB();
    const NoteModel = getNoteModel(db);
    const body = await request.json();
    const note = await NoteModel.create({
      title: body.title,
      content: body.content,
    });
    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
