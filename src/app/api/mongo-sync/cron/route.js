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
  // Only append authSource if the user explicitly configured it.
  // Forcing admin here breaks users created in the target database.
  if (conn.authSource) uri += `?authSource=${conn.authSource}`;
  return uri;
}

// Rewrite Docker-internal hostnames to 127.0.0.1 + host-mapped port so cron
// scripts running on the host OS can reach MongoDB outside Docker networking.
// Reads DOCKER_MONGO_HOST_PORT env var (default 27021) as the host-side port.
// Only rewrites short single-word Docker service names (no dots, not an IP).
function rewriteDockerUri(uri) {
  if (!uri) return uri;
  try {
    // SRV URIs use DNS-based discovery — never rewrite
    if (uri.startsWith('mongodb+srv://')) return uri;
    // Match hostname:port where hostname is a Docker service name:
    //   - starts with a letter
    //   - contains only letters, digits, hyphens, underscores
    //   - NO dots (dots = real hostname/IP, not a Docker service name)
    //   - not already localhost or 127.0.0.1
    const hostPortRegex = /(@|\/\/)((?!127\.0\.0\.1$|localhost$)[a-zA-Z][a-zA-Z0-9_-]*)(:(\d+))/;
    const match = uri.match(hostPortRegex);
    if (!match) return uri;
    const internalHost = match[2];
    const internalPort = match[4];
    const hostPort = process.env.DOCKER_MONGO_HOST_PORT || '27021';
    const rewritten = uri.replace(`${internalHost}:${internalPort}`, `127.0.0.1:${hostPort}`);
    logger.info(`[mongo-sync/cron] Rewrote Docker URI: ${internalHost}:${internalPort} → 127.0.0.1:${hostPort}`);
    return rewritten;
  } catch {
    return uri;
  }
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
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }

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
    const settingRepo = new SystemSettingRepository(db, userId);
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

    // Rewrite internal Docker hostnames to 127.0.0.1 so the cron script running
    // on the host (ec2-user) can reach MongoDB via the exposed host port.
    // e.g. monitor-mongo:27017 → 127.0.0.1:27021 (as mapped in docker-compose ports)
    mongoUri = rewriteDockerUri(mongoUri);

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

    const effectiveClientId = clientId || process.env.GOOGLE_CLIENT_ID || '';
    const effectiveClientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';

    // Helper: bash variable reference that won't be eaten by JS template literals
    const V = (name) => '$' + name;

    const scriptLines = [
      '#!/bin/bash',
      `# MongoSync Auto-Backup: ${safeName}`,
      `# Job ID: ${jobId}`,
      '',
      '# Use set -u only: -e (exit on error) would kill the script before PYEXIT=$? is captured.',
      '# -u catches unset variable bugs. All critical exit codes are checked explicitly.',
      'set -u',
      '',
      '# ── Embedded config (set at install time) ───',
      `MONGO_URI=${bashSingleQuote(mongoUri)}`,
      `DB_NAME=${bashSingleQuote(database)}`,
      `COLLECTION=${bashSingleQuote(collection)}`,
      `IS_ALL_COLLECTIONS=${isAllColls ? 'true' : 'false'}`,
      `GDRIVE_FOLDER_ID=${bashSingleQuote(driveFolderId)}`,
      `GDRIVE_REFRESH_TOKEN=${bashSingleQuote(refreshToken)}`,
      `GDRIVE_CLIENT_ID=${bashSingleQuote(effectiveClientId)}`,
      `GDRIVE_CLIENT_SECRET=${bashSingleQuote(effectiveClientSecret)}`,
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
      '# ── Redirect ALL stdout+stderr to log from this point on ───',
      '# This ensures any crash or error is always captured in the log file.',
      'exec >> "' + V('LOG') + '" 2>&1',
      '',
      'echo "=== MongoSync Start: ' + safeName + ' | ' + V('TIMESTAMP') + ' ==="',
      '',
      '# Log sanitized connection info for debugging (strip password)',
      '_SANITIZED_URI=$(echo "' + V('MONGO_URI') + '" | sed "s#://[^:]*:[^@]*@#://***:***@#" || echo "(uri parse error)")',
      'echo "$(date): MongoDB URI: ' + V('_SANITIZED_URI') + '"',
      'echo "$(date): Database: ' + V('DB_NAME') + '"',
      '',
      '# ── Lock (per-job) ───',
      'if command -v flock > /dev/null 2>&1; then',
      '  exec 9>"' + V('LOCKFILE') + '"',
      '  flock -n 9 || { echo "$(date): Already running, skipping."; exit 0; }',
      'else',
      '  LOCKDIR="' + V('SCRIPTS_DIR') + '/lock-' + safeId + '.lockdir"',
      '  mkdir "' + V('LOCKDIR') + '" 2>/dev/null || { echo "$(date): Already running."; exit 0; }',
      '  trap \'rm -rf "' + V('LOCKDIR') + '"\' EXIT',
      'fi',
      '',
      '# ── Global lock (prevent parallel jobs from competing for resources) ───',
      'GLOBAL_LOCK="' + V('SCRIPTS_DIR') + '/global.lock"',
      'if command -v flock > /dev/null 2>&1; then',
      '  exec 8>"' + V('GLOBAL_LOCK') + '"',
      '  flock -w 300 8 || { echo "$(date): Another mongosync job is still running after 5 min wait, skipping."; exit 0; }',
      'fi',
      '',
      '# ── Disk space guard (abort if disk >= 85% full) ───',
      'DISK_PCT=$(df "' + V('TMP_DIR') + '" 2>/dev/null | awk \'NR==2 {gsub(/%/,""); print $5}\' || echo "")',
      'if [ -n "' + V('DISK_PCT') + '" ] && [ "' + V('DISK_PCT') + '" -ge 85 ] 2>/dev/null; then',
      '  echo "$(date): ERROR: Disk is ' + V('DISK_PCT') + '% full (threshold 85%). Aborting to protect server."',
      '  exit 1',
      'fi',
      'echo "$(date): Disk usage: ${DISK_PCT:-(unknown)}% — OK"',
      '',
      '# ── Step 1: Refresh OAuth token ───',
      '# Use a temp file to avoid python3 pipeline exit code killing the script',
      '_OAUTH_RESP_FILE="' + V('TMP_DIR') + '/oauth_resp_' + V('TIMESTAMP') + '.json"',
      'curl -s -X POST "https://oauth2.googleapis.com/token" \\',
      '  --data-urlencode "client_id=' + V('GDRIVE_CLIENT_ID') + '" \\',
      '  --data-urlencode "client_secret=' + V('GDRIVE_CLIENT_SECRET') + '" \\',
      '  --data-urlencode "refresh_token=' + V('GDRIVE_REFRESH_TOKEN') + '" \\',
      '  --data-urlencode "grant_type=refresh_token" \\',
      '  > "' + V('_OAUTH_RESP_FILE') + '" 2>/dev/null || true',
      'ACCESS_TOKEN=$(python3 -c "import sys,json; print(json.load(open(sys.argv[1])).get(\'access_token\',\'\'))" "' + V('_OAUTH_RESP_FILE') + '" 2>/dev/null || echo "")',
      'rm -f "' + V('_OAUTH_RESP_FILE') + '"',
      '',
      'if [ -z "' + V('ACCESS_TOKEN') + '" ]; then',
      '  echo "$(date): ERROR: Failed to get OAuth token. Check Google Drive credentials."',
      '  exit 1',
      'fi',
      'echo "$(date): OAuth token obtained."',
      '',
      '# ── Step 2: Ensure python3 + pymongo are available ───',
      'if ! command -v python3 > /dev/null 2>&1; then',
      '  echo "$(date): ERROR: python3 is not installed. Cannot continue."',
      '  exit 1',
      'fi',
      'echo "$(date): python3 found: $(python3 --version 2>&1)"',
      'if ! python3 -c "import pymongo" > /dev/null 2>&1; then',
      '  echo "$(date): pymongo not found — installing..."',
      '  python3 -m pip install --user --quiet pymongo 2>&1 || \\',
      '    pip3 install --user --quiet pymongo 2>&1 || true',
      '  if ! python3 -c "import pymongo" > /dev/null 2>&1; then',
      '    echo "$(date): ERROR: pymongo install failed. Please run: pip3 install pymongo"',
      '    exit 1',
      '  fi',
      'fi',
      'echo "$(date): pymongo ready: $(python3 -c "import pymongo; print(pymongo.version)" 2>/dev/null)"',
      '',
      '# ── Step 3: Create timestamped subfolder in GDrive ───',
      'FOLDER_DATE=$(date +"%Y-%m-%d_%H-%M")',
      '# Write JSON body to a temp file to avoid all shell quoting/expansion issues',
      '_SUBFOLDER_JSON_FILE="' + V('TMP_DIR') + '/subfolder_meta_' + V('TIMESTAMP') + '.json"',
      '_SUBFOLDER_RESP_FILE="' + V('TMP_DIR') + '/subfolder_resp_' + V('TIMESTAMP') + '.json"',
      'python3 -c "import json,sys; open(sys.argv[1],\'w\').write(json.dumps({\'name\':sys.argv[2],\'mimeType\':\'application/vnd.google-apps.folder\',\'parents\':[sys.argv[3]]}))" "' + V('_SUBFOLDER_JSON_FILE') + '" "' + V('FOLDER_DATE') + '" "' + V('GDRIVE_FOLDER_ID') + '" 2>/dev/null || true',
      'curl -s -X POST "https://www.googleapis.com/drive/v3/files" \\',
      '  -H "Authorization: Bearer ' + V('ACCESS_TOKEN') + '" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d @"' + V('_SUBFOLDER_JSON_FILE') + '" \\',
      '  > "' + V('_SUBFOLDER_RESP_FILE') + '" 2>/dev/null || true',
      'rm -f "' + V('_SUBFOLDER_JSON_FILE') + '"',
      'SUBFOLDER_ID=$(python3 -c "import sys,json; print(json.load(open(sys.argv[1])).get(\'id\',\'\'))" "' + V('_SUBFOLDER_RESP_FILE') + '" 2>/dev/null || echo "")',
      'if [ -z "' + V('SUBFOLDER_ID') + '" ]; then',
      '  _SUBFOLDER_ERR=$(python3 -c "import sys,json; d=json.load(open(sys.argv[1])); print(d.get(\'error\',{}).get(\'message\',\'unknown\'))" "' + V('_SUBFOLDER_RESP_FILE') + '" 2>/dev/null || echo "parse error")',
      '  echo "$(date): WARNING: Could not create subfolder (' + V('_SUBFOLDER_ERR') + '), uploading to root folder."',
      '  SUBFOLDER_ID="' + V('GDRIVE_FOLDER_ID') + '"',
      'fi',
      'rm -f "' + V('_SUBFOLDER_RESP_FILE') + '"',
      'echo "$(date): Subfolder ready: ' + V('FOLDER_DATE') + ' (' + V('SUBFOLDER_ID') + ')"',
      '',
      '# ── Step 4: Upload function with retry logic (uploads into the timestamped subfolder) ───',
      'upload_file() {',
      '  local DUMP_FILE="$1"',
      '  local FILENAME="$2"',
      '  local PARENT_ID="$3"',
      '  local MAX_RETRIES=3',
      '  local RETRY_COUNT=0',
      '  ',
      '  echo "$(date): Uploading $FILENAME ($(du -sh "$DUMP_FILE" 2>/dev/null | cut -f1)) ..."',
      '  ',
      '  # Write metadata JSON to temp file to avoid shell quoting issues',
      '  _META_FILE="/tmp/gdrive_meta_$$.json"',
      '  python3 -c "import json,sys; open(sys.argv[1],\'w\').write(json.dumps({\'name\':sys.argv[2],\'parents\':[sys.argv[3]]}))" "$_META_FILE" "$FILENAME" "$PARENT_ID" 2>/dev/null || true',
      '  ',
      '  # Retry loop with exponential backoff',
      '  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do',
      '    HTTP_CODE=$(curl -s -o /tmp/gdrive_up_$$.json -w "%{http_code}" \\',
      '      -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \\',
      '      -H "Authorization: Bearer ' + V('ACCESS_TOKEN') + '" \\',
      '      -F "metadata=@$_META_FILE;type=application/json;charset=UTF-8" \\',
      '      -F "file=@$DUMP_FILE;type=application/json" 2>/dev/null || echo "000")',
      '    ',
      '    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then',
      '      echo "$(date): ✅ Uploaded: $FILENAME"',
      '      rm -f "$_META_FILE" /tmp/gdrive_up_$$.json',
      '      return 0',
      '    fi',
      '    ',
      '    RETRY_COUNT=$((RETRY_COUNT + 1))',
      '    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then',
      '      WAIT_TIME=$((5 * RETRY_COUNT))',
      '      echo "$(date): ⚠️  Upload failed HTTP $HTTP_CODE, retrying in ${WAIT_TIME}s (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."',
      '      sleep $WAIT_TIME',
      '    else',
      '      echo "$(date): ❌ Upload failed after $MAX_RETRIES attempts, HTTP $HTTP_CODE: $(cat /tmp/gdrive_up_$$.json 2>/dev/null)"',
      '    fi',
      '  done',
      '  ',
      '  rm -f "$_META_FILE" /tmp/gdrive_up_$$.json',
      '  return 1',
      '}',
      '',
      '',
      '# ── Step 5: Export all data via pymongo (single connection) ───',
      '# Write the Python export script to a temp file',
      'PYEXPORT_SCRIPT="' + V('TMP_DIR') + '/pyexport_' + V('TIMESTAMP') + '.py"',
      '# Use a job-specific export dir so files from different jobs never mix',
      'EXPORT_DIR="' + V('TMP_DIR') + '/export_' + safeId + '_' + V('TIMESTAMP') + '"',
      'mkdir -p "' + V('EXPORT_DIR') + '"',
      'cat > "' + V('PYEXPORT_SCRIPT') + '" << \'PYEOF\'',
      'import sys, os, json',
      'from datetime import datetime, timezone',
      'from bson import ObjectId, Decimal128',
      'from pymongo import MongoClient',
      '',
      'def default_serializer(o):',
      '    if isinstance(o, ObjectId): return str(o)',
      '    if isinstance(o, datetime): return o.isoformat()',
      '    if isinstance(o, Decimal128): return str(o)',
      '    if isinstance(o, bytes): return o.hex()',
      '    return str(o)',
      '',
      'mongo_uri    = sys.argv[1]',
      'db_name      = sys.argv[2]',
      'collection   = sys.argv[3]   # single collection name, or "__ALL__"',
      'out_dir      = sys.argv[4]',
      '',
      'def log(msg):',
      '    ts = datetime.now().strftime("%a %b %e %H:%M:%S %Z %Y")',
      '    print(f"{ts}: {msg}", flush=True)',
      '',
      'client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000)',
      'db = client[db_name]',
      '',
      'if collection == "__ALL__":',
      '    names = sorted(n for n in db.list_collection_names() if not n.startswith("system."))',
      'else:',
      '    names = [collection]',
      '',
      'total = len(names)',
      'success = 0',
      'failed  = 0',
      '',
      'for name in names:',
      '    out_path = os.path.join(out_dir, name + ".json")',
      '    try:',
      '        docs = list(db[name].find({}))',
      '        with open(out_path, "w") as f:',
      '            json.dump(docs, f, default=default_serializer, ensure_ascii=False)',
      '        log(f"exported {name} ({len(docs)} docs) → {out_path}")',
      '        success += 1',
      '    except Exception as e:',
      '        log(f"ERROR exporting {name}: {e}")',
      '        failed += 1',
      '',
      'client.close()',
      'log(f"PYEXPORT_DONE total={total} success={success} failed={failed}")',
      'sys.exit(0 if failed == 0 else 1)',
      'PYEOF',
      '',
      '# Determine which collection(s) to export',
      'if [ "' + V('IS_ALL_COLLECTIONS') + '" = "true" ]; then',
      '  EXPORT_TARGET="__ALL__"',
      'else',
      '  EXPORT_TARGET="' + V('COLLECTION') + '"',
      'fi',
      '',
      'echo "$(date): Starting pymongo export for: ' + V('EXPORT_TARGET') + '"',
      '# Capture python3 exit code without triggering set -e (use && ... || ... pattern)',
      'python3 "' + V('PYEXPORT_SCRIPT') + '" "' + V('MONGO_URI') + '" "' + V('DB_NAME') + '" "' + V('EXPORT_TARGET') + '" "' + V('EXPORT_DIR') + '" && PYEXIT=0 || PYEXIT=$?',
      'rm -f "' + V('PYEXPORT_SCRIPT') + '"',
      '',
      'if [ "' + V('PYEXIT') + '" -ne 0 ]; then',
      '  echo "$(date): ERROR: pymongo export failed (exit ' + V('PYEXIT') + ')."',
      '  rm -rf "' + V('EXPORT_DIR') + '"',
      '  exit 1',
      'fi',
      '',
      '# Upload each exported JSON file to the Drive subfolder',
      'TOTAL_COUNT=0',
      'SUCCESS_COUNT=0',
      'FAILED_COUNT=0',
      'for DUMP_FILE in "' + V('EXPORT_DIR') + '"/*.json; do',
      '  [ -f "' + V('DUMP_FILE') + '" ] || continue',
      '  FILENAME=$(basename "' + V('DUMP_FILE') + '")',
      '  TOTAL_COUNT=$((TOTAL_COUNT + 1))',
      '  if upload_file "' + V('DUMP_FILE') + '" "' + V('FILENAME') + '" "' + V('SUBFOLDER_ID') + '"; then',
      '    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))',
      '  else',
      '    FAILED_COUNT=$((FAILED_COUNT + 1))',
      '  fi',
      'done',
      'rm -rf "' + V('EXPORT_DIR') + '"',
      '',
      'echo ""',
      'echo "=== Summary | $(date) ==="',
      'if [ $TOTAL_COUNT -gt 0 ]; then',
      '  echo "Total collections: $TOTAL_COUNT"',
      '  echo "✅ Successfully uploaded: $SUCCESS_COUNT"',
      '  echo "❌ Failed: $FAILED_COUNT"',
      '  SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))',
      '  echo "Success rate: ${SUCCESS_RATE}%"',
      'fi',
      'echo "=== Done | $(date) ==="',
      'find "' + V('LOGS_DIR') + '" -name "mongosync-' + safeId + '-*.log" -mtime +14 -delete 2>/dev/null || true',
    ];

    const scriptContent = scriptLines.join('\n');

    // 5. Write script and install crontab on user's SSH server
    const scriptPath = `$HOME/.mongosync-scripts/mongosync-${safeId}.sh`;
    // Run bash directly — cron is already fully detached from SSH so tmux is not needed.
    // Using tmux caused silent failures when tmux was missing from cron's minimal PATH.
    // The script handles its own log redirect with `exec >> "$LOG" 2>&1`.
    const cronLine = `${cronExpr} /bin/bash ${scriptPath}`;

    const installScript = `
mkdir -p "$HOME/.mongosync-scripts/logs" "$HOME/.mongosync-scripts/tmp"
chmod 700 "$HOME/.mongosync-scripts" "$HOME/.mongosync-scripts/logs" "$HOME/.mongosync-scripts/tmp" 2>/dev/null || true
cat <<'SCRIPT_EOF' > "$HOME/.mongosync-scripts/mongosync-${safeId}.sh"
${scriptContent}
SCRIPT_EOF
chmod 700 "$HOME/.mongosync-scripts/mongosync-${safeId}.sh"
# Syntax check before installing crontab
SYNTAX_ERR=$(bash -n "$HOME/.mongosync-scripts/mongosync-${safeId}.sh" 2>&1)
if [ -n "$SYNTAX_ERR" ]; then
  echo "SYNTAX_ERROR: $SYNTAX_ERR"
  exit 1
fi
# ── Preflight probe: run environment checks now so errors appear in log immediately ──
# This writes a log entry right at install time — if anything is missing, the log shows why.
PROBE_LOG="$HOME/.mongosync-scripts/logs/mongosync-${safeId}-$(date +%Y%m%d_%H%M%S).log"
{
  echo "=== MongoSync Preflight Probe: ${safeId} | $(date) ==="
  echo "$(date): Checking environment..."
  # Check python3
  if command -v python3 > /dev/null 2>&1; then
    echo "$(date): ✅ python3: $(python3 --version 2>&1)"
  else
    echo "$(date): ❌ ERROR: python3 not found — cron job will fail. Install python3 first."
  fi
  # Check pymongo
  if python3 -c "import pymongo" > /dev/null 2>&1; then
    echo "$(date): ✅ pymongo: $(python3 -c 'import pymongo; print(pymongo.version)' 2>/dev/null)"
  else
    echo "$(date): ❌ ERROR: pymongo not installed — run: pip3 install pymongo"
  fi
  # Check curl
  if command -v curl > /dev/null 2>&1; then
    echo "$(date): ✅ curl: $(curl --version 2>&1 | head -1)"
  else
    echo "$(date): ❌ ERROR: curl not found — cron job will fail. Install curl first."
  fi
  # Check MongoDB reachability (quick 3s timeout)
  MONGO_REACHABLE=$(python3 -c "
from pymongo import MongoClient
import sys
import { logger } from '@/lib/logger';
try:
    c = MongoClient('${mongoUri.replace(/'/g, "'\\''")}', serverSelectionTimeoutMS=3000)
    c.admin.command('ping')
    print('ok')
    c.close()
except Exception as e:
    print('fail: ' + str(e))
" 2>/dev/null || echo "fail: python3 error")
  if [ "\$MONGO_REACHABLE" = "ok" ]; then
    echo "$(date): ✅ MongoDB reachable"
  else
    echo "$(date): ❌ ERROR: MongoDB not reachable — \$MONGO_REACHABLE"
  fi
  echo "$(date): Preflight probe complete."
  echo "=== Cron schedule: ${cronLine} ==="
} >> "\$PROBE_LOG" 2>&1
echo "PROBE_LOG:\$PROBE_LOG"
TMP_CRON=$(mktemp 2>/dev/null || echo "/tmp/mongosync_cron_tmp_$$")
crontab -l 2>/dev/null | grep -F -v "mongosync-${safeId}" > "$TMP_CRON" || true
echo ${bashSingleQuote(cronLine)} >> "$TMP_CRON"
crontab "$TMP_CRON" 2>&1 || true
rm -f "$TMP_CRON"
echo "INSTALLED_SUCCESS"
`;

    const result = await execCommand(sshConfig, installScript);

    if (result.code !== 0 || !result.stdout.includes('INSTALLED_SUCCESS')) {
      const syntaxErr = result.stdout.match(/SYNTAX_ERROR: (.+)/)?.[1];
      const errMsg = syntaxErr
        ? `Script syntax error: ${syntaxErr}`
        : result.stderr.trim() || result.stdout.trim() || 'Failed to install script on target SSH server';
      logger.error('[mongo-sync/cron POST] SSH exec failure:', errMsg);
      return NextResponse.json({
        success: false,
        error: errMsg,
        stdout: result.stdout,
        stderr: result.stderr
      }, { status: 500 });
    }

    // Extract probe log path and read its content to surface any preflight warnings
    const probeLogMatch = result.stdout.match(/^PROBE_LOG:(.+)$/m);
    const probeLogPath = probeLogMatch ? probeLogMatch[1].trim() : null;
    let probeLogContent = null;
    let probeWarnings = [];
    if (probeLogPath) {
      try {
        const probeResult = await execCommand(sshConfig, `cat "${probeLogPath}" 2>/dev/null || echo "(probe log not found)"`);
        probeLogContent = probeResult.stdout.trim();
        // Extract any ❌ ERROR lines as warnings to surface in the UI
        probeWarnings = (probeLogContent || '').split('\n')
          .filter(l => l.includes('❌ ERROR:'))
          .map(l => l.replace(/^[^❌]*❌ ERROR:\s*/, '').trim());
      } catch (_) {}
    }

    return NextResponse.json({
      success: true,
      message: `Schedule installed on SSH server (${parseCronHuman(schedule)})`,
      cronLine,
      humanSchedule: parseCronHuman(schedule),
      scriptPath: `~/.mongosync-scripts/mongosync-${safeId}.sh`,
      scriptInstalled: true,
      probeLog: probeLogContent,
      probeWarnings: probeWarnings.length > 0 ? probeWarnings : undefined,
    });

  } catch (error) {
    logger.error('[mongo-sync/cron POST] error:', error);
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
    logger.error('[mongo-sync/cron DELETE] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
