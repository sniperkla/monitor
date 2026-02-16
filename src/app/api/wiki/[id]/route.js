import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getWikiModel } from '@/models/Wiki';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const db = await connectDB(process.env.MONGODB_URI, true);
    const WikiModel = getWikiModel(db);

    const guide = await WikiModel.findById(id);
    if (!guide) {
      return NextResponse.json({ success: false, error: 'Guide not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: guide });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
