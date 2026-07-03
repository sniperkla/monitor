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

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const result = await execCommand(sshConfig, "docker ps -a --format '{{.Names}}\t{{.ID}}\t{{.Status}}\t{{.Image}}'");

    if (result.code !== 0) {
      return NextResponse.json({ success: false, error: result.stderr || 'Failed to list containers' }, { status: 500 });
    }

    const containers = result.stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name, id, status, image] = line.split('\t');
        return { name: name?.trim(), id: id?.trim(), status: status?.trim(), image: image?.trim() };
      })
      .filter(c => c.name);

    return NextResponse.json({ success: true, containers });
  } catch (error) {
    console.error('[server-backup/containers] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
