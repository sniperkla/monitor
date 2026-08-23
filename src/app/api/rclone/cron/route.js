import { NextResponse } from 'next/server';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

function parseCronHuman(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return cronExpr;
  const [min, hour, dom, mon, dow] = parts;

  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every Hour';
  if (min === '*/15' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 15 Minutes';
  if (min === '*/30' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 30 Minutes';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Every Day at Midnight (00:00)';
  if (min === '0' && hour === '2' && dom === '*' && mon === '*' && dow === '*') return 'Every Day at 02:00 AM';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '0') return 'Every Sunday at Midnight';
  if (min === '0' && hour === '0' && dom === '1' && mon === '*' && dow === '*') return '1st Day of Every Month';
  
  return `Schedule: ${cronExpr}`;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const fetchScript = `
(crontab -l 2>/dev/null || true)
echo "=== CRON_SCRIPTS_START ==="
for s in $HOME/.rclone-scripts/rclone-cron-*.sh /tmp/rclone-cron-*.sh; do
  if [ -f "$s" ]; then
    echo "=== SCRIPT_FILE: $s ==="
    cat "$s"
    echo ""
  fi
done
`;
    const res = await execCommand(sshConfig, fetchScript);
    const rawOutput = res.stdout || '';

    const parts = rawOutput.split('=== CRON_SCRIPTS_START ===');
    const cronOutput = parts[0] || '';
    const scriptsOutput = parts.slice(1).join('=== CRON_SCRIPTS_START ===');

    // Parse scripts metadata map: filename -> { source, target, action, projectName, options }
    const scriptMap = {};
    if (scriptsOutput) {
      const blocks = scriptsOutput.split('=== SCRIPT_FILE: ').filter(Boolean);
      for (const block of blocks) {
        const firstLineEnd = block.indexOf('\n');
        if (firstLineEnd === -1) continue;
        const filePath = block.slice(0, firstLineEnd).replace(/\s*===\s*$/, '').trim();
        const content = block.slice(firstLineEnd + 1);

        const metaSource = content.match(/# RCLONE_META_SOURCE:\s*(.*)/)?.[1]?.trim();
        const metaTarget = content.match(/# RCLONE_META_TARGET:\s*(.*)/)?.[1]?.trim();
        const metaAction = content.match(/# RCLONE_META_ACTION:\s*(.*)/)?.[1]?.trim();
        const metaProject = content.match(/# RCLONE_META_PROJECT:\s*(.*)/)?.[1]?.trim();
        const metaOptionsRaw = content.match(/# RCLONE_META_OPTIONS:\s*(.*)/)?.[1]?.trim();

        let options = {};
        if (metaOptionsRaw) {
          try { options = JSON.parse(metaOptionsRaw); } catch (_) {}
        }

        let source = metaSource || '';
        let target = metaTarget || '';
        let action = metaAction || 'copy';

        if (!source || !target) {
          const cmdMatch = content.match(/(?:nice\s+-n\s+\d+\s+)?"?\$?RCLONE_BIN"?\s+(copy|sync|move|check)\s+"([^"]+)"\s+"([^"]+)"/i)
            || content.match(/(?:nice\s+-n\s+\d+\s+)?rclone\s+(copy|sync|move|check)\s+"([^"]+)"\s+"([^"]+)"/i);
          if (cmdMatch) {
            if (!action) action = cmdMatch[1].toLowerCase();
            if (!source) source = cmdMatch[2];
            if (!target) target = cmdMatch[3].replace(/\/+\$\(date[^)]+\)/g, '').replace(/\/+$/, '');
          }
        }

        const baseName = filePath.split('/').pop();
        scriptMap[filePath] = { source, target, action, projectName: metaProject || '', options, baseName };
        if (baseName) scriptMap[baseName] = scriptMap[filePath];
      }
    }

    const lines = (cronOutput || '').split('\n').map(l => l.trim()).filter(Boolean);

    const jobs = [];
    lines.forEach((line, idx) => {
      if (line.startsWith('#')) return;
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        const isRclone = command.toLowerCase().includes('rclone');

        let source = '';
        let target = '';
        let action = 'copy';
        let projectName = '';
        let options = {};

        // 1. Try script map lookup
        const scriptMatch = command.match(/(\S+\.sh)/);
        if (scriptMatch) {
          const sPath = scriptMatch[1];
          const sBase = sPath.split('/').pop();
          const meta = scriptMap[sPath] || scriptMap[sBase];
          if (meta) {
            source = meta.source || '';
            target = meta.target || '';
            action = meta.action || 'copy';
            projectName = meta.projectName || '';
            options = meta.options || {};
          }
        }

        // 2. Inline crontab fallback regex if not found via script map
        if (!source || !target) {
          const inlineMatch = command.match(/rclone\s+(copy|sync|move|check)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
          if (inlineMatch) {
            action = inlineMatch[1] ? inlineMatch[1].toLowerCase() : 'copy';
            source = inlineMatch[2] || inlineMatch[3] || inlineMatch[4] || '';
            target = inlineMatch[5] || inlineMatch[6] || inlineMatch[7] || '';
            target = target.replace(/\/+\$\(date[^)]+\)/g, '').replace(/\/+$/, '');
          }
        }

        // 3. Fallback options parsing
        if (Object.keys(options).length === 0) {
          const retMatch = line.match(/--min-age\s+(\d+)d/);
          options = {
            useTimestampFolder: line.includes('$(date') || command.includes('$(date'),
            timestampFormat: (line.includes('%b') || command.includes('%b')) ? 'YMD_MMM_HM' : (line.includes('%d-%m-%Y') || command.includes('%d-%m-%Y')) ? 'DMY_HM' : 'YMD_HMS',
            enableRetention: !!retMatch,
            retentionDays: retMatch ? retMatch[1] : '7',
          };
        }

        jobs.push({
          id: idx,
          schedule,
          humanSchedule: parseCronHuman(schedule),
          command,
          isRclone,
          raw: line,
          source,
          target,
          action,
          projectName,
          options,
        });
      }
    });

    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    logger.error('[rclone/cron GET] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function bashSingleQuote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export async function POST(req) {
  try {
    const { connectionId, schedule, action, source, target, projectName, options = {} } = await req.json();
    const reqProjectName = projectName || '';

    if (!connectionId || !schedule || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, schedule, source, and target are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    // Normalize source path — three cases to handle:
    // 1. Already absolute (/var/www) → keep as-is
    // 2. Already has $HOME or ~ prefix → keep as-is, but first collapse any accidental doubles
    // 3. Relative (expense-bot-backend/uploads) → prepend $HOME/
    // Also handles the edit-save loop bug where $HOME/$HOME/... accumulates each save.
    let normSource = source.trim();
    // Collapse repeated $HOME/ prefixes (e.g. $HOME/$HOME/foo → $HOME/foo)
    while (normSource.includes('$HOME/$HOME/') || normSource.includes('$HOME/$HOME')) {
      normSource = normSource.replace(/\$HOME\/\$HOME/g, '$HOME');
    }
    if (!normSource.includes(':') && !normSource.startsWith('/') && !normSource.startsWith('$HOME') && !normSource.startsWith('~')) {
      normSource = normSource.startsWith('./') ? `$HOME/${normSource.slice(2)}` : `$HOME/${normSource}`;
    }

    // 🛡️ Auto-Detect RAM and apply smart crash protection flags
    let memMb = 2048;
    try {
      const memRes = await execCommand(sshConfig, `free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048'`);
      memMb = parseInt((memRes.stdout || '').trim(), 10) || 2048;
    } catch (_) {}

    // Build rclone command flags
    const flags = ['--progress', '--stats=1s'];
    if (options.dryRun) flags.push('--dry-run');
    if (options.bwlimit) flags.push(`--bwlimit "${options.bwlimit}"`);
    if (options.transfers) flags.push(`--transfers ${options.transfers}`);
    if (options.driveFolderId && options.driveFolderId.trim()) {
      flags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }

    if (!options.transfers) {
      if (memMb <= 2048) flags.push('--transfers 1 --checkers 2');
      else if (memMb <= 8192) flags.push('--transfers 2 --checkers 4');
      else flags.push('--transfers 4 --checkers 8');
    }

    flags.push(memMb <= 2048 ? '--buffer-size 16M' : '--buffer-size 32M');

    if (target.includes(':')) {
      const targetLower = target.toLowerCase();
      if (targetLower.startsWith('gdrive') || targetLower.includes('drive')) {
        flags.push('--drive-chunk-size 32M');
      }
    }

    const cleanSourceLabel = normSource ? (normSource.split('/').filter(Boolean).pop() || normSource) : 'Source';
    const cleanTargetLabel = target ? target.split('/')[0] : 'Destination';
    const finalProjectName = reqProjectName.trim() ? reqProjectName.trim().replace(/"/g, '') : `${cleanSourceLabel} ➔ ${cleanTargetLabel}`;
    const safeLockName = finalProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');

    flags.push(`--log-file="$LOG"`);
    flags.push(`--log-level INFO`);

    const nicePrefix = memMb <= 2048 ? 'nice -n 19 ' : '';
    let finalTarget = target;
    if (options.useTimestampFolder) {
      let format = '%Y-%m-%d_%H-%M-%S';
      if (options.timestampFormat === 'YMD_MMM_HM') {
        format = '%Y_%b_%d_%H_%M';
      } else if (options.timestampFormat === 'DMY_HM') {
        format = '%d-%m-%Y_%H-%M';
      }
      const cleanTarget = target.replace(/\/$/, '');
      finalTarget = `${cleanTarget}/$(date +${format})/`;
    }

    const scriptPath = `$HOME/.rclone-scripts/rclone-cron-${safeLockName}.sh`;

    let retentionCmd = '';
    if (options.enableRetention && options.retentionDays) {
      const days = parseInt(options.retentionDays, 10) || 7;
      const driveFlag = (options.driveFolderId && options.driveFolderId.trim()) ? `--drive-root-folder-id "${options.driveFolderId.trim()}" ` : '';
      retentionCmd = `"$RCLONE_BIN" delete --min-age ${days}d "${target}" ${driveFlag}--rmdirs 2>/dev/null || true`;
    }

    const scriptContent = `#!/bin/bash
# RCLONE_META_PROJECT: ${finalProjectName}
# RCLONE_META_ACTION: ${action || 'copy'}
# RCLONE_META_SOURCE: ${normSource}
# RCLONE_META_TARGET: ${target}
# RCLONE_META_OPTIONS: ${JSON.stringify(options)}
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"

# Auto-detect rclone binary
RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "$HOME/.local/bin/rclone")"
if [ ! -x "$RCLONE_BIN" ] && ! command -v rclone >/dev/null 2>&1; then
  RCLONE_BIN="rclone"
fi

# Auto-detect rclone config file
if [ -z "$RCLONE_CONFIG" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/etc/rclone/rclone.conf"
  fi
fi

SCRIPTS_DIR="$HOME/.rclone-scripts"
LOGS_DIR="$SCRIPTS_DIR/logs"
mkdir -p "$LOGS_DIR" 2>/dev/null || mkdir -p /tmp/rclone-logs 2>/dev/null

LOG="$LOGS_DIR/rclone-cron-${safeLockName}-$(date +%s).log"
LOCKFILE="$SCRIPTS_DIR/rclone-lock-${safeLockName}.lock"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKFILE"
  flock -n 9 || { exit 0; }
else
  LOCKDIR="$SCRIPTS_DIR/rclone-lock-${safeLockName}.lockdir"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then exit 0; fi
  trap 'rm -rf "$LOCKDIR"' EXIT
fi

echo "=== Project: ${finalProjectName} | Action: ${action || 'copy'} ===" >> "$LOG"

${nicePrefix}"$RCLONE_BIN" ${action || 'copy'} "${normSource}" "${finalTarget}" ${flags.join(' ')} >> "$LOG" 2>&1

${retentionCmd ? `${retentionCmd}\n` : ''}
find "$LOGS_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null || true
`;

    // Crontab line just calls the script
    const cronLine = `${schedule} /bin/bash ${scriptPath}`;

    // Perform a quick 1-off Dry-Run test to verify source and destination connectivity before saving
    const testFlags = [];
    if (options.driveFolderId && options.driveFolderId.trim()) {
      testFlags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }
    const testCmd = `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"; RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "rclone")"; "$RCLONE_BIN" ${action || 'copy'} "${normSource}" "${target}" --dry-run ${testFlags.join(' ')} 2>&1 | head -15`;
    const testRes = await execCommand(sshConfig, testCmd);

    const addCronScript = `
mkdir -p "$HOME/.rclone-scripts/logs"
cat <<'SCRIPTEOF' > ${scriptPath}
${scriptContent}
SCRIPTEOF
chmod +x ${scriptPath}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${bashSingleQuote(scriptPath)} | grep -F -v ${bashSingleQuote(safeLockName)} > "$TMP_CRON" || true
cat <<'CRONEOF' >> "$TMP_CRON"
${cronLine}
CRONEOF
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`;
    const addRes = await execCommand(sshConfig, addCronScript);

    if (addRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: 'Crontab job added successfully!',
        schedule,
        humanSchedule: parseCronHuman(schedule),
        cronLine,
        testPassed: testRes.code === 0,
        testOutput: testRes.stdout || 'Test dry-run completed cleanly.',
      });
    }

    return NextResponse.json({ success: false, error: addRes.stderr || 'Failed to add crontab job' }, { status: 500 });

  } catch (error) {
    logger.error('[rclone/cron POST] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const { connectionId, oldRawLine, schedule, action, source, target, options = {} } = await req.json();

    if (!connectionId || !oldRawLine || !schedule || !source || !target) {
      return NextResponse.json({ success: false, error: 'connectionId, oldRawLine, schedule, source, and target are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    let normSource = source.trim();
    // Collapse repeated $HOME/ prefixes (e.g. $HOME/$HOME/foo → $HOME/foo)
    while (normSource.includes('$HOME/$HOME/') || normSource.includes('$HOME/$HOME')) {
      normSource = normSource.replace(/\$HOME\/\$HOME/g, '$HOME');
    }
    if (!normSource.includes(':') && !normSource.startsWith('/') && !normSource.startsWith('$HOME') && !normSource.startsWith('~')) {
      normSource = normSource.startsWith('./') ? `$HOME/${normSource.slice(2)}` : `$HOME/${normSource}`;
    }

    const cleanSourceLabel = normSource ? (normSource.split('/').filter(Boolean).pop() || normSource) : 'Source';
    const cleanTargetLabel = target ? target.split('/')[0] : 'Destination';
    const putProjectName = options.projectName || `${cleanSourceLabel} ➔ ${cleanTargetLabel}`;
    const putSafeName = putProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const flags = ['--progress', '--stats=1s'];
    if (options.dryRun) flags.push('--dry-run');
    if (options.bwlimit) flags.push(`--bwlimit "${options.bwlimit}"`);
    if (options.transfers) flags.push(`--transfers ${options.transfers}`);
    if (options.driveFolderId && options.driveFolderId.trim()) {
      flags.push(`--drive-root-folder-id "${options.driveFolderId.trim()}"`);
    }

    // 🛡️ Auto-Detect RAM for smart crash protection flags (same as POST)
    let memMb = 2048;
    try {
      const memRes = await execCommand(sshConfig, `free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo '2048'`);
      memMb = parseInt((memRes.stdout || '').trim(), 10) || 2048;
    } catch (_) {}

    if (!options.transfers) {
      if (memMb <= 2048) flags.push('--transfers 1 --checkers 2');
      else if (memMb <= 8192) flags.push('--transfers 2 --checkers 4');
      else flags.push('--transfers 4 --checkers 8');
    }

    flags.push(memMb <= 2048 ? '--buffer-size 16M' : '--buffer-size 32M');

    if (target.includes(':')) {
      const targetLower = target.toLowerCase();
      if (targetLower.startsWith('gdrive') || targetLower.includes('drive')) {
        flags.push('--drive-chunk-size 32M');
      }
    }

    const nicePrefix = memMb <= 2048 ? 'nice -n 19 ' : '';

    flags.push(`--log-file="$LOG"`);
    flags.push(`--log-level INFO`);

    let retentionCmd = '';
    if (options.enableRetention && options.retentionDays) {
      const days = parseInt(options.retentionDays, 10) || 7;
      const driveFlag = (options.driveFolderId && options.driveFolderId.trim()) ? `--drive-root-folder-id "${options.driveFolderId.trim()}" ` : '';
      retentionCmd = `"$RCLONE_BIN" delete --min-age ${days}d "${target}" ${driveFlag}--rmdirs 2>/dev/null || true`;
    }

    let finalTarget = target;
    if (options.useTimestampFolder) {
      let format = '%Y-%m-%d_%H-%M-%S';
      if (options.timestampFormat === 'YMD_MMM_HM') {
        format = '%Y_%b_%d_%H_%M';
      } else if (options.timestampFormat === 'DMY_HM') {
        format = '%d-%m-%Y_%H-%M';
      }
      const cleanTarget = target.replace(/\/$/, '');
      finalTarget = `${cleanTarget}/$(date +${format})/`;
    }

    const putScriptPath = `$HOME/.rclone-scripts/rclone-cron-${putSafeName}.sh`;

    const putScriptContent = `#!/bin/bash
# RCLONE_META_PROJECT: ${putProjectName}
# RCLONE_META_ACTION: ${action || 'copy'}
# RCLONE_META_SOURCE: ${normSource}
# RCLONE_META_TARGET: ${target}
# RCLONE_META_OPTIONS: ${JSON.stringify(options)}
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/snap/bin:$PATH"

RCLONE_BIN="$(command -v rclone 2>/dev/null || which rclone 2>/dev/null || echo "$HOME/.local/bin/rclone")"
if [ ! -x "$RCLONE_BIN" ] && ! command -v rclone >/dev/null 2>&1; then
  RCLONE_BIN="rclone"
fi

if [ -z "$RCLONE_CONFIG" ]; then
  if [ -f "$HOME/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
  elif [ -f "/root/.config/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/root/.config/rclone/rclone.conf"
  elif [ -f "/etc/rclone/rclone.conf" ]; then export RCLONE_CONFIG="/etc/rclone/rclone.conf"
  fi
fi

SCRIPTS_DIR="$HOME/.rclone-scripts"
LOGS_DIR="$SCRIPTS_DIR/logs"
mkdir -p "$LOGS_DIR" 2>/dev/null || mkdir -p /tmp/rclone-logs 2>/dev/null

LOG="$LOGS_DIR/rclone-cron-${putSafeName}-$(date +%s).log"
LOCKFILE="$SCRIPTS_DIR/rclone-lock-${putSafeName}.lock"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKFILE"
  flock -n 9 || { exit 0; }
else
  LOCKDIR="$SCRIPTS_DIR/rclone-lock-${putSafeName}.lockdir"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then exit 0; fi
  trap 'rm -rf "$LOCKDIR"' EXIT
fi

echo "=== Project: ${putProjectName} | Action: ${action || 'copy'} ===" >> "$LOG"

${nicePrefix}"$RCLONE_BIN" ${action || 'copy'} "${normSource}" "${finalTarget}" ${flags.join(' ')} >> "$LOG" 2>&1

${retentionCmd ? `${retentionCmd}\n` : ''}
find "$LOGS_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null || true
`;

    const cronLine = `${schedule} /bin/bash ${putScriptPath}`;

    const updateCronScript = `
mkdir -p "$HOME/.rclone-scripts/logs"
rm -f ${putScriptPath} /tmp/rclone-cron-${putSafeName}.sh
cat <<'SCRIPTEOF' > ${putScriptPath}
${putScriptContent}
SCRIPTEOF
chmod +x ${putScriptPath}
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v ${bashSingleQuote(putScriptPath)} | grep -F -v ${bashSingleQuote(oldRawLine)} | grep -F -v ${bashSingleQuote(putSafeName)} > "$TMP_CRON" || true
cat <<'CRONEOF' >> "$TMP_CRON"
${cronLine}
CRONEOF
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`;
    const updateRes = await execCommand(sshConfig, updateCronScript);

    if (updateRes.code === 0) {
      return NextResponse.json({
        success: true,
        message: 'Crontab job updated successfully!',
        schedule,
        humanSchedule: parseCronHuman(schedule),
        cronLine,
      });
    }

    return NextResponse.json({ success: false, error: updateRes.stderr || 'Failed to update crontab job' }, { status: 500 });

  } catch (error) {
    logger.error('[rclone/cron PUT] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId');
    const rawLine = searchParams.get('rawLine');
    const removeScript = searchParams.get('removeScript') === 'true';

    if (!connectionId || !rawLine) {
      return NextResponse.json({ success: false, error: 'connectionId and rawLine are required' }, { status: 400 });
    }

    const sshMode = req.headers.get('x-ssh-mode');
    const preferredRelay = req.headers.get('x-preferred-relay');

    const sshConfig = await getSshConfig(connectionId, { sshMode, preferredRelay });

    const escapedRaw = bashSingleQuote(rawLine);

    const removeCronScript = `
RAW_LINE=${escapedRaw}

# Extract script path ending with rclone-cron-*.sh
SCRIPT_PATH=$(echo "$RAW_LINE" | awk '{for(i=1;i<=NF;i++) if($i ~ /rclone-cron-.*\\.sh$/) print $i}')

TMP_CRON=$(mktemp)
if [ -n "$SCRIPT_PATH" ]; then
  crontab -l 2>/dev/null | grep -F -v "$RAW_LINE" | grep -F -v "$SCRIPT_PATH" > "$TMP_CRON" || true
  ${removeScript ? `rm -f "$SCRIPT_PATH"
  BASE_NAME=$(basename "$SCRIPT_PATH" .sh)
  rm -rf "$HOME/.rclone-scripts/$BASE_NAME"* "$HOME/.rclone-scripts/logs/$BASE_NAME"* "/tmp/$BASE_NAME"* "/tmp/rclone-logs/$BASE_NAME"* 2>/dev/null || true` : '# Keep script & log files as requested'}
else
  crontab -l 2>/dev/null | grep -F -v "$RAW_LINE" > "$TMP_CRON" || true
fi

crontab "$TMP_CRON"
rm -f "$TMP_CRON"
`;
    const delRes = await execCommand(sshConfig, removeCronScript);

    return NextResponse.json({ success: delRes.code === 0, error: delRes.code !== 0 ? delRes.stderr : null });

  } catch (error) {
    logger.error('[rclone/cron DELETE] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
