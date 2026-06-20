import { NextResponse } from 'next/server';
import { checkMemory } from '@/lib/serverGuard';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const memory = checkMemory();
    const dbStatus = mongoose.connection.readyState;

    const health = {
      status: memory.safe && dbStatus === 1 ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(health, { status: health.status === 'ok' ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
