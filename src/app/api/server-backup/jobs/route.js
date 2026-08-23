import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const result = await execCommand(sshConfig, `ls -la /tmp/backup_*.tar.gz /tmp/restore_*.tar.gz 2>/dev/null | awk '{print $5, $6, $7, $8, $9}'`);

    const files = (result.stdout || '').trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split(' ');
      return { size: parseInt(parts[0], 10) || 0, date: parts.slice(1, 4).join(' '), path: parts.slice(4).join(' ') };
    });

    return NextResponse.json({ success: true, files });
  } catch (error) {
    logger.error('[server-backup/jobs] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const filePath = searchParams.get('filePath');
    const logFile = searchParams.get('logFile');

    if (!connectionId || !filePath) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const cmd = `rm -f "${filePath}" ${logFile ? `"${logFile}"` : ''}`;
    await execCommand(sshConfig, cmd);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[server-backup/jobs DELETE] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
