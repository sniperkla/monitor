import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { Client as SshClient } from 'ssh2';
import { decryptWithMetadata } from '@/utils/encryption';
import { logger } from '@/lib/logger';

// Helper: quick SSH exec → returns stdout+stderr
function sshExec(sshConfig, command, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const client = new SshClient();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => finish({ stdout: '', stderr: 'Timed out', error: 'SSH exec timed out' }), timeoutMs);

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); return finish({ stdout: '', stderr: err.message, error: err.message }); }
        let stdout = '';
        let stderr = '';
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
        stream.on('close', () => { clearTimeout(timer); finish({ stdout: stdout.trim(), stderr: stderr.trim() }); });
      });
    });
    client.on('error', (err) => { clearTimeout(timer); finish({ stdout: '', stderr: err.message, error: err.message }); });
    client.connect(sshConfig);
  });
}

const isLocalhost = (host) => /^(localhost|127\.0\.0\.1)$/.test(host);

function findActiveRelay() {
  const activeRelays = global.__activeRelays;
  if (!activeRelays || activeRelays.size === 0) return null;
  const userRelays = activeRelays.values().next().value;
  if (userRelays instanceof Map && userRelays.size > 0) {
    return userRelays.values().next().value;
  }
  return userRelays && !(userRelays instanceof Map) ? userRelays : null;
}

// Helper: build sshConfig from connection record with Local Relay support
function buildSshConfig(conn) {
  const config = {
    host: conn.host,
    port: Number(conn.port) || 22,
    username: conn.username,
    readyTimeout: 10000,
  };

  if (conn.authType === 'privateKey' && conn.privateKey) {
    let key = conn.privateKey;
    try { const d = decryptWithMetadata(key); if (d.success) key = d.text; } catch (_) {}
    config.privateKey = key;
    if (conn.passphrase) {
      let pp = conn.passphrase;
      try { const d = decryptWithMetadata(pp); if (d.success) pp = d.text; } catch (_) {}
      config.passphrase = pp;
    }
  } else if (conn.password) {
    let pw = conn.password;
    try { const d = decryptWithMetadata(pw); if (d.success) pw = d.text; } catch (_) {}
    config.password = pw;
  }

  // ── Local Relay Mode Check ──
  if (isLocalhost(config.host) || conn.useRelay) {
    const relay = findActiveRelay();
    if (relay && relay.ws) {
      relay.targetHost = (config.host && !isLocalhost(config.host)) ? config.host : 'localhost';
      relay.targetPort = parseInt(config.port, 10) || 22;
      config.host = '127.0.0.1';
      config.port = relay.localPort;
      delete config.sock;
    }
  }

  return config;
}

