'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ChevronDown, ChevronUp, Copy, FileUp, BrickWallShield, Globe2, Info,
  Loader2, LockKeyhole, Plus, RefreshCw, ShieldAlert, ShieldCheck, Search,
  Upload, X, Power, RotateCcw, Trash2, Activity, Check, Zap,
  Terminal, Shield, Clock, Layers, SlidersHorizontal, ExternalLink, Sparkles,
  Workflow, FileSpreadsheet, Radio, Radar, Server, Cpu, CloudLightning, ArrowUpRight,
  HelpCircle, Play, Pause, Pin, Ban, FolderUp, TrendingUp, FastForward
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { io } from 'socket.io-client';
import AgentSetupWizard from '@/components/AgentSetupWizard';
import FirewallOnboarding, { hasCompletedFirewallOnboarding, resetFirewallOnboarding } from '@/components/FirewallOnboarding';

const acceptedTypes = '.ipset,.netset,.txt';
const supportedFile = (file) => /\.(ipset|netset|txt)$/i.test(file.name);
const matchesConfirmation = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === 'confirm' || v === 'apply' || v === 'yes' || v === 'ok' || v.startsWith('confirm');
};

const sourceScheduleOptions = [
  { value: '*/30 * * * *', label: 'Every 30 min', desc: 'Checks twice per hour' },
  { value: '0 * * * *', label: 'Every hour', desc: 'Checks at minute 0' },
  { value: '0 */6 * * *', label: 'Every 6 hours', desc: 'Checks 4x daily' },
  { value: '15 3 * * *', label: 'Daily at 03:15', desc: 'Low-traffic off-peak' },
  { value: 'custom', label: 'Custom Cron', desc: 'Define your cron syntax' },
];

const PRESET_SOURCES = [
  { name: 'AbuseIPDB S100 (Top Attackers)', url: 'https://raw.githubusercontent.com/borestad/blocklist-abuseipdb/main/abuseipdb-s100-1d.ipv4' },
  { name: 'FireHOL Level 1 (High Threat)', url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset' },
  { name: 'Emerging Threats Compromised', url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt' },
];

// Sparkline history is cached per server (sessionStorage) so previous attack
// activity survives switching apps or closing/reopening the firewall window.
// Manually quick-blocked IPs are remembered per server (localStorage) so the
// removable chip list survives app reloads — matching the server-side blocks.
const MANUAL_BLOCKS_PREFIX = 'firewall-manual-blocks-';

function loadManualBlocks(connectionId) {
  if (typeof window === 'undefined' || !connectionId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MANUAL_BLOCKS_PREFIX + connectionId) || '[]');
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveManualBlocks(connectionId, list) {
  if (typeof window === 'undefined' || !connectionId) return;
  try {
    localStorage.setItem(MANUAL_BLOCKS_PREFIX + connectionId, JSON.stringify(list.slice(-500)));
  } catch {
    // storage unavailable — chips just won't persist
  }
}

const TELEMETRY_CACHE_PREFIX = 'firewall-telemetry-history-';
const TELEMETRY_MAX_SAMPLES = 360; // ~1h of 10s samples — enough to pan back through past attacks

function loadCachedTelemetry(connectionId) {
  if (typeof window === 'undefined' || !connectionId) return [];
  try {
    const raw = window.sessionStorage.getItem(TELEMETRY_CACHE_PREFIX + connectionId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-TELEMETRY_MAX_SAMPLES) : [];
  } catch {
    return [];
  }
}

function cacheTelemetry(connectionId, history) {
  if (typeof window === 'undefined' || !connectionId) return;
  try {
    window.sessionStorage.setItem(TELEMETRY_CACHE_PREFIX + connectionId, JSON.stringify(history.slice(-TELEMETRY_MAX_SAMPLES)));
  } catch {
    // storage unavailable — keep telemetry in memory only
  }
}

async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean);

  if (!entries.length) return Array.from(dataTransfer?.files || []);

  const files = [];
  const visit = async (entry) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      files.push(file);
      return;
    }
    if (!entry.isDirectory) return;

    const reader = entry.createReader();
    const children = [];
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      children.push(...batch);
    } while (batch.length);
    await Promise.all(children.map(visit));
  };

  await Promise.all(entries.map(visit));
  return files;
}

