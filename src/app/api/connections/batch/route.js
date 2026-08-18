import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Connection from '@/models/Connection';

export async function POST(request) {
  try {
    const { ids } = await request.json();
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    // Fetch multiple connections in a single query
    const connections = await Connection.find({
      _id: { $in: ids }
    }).lean();

    return NextResponse.json({
      success: true,
      data: connections
    });
  } catch (error) {
    console.error('Batch connections fetch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch connections' }, { status: 500 });
  }
}