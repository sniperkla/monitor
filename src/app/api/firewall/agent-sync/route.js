import { NextResponse } from 'next/server';
import connectMongo from '@/lib/mongodb';
import FirewallHistory from '@/models/FirewallHistory';
import { logger } from '@/lib/logger';

/**
 * POST /api/firewall/agent-sync
 *
 * Receives batches of cumulative firewall block counters from the ServerMonitor
 * agent running on the target server. Authenticated with the same relay token
 * the agent uses for its /agent-ws WebSocket handshake (x-agent-token header),
 * validated against global.__relayTokens.
 *
 * Body: { connectionId, samples: [{ t, packets, bytes }] }
 */
export async function POST(request) {
  try {
    const token = request.headers.get('x-agent-token');
    const entry = (global.__relayTokens || new Map()).get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      return NextResponse.json({ success: false, error: 'Invalid or expired agent token' }, { status: 401 });
    }
    // Record usage so GET /api/relay/token can surface credentials that are
    // active when they should be idle.
    entry.lastUsed = Date.now();

    const body = await request.json();
    const connectionId = String(body?.connectionId || '').trim();
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }
    if (!Array.isArray(body.samples) || body.samples.length === 0) {
      return NextResponse.json({ success: false, error: 'samples array is required' }, { status: 400 });
    }

    // Sanitize: keep only numeric fields within sane bounds, cap batch size
    const now = Date.now();
    const docs = body.samples
      .slice(0, 1000)
      .map(s => ({
        connectionId,
        recordedAt: new Date(Math.min(Number(s?.t) || now, now + 60000)),
        packets: Math.max(0, Number(s?.packets) || 0),
        bytes: Math.max(0, Number(s?.bytes) || 0),
        source: 'agent',
      }))
      .filter(d => Number.isFinite(d.recordedAt.getTime()));

    if (docs.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid samples' }, { status: 400 });
    }

    await connectMongo();
    await FirewallHistory.insertMany(docs, { ordered: false });

    return NextResponse.json({ success: true, count: docs.length });
  } catch (error) {
    logger.error('[firewall agent-sync]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
