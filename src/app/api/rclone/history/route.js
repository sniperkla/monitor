import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const target = searchParams.get('target') || '';

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

    // ── 1. Read all rclone cron log files from /tmp/ ──
    const logsCmd = `cat /tmp/rclone-cron*.log 2>/dev/null | tail -1500`;
    const logsRes = await execCommand(sshConfig, logsCmd);
    const rawLogs = logsRes.stdout || '';

    // Split log text into individual run blocks
    const lines = rawLogs.split('\n');
    const blocks = [];
    let currentBlock = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isNewRunStart = line.includes('starting with parameters') || line.includes('rclone: Version');
      
      if (isNewRunStart && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      
      currentBlock.push(line);

      if (line.includes('Elapsed time:')) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    }

    if (currentBlock.length > 0 && currentBlock.some(l => l.trim())) {
      blocks.push(currentBlock.join('\n'));
    }

    const runs = [];
    for (const block of blocks) {
      if (!block.trim()) continue;

      let action = 'copy';
      let source = '';
      let targetFolder = '';

      const paramMatch = block.match(/parameters\s+\[(.*?)\]/s);
      if (paramMatch) {
        const tokens = paramMatch[1].split(/\s+/).map(t => t.replace(/^"/, '').replace(/"$/, ''));
        const rIdx = tokens.indexOf('rclone');
        if (rIdx !== -1 && tokens[rIdx + 1]) {
          action = tokens[rIdx + 1];
          source = tokens[rIdx + 2] || '';
          targetFolder = tokens[rIdx + 3] || '';
        }
      }

      if (!source) {
        const fallbackMatch = block.match(/rclone\s+(copy|sync|move|check)\s+(\S+)\s+(\S+)/i);
        if (fallbackMatch) {
          action = fallbackMatch[1];
          source = fallbackMatch[2].replace(/"/g, '');
          targetFolder = fallbackMatch[3].replace(/"/g, '');
        }
      }

      const transferredMatch = block.match(/Transferred:\s+(\d+)\s*\/\s*(\d+)/);
      const sizeMatch = block.match(/Transferred:\s+([\d.]+\s*\w+)\s*\//);
      const elapsedMatch = block.match(/Elapsed time:\s*([\dhmins.]+)/);
      const errorsMatch = block.match(/Errors:\s*(\d+)/);

      const errorCount = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
      const hasErrors = errorCount > 0;
      const hasFailed = block.includes('Failed to') || block.includes('ERROR');
      const hasCompleted = block.includes('Transferred:') || block.includes('Elapsed time:');

      let status = 'unknown';
      if (hasCompleted && !hasErrors && !hasFailed) status = 'success';
      else if (hasCompleted && (hasErrors || hasFailed)) status = 'warning';
      else if (hasFailed && !hasCompleted) status = 'failed';
      else if (block.trim().length > 0) status = 'running';

      const firstTimeMatch = block.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);

      runs.push({
        action,
        source,
        targetFolder,
        startTime: firstTimeMatch ? firstTimeMatch[1] : null,
        status,
        errors: errorCount,
        filesTransferred: transferredMatch ? `${transferredMatch[1]}/${transferredMatch[2]}` : null,
        sizeTransferred: sizeMatch ? sizeMatch[1].trim() : null,
        elapsed: elapsedMatch ? elapsedMatch[1] : null,
        logPreview: block.trim(),
      });
    }

    // Sort newest runs first
    runs.reverse();

    // ── 2. List timestamped backup folders on the remote target ──
    let backupFolders = [];
    if (target && target.includes(':')) {
      const listCmd = `${pathPrefix}rclone lsjson "${target}" --dirs-only 2>/dev/null | head -50`;
      const listRes = await execCommand(sshConfig, listCmd);
      if (listRes.code === 0 && listRes.stdout?.trim()) {
        try {
          const items = JSON.parse(listRes.stdout.trim());
          backupFolders = (Array.isArray(items) ? items : [items])
            .filter(i => i.IsDir)
            .map(i => ({
              name: i.Name || i.Path,
              path: i.Path,
              modTime: i.ModTime || null,
            }))
            .sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        } catch (_) {}
      }
    }

    return NextResponse.json({
      success: true,
      runs,
      backupFolders,
    });

  } catch (error) {
    console.error('[rclone/history] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
