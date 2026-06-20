import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wiki, { getWikiModel } from '@/models/Wiki';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const category = searchParams.get('category');
    const os = searchParams.get('os');

    const db = await connectDB(process.env.MONGODB_URI, true);
    const WikiModel = getWikiModel(db);

    let filter = {};
    if (query) {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: escapedQuery, $options: 'i' } },
        { description: { $regex: escapedQuery, $options: 'i' } },
        { tags: { $elemMatch: { $regex: escapedQuery, $options: 'i' } } },
        { 'commands.label': { $regex: escapedQuery, $options: 'i' } },
        { 'commands.code': { $regex: escapedQuery, $options: 'i' } },
        { 'commands.explanation': { $regex: escapedQuery, $options: 'i' } }
      ];
    }
    if (category && category !== 'All') {
      filter.category = category;
    }
    if (os && os !== 'All') {
      filter.os = os;
    }

    const guides = await WikiModel.find(filter).sort({ title: 1 });
    
    const allCategories = await WikiModel.distinct('category');
    const allOs = await WikiModel.distinct('os');

    return NextResponse.json({ 
      success: true, 
      data: guides,
      categories: ['All', ...allCategories],
      osList: ['All', ...allOs]
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Seed function to add some initial data if empty
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const db = await connectDB();
    const WikiModel = getWikiModel(db);
    const body = await request.json();

    const guide = await WikiModel.create(body);
    return NextResponse.json({ success: true, data: guide }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
