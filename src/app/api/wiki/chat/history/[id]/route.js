import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { getChatHistoryModel } from '@/models/ChatHistory';
import { logger } from '@/lib/logger';

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;
    
    const db = await connectDB();
    const ChatHistoryModel = getChatHistoryModel(db);
    
    const history = await ChatHistoryModel.findOne({ _id: id, userId });
    
    if (!history) {
      return NextResponse.json({ success: false, error: 'History not found' }, { status: 404 });
    }
      
    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    logger.error('Failed to fetch chat history:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
       return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;
    
    const db = await connectDB();
    const ChatHistoryModel = getChatHistoryModel(db);
    
    await ChatHistoryModel.deleteOne({ _id: id, userId });
      
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete chat history:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
