import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { migrateConnections } from './migrator';
import { logger } from '@/lib/logger';

/**
 * POST /api/settings/database/migrate
 *
 * Body: { sourceUri: "mongodb://...", targetUri: "postgres://..." }
 *
 * Reads all connections from sourceUri and writes them to targetUri.
 * Skips connections that already exist (by name+host).
 * Credentials are kept encrypted as-is (same ENCRYPTION_KEY on both sides).
 */
export async function POST(request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { sourceUri, targetUri } = await request.json();

    if (!sourceUri || !targetUri) {
      return NextResponse.json({
        success: false,
        error: 'Both sourceUri and targetUri are required.',
      }, { status: 400 });
    }

    const result = await migrateConnections(sourceUri, targetUri);

    return NextResponse.json({
      ...result,
      message: result.migrated > 0
        ? `Migration complete! ${result.migrated} connection(s) migrated, ${result.skipped} skipped.`
        : result.total > 0
          ? `All ${result.total} connections already exist in the target database.`
          : 'No connections found in the source database.',
    });
  } catch (error) {
    logger.error('Migration Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
