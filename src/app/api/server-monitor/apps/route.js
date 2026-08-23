import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

// Shell script that probes each application in a single SSH session.
// Each section is delimited so we can parse them independently.
const APPS_SCRIPT = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"
_cmd() { command -v "$1" >/dev/null 2>&1; }
_sudo() { sudo -n true 2>/dev/null && echo 1 || echo 0; }
HAS_SUDO="$(_sudo)"

# ── Docker ──────────────────────────────────────────────────────────────────
echo "===DOCKER==="
if _cmd docker; then
  VER_RAW="$(docker --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'Docker version \K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active docker 2>/dev/null || \
            service docker status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (docker info >/dev/null 2>&1 && echo 'running') || echo 'unknown')"
  CONTAINERS="$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  CONTAINERS_ALL="$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONTAINERS_RUNNING=$CONTAINERS"
  echo "CONTAINERS_TOTAL=$CONTAINERS_ALL"
elif [ "$HAS_SUDO" = "1" ] && sudo -n docker --version >/dev/null 2>&1; then
  VER_RAW="$(sudo -n docker --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'Docker version \K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(sudo -n systemctl is-active docker 2>/dev/null || echo 'unknown')"
  CONTAINERS="$(sudo -n docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  CONTAINERS_ALL="$(sudo -n docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONTAINERS_RUNNING=$CONTAINERS"
  echo "CONTAINERS_TOTAL=$CONTAINERS_ALL"
else
  echo "INSTALLED=false"
fi

# ── Docker Compose ───────────────────────────────────────────────────────────
echo "===DOCKER_COMPOSE==="
if _cmd docker-compose; then
  VER_RAW="$(docker-compose --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP '(version |v)?\K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
elif docker compose version >/dev/null 2>&1; then
  VER_RAW="$(docker compose version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP '(version |v)?\K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
else
  echo "INSTALLED=false"
fi

# ── Nginx ────────────────────────────────────────────────────────────────────
echo "===NGINX==="
NGINX_BIN=""
for _p in "/usr/sbin/nginx" "/usr/local/sbin/nginx" "/snap/bin/nginx"; do
  [ -x "$_p" ] && NGINX_BIN="$_p" && break
done
[ -z "$NGINX_BIN" ] && NGINX_BIN="$(command -v nginx 2>/dev/null)"
if [ -n "$NGINX_BIN" ]; then
  VER_RAW="$($NGINX_BIN -v 2>&1 | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'nginx/(version /)?\K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active nginx 2>/dev/null || \
            service nginx status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x nginx >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  CONFIG="$($NGINX_BIN -T 2>/dev/null | grep -m1 'configuration file' | awk '{print $NF}' | tr -d ';' || echo '/etc/nginx/nginx.conf')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
  echo "CONFIG=$CONFIG"
else
  echo "INSTALLED=false"
fi

# ── MongoDB ──────────────────────────────────────────────────────────────────
echo "===MONGODB==="
MONGO_BIN=""
for _p in "/usr/bin/mongod" "/usr/local/bin/mongod" "/opt/homebrew/bin/mongod"; do
  [ -x "$_p" ] && MONGO_BIN="$_p" && break
done
[ -z "$MONGO_BIN" ] && MONGO_BIN="$(command -v mongod 2>/dev/null)"
if [ -n "$MONGO_BIN" ]; then
  VER_RAW="$($MONGO_BIN --version 2>/dev/null | head -1)"
  VER="$(echo "$VER_RAW" | grep -oP 'version v?\K[0-9]+\.[0-9]+\.[0-9]+' || echo "$VER_RAW")"
  STATUS="$(systemctl is-active mongod 2>/dev/null || \
            service mongod status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x mongod >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── MySQL / MariaDB ───────────────────────────────────────────────────────────
echo "===MYSQL==="
if _cmd mysqld || _cmd mysqld_safe || _cmd mariadbd; then
  BIN="$(command -v mysqld 2>/dev/null || command -v mariadbd 2>/dev/null)"
  VER="$(mysql --version 2>/dev/null | head -1 || mariadb --version 2>/dev/null | head -1 || $BIN --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active mysql 2>/dev/null || \
            systemctl is-active mariadb 2>/dev/null || \
            service mysql status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x mysqld >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo "===POSTGRESQL==="
if _cmd pg_ctl || _cmd postgres; then
  VER="$(postgres --version 2>/dev/null | head -1 || pg_ctl --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active postgresql 2>/dev/null || \
            service postgresql status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (pgrep -x postgres >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
echo "===REDIS==="
if _cmd redis-server; then
  VER="$(redis-server --version 2>/dev/null | head -1)"
  STATUS="$(systemctl is-active redis 2>/dev/null || \
            systemctl is-active redis-server 2>/dev/null || \
            service redis-server status 2>/dev/null | grep -oE 'running|stopped' | head -1 || \
            (redis-cli ping >/dev/null 2>&1 && echo 'running') || echo 'stopped')"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "STATUS=$STATUS"
else
  echo "INSTALLED=false"
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
echo "===NODEJS==="
NODE_BIN="$(command -v node 2>/dev/null || command -v nodejs 2>/dev/null)"
if [ -n "$NODE_BIN" ]; then
  VER="$($NODE_BIN --version 2>/dev/null)"
  NPM_VER="$(npm --version 2>/dev/null)"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "NPM_VERSION=$NPM_VER"
else
  echo "INSTALLED=false"
fi

# ── Python ────────────────────────────────────────────────────────────────────
echo "===PYTHON==="
PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null)"
if [ -n "$PYTHON_BIN" ]; then
  VER="$($PYTHON_BIN --version 2>&1 | head -1)"
  PIP_VER="$(pip3 --version 2>/dev/null | head -1 || pip --version 2>/dev/null | head -1)"
  echo "INSTALLED=true"
  echo "VERSION=$VER"
  echo "PIP_VERSION=$PIP_VER"
