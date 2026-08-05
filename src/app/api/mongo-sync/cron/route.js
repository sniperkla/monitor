import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { SystemSettingRepository } from '@/lib/repositories/SystemSettingRepository';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { decrypt } from '@/utils/encryption';

function parseCronExpr(schedule) {
  if (!schedule) return '0 2 * * *';
  if (schedule.trim().split(/\s+/).length === 5) return schedule.trim();
  switch (schedule) {
    case 'hourly':  return '0 * * * *';
    case 'daily':   return '0 2 * * *';
    case 'weekly':  return '0 2 * * 0';
    default:        return '0 2 * * *';
  }
}

function parseCronHuman(schedule) {
  if (!schedule) return 'Daily';
  const expr = parseCronExpr(schedule);
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (min === '*/5' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 5 Minutes';
    if (min === '*/15' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 15 Minutes';
    if (min === '*/30' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 30 Minutes';
    if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every Hour at :00';
    if (dom === '*' && mon === '*' && dow === '*' && !min.includes('/') && !hour.includes('/')) {
      const hr = parseInt(hour, 10);
      const m = parseInt(min, 10);
      const ampm = hr >= 12 ? 'PM' : 'AM';
      const hr12 = hr % 12 === 0 ? 12 : hr % 12;
      return `Every Day at ${String(hr12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }
  }
  switch (schedule) {
    case 'hourly':  return 'Every Hour at :00';
    case 'daily':   return 'Every Day at 02:00 AM';
    case 'weekly':  return 'Every Sunday at 02:00 AM';
    default:        return `Cron (${expr})`;
  }
}

function buildMongoUri(conn) {
  const password = conn.password ? decrypt(conn.password) : '';
  const isSrv = conn.isSrv || (conn.host && conn.host.includes('.mongodb.net'));
  const protocol = isSrv ? 'mongodb+srv' : 'mongodb';
  const portPart = (isSrv || !conn.port) ? '' : `:${conn.port}`;
  let uri;
  if (conn.username && password) {
    uri = `${protocol}://${conn.username}:${encodeURIComponent(password)}@${conn.host}${portPart}/${conn.database || ''}`;
  } else {
    uri = `${protocol}://${conn.host}${portPart}/${conn.database || ''}`;
  }
  if (conn.authSource) uri += `?authSource=${conn.authSource}`;
  return uri;
}

function bashSingleQuote(str) {
  return `'${String(str || '').replace(/'/g, `'\\''`)}'`;
}

// GET — check cron status and read last run time from SSH log files
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const targetSshConnId = searchParams.get('targetSshConnId');
    const fetchLogs = searchParams.get('fetchLogs') === '1';

    if (!jobId || !targetSshConnId) {
      return NextResponse.json({ success: false, error: 'jobId and targetSshConnId are required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(targetSshConnId);
    const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Check crontab and optionally read last log
    const checkScript = `
CRON_LINE=$(crontab -l 2>/dev/null | grep -F "mongosync-${safeId}" || true)
echo "CRON_LINE:$CRON_LINE"
LOG_DIR="$HOME/.mongosync-scripts/logs"
if [ -d "$LOG_DIR" ]; then
  LATEST=$(ls -t "$LOG_DIR"/mongosync-${safeId}-*.log 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "LATEST_LOG:$LATEST"
    echo "LOG_TAIL_START"
    tail -20 "$LATEST" 2>/dev/null
    echo "LOG_TAIL_END"
  fi
fi
`;
    const res = await execCommand(sshConfig, checkScript);
    const output = res.stdout || '';

    const cronLineMatch = output.match(/^CRON_LINE:(.*)/m);
    const cronLine = cronLineMatch ? cronLineMatch[1].trim() : null;

    const latestLogMatch = output.match(/^LATEST_LOG:(.*)/m);
    const latestLog = latestLogMatch ? latestLogMatch[1].trim() : null;

    // Extract last run timestamp from log filename: mongosync-<safeId>-YYYYMMDD_HHmmss.log
    let lastRunFromLog = null;
    if (latestLog) {
      const m = latestLog.match(/(\d{8}_\d{6})\.log$/);
      if (m) {
        const ts = m[1]; // YYYYMMDD_HHmmss
        const y = ts.slice(0,4), mo = ts.slice(4,6), d = ts.slice(6,8);
        const h = ts.slice(9,11), mi = ts.slice(11,13), s = ts.slice(13,15);
        lastRunFromLog = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).toISOString();
      }
    }

    // Extract log tail
    let logTail = null;
    const tailMatch = output.match(/LOG_TAIL_START\n([\s\S]*?)LOG_TAIL_END/);
    if (tailMatch) logTail = tailMatch[1].trim();

    return NextResponse.json({
      success: true,
      cronLine: cronLine || null,
      installed: !!cronLine,
      lastRunFromLog,
      latestLogFile: latestLog,
      logTail: fetchLogs ? logTail : undefined,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — install self-contained mongosync bash script + crontab on user's SSH server
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const {
      jobId, jobName, schedule, targetSshConnId,
      connectionId, database, collection, driveFolderId
    } = await req.json();

    if (!jobId || !targetSshConnId || !connectionId || !database || !driveFolderId || !schedule || schedule === 'manual') {
      return NextResponse.json({ success: false, error: 'jobId, targetSshConnId, connectionId, database, driveFolderId and a non-manual schedule are required' }, { status: 400 });
    }

    const db = await connectDB();
    const connRepo = new ConnectionRepository(db);
    await connRepo.init();
    const settingRepo = new SystemSettingRepository(db);
    await settingRepo.init();

    // 1. Resolve MongoDB connection URI
    let mongoUri;
    if (connectionId === 'default') {
      mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor';
    } else {
      const conn = await connRepo.findById(connectionId);
      if (!conn) return NextResponse.json({ success: false, error: 'MongoDB connection not found' }, { status: 404 });
      mongoUri = buildMongoUri(conn.toObject ? conn.toObject() : conn);
    }

    // 2. Get Google Drive credentials
    const driveConfigSetting = await settingRepo.findOne({ key: 'google_drive_config' });
    const driveConfig = driveConfigSetting?.value;
    if (!driveConfig?.refreshToken) {
      return NextResponse.json({ success: false, error: 'Google Drive not connected. Please connect Google Drive first.' }, { status: 400 });
    }
    const { refreshToken, clientId, clientSecret } = driveConfig;

    // 3. Get SSH config for target server
    const sshConfig = await getSshConfig(targetSshConnId);

    // 4. Build the self-contained bash script
    // IMPORTANT: All bash ${VAR} references must use string concatenation to avoid
    // JavaScript template literal interpolation eating them at build time.
    const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = (jobName || jobId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cronExpr = parseCronExpr(schedule);
    const isAllColls = ['*', 'ALL_COLLECTIONS', 'All Collections', 'All Collections (*)'].includes(collection);

    // Helper: bash variable reference that won't be eaten by JS template literals
    const V = (name) => '$' + name;
    const VB = (name) => '${' + name + '}';

    const scriptLines = [
      '#!/bin/bash',
      `# MongoSync Auto-Backup: ${safeName}`,
      `# Job ID: ${jobId}`,
      '',
      'set -euo pipefail',
      '',
      '# ── Embedded config (set at install time) ───',
      `MONGO_URI=${bashSingleQuote(mongoUri)}`,
      `DB_NAME=${bashSingleQuote(database)}`,
      `COLLECTION=${bashSingleQuote(collection)}`,
      `IS_ALL_COLLECTIONS=${isAllColls ? 'true' : 'false'}`,
      `GDRIVE_FOLDER_ID=${bashSingleQuote(driveFolderId)}`,
      `GDRIVE_REFRESH_TOKEN=${bashSingleQuote(refreshToken)}`,
      `GDRIVE_CLIENT_ID=${bashSingleQuote(clientId || '')}`,
      `GDRIVE_CLIENT_SECRET=${bashSingleQuote(clientSecret || '')}`,
      '',
      '# ── Paths ───',
      'SCRIPTS_DIR="' + V('HOME') + '/.mongosync-scripts"',
      'LOGS_DIR="' + V('SCRIPTS_DIR') + '/logs"',
      'TMP_DIR="' + V('SCRIPTS_DIR') + '/tmp"',
      'mkdir -p "' + V('LOGS_DIR') + '" "' + V('TMP_DIR') + '"',
      '',
      'TIMESTAMP=$(date +%Y%m%d_%H%M%S)',
      'LOG="' + V('LOGS_DIR') + '/mongosync-' + safeId + '-' + V('TIMESTAMP') + '.log"',
      'LOCKFILE="' + V('SCRIPTS_DIR') + '/lock-' + safeId + '.lock"',
      '',
      '# ── Lock ───',
      'if command -v flock > /dev/null 2>&1; then',
      '  exec 9>"' + V('LOCKFILE') + '"',
      '  flock -n 9 || { echo "$(date): Already running, skipping." >> "' + V('LOG') + '"; exit 0; }',
      'else',
      '  LOCKDIR="' + V('SCRIPTS_DIR') + '/lock-' + safeId + '.lockdir"',
      '  mkdir "' + V('LOCKDIR') + '" 2>/dev/null || { echo "$(date): Already running." >> "' + V('LOG') + '"; exit 0; }',
      '  trap \'rm -rf "' + V('LOCKDIR') + '"\' EXIT',
      'fi',
      '',
      'echo "=== MongoSync: ' + safeName + ' | ' + V('TIMESTAMP') + ' ===" >> "' + V('LOG') + '"',
      '',
      '# ── Step 1: Refresh OAuth token ───',
      'ACCESS_TOKEN=$(curl -s -X POST "https://oauth2.googleapis.com/token" \\',
      '  --data-urlencode "client_id=' + V('GDRIVE_CLIENT_ID') + '" \\',
      '  --data-urlencode "client_secret=' + V('GDRIVE_CLIENT_SECRET') + '" \\',
      '  --data-urlencode "refresh_token=' + V('GDRIVE_REFRESH_TOKEN') + '" \\',
      '  --data-urlencode "grant_type=refresh_token" \\',
      '  | python3 -c "import sys,json; print(json.load(sys.stdin).get(\'access_token\',\'\'))" 2>/dev/null)',
      '',
      'if [ -z "' + V('ACCESS_TOKEN') + '" ]; then',
      '  echo "$(date): ERROR: Failed to get OAuth token." >> "' + V('LOG') + '"',
      '  exit 1',
      'fi',
      'echo "$(date): OAuth token obtained." >> "' + V('LOG') + '"',
      '',
      '# ── Step 2: Find mongoexport ───',
      'EXPORT_BIN=""',
      'for _b in mongoexport "' + V('HOME') + '/.local/bin/mongoexport" /usr/local/bin/mongoexport /usr/bin/mongoexport; do',
      '  if command -v "' + V('_b') + '" > /dev/null 2>&1 || [ -x "' + V('_b') + '" ]; then',
      '    EXPORT_BIN="' + V('_b') + '"; break',
      '  fi',
      'done',
      'if [ -z "' + V('EXPORT_BIN') + '" ]; then',
      '  echo "$(date): ERROR: mongoexport not found. Install mongodb-tools." >> "' + V('LOG') + '"',
      '  exit 1',
      'fi',
      '',
      '# ── Step 3: Create timestamped subfolder in GDrive ───',
      'FOLDER_DATE=$(date +"%Y-%m-%d_%H-%M")',
      'SUBFOLDER_JSON=$(curl -s -X POST "https://www.googleapis.com/drive/v3/files" \\',
      '  -H "Authorization: Bearer ' + V('ACCESS_TOKEN') + '" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d "{\"name\":\"' + V('FOLDER_DATE') + '\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"' + V('GDRIVE_FOLDER_ID') + '\"]}" 2>/dev/null)',
      'SUBFOLDER_ID=$(echo "' + V('SUBFOLDER_JSON') + '" | python3 -c "import sys,json; print(json.load(sys.stdin).get(\'id\',\'\'))" 2>/dev/null)',
      'if [ -z "' + V('SUBFOLDER_ID') + '" ]; then',
      '  echo "$(date): WARNING: Could not create subfolder, uploading to root folder." >> "' + V('LOG') + '"',
      '  SUBFOLDER_ID="' + V('GDRIVE_FOLDER_ID') + '"',
      'fi',
      'echo "$(date): Subfolder ready: ' + V('FOLDER_DATE') + ' (' + V('SUBFOLDER_ID') + ')" >> "' + V('LOG') + '"',
      '',
      '# ── Step 4: Upload function (uploads into the timestamped subfolder) ───',
      'upload_file() {',
      '  local DUMP_FILE="' + V('1') + '"',
      '  local FILENAME="' + V('2') + '"',
      '  local PARENT_ID="' + V('3') + '"',
      '  echo "$(date): Uploading ' + V('FILENAME') + ' ..." >> "' + V('LOG') + '"',
      '  HTTP_CODE=$(curl -s -o /tmp/gdrive_up_$$.json -w "%{http_code}" \\',
      '    -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \\',
      '    -H "Authorization: Bearer ' + V('ACCESS_TOKEN') + '" \\',
      "    -F 'metadata={\"name\":\"' + V('FILENAME') + '\",\"parents\":[\"' + V('PARENT_ID') + '\"]};type=application/json;charset=UTF-8' \\",
      '    -F "file=@' + V('DUMP_FILE') + ';type=application/json" 2>/dev/null)',
      '  if [ "' + V('HTTP_CODE') + '" = "200" ] || [ "' + V('HTTP_CODE') + '" = "201" ]; then',
      '    echo "$(date): Uploaded: ' + V('FILENAME') + '" >> "' + V('LOG') + '"',
      '  else',
      '    echo "$(date): Upload failed HTTP ' + V('HTTP_CODE') + ': $(cat /tmp/gdrive_up_$$.json 2>/dev/null)" >> "' + V('LOG') + '"',
      '  fi',
      '  rm -f /tmp/gdrive_up_$$.json',
      '}',
      '',
      '# ── Step 5: Export & upload into subfolder ───',
      'if [ "' + V('IS_ALL_COLLECTIONS') + '" = "true" ]; then',
      '  COLLS=$(mongosh "' + V('MONGO_URI') + '" --eval "db.getSiblingDB(\'' + V('DB_NAME') + '\').getCollectionNames().join(\'\\n\')" --quiet 2>/dev/null \\',
      '    || mongo "' + V('MONGO_URI') + '" --eval "db.getSiblingDB(\'' + V('DB_NAME') + '\').getCollectionNames().join(\'\\n\')" --quiet 2>/dev/null \\',
      '    || echo "")',
      '  for COLL in ' + V('COLLS') + '; do',
      '    DUMP_FILE="' + V('TMP_DIR') + '/' + V('COLL') + '_' + V('TIMESTAMP') + '.json"',
      '    "' + V('EXPORT_BIN') + '" --uri="' + V('MONGO_URI') + '" --db="' + V('DB_NAME') + '" --collection="' + V('COLL') + '" --out="' + V('DUMP_FILE') + '" >> "' + V('LOG') + '" 2>&1 || true',
      '    if [ -f "' + V('DUMP_FILE') + '" ]; then',
      '      upload_file "' + V('DUMP_FILE') + '" "' + V('COLL') + '.json" "' + V('SUBFOLDER_ID') + '"',
      '      rm -f "' + V('DUMP_FILE') + '"',
      '    fi',
      '  done',
      'else',
      '  DUMP_FILE="' + V('TMP_DIR') + '/' + V('COLLECTION') + '_' + V('TIMESTAMP') + '.json"',
      '  "' + V('EXPORT_BIN') + '" --uri="' + V('MONGO_URI') + '" --db="' + V('DB_NAME') + '" --collection="' + V('COLLECTION') + '" --out="' + V('DUMP_FILE') + '" >> "' + V('LOG') + '" 2>&1',
      '  if [ $? -ne 0 ] || [ ! -f "' + V('DUMP_FILE') + '" ]; then',
      '    echo "$(date): ERROR: mongoexport failed." >> "' + V('LOG') + '"',
      '    exit 1',
      '  fi',
      '  upload_file "' + V('DUMP_FILE') + '" "' + V('COLLECTION') + '.json" "' + V('SUBFOLDER_ID') + '"',
      '  rm -f "' + V('DUMP_FILE') + '"',
      'fi',
      '',
      'echo "=== Done | $(date) ===" >> "' + V('LOG') + '"',
      'find "' + V('LOGS_DIR') + '" -name "mongosync-' + safeId + '-*.log" -mtime +14 -delete 2>/dev/null || true',
    ];

    const scriptContent = scriptLines.join('\n');

    // 5. Write script and install crontab on user's SSH server
    const scriptPath = `$HOME/.mongosync-scripts/mongosync-${safeId}.sh`;
    const cronLine = `${cronExpr} /bin/bash ${scriptPath}`;

    const installScript = `
mkdir -p "$HOME/.mongosync-scripts/logs" "$HOME/.mongosync-scripts/tmp"
cat <<'SCRIPT_EOF' > "$HOME/.mongosync-scripts/mongosync-${safeId}.sh"
${scriptContent}
SCRIPT_EOF
chmod +x "$HOME/.mongosync-scripts/mongosync-${safeId}.sh"
TMP_CRON=$(mktemp 2>/dev/null || echo "/tmp/mongosync_cron_tmp_$$")
crontab -l 2>/dev/null | grep -F -v "mongosync-${safeId}" > "$TMP_CRON" || true
echo ${bashSingleQuote(cronLine)} >> "$TMP_CRON"
crontab "$TMP_CRON" 2>&1 || true
rm -f "$TMP_CRON"
echo "INSTALLED_SUCCESS"
`;

    const result = await execCommand(sshConfig, installScript);

    if (result.code !== 0 || !result.stdout.includes('INSTALLED_SUCCESS')) {
      const errMsg = result.stderr.trim() || result.stdout.trim() || 'Failed to install script on target SSH server';
      console.error('[mongo-sync/cron POST] SSH exec failure:', errMsg);
      return NextResponse.json({
        success: false,
        error: errMsg,
        stdout: result.stdout,
        stderr: result.stderr
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Schedule installed on SSH server (${parseCronHuman(schedule)})`,
      cronLine,
      humanSchedule: parseCronHuman(schedule),
      scriptPath: `~/.mongosync-scripts/mongosync-${safeId}.sh`,
      scriptInstalled: true
    });

  } catch (error) {
    console.error('[mongo-sync/cron POST] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — remove crontab entry and script from user's SSH server
export async function DELETE(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { jobId, targetSshConnId } = await req.json();

    if (!jobId || !targetSshConnId) {
      return NextResponse.json({ success: false, error: 'jobId and targetSshConnId are required' }, { status: 400 });
    }

    const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sshConfig = await getSshConfig(targetSshConnId);

    const removeScript = `
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -F -v "mongosync-${safeId}" > "$TMP_CRON" || true
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
rm -f "$HOME/.mongosync-scripts/mongosync-${safeId}.sh"
echo "REMOVED"
`;

    const result = await execCommand(sshConfig, removeScript);

    return NextResponse.json({
      success: result.stdout.includes('REMOVED'),
      message: result.stdout.includes('REMOVED')
        ? 'Crontab entry and script removed from SSH server.'
        : 'Remove may have partially failed.',
      output: result.stdout
    });

  } catch (error) {
    console.error('[mongo-sync/cron DELETE] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
