import { NextResponse } from 'next/server';
import { checkMemory } from '@/lib/serverGuard';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const memory = checkMemory();
    const dbReadyState = mongoose.connection.readyState;
    // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    const mongoUp = dbReadyState === 1;

    // Relay: check if any relay agents are active globally
    const relayCount = global.__activeRelays?.size ?? 0;
    const relayUp = relayCount > 0;

    const status = memory.safe && mongoUp ? 'ok' : 'degraded';

    // Return status and timestamp only. Internal database readyStates,
    // active relay counts, and memory details are withheld to prevent
    // unauthenticated reconnaissance and telemetry leakage.
    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
    }, { status: status === 'ok' ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
