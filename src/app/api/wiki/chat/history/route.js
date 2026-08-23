import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { getChatHistoryModel } from '@/models/ChatHistory';
import { logger } from '@/lib/logger';

// GET all chat history for the user
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    
    // Always use Central DB for chat history to avoid crashing on MySQL private DBs
    const db = await connectDB(null, true);
    const ChatHistoryModel = getChatHistoryModel(db);
    
    const histories = await ChatHistoryModel.find({ userId })
      .select('title guideId updatedAt lastMessageAt')
      .sort({ lastMessageAt: -1 });
      
    return NextResponse.json({ success: true, data: histories });
  } catch (error) {
    logger.error('Failed to fetch chat history:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST create or update chat history
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { historyId, guideId, title, messages } = await req.json();
    
    if (!messages || !messages.length) {
      return NextResponse.json({ success: false, error: 'Messages are required' }, { status: 400 });
    }

    // Always use Central DB for chat history
    const db = await connectDB(null, true);
    const ChatHistoryModel = getChatHistoryModel(db);
    
    let history;
    if (historyId) {
      history = await ChatHistoryModel.findOneAndUpdate(
        { _id: historyId, userId },
        { 
          messages, 
          lastMessageAt: new Date(),
          title: title || (messages.length > 1 ? messages[1].content.substring(0, 50) : title)
        },
        { new: true }
      );
    } else {
      history = await ChatHistoryModel.create({
        userId,
        guideId,
        title: title || messages[0].content.substring(0, 50),
        messages,
        lastMessageAt: new Date()
      });
    }
    
    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    logger.error('Failed to save chat history:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
