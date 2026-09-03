import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/serverGuard';
import connectDB from '@/lib/mongodb';
import AuditLog, { getAuditLogModel } from '@/models/AuditLog';
import { getActivityLogModel } from '@/models/ActivityLog';
import { auditLog } from '@/lib/auditLog';
import { getClientIp } from '@/lib/clientIp';

// Fire-and-forget audit trail — never blocks or fails the request itself.
//
// Three destinations, and the split is deliberate:
//
//   audit_logs    (src/lib/auditLog.js)  the security trail. One place a
//                 reviewer looks during an incident. Privileged actions must
//                 land here or they are invisible to that review.
//   auditlogs     (@/models/AuditLog)    per-server operational history, with
//                 indexed connectionId/appName/version for "what changed on
//                 this host" queries.
//   activitylogs  (@/models/ActivityLog) the user-facing timeline in the UI.
//
// Note the collection names: mongoose pluralizes without snake-casing, so the
// AuditLog model lands in `auditlogs` while the security trail lives in
// `audit_logs`. They are NOT the same collection, and the near-identical names
// are a standing trap for anyone grepping the database.
const ACTION_VERBS = {
  start: 'Started', stop: 'Stopped', restart: 'Restarted',
  enable: 'Enabled', disable: 'Disabled', update: 'Updated',
  uninstall: 'Uninstalled', 'install-version': 'Installed',
};

async function writeAudit(entry, { appName, action, version, host, success, error, userEmail }, req) {
  try {
    // Security trail first. Starting/stopping/uninstalling services on a user's
    // server is the highest-severity thing this product does, so it belongs in
    // audit_logs alongside the other privileged actions — otherwise an
    // investigator reading the documented trail sees nothing.
    await auditLog({
      req,
      action: `server.service.${action}`,
      userId: entry.userId,
      userEmail: userEmail || null,
      detail: {
        connectionId: entry.connectionId,
        host,
        appName,
        version: version || null,
        exitCode: entry.exitCode,
        error: error ? String(error).slice(0, 200) : null,
      },
      target: entry.connectionId,
      status: success ? 'success' : 'failure',
    });

    const db = await connectDB();
    await getAuditLogModel(db).create(entry);
    const verb = ACTION_VERBS[action] || action;
    const msg = success
      ? `${verb} ${appName}${version ? ` ${version}` : ''} on ${host}`
      : `Failed to ${action} ${appName} on ${host}`;
    await getActivityLogModel(db).create({
      userId: entry.userId,
      username: entry.username,
      category: 'server',
      action: `service.${action}`,
      message: msg,
      target: host,
      status: success ? 'success' : 'error',
      meta: { exitCode: entry.exitCode },
      ip: entry.ip,
    });
  } catch (err) {
    logger.warn('[server-monitor/app-action] audit log failed:', err.message);
  }
}

// Cap command output returned to the client so a runaway command can't
// balloon the HTTP response or the browser's memory.
const MAX_OUTPUT_CHARS = 64 * 1024;

// Actions that change server state get stricter rate limits than read-only ones.
const MUTATING_ACTIONS = new Set(['start', 'stop', 'restart', 'enable', 'disable', 'update', 'uninstall', 'install-version']);

/**
 * Map app names to their service names
 */
const SERVICE_MAP = {
  'docker': 'docker',
  'nginx': 'nginx',
  'mongodb': 'mongod',
  'mysql / mariadb': 'mysql',
  'mysql': 'mysql',
  'mariadb': 'mariadb',
  'postgresql': 'postgresql',
  'redis': 'redis-server',
};

/**
 * Generate command based on action
 */
// Only safe package/service name characters are allowed. This is the last line of
// defense against shell injection: appName comes from the request body and would
// otherwise be interpolated directly into `sudo systemctl ...` / `apt-get install ...`.
function sanitizeServiceName(appName) {
  const raw = SERVICE_MAP[String(appName || '').toLowerCase()] || String(appName || '').toLowerCase();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(raw)) {
    return null;
  }
  return raw;
}

