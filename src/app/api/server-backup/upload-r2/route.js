import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpReadStream } from '../_ssh';
import { uploadStreamToR2, isR2Configured } from '@/lib/r2';
import { basename } from '@/utils/pii';
import { logger } from '@/lib/logger';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (!isR2Configured()) {
      return NextResponse.json({ success: false, error: 'R2 storage not configured. Set R2 environment variables.' }, { status: 500 });
    }

    const body = await request.json();
    const { connectionId, filePath, filename } = body;

    if (!connectionId || !filePath) {
      return NextResponse.json({ success: false, error: 'Missing connectionId or filePath' }, { status: 400 });
    }

    const name = filename || filePath.split('/').pop() || 'backup.tar.gz';
    const key = `backups/${connectionId}/${name}`;

    logger.info(`[upload-r2] Starting upload: ${key}`);

    const sshConfig = await getSshConfig(connectionId);
    const stream = await sftpReadStream(sshConfig, filePath);

    await uploadStreamToR2(key, stream, 'application/gzip');

    logger.info(`[upload-r2] Upload complete: ${key}`);

    // Do not return a direct public/presigned URL. A URL is a bearer
    // capability: anyone who sees it can download the backup until it expires,
    // and R2_PUBLIC_DOMAIN would make the capability permanent. Downloads now
    // go through /api/server-backup/download?fileRef=... where the session,
    // connection ownership, and per-user history are checked first.
    return NextResponse.json({
      success: true,
      filename: basename(name) || 'backup.tar.gz',
      cloudStored: true,
    });
  } catch (error) {
    logger.error('[upload-r2] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
