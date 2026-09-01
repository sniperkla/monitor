import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';
import { logger } from '@/lib/logger';
import { shellQuote } from '@/utils/shellQuote';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const logFile = searchParams.get('logFile');
    const outFile = searchParams.get('outFile');

    if (!connectionId || !logFile || !outFile) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    // logFile / outFile come straight from the query string — quote them.
    const result = await execCommand(sshConfig, `cat ${shellQuote(logFile)} 2>/dev/null; echo ""; ls -la ${shellQuote(outFile)} 2>/dev/null | awk '{print $5}'`);

    const logs = result.stdout || '';
    const finished = logs.includes('---FINISHED---');
    const failed = logs.includes('---ERROR---') || (result.code !== null && result.code !== 0 && !finished);

    let backupSize = null;
    if (finished) {
      const lines = logs.trim().split('\n');
      const lastLine = lines[lines.length - 1]?.trim();
      if (lastLine && /^\d+$/.test(lastLine)) backupSize = parseInt(lastLine, 10);
    }

    return NextResponse.json({
      success: true,
      status: finished ? 'completed' : failed ? 'failed' : 'running',
      logs: logs.replace(/---FINISHED---|---ERROR---/g, '').trim(),
      backupSize,
      logFile,
      outFile
    });
  } catch (error) {
    logger.error('[server-backup/status] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
