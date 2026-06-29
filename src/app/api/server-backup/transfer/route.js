import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, sftpTransfer } from '../_ssh';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sourceConnectionId, sourcePath, targetConnectionId, targetPath } = body;

    if (!sourceConnectionId || !sourcePath || !targetConnectionId || !targetPath) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const sourceConfig = await getSshConfig(sourceConnectionId);
    const targetConfig = await getSshConfig(targetConnectionId);

    const result = await sftpTransfer(sourceConfig, sourcePath, targetConfig, targetPath);

    return NextResponse.json({
      success: true,
      transferred: result.transferred,
      totalSize: result.totalSize,
    });
  } catch (error) {
    console.error('[server-backup/transfer] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
