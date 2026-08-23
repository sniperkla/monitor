import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const target = searchParams.get('target') || '';
    const latestLogOnly = searchParams.get('latestLog') === '1';

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });
    const pathPrefix = 'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"; ';

    // ── Fast path: return only the most recently modified log + running status ──
    if (latestLogOnly) {
      const fastCmd = [
        // Get the most recently touched rclone cron log
        `LATEST=$(ls -1t $HOME/.rclone-scripts/logs/rclone-cron*.log 2>/dev/null | head -1)`,
        `if [ -z "$LATEST" ]; then LATEST=$(ls -1t /tmp/rclone-cron*.log 2>/dev/null | head -1); fi`,
        `if [ -n "$LATEST" ]; then`,
        `  echo "=== LOG_FILE: $LATEST ==="`,
        `  tail -c 32768 "$LATEST" 2>/dev/null`,
        `  echo ""`,
        `  echo "=== PIDS ==="`,
        `  ps aux | grep '[r]clone ' | grep -v grep | awk '{print $2}' 2>/dev/null || true`,
        `fi`,
      ].join('\n');
      const fastRes = await execCommand(sshConfig, fastCmd);
      const fastOut = fastRes.stdout || '';

      const fileMatch = fastOut.match(/=== LOG_FILE: (.+?) ===/);
      const logFile = fileMatch ? fileMatch[1].trim() : '';
      const afterHeader = fileMatch
        ? fastOut.slice(fastOut.indexOf(fileMatch[0]) + fileMatch[0].length)
        : '';
      const pidsIdx = afterHeader.indexOf('=== PIDS ===');
      const content = pidsIdx >= 0 ? afterHeader.slice(0, pidsIdx).trim() : afterHeader.trim();
      const pidsText = pidsIdx >= 0 ? afterHeader.slice(pidsIdx + '=== PIDS ==='.length) : '';
      const running = pidsText.split('\n').map(p => p.trim()).filter(Boolean).length > 0;

      return NextResponse.json({ success: true, latestLog: logFile ? { logFile, content, running } : null });
    }

    // ── 1. Read all rclone cron log files from persistent storage (fallback to /tmp if persistent is empty) ──
    const logsCmd = `ps aux | grep '[r]clone ' | grep -v 'grep' | awk '{print $2}' 2>/dev/null || true; echo "=== RCLONE_PROCESSES_END ==="; FILES=$(ls -1t $HOME/.rclone-scripts/logs/rclone-cron*.log 2>/dev/null | head -60); if [ -z "$FILES" ]; then FILES=$(ls -1t /tmp/rclone-cron*.log 2>/dev/null | head -60); fi; for f in $FILES; do echo "=== RCLONE_FILE: $f ==="; cat "$f"; echo ""; done`;
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
    const seenBaseNames = new Set();

    for (const rawBlock of fileBlocks) {
      const firstLineEnd = rawBlock.indexOf('\n');
      if (firstLineEnd === -1) continue;

      const filePath = rawBlock.slice(0, firstLineEnd).replace(/===/g, '').trim();
      const baseName = filePath.split('/').pop();
      if (seenBaseNames.has(baseName)) continue;
      seenBaseNames.add(baseName);

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
        const projMatch = block.match(/===\s*Project:\s*([^|\n]+)(?:\s*\|\s*Action:\s*(\w+))?\s*===/i);
        if (projMatch) {
          // Sanitize: strip .sh / _sh / dashes-underscores, title-case
          let rawName = projMatch[1].trim();
          rawName = rawName
            .replace(/\.sh$/i, '')      // strip .sh extension
            .replace(/_sh$/i, '')       // strip _sh suffix
            .replace(/_+/g, ' ')        // underscores → spaces
            .replace(/-+/g, ' ')        // dashes → spaces
            .trim();
          customProjectName = rawName
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
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
            if (!projMatch || !projMatch[2]) action = tokens[rIdx + 1].toLowerCase();
            source = tokens[rIdx + 2] || '';
            targetFolder = tokens[rIdx + 3] || '';
          }
        }

        if (!source) {
          const fallbackMatch = block.match(/rclone\s+(copy|sync|move|check|delete|purge)\s+(\S+)(?:\s+(\S+))?/i);
          if (fallbackMatch) {
            if (!projMatch || !projMatch[2]) action = fallbackMatch[1].toLowerCase();
            source = fallbackMatch[2].replace(/"/g, '');
            targetFolder = (fallbackMatch[3] || '').replace(/"/g, '');
          }
        }

        // If source still empty, try to detect from log lines — skip macOS/system hidden files
        if (!source) {
          // Scan all INFO lines and pick the first that isn't a dotfile (.DS_Store, .git, etc.)
          const infoMatches = [...block.matchAll(/INFO\s*:\s*([^:\s\/]+)(?:\/|:)/gi)];
          for (const m of infoMatches) {
            const candidate = m[1].trim();
            if (candidate && !candidate.startsWith('.')) {
              source = candidate;
              break;
            }
          }
        }


        // If customProjectName still empty, derive clean project name from log file path
        if (!customProjectName) {
          let fname = '';
          if (filePath.includes('/tmp/rclone-cron-')) {
            fname = filePath.replace('/tmp/rclone-cron-', '').replace(/\.log$/, '');
          } else if (filePath.includes('/rclone-scripts/logs/rclone-cron-')) {
            fname = filePath.replace(/.*\/rclone-cron-/, '').replace(/\.log$/, '');
          }
          if (fname) {
            // Strip trailing unix timestamp or date suffix, then clean up script name artifacts
            let cleanName = fname
              .replace(/-\d{10,}$/, '')    // unix timestamp suffix like -1721234567
              .replace(/-\d{8}_\d{6}$/, '') // date suffix like -20240726_103000
              .replace(/_sh$/, '')           // leftover _sh from .sh filename
              .replace(/\.sh$/, '')          // .sh extension
              .replace(/_+/g, ' ')           // underscores → spaces
              .replace(/-+/g, ' ')           // dashes → spaces
              .trim();
            // Title-case each word
            if (cleanName) {
              customProjectName = cleanName
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            }
          }
        }


        if (block.includes('rclone delete') || action === 'delete' || action === 'purge') {
          action = 'cleanup';
        }

        // Format Project / Task Name — skip dotfiles/system files as source name
        const rawSourcePart = source ? (source.split('/').filter(Boolean).pop() || source) : '';
        const cleanSource = rawSourcePart.startsWith('.') ? '' : rawSourcePart;
        const cleanTarget = targetFolder ? targetFolder.split('/')[0] : '';

        
        let jobName = customProjectName;
        if (!jobName) {
          if (cleanSource && cleanTarget) jobName = `${cleanSource} ➔ ${cleanTarget}`;
          else if (cleanSource) jobName = cleanSource;
          else continue; // Skip: no project name, no source — nothing useful to show
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
        const hasFailed = block.includes('Fatal error:') || block.includes('ERROR :') || block.includes('Failed to ');
        
        const filesDone = transferredMatch ? parseInt(transferredMatch[1], 10) : 0;
        const filesTotal = transferredMatch ? parseInt(transferredMatch[2], 10) : 0;
        
        const isNothingToTransfer = block.includes('nothing to transfer') || block.includes('0 / 0') || (transferredMatch && transferredMatch[1] === '0' && transferredMatch[2] === '0');
        const is100Percent = (percent === 100) || (filesTotal > 0 && filesDone >= filesTotal) || isNothingToTransfer;

        const isAborted = block.includes('ABORTED BY USER') || block.includes('aborted by user');

        let status = 'running';
        if (isAborted) {
          status = 'aborted';
        } else if (is100Percent && !hasFailed) {
          status = 'success';
        } else if (hasFailed && !hasActiveTransferring) {
          status = 'failed';
        } else if (hasErrors && !hasActiveTransferring) {
          status = 'warning';
        } else if (!hasActiveTransferring && (filesDone > 0 || is100Percent)) {
          status = 'success';
        } else {
          status = 'running';
        }

        const firstTimeMatch = block.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);
        let startTime = firstTimeMatch ? firstTimeMatch[1] : null;
        if (!startTime) {
          const timeMatch = filePath.match(/-(\d{10})\.log$/);
          if (timeMatch) {
            const d = new Date(parseInt(timeMatch[1], 10) * 1000);
            const pad = (n) => String(n).padStart(2, '0');
            startTime = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
        }

        // Extract a stable log-file key (filename without timestamp) to group runs from the same cron job
        const logBaseName = filePath.split('/').pop() || '';
        // e.g. rclone-cron-myproject-1753619744.log → rclone-cron-myproject
        const logFileKey = logBaseName
          .replace(/\.log$/, '')
          .replace(/-\d{10,}$/, '')    // strip unix timestamp
          .replace(/-\d{8}_\d{6}$/, ''); // strip date suffix

        runs.push({
          jobName,
          logFileKey,
          action,
          source,
          targetFolder,
          startTime,
          status,
          errors: errorCount,
          filesTransferred: transferredMatch ? `${transferredMatch[1]}/${transferredMatch[2]}` : (isNothingToTransfer ? '0/0' : null),
          sizeTransferred: sizeMatch ? sizeMatch[1].trim() : (isNothingToTransfer ? '0 B' : null),
          elapsed: elapsedMatch ? elapsedMatch[1] : null,
          logFile: filePath,
          logPreview: block.trim() || `Log file: ${filePath}\n\nNo log content available. The backup task may still be starting or the log file is empty.`,
        });
      }
    }

    // Sort newest runs first (by startTime if available)
    runs.sort((a, b) => {
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      return b.startTime.localeCompare(a.startTime);
    });

    // 🎯 Post-process runs: Only the single newest run across all projects can be 'running' if server process is active.
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

    // Group runs by stable log-file key (filename prefix without timestamp)
    // This ensures all runs from the same cron job land in one project card,
    // regardless of which file the INFO-line fallback happened to detect as "source".
    const projectGroups = {};
    for (const run of runs) {
      // Primary key: log file prefix (most reliable — same for all runs of a cron job)
      // Secondary key: target path (groups manual runs with same destination)
      // Tertiary key: job name
      const groupKey = run.logFileKey || run.targetFolder || run.jobName;

      if (!projectGroups[groupKey]) {
        projectGroups[groupKey] = {
          name: run.jobName,
          source: run.source,
          target: run.targetFolder,
          action: run.action,
          runs: [],
        };
      }

      // Prefer the most descriptive project name within the group:
      // A longer name is usually better (more specific than a single filename)
      const existing = projectGroups[groupKey].name;
      const candidate = run.jobName;
      if (
        candidate &&
        !candidate.endsWith('.sh') &&
        !candidate.endsWith('.log') &&
        candidate.length > existing.length
      ) {
        projectGroups[groupKey].name = candidate;
      }

      projectGroups[groupKey].runs.push(run);
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
    logger.error('[rclone/history] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');
    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const clearCmd = `rm -f $HOME/.rclone-scripts/logs/rclone-cron*.log $HOME/.rclone-scripts/rclone-lock-*.lock /tmp/rclone-cron*.log /tmp/rclone-lock-*.lock`;
    await execCommand(sshConfig, clearCmd);

    return NextResponse.json({
      success: true,
      message: 'Successfully cleared all rclone history log files.',
    });
  } catch (error) {
    logger.error('[rclone/history/DELETE] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