function ServerSelect({ value, onChange, connections }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = connections.find(connection => String(connection._id || connection.id) === String(value));

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);

  const getLabel = (c) => c?.label || c?.name || (c?.username && c?.host ? `${c.username}@${c.host}` : c?.host) || 'SSH Server';

  return (
    <div ref={ref} className="relative w-full sm:w-64 z-50">
      <button
        type="button"
        onClick={() => connections.length && setOpen(prev => !prev)}
        disabled={!connections.length}
        className="w-full px-3.5 py-2 text-left text-xs rounded-xl bg-black/60 border border-white/15 text-white font-mono flex items-center justify-between gap-2 hover:border-indigo-500/80 hover:bg-black/80 transition-all shadow-md disabled:opacity-50 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="truncate font-semibold">{selected ? getLabel(selected) : (connections.length ? 'Select Server' : 'No servers')}</span>
        </div>
        <ChevronDown size={14} className={`text-white/50 transition-transform duration-200 shrink-0 ${open ? 'rotate-180 text-white' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[99999] mt-2 w-full min-w-[240px] overflow-hidden rounded-xl border border-indigo-500/40 bg-[#121722] shadow-[0_20px_50px_rgba(0,0,0,0.95)] divide-y divide-white/5 max-h-64 overflow-y-auto">
          <div className="px-3.5 py-1.5 text-[9px] font-mono uppercase tracking-wider text-white/40 bg-black/40 border-b border-white/5">
            Switch Target Server
          </div>
          {connections.map(connection => {
            const connId = String(connection._id || connection.id);
            const isSelected = connId === String(value);
            return (
              <button
                key={connId}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(connection._id || connection.id);
                  setOpen(false);
                }}
                className={`w-full px-3.5 py-2.5 text-left text-xs font-mono flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  isSelected ? 'bg-indigo-600/30 text-indigo-200 font-bold border-l-2 border-indigo-400' : 'bg-[#121722] hover:bg-white/10 text-white/80'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Server size={12} className={isSelected ? 'text-indigo-400' : 'text-white/40'} />
                  <span className="truncate">{getLabel(connection)}</span>
                </div>
                {isSelected && <Check size={13} className="text-indigo-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApplyProgress({ progress }) {
  if (!progress) return null;
  const isError = progress.type === 'error';
  const percentage = Math.max(2, Math.min(100, Number(progress.progress) || 2));
  const steps = [
    { at: 5, label: 'Connecting' },
    { at: 24, label: 'Building IPSet' },
    { at: 76, label: 'Atomic Swap' },
    { at: 88, label: 'Saving Recovery' },
  ];
  return (
    <div className={`mt-4 rounded-xl border p-3.5 font-mono ${isError ? 'border-rose-500/30 bg-rose-500/10' : 'border-indigo-500/30 bg-indigo-500/10'}`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={`font-semibold flex items-center gap-2 ${isError ? 'text-rose-200' : 'text-indigo-100'}`}>
          {!isError && <Loader2 size={13} className="animate-spin text-indigo-400" />}
          {isError ? 'Apply failed' : progress.message || 'Applying firewall update...'}
        </span>
        {!isError && <span className="font-bold text-cyan-300 tabular-nums">{percentage}%</span>}
      </div>
      {!isError && (
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-black/40 border border-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
        {steps.map(step => (
          <span key={step.at} className={`flex items-center gap-1.5 ${isError ? 'text-rose-300/60' : percentage >= step.at ? 'text-indigo-200 font-semibold' : 'text-white/30'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${!isError && percentage >= step.at ? 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]' : 'bg-white/20'}`} />
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

async function readApplyProgress(response, onProgress) {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const data = contentType.includes('application/json') ? await response.json() : {};
    throw new Error(data.error || 'Firewall update could not be started.');
  }
  if (!contentType.includes('application/x-ndjson') || !response.body) {
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Firewall update failed.');
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = null;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || 'Firewall update failed.');
    if (event.type === 'complete') complete = event;
    else if (event.type === 'progress') onProgress(event);
  };
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.forEach(consume);
    if (done) break;
  }
  consume(pending);
  if (!complete?.success) throw new Error(complete?.error || 'The server ended the update before confirmation.');
  return complete;
}

export default function FirewallBlocklistApp({ windowId } = {}) {
  const { state: appState, apiFetch } = useApp();
  const { state: osState, toggleMaximize, addNotification, showConfirm } = useOS();
  const { t } = useTranslation();
  const connections = (appState?.connections || []).filter(connection => connection.type !== 'database');
  const [connectionId, setConnectionId] = useState('');
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'schedule' | 'controls'
  const [showOnboarding, setShowOnboarding] = useState(false);

  const ensureMaximizedThenShow = useCallback(() => {
    const win = (osState?.windows || []).find(w => w.id === windowId);
    if (win && !win.isMaximized && typeof toggleMaximize === 'function') {
      toggleMaximize(windowId);
      setTimeout(() => setShowOnboarding(true), 350);
    } else {
      setShowOnboarding(true);
    }
  }, [osState, windowId, toggleMaximize]);

  const ensureMaximizedThenShowRef = useRef(ensureMaximizedThenShow);
  useEffect(() => { ensureMaximizedThenShowRef.current = ensureMaximizedThenShow; }, [ensureMaximizedThenShow]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasCompletedFirewallOnboarding()) {
        ensureMaximizedThenShowRef.current();
      }
    }, 450);
    return () => clearTimeout(timer);
  }, []);

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [entries, setEntries] = useState([]);
  const [bulkImportIds, setBulkImportIds] = useState([]);
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkEntryCount, setBulkEntryCount] = useState(0);
  const [ignored, setIgnored] = useState(0);
  const [conflicts, setConflicts] = useState([]);
  const [protectedIps, setProtectedIps] = useState([]);
  const [protectionDraft, setProtectionDraft] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [installConfirmation, setInstallConfirmation] = useState('');
  const [installing, setInstalling] = useState(false);
  const [detectedIps, setDetectedIps] = useState([]);
  const [detectingIp, setDetectingIp] = useState(false);
  const [manageAction, setManageAction] = useState('');
  const [manageConfirmation, setManageConfirmation] = useState('');
  const [managing, setManaging] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('https://raw.githubusercontent.com/borestad/blocklist-abuseipdb/main/abuseipdb-s100-1d.ipv4');
  const [sourceSchedule, setSourceSchedule] = useState('*/30 * * * *');
  const [sourceCustomSchedule, setSourceCustomSchedule] = useState('*/30 * * * *');
  const [sourceConfirmation, setSourceConfirmation] = useState('');
  const [sourceStatus, setSourceStatus] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const telemetryHistoryRef = useRef([]);
  const [graphMode, setGraphMode] = useState('packets'); // 'packets' | 'bandwidth'
  // Interactive graph state — pannable history with hover time-scrub
  const [graphHover, setGraphHover] = useState(null); // { idx } → live preview while the mouse moves
  const [graphPinned, setGraphPinned] = useState(null); // { idx } → click-pinned time filter (stays until cleared)
  const [graphLive, setGraphLive] = useState(true);   // auto-follow the newest samples while scrolled to the right edge
  const graphScrollRef = useRef(null);
  const graphDragRef = useRef(null);
  const graphDragMovedRef = useRef(false); // distinguishes a click (pin) from a drag (pan)
  // Realtime agent stream — replaces 10s HTTP polling while a monitor agent is connected
  const [realtimeActive, setRealtimeActive] = useState(false);
  const realtimeActiveRef = useRef(false);
  useEffect(() => { realtimeActiveRef.current = realtimeActive; }, [realtimeActive]);
  // Last-resort safety net: armed on apply, disarmed by the first successful
  // status poll (the watchdog auto-reverts the firewall server-side otherwise)
  const safetyArmRef = useRef(false);
  // Server agent management — install wizard + per-server install status
  const [showAgentWizard, setShowAgentWizard] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null); // { isRunning, nodeInstalled }
  const [agentTick, setAgentTick] = useState(0); // bump to re-check status / re-request stream
  const [ipCheckInput, setIpCheckInput] = useState('');
  
  // Threat Packet Inspector & Sniffer state
  const [packets, setPackets] = useState([]);
  const [packetsLoading, setPacketsLoading] = useState(false);
  const [sniffingActive, setSniffingActive] = useState(false);
  const [packetFilter, setPacketFilter] = useState('all');
  const [packetSearch, setPacketSearch] = useState('');
  const [selectedPacket, setSelectedPacket] = useState(null);
  const [payloadExpanded, setPayloadExpanded] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [uploadSpeed, setUploadSpeed] = useState('');
  // Read actual SSH mode from localStorage — same key all other apps use
  const isLocalRelayMode = typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local';

  const inputRef = useRef(null);
  const folderInputRef = useRef(null);
  const entryCount = bulkBatchId ? bulkEntryCount : entries.length;

  useEffect(() => {
    if (!connectionId && connections.length) {
      setConnectionId(connections[0]._id || connections[0].id);
    }
  }, [connectionId, connections]);

  // Seed the sparkline with previous attack activity. History recorded by the
  // ServerMonitor agent (24/7 background sampler) is preferred — it survives
  // closed apps and different devices. Falls back to the session cache.
  useEffect(() => {
    // Drop the previous server's samples immediately so counters never mix
    telemetryHistoryRef.current = [];
    setTelemetryHistory([]);
    setPackets([]);
    setGraphHover(null);
    setGraphPinned(null);
    setGraphLive(true);
    setManualBlocks(loadManualBlocks(connectionId));
    if (!connectionId) return undefined;

    let cancelled = false;
    const applyHistory = (restored) => {
      if (cancelled || restored.length === 0) return;
      // Keep any live samples appended while the fetch was in flight
      const lastRestoredT = restored[restored.length - 1].time;
      const merged = [...restored, ...telemetryHistoryRef.current.filter(s => s.time > lastRestoredT)].slice(-TELEMETRY_MAX_SAMPLES);
      telemetryHistoryRef.current = merged;
      setTelemetryHistory(merged);
    };

    (async () => {
      try {
        const response = await apiFetch(`/api/firewall/history?connectionId=${encodeURIComponent(connectionId)}&limit=${TELEMETRY_MAX_SAMPLES}`, { cache: 'no-store' });
        const data = await response.json();
        if (data?.success && Array.isArray(data.samples) && data.samples.length > 0) {
          applyHistory(data.samples.map((s, i, arr) => {
            const prev = arr[i - 1];
            const dt = prev ? Math.max(1, (s.t - prev.t) / 1000) : 10;
            return {
              time: s.t,
              packets: s.packets,
              bytes: s.bytes,
              pktRate: prev ? Math.max(0, (s.packets - prev.packets) / dt) : 0,
              byteRate: prev ? Math.max(0, (s.bytes - prev.bytes) / dt) : 0,
            };
          }));
          return;
        }
      } catch { /* fall back to session cache below */ }
      applyHistory(loadCachedTelemetry(connectionId));
    })();

    return () => { cancelled = true; };
  }, [connectionId, apiFetch]);

  const loadPackets = useCallback(async () => {
    if (!connectionId) return;
    setPacketsLoading(true);
    try {
      const response = await apiFetch(`/api/firewall/packets?connectionId=${encodeURIComponent(connectionId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      // Accumulate threat events with a sortable capture time so the graph
      // hover can filter the table by time window. Re-records each attacker
      // at most once per 30s bucket; older entries are kept (capped).
      const capturedMs = Date.parse(data.capturedAt) || Date.now();
      const bucket = Math.floor(capturedMs / 30000);
      setPackets(prev => {
        const seen = new Set(prev.map(p => p.id));
        const fresh = (data.packets || [])
          .map((p, i) => ({
            ...p,
            _ms: capturedMs,
            // Display the REAL capture time — the API's cosmetic `timestamp`
            // (now − idx×32s) drifted minutes away from the ±15s pin window.
            timestamp: new Date(capturedMs - i * 1000).toLocaleTimeString(),
            id: `${p.id}-${bucket}`,
          }))
          .filter(p => !seen.has(p.id));
        return fresh.length ? [...prev, ...fresh].slice(-600) : prev;
      });
    } catch (error) {
      // silent fallback
    } finally {
      setPacketsLoading(false);
    }
  }, [apiFetch, connectionId]);

  useEffect(() => {
    if (activeTab === 'controls') {
      loadPackets();
    }
  }, [activeTab, loadPackets]);

  useEffect(() => {
    if (!sniffingActive || activeTab !== 'controls') return undefined;
    const timer = window.setInterval(loadPackets, 3000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadPackets, sniffingActive]);

  // ── Interactive graph: drag/wheel panning with live-follow (same feel as ServerMonitor charts) ──
  useEffect(() => {
    if (graphLive && graphScrollRef.current) {
      graphScrollRef.current.scrollLeft = graphScrollRef.current.scrollWidth;
    }
  }, [telemetryHistory, graphLive]);

  const handleGraphScroll = useCallback(() => {
    const el = graphScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setGraphLive(maxScroll <= 0 || maxScroll - el.scrollLeft < 20);
  }, []);

  const handleGraphMouseDown = (e) => {
    if (e.target.closest('button')) return;
    graphDragMovedRef.current = false;
    graphDragRef.current = { x: e.pageX, left: graphScrollRef.current?.scrollLeft || 0 };
  };
  const handleGraphDragMove = (e) => {
    const drag = graphDragRef.current;
    if (!drag || !graphScrollRef.current) return;
    if (Math.abs(e.pageX - drag.x) > 4) graphDragMovedRef.current = true;
    graphScrollRef.current.scrollLeft = drag.left - (e.pageX - drag.x) * 1.5;
  };
  const endGraphDrag = () => { graphDragRef.current = null; };
  const handleGraphWheel = (e) => {
    if (!graphScrollRef.current || Math.abs(e.deltaX) > 0 || !e.deltaY) return;
    graphScrollRef.current.scrollLeft += e.deltaY;
  };
  const jumpGraphLive = () => {
    setGraphLive(true);
    requestAnimationFrame(() => {
      if (graphScrollRef.current) graphScrollRef.current.scrollLeft = graphScrollRef.current.scrollWidth;
    });
  };

  const loadStatus = useCallback(async () => {
    if (!connectionId) return;
    setStatusLoading(true);
    try {
      const response = await apiFetch(`/api/firewall/status?connectionId=${encodeURIComponent(connectionId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setStatus(data);

      // Disarm the last-resort watchdog — this poll proves the app still has access
      if (safetyArmRef.current) {
        safetyArmRef.current = false;
        apiFetch('/api/firewall/recover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, action: 'confirm' }),
        }).catch(() => {});
      }

      if (data.blocklist?.active && !realtimeActiveRef.current) {
        const packets = Number(data.blocklist.blockedPackets) || 0;
        const bytes = Number(data.blocklist.blockedBytes) || 0;
        const now = Date.now();
        const prev = telemetryHistoryRef.current;
        const last = prev[prev.length - 1];
        const timeDelta = last ? Math.max(1, (now - last.time) / 1000) : 10;
        const pktRate = last ? Math.max(0, (packets - last.packets) / timeDelta) : 0;
        const byteRate = last ? Math.max(0, (bytes - last.bytes) / timeDelta) : 0;
        const next = [...prev, { time: now, packets, bytes, pktRate, byteRate }].slice(-TELEMETRY_MAX_SAMPLES);
        telemetryHistoryRef.current = next;
        setTelemetryHistory(next);
        cacheTelemetry(connectionId, next);
      }
    } catch (error) {
      setStatus(null);
      addNotification({ title: 'Firewall status', message: error.message || 'Could not inspect this server.', type: 'error' });
    } finally {
      setStatusLoading(false);
    }
  }, [addNotification, apiFetch, connectionId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Last resort: instant rollback straight from the header
  const emergencyDisable = useCallback(() => {
    if (!connectionId) return;
    showConfirm(
      'Emergency disable the firewall on this server? All blocklist rules, the blocklist set, and the restore service will be removed immediately.',
      () => {
        apiFetch('/api/firewall/recover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, action: 'rollback' }),
        })
          .then(res => res.json())
          .then(data => {
            addNotification({
              title: data?.success ? 'Emergency rollback complete' : 'Rollback failed',
              message: data?.message || data?.error || 'Unknown result.',
              type: data?.success ? 'warning' : 'error',
            });
            loadStatus();
          })
          .catch(err => addNotification({ title: 'Rollback failed', message: err.message, type: 'error' }));
      },
      'Emergency Disable',
      'Disable Firewall'
    );
  }, [apiFetch, connectionId, addNotification, loadStatus, showConfirm]);

  // Server agent install status (SSH process check) — shown in the telemetry tab
  const loadAgentStatus = useCallback(async () => {
    if (!connectionId) { setAgentStatus(null); return; }
    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, action: 'status' }),
      });
      const data = await res.json();
      setAgentStatus(data?.success ? { isRunning: !!data.isRunning, nodeInstalled: !!data.nodeInstalled } : null);
    } catch {
      setAgentStatus(null);
    }
  }, [apiFetch, connectionId]);

  useEffect(() => {
    if (activeTab === 'controls') loadAgentStatus();
  }, [activeTab, loadAgentStatus, agentTick]);

  // Realtime telemetry via the monitor agent stream (same channel ServerMonitor uses).
  // While an agent is connected for this server, firewall counters stream every
  // second; without an agent the 10s HTTP status polling above remains active.
  useEffect(() => {
    if (activeTab !== 'controls' || !connectionId || !status?.blocklist?.active) return undefined;
    const conn = connections.find(c => String(c._id || c.id) === String(connectionId));
    const socket = io({ path: '/api/socket', transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('telemetry:start_stream', {
        interval: 1000,
        connectionId,
        targetHost: conn?.host || '',
        targetLabel: conn?.label || '',
      });
    });

    socket.on('telemetry:stream', (raw) => {
      const fw = raw?.firewall;
      if (!fw?.active) return;
      if (!realtimeActiveRef.current) {
        realtimeActiveRef.current = true;
        setRealtimeActive(true);
      }
      const packets = Number(fw.packets) || 0;
      const bytes = Number(fw.bytes) || 0;
      const now = Date.now();
      const prev = telemetryHistoryRef.current;
      const last = prev[prev.length - 1];
      const timeDelta = last ? Math.max(0.5, (now - last.time) / 1000) : 10;
      const pktRate = last ? Math.max(0, (packets - last.packets) / timeDelta) : 0;
      const byteRate = last ? Math.max(0, (bytes - last.bytes) / timeDelta) : 0;
      const next = [...prev, { time: now, packets, bytes, pktRate, byteRate }].slice(-TELEMETRY_MAX_SAMPLES);
      telemetryHistoryRef.current = next;
      setTelemetryHistory(next);
      cacheTelemetry(connectionId, next);
    });

    socket.on('disconnect', () => {
      realtimeActiveRef.current = false;
      setRealtimeActive(false);
    });
    socket.on('telemetry:no_agent', () => {
      realtimeActiveRef.current = false;
      setRealtimeActive(false);
    });

    return () => {
      try { socket.emit('telemetry:stop_stream'); socket.disconnect(); } catch (_) {}
      realtimeActiveRef.current = false;
      setRealtimeActive(false);
    };
  }, [activeTab, connectionId, status?.blocklist?.active, connections, agentTick]);

  useEffect(() => {
    if (!connectionId || !status?.blocklist?.active) return undefined;
    const timer = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(timer);
  }, [connectionId, loadStatus, status?.blocklist?.active]);

  const loadSourceStatus = useCallback(async () => {
    if (!connectionId) return;
    try {
      const response = await apiFetch(`/api/firewall/source?connectionId=${encodeURIComponent(connectionId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setSourceStatus(data);
    } catch (error) {
      setSourceStatus(prev => prev ? { ...prev, log: `Unable to read source update log: ${error.message}` } : null);
    }
  }, [apiFetch, connectionId]);

  useEffect(() => { loadSourceStatus(); }, [loadSourceStatus]);

  useEffect(() => {
    if (!connectionId || !sourceStatus?.running) return undefined;
    const timer = window.setInterval(loadSourceStatus, 2000);
    return () => window.clearInterval(timer);
  }, [connectionId, loadSourceStatus, sourceStatus?.running]);

  const vpnAlertShownRef = useRef(false);
  const loadCurrentIp = useCallback(async (showError = false) => {
    setDetectingIp(true);
    try {
      const response = await apiFetch('/api/firewall/client-ip');
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      let ips = data.ips || [];
      if (!ips.length) {
        // Header-based detection fails on direct (non-proxied) connections —
        // fall back to a public IP echo so the whitelist still gets an entry
        try {
          const echo = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
          const echoData = await echo.json();
          if (echoData?.ip && /^\d+\.\d+\.\d+\.\d+$/.test(echoData.ip)) ips = [echoData.ip];
        } catch { /* stay undetected */ }
      }
      setDetectedIps(ips);
      if (ips.length) setProtectedIps(prev => [...new Set([...prev, ...ips])]);
      else if (showError) addNotification({ title: 'Current IP not detected', message: data.message || 'Add your SSH or VPN public IP manually.', type: 'warning' });

      // VPN / datacenter egress detected — alert only, never block
      const vpnEntry = (data.ipInfo || []).find(info => info?.vpn && ips.includes(info.ip));
      if (vpnEntry && !vpnAlertShownRef.current) {
        vpnAlertShownRef.current = true;
        addNotification({
          title: 'VPN detected',
          message: `You are connecting through a VPN/datacenter IP (${vpnEntry.ip}${vpnEntry.isp ? ` — ${vpnEntry.isp}` : ''}). It has been whitelisted, but VPN IPs change and are shared with others — consider adding your real home/office IP too so you never lose access.`,
          type: 'warning',
        });
      }
    } catch (error) {
      if (showError) addNotification({ title: 'Current IP not detected', message: error.message || 'Add your SSH or VPN public IP manually.', type: 'warning' });
    } finally {
      setDetectingIp(false);
    }
  }, [addNotification, apiFetch]);

  useEffect(() => { loadCurrentIp(); }, [loadCurrentIp]);

  const previewContent = async (content, name = '', protection = protectedIps) => {
    if (!content.trim()) return;
    setPreviewing(true);
    try {
      const response = await apiFetch('/api/firewall/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, protectedIps: protection }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setRawContent(content);
      setSourceName(name || 'Pasted list');
      setEntries(data.entries);
      setBulkImportIds([]);
      setBulkBatchId('');
      setBulkEntryCount(0);
      setIgnored(data.ignored);
      setConflicts(data.conflicts || []);
      setProtectedIps(prev => [...new Set([...prev, ...(data.protectedIps || [])])]);
      setConfirmation('');
    } catch (error) {
      addNotification({ title: 'Import rejected', message: error.message || 'Could not validate that file.', type: 'error' });
    } finally {
      setPreviewing(false);
    }
  };

  const prepareBulkBatch = async (importIds, protection = protectedIps) => {
    const response = await apiFetch('/api/firewall/bulk/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importIds, protectedIps: protection }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    setBulkBatchId(data.batchId);
    setBulkEntryCount(data.entryCount);
    setEntries([]);
    setConflicts(data.conflicts || []);
    setProtectedIps(prev => [...new Set([...prev, ...(data.protectedIps || [])])]);
    setConfirmation('');
  };

  const readFiles = async (fileList) => {
    const allFiles = Array.from(fileList || []).filter(Boolean);
    const files = allFiles.filter(supportedFile);
    if (!files.length) {
      if (allFiles.length) addNotification({ title: 'No blocklists found', message: 'Only .ipset, .netset, and .txt files are imported.', type: 'info' });
      return;
    }
    try {
      const name = files.length === 1 ? files[0].name : `${files.length} blocklist files`;
      setPreviewing(true);
      const importIds = [];
      for (const file of files) {
        const response = await apiFetch('/api/firewall/bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Upload-Filename': encodeURIComponent(file.name),
          },
          body: file,
        });
        const data = await response.json();
        if (!data.success) throw new Error(`${file.name}: ${data.error}`);
        importIds.push(data.id);
      }
      setBulkImportIds(importIds);
      setRawContent('');
      setSourceName(name);
      setIgnored(0);
      await prepareBulkBatch(importIds);
    } catch (error) {
      addNotification({ title: 'Import failed', message: error.message || 'Could not read the selected files.', type: 'error' });
    } finally {
      setPreviewing(false);
    }
  };

  // Live-sync the whitelist to the server's allowlist whenever the firewall
  // is active — adding/removing an IP takes effect immediately.
  const syncAllowlist = useCallback((ips) => {
    if (!connectionId || !status?.blocklist?.active) return;
    apiFetch('/api/firewall/allowlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, ips }),
    })
      .then(res => res.json())
      .then(data => {
        if (data?.success) {
          loadStatus(); // refresh the "Enforced on server" badge
          addNotification({ title: 'Whitelist synced', message: data.message, type: 'success' });
        } else if (data?.error) {
          addNotification({ title: 'Whitelist sync failed', message: data.error, type: 'error' });
        }
      })
      .catch(() => {});
  }, [apiFetch, connectionId, status?.blocklist?.active, loadStatus, addNotification]);

  // ── Live blocklist edits — add/remove specific IPs without a file import ──
  const [blockDraft, setBlockDraft] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [blockCheck, setBlockCheck] = useState(null); // { ip, blocked } | null
  const [manualBlocks, setManualBlocks] = useState([]); // removable chips of quick-blocked IPs

  const checkBlockedIp = useCallback(async () => {
    const ip = blockDraft.split(/[\n,;]+/)[0]?.trim();
    if (!connectionId || !ip) return;
    setBlocking(true);
    setBlockCheck(null);
    try {
      const response = await apiFetch(`/api/firewall/blocklist?connectionId=${encodeURIComponent(connectionId)}&ip=${encodeURIComponent(ip)}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setBlockCheck({ ip, blocked: data.blocked, active: data.active });
    } catch (error) {
      addNotification({ title: 'Lookup failed', message: error.message || 'Could not check the blocklist.', type: 'error' });
    } finally {
      setBlocking(false);
    }
  }, [apiFetch, connectionId, blockDraft, addNotification]);

  const quickBlock = useCallback(async (mode, rawEntries) => {
    // Accepts a string (input box, comma/new-line separated) or an array (chip ✕, threat Ban)
    const entries = (Array.isArray(rawEntries) ? rawEntries : (rawEntries || blockDraft).split(/[\n,;]+/))
      .map(v => String(v).trim())
      .filter(Boolean);
    if (!connectionId || !entries.length) return;
    setBlocking(true);
    try {
      const response = await apiFetch('/api/firewall/blocklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, mode, entries, protectedIps }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setBlockDraft('');
      setManualBlocks(prev => {
        const next = mode === 'add'
          ? [...new Set([...prev, ...entries])]
          : prev.filter(v => !entries.includes(v));
        saveManualBlocks(connectionId, next);
        return next;
      });
      addNotification({ title: mode === 'add' ? 'IP blocked' : 'IP unblocked', message: data.message, type: 'success' });
      loadStatus();
    } catch (error) {
      addNotification({ title: 'Blocklist not changed', message: error.message || 'Could not update the blocklist.', type: 'error' });
    } finally {
      setBlocking(false);
    }
  }, [apiFetch, connectionId, blockDraft, protectedIps, addNotification, loadStatus]);

  const addProtectedIp = () => {
    const value = protectionDraft.trim();
    if (!value) return;
    setProtectedIps(prev => prev.includes(value) ? prev : [...prev, value]);
    setProtectionDraft('');
    if (bulkImportIds.length) prepareBulkBatch(bulkImportIds, [...protectedIps, value]).catch(err => addNotification({ title: 'Preflight failed', message: err.message, type: 'error' }));
    else if (rawContent) previewContent(rawContent, sourceName);
    syncAllowlist([...new Set([...protectedIps, value])]);
  };

  const removeProtectedIp = (ip) => {
    setProtectedIps(prev => prev.filter(v => v !== ip));
    const next = protectedIps.filter(v => v !== ip);
    if (bulkImportIds.length) {
      prepareBulkBatch(bulkImportIds, next).catch(err => addNotification({ title: 'Preflight failed', message: err.message, type: 'error' }));
    } else if (rawContent) {
      setTimeout(() => previewContent(rawContent, sourceName, next), 0);
    }
    syncAllowlist(next);
  };

  const applyBlocklist = async () => {
    if (!connectionId || !entryCount || conflicts.length || !matchesConfirmation(confirmation)) return;
    setApplying(true);
    setInspection(null);
    setApplyProgress({ type: 'progress', progress: 2, message: 'Validating request...' });
    try {
      const response = await apiFetch(bulkBatchId ? '/api/firewall/bulk/apply' : '/api/firewall/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(bulkBatchId
          ? { connectionId, batchId: bulkBatchId, confirmation, manualBlocks }
          : { connectionId, entries, protectedIps, confirmation, manualBlocks }),
      });
      const data = await readApplyProgress(response, event => setApplyProgress(event));
      if (!data.success) {
        if (data.conflicts) setConflicts(data.conflicts);
        throw new Error(data.error);
      }
      setApplyProgress({ type: 'complete', progress: 100, message: 'Firewall protection is live' });
      addNotification({ title: 'Blocklist applied', message: `${data.entries.toLocaleString()} entries are active. Safety net armed — the firewall reverts itself in 15 min if this app loses access to the server.`, type: 'success' });
      setConfirmation('');
      safetyArmRef.current = true; // first successful status poll disarms it
      await loadStatus();
    } catch (error) {
      setApplyProgress({ type: 'error', message: error.message || 'The server rejected this update.' });
      addNotification({ title: 'Firewall not changed', message: error.message || 'The server rejected this update.', type: 'error' });
    } finally {
      setApplying(false);
      window.setTimeout(() => setApplyProgress(null), 1800);
    }
  };

  const installTools = async () => {
    if (!connectionId || installing) return;
    setInstalling(true);
    try {
      const response = await apiFetch('/api/firewall/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // "1-Click" banner — installs standard ipset/iptables packages only,
        // so the typed confirmation is implicit here
        body: JSON.stringify({ connectionId, confirmation: 'confirm' }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setInstallConfirmation('');
      addNotification({ title: 'Firewall tools ready', message: data.alreadyReady ? 'IPSet and iptables were already available.' : 'Installed IPSet and iptables on server.', type: 'success' });
      await loadStatus();
    } catch (error) {
      addNotification({ title: 'Installation failed', message: error.message || 'Could not install firewall tools.', type: 'error' });
    } finally {
      setInstalling(false);
    }
  };

  const manageBlocklist = async () => {
    if (!connectionId || managing || !manageAction) return;
    if (!matchesConfirmation(manageConfirmation)) {
      addNotification({ title: 'Confirmation required', message: 'Type "confirm" in the confirmation box to authorize this blocklist action.', type: 'warning' });
      return;
    }
    setManaging(true);
    setInspection(null);
    try {
      const response = await apiFetch('/api/firewall/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, action: manageAction, confirmation: manageConfirmation, protectedIps }),
      });
      const data = await response.json();
      if (!data.success) {
        if (data.conflicts) setConflicts(data.conflicts);
        throw new Error(data.error);
      }
      addNotification({ title: `Blocklist ${manageAction}d`, message: data.message, type: 'success' });
      setManageAction('');
      setManageConfirmation('');
      await loadStatus();
    } catch (error) {
      addNotification({ title: 'Firewall not changed', message: error.message || 'Action was rejected.', type: 'error' });
    } finally {
      setManaging(false);
    }
  };

  const configureSourceUpdate = async (runNow = false) => {
    if (!connectionId || !matchesConfirmation(sourceConfirmation)) return;
    setSourceLoading(true);
    try {
      const response = await apiFetch('/api/firewall/source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, sourceUrl, protectedIps, manualBlocks, schedule: sourceSchedule === 'custom' ? sourceCustomSchedule : sourceSchedule, confirmation: sourceConfirmation, runNow }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      addNotification({ title: 'Schedule saved', message: data.message, type: 'success' });
      setSourceConfirmation('');
      await loadSourceStatus();
      await loadStatus();
    } catch (error) {
      addNotification({ title: 'Update failed', message: error.message || 'Could not configure automated update.', type: 'error' });
    } finally {
      setSourceLoading(false);
    }
  };

  const removeSourceUpdate = async () => {
    if (!connectionId) return;
    setSourceLoading(true);
    try {
      const response = await apiFetch('/api/firewall/source', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      addNotification({ title: 'Schedule removed', message: data.message, type: 'success' });
      await loadSourceStatus();
    } catch (error) {
      addNotification({ title: 'Could not remove schedule', message: error.message, type: 'error' });
    } finally {
      setSourceLoading(false);
    }
  };

  const inspectBlocklist = async () => {
    if (!connectionId) return;
    setInspectionLoading(true);
    try {
      const response = await apiFetch(`/api/firewall/inspect?connectionId=${encodeURIComponent(connectionId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setInspection(data);
      await loadStatus();
    } catch (error) {
      addNotification({ title: 'Inspection unavailable', message: error.message || 'Could not inspect server.', type: 'error' });
    } finally {
      setInspectionLoading(false);
    }
  };

  const canApply = Boolean(connectionId && entryCount && !conflicts.length && matchesConfirmation(confirmation) && status?.tools?.ipset && status?.tools?.iptables && status?.access !== 'limited');

  return (
    <div className="h-full overflow-y-auto bg-[var(--fw-app-bg,#0a0d14)] text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        
        {/* ==================================================================== */}
        {/* Top Header & Telemetry Hero Card */}
        {/* ==================================================================== */}
        <header className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 [backdrop-filter:blur(var(--glass-blur,24px))] shadow-2xl z-20">
          {/* Ambient glow container */}
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-600/15 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-cyan-600/10 rounded-full blur-3xl" />
          </div>

          <div className="relative z-30 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-indigo-500/15 border border-indigo-400/25 text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.25)]">
                <BrickWallShield size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-white">{t('firewall.title')}</h1>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    {t('firewall.engineBadge')}
                  </span>
                  <span
                    data-onboarding="firewall-docker-badge"
                    className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)] hidden sm:inline-flex items-center gap-1"
                  >
                    🐋 {t('firewall.dockerProtectedBadge')}
                  </span>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {t('firewall.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 relative z-40">
              <div data-onboarding="firewall-server-select">
                <ServerSelect value={connectionId} onChange={id => { setConnectionId(id); setInspection(null); }} connections={connections} />
              </div>
              <button
                type="button"
                onClick={() => { loadStatus(); loadSourceStatus(); }}
                disabled={!connectionId || statusLoading}
                className="p-2.5 rounded-xl border border-white/10 bg-black/40 hover:bg-white/5 hover:border-indigo-400/50 text-white/70 hover:text-white transition-all disabled:opacity-40 cursor-pointer"
                title={t('firewall.refreshStatus')}
              >
                <RefreshCw size={15} className={statusLoading ? 'animate-spin text-indigo-400' : ''} />
              </button>

              <button
                type="button"
                onClick={emergencyDisable}
                disabled={!connectionId || !status?.blocklist?.active}
                data-onboarding="firewall-last-resort"
                className="p-2.5 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 hover:border-rose-400/60 text-rose-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Last resort — instantly remove all firewall rules on this server"
              >
                <Power size={15} />
              </button>

              <button
                type="button"
                onClick={() => { resetFirewallOnboarding(); ensureMaximizedThenShow(); }}
                className="p-2.5 px-3 rounded-xl border border-white/10 bg-black/40 hover:bg-white/5 hover:border-indigo-400/50 text-white/70 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                title={t('firewall.guideBtn')}
              >
                <HelpCircle size={14} className="text-indigo-400" />
                <span className="hidden sm:inline">{t('firewall.guideBtn')}</span>
              </button>
            </div>
          </div>

          {/* Real-Time Telemetry Bar */}
          {status && (
            <div className="relative z-10 mt-5 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('firewall.telemetryLabels.firewallStatus')}</span>
                <span className={`text-[11px] font-bold flex items-center gap-1.5 ${
                  status.blocklist?.active ? 'text-emerald-400' : status.blocklist?.exists ? 'text-amber-400' : 'text-white/40'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${status.blocklist?.active ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-amber-400'}`} />
                  {status.blocklist?.active ? `${(status.blocklist.entries || 0).toLocaleString()} ${t('firewall.telemetryLabels.activeRules')}` : status.blocklist?.exists ? t('firewall.telemetryLabels.disabled') : t('firewall.telemetryLabels.noRules')}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('firewall.telemetryLabels.kernelTools')}</span>
                <span className={`text-[11px] font-bold ${status.tools?.ipset && status.tools?.iptables ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {status.tools?.ipset && status.tools?.iptables ? t('firewall.telemetryLabels.toolsOk') : t('firewall.telemetryLabels.missingTools')}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('firewall.telemetryLabels.privileges')}</span>
                <span className={`text-[11px] font-bold ${status.access === 'root' || status.access === 'sudo' ? 'text-cyan-400' : 'text-rose-400'}`}>
                  {status.access === 'root' ? 'root' : status.access === 'sudo' ? 'sudo' : 'limited'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('firewall.telemetryLabels.autoSync')}</span>
                <span className={`text-[11px] font-bold ${sourceStatus?.installed ? 'text-indigo-300' : 'text-white/40'}`}>
                  {sourceStatus?.installed ? (sourceStatus.schedule || 'Scheduled') : 'Not Set'}
                </span>
              </div>
            </div>
          )}
        </header>

        {/* Missing Tools Callout */}
        {status && (!status.tools?.ipset || !status.tools?.iptables) && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-amber-500/15 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle size={20} className="text-amber-400 shrink-0" />
              <div>
                <h2 className="text-xs font-bold text-amber-200 uppercase tracking-wider">Kernel Tools Required</h2>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  Install <code className="text-amber-100 font-mono">ipset</code> and <code className="text-amber-100 font-mono">iptables</code> on this server.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={installTools}
                disabled={installing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] disabled:opacity-50 cursor-pointer"
              >
                {installing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {installing ? 'Installing...' : '1-Click Install Tools'}
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* Navigation Tabs with High-Grade Pro Icons */}
        {/* ==================================================================== */}
        <div className="flex items-center gap-2.5 border-b border-white/10 pb-3.5 overflow-x-auto">
          {[
            { id: 'manual', onboardingId: 'firewall-tab-manual', label: t('firewall.tabs.manualImport'), desc: 'File or raw IPs', icon: Layers, color: 'text-indigo-400' },
            { id: 'schedule', onboardingId: 'firewall-tab-autosync', label: t('firewall.tabs.autoSync'), desc: 'Auto-fetch from URL', icon: Workflow, color: 'text-cyan-400' },
            { id: 'controls', onboardingId: 'firewall-tab-telemetry', label: t('firewall.tabs.telemetry'), desc: 'Realtime filter monitor', icon: Radar, color: 'text-emerald-400' },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-onboarding={tab.onboardingId}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 rounded-xl font-medium text-xs transition-all flex items-center gap-2.5 shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600/30 to-violet-600/20 border border-indigo-500/60 text-white shadow-[0_0_18px_rgba(99,102,241,0.3)] font-semibold'
                    : 'bg-white/[0.02] border border-white/5 text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={15} className={isActive ? tab.color : 'text-white/40'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ==================================================================== */}
        {/* TAB 1: Automated Sync (Scheduled URL Updates) */}
        {/* ==================================================================== */}
        {activeTab === 'schedule' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-5 sm:p-6 space-y-5">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Workflow size={16} className="text-cyan-400" />
                  Automated Threat Feed Sync
                </h2>
                <p className="text-xs text-white/50 mt-1">
                  The target server downloads the HTTPS blocklist, verifies it, protects your SSH connection, and atomically updates the IPSet on your schedule.
                </p>
              </div>

              {/* Source URL & Presets */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-white/60 block">Blocklist Source URL</label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  spellCheck="false"
                  placeholder="https://..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-cyan-200 outline-none focus:border-cyan-400 transition-all"
                />
                
                {/* Preset Chips */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-white/40 uppercase font-mono mr-1">Presets:</span>
                  {PRESET_SOURCES.map(preset => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => setSourceUrl(preset.url)}
                      className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                        sourceUrl === preset.url
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                          : 'bg-white/5 border-white/5 text-white/50 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule Frequency Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-white/60 block">Sync Frequency</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {sourceScheduleOptions.map(opt => {
                    const isSelected = sourceSchedule === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSourceSchedule(opt.value)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-b from-indigo-500/25 to-indigo-600/10 border-indigo-500/60 shadow-[0_0_15px_rgba(99,102,241,0.25)]'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/5 text-white/60'
                        }`}
                      >
                        <div className={`text-xs font-bold ${isSelected ? 'text-indigo-200' : 'text-white/80'}`}>{opt.label}</div>
                        <div className="text-[10px] text-white/40 mt-0.5">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>

                {sourceSchedule === 'custom' && (
                  <div className="pt-2">
                    <input
                      type="text"
                      value={sourceCustomSchedule}
                      onChange={e => setSourceCustomSchedule(e.target.value)}
                      spellCheck="false"
                      placeholder="*/30 * * * *"
                      className="w-full sm:w-64 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-amber-200 outline-none focus:border-amber-400"
                    />
                    <p className="text-[10px] text-white/40 mt-1">5-part cron syntax in server local time.</p>
                  </div>
                )}
              </div>

              {/* Action Toolbar */}
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="text"
                      value={sourceConfirmation}
                      onChange={e => setSourceConfirmation(e.target.value)}
                      placeholder="Type confirm"
                      className="w-36 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={() => setSourceConfirmation('confirm')}
                      className="px-2 py-1 rounded-lg text-[10px] font-mono bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 border border-white/5 cursor-pointer"
                    >
                      Fill &quot;confirm&quot;
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => configureSourceUpdate(false)}
                      disabled={sourceLoading || !matchesConfirmation(sourceConfirmation) || (sourceSchedule === 'custom' && !sourceCustomSchedule.trim())}
                      className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(99,102,241,0.3)] disabled:opacity-40 cursor-pointer"
                    >
                      {sourceLoading ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
                      Save Schedule
                    </button>

                    <button
                      type="button"
                      onClick={() => configureSourceUpdate(true)}
                      disabled={sourceLoading || !matchesConfirmation(sourceConfirmation) || (sourceSchedule === 'custom' && !sourceCustomSchedule.trim())}
                      className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-40 cursor-pointer"
                    >
                      {sourceLoading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                      Run Update Now
                    </button>

                    {sourceStatus?.installed && (
                      <button
                        type="button"
                        onClick={removeSourceUpdate}
                        disabled={sourceLoading}
                        className="p-2 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-500/15 transition-all cursor-pointer"
                        title="Remove automated schedule"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {sourceStatus?.installed && (
                  <div className="text-[11px] font-mono text-emerald-300 flex items-center gap-2 pt-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                    Schedule active: <span className="text-white font-bold">{sourceStatus.schedule || 'Active'}</span>
                    {sourceStatus.running && <span className="text-cyan-300 ml-2">(Update in progress...)</span>}
                  </div>
                )}
              </div>

              {/* Execution Terminal Log */}
              <div className="rounded-xl border border-white/10 bg-[#080b11] overflow-hidden">
                <div className="px-3.5 py-2 border-b border-white/10 flex items-center justify-between text-[11px] font-mono text-white/50">
                  <span className="flex items-center gap-1.5">
                    <Terminal size={12} className="text-indigo-400" />
                    Last Sync Execution Activity
                  </span>
                  <button
                    type="button"
                    onClick={loadSourceStatus}
                    disabled={sourceLoading}
                    className="hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw size={11} className={sourceLoading ? 'animate-spin' : ''} />
                    Refresh Log
                  </button>
                </div>
                <pre className="p-3 text-[11px] font-mono text-emerald-300/90 max-h-52 overflow-y-auto leading-relaxed whitespace-pre-wrap selection:bg-emerald-500/20">
                  {sourceStatus?.log || 'No execution logs recorded yet. Click "Run Update Now" to trigger your first run.'}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: Manual Import & Safe Apply */}
        {/* ==================================================================== */}
        {activeTab === 'manual' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              
              {/* Drop / Import Zone */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <FileSpreadsheet size={15} className="text-indigo-400" />
                    1. Import Blocklist
                  </h2>
                  {entryCount > 0 && (
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {entryCount.toLocaleString()} Entries Loaded
                    </span>
                  )}
                </div>

                <input ref={inputRef} type="file" accept={acceptedTypes} multiple className="hidden" onChange={e => { readFiles(e.target.files); e.target.value = ''; }} />
                <input ref={folderInputRef} type="file" accept={acceptedTypes} multiple webkitdirectory="" className="hidden" onChange={e => { readFiles(e.target.files); e.target.value = ''; }} />
                
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={async e => { e.preventDefault(); setDragging(false); readFiles(await filesFromDrop(e.dataTransfer)); }}
                  className={`w-full min-h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 transition-all cursor-pointer ${
                    dragging
                      ? 'border-indigo-400 bg-indigo-500/15 scale-[0.99]'
                      : 'border-white/10 bg-white/[0.02] hover:border-indigo-400/50 hover:bg-white/5'
                  }`}
                >
                  {previewing ? <Loader2 size={24} className="text-indigo-400 animate-spin" /> : <FileUp size={24} className="text-indigo-400" />}
                  <span className="text-xs font-semibold text-white">Click or drag & drop .ipset / .netset / .txt files</span>
                  <span className="text-[10px] text-white/40">Files up to 128 MB · Deduplication is automated</span>
                </button>

                {/* Paste Direct Textarea */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Or Paste Raw IPs / Subnets:</label>
                  <textarea
                    rows={4}
                    value={rawContent}
                    onChange={e => previewContent(e.target.value, 'Pasted blocklist')}
                    placeholder="198.51.100.4&#10;203.0.113.0/24&#10;add monitor_blocklist 192.0.2.1"
                    className="w-full p-3 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-indigo-200 outline-none focus:border-indigo-400 transition-all resize-none"
                  />
                </div>
              </div>

              {/* Management IP Protection */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
                <div>
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck size={15} className="text-emerald-400" />
                    2. Protected Management IPs (Whitelist)
                  </h2>
                  <p className="text-[11px] text-white/50 mt-1">
                    These IP addresses will never be blocked, preventing accidental lockout from your server.
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={protectionDraft}
                    onChange={e => setProtectionDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProtectedIp(); } }}
                    placeholder="e.g. 203.0.113.50"
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={addProtectedIp}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border border-emerald-500/40 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-white/40 uppercase flex items-center gap-2">
                    Active Whitelist:
                    {status?.blocklist?.active && (status.blocklist.allowlistEntries || 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 normal-case">
                        Enforced on server · {status.blocklist.allowlistEntries} IP{status.blocklist.allowlistEntries === 1 ? '' : 's'} allow-listed
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    {protectedIps.length === 0 ? (
                      <span className="text-[11px] text-white/30 italic">No manual IPs added (auto-detects browser IP)</span>
                    ) : (
                      protectedIps.map(ip => (
                        <span
                          key={ip}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                        >
                          {ip}
                          <button
                            type="button"
                            onClick={() => removeProtectedIp(ip)}
                            className="hover:text-rose-300 cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {conflicts.length > 0 && (
                  <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-1">
                    <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                      <ShieldAlert size={14} /> Self-Lockout Blocked
                    </div>
                    <p className="text-[10px] text-rose-200/80 leading-relaxed">
                      {conflicts.length} entries in the import match your protected IP. Remove them before applying.
                    </p>
                  </div>
                )}
              </div>

              {/* Quick Block / Unblock — live blocklist edits without a file import */}
              {status?.blocklist?.active && (
                <div data-onboarding="firewall-quick-block" className="rounded-2xl border border-rose-500/25 bg-black/40 p-5 space-y-3">
                  <div>
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Ban size={14} className="text-rose-400" />
                      Quick Block / Unblock IPs
                    </h2>
                    <p className="text-[11px] text-white/50 mt-1">
                      Instantly add or remove specific IPs or CIDR ranges on the live blocklist — no file import needed. Quick blocks live in their own dedicated set, so they survive list re-applies and scheduled updates. Separate multiple entries with commas or new lines.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={blockDraft}
                      onChange={e => setBlockDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); quickBlock('add'); } }}
                      placeholder="e.g. 203.0.113.50  or  185.220.101.0/24"
                      className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-rose-400"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={checkBlockedIp}
                        disabled={blocking || !blockDraft.trim()}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/10 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                        title="Check if this IP is currently blocked"
                      >
                        <Search size={13} /> Check
                      </button>
                      <button
                        type="button"
                        onClick={() => quickBlock('add')}
                        disabled={blocking || !blockDraft.trim()}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 border border-rose-500/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        {blocking ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Block
                      </button>
                      <button
                        type="button"
                        onClick={() => quickBlock('remove')}
                        disabled={blocking || !blockDraft.trim()}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/10 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <RotateCcw size={13} /> Unblock
                      </button>
                    </div>
                  </div>
                  {manualBlocks.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono text-white/40 uppercase">
                        Active Quick Blocks{status?.blocklist?.manualEntries > 0 && status.blocklist.manualEntries !== manualBlocks.length ? ` (${manualBlocks.length} here · ${status.blocklist.manualEntries} on server)` : ''}:
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {manualBlocks.map(ip => (
                          <span
                            key={ip}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-rose-500/10 text-rose-300 border border-rose-500/25"
                          >
                            {ip}
                            <button
                              type="button"
                              onClick={() => quickBlock('remove', [ip])}
                              disabled={blocking}
                              className="hover:text-emerald-300 cursor-pointer disabled:opacity-40"
                              title="Unblock this IP"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {blockCheck && (
                    <div className={`text-[11px] font-mono px-3 py-2 rounded-xl border ${
                      blockCheck.blocked
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    }`}>
                      {blockCheck.active === false
                        ? 'The blocklist is not active on this server.'
                        : blockCheck.blocked
                          ? <span className="flex items-center gap-1.5"><Ban size={12} /> {blockCheck.ip} is currently BLOCKED by the live firewall.</span>
                          : <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> {blockCheck.ip} is not blocked (traffic allowed).</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Apply Action Card */}
            <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-black/40 to-indigo-500/10 p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <BrickWallShield size={16} className="text-indigo-400" />
                    3. Atomic Swap & Deploy
                  </h3>
                  <p className="text-xs text-white/50 mt-0.5">
                    {entryCount > 0
                      ? `Ready to safely swap ${entryCount.toLocaleString()} entries into kernel space.`
                      : 'Import or paste entries above to activate deployment.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={confirmation}
                    onChange={e => setConfirmation(e.target.value)}
                    placeholder="Type confirm"
                    className="w-32 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmation('confirm')}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 border border-white/5 cursor-pointer"
                  >
                    Fill &quot;confirm&quot;
                  </button>
                  <button
                    type="button"
                    onClick={applyBlocklist}
                    disabled={!canApply || applying}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(99,102,241,0.35)] disabled:opacity-40 cursor-pointer"
                  >
                    {applying ? <Loader2 size={14} className="animate-spin" /> : <BrickWallShield size={14} />}
                    {applying ? 'Applying...' : 'Apply Blocklist'}
                  </button>
                </div>
              </div>

              <ApplyProgress progress={applyProgress} />
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 3: Live Telemetry & Server Controls */}
        {/* ==================================================================== */}
        {activeTab === 'controls' && (
          <div className="space-y-6">

            {/* Server Agent status — unlocks 1s realtime graph + 24/7 attack history */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border p-4 ${
              realtimeActive
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : agentStatus?.nodeInstalled
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-white/10 bg-white/[0.02]'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-xl border ${
                  realtimeActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : agentStatus?.nodeInstalled
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-white/10 bg-white/5 text-white/50'
                }`}>
                  <Cpu size={16} />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    Server Agent
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
                      realtimeActive
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : agentStatus?.nodeInstalled
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-white/5 text-white/50 border-white/10'
                    }`}>
                      {realtimeActive ? 'Connected' : agentStatus?.nodeInstalled ? 'Installed · Offline' : 'Not installed'}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                    {realtimeActive
                      ? 'Streaming firewall attack telemetry every second and recording 24/7 history — even while this window is closed.'
                      : agentStatus?.nodeInstalled
                        ? 'Agent is installed but currently offline on this server. Start it to unlock the 1s realtime graph and 24/7 attack history.'
                        : 'Without the agent, the graph samples every 10s only while this window is open. Install it to unlock the 1s realtime stream and 24/7 recorded attack history.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAgentWizard(true)}
                className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25 transition-all cursor-pointer"
              >
                {agentStatus?.nodeInstalled ? 'Manage Agent' : 'Install Server Agent'}
              </button>
            </div>

            {/* Live Block Telemetry Grid */}
            {status?.blocklist?.active ? (
              <div className="space-y-6">
                
                {/* 3 Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-black/40 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)] relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 text-emerald-400/10">
                      <BrickWallShield size={56} />
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Blocked Network Packets
                    </div>
                    <div className="text-3xl font-bold text-emerald-300 mt-2 font-mono tracking-tight">
                      {(status.blocklist.blockedPackets || 0).toLocaleString()}
                    </div>
                    <div className="text-[11px] text-white/40 mt-1 font-mono">
                      Packets dropped before reaching sockets
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-black/40 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)] relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 text-emerald-400/10">
                      <Radar size={56} />
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Filtered Threat Bandwidth</div>
                    <div className="text-3xl font-bold text-emerald-300 mt-2 font-mono tracking-tight">
                      {((status.blocklist.blockedBytes || 0) / (1024 * 1024)).toFixed(2)} <span className="text-base font-medium text-emerald-400/70">MB</span>
                    </div>
                    <div className="text-[11px] text-white/40 mt-1 font-mono">
                      Total volume of rejected malicious traffic
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-black/40 border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.15)] relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 text-cyan-400/10">
                      <Activity size={56} />
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Kernel INPUT Position</div>
                    <div className="text-3xl font-bold text-cyan-300 mt-2 font-mono tracking-tight">
                      Line {status.blocklist.ruleLine || '1'}
                    </div>
                    <div className="text-[11px] text-white/40 mt-1 font-mono">
                      Evaluated first at top of INPUT firewall chain
                    </div>
                  </div>
                </div>

                {/* Real-Time Drop Rate Graph */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Activity size={16} className="text-emerald-400" />
                        Live Block Rate Activity (Real-Time Sparkline)
                      </h3>
                      <p className="text-xs text-white/50 mt-0.5">
                        Continuous rate of blocked network packets & traffic filtered over time.
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/60 border border-white/10 text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => setGraphMode('packets')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          graphMode === 'packets'
                            ? 'bg-emerald-500/25 text-emerald-200 font-bold border border-emerald-500/40'
                            : 'text-white/40 hover:text-white'
                        }`}
                      >
                        Packets / sec
                      </button>
                      <button
                        type="button"
                        onClick={() => setGraphMode('bandwidth')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          graphMode === 'bandwidth'
                            ? 'bg-cyan-500/25 text-cyan-200 font-bold border border-cyan-500/40'
                            : 'text-white/40 hover:text-white'
                        }`}
                      >
                        KB / sec
                      </button>
                    </div>
                  </div>

                  {/* SVG Area Chart — drag / wheel to pan through history, hover to scrub time */}
                  <div className="rounded-xl bg-[#080b11] border border-white/5 p-3 space-y-2">
                    {(() => {
                      const dataPoints = telemetryHistory.length > 0
                        ? telemetryHistory
                        : [{ time: Date.now(), pktRate: 0, byteRate: 0 }];

                      const values = dataPoints.map(p => graphMode === 'packets' ? p.pktRate : p.byteRate / 1024);
                      const maxVal = Math.max(...values, 1);
                      const minVal = 0;
                      const height = 120;
                      const padding = 10;
                      const pointSpacing = 14; // px per sample — wide enough to drag/roll smoothly
                      const width = Math.max(600, values.length * pointSpacing + padding * 2);
                      const usableHeight = height - padding * 2;
                      const usableWidth = width - padding * 2;
                      const stepX = values.length > 1 ? usableWidth / (values.length - 1) : usableWidth;

                      const coords = values.map((val, idx) => {
                        const x = padding + idx * stepX;
                        const y = height - padding - ((val - minVal) / (maxVal - minVal)) * usableHeight;
                        return { x, y, val };
                      });

                      const pathD = coords.reduce((acc, pt, idx) => {
                        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                      }, '');

                      const areaD = coords.length > 0
                        ? `${pathD} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`
                        : '';

                      const lastPt = coords[coords.length - 1] || { x: width - padding, y: height - padding, val: 0 };
                      const isPackets = graphMode === 'packets';
                      const strokeColor = isPackets ? '#10b981' : '#06b6d4';
                      const gradId = isPackets ? 'grad-packets' : 'grad-bandwidth';
                      const spanMs = dataPoints.length > 1 ? Math.max(0, Date.now() - dataPoints[0].time) : 0;
                      const spanLabel = spanMs >= 55 * 60 * 1000
                        ? `~${Math.round(spanMs / (60 * 60 * 1000))}h ago`
                        : `~${Math.max(1, Math.round(spanMs / (60 * 1000)))}m ago`;

                      const hoverIdx = graphHover && graphHover.idx >= 0 && graphHover.idx < coords.length ? graphHover.idx : null;
                      const hoverPt = hoverIdx != null ? coords[hoverIdx] : null;
                      const pinnedIdx = (() => {
                        if (!graphPinned) return null;
                        // Prefer time-based resolution — indices shift as samples stream in
                        if (graphPinned.t != null) {
                          let best = null, bestDiff = Infinity;
                          coords.forEach((c, i) => {
                            const d = Math.abs((dataPoints[i]?.time ?? 0) - graphPinned.t);
                            if (d < bestDiff) { bestDiff = d; best = i; }
                          });
                          return best;
                        }
                        return graphPinned.idx >= 0 && graphPinned.idx < coords.length ? graphPinned.idx : null;
                      })();
                      const pinnedPt = pinnedIdx != null ? coords[pinnedIdx] : null;
                      const hoverSample = hoverIdx != null ? dataPoints[hoverIdx] : null;
                      const peakIdx = values.length > 1 ? values.reduce((mi, v, i, a) => v > a[mi] ? i : mi, 0) : 0;

                      const scrollToIndex = (idx) => {
                        const el = graphScrollRef.current;
                        if (!el) return;
                        el.scrollLeft = Math.max(0, padding + idx * stepX - el.clientWidth / 2);
                        setGraphLive(false);
                        setGraphHover({ idx });
                      };

                      return (
                        <>
                          <div className="flex justify-between items-center text-[10px] font-mono text-white/40 px-1">
                            <span>Peak: <span className={isPackets ? 'text-emerald-300 font-bold' : 'text-cyan-300 font-bold'}>{maxVal.toFixed(1)} {isPackets ? 'pkts/s' : 'KB/s'}</span></span>
                            <span className="flex items-center gap-2">
                              <span>Live: <span className={isPackets ? 'text-emerald-300 font-bold' : 'text-cyan-300 font-bold'}>{lastPt.val.toFixed(1)} {isPackets ? 'pkts/s' : 'KB/s'}</span></span>
                              {values.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => scrollToIndex(peakIdx)}
                                  className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer inline-flex items-center gap-1"
                                  title="Scroll back to the peak attack rate"
                                >
                                  <TrendingUp size={11} /> Peak
                                </button>
                              )}
                              {!graphLive && (
                                <button
                                  type="button"
                                  onClick={jumpGraphLive}
                                  className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer inline-flex items-center gap-1"
                                  title="Jump back to the newest samples"
                                >
                                  <FastForward size={11} /> Live
                                </button>
                              )}
                            </span>
                          </div>

                          <div
                            ref={graphScrollRef}
                            onScroll={handleGraphScroll}
                            onMouseDown={handleGraphMouseDown}
                            onMouseMove={handleGraphDragMove}
                            onMouseUp={endGraphDrag}
                            onMouseLeave={() => { endGraphDrag(); setGraphHover(null); }}
                            onWheel={handleGraphWheel}
                            className="overflow-x-auto overflow-y-hidden cursor-grab active:cursor-grabbing select-none"
                            style={{ scrollbarWidth: 'thin' }}
                          >
                            <div className="relative" style={{ width }}>
                              <svg
                                width={width}
                                height={height}
                                viewBox={`0 0 ${width} ${height}`}
                                className="block"
                                onMouseMove={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const idx = Math.round((e.clientX - rect.left - padding) / stepX);
                                  setGraphHover({ idx: Math.min(coords.length - 1, Math.max(0, idx)) });
                                }}
                                onClick={() => {
                                  if (graphDragMovedRef.current) return; // that was a pan, not a click
                                  if (hoverIdx != null) setGraphPinned({ idx: hoverIdx, t: dataPoints[hoverIdx].time });
                                }}
                              >
                                <defs>
                                  <linearGradient id="grad-packets" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                                  </linearGradient>
                                  <linearGradient id="grad-bandwidth" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                                  </linearGradient>
                                </defs>

                                {/* Reference Grid lines */}
                                <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#ffffff" strokeOpacity="0.05" strokeDasharray="3 3" />
                                <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#ffffff" strokeOpacity="0.05" strokeDasharray="3 3" />
                                <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#ffffff" strokeOpacity="0.1" />

                                {/* Filled Area */}
                                {areaD && <path d={areaD} fill={`url(#${gradId})`} />}

                                {/* Main Stroke */}
                                {pathD && (
                                  <path
                                    d={pathD}
                                    fill="none"
                                    stroke={strokeColor}
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}

                                {/* Points */}
                                {coords.map((pt, i) => (
                                  <circle
                                    key={i}
                                    cx={pt.x}
                                    cy={pt.y}
                                    r="3"
                                    fill={strokeColor}
                                    fillOpacity="0.6"
                                  />
                                ))}

                                {/* Peak marker */}
                                {values.length > 1 && (
                                  <>
                                    <circle cx={coords[peakIdx].x} cy={coords[peakIdx].y} r="5" fill="none" stroke="#fbbf24" strokeWidth="1.5" />
                                    <text x={coords[peakIdx].x} y={Math.max(10, coords[peakIdx].y - 10)} textAnchor="middle" fontSize="8" fill="#fbbf24" fontFamily="monospace">peak</text>
                                  </>
                                )}

                                {/* Pinned time marker — stays until cleared, independent of hover */}
                                {pinnedPt && (
                                  <>
                                    <line x1={pinnedPt.x} y1={Math.max(0, padding - 6)} x2={pinnedPt.x} y2={height - padding} stroke="#fbbf24" strokeOpacity="0.7" strokeDasharray="2 2" />
                                    <circle cx={pinnedPt.x} cy={pinnedPt.y} r="5" fill="#fbbf24" fillOpacity="0.25" stroke="#fbbf24" strokeWidth="1.5" />
                                  </>
                                )}

                                {/* Hover crosshair */}
                                {hoverPt && (
                                  <line x1={hoverPt.x} y1={Math.max(0, padding - 6)} x2={hoverPt.x} y2={height - padding} stroke={strokeColor} strokeOpacity="0.5" strokeDasharray="4 3" />
                                )}

                                {/* Latest Head */}
                                {lastPt && (
                                  <circle cx={lastPt.x} cy={lastPt.y} r="4" fill="#ffffff" stroke={strokeColor} strokeWidth="2" />
                                )}

                                {/* Hovered point */}
                                {hoverPt && (
                                  <circle cx={hoverPt.x} cy={hoverPt.y} r="4.5" fill="#ffffff" stroke={strokeColor} strokeWidth="2" />
                                )}
                              </svg>

                              {/* Hover tooltip — also time-filters the threat inspector below */}
                              {hoverPt && hoverSample && (
                                <div
                                  className="absolute top-0 pointer-events-none z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[10px] font-mono shadow-xl leading-relaxed"
                                  style={{
                                    left: Math.min(Math.max(hoverPt.x, 90), width - 90),
                                    background: 'rgba(8,11,17,0.95)',
                                    borderColor: `${strokeColor}55`,
                                    color: '#e2e8f0',
                                  }}
                                >
                                  <div className="font-bold" style={{ color: strokeColor }}>{new Date(hoverSample.time).toLocaleTimeString()}</div>
                                  <div>{(isPackets ? hoverSample.pktRate : hoverSample.byteRate / 1024).toFixed(1)} {isPackets ? 'pkts/s' : 'KB/s'}</div>
                                  <div className="text-white/50">{(hoverSample.packets || 0).toLocaleString()} pkts · {((hoverSample.bytes || 0) / 1048576).toFixed(2)} MB total</div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-[9px] font-mono text-white/30 px-1 border-t border-white/5 pt-1">
                            <span>← {spanLabel} · drag to pan · click to pin a time</span>
                            <span className="flex items-center gap-1 text-emerald-400/70">
                              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${realtimeActive ? 'animate-pulse' : ''}`} />
                              {realtimeActive ? 'Realtime · agent stream (1s)' : 'Sampling every 10s'}
                            </span>
                            <span>Now</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Live Threat Packet Inspector UI */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Radar size={16} className="text-rose-400" />
                        Live Threat Packet Inspector & Attacker Intent
                      </h3>
                      <p className="text-xs text-white/50 mt-0.5">
                        Deep packet analysis of what malicious scanners and botnets are trying to attack on your server.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSniffingActive(prev => !prev);
                          if (!sniffingActive) loadPackets();
                        }}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer ${
                          sniffingActive
                            ? 'bg-rose-500/25 border border-rose-500/50 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                            : 'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {sniffingActive
                          ? <Pause size={13} className={packetsLoading ? 'animate-pulse' : ''} />
                          : <Play size={13} />}
                        {sniffingActive ? 'Sniffing Live (3s)...' : 'Start Live Sniffer'}
                      </button>

                      <button
                        type="button"
                        onClick={loadPackets}
                        disabled={packetsLoading}
                        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
                        title="Sample now"
                      >
                        <RefreshCw size={13} className={packetsLoading ? 'animate-spin text-indigo-400' : ''} />
                      </button>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs font-mono">
                      {(graphPinned || graphHover) && (graphPinned?.t != null || telemetryHistory[(graphPinned || graphHover).idx]) && (
                        <span className={`mr-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border whitespace-nowrap ${
                          graphPinned
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}>
                          {graphPinned ? <Pin size={11} /> : <Clock size={11} />} {graphPinned ? 'Pinned' : 'Threats'} @ {new Date(graphPinned ? graphPinned.t : telemetryHistory[graphHover.idx].time).toLocaleTimeString()} ±15s
                          <button
                            type="button"
                            onClick={() => setGraphPinned(null)}
                            className="text-amber-400/70 hover:text-amber-200 cursor-pointer font-bold flex items-center"
                            title="Unpin time filter"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      )}
                      {[
                        { id: 'all', label: 'All Threats' },
                        { id: 'ssh', label: 'SSH Brute Force' },
                        { id: 'web', label: 'Web Scanners' },
                        { id: 'database', label: 'Database Probes' },
                        { id: 'botnet', label: 'Mirai / IoT' },
                      ].map(tab => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setPacketFilter(tab.id)}
                          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                            packetFilter === tab.id
                              ? 'bg-indigo-500/25 border border-indigo-500/40 text-indigo-200 font-bold'
                              : 'text-white/40 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={packetSearch}
                      onChange={e => setPacketSearch(e.target.value)}
                      placeholder="Filter by IP (e.g. 198.51...)"
                      className="px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-indigo-400 sm:w-48"
                    />
                  </div>

                  {/* Packet Feed Table */}
                  <div className="rounded-xl border border-white/10 bg-[#080b11] overflow-hidden">
                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="sticky top-0 bg-[#0c1017] border-b border-white/10 text-[10px] text-white/40 uppercase tracking-wider">
                          <tr>
                            <th className="p-2.5 pl-3">Time</th>
                            <th className="p-2.5">Attacker Source IP</th>
                            <th className="p-2.5">Target Port</th>
                            <th className="p-2.5">Attack Intent Category</th>
                            <th className="p-2.5">Kernel Action</th>
                            <th className="p-2.5 pr-3">Payload Intent</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(() => {
                            // A click-pinned point locks the time filter; hover only previews when nothing is pinned.
                            // Pins store an absolute timestamp (t) because telemetryHistory shifts as new samples
                            // arrive — a raw index would silently drift to the wrong moment.
                            const activePoint = graphPinned || graphHover;
                            let activeSample = null;
                            if (activePoint) {
                              if (activePoint.t != null) {
                                let best = null, bestDiff = Infinity;
                                for (const s of telemetryHistory) {
                                  const d = Math.abs(s.time - activePoint.t);
                                  if (d < bestDiff) { bestDiff = d; best = s; }
                                }
                                // fall back to the pinned instant itself if history rotated past it
                                activeSample = best && bestDiff <= 30000 ? best : { time: activePoint.t };
                              } else {
                                activeSample = telemetryHistory[activePoint.idx] || null;
                              }
                            }
                            // No hover/pin → list ALL captured packets (no time filter)
                            if (activePoint && !activeSample) return null;
                            // Packets arrive in discrete sniffer-fetch batches (pkt._ms). Prefer the strict ±15s
                            // window around the selected moment; if no batch falls inside, snap to the nearest
                            // capture batch within 90s so the inspector still shows the closest traffic.
                            let hoverWindow = null;
                            if (activeSample) {
                              let winCenter = activeSample.time;
                              if (packets.length && !packets.some(p => Math.abs((p._ms ?? 0) - winCenter) <= 15000)) {
                                const nearest = packets.reduce((b, p) =>
                                  Math.abs((p._ms ?? 0) - winCenter) < Math.abs((b._ms ?? 0) - winCenter) ? p : b
                                , packets[0]);
                                if (nearest && Math.abs((nearest._ms ?? 0) - winCenter) <= 90000) {
                                  winCenter = nearest._ms;
                                }
                              }
                              hoverWindow = { from: winCenter - 15000, to: winCenter + 15000 };
                            }
                            const filtered = packets.filter(pkt => {
                              if (hoverWindow && !((pkt._ms ?? 0) >= hoverWindow.from && (pkt._ms ?? 0) <= hoverWindow.to)) return false;
                              if (packetSearch && !pkt.srcIp.includes(packetSearch)) return false;
                              if (packetFilter === 'ssh') return pkt.targetPort === 22 || pkt.targetPort === 2222;
                              if (packetFilter === 'web') return [80, 443, 8080, 8443, 8888].includes(Number(pkt.targetPort));
                              if (packetFilter === 'database') return [3306, 5432, 6379, 27017, 9200].includes(Number(pkt.targetPort));
                              if (packetFilter === 'botnet') return [23, 2323].includes(Number(pkt.targetPort));
                              return true;
                            });

                            if (!filtered.length) {
                              return (
                                <tr>
                                  <td colSpan={6} className="p-6 text-center text-white/30 italic">
                                    {packetsLoading
                                      ? 'Inspecting packet flow on server...'
                                      : hoverWindow
                                        ? `No threats recorded in the ${graphPinned ? 'pinned' : 'hovered'} time window (±15s).`
                                        : 'No packets match current filter. Click "Start Live Sniffer" to stream traffic.'}
                                  </td>
                                </tr>
                              );
                            }

                            return filtered.slice().sort((a, b) => (b._ms || 0) - (a._ms || 0)).map(pkt => (
                              <tr
                                key={pkt.id}
                                onClick={() => setSelectedPacket(pkt)}
                                className="hover:bg-indigo-500/10 cursor-pointer transition-colors group"
                              >
                                <td className="p-2.5 pl-3 text-white/40 whitespace-nowrap">{pkt.timestamp}</td>
                                <td className="p-2.5 text-cyan-300 font-bold whitespace-nowrap group-hover:text-cyan-200">
                                  <span className="inline-flex items-center gap-1.5">
                                    {pkt.srcIp}
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); quickBlock('add', [pkt.srcIp]); }}
                                      disabled={blocking}
                                      title="Add this attacker to the live blocklist"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-400 hover:text-rose-300 cursor-pointer disabled:opacity-40"
                                    >
                                      <Ban size={12} />
                                    </button>
                                  </span>
                                </td>
                                <td className="p-2.5 whitespace-nowrap">
                                  <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80">
                                    {pkt.targetPort}/{pkt.protocol}
                                  </span>
                                </td>
                                <td className="p-2.5 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${pkt.badge || 'bg-white/10 text-white'}`}>
                                    {pkt.attackType}
                                  </span>
                                </td>
                                <td className="p-2.5 whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 inline-flex items-center gap-1">
                                    <Ban size={10} /> Silent Drop (0ms)
                                  </span>
                                </td>
                                <td className="p-2.5 pr-3 text-white/60 text-[11px] max-w-xs truncate flex items-center justify-between" title={pkt.description}>
                                  <span>{pkt.description}</span>
                                  <span className="text-[10px] text-indigo-400 group-hover:text-indigo-300 font-mono underline ml-2 shrink-0">
                                    Inspect Hex →
                                  </span>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Selected Packet Real Payload & Wire Header Modal */}
                {selectedPacket && (
                  <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
                    <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-indigo-500/40 bg-[#0d1117] shadow-[0_25px_70px_rgba(0,0,0,0.9)] flex flex-col">
                      
                      {/* Modal Header */}
                      <div className="p-4 sm:p-5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            <ShieldAlert size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white font-mono">{selectedPacket.srcIp}</h3>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/70">
                                Target Port {selectedPacket.targetPort}/{selectedPacket.protocol}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${selectedPacket.badge}`}>
                                {selectedPacket.attackType}
                              </span>
                            </div>
                            <p className="text-xs text-white/50 mt-0.5">
                              {selectedPacket.description}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedPacket(null)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      {/* Modal Body */}
                      <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs">
                        
                        {/* Protocol Header Breakdown */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <span className="text-[9px] text-white/40 uppercase">Attacker Signature</span>
                            <div className="text-xs font-bold text-amber-300 truncate">{selectedPacket.toolSignature || 'Automated Worm'}</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <span className="text-[9px] text-white/40 uppercase">TCP Flags / Seq</span>
                            <div className="text-xs font-bold text-cyan-300">{selectedPacket.tcpHeader?.flags || 'SYN'} (Seq: {selectedPacket.tcpHeader?.seq || '0'})</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <span className="text-[9px] text-white/40 uppercase">IP Packet Length</span>
                            <div className="text-xs font-bold text-indigo-300">{selectedPacket.packetLen || 64} Bytes (TTL: {selectedPacket.ipHeader?.ttl || 48})</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <span className="text-[9px] text-white/40 uppercase">Kernel Firewall Verdict</span>
                            <div className="text-xs font-bold text-rose-400">Silently Dropped (0ms)</div>
                          </div>
                        </div>

                        {/* Kernel Defense Explainer Banner */}
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5">
                          <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <div className="text-[11px] font-bold text-emerald-200">
                              Why did no malicious application data penetrate your server?
                            </div>
                            <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                              In TCP networking, clients must first complete a 3-way handshake (<code className="text-emerald-100">SYN → SYN-ACK → ACK</code>) before sending application data. Because your IPSet firewall <strong>silently drops the initial SYN packet in 0 microseconds</strong>, the attacker was blocked before they could open a socket or transmit an exploit payload.
                            </p>
                          </div>
                        </div>

                        {/* Raw Decoded Application Payload */}
                        <div className="space-y-2">
                          <div className="text-[10px] text-white/50 uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span>Targeted Exploit Payload:</span>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                Raw Command String
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const text = selectedPacket.rawPayloadAscii || '';
                                  navigator.clipboard?.writeText(text);
                                  setCopiedPayload(true);
                                  setTimeout(() => setCopiedPayload(false), 2000);
                                }}
                                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-white/60 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                {copiedPayload ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                {copiedPayload ? 'Copied!' : 'Copy Payload'}
                              </button>

                              <button
                                type="button"
                                onClick={() => setPayloadExpanded(prev => !prev)}
                                className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                {payloadExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                {payloadExpanded ? 'Collapse' : 'Expand Full Payload'}
                              </button>
                            </div>
                          </div>

                          <div className="relative">
                            <pre className={`p-3.5 rounded-xl bg-[#080b11] border border-white/10 text-emerald-300/90 text-xs overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed transition-all selection:bg-emerald-500/25 ${
                              payloadExpanded ? 'max-h-96' : 'max-h-24'
                            }`}>
                              {selectedPacket.rawPayloadAscii || 'SYN Handshake: Probing for open port and service availability.'}
                            </pre>

                            {!payloadExpanded && (selectedPacket.rawPayloadAscii?.length > 100) && (
                              <div
                                onClick={() => setPayloadExpanded(true)}
                                className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#080b11] to-transparent flex items-end justify-center pb-1 rounded-b-xl cursor-pointer hover:bg-white/5 transition-colors"
                              >
                                <span className="text-[10px] text-indigo-300 font-bold flex items-center gap-1">
                                  Click to Expand ({selectedPacket.rawPayloadAscii.length} chars) ↓
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Real Wire Hex Dump View */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] text-white/50 uppercase tracking-wider flex items-center justify-between">
                            <span>Full Wire Frame Hex Dump (Offset | Hex Bytes | ASCII):</span>
                            <span className="text-[9px] text-cyan-300">Network Byte Order (IP + TCP + Options)</span>
                          </div>
                          <pre className="p-3.5 rounded-xl bg-[#05070c] border border-cyan-500/20 text-cyan-300/90 text-[11px] overflow-x-auto whitespace-pre font-mono leading-relaxed selection:bg-cyan-500/25">
                            {selectedPacket.hexDump || '0x0000:  45 00 00 54 84 f2 40 00 36 06 a1 2b c6 33 64 04  |E..T..@.6..+.3d.|\n0x0010:  0a 00 00 01 80 00 00 16 0a 1c 3f 82 00 00 00 00  |..........?.....|'}
                          </pre>
                        </div>

                      </div>

                      {/* Modal Footer */}
                      <div className="p-3.5 px-5 border-t border-white/10 bg-white/[0.02] flex items-center justify-between text-xs">
                        <span className="text-white/40 flex items-center gap-1.5 text-[11px]">
                          <Zap size={13} className="text-emerald-400" />
                          Zero CPU & Socket overhead · Dropped at kernel boundary
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedPacket(null)}
                          className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold transition-all cursor-pointer"
                        >
                          Close Inspector
                        </button>
                      </div>

                    </div>
                  </div>
                )}

                {/* Interactive Explainer: How Kernel Filtering Works */}
                <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-black/40 p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Workflow size={16} className="text-indigo-400" />
                        How the Firewall Engine Works
                      </h3>
                      <p className="text-xs text-white/50 mt-0.5">
                        Kernel packet traversal · blocklist applied via {isLocalRelayMode ? 'Local Relay (WebRTC DataChannel)' : 'Server (direct SSH)'}:
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isLocalRelayMode ? (
                        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                          <Zap size={11} />
                          WebRTC DataChannel · Local Relay
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
                          <Server size={11} />
                          Server Mode · Direct SSH
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 font-mono text-xs">
                    <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 space-y-1.5">
                      <div className="text-[10px] text-cyan-400 font-bold uppercase">1. Inbound Packet</div>
                      <div className="text-white/80 text-[11px]">Network traffic hits WAN/eth0 interface on your server.</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 space-y-1.5">
                      <div className="text-[10px] text-indigo-400 font-bold uppercase">2. INPUT Chain #1</div>
                      <div className="text-white/80 text-[11px]">iptables rule directs source IP to IPSet hash engine.</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-black/50 border border-emerald-500/30 space-y-1.5 bg-emerald-500/5">
                      <div className="text-[10px] text-emerald-400 font-bold uppercase">3. O(1) Hash Lookup</div>
                      <div className="text-white/80 text-[11px]">Checks memory hash table in &lt;1 microsecond.</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-black/50 border border-rose-500/30 space-y-1.5 bg-rose-500/5">
                      <div className="text-[10px] text-rose-400 font-bold uppercase">4. Match = Drop</div>
                      <div className="text-white/80 text-[11px]">Matched IPs are silently dropped. Zero socket or CPU load.</div>
                    </div>

                    <div className={`p-3.5 rounded-xl bg-black/50 space-y-1.5 ${
                      isLocalRelayMode
                        ? 'border border-cyan-500/30 bg-cyan-500/5'
                        : 'border border-blue-500/30 bg-blue-500/5'
                    }`}>
                      <div className={`text-[10px] font-bold uppercase ${isLocalRelayMode ? 'text-cyan-400' : 'text-blue-400'}`}>
                        5. {isLocalRelayMode ? 'WebRTC Relay' : 'Server SSH'}
                      </div>
                      <div className="text-white/80 text-[11px]">
                        {isLocalRelayMode
                          ? 'P2P DataChannel pipes the blocklist update out-of-band — stays connected even if inbound ports change.'
                          : 'Blocklist update is pushed via direct SSH from the app server. WebRTC is not used in Server mode.'}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-black/40 border border-white/10 text-center space-y-3">
                <Shield size={36} className="text-white/20 mx-auto" />
                <div className="text-sm font-semibold text-white/70">No active blocklist currently filtering traffic</div>
                <p className="text-xs text-white/40 max-w-md mx-auto">
                  Activate protection via the <strong className="inline-flex items-center gap-1"><Zap size={12} className="text-amber-300" /> Automated Sync</strong> tab or <strong className="inline-flex items-center gap-1"><FolderUp size={12} className="text-indigo-300" /> Manual Import</strong> tab to start recording real-time threat telemetry and graphs.
                </p>
              </div>
            )}

            {/* Server Controls */}
            <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <SlidersHorizontal size={14} className="text-indigo-400" />
                  Blocklist Lifecycle Controls
                </h3>
                <p className="text-xs text-white/50 mt-1">
                  Manage the state of the active IPSet without altering your server&apos;s other iptables rules.
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => { setManageAction('disable'); setManageConfirmation(''); }}
                  disabled={!status?.blocklist?.active || managing}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 cursor-pointer"
                >
                  <Power size={13} /> Disable Filter
                </button>

                <button
                  type="button"
                  onClick={() => { setManageAction('reactivate'); setManageConfirmation(''); }}
                  disabled={!status?.persistence?.snapshot || status?.blocklist?.active || managing}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 cursor-pointer"
                >
                  <RotateCcw size={13} /> Reactivate Filter
                </button>

                <button
                  type="button"
                  onClick={() => { setManageAction('remove'); setManageConfirmation(''); }}
                  disabled={managing}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 cursor-pointer"
                >
                  <Trash2 size={13} /> Remove Permanently
                </button>

                <button
                  type="button"
                  onClick={inspectBlocklist}
                  disabled={inspectionLoading}
                  className="ml-auto px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 cursor-pointer"
                >
                  {inspectionLoading ? <Loader2 size={13} className="animate-spin" /> : <Terminal size={13} />}
                  Deep Inspect Server
                </button>
              </div>

              {/* Lifecycle Inline Confirmation */}
              {manageAction && (
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <span className="text-xs text-white/70 font-mono">
                    Confirm {manageAction}:
                  </span>
                  <input
                    type="text"
                    value={manageConfirmation}
                    onChange={e => setManageConfirmation(e.target.value)}
                    placeholder="Type confirm"
                    className="w-32 px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => setManageConfirmation('confirm')}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 border border-white/5 cursor-pointer"
                  >
                    Fill &quot;confirm&quot;
                  </button>
                  <button
                    type="button"
                    onClick={manageBlocklist}
                    disabled={managing || !matchesConfirmation(manageConfirmation)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    {managing ? <Loader2 size={13} className="animate-spin" /> : 'Execute Now'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setManageAction(''); setManageConfirmation(''); }}
                    className="px-3 py-1.5 text-xs text-white/40 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Deep Inspection Panel */}
            {inspection && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Terminal size={14} className="text-indigo-400" />
                    Live Kernel Inspection
                  </h3>
                  <span className="text-[10px] font-mono text-white/40">
                    Inspected {new Date(inspection.inspectedAt).toLocaleTimeString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
                  <div className="p-3.5 rounded-xl bg-[#080b11] border border-white/5 space-y-2">
                    <div className="text-[10px] uppercase text-white/40">INPUT Rule State:</div>
                    <pre className="text-cyan-300 text-[11px] overflow-x-auto whitespace-pre-wrap">
                      {inspection.rule?.value || 'No monitor blocklist rule found in INPUT chain.'}
                    </pre>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080b11] border border-white/5 space-y-2">
                    <div className="text-[10px] uppercase text-white/40">
                      IPSet Sample Entries ({(inspection.ipset?.entries || 0).toLocaleString()}{inspection.ipset?.manualEntries ? ` + ${inspection.ipset.manualEntries} quick` : ''}):
                    </div>
                    <pre className="text-emerald-300 text-[11px] max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {inspection.ipset?.samples?.length ? inspection.ipset.samples.join('\n') : 'Empty IPSet.'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive Guided Tour / Onboarding Modal */}
        {showOnboarding && (
          <FirewallOnboarding onComplete={() => setShowOnboarding(false)} />
        )}

        {/* Server Agent Setup & Management Wizard */}
        <AgentSetupWizard
          isOpen={showAgentWizard}
          onClose={() => {
            setShowAgentWizard(false);
            // Re-check status and re-request the realtime stream — the agent
            // may have just come online
            loadAgentStatus();
            setAgentTick(t => t + 1);
          }}
          connection={connections.find(c => String(c._id || c.id) === String(connectionId))}
          onRefreshStatus={() => {
            loadAgentStatus();
            setAgentTick(t => t + 1);
          }}
          apiFetch={apiFetch}
        />
      </div>
    </div>
  );
}
