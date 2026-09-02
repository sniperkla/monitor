import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpReadStream } from '../_ssh';
import { resolveBackupPath } from '../_history';
import { logger } from '@/lib/logger';

/**
 * Strip anything that could break out of the Content-Disposition header
 * (CR/LF injection) or terminate the quoted filename early.
 */
function safeFilename(value) {
  const fallback = 'backup.tar.gz';
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\r\n"\\]/g, '').trim();
  return cleaned ? cleaned.slice(0, 200) : fallback;
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const fileRef = searchParams.get('fileRef');
    const filePath = searchParams.get('filePath');
    const filename = safeFilename(searchParams.get('filename'));

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    let resolvedPath = null;

    if (fileRef) {
      // Preferred path: the caller only knows an opaque handle. The real
      // remote path is looked up inside that user's own backup history, so a
      // ref borrowed from another account resolves to nothing.
      resolvedPath = await resolveBackupPath(session.user.id, { connectionId, fileRef });
      if (!resolvedPath) {
        return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 });
      }
    } else if (filePath) {
      // Legacy: a backup that just finished is downloaded from the path
      // /api/server-backup/create returned, before any history entry is
      // consulted. Ownership is still enforced by getSshConfig() below.
      resolvedPath = filePath;
    } else {
      return NextResponse.json({ success: false, error: 'Missing fileRef or filePath' }, { status: 400 });
    }

    // getSshConfig() enforces connection ownership for the session user.
    const sshConfig = await getSshConfig(connectionId);
    const stream = await sftpReadStream(sshConfig, resolvedPath);

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.error('[server-backup/download] error:', error.message);
    // The underlying message can carry the remote filesystem path — keep it
    // out of the response body.
    return NextResponse.json({ success: false, error: 'Download failed' }, { status: 500 });
  }
}