else
  echo "INSTALLED=false"
fi

# ── PHP ───────────────────────────────────────────────────────────────────────
echo "===PHP==="
if _cmd php; then
  echo "INSTALLED=true"
  echo "VERSION=$(php -r 'echo PHP_VERSION;' 2>/dev/null)"
else
  echo "INSTALLED=false"
fi

# ── Java ──────────────────────────────────────────────────────────────────────
echo "===JAVA==="
if _cmd java; then
  echo "INSTALLED=true"
  echo "VERSION=$(java -version 2>&1 | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Go ────────────────────────────────────────────────────────────────────────
echo "===GO==="
if _cmd go; then
  echo "INSTALLED=true"
  echo "VERSION=$(go version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Rust / Cargo ──────────────────────────────────────────────────────────────
echo "===RUST==="
if _cmd rustc; then
  echo "INSTALLED=true"
  echo "VERSION=$(rustc --version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── Git ───────────────────────────────────────────────────────────────────────
echo "===GIT==="
if _cmd git; then
  echo "INSTALLED=true"
  echo "VERSION=$(git --version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

# ── rclone ────────────────────────────────────────────────────────────────────
echo "===RCLONE==="
RCLONE_BIN="$(command -v rclone 2>/dev/null || ls "$HOME/.local/bin/rclone" 2>/dev/null)"
if [ -n "$RCLONE_BIN" ] && [ -x "$RCLONE_BIN" ]; then
  echo "INSTALLED=true"
  echo "VERSION=$($RCLONE_BIN version 2>/dev/null | head -1)"
else
  echo "INSTALLED=false"
fi

