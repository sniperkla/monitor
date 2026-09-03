import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { getPooledConnection } from '@/lib/dbPool';
import { checkRateLimit } from '@/lib/serverGuard';
import { attachRequestUserId, isRelayConnectionError } from '@/lib/requestUser';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/auditLog';
import { getClientIp } from '@/lib/clientIp';

// POST test connection
export async function POST(request, { params }) {
  // Populated once the target is known so every exit path can be audited.
  // Declared out here because `const`s inside the try block are not in scope
  // from the catch block.
  let auditContext = null;
  let userId = null;
  let userEmail = null;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = getClientIp(request);
    userId = session?.user?.id || session?.user?.sub || session.user?.email;
    userEmail = session.user?.email;

    // Rate limiting — per IP (shared-NAT abuse) AND per user (SSRF probing).
    const rateCheck = checkRateLimit(`test:${clientIP}`, 20); // Max 20 tests per minute
    if (!rateCheck.allowed) {
      return NextResponse.json({
        success: false, error: `Too many connection tests. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`
      }, { status: 429 });
    }

    const userRateCheck = checkRateLimit(`test:user:${userId}`, 20); // Max 20 tests per minute per user
    if (!userRateCheck.allowed) {
      return NextResponse.json({
        success: false, error: `Too many connection tests. Please wait ${Math.ceil(userRateCheck.resetIn / 1000)}s.`
      }, { status: 429 });
    }

    const { id } = await params;
    let connection;

    // 1. Determine if it's a DB connection or a direct payload (for local/manual)
    const db = await connectDB();
    const repo = new ConnectionRepository(db, session?.user?.id || session?.user?.sub || null);

    const isSaved = !!(id && !id.startsWith('local-'));

    if (isSaved) {
      connection = await repo.findById(id);
      if (!connection) {
        return NextResponse.json({ success: false, error: 'Connection not found in DB' }, { status: 404 });
      }
    } else {
      const body = await request.json().catch(() => ({}));
      connection = body.connection;
      if (!connection) {
        return NextResponse.json({ success: false, error: 'Connection data required for local test' }, { status: 400 });
      }
    }

    // 2. SSRF visibility. This endpoint makes the server open outbound SSH /
    //    DB connections to a host the user supplies, so every attempt is
    //    recorded: who asked, what they pointed us at, and whether it worked.
    //    Credentials are never logged. Ad-hoc ("local-test") targets are the
    //    highest-risk path because the host is fully attacker-controlled.
    auditContext = {
      connectionId: isSaved ? id : null,
      mode: isSaved ? 'saved' : 'ad-hoc',
      host: connection?.host ?? null,
      port: connection?.port ?? null,
      type: connection?.type || 'ssh',
      dbProvider: connection?.dbProvider || null,
      authType: connection?.authType || null,
      username: connection?.username ?? null,
      relayName: connection?.relayName || null,
    };

    let result;
    if (connection.type === 'database') {
      connection = await attachRequestUserId(request, connection);
      result = await testDatabaseConnection(connection);
    } else {
      // Prepare SSH config
      const sshConfig = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        readyTimeout: 10000,
      };

      if (connection.authType === 'password') {
        sshConfig.password = decrypt(connection.password);
      } else if (connection.authType === 'privateKey') {
        sshConfig.privateKey = decrypt(connection.privateKey);
        if (connection.passphrase) {
          sshConfig.passphrase = decrypt(connection.passphrase);
        }
      }
      result = await testSSHConnection(sshConfig);
    }

    // 3. Update DB status and systemInfo on success
    if (id && !id.startsWith('local-')) {
      const update = {
        status: result.success ? 'online' : 'offline',
        lastConnected: result.success ? new Date() : (connection.lastConnected || null),
        info: result.success ? result.info : (connection.info || null),
      };
      if (result.success && result.specs) {
        update.systemInfo = { ...result.specs, fetchedAt: new Date() };
      }
      await repo.update(id, update);
    }

    if (auditContext) {
      await auditLog({
        req: request,
        action: 'connection.test',
        userId,
        userEmail,
        detail: {
          ...auditContext,
          success: !!result?.success,
          error: result?.success ? null : (result?.error || null),
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Test connection error:', error);

    if (auditContext) {
      await auditLog({
        req: request,
        action: 'connection.test',
        userId,
        userEmail,
        detail: {
          ...auditContext,
          success: false,
          error: error?.message || 'Internal error',
        },
      });
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

async function testDatabaseConnection(conn) {
  try {
    // Use pooled connection — this also warms up the pool for future queries
    const pooled = await getPooledConnection(conn);
    const provider = conn.dbProvider || 'mongodb';
    
    if (provider === 'mongodb') {
      let version = 'Connected';
      try {
        const admin = pooled.db.db.admin();
        const status = await admin.serverStatus();
        version = `v${status.version}`;
      } catch (e) {
        // Fallback: Just connected is enough if it didn't throw
        logger.info('ServerStatus restricted, using basic connection success');
      }
      // Don't close! Connection stays in pool for reuse
      return { success: true, info: `MongoDB ${version}` };
    } else if (provider === 'mysql') {
      const [rows] = await pooled.db.query('SELECT VERSION() as version');
      return { success: true, info: `MySQL ${rows[0].version}` };
    } else if (provider === 'postgres') {
      const res = await pooled.db.query('SELECT version()');
      const version = res.rows[0].version.split(' ').slice(0, 2).join(' ');
      return { success: true, info: version };
    }
    return { success: false, error: `Provider ${provider} not supported for testing yet` };
  } catch (err) {
    return { success: false, error: err.message, relayRequired: isRelayConnectionError(err.message) };
  }
}

function testSSHConnection(config) {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: 'Connection timed out (10s)' });
    }, 10000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      // Gather system info: OS, CPU, RAM, uptime
      conn.exec('uname -srm && nproc && free -m 2>/dev/null || sysctl -n hw.memsize 2>/dev/null && uptime', (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: true, info: 'Connected' });
          return;
        }
        let output = '';
        stream.on('data', (data) => output += data.toString());
        stream.on('close', () => {
          conn.end();
          const lines = output.trim().split('\n');
          const osInfo = lines[0] || '';
          const cpuCores = lines[1] || '';
          const memLine = lines[2] || '';
          const uptimeLine = lines[3] || '';

          // Parse RAM (Linux: free -m shows "Mem: total used free...")
          let ram = '';
          if (memLine.includes('Mem:')) {
            const parts = memLine.split(/\s+/);
            const total = parseInt(parts[1]);
            if (total > 1024) ram = `${(total / 1024).toFixed(1)}GB`;
            else ram = `${total}MB`;
          } else if (memLine.match(/^\d+$/)) {
            // macOS: sysctl returns bytes
            const bytes = parseInt(memLine);
            ram = `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
          }

          const info = [
            osInfo,
            cpuCores ? `${cpuCores} cores` : '',
            ram ? `${ram} RAM` : '',
            uptimeLine
          ].filter(Boolean).join(' | ');

          resolve({ success: true, info: info || 'Connected', specs: { os: osInfo, cpu: cpuCores, ram, uptime: uptimeLine } });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    try {
      conn.connect(config);
    } catch (err) {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    }
  });
}
