import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { shellQuoteExpandHome } from '@/utils/shellQuote';

const quote = shellQuoteExpandHome;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const remote = searchParams.get('remote') || '';
    const path = searchParams.get('path') || '';

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"; ';
    
    let target = '';
    let isLocal = false;

    if (!remote || remote === 'local' || path.startsWith('/') || path.startsWith('$HOME') || path.startsWith('~')) {
      isLocal = true;
      target = path || '/';
    } else {
      target = remote.endsWith(':') ? `${remote}${path}` : `${remote}:${path}`;
    }

    const cmd = `${pathPrefix}rclone lsjson ${quote(target)} 2>/dev/null`;
    const result = await execCommand(sshConfig, cmd);

    if (result.code === 0 && result.stdout.trim()) {
      let items = [];
      try {
        items = JSON.parse(result.stdout.trim());
      } catch (_) {
        items = [];
      }
      return NextResponse.json({
        success: true,
        target,
        isLocal,
        items: Array.isArray(items) ? items : [items],
      });
    }

    // Fallback for local server directory browsing if rclone lsjson is empty
    if (isLocal) {
      const lsCmd = `ls -la --time-style=long-iso ${quote(target)} 2>/dev/null || ls -la ${quote(target)} 2>/dev/null`;
      const lsRes = await execCommand(sshConfig, lsCmd);
      if (lsRes.code === 0 && lsRes.stdout.trim()) {
        const lines = lsRes.stdout.split('\n').slice(1);
        const items = lines.map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 8) return null;
          const isDir = parts[0].startsWith('d');
          const name = parts.slice(8).join(' ');
          if (name === '.' || name === '..') return null;
          return {
            Path: name,
            Name: name,
            IsDir: isDir,
            Size: parseInt(parts[4], 10) || 0,
            MimeType: isDir ? 'inode/directory' : 'application/octet-stream',
          };
        }).filter(Boolean);

        return NextResponse.json({
          success: true,
          target,
          isLocal: true,
          items,
        });
      }
    }

    return NextResponse.json({
      success: true,
      target,
      isLocal,
      items: [],
    });

  } catch (error) {
    logger.error('[rclone/browse] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
