import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpReadStream } from '../_ssh';
import { uploadStreamToR2, getPresignedUrl, isR2Configured } from '@/lib/r2';

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

    console.log(`[upload-r2] Starting upload: ${key}`);

    const sshConfig = await getSshConfig(connectionId);
    const stream = await sftpReadStream(sshConfig, filePath);

    await uploadStreamToR2(key, stream, 'application/gzip');

    console.log(`[upload-r2] Upload complete: ${key}`);

    const downloadUrl = await getPresignedUrl(key, 86400); // 24h expiry

    return NextResponse.json({
      success: true,
      downloadUrl,
      key,
    });
  } catch (error) {
    console.error('[upload-r2] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