echo "===DONE==="
`;

/**
 * Extract a named block between ===NAME=== and the next ===...=== delimiter.
 */
function extractBlock(output, name) {
  const re = new RegExp(`===${name}===\\n([\\s\\S]*?)(?====[A-Z_]+=|$)`);
  return output.match(re)?.[1] || '';
}

/**
 * Parse a simple KEY=value block into an object.
 */
function parseBlock(block) {
  const result = {};
  for (const line of block.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Build an app entry from parsed key-value data.
 * @param {string} name  Display name
 * @param {object} data  Parsed block fields
 * @param {object} extra Additional fields to merge
 */
function buildApp(name, data, extra = {}) {
  const installed = data.INSTALLED === 'true';
  if (!installed) return { name, installed: false };
  const entry = { name, installed: true, version: data.VERSION || null, ...extra };
  if (data.STATUS) entry.status = data.STATUS;
  return entry;
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'Missing connectionId' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(connectionId);
    const result = await execCommand(sshConfig, APPS_SCRIPT);

    logger.info('[server-monitor/apps] SSH result:', {
      code: result.code,
      stdoutLength: result.stdout?.length || 0,
      stderrLength: result.stderr?.length || 0
    });

    if (result.code !== 0 && !result.stdout) {
      logger.error('[server-monitor/apps] Command failed:', result.stderr);
      return NextResponse.json(
        { success: false, error: result.stderr || 'Failed to detect applications' },
        { status: 500 }
      );
    }

    const output = result.stdout || '';
    
    // Log the raw output for debugging (first 500 chars)
    logger.info('[server-monitor/apps] Output preview:', output.substring(0, 500));

    // ── Parse each app block ─────────────────────────────────────────────────

    const dockerData = parseBlock(extractBlock(output, 'DOCKER'));
    const docker = buildApp('Docker', dockerData, {
      containersRunning: parseInt(dockerData.CONTAINERS_RUNNING || '0', 10),
      containersTotal: parseInt(dockerData.CONTAINERS_TOTAL || '0', 10),
    });

    const composeData = parseBlock(extractBlock(output, 'DOCKER_COMPOSE'));
    const dockerCompose = buildApp('Docker Compose', composeData);

    const nginxData = parseBlock(extractBlock(output, 'NGINX'));
    const nginx = buildApp('Nginx', nginxData, {
      configFile: nginxData.CONFIG || null,
    });

    const mongoData = parseBlock(extractBlock(output, 'MONGODB'));
    const mongodb = buildApp('MongoDB', mongoData);

    const mysqlData = parseBlock(extractBlock(output, 'MYSQL'));
    const mysql = buildApp('MySQL / MariaDB', mysqlData);

    const pgData = parseBlock(extractBlock(output, 'POSTGRESQL'));
    const postgresql = buildApp('PostgreSQL', pgData);

    const redisData = parseBlock(extractBlock(output, 'REDIS'));
    const redis = buildApp('Redis', redisData);

    const nodeData = parseBlock(extractBlock(output, 'NODEJS'));
    const nodejs = buildApp('Node.js', nodeData, {
      npmVersion: nodeData.NPM_VERSION || null,
    });

    const pythonData = parseBlock(extractBlock(output, 'PYTHON'));
    const python = buildApp('Python', pythonData, {
      pipVersion: pythonData.PIP_VERSION || null,
    });

    const phpData = parseBlock(extractBlock(output, 'PHP'));
    const php = buildApp('PHP', phpData);

    const javaData = parseBlock(extractBlock(output, 'JAVA'));
    const java = buildApp('Java', javaData);

    const goData = parseBlock(extractBlock(output, 'GO'));
    const go = buildApp('Go', goData);

    const rustData = parseBlock(extractBlock(output, 'RUST'));
    const rust = buildApp('Rust', rustData);

    const gitData = parseBlock(extractBlock(output, 'GIT'));
    const git = buildApp('Git', gitData);

    const rcloneData = parseBlock(extractBlock(output, 'RCLONE'));
    const rclone = buildApp('rclone', rcloneData);

    const apps = [
      docker,
      dockerCompose,
      nginx,
      mongodb,
      mysql,
      postgresql,
      redis,
      nodejs,
      python,
      php,
      java,
      go,
      rust,
      git,
      rclone,
    ];

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      apps,
      // Convenience summary: only installed apps
      installed: apps.filter(a => a.installed).map(a => a.name),
    });
  } catch (error) {
    logger.error('[server-monitor/apps] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