// ── Verify a MongoDB port via SSH (runs mongosh / mongo / docker exec on the server itself) ──
async function verifyPortViaSSH(sshConfig, port, host) {
  // Build the check script - tries multiple methods:
  // 1. mongosh (modern)
  // 2. mongo (legacy)
  // 3. docker exec into a container that exposes the port
  // All run LOCAL to the server via SSH, so no firewall issues
  const script = `
PORT=${port}
HOST=${host || '127.0.0.1'}

# First check if port is listening at all
LISTENING=$(ss -tlnp 2>/dev/null | grep -c ":$PORT " || netstat -tlnp 2>/dev/null | grep -c ":$PORT " || echo 0)
if [ "$LISTENING" = "0" ]; then
  echo '{"listening":false}'
  exit 0
fi

# Try mongosh (modern MongoDB shell)
if command -v mongosh >/dev/null 2>&1; then
  RESULT=$(timeout 5 mongosh --host 127.0.0.1 --port $PORT --quiet --eval "try { JSON.stringify(db.isMaster()) } catch(e) { JSON.stringify({err:e.message}) }" 2>/dev/null | tail -1)
  if echo "$RESULT" | grep -q '"ok"'; then
    echo "MONGOSH:$RESULT"
    exit 0
  fi
fi

# Try legacy mongo shell
if command -v mongo >/dev/null 2>&1; then
  RESULT=$(timeout 5 mongo --host 127.0.0.1 --port $PORT --quiet --eval "JSON.stringify(db.isMaster())" 2>/dev/null | tail -1)
  if echo "$RESULT" | grep -q '"ok"'; then
    echo "MONGO:$RESULT"
    exit 0
  fi
fi

# Try docker exec into a container that maps to this port
CONTAINER=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep "0.0.0.0:$PORT->" | awk '{print $1}' | head -1)
if [ -n "$CONTAINER" ]; then
  RESULT=$(timeout 5 docker exec "$CONTAINER" mongosh --quiet --eval "try { JSON.stringify(db.isMaster()) } catch(e) { JSON.stringify({err:e.message}) }" 2>/dev/null | tail -1)
  if echo "$RESULT" | grep -q '"ok"'; then
    echo "DOCKER_MONGOSH:$RESULT"
    exit 0
  fi
  RESULT=$(timeout 5 docker exec "$CONTAINER" mongo --quiet --eval "JSON.stringify(db.isMaster())" 2>/dev/null | tail -1)
  if echo "$RESULT" | grep -q '"ok"'; then
    echo "DOCKER_MONGO:$RESULT"
    exit 0
  fi
fi

# Port is listening but we couldn't get isMaster - still counts as connected
echo '{"listening":true,"noClient":true}'
`.trim();

  const { stdout, error } = await sshExec(sshConfig, script, 15000);

  if (error || !stdout) {
    return { connected: false, error: error || 'No response from SSH' };
  }

  // Port not listening at all
  if (stdout === '{"listening":false}') {
    return { connected: false, error: 'Port not listening on this server' };
  }

  // Port listening but no mongo client available
  if (stdout.includes('"noClient":true') || stdout.includes('"listening":true')) {
    return { connected: true, isReplSet: false, state: 'STANDALONE', noClient: true };
  }

  // Parse the isMaster result
  const prefixes = ['MONGOSH:', 'MONGO:', 'DOCKER_MONGOSH:', 'DOCKER_MONGO:'];
  let jsonStr = stdout;
  for (const prefix of prefixes) {
    if (stdout.includes(prefix)) {
      jsonStr = stdout.split(prefix).pop().trim();
      break;
    }
  }

  try {
    const result = JSON.parse(jsonStr);
    const isReplSet = !!result.setName;
    let state = 'STANDALONE';
    if (isReplSet) {
      if (result.ismaster === true || result.isWritablePrimary === true) state = 'PRIMARY';
      else if (result.secondary === true) state = 'SECONDARY';
      else state = 'MEMBER';
    }
    return {
      connected: true,
      isReplSet,
      setName: result.setName || null,
      state,
    };
  } catch (_) {
    // Couldn't parse but port is reachable
    return { connected: true, isReplSet: false, state: 'STANDALONE' };
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, sshConnId, mongoUri, useRelay } = body;

    if (!sshConnId) return NextResponse.json({ success: false, error: 'sshConnId required' }, { status: 400 });

    // Load SSH connection
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);
    await repo.init();
    const fullConn = await repo.findById(sshConnId);
    if (!fullConn) return NextResponse.json({ success: false, error: 'SSH connection not found' }, { status: 404 });
    const conn = fullConn.toObject ? fullConn.toObject() : fullConn;
    if (conn.type === 'database') return NextResponse.json({ success: false, error: 'Selected connection is a database, not SSH' }, { status: 400 });

    // Override useRelay if passed in request (e.g., from UI mode toggle)
    if (typeof useRelay === 'boolean') {
      conn.useRelay = useRelay;
    }

    const sshConfig = buildSshConfig(conn);
    const serverHost = conn.host;

    // ── ACTION: verify ── Verify a specific port via SSH (not direct connection)
    if (action === 'verify') {
      // Parse host:port from mongoUri (e.g. mongodb://3.1.41.227:27017)
      const match = (mongoUri || '').match(/\/\/([^:/]+):(\d+)/);
      if (!match) return NextResponse.json({ success: false, error: 'Invalid mongoUri format' }, { status: 400 });
      const [, host, portStr] = match;
      const port = parseInt(portStr);

      const result = await verifyPortViaSSH(sshConfig, port, host);
      return NextResponse.json({ success: true, ...result });
    }

    // ── ACTION: scan ── Discover all MongoDB instances via SSH
    if (action === 'scan') {
      // Comprehensive port discovery script
      const discoveryScript = `
# Method 1: ss (socket stats) - most reliable
SS_PORTS=$(ss -tlnp 2>/dev/null | grep -oE ':[0-9]+' | grep -oE '[0-9]+' | sort -un | awk -F: '$1 >= 27000 && $1 <= 28000')

# Method 2: netstat fallback
NET_PORTS=$(netstat -tlnp 2>/dev/null | grep -oE ':[0-9]+' | grep -oE '[0-9]+' | sort -un | awk '$1 >= 27000 && $1 <= 28000')

# Method 3: mongod process args
PS_PORTS=$(ps aux 2>/dev/null | grep -E '[m]ongod' | grep -oE '\\-\\-port[= ][0-9]+' | grep -oE '[0-9]+')

# Method 4: docker container ports mapping to mongo range
DOCKER_PORTS=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -oE '0\\.0\\.0\\.0:[0-9]+->2701[0-9]' | grep -oE ':[0-9]+' | grep -oE '[0-9]+')

# Method 5: lsof (macOS/some Linux)
LSOF_PORTS=$(lsof -i -P -n 2>/dev/null | grep -E 'mongod.*LISTEN' | grep -oE ':[0-9]+' | grep -oE '[0-9]+')

# Combine and deduplicate all
ALL_PORTS=$(echo "$SS_PORTS $NET_PORTS $PS_PORTS $DOCKER_PORTS $LSOF_PORTS" | tr ' ' '\\n' | sort -un | awk 'NR>0 && $1+0 >= 1024 && $1+0 <= 65535')
echo "$ALL_PORTS"
`.trim();

      const { stdout: portStdout, error: portError } = await sshExec(sshConfig, discoveryScript, 15000);

      let ports = [];
      if (portStdout) {
        ports = portStdout.split('\n')
          .map(p => parseInt(p.trim()))
          .filter(p => !isNaN(p) && p >= 1024 && p <= 65535);
      }

      // Deduplicate
      ports = [...new Set(ports)].sort((a, b) => a - b);

      if (ports.length === 0 && portError) {
        return NextResponse.json({ success: false, error: `SSH discovery failed: ${portError}` });
      }

      // If nothing found, try common mongo ports
      if (ports.length === 0) {
        ports = [27017, 27018, 27019];
      }

      // Verify each discovered port via SSH (parallel, up to 5)
      const checkPorts = ports.slice(0, 8); // limit to 8 ports
      const verified = await Promise.allSettled(
        checkPorts.map(async (port) => {
          const check = await verifyPortViaSSH(sshConfig, port, serverHost);
          return {
            port,
            host: serverHost,
            uri: `mongodb://${serverHost}:${port}`,
            label: `${serverHost}:${port}`,
            ...check
          };
        })
      );

      const instances = verified.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { port: checkPorts[i], host: serverHost, uri: `mongodb://${serverHost}:${checkPorts[i]}`, connected: false, error: r.reason?.message }
      );

      return NextResponse.json({
        success: true,
        host: serverHost,
        serverName: conn.name || conn.host,
        instances
      });
    }

    // ── ACTION: run-docker ── Execute docker run on remote node via SSH automatically
    if (action === 'run-docker') {
      const { command } = body;
      if (!command) return NextResponse.json({ success: false, error: 'command required' }, { status: 400 });

      // Run command directly, with sudo fallback if needed
      let runScript = `${command} 2>&1`;
      let { stdout, stderr, error } = await sshExec(sshConfig, runScript, 25000);
      let combined = (stdout + ' ' + stderr).toLowerCase();

      if (combined.includes('permission denied') || combined.includes('got permission denied while trying to connect to the docker daemon socket')) {
        runScript = `sudo ${command} 2>&1`;
        const res = await sshExec(sshConfig, runScript, 25000);
        stdout = res.stdout;
        stderr = res.stderr;
        error = res.error;
      }

      return NextResponse.json({
        success: !error && !stdout.toLowerCase().includes('error:'),
        output: (stdout || stderr || error || 'Done').trim()
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });

  } catch (error) {
    logger.error('scan-node error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