function getActionCommand(appName, action, version) {
  const serviceName = sanitizeServiceName(appName);
  if (!serviceName) {
    throw new Error(`Invalid app name: ${appName}`);
  }
  
  // Try systemctl first, then fall back to service command
  const systemctlCmd = `sudo systemctl ${action} ${serviceName} 2>&1 || systemctl ${action} ${serviceName} 2>&1`;
  const serviceCmd = `sudo service ${serviceName} ${action} 2>&1 || service ${serviceName} ${action} 2>&1`;
  
  switch (action) {
    case 'start':
    case 'stop':
    case 'restart':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          ${systemctlCmd}
        else
          ${serviceCmd}
        fi
      `;
      
    case 'status':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl status ${serviceName} 2>&1 || systemctl status ${serviceName} 2>&1
        else
          sudo service ${serviceName} status 2>&1 || service ${serviceName} status 2>&1
        fi
      `;
      
    case 'enable':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl enable ${serviceName} 2>&1 || systemctl enable ${serviceName} 2>&1
        else
          echo "Enable action not supported without systemd"
          exit 1
        fi
      `;
      
    case 'disable':
      return `
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl disable ${serviceName} 2>&1 || systemctl disable ${serviceName} 2>&1
        else
          echo "Disable action not supported without systemd"
          exit 1
        fi
      `;
      
    case 'check-update':
      // Report whether an update is available for this package.
      // Prints UPDATE_AVAILABLE, UP_TO_DATE or UNKNOWN (single token, easy to parse).
      return `
        PKG="${serviceName}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          if apt-get -s install --only-upgrade "$PKG" 2>/dev/null | grep -q '^Inst '; then
            echo "UPDATE_AVAILABLE"
          else
            echo "UP_TO_DATE"
          fi
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf -q check-update "$PKG" >/dev/null 2>&1
          RC=$?
          if [ $RC -eq 100 ]; then echo "UPDATE_AVAILABLE"
          elif [ $RC -eq 0 ]; then echo "UP_TO_DATE"
          else echo "UNKNOWN"
          fi
        elif command -v yum >/dev/null 2>&1; then
          sudo yum -q check-update "$PKG" >/dev/null 2>&1
          RC=$?
          if [ $RC -eq 100 ]; then echo "UPDATE_AVAILABLE"
          elif [ $RC -eq 0 ]; then echo "UP_TO_DATE"
          else echo "UNKNOWN"
          fi
        elif command -v pacman >/dev/null 2>&1; then
          if pacman -Qu "$PKG" >/dev/null 2>&1; then echo "UPDATE_AVAILABLE"; else echo "UP_TO_DATE"; fi
        elif command -v brew >/dev/null 2>&1; then
          if brew outdated --quiet "$PKG" 2>/dev/null | grep -q .; then echo "UPDATE_AVAILABLE"; else echo "UP_TO_DATE"; fi
        else
          echo "UNKNOWN"
        fi
      `;

    case 'update':
      // Package manager agnostic update — quiet mode so informational lines
      // like dnf's "Last metadata expiration check ..." never surface as errors.
      return `
        OUT=""
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          OUT=$(sudo DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade ${serviceName} -y 2>&1)
        elif command -v dnf >/dev/null 2>&1; then
          OUT=$(sudo dnf -q -y update ${serviceName} 2>&1)
        elif command -v yum >/dev/null 2>&1; then
          OUT=$(sudo yum -q -y update ${serviceName} 2>&1)
        elif command -v pacman >/dev/null 2>&1; then
          OUT=$(sudo pacman -Syu ${serviceName} --noconfirm --quiet 2>&1)
        elif command -v brew >/dev/null 2>&1; then
          OUT=$(brew upgrade ${serviceName} 2>&1)
        else
          echo "No supported package manager found"
          exit 1
        fi
        echo "$OUT"
        # "Already latest version" outcomes are successes, not failures
        if echo "$OUT" | grep -qiE "already the newest version|0 upgraded|Nothing to do|[Nn]o packages marked|does not have any installation candidate|[Nn]o match for argument"; then
          exit 0
        fi
      `;
      
    case 'list-versions':
      // List installable package versions across distros.
      // Prints one version token per line (no headers) so the UI can render a picker.
      return `
        PKG="${serviceName}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update -qq >/dev/null 2>&1 || true
          apt-cache madison "$PKG" 2>/dev/null | awk '{print $3}' | awk '!seen[$0]++' | head -40
        elif command -v dnf >/dev/null 2>&1; then
          dnf --showduplicates list "$PKG" 2>/dev/null | grep "^${serviceName}\\." | awk '{print $2}' | awk '!seen[$0]++' | tail -40
        elif command -v yum >/dev/null 2>&1; then
          yum --showduplicates list "$PKG" 2>/dev/null | grep "^${serviceName}\\." | awk '{print $2}' | awk '!seen[$0]++' | tail -40
        elif command -v apk >/dev/null 2>&1; then
          apk search -v "$PKG" 2>/dev/null | sed "s/^${serviceName}-//" | awk '!seen[$0]++' | head -40
        elif command -v brew >/dev/null 2>&1; then
          brew info --json=v2 "$PKG" 2>/dev/null | tr ',' '\\n' | grep '"version"' | head -5 || echo "__UNSUPPORTED__"
        else
          echo "__UNSUPPORTED__"
        fi
      `;

    case 'install-version':
      // Install or downgrade to an exact package version.
      // NOTE: `version` is validated server-side before this command is built.
      return `
        PKG="${serviceName}"
        VER="${version}"
        if command -v apt-get >/dev/null 2>&1; then
          sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$PKG=$VER" 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y --allowerasing "$PKG-$VER" 2>&1 || sudo dnf downgrade -y "$PKG-$VER" 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum install -y "$PKG-$VER" 2>&1 || sudo yum downgrade -y "$PKG-$VER" 2>&1
        elif command -v apk >/dev/null 2>&1; then
          sudo apk add "$PKG=$VER" 2>&1
        else
          echo "Exact version pinning is not supported by this system's package manager"
          exit 1
        fi
      `;

    case 'uninstall':
      // Package manager agnostic uninstall
      return `
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get remove ${serviceName} -y 2>&1
        elif command -v yum >/dev/null 2>&1; then
          sudo yum remove ${serviceName} -y 2>&1
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf remove ${serviceName} -y 2>&1
        elif command -v pacman >/dev/null 2>&1; then
          sudo pacman -R ${serviceName} --noconfirm 2>&1
        elif command -v brew >/dev/null 2>&1; then
          brew uninstall ${serviceName} 2>&1
        else
          echo "No supported package manager found"
          exit 1
        fi
      `;
      
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const { connectionId, appName, action } = body;
    const version = typeof body.version === 'string' ? body.version.trim() : '';

    if (!connectionId || !appName || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: connectionId, appName, action' },
        { status: 400 }
      );
    }

    // Validate action
    const validActions = ['start', 'stop', 'restart', 'status', 'enable', 'disable', 'update', 'uninstall', 'check-update', 'list-versions', 'install-version'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    // Rate limit destructive/state-changing actions per user+connection to prevent abuse
    if (MUTATING_ACTIONS.has(action)) {
      const rateKey = `app-action:${session.user?.id || session.user?.sub || 'anon'}:${connectionId}`;
      const rl = checkRateLimit(rateKey, 20); // max 20 mutations/min per user per server
      if (!rl.allowed) {
        return NextResponse.json(
          { success: false, error: `Too many requests. Retry in ${Math.ceil(rl.resetIn / 1000)}s` },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetIn / 1000)) } }
        );
      }
    }

    // Version must be a safe package-version token (blocks shell injection via version strings)
    if (action === 'install-version') {
      if (!version) {
        return NextResponse.json({ success: false, error: 'Missing required field: version' }, { status: 400 });
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._~:+-]*$/.test(version)) {
        return NextResponse.json({ success: false, error: `Invalid version format: ${version}` }, { status: 400 });
      }
    }

    // Get SSH config and execute command
    // Ownership: if the connection has an owner, only that user may act on it.
    const actingUserId = session.user?.id || session.user?.sub || null;
    let sshConfig;
    try {
      sshConfig = await getSshConfig(connectionId, { userId: actingUserId });
    } catch (err) {
      if (/Access denied/.test(err.message)) {
        logger.warn(`[server-monitor/app-action] DENIED ${action} on ${connectionId} by user ${actingUserId}`);
        return NextResponse.json({ success: false, error: 'Access denied: this connection belongs to another user' }, { status: 403 });
      }
      throw err;
    }
    const command = getActionCommand(appName, action, version);
    
    logger.info(`[server-monitor/app-action] Executing ${action} for ${appName}`);
    
    // Package operations can legitimately take minutes; everything else should finish fast.
    // The native timeout kills the remote process (SIGKILL via channel signal) and tears
    // down the SSH channel — nothing keeps running after the caller gives up.
    const timeoutMs = ['update', 'install-version', 'uninstall'].includes(action) ? 300_000 : 60_000;
    const clientIp = getClientIp(request);
    const result = await execCommand(sshConfig, command, { timeoutMs });

    logger.info(`[server-monitor/app-action] Result:`, {
      code: result.code,
      stdoutLength: result.stdout?.length || 0,
      stderrLength: result.stderr?.length || 0
    });

    // Consider success if exit code is 0 or if stdout contains success indicators
    const output = ((result.stdout || '') + (result.stderr || '')).slice(0, MAX_OUTPUT_CHARS);
    const success = result.code === 0 || 
                   output.includes('Started') || 
                   output.includes('Stopped') ||
                   output.includes('active (running)') ||
                   output.includes('success');

    const responseBody = {
      success,
      action,
      appName,
      output: output.trim(),
      exitCode: result.code
    };

    // Structured answer for the check-update action
    if (action === 'check-update') {
      const verdict = output.trim().split('\n').map(l => l.trim()).find(l => ['UPDATE_AVAILABLE', 'UP_TO_DATE', 'UNKNOWN'].includes(l)) || 'UNKNOWN';
      responseBody.success = true;
      responseBody.updateAvailable = verdict === 'UPDATE_AVAILABLE';
      responseBody.verdict = verdict;
    }

    // Structured answer for list-versions: array of version tokens
    if (action === 'list-versions') {
      const lines = output.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.includes('__UNSUPPORTED__')) {
        responseBody.success = false;
        responseBody.error = 'Version listing is not supported by this system\'s package manager';
        responseBody.versions = [];
      } else {
        responseBody.success = true;
        responseBody.versions = [...new Set(lines)].slice(0, 40);
      }
    }

    // Tag install-version responses with the requested version for the UI
    if (action === 'install-version') {
      responseBody.version = version;
    }

    if (!success) {
      // Provide a readable error from the command output so the UI never shows "undefined"
      const firstLine = output.trim().split('\n').find(l => l.trim()) || '';
      responseBody.error = firstLine || `Command exited with code ${result.code}`;
    }

    // Audit trail (privileged actions only)
    if (MUTATING_ACTIONS.has(action)) {
      writeAudit({
        userId: actingUserId,
        username: session.user?.name || session.user?.email || null,
        connectionId,
        host: sshConfig.host,
        appName,
        action,
        version: version || null,
        success,
        exitCode: result.code ?? null,
        error: responseBody.error ? String(responseBody.error).slice(0, 500) : null,
        ip: clientIp,
      }, {
        appName,
        action,
        version,
        host: sshConfig.host,
        success,
        error: responseBody.error,
        userEmail: session.user?.email || null,
      }, request);
    }

    return NextResponse.json(responseBody);

  } catch (error) {
    logger.error('[server-monitor/app-action] error:', error.message);
    // Map known errors to precise status codes: bad input → 400,
    // command timeout → 504 (gateway-style timeout), everything else → 500.
    const msg = error.message || '';
    const status = /^Invalid app name:/.test(msg) ? 400
      : /Command timed out/.test(msg) ? 504
      : 500;
    return NextResponse.json(
      { success: false, error: status === 500 ? 'Failed to execute action on remote server' : msg },
      { status }
    );
  }
}
