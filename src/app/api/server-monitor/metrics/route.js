import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';

// Shell script that collects all metrics instantly in a single SSH session without sleep bottlenecks
const METRICS_SCRIPT = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

echo "===CPU_INFO==="
CPU_MODEL="$(grep -m1 '^model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || \\
             sysctl -n machdep.cpu.brand_string 2>/dev/null || \\
             lscpu 2>/dev/null | grep '^Model name' | cut -d: -f2 | xargs || \\
             echo 'Unknown')"
CPU_CORES="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || \\
             sysctl -n hw.ncpu 2>/dev/null || \\
             nproc 2>/dev/null || echo '1')"
echo "MODEL=$CPU_MODEL"
echo "CORES=$CPU_CORES"

echo "===CPU_STAT==="
# Instant raw counters from /proc/stat or fallback
if [ -f /proc/stat ]; then
  grep '^cpu ' /proc/stat 2>/dev/null
else
  # macOS / BSD fallback: idle percentage
  CPU_IDLE="$(top -l 1 -n 0 2>/dev/null | grep -o '[0-9]*\\.[0-9]* id' | head -1 | awk '{print $1}' || echo '0')"
  echo "MACOS_IDLE=$CPU_IDLE"
fi

echo "===LOAD_AVG==="
cat /proc/loadavg 2>/dev/null || \\
  sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || \\
  uptime | grep -oP 'load average[s]?: \\K[0-9., ]+'

echo "===MEMORY==="
if [ -f /proc/meminfo ]; then
  awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/MemFree/{f=$2}/^Buffers/{b=$2}/^Cached/{c=$2} \\
    END{
      used=t-a;
      printf "TOTAL=%d\\nUSED=%d\\nFREE=%d\\nAVAIL=%d\\n",t*1024,used*1024,f*1024,a*1024
    }' /proc/meminfo
else
  # macOS / BSD
  TOTAL="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  PAGESIZE="$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)"
  PAGES_WIRED="$(vm_stat 2>/dev/null | awk '/wired/{print $4+0}')"
  PAGES_ACTIVE="$(vm_stat 2>/dev/null | awk '/Pages active/{print $3+0}')"
  PAGES_COMPRESSED="$(vm_stat 2>/dev/null | awk '/occupied by compressor/{print $5+0}')"
  awk -v total="$TOTAL" -v ps="$PAGESIZE" -v pw="$PAGES_WIRED" -v pa="$PAGES_ACTIVE" -v pc="$PAGES_COMPRESSED" \\
    'BEGIN{
       used=(pw+pa+pc)*ps;
       printf "TOTAL=%d\\nUSED=%d\\nFREE=%d\\nAVAIL=%d\\n",total,used,total-used,total-used
     }' /dev/null
fi

echo "===DISK==="
df -Pk 2>/dev/null | awk 'NR>1 && $1!~/tmpfs|devtmpfs|udev|overlay|shm|cgroupfs/ && $6~/^\\// {
  gsub(/%/,"",$5);
  used_bytes=$3*1024; total_bytes=$2*1024; free_bytes=$4*1024;
  printf "%s|%d|%d|%d|%s\\n",$6,total_bytes,used_bytes,free_bytes,$5
}' | sort -t'|' -k1

echo "===NETWORK==="
if [ -f /proc/net/dev ]; then
  cat /proc/net/dev
else
  echo "UNAVAILABLE"
fi

