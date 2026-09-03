import { NextResponse } from 'next/server';
import { checkMemory } from '@/lib/serverGuard';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const memory = checkMemory();
    const mongoUp = mongoose.connection.readyState === 1;

    // Relay: check if any relay agents are active globally
    const relayCount = global.__activeRelays?.size ?? 0;
    const relayUp = relayCount > 0;

    const status = memory.safe && mongoUp ? 'ok' : 'degraded';

    // Return overall status, timestamp, and boolean health flags needed by the UI.
    // Detailed telemetry (mongo readyState numbers, active tenant relay counts,
    // memory pressure indicators) is withheld to prevent unauthenticated reconnaissance.
    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
      mongo: {
        up: mongoUp,
      },
      relay: {
        up: relayUp,
      },
    }, { status: status === 'ok' ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
