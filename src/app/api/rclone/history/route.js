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

    // ── 1. Read all rclone cron log files from /tmp/ with file markers ──
    const logsCmd = `pgrep -f rclone 2>/dev/null || true; echo "=== RCLONE_PROCESSES_END ==="; for f in $(ls -1t /tmp/rclone-cron*.log 2>/dev/null | head -60); do echo "=== RCLONE_FILE: $f ==="; cat "$f"; echo ""; done`;
    const logsRes = await execCommand(sshConfig, logsCmd);
    const rawOutput = logsRes.stdout || '';

    const parts = rawOutput.split('=== RCLONE_PROCESSES_END ===');
    const activePidsText = parts[0] || '';
    const rawLogs = parts.slice(1).join('=== RCLONE_PROCESSES_END ===');

    const activePids = activePidsText.split('\n').map(p => p.trim()).filter(Boolean);
    const isServerRcloneActive = activePids.length > 0;

    // Split log text into individual run blocks per file
    const fileBlocks = rawLogs.split('=== RCLONE_FILE: ').filter(b => b.trim());
    const runs = [];

    for (const rawBlock of fileBlocks) {
      const firstLineEnd = rawBlock.indexOf('\n');
      if (firstLineEnd === -1) continue;

      const filePath = rawBlock.slice(0, firstLineEnd).replace(/===/g, '').trim();
      const fileContent = rawBlock.slice(firstLineEnd + 1).trim();

      if (!fileContent) continue;

      // Split file into individual run sessions if multiple runs exist in the same log file
      const runBlocks = fileContent.split(/(?===\s*Project:)/i).filter(b => b.trim());

      for (const block of runBlocks) {
        let action = 'copy';
        let source = '';
        let targetFolder = '';
        let customProjectName = '';

        // Check header marker: === Project: NAME | Action: sync ===
        const projMatch = block.match(/===\s*Project:\s*(.*?)(?:\s*\|\s*Action:\s*(\w+))?\s*===/i);
        if (projMatch) {
          customProjectName = projMatch[1].trim();
          if (projMatch[2]) {
            action = projMatch[2].toLowerCase();
          }
        }

        // Check parameters or commands
        const paramMatch = block.match(/parameters\s+\[(.*?)\]/s);
        if (paramMatch) {
          const tokens = paramMatch[1].split(/\s+/).map(t => t.replace(/^"/, '').replace(/"$/, ''));
          const rIdx = tokens.indexOf('rclone');
          if (rIdx !== -1 && tokens[rIdx + 1]) {
            if (!projMatch) action = tokens[rIdx + 1].toLowerCase();
            source = tokens[rIdx + 2] || '';
            targetFolder = tokens[rIdx + 3] || '';
          }
        }

        if (!source) {
          const fallbackMatch = block.match(/rclone\s+(copy|sync|move|check|delete|purge)\s+(\S+)(?:\s+(\S+))?/i);
          if (fallbackMatch) {
            if (!projMatch) action = fallbackMatch[1].toLowerCase();
            source = fallbackMatch[2].replace(/"/g, '');
            targetFolder = (fallbackMatch[3] || '').replace(/"/g, '');
          }
        }

        // If source still empty, try to detect from log lines (e.g. buildx/foo or backup.log)
        if (!source) {
          const firstCopyMatch = block.match(/INFO\s*:\s*([^:\s\/]+)(?:\/|\:)/i);
          if (firstCopyMatch) {
            source = firstCopyMatch[1].trim();
          }
        }

        // If customProjectName still empty, derive clean project name from log file path
        if (!customProjectName && filePath.includes('/tmp/rclone-cron-')) {
          const fname = filePath.replace('/tmp/rclone-cron-', '').replace(/\.log$/, '');
          const cleanName = fname.replace(/-\d{8}_\d{6}$/, '').replace(/-\d{10,}$/, '');
          if (cleanName) customProjectName = cleanName;
        }

        if (block.includes('rclone delete') || action === 'delete' || action === 'purge') {
          action = 'cleanup';
        }

        // Format Project / Task Name
        const cleanSource = source ? (source.split('/').filter(Boolean).pop() || source) : '';
        const cleanTarget = targetFolder ? targetFolder.split('/')[0] : '';
        
        let jobName = customProjectName;
        if (!jobName) {
          if (cleanSource && cleanTarget) jobName = `${cleanSource} ➔ ${cleanTarget}`;
          else if (cleanSource) jobName = cleanSource;
          else jobName = 'Scheduled Backup Task';
        }

        // 🎯 Match LAST (LATEST) occurrence of progress metrics in this run block
        const allTransferred = [...block.matchAll(/Transferred:\s+(\d+)\s*\/\s*(\d+)/g)];
        const transferredMatch = allTransferred.length > 0 ? allTransferred[allTransferred.length - 1] : null;

        const allSizes = [...block.matchAll(/Transferred:\s+([\d.]+\s*[kMGTP]?i?B)\s*\//gi)];
        const sizeMatch = allSizes.length > 0 ? allSizes[allSizes.length - 1] : null;

        const allElapsed = [...block.matchAll(/Elapsed time:\s*([\dhmins.]+)/gi)];
        const elapsedMatch = allElapsed.length > 0 ? allElapsed[allElapsed.length - 1] : null;

        const allErrors = [...block.matchAll(/Errors:\s*(\d+)/gi)];
        const errorsMatch = allErrors.length > 0 ? allErrors[allErrors.length - 1] : null;

        const allPercents = [...block.matchAll(/Transferred:.*,\s*(\d+)%/gi)];
        const percentMatch = allPercents.length > 0 ? allPercents[allPercents.length - 1] : null;

        const errorCount = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
        const percent = percentMatch ? parseInt(percentMatch[1], 10) : null;
        const hasActiveTransferring = block.includes('Transferring:') || (block.match(/ETA\s+[1-9]/i) !== null);
        const hasErrors = errorCount > 0;
        const hasFailed = block.includes('Failed to') || block.includes('ERROR');
        
        const filesDone = transferredMatch ? parseInt(transferredMatch[1], 10) : 0;
        const filesTotal = transferredMatch ? parseInt(transferredMatch[2], 10) : 0;
        const is100Percent = (percent === 100) || (filesTotal > 0 && filesDone >= filesTotal);

        const isAborted = block.includes('ABORTED BY USER') || block.includes('aborted by user');

        let status = 'running';
        if (isAborted) {
          status = 'aborted';
        } else if (is100Percent && !hasErrors && !hasFailed && !hasActiveTransferring) {
          status = 'success';
        } else if (hasFailed && !hasActiveTransferring) {
          status = 'failed';
        } else if (hasErrors && !hasActiveTransferring) {
          status = 'warning';
        } else {
          status = 'running';
        }

        const firstTimeMatch = block.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);

        runs.push({
          jobName,
          action,
          source,
          targetFolder,
          startTime: firstTimeMatch ? firstTimeMatch[1] : null,
          status,
          errors: errorCount,
          filesTransferred: transferredMatch ? `${transferredMatch[1]}/${transferredMatch[2]}` : null,
          sizeTransferred: sizeMatch ? sizeMatch[1].trim() : null,
          elapsed: elapsedMatch ? elapsedMatch[1] : null,
          logFile: filePath,
          logPreview: block.trim(),
        });
      }
    }

    // Sort newest runs first
    runs.reverse();

    // 🎯 Post-process runs: Only the single newest run can remain 'running' if server process is active.
    // All older incomplete runs whose processes are dead MUST be marked as 'aborted'!
    let foundActiveRun = false;
    runs.forEach(run => {
      if (run.status === 'running') {
        if (!isServerRcloneActive || foundActiveRun) {
          run.status = 'aborted';
        } else {
          foundActiveRun = true;
        }
      }
    });

    // Group runs by Project / Task
    const projectGroups = {};
    for (const run of runs) {
      const pName = run.jobName;
      if (!projectGroups[pName]) {
        projectGroups[pName] = {
          name: pName,
          source: run.source,
          target: run.targetFolder,
          action: run.action,
          runs: [],
        };
      }
      projectGroups[pName].runs.push(run);
    }

    const projects = Object.values(projectGroups);

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
      projects,
      backupFolders,
    });

  } catch (error) {
    console.error('[rclone/history] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
