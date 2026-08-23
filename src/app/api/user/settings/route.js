import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import mongoose from 'mongoose';
import User from "@/models/User";
import { logger } from '@/lib/logger';

async function ensureConnected() {
  if (mongoose.connection.readyState === 1) return; // already connected by server.js
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('No center DB URI configured');
  if (!uri.startsWith('mongodb')) throw new Error('Settings require a MongoDB center DB');
  await mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 5000 });
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await ensureConnected();
    const user = await User.findOne({ email: session.user.email }).lean();

    return NextResponse.json({
      success: true,
      settings: user?.settings || {}
    });
  } catch (error) {
    logger.error('[settings] GET error:', error.message);
    return NextResponse.json({ success: true, settings: {} }); // graceful fallback — use localStorage
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await request.json();

    await ensureConnected();
    await User.findOneAndUpdate(
      { email: session.user.email },
      { $set: { settings } },
      { upsert: true, runValidators: false }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[settings] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }}