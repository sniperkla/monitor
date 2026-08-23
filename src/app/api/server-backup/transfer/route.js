import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpTransfer } from '../_ssh';
import { logger } from '@/lib/logger';

// In-memory job store: transferId → { status, transferred, totalSize, percent, error, controller }
const transferJobs = new Map();

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// POST /api/server-backup/transfer — start transfer, returns transferId immediately
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceConnectionId, sourcePath, targetConnectionId, targetPath } = body;

    if (!sourceConnectionId || !sourcePath || !targetConnectionId || !targetPath) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const transferId = makeId();
    const controller = new AbortController();

    transferJobs.set(transferId, {
      status: 'connecting',
      transferred: 0,
      totalSize: 0,
      percent: 0,
      error: null,
      controller,
      sourcePath,
      targetPath,
      startedAt: Date.now(),
    });

    // Run transfer in background (do not await)
    (async () => {
      try {
        const job = transferJobs.get(transferId);
        if (!job) return;
        job.status = 'running';

        const [sourceConfig, targetConfig] = await Promise.all([
          getSshConfig(sourceConnectionId),
          getSshConfig(targetConnectionId),
        ]);

        if (controller.signal.aborted) return;

        const result = await sftpTransfer(sourceConfig, sourcePath, targetConfig, targetPath, {
          signal: controller.signal,
          onProgress: ({ transferred, totalSize, percent }) => {
            const j = transferJobs.get(transferId);
            if (j) { j.transferred = transferred; j.totalSize = totalSize; j.percent = percent; }
          },
        });

        const j = transferJobs.get(transferId);
        if (j) {
          j.status = 'completed';
          j.transferred = result.transferred;
          j.totalSize = result.totalSize;
          j.percent = 100;
        }
      } catch (err) {
        const j = transferJobs.get(transferId);
        if (j) {
          j.status = err.message === 'Transfer cancelled by user' ? 'cancelled' : 'failed';
          j.error = err.message;
        }
      }
    })();

    // Clean up old jobs (keep last 20)
    if (transferJobs.size > 20) {
      const oldest = [...transferJobs.entries()]
        .sort((a, b) => (a[1].startedAt || 0) - (b[1].startedAt || 0))
        .slice(0, transferJobs.size - 20);
      oldest.forEach(([id]) => transferJobs.delete(id));
    }

    return NextResponse.json({ success: true, transferId });
  } catch (error) {
    logger.error('[server-backup/transfer] POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/server-backup/transfer?transferId=xxx — poll progress
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const transferId = searchParams.get('transferId');
    if (!transferId) return NextResponse.json({ success: false, error: 'Missing transferId' }, { status: 400 });

    const job = transferJobs.get(transferId);
    if (!job) return NextResponse.json({ success: false, error: 'Transfer job not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      status: job.status,
      transferred: job.transferred,
      totalSize: job.totalSize,
      percent: job.percent,
      error: job.error,
      sourcePath: job.sourcePath,
      targetPath: job.targetPath,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/server-backup/transfer?transferId=xxx — cancel transfer
export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const transferId = searchParams.get('transferId');
    if (!transferId) return NextResponse.json({ success: false, error: 'Missing transferId' }, { status: 400 });

    const job = transferJobs.get(transferId);
    if (!job) return NextResponse.json({ success: false, error: 'Transfer job not found' }, { status: 404 });

    job.controller.abort();
    job.status = 'cancelled';

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
