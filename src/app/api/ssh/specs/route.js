import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { Client } from 'ssh2';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';
import { decrypt } from '@/utils/encryption';
import { checkRateLimit } from '@/lib/serverGuard';
import { logger } from '@/lib/logger';

const SPECS_COMMAND = `echo "__DISTRO__" && (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s) && echo "__OS__" && uname -srm && echo "__CPU__" && cat /proc/cpuinfo 2>/dev/null | grep -m1 'model name' || sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown" && echo "__CORES__" && nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null && echo "__RAM__" && free -b 2>/dev/null | awk '/^Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null && echo "__RAMFMT__" && free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo "" && echo "__UPTIME__" && uptime -p 2>/dev/null || uptime && echo "__HOSTNAME__" && hostname 2>/dev/null && echo "__KERNEL__" && uname -r 2>/dev/null`;

function parseSpecs(output) {
  const get = (marker) => {
    const regex = new RegExp(`${marker}\\n(.*)`);
    const m = output.match(regex);
    return m ? m[1].trim() : null;
  };

  const distro = get('__DISTRO__');
  const os = get('__OS__');
  const cpu = get('__CPU__');
  const coresStr = get('__CORES__');
  const ramBytesStr = get('__RAM__');
  const ramFmt = get('__RAMFMT__');
  const uptime = get('__UPTIME__');
  const hostname = get('__HOSTNAME__');
  const kernel = get('__KERNEL__');

  const cores = coresStr ? parseInt(coresStr, 10) : null;
  const ramBytes = ramBytesStr ? parseInt(ramBytesStr, 10) : null;

  let ram = ramFmt || null;
  if (!ram && ramBytes) {
    const gb = ramBytes / (1024 * 1024 * 1024);
    ram = gb >= 1 ? `${gb.toFixed(1)}GB` : `${Math.round(ramBytes / (1024 * 1024))}MB`;
  }

  return { distro, os, cpu, cores, ram, ramBytes, uptime, hostname, kernel };
}

function fetchSpecs(config) {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: 'Connection timed out (15s)' });
    }, 15000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn.exec(SPECS_COMMAND, (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }
        let output = '';
        stream.on('data', (data) => (output += data.toString()));
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          conn.end();
          try {
            const specs = parseSpecs(output);
            const info = [
              specs.os,
              specs.cpu,
              specs.cores ? `${specs.cores} cores` : '',
              specs.ram ? `${specs.ram} RAM` : '',
              specs.uptime,
            ]
              .filter(Boolean)
              .join(' | ');
            resolve({ success: true, specs, info });
          } catch (e) {
            resolve({ success: false, error: 'Failed to parse specs output' });
          }
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

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`specs:${clientIP}`, 30);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `Rate limit exceeded. Wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { connectionId } = body;
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId required' }, { status: 400 });
    }

    const db = await connectDB();
    const repo = new ConnectionRepository(db);
    const conn = await repo.findById(connectionId);
    if (!conn) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 });
    }

    const sshConfig = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      readyTimeout: 15000,
    };

    if (conn.authType === 'password') {
      sshConfig.password = decrypt(conn.password);
    } else if (conn.authType === 'privateKey') {
      sshConfig.privateKey = decrypt(conn.privateKey);
      if (conn.passphrase) sshConfig.passphrase = decrypt(conn.passphrase);
    }

    const result = await fetchSpecs(sshConfig);

    if (result.success) {
      const systemInfo = { ...result.specs, fetchedAt: new Date() };
      await repo.update(connectionId, { systemInfo });
      return NextResponse.json({ success: true, systemInfo, info: result.info });
    }

    return NextResponse.json({ success: false, error: result.error });
  } catch (error) {
    logger.error('Fetch specs error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
