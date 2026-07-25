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

    // ── 1. Parse rclone cron log files from /tmp/ ──
    const logsCmd = `ls -t /tmp/rclone-cron-*.log 2>/dev/null | head -20`;
    const logsRes = await execCommand(sshConfig, logsCmd);
    const logFiles = (logsRes.stdout || '').split('\n').map(f => f.trim()).filter(Boolean);

    const runs = [];
    for (const logFile of logFiles.slice(0, 10)) {
      // Extract timestamp from filename: rclone-cron-1785016342579.log
      const tsMatch = logFile.match(/rclone-cron-(\d+)\.log/);
      const createdTs = tsMatch ? parseInt(tsMatch[1], 10) : 0;

      // Read last 30 lines of each log for summary
      const readCmd = `wc -l < "${logFile}" 2>/dev/null; tail -30 "${logFile}" 2>/dev/null; stat -c '%Y' "${logFile}" 2>/dev/null || stat -f '%m' "${logFile}" 2>/dev/null`;
      const readRes = await execCommand(sshConfig, readCmd);
      const output = readRes.stdout || '';
      const lines = output.split('\n');

      // Parse log content
      const totalLines = parseInt(lines[0], 10) || 0;
      const logContent = lines.slice(1).join('\n');

      // Extract stats from rclone log
      const transferredMatch = logContent.match(/Transferred:\s+(\d+)\s*\/\s*(\d+)/);
      const sizeMatch = logContent.match(/Transferred:\s+([\d.]+\s*\w+)\s*\//);
      const elapsedMatch = logContent.match(/Elapsed time:\s*([\dhmins.]+)/);
      const errorsMatch = logContent.match(/Errors:\s*(\d+)/);
      const checksMatch = logContent.match(/Checks:\s*(\d+)/);

      // Determine status
      const errorCount = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
      const hasErrors = errorCount > 0;
      const hasFailed = logContent.includes('Failed to') || logContent.includes('ERROR');
      const hasCompleted = logContent.includes('Transferred:') || logContent.includes('Elapsed time:');

      let status = 'unknown';
      if (hasCompleted && !hasErrors && !hasFailed) status = 'success';
      else if (hasCompleted && (hasErrors || hasFailed)) status = 'warning';
      else if (hasFailed && !hasCompleted) status = 'failed';
      else if (totalLines > 0) status = 'running';

      // Get last modified time of log file (actual run time)
      const lastLine = lines[lines.length - 1]?.trim();
      const modifiedTs = lastLine && /^\d+$/.test(lastLine) ? parseInt(lastLine, 10) * 1000 : createdTs;

      // Extract the first timestamp from log lines (actual start time)
      const firstTimeMatch = logContent.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);
      const lastTimeMatch = logContent.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})(?!.*\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/s);

      runs.push({
        logFile,
        createdAt: createdTs ? new Date(createdTs).toISOString() : null,
        startTime: firstTimeMatch ? firstTimeMatch[1] : null,
        endTime: lastTimeMatch ? lastTimeMatch[1] : null,
        modifiedAt: modifiedTs ? new Date(modifiedTs).toISOString() : null,
        status,
        errors: errorCount,
        filesTransferred: transferredMatch ? `${transferredMatch[1]}/${transferredMatch[2]}` : null,
        sizeTransferred: sizeMatch ? sizeMatch[1].trim() : null,
        elapsed: elapsedMatch ? elapsedMatch[1] : null,
        checks: checksMatch ? parseInt(checksMatch[1], 10) : null,
        totalLogLines: totalLines,
        logPreview: logContent.slice(-500),
      });
    }

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
