import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  HISTORY_KEY,
  MAX_ENTRIES,
  loadBackupHistory,
  saveBackupHistory,
  sanitizeStoredEntry,
  toPublicEntry,
} from '../_history';

export const dynamic = 'force-dynamic';

// GET — load backup history
//
// Returns metadata only. Remote server paths (`/tmp/backup_<uuid>.tar.gz`),
// log paths and presigned CDN URLs stay on the server; each entry exposes an
// opaque `fileRef` that /api/server-backup/download resolves server-side.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const history = await loadBackupHistory(session.user.id);
    return NextResponse.json({
      success: true,
      history: history.map(toPublicEntry).filter(Boolean),
    });
  } catch (error) {
    logger.error('[server-backup/history] GET error:', error.message);
    // Never echo the raw error: internal messages have historically included
    // filesystem paths from the mongoose driver.
    return NextResponse.json({ success: false, error: 'Failed to load backup history' }, { status: 500 });
  }
}

// POST — save backup history (replaces entire list)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { history } = body;

    if (!Array.isArray(history)) {
      return NextResponse.json({ success: false, error: 'history must be an array' }, { status: 400 });
    }

    // Cap at MAX_ENTRIES and drop anything that fails the whitelist.
    const trimmed = history
      .slice(0, MAX_ENTRIES)
      .map(sanitizeStoredEntry)
      .filter(Boolean);

    await saveBackupHistory(session.user.id, trimmed);

    return NextResponse.json({
      success: true,
      history: trimmed.map(toPublicEntry).filter(Boolean),
    });
  } catch (error) {
    logger.error('[server-backup/history] POST error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to save backup history' }, { status: 500 });
  }
}

// Keep the key name exported for callers/scripts that imported it previously.
export { HISTORY_KEY };
