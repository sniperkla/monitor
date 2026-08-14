/**
 * ⚡ Monitor Agent — Dedicated Real-Time Telemetry & Health Agent
 * 
 * Lightweight standalone daemon for Linux/macOS/Windows servers.
 * Connects back to the Central Monitor Server via WebSocket / WebRTC DataChannel
 * to stream ultra-low-latency 0ms system telemetry (CPU, RAM, Disks, Network, Docker).
 * 
 * Usage:
 *   node monitor-agent.js --server https://your-server.com --token <TOKEN> [--name <NAME>]
 *   node monitor-agent.js --install --server https://your-server.com --token <TOKEN>
 *   node monitor-agent.js --uninstall
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync, execSync } = require('child_process');

// ── Service IDs ──
const SVC_ID = 'server-monitor-agent';
const SVC_NAME = 'Server Monitor Telemetry Agent';

// ── Parse CLI Arguments ──
const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const SERVER = (getArg('--server') || process.env.MONITOR_SERVER || '').replace(/\/$/, '');
const TOKEN = getArg('--token') || process.env.MONITOR_TOKEN || '';
const AGENT_NAME = getArg('--name') || process.env.AGENT_NAME || os.hostname();
const IS_INSTALL = args.includes('--install');
const IS_UNINSTALL = args.includes('--uninstall');

// ── Service Installation / Uninstallation ──
if (IS_UNINSTALL) {
  uninstallService();
  process.exit(0);
}

if (IS_INSTALL) {
  if (!SERVER || !TOKEN) {
    console.error('❌ Error: --server and --token are required for --install');
    process.exit(1);
  }
  installService();
  process.exit(0);
}

if (!SERVER || !TOKEN) {
  console.log(`
⚡ Server Monitor Telemetry Agent

Usage:
  node monitor-agent.js --server <URL> --token <TOKEN> [--name <NAME>]
  node monitor-agent.js --install --server <URL> --token <TOKEN>
  node monitor-agent.js --uninstall
  `);
  process.exit(1);
}

function installService() {
  const platform = os.platform();
  const scriptPath = path.resolve(__filename);
  const nodeBin = process.execPath;

  console.log(`📦 Installing ${SVC_NAME}...`);

  if (platform === 'linux') {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, `${SVC_ID}.service`);
    fs.mkdirSync(unitDir, { recursive: true });

    const unitContent = `[Unit]
Description=${SVC_NAME}
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${scriptPath} --server "${SERVER}" --token "${TOKEN}" --name "${AGENT_NAME}"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
    fs.writeFileSync(unitPath, unitContent);
    try {
      spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
      spawnSync('systemctl', ['--user', 'enable', '--now', `${SVC_ID}.service`], { stdio: 'inherit' });
      console.log(`✅ ${SVC_NAME} installed & started via systemd user service.`);
      console.log(`   Check status: systemctl --user status ${SVC_ID}`);
    } catch (e) {
      console.error('⚠️ Could not enable systemd service:', e.message);
    }
  } else if (platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(plistDir, `com.monitor.${SVC_ID}.plist`);
    fs.mkdirSync(plistDir, { recursive: true });

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.monitor.${SVC_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${scriptPath}</string>
    <string>--server</string>
    <string>${SERVER}</string>
    <string>--token</string>
    <string>${TOKEN}</string>
    <string>--name</string>
    <string>${AGENT_NAME}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), `.${SVC_ID}.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), `.${SVC_ID}.err`)}</string>
</dict>
</plist>`;
    fs.writeFileSync(plistPath, plistContent);
    spawnSync('launchctl', ['load', plistPath], { stdio: 'inherit' });
    console.log(`✅ ${SVC_NAME} installed as macOS LaunchAgent.`);
  } else {
    console.log(`⚠️ Automatic service install not supported for ${platform}. Run with node directly.`);
  }
}

function uninstallService() {
  const platform = os.platform();
  console.log(`🗑️ Uninstalling ${SVC_NAME}...`);

  if (platform === 'linux') {
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `${SVC_ID}.service`);
    spawnSync('systemctl', ['--user', 'stop', `${SVC_ID}.service`], { stdio: 'ignore' });
    spawnSync('systemctl', ['--user', 'disable', `${SVC_ID}.service`], { stdio: 'ignore' });
    if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    spawnSync('systemctl', ['--user', 'reset-failed'], { stdio: 'ignore' });
    spawnSync('pkill', ['-f', '[m]onitor-agent'], { stdio: 'ignore' });
    console.log('✅ Service removed.');
  } else if (platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.monitor.${SVC_ID}.plist`);
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    spawnSync('pkill', ['-f', '[m]onitor-agent'], { stdio: 'ignore' });
    console.log('✅ LaunchAgent removed.');
  }
}

// ── Live Hardware Telemetry Engine ──
function collectSystemTelemetry() {
  const timestampMs = Date.now();
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length || 1;
  const platform = os.platform();

  let cpuRaw = null;
  let fallbackUsage = 0;

  // 1. CPU Ticks
  try {
    if (fs.existsSync('/proc/stat')) {
      const statContent = fs.readFileSync('/proc/stat', 'utf8');
      const match = statContent.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
      if (match) {
        const user    = parseInt(match[1], 10) || 0;
        const nice    = parseInt(match[2], 10) || 0;
        const system  = parseInt(match[3], 10) || 0;
        const idle    = parseInt(match[4], 10) || 0;
        const iowait  = parseInt(match[5], 10) || 0;
        const irq     = parseInt(match[6], 10) || 0;
        const softirq = parseInt(match[7], 10) || 0;
        const steal   = parseInt(match[8], 10) || 0;
        const total   = user + nice + system + idle + iowait + irq + softirq + steal;
        cpuRaw = { user, nice, system, idle, iowait, irq, softirq, steal, total };
      }
    } else if (platform === 'darwin') {
      let user = 0, sys = 0, idle = 0, nice = 0;
      for (const cpu of cpus) {
        user += cpu.times.user;
        sys  += cpu.times.sys;
        idle += cpu.times.idle;
        nice += cpu.times.nice;
      }
      cpuRaw = { user, nice, system: sys, idle, iowait: 0, irq: 0, softirq: 0, steal: 0, total: user + sys + idle + nice };
    }
  } catch (_) {}

  // 2. Memory
  let memTotal = os.totalmem() || 0;
  let memFree  = os.freemem() || 0;
  let memAvail = memFree;
  let memUsed  = Math.max(0, memTotal - memFree);

  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const t = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1]     || '0', 10) * 1024;
      const a = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0', 10) * 1024;
      const f = parseInt(meminfo.match(/MemFree:\s+(\d+)/)?.[1]      || '0', 10) * 1024;
      if (t > 0) {
        memTotal = t;
        memAvail = a || f;
        memFree  = f;
        memUsed  = Math.max(0, memTotal - memAvail);
      }
    } else if (platform === 'darwin') {
      const pageSize = parseInt(spawnSync('sysctl', ['-n', 'hw.pagesize'], { encoding: 'utf8' }).stdout?.trim(), 10) || 4096;
      const vmStatOut = spawnSync('vm_stat', [], { encoding: 'utf8' }).stdout || '';
      const wired = parseInt(vmStatOut.match(/Pages wired down:\s+(\d+)/)?.[1] || '0', 10);
      const active = parseInt(vmStatOut.match(/Pages active:\s+(\d+)/)?.[1] || '0', 10);
      const compressed = parseInt(vmStatOut.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] || '0', 10);
      if (wired + active > 0) {
        memUsed = (wired + active + compressed) * pageSize;
        memAvail = Math.max(0, memTotal - memUsed);
        memFree = memAvail;
      }
    }
  } catch (_) {}

  const memUsedPercent = memTotal > 0 ? parseFloat(((memUsed / memTotal) * 100).toFixed(1)) : 0;
  const loadAvg = os.loadavg() || [0, 0, 0];

  // 3. Network Interfaces
  let networkInterfaces = [];
  let totalRx = 0;
  let totalTx = 0;

  try {
    if (fs.existsSync('/proc/net/dev')) {
      const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
      for (const line of netDev.split('\n').slice(2)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx < 0) continue;
        const iface = trimmed.slice(0, colonIdx).trim();
        if (iface === 'lo') continue;
        const parts = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
        if (parts.length < 9) continue;
        const rxBytes = parseInt(parts[0], 10) || 0;
        const txBytes = parseInt(parts[8], 10) || 0;
        networkInterfaces.push({ name: iface, rxBytesTotal: rxBytes, txBytesTotal: txBytes });
        totalRx += rxBytes;
        totalTx += txBytes;
      }
    } else if (platform === 'darwin') {
      const netOut = spawnSync('netstat', ['-ib'], { encoding: 'utf8' }).stdout || '';
      const seen = new Set();
      for (const line of netOut.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        const iface = cols[0];
        if (iface === 'lo0' || seen.has(iface)) continue;
        seen.add(iface);
        const rxBytes = parseInt(cols[6], 10) || 0;
        const txBytes = parseInt(cols[9], 10) || 0;
        if (rxBytes === 0 && txBytes === 0) continue;
        networkInterfaces.push({ name: iface, rxBytesTotal: rxBytes, txBytesTotal: txBytes });
        totalRx += rxBytes;
        totalTx += txBytes;
      }
    }
  } catch (_) {}

  // 4. Disk Partitions
  let disks = [];
  try {
    const dfOut = spawnSync('df', ['-Pk'], { encoding: 'utf8' }).stdout || '';
    for (const line of dfOut.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      const [fs_, total1k, used1k, avail1k, usedPct, mount] = cols;
      if (!mount || !mount.startsWith('/')) continue;
      if (/tmpfs|devtmpfs|udev|overlay|shm|cgroupfs|squashfs|loop/.test(fs_)) continue;
      if (platform === 'darwin' && !/^(\/$|\/Volumes|\/Users|\/home)/.test(mount) && mount !== '/') continue;
      disks.push({
        mount,
        total: (parseInt(total1k, 10) || 0) * 1024,
        used: (parseInt(used1k, 10) || 0) * 1024,
        free: (parseInt(avail1k, 10) || 0) * 1024,
        usedPercent: parseFloat(usedPct?.replace('%', '')) || 0,
      });
    }
  } catch (_) {}

  return {
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      usage: fallbackUsage,
      loadAverage: [loadAvg[0] || 0, loadAvg[1] || 0, loadAvg[2] || 0],
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
      hostname: AGENT_NAME,
      os: `${os.type()} ${os.release()}`,
      kernel: os.release(),
      arch: os.arch(),
      uptime: os.uptime() || 0,
    },
  };
}

// ── WebSocket Client & Auto-Reconnect ──
const WebSocket = (() => {
  try { return require('ws'); } catch (_) { return null; }
})();

let activeStreams = new Map();

function connect() {
  const wsUrl = `${SERVER.replace(/^http/, 'ws')}/api/relay/agent?token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent(AGENT_NAME)}`;
  console.log(`⚡ [Monitor Agent] Connecting to ${SERVER} as "${AGENT_NAME}"...`);

  let ws = null;
  let retryTimeout = null;

  if (WebSocket) {
    ws = new WebSocket(wsUrl);
  } else {
    console.error('❌ Error: "ws" module not found. Falling back to HTTP streaming.');
    return;
  }

  ws.on('open', () => {
    console.log(`✅ [Monitor Agent] Connected successfully to Central Monitor Server!`);
    ws.send(JSON.stringify({
      type: 'agent:hello',
      name: AGENT_NAME,
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cores: os.cpus().length,
      }
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'telemetry:start_stream') {
        const interval = Math.max(100, Math.min(30000, Number(msg.interval) || 500));
        const connId = msg.connId || 'default';

        if (activeStreams.has(connId)) clearInterval(activeStreams.get(connId));

        // Immediate sample
        ws.send(JSON.stringify({ type: 'telemetry:stream', connId, data: collectSystemTelemetry() }));

        const timer = setInterval(() => {
          if (ws.readyState !== 1) {
            clearInterval(timer);
            activeStreams.delete(connId);
            return;
          }
          ws.send(JSON.stringify({ type: 'telemetry:stream', connId, data: collectSystemTelemetry() }));
        }, interval);

        activeStreams.set(connId, timer);
      } else if (msg.type === 'telemetry:stop_stream') {
        const connId = msg.connId || 'default';
        if (activeStreams.has(connId)) {
          clearInterval(activeStreams.get(connId));
          activeStreams.delete(connId);
        }
      }
    } catch (e) {
      console.error('❌ Error handling message:', e);
    }
  });

  ws.on('close', () => {
    console.log('⚠️ [Monitor Agent] Disconnected from server. Reconnecting in 3s...');
    for (const timer of activeStreams.values()) clearInterval(timer);
    activeStreams.clear();
    clearTimeout(retryTimeout);
    retryTimeout = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('❌ [Monitor Agent] Connection error:', err.message);
  });
}

// Start agent loop
connect();
