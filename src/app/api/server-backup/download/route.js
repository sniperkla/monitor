import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpReadStream } from '../_ssh';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const filePath = searchParams.get('filePath');
    const filename = searchParams.get('filename') || 'backup.tar.gz';

    if (!connectionId || !filePath) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const stream = await sftpReadStream(sshConfig, filePath);

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error('[server-backup/download] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
