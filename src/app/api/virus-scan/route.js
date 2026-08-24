import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { getVirusScanModel } from '@/models/VirusScan';
import { getSshConfig } from '@/app/api/server-backup/_ssh';
import { runSecurityScan, SCAN_CHECK_COUNT } from '@/lib/virusScanner';

const MAX_CONCURRENT_PER_USER = 1;
const KEEP_SCANS = 20;

function summarize(findings) {
  const s = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (s[f.severity] !== undefined) s[f.severity]++;
  }
  return s;
}

/** GET — latest scan for a connection + recent history */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;

    const db = await connectDB();
    const Model = getVirusScanModel(db);
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    const query = connectionId ? { userId, connectionId } : { userId };
    const [latest, history] = await Promise.all([
      Model.findOne(query).sort({ createdAt: -1 }).lean(),
      Model.find(query).sort({ createdAt: -1 }).limit(10).select('status mode summary host createdAt durationMs').lean(),
    ]);

    return NextResponse.json({ success: true, latest, history });
  } catch (error) {
    console.error('[virus-scan] GET error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to load scan results' }, { status: 500 });
  }
}

/** POST — start a new scan on a connection. Runs synchronously (~10-30s). */
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;

    let body;
    try { body = await request.json(); } catch (_) {}
    const connectionId = body?.connectionId;
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing field: connectionId' }, { status: 400 });
    }

    const db = await connectDB();
    const Model = getVirusScanModel(db);

    // Prevent overlapping scans per user
    const running = await Model.countDocuments({ userId, status: 'running' });
    if (running >= MAX_CONCURRENT_PER_USER) {
      return NextResponse.json({ success: false, error: 'A scan is already in progress' }, { status: 429 });
    }

    // Resolve host label early (also validates access to the connection)
    let hostLabel = null;
    try {
      const cfg = await getSshConfig(connectionId, { userId });
      hostLabel = `${cfg.username}@${cfg.host}`;
    } catch (e) {
      return NextResponse.json({ success: false, error: e.message || 'Cannot reach server' }, { status: 400 });
    }

    const scan = await Model.create({
      userId,
      connectionId,
      host: hostLabel,
      status: 'running',
      mode: ['quick', 'full'].includes(body?.mode) ? body.mode : 'deep',
      currentCheck: 'Connecting…',
    });

    try {
      const { findings, durationMs } = await runSecurityScan(getSshConfig, connectionId, {
        userId,
        mode: ['quick', 'full'].includes(body?.mode) ? body.mode : 'deep',
        onProgress: async (idx, total, label) => {
          try {
            await Model.updateOne(
              { _id: scan._id },
              { $set: { progress: Math.round((idx / total) * 100), currentCheck: label } }
            );
          } catch (_) {}
        },
      });

      scan.status = 'completed';
      scan.findings = findings;
      scan.summary = summarize(findings);
      scan.progress = 100;
      scan.currentCheck = null;
      scan.durationMs = durationMs;
      await scan.save();

      // Prune old scans
      const old = await Model.find({ userId }).sort({ createdAt: -1 }).skip(KEEP_SCANS).select('_id').lean();
      if (old.length) await Model.deleteMany({ _id: { $in: old.map(d => d._id) } });

      return NextResponse.json({ success: true, scan: scan.toObject() });
    } catch (err) {
      scan.status = 'failed';
      scan.error = err?.message || 'Scan failed';
      await scan.save();
      return NextResponse.json({ success: false, error: scan.error, scan: scan.toObject() }, { status: 500 });
    }
  } catch (error) {
    console.error('[virus-scan] POST error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to start scan' }, { status: 500 });
  }
}

/** DELETE — clear all scan history for the user (optionally one connection) */
export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user?.id || session.user?.sub;
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    const db = await connectDB();
    const Model = getVirusScanModel(db);
    const query = connectionId ? { userId, connectionId } : { userId };
    const res = await Model.deleteMany(query);
    return NextResponse.json({ success: true, deleted: res.deletedCount ?? 0 });
  } catch (error) {
    console.error('[virus-scan] DELETE error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to clear history' }, { status: 500 });
  }
}