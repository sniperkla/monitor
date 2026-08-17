import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectMongo from '@/lib/mongodb';
import MetricsHistory from '@/models/MetricsHistory';

// ── POST /api/server-monitor/history ─────────────────────────────────────────
// Record a single metrics snapshot.
// Body: { connectionId, cpu, ram, rxBytes, txBytes }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { connectionId, cpu, ram, rxBytes, txBytes, disk } = await req.json();
    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
    }

    await connectMongo();

    await MetricsHistory.create({
      connectionId: String(connectionId),
      recordedAt:   new Date(),
      cpu:          cpu     ?? null,
      ram:          ram     ?? null,
      rxBytes:      rxBytes ?? null,
      txBytes:      txBytes ?? null,
      disk:         disk    ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[metrics-history POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── GET /api/server-monitor/history ──────────────────────────────────────────
// Query historical snapshots for a connection within a time range.
// Query params:
//   connectionId  — required
//   range         — '1h' | '6h' | '24h'  (default '1h')
//   limit         — max points returned   (default 360, max 2000)
//
// Returns downsampled data so the chart stays performant regardless of
// how many raw snapshots are in the DB.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const range        = searchParams.get('range') || '1h';
    const limit        = Math.min(parseInt(searchParams.get('limit') || '360', 10), 2000);

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
    }

    // Determine time window
    const rangeMs = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 };
    const windowMs = rangeMs[range] ?? rangeMs['1h'];
    const since = new Date(Date.now() - windowMs);

    await connectMongo();

    // Fetch raw points sorted oldest-first
    const raw = await MetricsHistory.find(
      { connectionId, recordedAt: { $gte: since } },
      { recordedAt: 1, cpu: 1, ram: 1, rxBytes: 1, txBytes: 1, disk: 1, _id: 0 }
    )
      .sort({ recordedAt: 1 })
      .lean();

    // Downsample if raw count exceeds limit (pick every Nth point)
    let points = raw;
    if (raw.length > limit) {
      const step = raw.length / limit;
      points = Array.from({ length: limit }, (_, i) => raw[Math.round(i * step)]);
    }

    // Format for the frontend
    const data = points.map(p => ({
      t:       p.recordedAt.getTime(),
      label:   formatTime(p.recordedAt, windowMs),
      cpu:     p.cpu,
      ram:     p.ram,
      rxBytes: p.rxBytes,
      txBytes: p.txBytes,
      disk:    p.disk ?? null,
    }));

    return NextResponse.json({ ok: true, range, count: data.length, data });
  } catch (err) {
    console.error('[metrics-history GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function formatTime(date, windowMs) {
  const h  = date.getHours().toString().padStart(2, '0');
  const m  = date.getMinutes().toString().padStart(2, '0');
  const s  = date.getSeconds().toString().padStart(2, '0');
  // For 24h range include the date prefix
  if (windowMs >= 86_400_000) {
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    const d  = date.getDate().toString().padStart(2, '0');
    return `${mo}/${d} ${h}:${m}`;
  }
  return `${h}:${m}:${s}`;
}
