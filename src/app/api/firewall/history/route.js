import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectMongo from '@/lib/mongodb';
import FirewallHistory from '@/models/FirewallHistory';

/**
 * GET /api/firewall/history?connectionId=<id>&limit=<n>
 *
 * Returns recent cumulative block-counter samples (ascending) recorded by the
 * ServerMonitor agent, used to seed the firewall telemetry sparkline with
 * attack history that was captured while the app was closed.
 */
export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const connectionId = new URL(request.url).searchParams.get('connectionId');
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }
    const limit = Math.min(150, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 25));

    await connectMongo();
    const docs = await FirewallHistory
      .find({ connectionId })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean();

    const samples = docs.reverse().map(d => ({
      t: new Date(d.recordedAt).getTime(),
      packets: Number(d.packets) || 0,
      bytes: Number(d.bytes) || 0,
    }));

    return NextResponse.json({ success: true, samples });
  } catch (error) {
    console.error('[firewall history]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