echo "===SYSTEM==="
HOSTNAME="$(hostname 2>/dev/null || echo 'unknown')"
KERNEL="$(uname -r 2>/dev/null || echo 'unknown')"
ARCH="$(uname -m 2>/dev/null || echo 'unknown')"
UPTIME_SEC="$(cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || sysctl -n kern.boottime 2>/dev/null | awk -F'[= ,]' '{print int($8)}' || echo '0')"
OS_NAME="$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s 2>/dev/null || echo 'unknown')"
echo "HOSTNAME=$HOSTNAME"
echo "KERNEL=$KERNEL"
echo "ARCH=$ARCH"
echo "UPTIME=$UPTIME_SEC"
echo "OS=$OS_NAME"
`;

/**
 * Parse /proc/net/dev lines into an array of interface stats
 */
function parseNetDev(block) {
  const result = [];
  const lines = block.split('\n').slice(2); // skip headers
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const iface = trimmed.slice(0, colonIdx).trim();
    if (iface === 'lo') continue; // ignore loopback

    const parts = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
    if (parts.length < 9) continue;
    const rxBytes = parseInt(parts[0], 10) || 0;
    const txBytes = parseInt(parts[8], 10) || 0;

    result.push({
      name: iface,
      rxBytesTotal: rxBytes,
      txBytesTotal: txBytes,
    });
  }
  return result;
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
    const result = await execCommand(sshConfig, METRICS_SCRIPT);

    if (result.code !== 0 && !result.stdout) {
      return NextResponse.json(
        { success: false, error: result.stderr || 'Failed to collect metrics' },
        { status: 500 }
      );
    }

    const output = result.stdout || '';

    // ── CPU Info ─────────────────────────────────────────────────────────────
    const cpuInfoBlock = output.match(/===CPU_INFO===\n([\s\S]*?)(?====CPU_STAT===)/)?.[1] || '';
    const cpuModel = cpuInfoBlock.match(/^MODEL=(.*)$/m)?.[1]?.trim() || 'Unknown';
    const cpuCores = parseInt(cpuInfoBlock.match(/^CORES=(\d+)$/m)?.[1] || '1', 10);

    // ── CPU Stat (Raw Instant Counters) ──────────────────────────────────────
    const cpuStatBlock = output.match(/===CPU_STAT===\n([\s\S]*?)(?====LOAD_AVG===)/)?.[1] || '';
    let cpuRaw = null;
    let fallbackUsage = 0;

    const cpuLineMatch = cpuStatBlock.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
    if (cpuLineMatch) {
      const user = parseInt(cpuLineMatch[1], 10) || 0;
      const nice = parseInt(cpuLineMatch[2], 10) || 0;
      const system = parseInt(cpuLineMatch[3], 10) || 0;
      const idle = parseInt(cpuLineMatch[4], 10) || 0;
      const iowait = parseInt(cpuLineMatch[5], 10) || 0;
      const irq = parseInt(cpuLineMatch[6], 10) || 0;
      const softirq = parseInt(cpuLineMatch[7], 10) || 0;
      const steal = parseInt(cpuLineMatch[8], 10) || 0;
      const total = user + nice + system + idle + iowait + irq + softirq + steal;
      cpuRaw = { user, nice, system, idle, iowait, irq, softirq, steal, total };
    } else {
      const macIdle = parseFloat(cpuStatBlock.match(/^MACOS_IDLE=([\d.]+)/m)?.[1] || '100');
      fallbackUsage = Math.max(0, Math.min(100, 100 - macIdle));
    }

    // ── Load Average ─────────────────────────────────────────────────────────
    const loadBlock = output.match(/===LOAD_AVG===\n([\s\S]*?)(?====MEMORY===)/)?.[1]?.trim() || '';
    const loadParts = loadBlock.split(/[\s,]+/).filter(Boolean);
    const loadAvg = {
      '1m': parseFloat(loadParts[0]) || 0,
      '5m': parseFloat(loadParts[1]) || 0,
      '15m': parseFloat(loadParts[2]) || 0,
    };

    if (!cpuRaw && fallbackUsage === 0 && loadAvg['1m'] > 0) {
      fallbackUsage = Math.min(100, (loadAvg['1m'] / Math.max(1, cpuCores)) * 100);
    }

    // ── Memory ───────────────────────────────────────────────────────────────
    const memBlock = output.match(/===MEMORY===\n([\s\S]*?)(?====DISK===)/)?.[1] || '';
    const memTotal = parseInt(memBlock.match(/^TOTAL=(\d+)$/m)?.[1] || '0', 10);
    const memUsed = parseInt(memBlock.match(/^USED=(\d+)$/m)?.[1] || '0', 10);
    const memFree = parseInt(memBlock.match(/^FREE=(\d+)$/m)?.[1] || '0', 10);
    const memAvail = parseInt(memBlock.match(/^AVAIL=(\d+)$/m)?.[1] || String(memFree), 10);
    const memUsedPercent = memTotal > 0 ? parseFloat(((memUsed / memTotal) * 100).toFixed(1)) : 0;

    // ── Disk ─────────────────────────────────────────────────────────────────
    const diskBlock = output.match(/===DISK===\n([\s\S]*?)(?====NETWORK===)/)?.[1] || '';
    const disks = diskBlock
      .split('\n')
      .filter(l => l.includes('|'))
      .map(line => {
        const [mount, total, used, free, usedPct] = line.split('|');
        return {
          mount: mount?.trim(),
          total: parseInt(total, 10) || 0,
          used: parseInt(used, 10) || 0,
          free: parseInt(free, 10) || 0,
          usedPercent: parseFloat(usedPct) || 0,
        };
      })
      .filter(d => d.mount);

    // ── Network ──────────────────────────────────────────────────────────────
    const netBlock = output.match(/===NETWORK===\n([\s\S]*?)(?====SYSTEM===)/)?.[1] || '';
    let networkInterfaces = [];
    let totalRx = 0;
    let totalTx = 0;

    if (!netBlock.includes('UNAVAILABLE')) {
      networkInterfaces = parseNetDev(netBlock);
      totalRx = networkInterfaces.reduce((sum, iface) => sum + iface.rxBytesTotal, 0);
      totalTx = networkInterfaces.reduce((sum, iface) => sum + iface.txBytesTotal, 0);
    }

    // ── System Info ──────────────────────────────────────────────────────────
    const sysBlock = output.match(/===SYSTEM===\n([\s\S]*)$/)?.[1] || '';
    const hostname = sysBlock.match(/^HOSTNAME=(.*)$/m)?.[1]?.trim() || 'unknown';
    const kernel = sysBlock.match(/^KERNEL=(.*)$/m)?.[1]?.trim() || 'unknown';
    const arch = sysBlock.match(/^ARCH=(.*)$/m)?.[1]?.trim() || 'unknown';
    const uptimeSec = parseInt(sysBlock.match(/^UPTIME=(\d+)$/m)?.[1] || '0', 10);
    const osName = sysBlock.match(/^OS=(.*)$/m)?.[1]?.trim() || 'unknown';

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        usage: fallbackUsage,
        loadAverage: [loadAvg['1m'], loadAvg['5m'], loadAvg['15m']],
        raw: cpuRaw,
      },
      memory: {
        total: memTotal,
        used: memUsed,
        free: memFree,
        available: memAvail,
        usedPercent: memUsedPercent,
      },
      disk: {
        filesystems: disks,
      },
      network: {
        interfaces: networkInterfaces,
        rxTotal: totalRx,
        txTotal: totalTx,
        rxRate: 0,
        txRate: 0,
      },
      system: {
        hostname,
        os: osName,
        kernel,
        arch,
        uptime: uptimeSec,
      },
    });
  } catch (error) {
    console.error('[server-monitor/metrics] error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
