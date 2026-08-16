'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Activity, Server, HardDrive, Wifi, Cpu, MemoryStick, Download, Upload, 
  Clock, Package, Database, Box, RefreshCw, AlertCircle, CheckCircle2, 
  Zap, TrendingUp, TrendingDown, Minus, Pause, Play, RotateCw, Radio,
  Copy, Check, Terminal, Shield, Sparkles, ExternalLink, Laptop, AlertTriangle,
  ChevronDown, ListFilter, Search, XOctagon, Skull, ArrowUpDown, Trash2, X
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { createRelayPeer } from '@/lib/webrtc-relay';
import AgentSetupWizard from '@/components/AgentSetupWizard';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 🎨 Styled popover select — matches RcloneApp theme
function CustomSelect({ value, onChange, options = [], placeholder = 'Select...', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedOpt = options.find(o => String(o.value) === String(value));

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] font-medium flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-500/50 transition-all whitespace-nowrap"
      >
        <span className="truncate">{selectedOpt?.label || placeholder}</span>
        <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[9999] overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected ? 'bg-indigo-500/15 text-indigo-400 font-bold' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check size={12} className="text-indigo-400 shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ServerMonitorApp() {
  const { t } = useTranslation();
  const { state: appState, apiFetch, relayInfo } = useApp();
  
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // overview, apps, processes
  const [metrics, setMetrics] = useState(null);
  const [appsData, setAppsData] = useState({}); // cached by connectionId: { apps, timestamp }
  const [appsLoading, setAppsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 2000, 5000, 10000, 30000
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [showAgentWizard, setShowAgentWizard] = useState(false);

  // ── Processes Management State ──
  const [processesData, setProcessesData] = useState({}); // { [connId]: { processes: [], total: 0, timestamp: null } }
  const [processesLoading, setProcessesLoading] = useState(false);
  const [procSearchQuery, setProcSearchQuery] = useState('');
  const [procSortField, setProcSortField] = useState('cpu'); // 'cpu' | 'mem' | 'rssKb' | 'pid' | 'name'
  const [procSortDir, setProcSortDir] = useState('desc'); // 'desc' | 'asc'
  const [killModal, setKillModal] = useState({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null });

  // Per-server agent status (keyed by connectionId) — from SSH process check
  const [agentStatuses, setAgentStatuses] = useState({}); // { [connId]: { isRunning, nodeInstalled, inTmux, inService, checkedAt } }
  // Live WebSocket-connected monitor agents (from agent:online/offline events)
  const [connectedAgents, setConnectedAgents] = useState(new Map()); // agentName → { agentName, host, connectedAt }
  const agentPollRef = useRef(null);

  // Client-side previous sample for instantaneous delta math (user machine CPU/Net calculation)
  const prevSampleRef = useRef(null);
  const inFlightMetricsRef = useRef(false);
  const abortControllerRef = useRef(null);
  const intervalRef = useRef(null);
  const relayPollRef = useRef(null);

  // Historical data for charts (last 20 points)
  const [cpuHistory, setCpuHistory] = useState([]);
  const [ramHistory, setRamHistory] = useState([]);
  const [networkHistory, setNetworkHistory] = useState([]);

  const inFlightProcRef = useRef(false);
  const inFlightStatusRef = useRef(false);
  const inFlightAppsRef = useRef(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const [isSocketStreaming, setIsSocketStreaming] = useState(false);
  const [isP2PStreaming, setIsP2PStreaming] = useState(false);
  const isP2PStreamingRef = useRef(false); // ref to avoid stale closure in socket event handlers

  // Refs for latest state accessible inside closed-over socket event handlers
  const selectedConnectionRef = useRef(null);
  const connectionsRef = useRef([]);
  const refreshIntervalRef = useRef(5000);

  const connections = useMemo(() => appState.connections || [], [appState.connections]);

  // Select first connection by default
  useEffect(() => {
    if (!selectedConnection && connections.length > 0) {
      setSelectedConnection(connections[0]._id);
    }
  }, [connections, selectedConnection]);

  // Keep refs in sync with latest state (for use inside closed-over socket handlers)
  useEffect(() => { selectedConnectionRef.current = selectedConnection; }, [selectedConnection]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => { refreshIntervalRef.current = refreshInterval; }, [refreshInterval]);



  // ── Per-connection agent status polling ──
  const checkAgentStatusForConn = useCallback(async (connId) => {
    if (!connId || inFlightStatusRef.current) return;
    inFlightStatusRef.current = true;
    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId, action: 'status' })
      });
      if (res.ok) {
        const data = await res.json();
        setAgentStatuses(prev => ({
          ...prev,
          [connId]: {
            isRunning: data.isRunning,
            nodeInstalled: data.nodeInstalled,
            inTmux: data.inTmux,
            inService: data.inService,
            checkedAt: Date.now()
          }
        }));
      }
    } catch (_) {
    } finally {
      inFlightStatusRef.current = false;
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!selectedConnection) return;

    // Only run SSH process check if agent is NOT streaming live via WebSocket
    if (isSocketStreaming || isP2PStreaming) return;

    // Check once when connection changes
    checkAgentStatusForConn(selectedConnection);

    // Only poll over SSH every 30s if wizard is open or agent is offline
    if (showAgentWizard) {
      agentPollRef.current = setInterval(() => {
        if (!isSocketStreaming && !isP2PStreaming) {
          checkAgentStatusForConn(selectedConnection);
        }
      }, 30000);
    }

    return () => {
      if (agentPollRef.current) clearInterval(agentPollRef.current);
    };
  }, [selectedConnection, isSocketStreaming, isP2PStreaming, showAgentWizard, checkAgentStatusForConn]);

  // Page Visibility detection - pause polling when tab/window is in the background
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = !document.hidden;
      setIsTabVisible(visible);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Clear previous samples and reset stream state when server connection changes
  useEffect(() => {
    prevSampleRef.current = null;
    setCpuHistory([]);
    setRamHistory([]);
    setNetworkHistory([]);
    setError(null);
    setMetrics(null);
    setIsSocketStreaming(false);
    setIsP2PStreaming(false);
    isP2PStreamingRef.current = false;
  }, [selectedConnection]);

  // Client-side CPU and Network rate calculation from cumulative delta counters
  const computeClientDeltas = useCallback((rawMetrics) => {
    const nowMs = rawMetrics.timestampMs || Date.now();
    const prev = prevSampleRef.current;
    
    let computedCpuUsage = rawMetrics.cpu?.usage || 0;
    let computedRxRate = rawMetrics.network?.rxRate || 0;
    let computedTxRate = rawMetrics.network?.txRate || 0;

    if (prev && prev.timeMs) {
      const deltaMs = Math.max(50, nowMs - prev.timeMs);
      const deltaSec = deltaMs / 1000;

      // 1. CPU Usage Delta Math
      if (rawMetrics.cpu?.raw && prev.cpuRaw) {
        const deltaTotal = rawMetrics.cpu.raw.total - prev.cpuRaw.total;
        const deltaIdle = rawMetrics.cpu.raw.idle - prev.cpuRaw.idle;
        if (deltaTotal > 0) {
          const usedRatio = (deltaTotal - deltaIdle) / deltaTotal;
          computedCpuUsage = Math.max(0, Math.min(100, usedRatio * 100));
        }
      }

      // 2. Network RX / TX Rate Delta Math
      if (rawMetrics.network && prev.netRaw) {
        const rxTotal = rawMetrics.network.rxTotal || 0;
        const txTotal = rawMetrics.network.txTotal || 0;
        const deltaRx = Math.max(0, rxTotal - prev.netRaw.rxTotal);
        const deltaTx = Math.max(0, txTotal - prev.netRaw.txTotal);
        computedRxRate = deltaRx / deltaSec;
        computedTxRate = deltaTx / deltaSec;
      }
    }

    // Save current sample for next delta calculation
    prevSampleRef.current = {
      timeMs: nowMs,
      cpuRaw: rawMetrics.cpu?.raw || null,
      netRaw: {
        rxTotal: rawMetrics.network?.rxTotal || 0,
        txTotal: rawMetrics.network?.txTotal || 0,
      }
    };

    return {
      ...rawMetrics,
      cpu: {
        ...rawMetrics.cpu,
        usage: computedCpuUsage,
      },
      network: {
        ...rawMetrics.network,
        rxRate: computedRxRate,
        txRate: computedTxRate,
      }
    };
  }, []);

  // Fetch metrics with in-flight guard and client delta computation
  const fetchMetrics = useCallback(async (isManual = false) => {
    if (!selectedConnection) return;
    if (inFlightMetricsRef.current && !isManual) return;

    inFlightMetricsRef.current = true;
    if (isManual) setLoading(true);

    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const response = await apiFetch(`/api/server-monitor/metrics?connectionId=${selectedConnection}`, {
        signal: abortControllerRef.current.signal
      });

      if (response.ok) {
        const data = await response.json();
        const processed = computeClientDeltas(data);
        
        setMetrics(processed);
        setError(null);

        // Update charts on client machine
        const timestamp = new Date(processed.timestampMs || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setCpuHistory(prev => [...prev.slice(-19), { time: timestamp, value: processed.cpu?.usage || 0 }]);
        setRamHistory(prev => [...prev.slice(-19), { time: timestamp, value: processed.memory?.usedPercent || 0 }]);
        setNetworkHistory(prev => [...prev.slice(-19), { 
          time: timestamp, 
          rx: processed.network?.rxRate || 0, 
          tx: processed.network?.txRate || 0 
        }]);
      } else {
        const errData = await response.json();
        setError(errData.error || 'Failed to fetch metrics');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Fetch metrics error:', err);
        setError(err.message);
      }
    } finally {
      inFlightMetricsRef.current = false;
      if (isManual) setLoading(false);
    }
  }, [selectedConnection, apiFetch, computeClientDeltas]);

  // Fetch installed applications (on-demand with client cache)
  const fetchApps = useCallback(async (force = false) => {
    if (!selectedConnection || inFlightAppsRef.current) return;
    inFlightAppsRef.current = true;
    setAppsLoading(true);

    try {
      const response = await apiFetch(`/api/server-monitor/apps?connectionId=${selectedConnection}`);
      if (response.ok) {
        const data = await response.json();
        setAppsData(prev => ({
          ...prev,
          [selectedConnection]: {
            ...data,
            timestamp: Date.now()
          }
        }));
      }
    } catch (err) {
      console.error('Fetch apps error:', err);
    } finally {
      inFlightAppsRef.current = false;
      setAppsLoading(false);
    }
  }, [selectedConnection, apiFetch]);

  // Fetch running processes (on-demand or live polling)
  const fetchProcesses = useCallback(async (force = false) => {
    if (!selectedConnection || inFlightProcRef.current) return;
    inFlightProcRef.current = true;
    setProcessesLoading(true);

    try {
      const response = await apiFetch(`/api/server-monitor/processes?connectionId=${selectedConnection}`);
      if (response.ok) {
        const data = await response.json();
        setProcessesData(prev => ({
          ...prev,
          [selectedConnection]: {
            processes: data.processes || [],
            total: data.total || 0,
            timestamp: Date.now()
          }
        }));
      }
    } catch (err) {
      console.error('Fetch processes error:', err);
    } finally {
      inFlightProcRef.current = false;
      setProcessesLoading(false);
    }
  }, [selectedConnection, apiFetch]);

  // Terminate / Kill process by PID
  const executeKillProcess = async () => {
    if (!killModal.process || !selectedConnection) return;
    setKillModal(prev => ({ ...prev, loading: true, error: null }));

    try {
      const res = await apiFetch('/api/server-monitor/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnection,
          pid: killModal.process.pid,
          signal: killModal.signal
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null });
        // Refresh process list immediately
        fetchProcesses(true);
      } else {
        setKillModal(prev => ({ ...prev, loading: false, error: data.error || 'Failed to terminate process' }));
      }
    } catch (err) {
      setKillModal(prev => ({ ...prev, loading: false, error: err.message }));
    }
  };


  // Common handler for incoming telemetry data
  const handleIncomingTelemetry = useCallback((raw) => {
    const processed = computeClientDeltas(raw);
    setMetrics(processed);
    setError(null);

    const timestamp = new Date(processed.timestampMs || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setCpuHistory(prev => [...prev.slice(-19), { time: timestamp, value: processed.cpu?.usage || 0 }]);
    setRamHistory(prev => [...prev.slice(-19), { time: timestamp, value: processed.memory?.usedPercent || 0 }]);
    setNetworkHistory(prev => [...prev.slice(-19), { 
      time: timestamp, 
      rx: processed.network?.rxRate || 0, 
      tx: processed.network?.txRate || 0 
    }]);
  }, [computeClientDeltas]);

  // ── WebRTC P2P DataChannel + WebSocket Relay Stream ──
  useEffect(() => {
    const socket = io({
      path: '/api/socket',
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // 1. Ask server for currently connected monitor agents
      socket.emit('agent:list');

      const selectedConn_ = connections.find(c => c._id === selectedConnection);
      const targetHost = selectedConn_?.host || '';
      const targetLabel = selectedConn_?.label || '';

      // 2. First priority: initiate WebRTC P2P DataChannel signaling for selected server
      socket.emit('telemetry:webrtc:init', {
        connectionId: selectedConnection,
        targetHost,
        targetLabel
      });
      
      // Fallback: If not P2P yet, start WebSocket stream
      if (autoRefresh && isTabVisible && selectedConnection && !peerRef.current) {
        socket.emit('telemetry:start_stream', {
          interval: refreshInterval,
          connectionId: selectedConnection,
          targetHost,
          targetLabel
        });
      }
    });

    // Agent online/offline events from server
    socket.on('agent:list:result', (agents) => {
      setConnectedAgents(new Map(agents.map(a => [a.agentName, a])));
      // Re-request stream in case stream was sent before agents were registered
      if (agents.length > 0 && selectedConnectionRef.current && !isP2PStreamingRef.current) {
        const conn_ = connectionsRef.current.find(c => c._id === selectedConnectionRef.current);
        socket.emit('telemetry:start_stream', {
          interval: refreshIntervalRef.current,
          connectionId: selectedConnectionRef.current,
          targetHost: conn_?.host || '',
          targetLabel: conn_?.label || ''
        });
      }
    });
    socket.on('agent:online', (info) => {
      setConnectedAgents(prev => {
        const next = new Map(prev);
        next.set(info.agentName, info);
        return next;
      });
      // An agent just came online — re-request stream for current server
      if (selectedConnectionRef.current && !isP2PStreamingRef.current) {
        const conn_ = connectionsRef.current.find(c => c._id === selectedConnectionRef.current);
        socket.emit('telemetry:start_stream', {
          interval: refreshIntervalRef.current,
          connectionId: selectedConnectionRef.current,
          targetHost: conn_?.host || '',
          targetLabel: conn_?.label || ''
        });
      }
    });
    socket.on('agent:offline', (info) => {
      setConnectedAgents(prev => {
        const next = new Map(prev);
        next.delete(info.agentName);
        return next;
      });
      setIsSocketStreaming(false);
    });

    // 2. WebRTC P2P negotiation (Direct DataChannel)
    socket.on('telemetry:rtc:ready', async ({ connId }) => {
      try {
        console.log('[WebRTC Telemetry] Negotiating P2P DataChannel for connId:', connId);
        const peer = await createRelayPeer({ socket, relayConnId: connId });
        peerRef.current = peer;
        setIsP2PStreaming(true);
        isP2PStreamingRef.current = true;
        setIsSocketStreaming(false);

        // Tell central server to stop WebSocket relay since P2P is now active
        socket.emit('telemetry:stop_stream');

        peer.onControl((msg) => {
          if (msg.type === 'telemetry:stream') {
            setIsP2PStreaming(true);
            handleIncomingTelemetry(msg.data);
          }
        });

        if (autoRefresh && isTabVisible && selectedConnection) {
          peer.sendControl({
            type: 'telemetry:start_stream',
            interval: refreshInterval,
            connectionId: selectedConnection
          });
        }
      } catch (err) {
        console.log('[WebRTC Telemetry] P2P negotiation failed, falling back to WebSocket relay:', err.message);
        setIsP2PStreaming(false);
        isP2PStreamingRef.current = false;
        if (autoRefresh && isTabVisible && selectedConnection) {
          socket.emit('telemetry:start_stream', {
            interval: refreshInterval,
            connectionId: selectedConnection
          });
        }
      }
    });

    socket.on('telemetry:no_agent', () => {
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
      isP2PStreamingRef.current = false;
    });

    // 3. Fallback WebSocket Relay Stream handler
    socket.on('telemetry:stream', (raw) => {
      if (!isP2PStreamingRef.current) {
        setIsSocketStreaming(true);
        handleIncomingTelemetry(raw);
      }
    });

    socket.on('disconnect', () => {
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
      isP2PStreamingRef.current = false;
    });

    return () => {
      if (peerRef.current) {
        try {
          peerRef.current.sendControl({ type: 'telemetry:stop_stream' });
          peerRef.current.close();
        } catch (_) {}
        peerRef.current = null;
      }
      if (socket.connected) {
        socket.emit('telemetry:stop_stream');
      }
      socket.disconnect();
      socketRef.current = null;
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
    };
  }, [handleIncomingTelemetry]);

  // Synchronize stream interval and target parameters
  useEffect(() => {
    if (peerRef.current && isP2PStreaming) {
      if (autoRefresh && isTabVisible && selectedConnection) {
        peerRef.current.sendControl({
          type: 'telemetry:start_stream',
          interval: refreshInterval,
          connectionId: selectedConnection
        });
      } else {
        peerRef.current.sendControl({ type: 'telemetry:stop_stream' });
        setIsP2PStreaming(false);
      }
      return;
    }

    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    if (autoRefresh && isTabVisible && selectedConnection) {
      const selectedConn_ = connections.find(c => c._id === selectedConnection);
      const targetHost = selectedConn_?.host || '';
      const targetLabel = selectedConn_?.label || '';

      socket.emit('telemetry:start_stream', {
        interval: refreshInterval,
        connectionId: selectedConnection,
        targetHost,
        targetLabel
      });
    } else {
      socket.emit('telemetry:stop_stream');
      setIsSocketStreaming(false);
    }
  }, [autoRefresh, isTabVisible, selectedConnection, refreshInterval, isP2PStreaming, connections]);

  // Active polling lifecycle for remote server metrics
  // Only run HTTP polling when neither WebSocket stream nor P2P DataChannel is active
  useEffect(() => {
    if (!selectedConnection) return;
    // Skip HTTP polling when real-time stream is already delivering telemetry
    if (isSocketStreaming || isP2PStreaming) return;

    let isMounted = true;
    let timeoutId = null;

    const runLoop = async () => {
      if (!isMounted) return;
      if (autoRefresh && isTabVisible) {
        const start = Date.now();
        await fetchMetrics();
        if (!isMounted) return;
        const elapsed = Date.now() - start;
        const delay = Math.max(50, refreshInterval - elapsed);
        timeoutId = setTimeout(runLoop, delay);
      }
    };

    // Immediate first fetch when selectedConnection or interval changes
    runLoop();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [selectedConnection, autoRefresh, refreshInterval, isTabVisible, fetchMetrics, isSocketStreaming, isP2PStreaming]);

  // Fetch apps on-demand when switching to 'apps' tab
  useEffect(() => {
    if (activeTab === 'apps' && selectedConnection) {
      fetchApps();
    }
  }, [activeTab, selectedConnection, fetchApps]);

  // Fetch and poll processes when switching to 'processes' tab
  useEffect(() => {
    if (activeTab === 'processes' && selectedConnection) {
      fetchProcesses(true);

      let procInterval = null;
      if (autoRefresh && isTabVisible) {
        procInterval = setInterval(() => {
          fetchProcesses(true);
        }, Math.max(3000, refreshInterval));
      }

      return () => {
        if (procInterval) clearInterval(procInterval);
      };
    }
  }, [activeTab, selectedConnection, autoRefresh, refreshInterval, isTabVisible, fetchProcesses]);

  const selectedConn = connections.find(c => c._id === selectedConnection);
  const currentApps = appsData[selectedConnection]?.apps || null;
  const currentAppsTimestamp = appsData[selectedConnection]?.timestamp || null;
  const availableApps = useMemo(() => (currentApps || []).filter(a => a.installed), [currentApps]);


  const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    if (i < 0) return '0 B';
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getStatusColor = (percent) => {
    if (percent >= 90) return 'text-red-400';
    if (percent >= 70) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getStatusBg = (percent) => {
    if (percent >= 90) return 'bg-red-500/20';
    if (percent >= 70) return 'bg-amber-500/20';
    return 'bg-emerald-500/20';
  };

  const getTrendIcon = (current, previous) => {
    if (previous === undefined || previous === null) return <Minus size={12} className="text-[var(--text-muted)]" />;
    if (current > previous + 0.5) return <TrendingUp size={12} className="text-red-400" />;
    if (current < previous - 0.5) return <TrendingDown size={12} className="text-emerald-400" />;
    return <Minus size={12} className="text-[var(--text-muted)]" />;
  };

  // Lightweight Chart configuration
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 200,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          callback: (value) => `${value}%`
        }
      },
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  const getCpuChartData = () => ({
    labels: cpuHistory.map(d => d.time),
    datasets: [{
      label: 'CPU Usage',
      data: cpuHistory.map(d => d.value),
      borderColor: 'rgb(99, 102, 241)',
      backgroundColor: 'rgba(99, 102, 241, 0.12)',
      fill: true,
      tension: 0.3
    }]
  });

  const getRamChartData = () => ({
    labels: ramHistory.map(d => d.time),
    datasets: [{
      label: 'RAM Usage',
      data: ramHistory.map(d => d.value),
      borderColor: 'rgb(16, 185, 129)',
      backgroundColor: 'rgba(16, 185, 129, 0.12)',
      fill: true,
      tension: 0.3
    }]
  });

  const getNetworkChartData = () => ({
    labels: networkHistory.map(d => d.time),
    datasets: [
      {
        label: 'Download',
        data: networkHistory.map(d => d.rx),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: true,
        tension: 0.3
      },
      {
        label: 'Upload',
        data: networkHistory.map(d => d.tx),
        borderColor: 'rgb(245, 158, 11)',
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        fill: true,
        tension: 0.3
      }
    ]
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN APP VIEW
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <Activity className="text-[var(--accent-indigo)]" size={20} />
          <div>
            <h1 className="text-base font-semibold leading-tight flex items-center gap-2">
              Server Monitor
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Zap size={10} className="fill-emerald-400" />
                {(isSocketStreaming || isP2PStreaming) ? 'Agent Streaming' : 'Agentless Mode'}
              </span>
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              {/* Status Indicator */}
              <span className={`inline-block w-2 h-2 rounded-full ${
                !autoRefresh 
                  ? 'bg-amber-400' 
                  : !isTabVisible 
                  ? 'bg-amber-500 animate-pulse' 
                  : error 
                  ? 'bg-red-400' 
                  : isP2PStreaming
                  ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse'
                  : isSocketStreaming
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse'
                  : 'bg-emerald-400 animate-pulse'
              }`} />
              <span>
                {!autoRefresh 
                  ? 'Paused' 
                  : !isTabVisible 
                  ? 'Eco Paused (Tab Hidden)' 
                  : error 
                  ? 'Connection Error' 
                  : isP2PStreaming
                  ? 'WebRTC P2P DataChannel (0ms Direct)'
                  : isSocketStreaming
                  ? 'Agent WebSocket Stream (<10ms)'
                  : 'Live — HTTP Polling'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Server selector */}
          <CustomSelect
            value={selectedConnection || ''}
            onChange={(val) => setSelectedConnection(val)}
            placeholder="Select Server"
            className="w-44"
            options={[
              { value: '', label: 'Select Server' },
              ...connections.map(conn => ({
                value: conn._id,
                label: conn.label || `${conn.username}@${conn.host}`
              }))
            ]}
          />

          {/* Polling Interval selector */}
          <div className={!autoRefresh ? 'opacity-50 pointer-events-none' : ''}>
            <CustomSelect
              value={String(refreshInterval)}
              onChange={(val) => setRefreshInterval(Number(val))}
              className="w-44"
              options={[
                { value: '500', label: '500ms (Ultra Realtime)' },
                { value: '1000', label: '1s (High Speed)' },
                { value: '2000', label: '2s (Real-time)' },
                { value: '5000', label: '5s (Balanced)' },
                { value: '10000', label: '10s (Eco)' },
                { value: '30000', label: '30s (Low Power)' },
              ]}
            />
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
              autoRefresh 
                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/30' 
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-primary)]'
            }`}
            title={autoRefresh ? 'Auto-refresh active' : 'Auto-refresh paused'}
          >
            {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
            <span className="hidden sm:inline">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>

          {/* Agent Setup Wizard Button + status badge */}
          {selectedConnection && (() => {
            const agentSt = agentStatuses[selectedConnection];
            const agentRunning = agentSt?.isRunning;
            const agentChecked = !!agentSt;
            // Check if any connected WebSocket agent matches this connection
            const selectedConn_ = connections.find(c => c._id === selectedConnection);
            const connHost = selectedConn_?.host || '';
            const currentHostname = metrics?.system?.hostname || '';
            const liveAgent = connectedAgents.size > 0 && [...connectedAgents.values()].find(
              a => a.host === connHost || 
                   a.ip === connHost ||
                   a.agentName === connHost || 
                   a.agentName === selectedConn_?.label ||
                   (currentHostname && (a.agentName === currentHostname || a.host === currentHostname))
            );
            const isLive = isSocketStreaming || isP2PStreaming || !!liveAgent;
            return (
              <button
                onClick={() => setShowAgentWizard(true)}
                className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer ${
                  isLive
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    : agentRunning
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : agentChecked
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-indigo-600/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/25'
                }`}
                title={
                  isLive
                    ? `Agent "${liveAgent?.agentName ?? 'unknown'}" is streaming live telemetry`
                    : agentRunning
                    ? 'Monitor Agent process is running but not connected to server — check network/token'
                    : agentChecked
                    ? 'Monitor Agent not detected — click to install'
                    : 'Setup / Manage Monitor Agent on this Server'
                }
              >
                <span className={`w-2 h-2 rounded-full ${
                  isLive
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse'
                    : agentRunning
                    ? 'bg-amber-400 animate-pulse'
                    : agentChecked
                    ? 'bg-amber-400'
                    : 'bg-indigo-400 animate-pulse'
                }`} />
                <span className="hidden md:inline">
                  {isLive ? 'Agent Connected' : agentRunning ? 'Agent (No WS)' : agentChecked ? 'Install Agent' : 'Relay Agent'}
                </span>
              </button>
            );
          })()}

          {/* Manual refresh */}
          <button
            onClick={() => {
              fetchMetrics(true);
              if (activeTab === 'apps') fetchApps(true);
            }}
            disabled={loading || appsLoading}
            className="p-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-lg transition-colors disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw size={14} className={loading || appsLoading ? 'animate-spin text-[var(--accent-indigo)]' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'apps', label: 'Applications', icon: Package },
            { id: 'processes', label: 'Processes', icon: ListFilter },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--accent-indigo)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.id === 'processes' && processesData[selectedConnection]?.total > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-900/60 text-indigo-200">
                  {processesData[selectedConnection].total}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'apps' && (
          <div className="flex items-center gap-2">
            {currentAppsTimestamp && (
              <span className="text-[11px] text-[var(--text-muted)]">
                Updated {new Date(currentAppsTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => fetchApps(true)}
              disabled={appsLoading}
              className="flex items-center gap-1 px-2.5 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-md text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              <RotateCw size={12} className={appsLoading ? 'animate-spin text-[var(--accent-indigo)]' : ''} />
              <span>Refresh Apps</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={18} />
            <div className="text-xs">
              <p className="font-semibold text-red-400">Connection Error</p>
              <p className="text-red-300 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!selectedConnection && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Server size={48} className="text-[var(--text-muted)] mb-3 opacity-60" />
            <h3 className="text-base font-semibold mb-1">No Server Selected</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm">
              Select a target server from the dropdown above to view real-time system diagnostics.
            </p>
          </div>
        )}

        {selectedConnection && activeTab === 'overview' && (
          <>
            {!metrics && !error && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <RefreshCw className="animate-spin text-[var(--accent-indigo)] mb-3" size={32} />
                <p className="text-xs text-[var(--text-muted)]">Connecting and streaming system telemetry via Local Relay...</p>
              </div>
            )}

            {metrics && (
              <div className="space-y-4">
                {/* System Info Card */}
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="text-[var(--accent-indigo)]" size={18} />
                    <h2 className="text-sm font-semibold">System Information</h2>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    <InfoItem label="Hostname" value={metrics.system?.hostname || 'N/A'} />
                    <InfoItem label="OS" value={metrics.system?.os || 'N/A'} />
                    <InfoItem label="Kernel" value={metrics.system?.kernel || 'N/A'} />
                    <InfoItem label="Arch" value={metrics.system?.arch || 'N/A'} />
                    <InfoItem 
                      label="Uptime" 
                      value={formatUptime(metrics.system?.uptime)} 
                      icon={<Clock size={12} className="text-[var(--accent-indigo)]" />}
                    />
                    <InfoItem 
                      label="Load Avg" 
                      value={metrics.cpu?.loadAverage?.join(', ') || 'N/A'} 
                    />
                  </div>
                </div>

                {/* Performance Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* CPU Card */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Cpu className="text-indigo-400" size={18} />
                        <h3 className="font-semibold text-sm">CPU Usage (Client Delta)</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getTrendIcon(metrics.cpu?.usage, cpuHistory[cpuHistory.length - 2]?.value)}
                        <span className={`text-xl font-bold font-mono ${getStatusColor(metrics.cpu?.usage)}`}>
                          {metrics.cpu?.usage?.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="h-32 mb-3">
                      {cpuHistory.length > 0 && <Line data={getCpuChartData()} options={chartOptions} />}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Cores:</span>
                        <span className="ml-1 font-medium">{metrics.cpu?.cores || 'N/A'}</span>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Model:</span>
                        <span className="ml-1 font-medium truncate block" title={metrics.cpu?.model}>
                          {metrics.cpu?.model?.split(' ')[0] || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* RAM Card */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="text-emerald-400" size={18} />
                        <h3 className="font-semibold text-sm">Memory Usage</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getTrendIcon(metrics.memory?.usedPercent, ramHistory[ramHistory.length - 2]?.value)}
                        <span className={`text-xl font-bold font-mono ${getStatusColor(metrics.memory?.usedPercent)}`}>
                          {metrics.memory?.usedPercent?.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="h-32 mb-3">
                      {ramHistory.length > 0 && <Line data={getRamChartData()} options={chartOptions} />}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Used:</span>
                        <span className="ml-1 font-medium">{formatBytes(metrics.memory?.used)}</span>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Total:</span>
                        <span className="ml-1 font-medium">{formatBytes(metrics.memory?.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Disk and Network */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Disk Card */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <HardDrive className="text-purple-400" size={18} />
                      <h3 className="font-semibold text-sm">Disk Storage</h3>
                    </div>
                    
                    <div className="space-y-2.5">
                      {metrics.disk?.filesystems?.slice(0, 4).map((fs, idx) => (
                        <div key={idx} className="bg-[var(--bg-tertiary)] rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium truncate max-w-[200px]" title={fs.mount}>
                              {fs.mount}
                            </span>
                            <span className={`text-xs font-bold font-mono ${getStatusColor(fs.usedPercent)}`}>
                              {fs.usedPercent?.toFixed(1)}%
                            </span>
                          </div>
                          <div className="w-full bg-[var(--bg-primary)] rounded-full h-1.5 overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-300 ${getStatusBg(fs.usedPercent)}`}
                              style={{ width: `${Math.min(100, fs.usedPercent)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-muted)]">
                            <span>{formatBytes(fs.used)} used</span>
                            <span>{formatBytes(fs.total)} total</span>
                          </div>
                        </div>
                      ))}
                      {(!metrics.disk?.filesystems || metrics.disk.filesystems.length === 0) && (
                        <div className="text-xs text-[var(--text-muted)] text-center py-4">No disks reported</div>
                      )}
                    </div>
                  </div>

                  {/* Network Card */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Wifi className="text-blue-400" size={18} />
                        <h3 className="font-semibold text-sm">Network Activity (Client Rate)</h3>
                      </div>
                    </div>
                    
                    <div className="h-32 mb-3">
                      {networkHistory.length > 0 && <Line data={getNetworkChartData()} options={{
                        ...chartOptions,
                        scales: {
                          ...chartOptions.scales,
                          y: {
                            ...chartOptions.scales.y,
                            max: undefined,
                            ticks: {
                              color: 'rgba(255, 255, 255, 0.5)',
                              callback: (value) => formatBytes(value) + '/s'
                            }
                          }
                        }
                      }} />}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 flex items-center gap-2">
                        <Download size={14} className="text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-[var(--text-muted)]">Download</div>
                          <div className="font-medium font-mono truncate">{formatBytes(metrics.network?.rxRate)}/s</div>
                        </div>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 flex items-center gap-2">
                        <Upload size={14} className="text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-[var(--text-muted)]">Upload</div>
                          <div className="font-medium font-mono truncate">{formatBytes(metrics.network?.txRate)}/s</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {selectedConnection && activeTab === 'apps' && (
          <div className="space-y-4">
            {appsLoading && !currentApps && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <RefreshCw className="animate-spin text-[var(--accent-indigo)] mb-3" size={32} />
                <p className="text-xs text-[var(--text-muted)]">Detecting installed services and runtimes...</p>
              </div>
            )}

            {currentApps && (
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="text-[var(--accent-indigo)]" size={18} />
                    <h2 className="text-sm font-semibold">Available Applications & Services</h2>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                    {availableApps.length} available
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availableApps.map((app, idx) => (
                    <AppCard 
                      key={app.name || idx} 
                      app={{ ...app, connectionId: selectedConnection }} 
                      onRefresh={() => fetchApps(true)} 
                    />
                  ))}
                  
                  {availableApps.length === 0 && (
                    <div className="col-span-full text-center py-12 text-xs text-[var(--text-muted)] space-y-2">
                      <Package size={32} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
                      <p className="font-semibold text-sm text-[var(--text-primary)]">No monitored applications detected</p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        None of the monitored runtimes or services (Docker, Nginx, Databases, Node, Python, etc.) were found on this server.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: PROCESSES ── */}
        {activeTab === 'processes' && (
          <div className="p-4 space-y-4">
            {(() => {
              const currentProcList = processesData[selectedConnection]?.processes || [];
              const procTimestamp = processesData[selectedConnection]?.timestamp || null;

              // Filter processes by search query
              const query = procSearchQuery.toLowerCase().trim();
              const filtered = currentProcList.filter(p => {
                if (!query) return true;
                return (
                  String(p.pid).includes(query) ||
                  (p.name && p.name.toLowerCase().includes(query)) ||
                  (p.user && p.user.toLowerCase().includes(query)) ||
                  (p.command && p.command.toLowerCase().includes(query))
                );
              });

              // Sort processes
              const sorted = [...filtered].sort((a, b) => {
                let valA = a[procSortField];
                let valB = b[procSortField];
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return procSortDir === 'asc' ? -1 : 1;
                if (valA > valB) return procSortDir === 'asc' ? 1 : -1;
                return 0;
              });

              // Compute top stats
              const topCpu = [...currentProcList].sort((a, b) => (b.cpu || 0) - (a.cpu || 0))[0];
              const topMem = [...currentProcList].sort((a, b) => (b.rssKb || 0) - (a.rssKb || 0))[0];

              return (
                <div className="space-y-4">
                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Total Processes</div>
                        <div className="text-xl font-bold mt-0.5 text-[var(--text-primary)]">
                          {currentProcList.length > 0 ? currentProcList.length : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <ListFilter size={18} />
                      </div>
                    </div>

                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div className="truncate pr-2">
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Top CPU Consumer</div>
                        <div className="text-sm font-bold mt-0.5 text-amber-400 truncate flex items-center gap-1.5">
                          {topCpu ? (
                            <>
                              <span className="truncate">{topCpu.name}</span>
                              <span className="text-[11px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono font-normal">
                                {topCpu.cpu.toFixed(1)}%
                              </span>
                            </>
                          ) : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                        <Cpu size={18} />
                      </div>
                    </div>

                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div className="truncate pr-2">
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Top Memory Consumer</div>
                        <div className="text-sm font-bold mt-0.5 text-purple-400 truncate flex items-center gap-1.5">
                          {topMem ? (
                            <>
                              <span className="truncate">{topMem.name}</span>
                              <span className="text-[11px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono font-normal">
                                {formatBytes(topMem.rssKb * 1024)}
                              </span>
                            </>
                          ) : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
                        <MemoryStick size={18} />
                      </div>
                    </div>
                  </div>

                  {/* Filter & Controls Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] p-2.5 rounded-xl">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        placeholder="Search processes by name, PID, user, command..."
                        value={procSearchQuery}
                        onChange={(e) => setProcSearchQuery(e.target.value)}
                        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg pl-8 pr-8 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50"
                      />
                      {procSearchQuery && (
                        <button
                          onClick={() => setProcSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg p-0.5 text-xs">
                        <span className="text-[10px] text-[var(--text-muted)] font-medium pl-2 pr-1">Sort:</span>
                        {[
                          { id: 'cpu', label: 'CPU' },
                          { id: 'mem', label: 'RAM' },
                          { id: 'pid', label: 'PID' },
                          { id: 'name', label: 'Name' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              if (procSortField === opt.id) {
                                setProcSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
                              } else {
                                setProcSortField(opt.id);
                                setProcSortDir('desc');
                              }
                            }}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                              procSortField === opt.id
                                ? 'bg-indigo-600/30 text-indigo-300 font-semibold'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {opt.label} {procSortField === opt.id && (procSortDir === 'desc' ? '↓' : '↑')}
                          </button>
                        ))}
                      </div>

                      {procTimestamp && (
                        <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">
                          {new Date(procTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      )}

                      <button
                        onClick={() => fetchProcesses(true)}
                        disabled={processesLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        title="Refresh Process List"
                      >
                        <RefreshCw size={12} className={processesLoading ? 'animate-spin text-indigo-400' : ''} />
                        <span>Refresh</span>
                      </button>
                    </div>
                  </div>

                  {/* Processes Table */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse font-sans">
                        <thead className="bg-[var(--bg-tertiary)]/70 text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider sticky top-0 z-10 border-b border-[var(--border-color)] backdrop-blur-md">
                          <tr>
                            <th className="py-2.5 px-3">PID</th>
                            <th className="py-2.5 px-3">User</th>
                            <th className="py-2.5 px-3 text-right">CPU %</th>
                            <th className="py-2.5 px-3 text-right">MEM %</th>
                            <th className="py-2.5 px-3 text-right">RAM (RSS)</th>
                            <th className="py-2.5 px-2 text-center">State</th>
                            <th className="py-2.5 px-3">Time</th>
                            <th className="py-2.5 px-3 min-w-[200px]">Process / Command</th>
                            <th className="py-2.5 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]/50">
                          {sorted.map((proc) => {
                            const isCpuHot = (proc.cpu || 0) >= 50;
                            const isCpuWarm = (proc.cpu || 0) >= 15;
                            const isMemHot = (proc.mem || 0) >= 40;
                            const isMemWarm = (proc.mem || 0) >= 10;

                            return (
                              <tr
                                key={proc.pid}
                                className="hover:bg-[var(--bg-tertiary)]/40 transition-colors group"
                              >
                                <td className="py-2 px-3 font-mono font-bold text-slate-300 text-[11px]">
                                  {proc.pid}
                                </td>

                                <td className="py-2 px-3 text-[11px] text-[var(--text-muted)]">
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-slate-300 font-mono text-[10px]">
                                    {proc.user}
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px]">
                                  <span className={`font-bold ${
                                    isCpuHot ? 'text-red-400' : isCpuWarm ? 'text-amber-400' : 'text-slate-300'
                                  }`}>
                                    {proc.cpu?.toFixed(1) || '0.0'}%
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px]">
                                  <span className={`font-bold ${
                                    isMemHot ? 'text-purple-400' : isMemWarm ? 'text-indigo-300' : 'text-slate-300'
                                  }`}>
                                    {proc.mem?.toFixed(1) || '0.0'}%
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-300">
                                  {formatBytes((proc.rssKb || 0) * 1024)}
                                </td>

                                <td className="py-2 px-2 text-center">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700/50">
                                    {proc.stat}
                                  </span>
                                </td>

                                <td className="py-2 px-3 font-mono text-[10px] text-[var(--text-muted)]">
                                  {proc.time}
                                </td>

                                <td className="py-2 px-3">
                                  <div className="font-semibold text-[var(--text-primary)] truncate max-w-sm flex items-center gap-1.5" title={proc.command}>
                                    <span className="text-indigo-400 font-mono">{proc.name}</span>
                                    {proc.command !== proc.name && (
                                      <span className="text-[10px] text-[var(--text-muted)] font-mono font-normal truncate opacity-70">
                                        {proc.command}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-2 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setKillModal({
                                      isOpen: true,
                                      process: proc,
                                      signal: 'SIGTERM',
                                      loading: false,
                                      error: null
                                    })}
                                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all flex items-center gap-1 mx-auto cursor-pointer"
                                    title={`Kill Process ${proc.name} (PID: ${proc.pid})`}
                                  >
                                    <Trash2 size={10} />
                                    <span>Kill</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}

                          {sorted.length === 0 && (
                            <tr>
                              <td colSpan={9} className="text-center py-12 text-xs text-[var(--text-muted)]">
                                <ListFilter size={28} className="mx-auto text-[var(--text-muted)] opacity-30 mb-2" />
                                {processesLoading ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <RefreshCw size={14} className="animate-spin text-indigo-400" />
                                    <span>Loading process table...</span>
                                  </div>
                                ) : (
                                  <span>No matching processes found.</span>
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── KILL PROCESS CONFIRMATION MODAL ── */}
      {killModal.isOpen && killModal.process && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[var(--bg-primary)] border border-red-500/30 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)] bg-red-500/10">
              <div className="flex items-center gap-2.5 text-red-400">
                <Skull size={18} />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">Kill Process</h3>
              </div>
              <button
                onClick={() => setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null })}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Process Name:</span>
                  <span className="font-bold text-indigo-400">{killModal.process.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">PID:</span>
                  <span className="font-bold text-slate-200">{killModal.process.pid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">User:</span>
                  <span className="text-slate-300">{killModal.process.user}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">CPU / RAM:</span>
                  <span className="text-slate-300">{killModal.process.cpu}% CPU · {formatBytes(killModal.process.rssKb * 1024)}</span>
                </div>
                <div className="pt-1.5 border-t border-[var(--border-color)]/40 text-[10px] text-[var(--text-muted)] truncate" title={killModal.process.command}>
                  {killModal.process.command}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider block mb-1.5">
                  Termination Signal
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKillModal(prev => ({ ...prev, signal: 'SIGTERM' }))}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      killModal.signal === 'SIGTERM'
                        ? 'bg-amber-500/15 border-amber-400/60 text-amber-300'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-slate-500'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Graceful (SIGTERM - 15)</div>
                    <div className="text-[10px] opacity-75 mt-0.5">Allows process to save state & close</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKillModal(prev => ({ ...prev, signal: 'SIGKILL' }))}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      killModal.signal === 'SIGKILL'
                        ? 'bg-red-500/20 border-red-400/60 text-red-300'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-slate-500'
                    }`}
                  >
                    <div className="font-bold text-[11px] text-red-400">Force Kill (SIGKILL - 9)</div>
                    <div className="text-[10px] opacity-75 mt-0.5">Immediately stops frozen processes</div>
                  </button>
                </div>
              </div>

              {killModal.error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{killModal.error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  disabled={killModal.loading}
                  onClick={() => setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null })}
                  className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={killModal.loading}
                  onClick={executeKillProcess}
                  className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-red-600/30 disabled:opacity-50"
                >
                  {killModal.loading ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Terminating...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={12} />
                      <span>Terminate PID {killModal.process.pid}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Relay Agent Setup & Management Wizard */}
      <AgentSetupWizard
        isOpen={showAgentWizard}
        onClose={() => {
          setShowAgentWizard(false);
          // Re-check agent status after wizard closes so the badge updates
          if (selectedConnection) checkAgentStatusForConn(selectedConnection);
        }}
        connection={selectedConn}
        onRefreshStatus={() => {
          fetchMetrics(true);
          if (selectedConnection) checkAgentStatusForConn(selectedConnection);
        }}
        apiFetch={apiFetch}
      />
    </div>
  );
}

function InfoItem({ label, value, icon }) {
  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-2.5 border border-[var(--border-color)]/40">
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xs font-semibold truncate" title={String(value)}>{value}</div>
    </div>
  );
}

function AppActionButtons({ app, actionLoading, onAction, canControlService }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [activeAction, setActiveAction] = useState(null);

  const handleAction = async (action) => {
    setActiveAction(action);
    await onAction(action);
    setActiveAction(null);
    if (action === 'uninstall') setConfirmUninstall(false);
  };

  const isLoading = (action) => actionLoading && activeAction === action;

  return (
    <div className="mt-2.5 space-y-1.5">
      {/* Service Control Row — only for services that have a status */}
      {canControlService && (
        <div className="flex flex-wrap gap-1">
          {app.status === 'running' ? (
            <>
              <button
                onClick={() => handleAction('stop')}
                disabled={actionLoading}
                className="px-2 py-0.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors disabled:opacity-50"
              >
                {isLoading('stop') ? '...' : 'Stop'}
              </button>
              <button
                onClick={() => handleAction('restart')}
                disabled={actionLoading}
                className="px-2 py-0.5 text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded transition-colors disabled:opacity-50"
              >
                {isLoading('restart') ? '...' : 'Restart'}
              </button>
            </>
          ) : (
            <button
              onClick={() => handleAction('start')}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded transition-colors disabled:opacity-50"
            >
              {isLoading('start') ? '...' : 'Start'}
            </button>
          )}
        </div>
      )}

      {/* Package Management Row — all installed apps */}
      <div className="flex flex-wrap gap-1 pt-1 border-t border-[var(--border-color)]/30">
        <button
          onClick={() => handleAction('update')}
          disabled={actionLoading}
          title={`Update ${app.name} to latest version via package manager`}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded transition-colors disabled:opacity-50"
        >
          {isLoading('update') ? (
            <RefreshCw size={9} className="animate-spin" />
          ) : (
            <Zap size={9} />
          )}
          {isLoading('update') ? 'Updating...' : 'Update'}
        </button>

        {confirmUninstall ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-red-400 font-medium">Confirm?</span>
            <button
              onClick={() => handleAction('uninstall')}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded transition-colors disabled:opacity-50"
            >
              {isLoading('uninstall') ? 'Removing...' : 'Yes, Remove'}
            </button>
            <button
              onClick={() => setConfirmUninstall(false)}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border-color)] rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmUninstall(true)}
            disabled={actionLoading}
            title={`Uninstall ${app.name} from the server via package manager`}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors disabled:opacity-50"
          >
            <AlertTriangle size={9} />
            Uninstall
          </button>
        )}
      </div>
    </div>
  );
}

function AppCard({ app, onRefresh }) {
  const { apiFetch } = useApp();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  
  const iconMap = {
    docker: Box,
    nginx: Server,
    mongodb: Database,
    node: Zap,
    python: Activity,
  };
  
  const Icon = iconMap[app.name?.toLowerCase()] || Package;
  
  const handleAction = async (action) => {
    setActionLoading(true);
    setActionResult(null);
    
    try {
      const response = await apiFetch('/api/server-monitor/app-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: app.connectionId,
          appName: app.name,
          action: action
        })
      });
      
      const data = await response.json();
      setActionResult(data);
      
      // In-place refresh after action without full window.location.reload()
      if (data.success && onRefresh) {
        setTimeout(() => onRefresh(), 1500);
      }
    } catch (err) {
      setActionResult({ success: false, error: err.message });
    } finally {
      setActionLoading(false);
    }
  };
  
  // Service control (Start/Stop/Restart) — only for known managed services with a status
  const canControlService = !!(app.installed && app.status && ['docker', 'nginx', 'mongodb', 'mysql', 'postgresql', 'redis'].includes(app.name?.toLowerCase()));
  // Package management (Update/Uninstall) — any installed app
  const canPackageManage = app.installed;
  
  return (
    <div className={`bg-[var(--bg-tertiary)] rounded-lg p-3 border transition-colors ${
      app.installed ? 'border-[var(--border-color)] hover:border-[var(--accent-indigo)]' : 'border-dashed border-[var(--border-color)]/50 opacity-60'
    }`}>
      <div className="flex items-start gap-3">
        <div className="p-2 bg-[var(--bg-primary)] rounded-lg shrink-0">
          <Icon size={18} className="text-[var(--accent-indigo)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <h3 className="font-semibold text-xs capitalize truncate">{app.name}</h3>
            {app.installed ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Installed</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-[var(--text-muted)]">Not Found</span>
            )}
          </div>

          <p className="text-[11px] text-[var(--text-muted)] mb-1 truncate">{app.version || 'Version undetected'}</p>
          
          {app.path && (
            <p className="text-[10px] text-[var(--text-muted)] font-mono truncate" title={app.path}>
              {app.path}
            </p>
          )}

          {app.status && (
            <div className="flex items-center gap-1 mt-1.5">
              {app.status === 'running' ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : (
                <AlertCircle size={12} className="text-amber-400" />
              )}
              <span className={`text-[10px] font-medium capitalize ${app.status === 'running' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {app.status}
              </span>
            </div>
          )}
          
          {/* Action buttons */}
          {(canControlService || canPackageManage) && (
            <AppActionButtons
              app={app}
              actionLoading={actionLoading}
              onAction={handleAction}
              canControlService={canControlService}
            />
          )}
          
          {/* Action result message */}
          {actionResult && (
            <div
              className={`mt-1.5 text-[10px] ${actionResult.success ? 'text-emerald-400' : 'text-red-400'}`}
              title={actionResult.output || actionResult.error}
            >
              {actionResult.success
                ? `✓ ${actionResult.action ? actionResult.action.charAt(0).toUpperCase() + actionResult.action.slice(1) : 'Action'} successful`
                : `✗ ${actionResult.error || actionResult.output?.split('\n').find(l => l.trim()) || 'Action failed'}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
