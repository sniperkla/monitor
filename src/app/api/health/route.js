import { NextResponse } from 'next/server';
import { checkMemory, LIMITS } from '@/lib/serverGuard';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const memory = checkMemory();
    const dbStatus = mongoose.connection.readyState;
    const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbStatus] || 'unknown';

    const health = {
      status: memory.safe ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      services: {
        database: {
          status: dbStatus === 1 ? 'up' : 'down',
          state: dbState
        },
        memory: {
          status: memory.safe ? 'healthy' : 'warning',
          free: `${memory.sysFreeMB}MB`,
          rss: `${memory.rssMB}MB`,
          usage: `${memory.usagePercent}%`
        }
      },
      limits: LIMITS
    };

    return NextResponse.json(health, { status: memory.safe ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({ 
      status: 'error', 
      error: error.message 
    }, { status: 500 });
  }
}
