import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectMongo from '@/lib/mongodb';
import MetricsHistory from '@/models/MetricsHistory';

// ── POST /api/server-monitor/history ─────────────────────────────────────────
// Record one or a batch of metrics snapshots.
// Body: { connectionId, cpu, ram, rxBytes, txBytes, disk } OR { snapshots: [...] }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    await connectMongo();

    // Support batch snapshot insertion (e.g. from background agent sync)
    if (Array.isArray(body.snapshots) && body.snapshots.length > 0) {
      const docs = body.snapshots.map(s => ({
        connectionId: String(s.connectionId || body.connectionId),
        recordedAt:   s.recordedAt ? new Date(s.recordedAt) : new Date(),
        cpu:          s.cpu     ?? null,
        ram:          s.ram     ?? null,
        rxBytes:      s.rxBytes ?? null,
        txBytes:      s.txBytes ?? null,
        disk:         s.disk    ?? null,
      })).filter(d => d.connectionId);

      if (docs.length > 0) {
        await MetricsHistory.insertMany(docs, { ordered: false });
      }
      return NextResponse.json({ ok: true, count: docs.length });
    }

    const { connectionId, cpu, ram, rxBytes, txBytes, disk, recordedAt } = body;
    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
    }

    await MetricsHistory.create({
      connectionId: String(connectionId),
      recordedAt:   recordedAt ? new Date(recordedAt) : new Date(),
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
//   range         — 'live' | '1h' | '6h' | '24h' | '7d' | '30d' (default '1h')
//   limit         — max points returned   (default 720, max 2000)
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const range        = searchParams.get('range') || '1h';
    const fromParam    = searchParams.get('from');   // ISO date string for custom range start
    const toParam      = searchParams.get('to');     // ISO date string for custom range end
    const limit        = Math.min(parseInt(searchParams.get('limit') || '720', 10), 2000);

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
    }

    let since, until, windowMs;

    if (fromParam && toParam) {
      // Custom date range — use explicit from/to timestamps
      since   = new Date(fromParam);
      until   = new Date(toParam);
      windowMs = until.getTime() - since.getTime();
      if (isNaN(since.getTime()) || isNaN(until.getTime())) {
        return NextResponse.json({ error: 'Invalid from/to date format' }, { status: 400 });
      }
    } else {
      // Preset range
      const rangeMs = {
        '1h':  3_600_000,
        '6h':  21_600_000,
        '24h': 86_400_000,
        '7d':  7 * 86_400_000,
        '30d': 30 * 86_400_000,
      };
      windowMs = rangeMs[range] ?? rangeMs['1h'];
      since    = new Date(Date.now() - windowMs);
      until    = null; // no upper bound — up to now
    }

    await connectMongo();

    // Fetch raw points sorted oldest-first using index
    const timeFilter = until
      ? { $gte: since, $lte: until }
      : { $gte: since };
    const raw = await MetricsHistory.find(
      { connectionId, recordedAt: timeFilter },
      { recordedAt: 1, cpu: 1, ram: 1, rxBytes: 1, txBytes: 1, disk: 1, _id: 0 }
    )
      .sort({ recordedAt: 1 })
      .hint({ connectionId: 1, recordedAt: 1 })
      .lean();

    // Downsample if raw count exceeds limit (pick evenly spaced points)
    let points = raw;
    if (raw.length > limit) {
      const step = raw.length / limit;
      points = Array.from({ length: limit }, (_, i) => raw[Math.round(i * step)]).filter(Boolean);
    }

    // Format for frontend
    const data = points.map(p => {
      const date = p.recordedAt instanceof Date ? p.recordedAt : new Date(p.recordedAt);
      return {
        t:       date.getTime(),
        label:   formatTime(date, windowMs),
        cpu:     p.cpu,
        ram:     p.ram,
        rxBytes: p.rxBytes,
        txBytes: p.txBytes,
        disk:    p.disk ?? null,
      };
    });

    return NextResponse.json(
      { ok: true, range, count: data.length, data },
      {
        headers: {
          'Cache-Control': 'private, max-age=5, stale-while-revalidate=25'
        }
      }
    );
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
  const mo = (date.getMonth() + 1).toString().padStart(2, '0');
  const d  = date.getDate().toString().padStart(2, '0');
  // 30d: show date only
  if (windowMs >= 30 * 86_400_000) return `${mo}/${d}`;
  // 7d: show day + hour
  if (windowMs >= 7 * 86_400_000) return `${mo}/${d} ${h}:00`;
  // 24h: show date + HH:mm
  if (windowMs >= 86_400_000) return `${mo}/${d} ${h}:${m}`;
  // 1h / 6h: show HH:mm:ss
  return `${h}:${m}:${s}`;
}
