import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '../_ssh';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const path = searchParams.get('path') || '/';

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    // Sanitize path
    const safePath = path.replace(/[`$]/g, '').replace(/\.\./g, '');

    const sshConfig = await getSshConfig(connectionId);
    // List directories and files with type indicator, sorted dirs first
    const cmd = `ls -1ap --group-directories-first '${safePath}' 2>/dev/null | head -200`;
    const result = await execCommand(sshConfig, cmd);

    if (result.code !== 0) {
      return NextResponse.json({ success: false, error: result.stderr || `Cannot list directory: ${safePath}` }, { status: 500 });
    }

    const entries = result.stdout
      .split('\n')
      .filter(line => line.trim())
      .map(name => ({
        name: name.replace(/\/$/, ''),
        isDir: name.endsWith('/'),
      }))
      .filter(e => e.name && e.name !== '.' && e.name !== '..');

    return NextResponse.json({ success: true, path: safePath, entries });
  } catch (error) {
    console.error('[server-backup/browse] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
