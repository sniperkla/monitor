'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Folder, File as FileIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw, 
  Download, Upload, Trash2, FolderPlus, Search, Grid, List as ListIcon,
  AlertCircle, Pen, FileText, X, Save, TriangleAlert, Eye,
  Copy, Scissors, Clipboard, Wifi, AtSign, Replace, Columns, Rows,
  Sparkles, Brain, Clock, Settings2, Languages, CornerDownLeft, 
  MessagesSquare, BrainCircuit, ShieldAlert, Terminal,
  Cpu, Zap, Flame, Box, Layers, CircleCheckBig, Lock, Unlock
} from 'lucide-react';
import io from 'socket.io-client';
import { 
  createRelayPeer, 
  DC, 
  streamUpload, 
  streamTarUpload, 
  streamDownload, 
  getTarHeaderBlocks, 
  calculateTarTotalSize,
  getPacingDelayMs,
} from '@/lib/webrtc-relay';
import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import MacOSModalWindow from '@/components/MacOSModalWindow';
import ThemeSelect from '@/components/common/ThemeSelect';

import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';

// Module-level socket pool — survives React remounts (e.g. Split pane restructuring).
// Keyed by connectionId. On unmount we keep the socket alive for POOL_TTL ms;
// if the same connectionId remounts within that time, we reuse it seamlessly.
const POOL_TTL = 6000;
const HEALTH_CHECK_TTL_MS = 8000;
const SSH_PING_TIMEOUT_MS = 5000;
const _fmSocketPool = typeof window !== 'undefined'
  ? (window.__fmSocketPool || (window.__fmSocketPool = new Map()))
  : new Map();

if (typeof window !== 'undefined' && !window.__fmSocketPoolUnloadBound) {
  window.__fmSocketPoolUnloadBound = true;
  // Only disconnect sockets on actual page unload, not on tab hide/minimize.
  // 'pagehide' fires on tab switches too, which kills active SSH sessions.
  const disconnectPool = () => {
    _fmSocketPool.forEach((entry, pooledConnectionId) => {
      clearTimeout(entry?.cleanupTimer);
      try {
        entry?.socket?.emit?.('ssh:disconnect');
        entry?.socket?.disconnect?.();
      } catch (err) {
        console.warn('Failed to dispose pooled FileManager socket:', err);
      }
    });
    _fmSocketPool.clear();
  };
  window.addEventListener('beforeunload', disconnectPool);
}

const SFTP_REUSE_EVENTS = [
  'heartbeat:pong', 'ssh:pong', 'sftp:list', 'sftp:file_content', 'sftp:file_base64', 'sftp:action_success',
  'sftp:progress', 'sftp:download_start', 'sftp:download_chunk', 'sftp:download_done',
  'sftp:error', 'ssh:error', 'ssh:idle_timeout',
];
export default function FileManager({ 
  connectionId, 
  connection, 
  connectionName,
  isSplit = false,
  // Only the active split pane may respond to global keyboard/paste events
  isActivePane = true,
  initialPath = '.',
  onClosePane,
  onSplit,
  onPathChange
}) {
  const { t } = useTranslation();
  const { state: appState, dispatch: appDispatch, apiFetch } = useApp();
  useEffect(() => {
    console.log('FileManager scope apiFetch:', typeof apiFetch, !!apiFetch);
  }, [apiFetch]);

  const { state: osState, addNotification, removeNotification, updateNotification, showConfirm, showPrompt } = useOS();
  const { vaultStatus } = useVault();
  const { clipboard } = appState;

  const setClipboard = (payload) => appDispatch({ type: 'SET_CLIPBOARD', payload });
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [files, setFiles] = useState([]);
  const filesRef = useRef([]);
  useEffect(() => { filesRef.current = files; }, [files]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('connecting'); // connecting, ssh_connecting, ready, error
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [deletingFiles, setDeletingFiles] = useState(new Set());
  const [renamingFile, setRenamingFile] = useState(null); // { filename, value }
  const renameInputRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]); // global search results
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearchMode = searchQuery.trim().length > 0;
  const searchDebounceRef = useRef(null);
  const pathPreviewDebounceRef = useRef(null);
  const [latency, setLatency] = useState(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;
  const [reconnectAlert, setReconnectAlert] = useState(null);
  const socketRef = useRef(null);
  const rtcPeerRef = useRef(null);      // WebRTC RelayPeer — set when local relay + P2P ICE succeeds
  const relayConnIdRef = useRef(null);  // relayConnId from relay:rtc:ready signal
  const [rtcActive, setRtcActive] = useState(false); // true when WebRTC P2P DataChannels are open
  const lastHealthOkRef = useRef(false);
  const lastHealthCheckAtRef = useRef(0);
  const healthCheckPromiseRef = useRef(null);
  const dbUriRef = useRef(appState.dbConfig?.uri || '');
  const pendingTransferResumeRef = useRef(null);
  const reconnectNoticeAtRef = useRef(0);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [lastSelectedFile, setLastSelectedFile] = useState(null);
  
  // Editor State
  const [editor, setEditor] = useState({ visible: false, file: null, content: '', saving: false });
  const [preview, setPreview] = useState({ visible: false, file: null, content: '', loading: false, type: 'text' });
  const [infoModal, setInfoModal] = useState({ visible: false, file: null, sizeLoading: false, realSize: null });
  const editorTextareaRef = useRef(null);
  const [mentionState, setMentionState] = useState({ active: false, query: '', results: [], selectedIndex: 0, triggerPos: 0 });

  // Find / Replace state
  const [findBar, setFindBar] = useState({ visible: false, query: '', replace: '', matchCase: false, useRegex: false, replaceVisible: false, currentIndex: 0 });
  const findInputRef = useRef(null);

  // Transfer Progress State
  const [transfer, setTransfer] = useState(null); // { filename, progress, action, waiting, countdown }
  const [isDragging, setIsDragging] = useState(false);
  const [transferCountdown, setTransferCountdown] = useState(0);
  const transferCountdownRef = useRef(0);
  useEffect(() => { transferCountdownRef.current = transferCountdown; }, [transferCountdown]);
  const [sshMode, setSshMode] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('ssh_monitor_ssh_mode') || 'server' : 'server'));
  const isRelayMode = sshMode === 'local';
  const [uploadCpuMode, setUploadCpuMode] = useState(() => {
    if (typeof window === 'undefined') return 'eco';
    const currentSshMode = localStorage.getItem('ssh_monitor_ssh_mode') || 'server';
    return currentSshMode === 'local' ? localStorage.getItem('ssh_monitor_upload_cpu_mode') || 'balanced' : 'eco';
  });
  const [cpuThermalWarning, setCpuThermalWarning] = useState(false);
  const [autoCoolEnabled, setAutoCoolEnabled] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('ssh_monitor_auto_cool') === 'true' : true));

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__uploadCpuMode = isRelayMode ? uploadCpuMode : 'eco';
    }
  }, [uploadCpuMode, isRelayMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncSshMode = () => {
      const nextMode = localStorage.getItem('ssh_monitor_ssh_mode') || 'server';
      setSshMode(nextMode);
      if (nextMode === 'server') {
        setUploadCpuMode('eco');
        window.__uploadCpuMode = 'eco';
      } else {
        const savedRelayMode = localStorage.getItem('ssh_monitor_upload_cpu_mode') || 'balanced';
        setUploadCpuMode(savedRelayMode);
        window.__uploadCpuMode = savedRelayMode;
      }
    };

    syncSshMode();
    window.addEventListener('ssh-mode-changed', syncSshMode);
    return () => window.removeEventListener('ssh-mode-changed', syncSshMode);
  }, []);

  const changeUploadCpuMode = (mode) => {
    if (!isRelayMode && mode !== 'eco') {
      setUploadCpuMode('eco');
      if (typeof window !== 'undefined') window.__uploadCpuMode = 'eco';
      return;
    }

    const nextMode = !isRelayMode ? 'eco' : mode;
    setUploadCpuMode(nextMode);
    if (typeof window !== 'undefined') {
      window.__uploadCpuMode = nextMode;
      if (isRelayMode) localStorage.setItem('ssh_monitor_upload_cpu_mode', nextMode);
    }
  };

  // ── Automatic Thermal Pressure / High CPU Monitor ───────────────────────
  // Monitors event loop lag during active uploads. If high lag is sustained
  // (signaling CPU throttling or high thermals), triggers alert or auto-eco switch.
  useEffect(() => {
    if (transfer?.action !== 'upload' || uploadCpuMode === 'eco') {
      setCpuThermalWarning(false);
      return;
    }

    let consecutiveLagCount = 0;
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      // Expecting ~300ms. If delta > 550ms, the main thread/CPU is experiencing high lag/thermal pressure
      if (delta > 550) {
        consecutiveLagCount++;
        if (consecutiveLagCount >= 3) {
          if (autoCoolEnabled) {
            changeUploadCpuMode('eco');
            addNotification({
              title: '❄️ Auto-Cool Activated',
              message: 'High CPU load detected. Switched to Eco mode to keep your computer cool.',
              type: 'info',
              duration: 4000,
            });
            setCpuThermalWarning(false);
          } else {
            setCpuThermalWarning(true);
          }
        }
      } else {
        consecutiveLagCount = Math.max(0, consecutiveLagCount - 1);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [transfer?.action, uploadCpuMode, autoCoolEnabled, addNotification]);

  const lastDownloadRef = useRef(null); // { file, offset }
  const transferRef = useRef(null); // Keep a ref of transfer for loop cancellation
  const userCancelledUploadRef = useRef(false); // true when user explicitly clicks X to cancel upload — suppresses reconnect
  const activeAckCleanupRef = useRef(null);         // cancel pending ACK promise immediately on abort
  const activeHandshakeCleanupRef = useRef(null);   // cancel pending handshake promise immediately on abort
  const reconnectTimerRef = useRef(null);
  const emptyRetryPathRef = useRef('');
  const deleteBatchRef = useRef({ count: 0, total: 0, toastId: null });
  const lastDeleteToastRef = useRef(0); // Per-instance debounce for delete success toast
  const refreshTimeoutRef = useRef(null); // Per-instance refresh debounce (avoids split-pane collision on window._refreshTimeout)
  const transferSafetyTimerRef = useRef(null); // Safety timeout for stuck copy/move transfers

  // AI State
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAnswer, setAiAnswer] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);
  const [aiPanelSize, setAiPanelSize] = useState({ width: 380, height: 480 });
  const [aiPanelPos, setAiPanelPos] = useState({ x: 200, y: 100 });
  const [aiPanelContentRef] = [useRef(null)];
  const [aiMode, setAiMode] = useState('manual'); // 'manual' | 'auto'
  const [autoMode, setAutoMode] = useState(false);
  const sshAiPrefs = osState?.sshAiPrefs || { preferSudo: true, aiModel: 'auto' };
  const { setSshAiPrefs } = useOS();
  const isLoggedIn = true; // Assume logged in for now to show AI button

  // Ref to track latest currentPath and active toast
  const currentPathRef = useRef(currentPath);
  const toastRef = useRef(null);
  const uploadInputRef = useRef(null);
  const downloadBufferRef = useRef({});
  
  const [uploadQueue, setUploadQueue] = useState([]); // Array of { file, path, offset }
  const uploadQueueRef = useRef([]);
  useEffect(() => { uploadQueueRef.current = uploadQueue; }, [uploadQueue]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__sshMonitorActiveUploadCount = transfer?.action === 'upload' ? 1 : 0;
    return () => {
      if (transfer?.action === 'upload') window.__sshMonitorActiveUploadCount = 0;
    };
  }, [transfer?.action]);
  const handleFileUploadRef = useRef(null);
  
  useEffect(() => { 
    currentPathRef.current = currentPath; 
    if (!isEditingPath) {
      setPathInput(currentPath);
    }
    // Notify parent of path change so it can persist current folder
    if (onPathChange && currentPath && currentPath !== '.') {
      onPathChange(currentPath);
    }
  }, [currentPath, isEditingPath, onPathChange]);

  useEffect(() => {
    // Close context menu on click elsewhere
    const handleClick = () => setContextMenu({ ...contextMenu, visible: false });
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Ref to hold connection object to access inside effect without triggering it
  const connectionRef = useRef(connection);
  useEffect(() => { connectionRef.current = connection; }, [connection]);

  // Auto-reconnect when vault unlocks (dbUri becomes available)
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const requestReconnect = useCallback((message = 'Connection lost. Reconnecting...', options = {}) => {
    const { preserveTransfer = false, notificationMessage } = options;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    setStatus('error');
    setError(message);
    setLoading(false);
    setReconnectAlert({
      message: notificationMessage || message,
      preserveTransfer,
      attempts: reconnectAttemptsRef.current + 1,
    });

    if (preserveTransfer && transferRef.current) {
      const interruptedTransfer = {
        ...transferRef.current,
        waiting: true,
        reconnecting: true,
      };
      setTransfer(interruptedTransfer);
      transferRef.current = interruptedTransfer;

      if (interruptedTransfer.action === 'download' && lastDownloadRef.current) {
        pendingTransferResumeRef.current = {
          type: 'download',
          file: lastDownloadRef.current.file,
          offset: lastDownloadRef.current.offset || 0,
        };
      } else if (interruptedTransfer.action === 'upload' || uploadQueueRef.current.length > 0) {
        pendingTransferResumeRef.current = {
          type: 'upload',
        };
      }
    } else {
      setTransfer(null);
      transferRef.current = null;
      pendingTransferResumeRef.current = null;
    }

    const now = Date.now();
    if (notificationMessage && now - reconnectNoticeAtRef.current > 1500) {
      reconnectNoticeAtRef.current = now;
      addNotification({
        title: 'Reconnecting',
        message: notificationMessage,
        type: 'warning',
      });
    }

    reconnectAttemptsRef.current += 1;
    if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
      setReconnectAlert({
        message: preserveTransfer
          ? 'Reconnect paused after several tries. Your transfer state is preserved — use Retry Connection to continue safely.'
          : 'Reconnect paused after several tries. Use Retry Connection to try again.',
        preserveTransfer,
        attempts: reconnectAttemptsRef.current,
        exhausted: true,
      });
      return;
    }
    const backoffMs = Math.min(800 * reconnectAttemptsRef.current, 5000);
    reconnectTimerRef.current = setTimeout(() => {
      setReconnectNonce((n) => n + 1);
    }, backoffMs);
  }, [addNotification]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const ensureSocketReady = useCallback((actionLabel = 'complete this action') => {
    if (socketRef.current?.connected && statusRef.current === 'ready') {
      return true;
    }

    addNotification({
      title: 'Reconnecting',
      message: `File manager is reconnecting. Please wait a moment, then ${actionLabel}.`,
      type: 'warning'
    });
    requestReconnect('Connection expired after idle time. Reconnecting...', {
      preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
    });
    return false;
  }, [addNotification, requestReconnect]);

  const pingConnection = useCallback(() => {
    const sock = socketRef.current;
    if (!sock?.connected) {
      lastHealthOkRef.current = false;
      return Promise.resolve(false);
    }

    // If an upload or download transfer is active, data is actively flowing — connection is healthy
    if (transferRef.current) {
      lastHealthOkRef.current = true;
      lastHealthCheckAtRef.current = Date.now();
      return Promise.resolve(true);
    }

    if (healthCheckPromiseRef.current) return healthCheckPromiseRef.current;

    healthCheckPromiseRef.current = new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        lastHealthOkRef.current = false;
        resolve(false);
      }, SSH_PING_TIMEOUT_MS);

      const handler = (data) => {
        cleanup();
        const ok = !!data?.ok;
        lastHealthOkRef.current = ok;
        lastHealthCheckAtRef.current = Date.now();
        resolve(ok);
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        sock.off('ssh:pong', handler);
        healthCheckPromiseRef.current = null;
      };

      sock.once('ssh:pong', handler);
      sock.emit('ssh:ping');
    });

    return healthCheckPromiseRef.current;
  }, []);

  const ensureSocketReadyAsync = useCallback(async (actionLabel = 'complete this action') => {
    const sock = socketRef.current;
    if (!sock?.connected || statusRef.current !== 'ready') {
      addNotification({
        title: 'Reconnecting',
        message: `File manager is reconnecting. Please wait a moment, then ${actionLabel}.`,
        type: 'warning',
      });
      requestReconnect('Connection is not ready. Reconnecting...', {
        preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
      });
      return false;
    }

    if (transferRef.current) {
      lastHealthOkRef.current = true;
      lastHealthCheckAtRef.current = Date.now();
      return true;
    }

    const cacheFresh = Date.now() - lastHealthCheckAtRef.current < HEALTH_CHECK_TTL_MS;
    if (cacheFresh && lastHealthOkRef.current) return true;

    const ok = await pingConnection();
    if (!ok) {
      requestReconnect('SSH session is no longer active. Reconnecting...', {
        preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
        notificationMessage: 'Your SSH session expired while you were away. Reconnecting before continuing.',
      });
      return false;
    }
    return true;
  }, [addNotification, pingConnection, requestReconnect]);

  const resumePendingUploads = useCallback(() => {
    const queue = uploadQueueRef.current;
    if (!queue.length) return;
    if (transferRef.current?.action === 'upload') return;

    const next = queue[0];
    if (!next?.file) return;

    pendingTransferResumeRef.current = null;
    setTimeout(() => {
      if (statusRef.current !== 'ready' || !socketRef.current?.connected) return;
      handleFileUploadRef.current?.(null, next.file, next.offset || 0, null, next.displayName);
    }, 250);
  }, []);

  const isTransferChannelError = useCallback((errOrMessage) => {
    const rawMessage = typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage?.message || '';
    return /connection .*closed|channel .*closed|socket .*disconnected|broken pipe|not connected|no response from server|eof|handshake timeout|acknowledg(e)?ment timeout|upload completion timeout/i.test(rawMessage);
  }, []);

  useEffect(() => {
    const newUri = appState.dbConfig?.uri || '';
    const prevUri = dbUriRef.current;
    dbUriRef.current = newUri;
    // Only trigger reconnect if vault just unlocked (uri was empty, now has value)
    // and we're currently in an error or connecting state
    if (newUri && !prevUri && (statusRef.current === 'error' || statusRef.current === 'connecting' || statusRef.current === 'ssh_connecting')) {
      console.log('🔓 Vault unlocked — retrying SSH connection with private DB URI');
      setReconnectNonce(n => n + 1);
    }
  }, [appState.dbConfig?.uri]);

  // Real-time mode switching: when the user swaps Server ↔ Local Relay in Settings,
  // immediately disconnect and purge pooled socket so the new mode takes effect cleanly.
  useEffect(() => {
    const handleModeChange = () => {
      const newMode = localStorage.getItem('ssh_monitor_ssh_mode') || 'server';
      console.log(`🔄 [FileManager] SSH mode changed to "${newMode}" — purging pooled socket & reconnecting`);
      const poolEntry = _fmSocketPool.get(connectionId);
      if (poolEntry?.socket) {
        try {
          poolEntry.socket.emit('ssh:disconnect');
          poolEntry.socket.disconnect();
        } catch (_) {}
        _fmSocketPool.delete(connectionId);
      }
      if (socketRef.current) {
        try {
          socketRef.current.emit('ssh:disconnect');
          socketRef.current.disconnect();
        } catch (_) {}
        socketRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      setReconnectAlert(null);
      setReconnectNonce(n => n + 1);
    };
    window.addEventListener('ssh-mode-changed', handleModeChange);
    return () => window.removeEventListener('ssh-mode-changed', handleModeChange);
  }, [connectionId]);

  useEffect(() => {
    if (vaultStatus === 'loading') return;
    if (vaultStatus === 'locked') {
      setStatus('error');
      setError('vault_not_ready');
      return;
    }

    const poolEntry = _fmSocketPool.get(connectionId);
    const isReused = !!(
      poolEntry?.socket?.connected &&
      poolEntry?.status === 'ready'
    );

    let newSocket;
    let timeout = null;
    let reuseInitTimeout = null;
    let pendingRefreshPath = null;
    let reusedSocket = false;

    setError(null);

    if (isReused) {
      // ── SEAMLESS REUSE (e.g. Split pane) — no reconnect ──
      clearTimeout(poolEntry.cleanupTimer);
      newSocket = poolEntry.socket;
      _fmSocketPool.delete(connectionId);
      reusedSocket = true;

      // Restore state instantly from pool snapshot, prioritizing initialPath if not default
      const savedPath = (initialPath && initialPath !== '.') ? initialPath : (poolEntry.currentPath || '.');
      const pooledFiles = poolEntry.files || [];
      setCurrentPath(savedPath);
      currentPathRef.current = savedPath;
      setFiles(pooledFiles);
      filesRef.current = pooledFiles;
      setStatus(pooledFiles.length > 0 ? 'ready' : 'ssh_connecting');
      setLoading(true);

      // Remove stale handlers from previous mount before re-registering
      SFTP_REUSE_EVENTS.forEach(ev => newSocket.removeAllListeners(ev));
      pendingRefreshPath = savedPath;

      console.log('♻️ FileManager: reusing socket for', connectionId, '— no reconnect');
    } else {
      // ── NEW CONNECTION ──
      console.log('📂 Initializing FileManager for:', connectionId, 'at:', initialPath);
      setCurrentPath(initialPath);
      currentPathRef.current = initialPath;
      setLoading(true);
      setStatus('connecting');
      setRtcActive(false); // reset WebRTC badge on every new connection

      const currentDbUri = dbUriRef.current;
      newSocket = io({
        path: '/api/socket',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
        query: { dbUri: currentDbUri }
      });

      timeout = setTimeout(() => {
        if (statusRef.current === 'connecting' || statusRef.current === 'ssh_connecting') {
          setStatus('error');
          setError(t('files.status.timeout') || 'Connection timed out. Please check if the server is reachable.');
          setLoading(false);
        }
      }, 15000);

      newSocket.on('connect', () => {
        console.log('🔌 Socket connected, sending ssh:connect');
        setStatus('ssh_connecting');
        lastHealthOkRef.current = false;
        const shouldPreferProvidedConnection =
          !!connectionRef.current && connectionRef.current.storage !== 'db';
        newSocket.emit('ssh:connect', {
          connectionId,
          connection: shouldPreferProvidedConnection ? connectionRef.current : undefined,
          useShell: false,
          preferProvidedConnection: shouldPreferProvidedConnection,
          preferredRelay: typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_preferred_relay') || undefined) : undefined,
          sshMode: typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_ssh_mode') || 'server') : 'server',
        });
      });

      newSocket.on('ssh:connected', () => {
        console.log('✅ SSH connected, listing files at:', currentPathRef.current);
        reconnectAttemptsRef.current = 0;
        setReconnectAlert(null);
        lastHealthOkRef.current = true;
        lastHealthCheckAtRef.current = Date.now();
        setStatus('ready');
        newSocket.emit('sftp:list', currentPathRef.current);
        appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'online' } });
        window.dispatchEvent(new CustomEvent('connection-status-update', { detail: { connectionId, status: 'online' } }));

        const pendingResume = pendingTransferResumeRef.current;
        if (pendingResume?.type === 'upload' && uploadQueueRef.current.length > 0) {
          addNotification({
            title: 'Connection restored',
            message: `${uploadQueueRef.current.length} queued upload${uploadQueueRef.current.length === 1 ? '' : 's'} can continue now.`,
            type: 'info',
          });
          resumePendingUploads();
        } else if (pendingResume?.type === 'download' && pendingResume.file) {
          addNotification({
            title: 'Connection restored',
            message: `Resuming download of ${pendingResume.file.filename}...`,
            type: 'info',
          });
        }
      });
    }

    if (reusedSocket) {
      const pooledPingTimeout = setTimeout(() => {
        if (statusRef.current === 'ready' && (filesRef.current.length > 0 || transferRef.current)) return;
        console.warn('⚠️ Pooled socket SSH health check timed out. Reconnecting fresh session.');
        try {
          newSocket.emit('ssh:disconnect');
          newSocket.disconnect();
        } catch (err) {
          console.warn('Failed to dispose stale pooled socket:', err);
        }
        setStatus('connecting');
        setLoading(true);
        setError('Previous session expired. Reconnecting...');
        setReconnectNonce((n) => n + 1);
      }, SSH_PING_TIMEOUT_MS + 500);

      newSocket.once('ssh:pong', (data) => {
        clearTimeout(pooledPingTimeout);
        if (data?.ok) {
          lastHealthOkRef.current = true;
          lastHealthCheckAtRef.current = Date.now();
          return;
        }
        console.warn('⚠️ Pooled socket lost its SSH backend. Starting a fresh session.');
        try {
          newSocket.emit('ssh:disconnect');
          newSocket.disconnect();
        } catch (err) {
          console.warn('Failed to dispose stale pooled socket after failed ping:', err);
        }
        setStatus('connecting');
        setLoading(true);
        setError('Previous session expired. Reconnecting...');
        setReconnectNonce((n) => n + 1);
      });
      newSocket.emit('ssh:ping');
    }

    newSocket.on('heartbeat:pong', (sentTimestamp) => {
      const now = Date.now();
      setLatency(now - sentTimestamp);
    });

    newSocket.on('ssh:closed', () => {
      // Tear down WebRTC peer when SSH session closes
      if (rtcPeerRef.current) {
        try { rtcPeerRef.current.close(); } catch (_) {}
        rtcPeerRef.current = null;
        setRtcActive(false);
      }
      // If the user intentionally cancelled an upload, the SFTP write stream
      // destruction can trigger ssh:closed — do NOT reconnect in that case.
      if (userCancelledUploadRef.current) {
        userCancelledUploadRef.current = false;
        console.log('[ssh:closed] Suppressed reconnect — user intentionally cancelled upload.');
        return;
      }
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
      // Clean up any pending delete operations
      if (deleteBatchRef.current.toastId) {
        removeNotification(deleteBatchRef.current.toastId);
        deleteBatchRef.current = { count: 0, total: 0, toastId: null };
        addNotification({ title: t('files.status.error'), message: t('files.errors.deleteDisconnect', 'Deletion interrupted — connection lost. Please refresh and verify.'), type: 'error' });
      }
      setDeletingFiles(new Set());
      requestReconnect('SSH session closed after idle time. Reconnecting...', {
        preserveTransfer: !!transferRef.current,
        notificationMessage: transferRef.current?.action === 'download'
          ? 'SSH disconnected while downloading. Reconnecting and resuming from the last received byte.'
          : transferRef.current?.action === 'upload' || uploadQueueRef.current.length > 0
            ? 'SSH disconnected while uploading. Reconnecting and keeping your upload queue.'
            : 'SSH session closed. Reconnecting now.',
      });
    });

    newSocket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      // Tear down WebRTC peer on socket disconnect
      if (rtcPeerRef.current) {
        try { rtcPeerRef.current.close(); } catch (_) {}
        rtcPeerRef.current = null;
        setRtcActive(false);
      }
      // If the user intentionally cancelled an upload, the resulting socket noise
      // should not be treated as an unexpected disconnect requiring reconnect.
      if (userCancelledUploadRef.current) {
        userCancelledUploadRef.current = false;
        console.log('[disconnect] Suppressed reconnect — user intentionally cancelled upload.');
        return;
      }
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
      // Clean up any pending delete operations
      if (deleteBatchRef.current.toastId) {
        removeNotification(deleteBatchRef.current.toastId);
        deleteBatchRef.current = { count: 0, total: 0, toastId: null };
        addNotification({ title: t('files.status.error'), message: t('files.errors.deleteDisconnect', 'Deletion interrupted — connection lost. Please refresh and verify.'), type: 'error' });
      }
      setDeletingFiles(new Set());
      requestReconnect(reason === 'io server disconnect'
        ? 'Session expired after idle time. Reconnecting...'
        : 'Socket disconnected. Reconnecting...', {
        preserveTransfer: !!transferRef.current,
        notificationMessage: transferRef.current?.action === 'download'
          ? 'Connection dropped during download. Reconnecting and resuming automatically.'
          : transferRef.current?.action === 'upload' || uploadQueueRef.current.length > 0
            ? 'Connection dropped during upload. Reconnecting and keeping the upload queue.'
            : 'Connection dropped. Reconnecting now.',
      });
    });

    newSocket.on('connect_error', (err) => {
      const msg = err?.message || 'Unable to reconnect';
      setStatus('error');
      setError(msg);
      setLoading(false);
      setReconnectAlert({
        message: transferRef.current?.action === 'download'
          ? 'Reconnect attempt failed while resuming your download. We will keep trying automatically.'
          : transferRef.current?.action === 'upload' || uploadQueueRef.current.length > 0
            ? 'Reconnect attempt failed while your upload queue is paused. We will keep trying automatically.'
            : msg,
        preserveTransfer: !!transferRef.current,
        attempts: reconnectAttemptsRef.current,
      });
    });

    newSocket.on('sftp:list', (data) => {
      // Normalize paths before comparing to avoid '.' vs './' mismatches
      const normReceived = (data.path || '.').replace(/\/$/, '') || '.';
      const normCurrent  = (currentPathRef.current || '.').replace(/\/$/, '') || '.';

      // If the client is still at the initial '.' state, the server may have resolved it
      // to an absolute path (e.g. '/home/ubuntu'). Accept the response and sync currentPath
      // to the server's resolved path so future navigation uses the real absolute path.
      if (normCurrent === '.') {
        if (normReceived !== '.') {
          setCurrentPath(normReceived);
          currentPathRef.current = normReceived;
        }
      } else if (normReceived !== normCurrent) {
        console.warn('⚠️ Ignoring stale file list for:', data.path, 'current is:', currentPathRef.current);
        return;
      }

      console.log('📋 Received file list:', data.files?.length);
      setFiles(data.files || []);
      filesRef.current = data.files || [];
      setLoading(false);
      setStatus('ready');
      clearTimeout(timeout);
      clearTimeout(reuseInitTimeout);
    });

    if (pendingRefreshPath) {
      newSocket.emit('sftp:list', pendingRefreshPath);
      if (reusedSocket) {
        reuseInitTimeout = setTimeout(() => {
          if (filesRef.current.length > 0 || !socketRef.current?.connected) return;
          console.warn('⚠️ Reused FileManager socket did not refresh file list in time. Reconnecting fresh session.');
          try {
            newSocket.emit('ssh:disconnect');
            newSocket.disconnect();
          } catch (err) {
            console.warn('Failed to dispose stale reused socket:', err);
          }
          setStatus('connecting');
          setLoading(true);
          setError('Previous session expired. Reconnecting...');
          setReconnectNonce((n) => n + 1);
        }, 3500);
      }
    }

    newSocket.on('sftp:file_content', ({ path, content }) => {
       setEditor(prev => ({ ...prev, content, visible: true, saving: false }));
       if (toastRef.current) removeNotification(toastRef.current);
    });

    newSocket.on('sftp:action_success', ({ action, path }) => {
       // For rename/move: dismiss the spinner toast immediately — the UI already
       // shows the new name via optimistic update. The list refresh below is just
       // a correctness backstop to sync any server-side changes.
       if (action === 'move') {
         // Clear via ref if available; the toast also has a 4s auto-dismiss as fallback
         if (toastRef.current) {
           removeNotification(toastRef.current);
           toastRef.current = null;
         }
         setTransfer(null);
         transferRef.current = null;
         if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
         refreshTimeoutRef.current = setTimeout(() => {
           const targetPath = currentPathRef.current || '.';
           newSocket.emit('sftp:list', targetPath);
         }, 400);
         return;
       }
       if (action === 'delete') {
          const deletedFilename = path ? path.replace(/\/+$/, '').split('/').pop() : '';
          if (deletedFilename) {
            setFiles(prev => prev.filter(f => f.filename !== deletedFilename));
            setDeletingFiles(prev => {
              const next = new Set(prev);
              next.delete(deletedFilename);
              return next;
            });
          }
          deleteBatchRef.current.count++;
          // Update progress message
          if (deleteBatchRef.current.toastId) {
             const { count, total, toastId } = deleteBatchRef.current;
             const rawFilename = path ? path.split('/').pop() : '';
             const filename = truncateName(rawFilename, 15);
             updateNotification(toastId, { 
                message: `${t('files.actions.deleting')}: ${filename} (${count}/${total})` 
             });
          }
          // Clear toast only when batch is done
          const batchDone = deleteBatchRef.current.count >= deleteBatchRef.current.total;
          if (batchDone && deleteBatchRef.current.toastId) {
            removeNotification(deleteBatchRef.current.toastId);
            deleteBatchRef.current.toastId = null;
          }
          // Show success toast once per batch (debounced per-instance)
          if (batchDone) {
            if (!lastDeleteToastRef.current || Date.now() - lastDeleteToastRef.current > 2000) {
              addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
              lastDeleteToastRef.current = Date.now();
            }
            // Only refresh list once the whole batch finishes, not on every individual delete
            if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
            refreshTimeoutRef.current = setTimeout(() => {
              const targetPath = currentPathRef.current || '.';
              newSocket.emit('sftp:list', targetPath);
            }, 300);
          }
          return; // Early return — skip the generic handling below
       } else if (toastRef.current) {
         removeNotification(toastRef.current);
         toastRef.current = null;
       }
       
       if (action === 'write') {
          addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
          setEditor(prev => ({ ...prev, saving: false, visible: false }));
       } else {
          addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
       }
       
       // Don't clear transfer for 'upload' of the hidden temp archive — extraction is still in progress
       // (the extract success event will clear it). For all other actions, clear immediately.
       const isHiddenArchive = action === 'upload' && typeof path === 'string' && path.includes('.__ssh_monitor_upload_');
       if (!isHiddenArchive) {
         setTransfer(null);
       }
       
       // Skip list refresh for hidden archive uploads — extracting hasn't finished yet;
       // the 'extract' action_success will trigger the definitive refresh.
       if (!isHiddenArchive) {
         if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
         refreshTimeoutRef.current = setTimeout(() => {
           const targetPath = currentPathRef.current || '.';
           newSocket.emit('sftp:list', targetPath);
         }, 300);
       }
    });

    newSocket.on('sftp:progress', (data) => {
      setTransfer(prev => {
        if (!prev) {
          console.warn(`[FileManager] Ignoring progress - no active transfer`, data);
          return null; // Don't resurrect late progress messages
        }
        let extractedCount = prev.extractedCount || 0;
        if (data.action === 'extract' && data.status) {
          const match = data.status.match(/\((\d+)\s+files\)/);
          if (match) extractedCount = parseInt(match[1], 10);
        }
        let pct = data.progress;
        if (data.action === 'extract') {
          if (data.progress === 100) {
            pct = 100;
          } else if (prev.totalFiles && extractedCount) {
            pct = Math.min(99, Math.round((extractedCount / prev.totalFiles) * 100));
          } else {
            pct = prev.progress > 0 ? prev.progress : 0;
          }
        }
        return {
          ...prev,
          ...data,
          extractedCount,
          progress: pct !== -1 && pct !== undefined ? pct : (prev.progress ?? 0),
        };
      });
    });

    newSocket.on('sftp:download_start', ({ filename, size, offset = 0 }) => {
       const existing = downloadBufferRef.current[filename];
       const resumeOffset = Math.max(offset || 0, existing?.bytesReceived || 0);
       downloadBufferRef.current[filename] = {
         buffer: resumeOffset > 0 && existing?.buffer?.length ? existing.buffer : [],
         toastId: existing?.toastId || null,
         bytesReceived: resumeOffset,
         size,
       };
       const nextTransfer = {
         filename,
         progress: size > 0 ? Math.round((resumeOffset / size) * 100) : 0,
         action: 'download',
         waiting: false,
         reconnecting: false,
         bytes: resumeOffset,
       };
       setTransfer(nextTransfer);
       transferRef.current = nextTransfer;
    });

    newSocket.on('sftp:download_chunk', ({ filename, chunk, progress, offset }) => {
       if (downloadBufferRef.current[filename]) {
         downloadBufferRef.current[filename].buffer.push(chunk);
         downloadBufferRef.current[filename].bytesReceived = offset;
       }
       const nextTransfer = { filename, progress, action: 'download', waiting: false, reconnecting: false, bytes: offset };
       setTransfer(nextTransfer);
       transferRef.current = nextTransfer;
       if (lastDownloadRef.current) lastDownloadRef.current.offset = offset;
    });

    newSocket.on('sftp:download_done', ({ filename }) => {
       const dlMeta = downloadBufferRef.current[filename];
       if (!dlMeta) return;
       if (dlMeta.size > 0 && (dlMeta.bytesReceived || 0) < dlMeta.size) {
         const partialBytes = dlMeta.bytesReceived || 0;
         const nextTransfer = {
           filename,
           progress: Math.round((partialBytes / dlMeta.size) * 100),
           action: 'download',
           waiting: true,
           reconnecting: true,
           bytes: partialBytes,
         };
         setTransfer(nextTransfer);
         transferRef.current = nextTransfer;
         pendingTransferResumeRef.current = {
           type: 'download',
           file: lastDownloadRef.current?.file,
           offset: partialBytes,
         };
         requestReconnect('Download interrupted before completion. Reconnecting...', {
           preserveTransfer: true,
           notificationMessage: `${filename} stopped before the full file arrived. Reconnecting and resuming from byte ${partialBytes}.`,
         });
         return;
       }
       const blob = new Blob(dlMeta.buffer);
       const url = window.URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = filename;
       a.click();
       window.URL.revokeObjectURL(url);
       
       if (dlMeta.toastId) {
         removeNotification(dlMeta.toastId);
       }
       delete downloadBufferRef.current[filename];
       
       setTransfer(null);
       transferRef.current = null;
       pendingTransferResumeRef.current = null;
       lastDownloadRef.current = null;
       setReconnectAlert(null);
       if (toastRef.current === dlMeta?.toastId) {
         toastRef.current = null;
       }
       addNotification({ title: t('files.toasts.downloadComplete'), message: `${t('files.context.download')} ${filename}`, type: 'success' });
    });

     newSocket.on('sftp:sizeResult', ({ path: targetPath, size, error }) => {
        setInfoModal(prev => {
          if (!prev.visible || !prev.file) return prev;
          const currentFileDir = currentPathRef.current === '.' ? prev.file.filename : `${currentPathRef.current}/${prev.file.filename}`;
          // Ensure the result is actually for the currently open file info
          if (currentFileDir === targetPath) {
            return {
              ...prev,
              sizeLoading: false,
              realSize: error ? null : size
            };
          }
          return prev;
        });
     });

    newSocket.on('sftp:error', (err) => {
      const msg = err?.message || (typeof err === 'string' ? err : (err && Object.keys(err).length > 0 ? JSON.stringify(err) : ''));
      
      // Skip empty/no-op errors — nothing useful to show or retry
      if (!msg || msg === '{}' || msg === 'undefined' || msg === 'null') {
        return;
      }

      // Clear batch deletion toast on error too
      if (deleteBatchRef.current.toastId) {
        removeNotification(deleteBatchRef.current.toastId);
        deleteBatchRef.current = { count: 0, total: 0, toastId: null };
        setDeletingFiles(new Set());
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = setTimeout(() => {
          const targetPath = currentPathRef.current || '.';
          if (newSocket.connected && statusRef.current === 'ready') {
            newSocket.emit('sftp:list', targetPath);
          }
        }, 300);
      }
      
      if (toastRef.current) {
        removeNotification(toastRef.current);
        toastRef.current = null;
      }
      
      // Handle Rate Limit specifically
      if (err?.resetIn) {
         const seconds = Math.ceil(err.resetIn / 1000);
         setTransferCountdown(seconds);
         setTransfer(prev => prev ? { ...prev, waiting: true, countdown: seconds } : null);
         addNotification({ title: t('files.status.rateLimited'), message: `${t('files.status.pausing')}. ${t('files.status.retryIn', { seconds })}`, type: 'warning' });
         return;
      }

      // Handle Memory / Concurrency guard — keep transfer alive and auto-retry
      if (err?.guard === 'memory' || err?.guard === 'concurrency') {
        const retryMsg = err.guard === 'memory'
          ? `Low RAM (${err.details?.sysFreeMB ?? '?'} MB free) — retrying in 5s…`
          : `Transfer slots full (${err.current ?? '?'}/${err.max ?? '?'} active) — retrying in 5s…`;
        console.warn(`⏳ Guard retry (${err.guard}):`, retryMsg);
        setTransfer(prev => prev ? { ...prev, waiting: true, guardError: err.guard } : null);
        addNotification({ title: 'Server busy — will retry', message: retryMsg, type: 'warning' });
        return; // upload loop handles the actual retry via waitForUploadHandshake
      }

      if (transferRef.current && (err?.recoverable || isTransferChannelError(err))) {
        requestReconnect('Transfer channel interrupted. Reconnecting...', {
          preserveTransfer: true,
          notificationMessage: transferRef.current?.action === 'download'
            ? 'Transfer interrupted. Reconnecting and resuming the download from the last received byte.'
            : 'Transfer interrupted. Reconnecting SSH and keeping your upload queue.',
        });
        return;
      }

      // If an upload is actively waiting for ACK, don't kill it here —
      // the upload's own error/timeout handlers will deal with it.
      // Clearing the transfer here races with and silently kills the upload loop.
      if (transferRef.current?.action === 'upload' && !transferRef.current?.waiting) {
        console.warn('⚠️ sftp:error during active upload — deferring to upload handler:', msg);
        return;
      }

      setTransfer(null);
      console.error('❌ SFTP Error:', err);

      // Stop reconnect loop on channel failures — these won't resolve by retrying
      if (/channel open failure|open failed/i.test(msg)) {
        setStatus('error');
        setError('SFTP channel failed. The SSH server may not support SFTP, or too many channels are open.');
        setLoading(false);
        addNotification({ 
          title: 'SFTP Error', 
          message: 'Channel open failed. Close other SFTP sessions or restart the SSH server.', 
          type: 'error' 
        });
        return;
      }

      // ── Relay / SFTP subsystem fatal errors ──────────────────────────────
      // "No response from server" = relay timed-out waiting for the SSH server
      // Both indicate the SFTP session is broken; trigger a clean reconnect
      // instead of looping back with another sftp:list call.
      if (/^(No response from server)$/i.test(msg.trim())) {
        console.warn('⚠️ SFTP session broken (relay). Reconnecting...', msg);
        requestReconnect('SFTP session broken. Reconnecting...', {
          preserveTransfer: false,
          notificationMessage: 'SFTP connection lost. Reconnecting now.',
        });
        return;
      }

      addNotification({ title: t('files.status.errorTitle'), message: msg || t('files.status.errorTitle'), type: 'error' });

      if (reusedSocket && /ssh connection closed|not connected|channel .*closed|connection .*closed|socket .*disconnected/i.test(msg)) {
        clearTimeout(reuseInitTimeout);
        console.warn('⚠️ Reused socket lost its SSH/SFTP backend. Starting a fresh session.');
        try {
          newSocket.emit('ssh:disconnect');
          newSocket.disconnect();
        } catch (disconnectErr) {
          console.warn('Failed closing stale reused socket after SFTP error:', disconnectErr);
        }
        setStatus('connecting');
        setLoading(true);
        setError('Previous session expired. Reconnecting...');
        setReconnectNonce((n) => n + 1);
        return;
      }
      
      setLoading(false);

      if (status === 'connecting' || status === 'ssh_connecting') {
        setStatus('error');
        setError(msg);
        clearTimeout(timeout);
      }
      setEditor(prev => ({ ...prev, saving: false }));
    });

    newSocket.on('ssh:error', (err) => {
      const errMsg = err?.message || (typeof err === 'string' ? err : null) || 'SSH connection failed';
      console.error('❌ SSH Error:', errMsg, err);
      clearTimeout(timeout);
      if (errMsg === 'vault_not_ready') {
        // Vault not unlocked yet — show waiting state, auto-retry when vault unlocks
        setStatus('error');
        setError('vault_not_ready');
        setLoading(false);
        return;
      }
      setStatus('error');
      setError(errMsg);
      setLoading(false);
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
      // Auto-retry once after 3s on the very first connection attempt (e.g. page refresh race).
      // IMPORTANT: disconnect the socket first so the pool doesn't reuse a dead-SSH socket
      // (the WebSocket layer stays connected even when SSH auth fails, which would cause
      // the retry to pick up the dead socket and show an empty file list forever).
      if (reconnectNonce === 0) {
        newSocket.disconnect();
        setTimeout(() => {
          setReconnectNonce(n => n + 1);
        }, 3000);
      }
    });

    newSocket.on('ssh:idle_timeout', () => {
      setStatus('error');
      setError('Session idle timeout. Reconnecting...');
      setLoading(false);
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
      requestReconnect('Session idle timeout. Reconnecting...', {
        preserveTransfer: !!transferRef.current,
        notificationMessage: transferRef.current?.action === 'download'
          ? 'Session timed out during download. Reconnecting and resuming automatically.'
          : transferRef.current?.action === 'upload' || uploadQueueRef.current.length > 0
            ? 'Session timed out during upload. Reconnecting and keeping the upload queue.'
            : 'Session timed out after being idle. Reconnecting now.',
      });
    });

    // ── WebRTC P2P: upgrade file transfers from Socket.io to DataChannel when local relay is available ──
    // Server emits relay:rtc:ready after pre-provisioning SSH credentials to the relay agent.
    // On ICE success: uploads/downloads flow directly browser → relay (zero server bandwidth).
    // On ICE timeout: silent fallback — socket-based sftp:upload path remains registered and active.
    newSocket.on('relay:rtc:ready', async ({ connId: emittedConnId }) => {
      const sshMode = typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_ssh_mode') || 'server') : 'server';
      if (sshMode !== 'local') return;

      relayConnIdRef.current = emittedConnId;
      try {
        const peer = await createRelayPeer({ socket: newSocket, relayConnId: emittedConnId });
        rtcPeerRef.current = peer;
        setRtcActive(true);
        console.log('[FileManager][WebRTC] P2P DataChannels open — file transfers now bypass server');

        // If relay agent closes the peer, tear down so we fall back to socket path
        peer.onControl((msg) => {
          if (msg.connId !== emittedConnId) return;
          if (msg.type === 'ssh:closed' || msg.type === 'ssh:error') {
            try { peer.close(); } catch (_) {}
            if (rtcPeerRef.current === peer) { rtcPeerRef.current = null; setRtcActive(false); }
          }
        });
      } catch (err) {
        // ICE timeout or no node-datachannel on relay — socket upload path stays active
        console.log('[FileManager][WebRTC] P2P unavailable, using WebSocket relay fallback:', err.message);
        rtcPeerRef.current = null;
        setRtcActive(false);
      }
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      clearTimeout(timeout);
      clearTimeout(reuseInitTimeout);

      // Always close WebRTC peer on unmount / reconnect
      if (rtcPeerRef.current) {
        try { rtcPeerRef.current.close(); } catch (_) {}
        rtcPeerRef.current = null;
      }
      relayConnIdRef.current = null;

      if (!newSocket) return;

      if (statusRef.current !== 'ready') {
        console.log('🔌 Cleaning up unready socket for', connectionId);
        newSocket.removeAllListeners();
        newSocket.emit('ssh:disconnect');
        newSocket.disconnect();
        return;
      }

      // Save socket to pool with TTL instead of disconnecting immediately.
      // If the same connectionId remounts within POOL_TTL ms (e.g. after Split),
      // it will reuse the socket seamlessly without reconnecting.
      const poolEntry = {
        socket: newSocket,
        status: statusRef.current,
        currentPath: currentPathRef.current,
        files: filesRef.current,
        isTransferActive: () => !!transferRef.current || (uploadQueueRef.current && uploadQueueRef.current.length > 0),
      };

      const schedulePoolCleanup = () => {
        poolEntry.cleanupTimer = setTimeout(() => {
          const entry = _fmSocketPool.get(connectionId);
          if (entry?.socket === newSocket) {
            if (entry.isTransferActive?.()) {
              console.log('🔌 Pool TTL extended — active transfer still running for', connectionId);
              schedulePoolCleanup();
              return;
            }
            console.log('🔌 Pool TTL expired — disconnecting socket for', connectionId);
            newSocket.emit('ssh:disconnect');
            newSocket.disconnect();
            _fmSocketPool.delete(connectionId);
          }
        }, POOL_TTL);
      };

      schedulePoolCleanup();
      _fmSocketPool.set(connectionId, poolEntry);
    };
  }, [connectionId, reconnectNonce, isTransferChannelError, requestReconnect, vaultStatus, resumePendingUploads, addNotification, t]); // Removed 'connection' from dependencies to prevent loop

  // --- Auto-Refresh Logic ---
  
  // 1. Background Polling (Every 20 seconds if ready and NOT transferring)
  useEffect(() => {
    if (status !== 'ready' || !socket) return;
    
    const interval = setInterval(() => {
      // Pause polling during active uploads/transfers to prevent SSH channel congestion
      if (transferRef.current || (uploadQueueRef.current && uploadQueueRef.current.length > 0)) {
        return;
      }
      refreshFiles(currentPathRef.current);
    }, 20000);
    
    return () => clearInterval(interval);
  }, [status, socket]);

  // Latency Heartbeat
  useEffect(() => {
    let interval;
    if (status === 'ready' && socketRef.current) {
      interval = setInterval(() => {
        if (socketRef.current.connected) {
           socketRef.current.emit('heartbeat:ping', Date.now());
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status]);

  // Transfer Retry Countdown
  useEffect(() => {
    let timer;
    if (transferCountdown > 0) {
      timer = setInterval(() => {
        setTransferCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            // Trigger Download Retry if needed
            if (transfer?.action === 'download' && lastDownloadRef.current) {
               handleDownload(lastDownloadRef.current.file, lastDownloadRef.current.offset);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [transferCountdown]);

  // Safety timeout: auto-dismiss copy/move transfer ONLY if completely stuck without progress for 180s
  useEffect(() => {
    if (transferSafetyTimerRef.current) {
      clearTimeout(transferSafetyTimerRef.current);
      transferSafetyTimerRef.current = null;
    }
    if (transfer && (transfer.action === 'copy' || transfer.action === 'move') && !transfer.waiting && !transfer.reconnecting) {
      transferSafetyTimerRef.current = setTimeout(() => {
        console.warn('⚠️ Transfer inactivity timeout (no progress for 3m) — auto-dismissing modal');
        setTransfer(null);
        transferRef.current = null;
        if (socket) {
          const targetPath = currentPathRef.current || '.';
          socket.emit('sftp:list', targetPath);
        }
      }, 180000); // 3 minutes of zero progress before timeout
    }
    return () => {
      if (transferSafetyTimerRef.current) {
        clearTimeout(transferSafetyTimerRef.current);
        transferSafetyTimerRef.current = null;
      }
    };
  }, [transfer?.action, transfer?.waiting, transfer?.reconnecting, transfer?.filename, transfer?.progress]);

  // 2. Refresh on Window Focus / tab visibility (When user clicks back into the tab)
  useEffect(() => {
    let returnCheckTimer = null;

    const verifyAfterReturn = () => {
      // Skip verification if we're actively transferring
      const hasActiveTransfer = transferRef.current && !transferRef.current.waiting && !transferRef.current.error;
      const hasQueuedUploads = uploadQueueRef.current.length > 0;
      
      if (hasActiveTransfer) {
        console.log('⏭️ Skipping reconnection check - active transfer in progress');
        return;
      }
      
      // Only act if we were in a ready state
      if (statusRef.current !== 'ready') return;

      // If the socket is already disconnected, trigger a reconnect immediately
      if (!socketRef.current?.connected) {
        if (statusRef.current === 'ready') {
          requestReconnect('Connection lost while tab was inactive. Reconnecting...', {
            preserveTransfer: hasQueuedUploads,
            notificationMessage: hasQueuedUploads 
              ? 'Connection lost while you were away. Reconnecting to resume your uploads.'
              : 'Connection lost while you were away. Reconnecting now.',
          });
        }
        return;
      }

      // Give the browser 800ms to wake up before probing the SSH session.
      // Background-tab timers are heavily throttled — the ping can time out
      // the instant the tab becomes visible even when SSH is perfectly fine.
      clearTimeout(returnCheckTimer);
      returnCheckTimer = setTimeout(() => {
        // Re-check: status or socket may have changed during the delay
        if (statusRef.current !== 'ready') return;
        if (!socketRef.current?.connected) {
          requestReconnect('Connection lost while tab was inactive. Reconnecting...', {
            preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
            notificationMessage: 'Connection lost while you were away. Reconnecting now.',
          });
          return;
        }

        const cacheFresh = Date.now() - lastHealthCheckAtRef.current < HEALTH_CHECK_TTL_MS;
        if (cacheFresh && lastHealthOkRef.current) {
          refreshFiles();
          return;
        }

        pingConnection().then((ok) => {
          if (statusRef.current !== 'ready') return;
          if (!ok) {
            // Ping timed out — verify the socket is still connected before declaring dead.
            // A single ping timeout after waking up does NOT mean the SSH session is gone.
            if (!socketRef.current?.connected) {
              requestReconnect('Connection dropped while tab was inactive. Reconnecting...', {
                preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
                notificationMessage: 'Your SSH session dropped while you were away. Reconnecting now.',
              });
            } else {
              // Socket is still up — just refresh files optimistically
              console.log('⚠️ SSH ping timed out on tab return but socket is connected — refreshing files only');
              refreshFiles();
            }
            return;
          }
          console.log('🔄 Regained focus, refreshing file list...');
          refreshFiles();
        });
      }, 800);
    };

    const handleFocus = () => verifyAfterReturn();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') verifyAfterReturn();
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(returnCheckTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [pingConnection, requestReconnect, refreshFiles]);

  // Global search: listen for results from server
  useEffect(() => {
    if (!socket) return;
    const handler = ({ query, results, error }) => {
      setSearchLoading(false);
      if (error) { console.warn('[Search] Error:', error); return; }
      setSearchResults(results || []);
    };
    socket.on('sftp:searchResult', handler);
    return () => socket.off('sftp:searchResult', handler);
  }, [socket]);

  // Debounced global search trigger
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim() || !socket) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(() => {
      socket.emit('sftp:search', { query: searchQuery.trim() });
    }, 400);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchQuery, socket]);

  function refreshFiles(path = currentPathRef.current) {
    if (socket) {
      // Don't full load, just refresh list
      socket.emit('sftp:list', path || '.');
    }
  }

  useEffect(() => {
    if (loading || status !== 'ready' || isSearchMode || !socket) return;
    if (files.length > 0) {
      emptyRetryPathRef.current = '';
      return;
    }

    const retryPath = currentPathRef.current || '.';
    if (emptyRetryPathRef.current === retryPath) return;

    const timer = setTimeout(() => {
      if (statusRef.current === 'ready' && socketRef.current?.connected && filesRef.current.length === 0) {
        emptyRetryPathRef.current = retryPath;
        console.log('🔄 Empty list safeguard — retrying directory listing for', retryPath);
        refreshFiles(retryPath);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [files.length, isSearchMode, loading, socket, status]);

  const handleFolderClick = (name) => {
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    setCurrentPath(newPath);
    currentPathRef.current = newPath;
    refreshFiles(newPath);
  };

  const goBack = () => {
    if (currentPath === '.') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length === 0 ? '.' : parts.join('/');
    setCurrentPath(newPath);
    currentPathRef.current = newPath;
    refreshFiles(newPath);
  };

  const truncateName = (name, length = 20) => {
    if (!name) return '';
    return name.length > length ? name.substring(0, length - 3) + '...' : name;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const insertMention = (file) => {
    const content = editor.content;
    const pos = editor.cursorPos ?? content.length;
    const filePath = currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`;
    const before = content.slice(0, mentionState.triggerPos);
    const after = content.slice(pos);
    const insertion = `@${filePath} `;
    const newContent = `${before}${insertion}${after}`;
    const newPos = mentionState.triggerPos + insertion.length;
    setEditor(prev => ({ ...prev, content: newContent, cursorPos: newPos }));
    setMentionState({ active: false, query: '', results: [], selectedIndex: 0, triggerPos: 0 });
    
    setTimeout(() => {
      if (editorTextareaRef.current) {
        editorTextareaRef.current.focus();
        editorTextareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleAskAI = async (e) => {
    if (e) e.preventDefault();
    if (!aiPrompt.trim() || isAiLoading) return;

    setIsAiLoading(true);
    setAiError(null);
    setAiAnswer(null);

    if (typeof apiFetch === 'undefined') {
      console.error('CRITICAL: apiFetch is not defined in handleAskAI scope!');
      setAiError('System error: apiFetch is not defined. Please refresh.');
      setIsAiLoading(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/connections/${connectionId}/ai-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          provider: 'files', // Distinguish from db
          schemaName: currentPath,
          sampleData: files.slice(0, 50),
          model: sshAiPrefs.aiModel || 'auto',
          prefs: sshAiPrefs
        })
      });

      const data = await res.json();
      if (data.success) {
        setAiAnswer(data.query);
        // Extract thought if exists
        const thoughtMatch = data.query.match(/<thought>([\s\S]*?)<\/thought>/i);
        const cleanAnswer = data.query.replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<query>|<\/query>/gi, '').trim();
        
        setAiHistory([{ prompt: aiPrompt, answer: cleanAnswer, thought: thoughtMatch ? thoughtMatch[1] : null }, ...aiHistory].slice(0, 10));
        setAiPrompt('');
      } else {
        setAiError(data.error || 'AI failed to generate response');
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setIsAiLoading(false);
    }
  };

  // ── Find / Replace helpers ────────────────────────────────────────────────
  const computeMatches = useCallback((content, query, matchCase, useRegex) => {
    if (!query) return [];
    try {
      const flags = matchCase ? 'g' : 'gi';
      const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(pattern, flags);
      const hits = [];
      let m;
      while ((m = re.exec(content)) !== null) {
        hits.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        if (m[0].length === 0) re.lastIndex++;
      }
      return hits;
    } catch { return []; }
  }, []);

  const jumpToMatch = useCallback((matches, index) => {
    if (!matches.length || !editorTextareaRef.current) return;
    const m = matches[index];
    editorTextareaRef.current.focus();
    editorTextareaRef.current.setSelectionRange(m.start, m.end);
    // Scroll textarea to show the match
    const ta = editorTextareaRef.current;
    const linesBefore = ta.value.slice(0, m.start).split('\n').length - 1;
    const lineH = 20; // matches leading-5
    ta.scrollTop = Math.max(0, linesBefore * lineH - ta.clientHeight / 2);
  }, []);

  const openFindBar = useCallback((withReplace = false) => {
    setFindBar(prev => ({ ...prev, visible: true, replaceVisible: withReplace || prev.replaceVisible }));
    setTimeout(() => findInputRef.current?.focus(), 30);
  }, []);

  const closeFindBar = useCallback(() => {
    setFindBar(prev => ({ ...prev, visible: false }));
    editorTextareaRef.current?.focus();
  }, []);

  const findNavigate = useCallback((dir) => {
    const matches = computeMatches(editor.content, findBar.query, findBar.matchCase, findBar.useRegex);
    if (!matches.length) return;
    const next = (findBar.currentIndex + dir + matches.length) % matches.length;
    setFindBar(prev => ({ ...prev, currentIndex: next }));
    jumpToMatch(matches, next);
    // Re-focus find input so subsequent Enter presses keep navigating (not inserting newlines)
    setTimeout(() => findInputRef.current?.focus(), 0);
  }, [editor.content, findBar, computeMatches, jumpToMatch]);

  const findReplaceOne = useCallback(() => {
    const matches = computeMatches(editor.content, findBar.query, findBar.matchCase, findBar.useRegex);
    if (!matches.length) return;
    const idx = findBar.currentIndex % matches.length;
    const m = matches[idx];
    const newContent = editor.content.slice(0, m.start) + findBar.replace + editor.content.slice(m.end);
    setEditor(prev => ({ ...prev, content: newContent }));
    // Move to next after replace
    const newMatches = computeMatches(newContent, findBar.query, findBar.matchCase, findBar.useRegex);
    const newIdx = Math.min(idx, Math.max(newMatches.length - 1, 0));
    setFindBar(prev => ({ ...prev, currentIndex: newIdx }));
    setTimeout(() => jumpToMatch(computeMatches(newContent, findBar.query, findBar.matchCase, findBar.useRegex), newIdx), 0);
  }, [editor.content, findBar, computeMatches, jumpToMatch]);

  const findReplaceAll = useCallback(() => {
    if (!findBar.query) return;
    try {
      const flags = (findBar.matchCase ? 'g' : 'gi');
      const pattern = findBar.useRegex ? findBar.query : findBar.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(pattern, flags);
      const newContent = editor.content.replace(re, findBar.replace);
      setEditor(prev => ({ ...prev, content: newContent }));
    } catch {}
  }, [editor.content, findBar]);

  const handleContextMenu = (e, file = null) => {
    e.preventDefault();
    e.stopPropagation();

    let x = e.clientX;
    let y = e.clientY;

    // Estimate menu dimensions to prevent overflow
    const menuWidth = 180;
    const menuHeight = 280; // Estimated max height

    // Flip horizontally if too close to right edge
    if (x + menuWidth > window.innerWidth) {
      x = x - menuWidth;
    }

    // Flip vertically if too close to bottom edge (accounting for taskbar ~48px)
    if (y + menuHeight > window.innerHeight - 48) {
      y = y - menuHeight;
      // Ensure it doesn't go off top
      if (y < 10) y = 10;
    }

    if (file && !selectedFiles.has(file.filename)) {
      setSelectedFiles(new Set([file.filename]));
      setLastSelectedFile(file.filename);
    }

    setContextMenu({
      visible: true,
      x,
      y,
      file,
      isBackground: !file
    });
  };

  const handleFileUpload = async (e, specificFile = null, resumeOffset = 0, overridePath = null, displayName = null, skipOverwriteCheck = false, skipCleanup = false) => {
    // Handle multiple files from file input
    if (e?.target?.files && e.target.files.length > 1 && !specificFile) {
      const inputFiles = Array.from(e.target.files);
      const baseTarget = overridePath !== null ? overridePath : currentPath;

      // Bulk overwrite check
      const conflicting = inputFiles.filter(f => files.some(existing => existing.filename === f.name));
      let filesToUpload = inputFiles;

      if (conflicting.length > 0) {
        const choice = await new Promise(resolve => {
          showConfirm(
            `${conflicting.length} file${conflicting.length > 1 ? 's' : ''} already exist${conflicting.length === 1 ? 's' : ''} on the server:\n${conflicting.map(f => `• ${f.name}`).join('\n')}\n\nOverwrite all existing files?`,
            () => resolve('overwrite'),
            'Files Already Exist',
            'Overwrite All',
            'Skip Existing',
            () => resolve('skip'),
          );
        });
        if (choice === 'skip') {
          filesToUpload = inputFiles.filter(f => !conflicting.some(c => c.name === f.name));
        }
      }

      for (const file of filesToUpload) {
        await handleFileUpload(null, file, 0, overridePath, null, true);
      }
      e.target.value = null;
      return;
    }

    const file = specificFile || e?.target?.files[0];
    if (!file) return;

    console.log(`📤 [${file.name}] File object details:`, {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    });

    let socket = socketRef.current;
    if (!socket) return;
    console.log(`📤 [${file.name}] Upload start — socket.connected=${socket.connected}, status=${statusRef.current}`);
    if (!(await ensureSocketReadyAsync('retry the upload'))) {
      console.warn(`📤 [${file.name}] ensureSocketReadyAsync returned false — upload blocked`);
      return;
    }
    // Re-fetch socket after ensureSocketReadyAsync — reconnect may have replaced it
    socket = socketRef.current;
    if (!socket?.connected) {
      console.warn(`📤 [${file.name}] Socket not connected after ensureSocketReadyAsync`);
      return;
    }
    console.log(`📤 [${file.name}] Socket ready, emitting sftp:upload (socket=${socket.id})`);

    // Helper to always get the current socket — reconnect may replace it mid-upload
    const getSocket = () => socketRef.current;

    const baseTarget = overridePath !== null ? overridePath : currentPath;
    const path = baseTarget === '.' ? file.name : `${baseTarget}/${file.name}`;
    
    // Check if file already exists on server (skip check for resume or bulk uploads)
    if (resumeOffset === 0 && !skipOverwriteCheck) {
      const existingFile = files.find(f => f.filename === file.name);
      if (existingFile) {
        const confirmed = await new Promise(resolve => {
          showConfirm(
            `"${file.name}" already exists on the server. Overwrite?`,
            () => resolve(true),
            t('files.status.upload'),
            'Overwrite',
            t('common.cancel'),
            () => resolve(false),
          );
        });
        if (!confirmed) {
          if (e?.target?.value) e.target.value = null;
          return;
        }
      }
    }

    // Add to queue if not already there (for manual retry support)
    setUploadQueue(prev => {
      const exists = prev.find(item => item.path === path);
      if (exists) return prev.map(item => item.path === path ? { file, path, offset: resumeOffset, displayName } : item);
      return [...prev, { file, path, offset: resumeOffset, displayName }];
    });

    const transferObj = { 
      filename: displayName || file.name, 
      realFilename: file.name, 
      path, 
      progress: 0, 
      action: 'upload', 
      waiting: false,
      channel: (rtcPeerRef.current && relayConnIdRef.current) ? 'webrtc' : 'socket',
    };
    setTransfer(transferObj);
    transferRef.current = transferObj;

    // Create upload progress notification
    const uploadNotifId = addNotification({
      title: t('files.status.upload'),
      message: `${file.name} — 0%`,
      type: 'loading',
      duration: 0,
    });
    toastRef.current = uploadNotifId;
    transferObj.toastId = uploadNotifId;

    activeHandshakeCleanupRef.current = null;
    const waitForUploadHandshake = (expectedOffset) => new Promise(resolve => {
      // Use fresh socket ref so listeners attach to the current socket (not a stale one after reconnect)
      const sock = getSocket();
      if (!sock?.connected) {
        resolve({ offset: expectedOffset, error: 'Socket disconnected', recoverable: true });
        return;
      }

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ offset: expectedOffset, error: 'Handshake timeout' });
      }, 20000);

      const handler = (data) => {
        if (data.filename && data.filename !== file.name && data.filename !== displayName) return;
        cleanup();
        resolve(data);
      };

      // Intercept guard / rate limit / recoverable errors immediately so we don't wait the full timeout
      const guardErrHandler = (err) => {
        if (err?.guard === 'memory' || err?.guard === 'concurrency') {
          cleanup();
          resolve({ guardBlocked: true, guardType: err.guard, retryAfter: 5000 });
          return;
        }
        if (err?.guard === 'rate-limit' || err?.resetIn) {
          cleanup();
          resolve({ rateLimited: true, resetIn: err.resetIn || 5000 });
          return;
        }
        if (err?.recoverable || isTransferChannelError(err)) {
          cleanup();
          resolve({ error: err?.message || 'Transfer channel error', recoverable: true });
          return;
        }
        // For any other sftp:error during handshake, resolve with the error
        // so the upload handler can deal with it instead of silently waiting for timeout
        if (err?.message) {
          cleanup();
          resolve({ error: err.message });
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        sock.off('sftp:can_upload', handler);
        sock.off('sftp:error', guardErrHandler);
        activeHandshakeCleanupRef.current = null;
      };

      activeHandshakeCleanupRef.current = cleanup;
      sock.on('sftp:can_upload', handler);
      sock.on('sftp:error', guardErrHandler);
    });

    let activeCompletionCleanup = null;
    const waitForUploadCompletion = () => new Promise((resolve, reject) => {
      const sock = getSocket();
      if (!sock?.connected) {
        reject(new Error('Socket disconnected before upload completion'));
        return;
      }

      const timeoutId = setTimeout(() => {
        console.error(`⏰ Upload completion timeout for ${path} (60s)`);
        cleanup();
        reject(new Error('Upload completion timeout'));
      }, 60000); // 60s — relay must flush SFTP write; 20s was too tight on WAN

      const cleanup = () => {
        clearTimeout(timeoutId);
        sock.off('sftp:action_success', successHandler);
        sock.off('sftp:error', errorHandler);
        activeCompletionCleanup = null;
      };

      const normalizePath = (p) => p ? p.replace(/\/+/g, '/').replace(/^\.\//, '') : '';
      const successHandler = (data) => {
        if (data?.action !== 'upload') return;
        const matchPath = normalizePath(data?.path);
        const targetPath = normalizePath(path);
        const matchFilename = matchPath.split('/').pop();
        const targetFilename = targetPath.split('/').pop();
        const isMatch = matchFilename === targetFilename || matchPath === targetPath || matchPath.endsWith(`/${targetPath}`) || targetPath.endsWith(`/${matchPath}`);
        if (!isMatch) {
          console.log(`📤 Ignoring sftp:action_success for different upload: ${data?.action} ${data?.path} (expecting ${path})`);
          return;
        }
        console.log(`✅ Received sftp:action_success for upload: ${path}`);
        cleanup();
        resolve(data);
      };

      const errorHandler = (err) => {
        console.error(`❌ Received sftp:error during upload completion wait:`, err?.message);
        cleanup();
        reject(new Error(err?.message || 'Upload failed'));
      };

      activeCompletionCleanup = cleanup;
      sock.on('sftp:action_success', successHandler);
      sock.on('sftp:error', errorHandler);
    });
    
    activeAckCleanupRef.current = null;

    // ── WebRTC fast path: when local relay + P2P DataChannels are open, stream directly ──
    // Bypasses the Next.js server entirely — data goes browser → relay agent → SFTP → SSH.
    if (rtcPeerRef.current && relayConnIdRef.current) {
      const peer = rtcPeerRef.current;
      const connId = relayConnIdRef.current;
      console.log(`📤 [${file.name}] WebRTC path — streaming via DataChannel (connId=${connId})`);
      const abortController = new AbortController();
      let lastProgressUi = 0;
      let lastReportedPct = -1;
      try {
        await streamUpload(peer, connId, file, path, {
          startOffset: resumeOffset,
          signal: abortController.signal,
          onProgress: (sent, total) => {
            if (transferRef.current !== transferObj) { abortController.abort(); return; }
            const now = Date.now();
            const pct = Math.min(99, Math.round((sent / total) * 100));
            // Throttle React renders to 4fps (every 250ms) to keep CPU cool and prevent UI thread overload
            if (pct !== lastReportedPct && (now - lastProgressUi >= 250 || pct === 99)) {
              lastProgressUi = now;
              lastReportedPct = pct;
              setTransfer(prev => prev ? { ...prev, progress: pct, waiting: false } : null);
              updateNotification(uploadNotifId, { message: `${displayName || file.name} — ${pct}%` });
            }
          },
        });

        if (transferRef.current === transferObj) {
          updateNotification(uploadNotifId, {
            title: t('files.status.upload'),
            message: `${file.name} — 100%`,
            type: 'success',
            duration: 3000,
          });
          setUploadQueue(prev => prev.filter(item => item.path !== path));
          setTransfer(null);
          transferRef.current = null;
          if (e) e.target.value = null;
          // Refresh so the uploaded file appears in the listing
          getSocket()?.emit('sftp:list', currentPathRef.current || '.');
          return { path };
        }
        return;
      } catch (rtcErr) {
        if (rtcErr.name === 'AbortError') {
          // User cancelled
          setTransfer(null);
          transferRef.current = null;
          setUploadQueue(prev => prev.filter(item => item.path !== path));
          updateNotification(uploadNotifId, { title: t('files.status.upload'), message: `${file.name} — cancelled`, type: 'warning', duration: 3000 });
          return;
        }
        // DataChannel error — fall through to socket path
        console.warn(`[FileManager][WebRTC] streamUpload failed (${rtcErr.message}), falling back to socket path`);
        try { peer.close(); } catch (_) {}
        rtcPeerRef.current = null;
        // Fall through to socket-based upload below
      }
    }

    try {
      // Request start — auto-retry if server is temporarily out of resources (memory / concurrency guard)
      let startData;
      let guardAttempts = 0;
      const MAX_GUARD_RETRIES = 8;
      do {
        if (transferRef.current !== transferObj) return;
        // Re-fetch socket — reconnect may have replaced it during guard/rate-limit wait
        socket = getSocket();
        if (!socket?.connected) break;
        console.log(`📤 [${file.name}] Emitting sftp:upload (offset=${resumeOffset})`);
        socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset: resumeOffset });
        startData = await waitForUploadHandshake(resumeOffset);
        console.log(`📤 [${file.name}] Handshake result:`, JSON.stringify(startData));
        // Re-fetch socket after handshake (12s timeout — reconnect could have happened)
        socket = getSocket();
        if (!socket?.connected) break;
        if (transferRef.current !== transferObj) return;

        if (startData.guardBlocked) {
          guardAttempts++;
          if (guardAttempts >= MAX_GUARD_RETRIES) {
            console.warn(`🚫 Upload aborted after ${MAX_GUARD_RETRIES} guard retries`);
            setTransfer(null);
            transferRef.current = null;
            setUploadQueue(prev => prev.filter(item => item.path !== path));
            addNotification({
              title: t('files.status.errorTitle'),
              message: `${file.name}: Server still busy after several retries. Please try again in a moment.`,
              type: 'error',
            });
            return;
          }
          console.log(`⏳ Guard blocked (${startData.guardType}) — waiting ${startData.retryAfter}ms before retry ${guardAttempts}/${MAX_GUARD_RETRIES}`);
          setTransfer(prev => prev ? { ...prev, waiting: true, guardError: startData.guardType } : null);
          await new Promise(r => setTimeout(r, startData.retryAfter || 5000));
          if (transferRef.current !== transferObj) return;
          setTransfer(prev => prev ? { ...prev, waiting: false, guardError: null } : null);
        } else if (startData.rateLimited) {
          const waitMs = startData.resetIn || 5000;
          const seconds = Math.ceil(waitMs / 1000);
          console.log(`⏳ Rate limited on handshake — waiting ${waitMs}ms before retry`);
          setTransfer(prev => prev ? { ...prev, waiting: true, countdown: seconds } : null);
          setTransferCountdown(seconds);
          
          await new Promise(r => {
            const check = setInterval(() => {
              if (transferRef.current !== transferObj) {
                clearInterval(check);
                r();
              } else if (transferCountdownRef.current === 0) {
                clearInterval(check);
                r();
              }
            }, 500);
          });
          if (transferRef.current !== transferObj) return;
          setTransfer(prev => prev ? { ...prev, waiting: false, countdown: 0 } : null);
        }
      } while (startData.guardBlocked || startData.rateLimited);

        if (startData.error) {
        setTransfer(prev => ({ ...prev, waiting: true, error: true }));
        if (startData.recoverable || isTransferChannelError(startData.error)) {
          requestReconnect('Upload channel stalled. Reconnecting...', {
            preserveTransfer: true,
            notificationMessage: `${file.name}: Upload stalled. Reconnecting and keeping the upload queue for retry.`,
          });
          return { interrupted: true, path };
        }
        setTransfer(null);
        transferRef.current = null;
        setUploadQueue(prev => prev.filter(item => item.path !== path));
        addNotification({
          title: t('files.status.errorTitle'),
          message: `${file.name}: ${startData.error}`,
          type: 'error',
        });
        return;
      }

      // Dynamic chunk sizing for max network throughput:
      // >10MB files: 1MB chunks, >1MB files: 512KB chunks, ≤1MB files: 256KB chunks
      const chunkSize = file.size > 10 * 1024 * 1024 ? 1024 * 1024 : (file.size > 1 * 1024 * 1024 ? 512 * 1024 : 256 * 1024);
      let offset = startData.offset || resumeOffset;

      while (offset < file.size) {
        // If transfer was closed/cancelled, stop the loop
        if (transferRef.current !== transferObj) {
          console.log(`📤 [${file.name}] Loop exited: transfer cancelled (offset=${offset}, file.size=${file.size})`);
          break;
        }

        // If we are rate limited, wait for the countdown
        if (transferCountdownRef.current > 0) {
          await new Promise(r => {
            const check = setInterval(() => {
              if (transferRef.current !== transferObj) {
                clearInterval(check);
                r();
              } else if (transferCountdownRef.current === 0) {
                clearInterval(check);
                r();
              }
            }, 500);
          });
          if (transferRef.current !== transferObj) break;
          // After waiting, we need to RE-START the upload session from current offset
          socket = getSocket();
          if (!socket?.connected) break;
          socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset });
          const resumeStartData = await waitForUploadHandshake(offset);
          socket = getSocket();
          if (!socket?.connected) break;
          if (transferRef.current !== transferObj) break;

          if (resumeStartData.error) {
            console.error("Handshake after rate limit countdown failed:", resumeStartData.error);
            setTransfer(prev => prev ? { ...prev, waiting: true, error: true } : null);
            if (isTransferChannelError(resumeStartData.error)) {
              requestReconnect('Upload channel stalled. Reconnecting...', {
                preserveTransfer: true,
                notificationMessage: 'Upload stalled. Reconnecting and keeping the upload queue for retry.',
              });
              return { interrupted: true, path };
            }
            return;
          }
          if (resumeStartData.rateLimited) {
            const waitMs = resumeStartData.resetIn || 5000;
            const seconds = Math.ceil(waitMs / 1000);
            setTransfer(prev => prev ? { ...prev, waiting: true, countdown: seconds } : null);
            setTransferCountdown(seconds);
            continue;
          }
          setTransfer(prev => ({ ...prev, waiting: false, countdown: 0 }));
        }

        if (transferRef.current !== transferObj) break;

        // ── Pipelined chunk sending ──────────────────────────────────────────
        // Send up to PIPELINE_SIZE chunks without waiting for ACK each time.
        // ACKs are processed as they arrive — window slides forward on each ACK.
        // This eliminates the 2×RTT stall per chunk that made socket uploads slow.
        const PIPELINE_SIZE = 8;
        let inFlight = 0;
        let pipelineError = null;
        let rateLimitResult = null;
        let guardResult = null;
        let lastProgressUi = 0;
        let lastProgressPct = -1;
        const pendingAcks = []; // ordered list of {resolve, reject, chunkOffset, chunkSize}

        const sockForPipeline = getSocket();
        if (!sockForPipeline?.connected) break;

        // Shared error handler — fires on any sftp:error during this pipeline
        const pipelineErrHandler = (err) => {
          if (err.resetIn) {
            rateLimitResult = { rateLimited: true, resetIn: err.resetIn };
            // Resolve all pending acks so the loop drains cleanly
            for (const p of pendingAcks) p.resolve(rateLimitResult);
            pendingAcks.length = 0;
          } else if (err?.guard) {
            guardResult = { guardBlocked: err.guard, retryAfter: 5000 };
            for (const p of pendingAcks) p.resolve(guardResult);
            pendingAcks.length = 0;
          } else {
            pipelineError = err;
            for (const p of pendingAcks) p.reject(err);
            pendingAcks.length = 0;
          }
        };
        sockForPipeline.on('sftp:error', pipelineErrHandler);

        // ACK handler — resolves the oldest pending promise in order
        const ackHandler = (data) => {
          const pending = pendingAcks.shift();
          if (pending) pending.resolve(data);
        };
        sockForPipeline.on(`sftp:upload_ack:${file.name}`, ackHandler);

        const cleanupPipeline = () => {
          sockForPipeline.off(`sftp:upload_ack:${file.name}`, ackHandler);
          sockForPipeline.off('sftp:error', pipelineErrHandler);
          activeAckCleanupRef.current = null;
        };
        activeAckCleanupRef.current = cleanupPipeline;

        // Keep send position separate from ACK-confirmed position. The previous
        // code reused offset for both, which could rewind the sender when ACKs
        // arrived while the pipeline window was still filling.
        let sendOffset = offset;
        let ackedOffset = offset;

        while (sendOffset < file.size) {
          if (transferRef.current !== transferObj || pipelineError || rateLimitResult || guardResult) break;

          // If window is full, wait for the oldest ACK before sending more
          if (inFlight >= PIPELINE_SIZE) {
            const ackResult = await new Promise((resolve, reject) => {
              const entry = pendingAcks[0];
              if (!entry) { resolve({}); return; }
              const orig = { resolve: entry.resolve, reject: entry.reject };
              entry.resolve = resolve;
              entry.reject = reject;
            }).catch(err => { pipelineError = err; return null; });

            if (!ackResult || pipelineError) break;
            inFlight--;

            if (ackResult.rateLimited) { rateLimitResult = ackResult; break; }
            if (ackResult.guardBlocked) { guardResult = ackResult; break; }

            ackedOffset = typeof ackResult.totalTransferred === 'number' ? ackResult.totalTransferred : ackedOffset;
            const now = Date.now();
            const pct = Math.min(99, Math.round((ackedOffset / file.size) * 100));
            if (pct !== lastProgressPct && (now - lastProgressUi >= 250 || pct === 99)) {
              lastProgressUi = now;
              lastProgressPct = pct;
              setTransfer(prev => prev ? { ...prev, progress: pct, waiting: false } : null);
              updateNotification(uploadNotifId, { message: `${displayName || file.name} — ${pct}%` });
            }
          }

          const end = Math.min(sendOffset + chunkSize, file.size);
          const buf = await file.slice(sendOffset, end).arrayBuffer();
          if (transferRef.current !== transferObj) break;

          const chunkOffset = sendOffset;
          const chunkLen = end - sendOffset;
          const ackPromise = new Promise((resolve, reject) => {
            pendingAcks.push({ resolve, reject, chunkOffset, chunkSize: chunkLen });
          });
          // Register timeout per chunk
          const timeoutId = setTimeout(() => {
            const idx = pendingAcks.findIndex(p => p.chunkOffset === chunkOffset);
            if (idx !== -1) {
              const p = pendingAcks.splice(idx, 1)[0];
              p.reject(new Error('Upload acknowledgment timeout'));
            }
          }, 20000);
          ackPromise.finally(() => clearTimeout(timeoutId));

          sockForPipeline.emit(`sftp:upload_chunk:${file.name}`, buf);
          inFlight++;
          sendOffset = end;
        }

        // Drain remaining in-flight ACKs
        while (pendingAcks.length > 0 && !pipelineError && !rateLimitResult && !guardResult) {
          const p = pendingAcks[0];
          const ackResult = await new Promise((res, rej) => { p.resolve = res; p.reject = rej; })
            .catch(err => { pipelineError = err; return null; });
          if (!ackResult || pipelineError) break;
          if (ackResult.rateLimited) { rateLimitResult = ackResult; break; }
          if (ackResult.guardBlocked) { guardResult = ackResult; break; }
          ackedOffset = typeof ackResult.totalTransferred === 'number' ? ackResult.totalTransferred : ackedOffset;
          const now = Date.now();
          const pct = Math.min(99, Math.round((ackedOffset / file.size) * 100));
          if (pct !== lastProgressPct && (now - lastProgressUi >= 250 || pct === 99)) {
            lastProgressUi = now;
            lastProgressPct = pct;
            setTransfer(prev => prev ? { ...prev, progress: pct, waiting: false } : null);
            updateNotification(uploadNotifId, { message: `${displayName || file.name} — ${pct}%` });
          }
        }

        cleanupPipeline();
        offset = ackedOffset;

        if (pipelineError) throw pipelineError;

        const ackResult = rateLimitResult || guardResult || {};

        if (ackResult.rateLimited && !ackResult.guardBlocked) {
          const waitMs = ackResult.resetIn || 5000;
          const seconds = Math.ceil(waitMs / 1000);
          console.log(`⏳ Rate limited mid-transfer — waiting ${waitMs}ms before retry`);
          setTransfer(prev => prev ? { ...prev, waiting: true, countdown: seconds } : null);
          setTransferCountdown(seconds);
          
          await new Promise(r => {
            const check = setInterval(() => {
              if (transferRef.current !== transferObj) { clearInterval(check); r(); }
              else if (transferCountdownRef.current === 0) { clearInterval(check); r(); }
            }, 500);
          });
          if (transferRef.current !== transferObj) break;
          setTransfer(prev => prev ? { ...prev, waiting: false, countdown: 0 } : null);
          
          socket = getSocket();
          if (!socket?.connected) break;
          socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset });
          const resumeData = await waitForUploadHandshake(offset);
          socket = getSocket();
          if (!socket?.connected) break;
          if (transferRef.current !== transferObj) break;
          if (resumeData.error) {
            console.error("Handshake after mid-transfer rate limit failed:", resumeData.error);
            setTransfer(null);
            transferRef.current = null;
            return;
          }
          if (resumeData.rateLimited) {
            const resumeWaitMs = resumeData.resetIn || 5000;
            const resumeSeconds = Math.ceil(resumeWaitMs / 1000);
            setTransfer(prev => prev ? { ...prev, waiting: true, countdown: resumeSeconds } : null);
            setTransferCountdown(resumeSeconds);
          }
          continue;
        }
        if (ackResult.guardBlocked) {
          // Memory / concurrency guard mid-transfer — wait then re-open the upload session
          const waitMs = ackResult.retryAfter || 5000;
          console.log(`⏳ Guard blocked mid-transfer (${ackResult.guardBlocked}) — waiting ${waitMs}ms, offset=${offset}`);
          setTransfer(prev => prev ? { ...prev, waiting: true, guardError: ackResult.guardBlocked } : null);
          await new Promise(r => setTimeout(r, waitMs));
          if (transferRef.current !== transferObj) break;
          // Re-open upload session from where we left off
          socket = getSocket();
          if (!socket?.connected) break;
          socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset });
          const resumeData = await waitForUploadHandshake(offset);
          socket = getSocket();
          if (!socket?.connected) break;
          if (transferRef.current !== transferObj) break;
          if (resumeData.guardBlocked) {
            // Still blocked — treat as a hard error after mid-transfer retry
            throw new Error(`Server still busy (${resumeData.guardType}) after retry. Upload paused — please retry manually.`);
          }
          setTransfer(prev => prev ? { ...prev, waiting: false, guardError: null } : null);
          continue;
        }

        offset = typeof ackResult.totalTransferred === 'number'
          ? ackResult.totalTransferred
          : offset;
        // offset and progress are updated inside the pipeline window drain loop above
      }

      if (transferRef.current === transferObj) {
        // Re-fetch socket before upload_done — reconnect could have happened during chunk loop
        socket = getSocket();
        if (!socket?.connected) {
          requestReconnect('Connection lost before upload finalization. Reconnecting...', {
            preserveTransfer: true,
            notificationMessage: `${file.name}: Connection lost during upload finalization. Reconnecting...`,
          });
          return { interrupted: true, path };
        }
        console.log(`📤 [${file.name}] Sending sftp:upload_done`);
        socket.emit(`sftp:upload_done:${file.name}`);
        console.log(`📤 [${file.name}] Upload complete: sent ${offset} bytes of ${file.size} bytes (${(offset/file.size*100).toFixed(2)}%)`);
        // Mark transfer as finalizing — all bytes sent, waiting for server confirmation
        setTransfer(prev => prev ? { ...prev, progress: 100, finalizing: true } : null);
        console.log(`📤 [${file.name}] Waiting for upload completion (60s timeout)...`);
        try {
          await waitForUploadCompletion();
          console.log(`✅ [${file.name}] Upload completion received!`);
        } catch (completionErr) {
          console.error(`❌ [${file.name}] Upload completion failed:`, completionErr.message);
          throw completionErr;
        }
        if (transferRef.current === transferObj) {
          // Update notification to success
          updateNotification(uploadNotifId, {
            title: t('files.status.upload'),
            message: `${file.name} — 100%`,
            type: 'success',
            duration: 3000,
          });
          // Record in the user's Activity timeline (fire-and-forget)
          try {
            fetch('/api/activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'upload.success',
                message: `Uploaded ${file.name}`,
                category: 'file',
                target: file.name,
                status: 'success',
                meta: { path, size: file.size },
              }),
              keepalive: true,
            }).catch(() => {});
          } catch (_) {}
          // Remove from queue on completion
          setUploadQueue(prev => prev.filter(item => item.path !== path));
          if (!skipCleanup) {
            setTransfer(null);
            transferRef.current = null;
          }
          if (e) e.target.value = null; // Reset input if it was from event
          // Auto-refresh file list so newly uploaded file appears instantly
          if (!skipCleanup) {
            getSocket()?.emit('sftp:list', currentPathRef.current || '.');
          }
          return { path };
        }
      }
    } catch (err) {
      console.error("Upload Loop Error:", err);
      if (transferRef.current === transferObj) {
        if (isTransferChannelError(err)) {
          // Update notification to paused state
          updateNotification(uploadNotifId, {
            title: t('files.status.upload'),
            message: `${file.name} — paused, reconnecting...`,
            type: 'warning',
            duration: 0,
          });
          requestReconnect('Upload interrupted. Reconnecting SSH...', {
            preserveTransfer: true,
            notificationMessage: `${file.name} paused while SSH reconnects. Your upload queue is kept for retry.`,
          });
          return { interrupted: true, path };
        }
        setTransfer(null);
        transferRef.current = null;
        setUploadQueue(prev => prev.filter(item => item.path !== path));
        updateNotification(uploadNotifId, {
          title: t('files.status.errorTitle'),
          message: `${file.name} — ${err.message || 'Upload failed'}`,
          type: 'error',
          duration: 5000,
        });
      }
    } finally {
      if (activeHandshakeCleanupRef.current) { activeHandshakeCleanupRef.current(); activeHandshakeCleanupRef.current = null; }
      if (activeAckCleanupRef.current) { activeAckCleanupRef.current(); activeAckCleanupRef.current = null; }
      if (activeCompletionCleanup) activeCompletionCleanup();
    }
  };

  const handleDownload = async (file, offset = 0) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (!(await ensureSocketReadyAsync('retry the download'))) return;
     const path = file.absPath || (currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`);
     lastDownloadRef.current = { file, offset };
      const existingDownload = downloadBufferRef.current[file.filename];
      if (existingDownload?.toastId) {
       removeNotification(existingDownload.toastId);
      }
     
     const tId = addNotification({ 
        title: offset > 0 ? t('files.status.resuming') : t('files.status.download'), 
        message: `${t('files.actions.loading', { action: t('files.context.download') })} ${file.filename}...`, 
        type: 'loading', 
        duration: 0 
     });
     
     // Initialize download buffer state
     downloadBufferRef.current[file.filename] = {
        buffer: offset > 0 && existingDownload?.buffer?.length ? existingDownload.buffer : [],
        toastId: tId,
        bytesReceived: offset > 0 ? Math.max(existingDownload?.bytesReceived || 0, offset) : 0,
     };

     socket.emit('sftp:download', { filePath: path, offset });
  };

  useEffect(() => {
    if (status !== 'ready' || !socket) return;

    const pendingResume = pendingTransferResumeRef.current;
    if (!pendingResume) return;

    if (pendingResume.type === 'download' && pendingResume.file) {
      pendingTransferResumeRef.current = null;
      addNotification({
        title: 'Connection restored',
        message: `Resuming download of ${pendingResume.file.filename}...`,
        type: 'info',
      });
      const resumeOffset = pendingResume.offset || lastDownloadRef.current?.offset || 0;
      const timer = setTimeout(() => {
        handleDownload(pendingResume.file, resumeOffset);
      }, 200);
      return () => clearTimeout(timer);
    }

    if (pendingResume.type === 'upload') {
      resumePendingUploads();
      return;
    }
  }, [status, socket, resumePendingUploads, addNotification]);

  useEffect(() => {
    handleFileUploadRef.current = handleFileUpload;
  });

  const handleDownloadFolder = async (file) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!(await ensureSocketReadyAsync('retry the folder download'))) return;
    const folderPath = file.absPath || (currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`);
    const dlName = file.filename + '.tar.gz';
    
    const tId = addNotification({ 
        title: t('files.status.download'), 
        message: `${t('files.actions.loading', { action: t('files.context.download') })} ${dlName}...`, 
        type: 'loading', 
        duration: 0 
    });

    downloadBufferRef.current[dlName] = { buffer: [], toastId: tId };
    setTransfer({ filename: dlName, progress: -1, action: 'download' });
    socket.emit('sftp:download_folder', { folderPath });
  };

  const handleDownloadSelected = async () => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!(await ensureSocketReadyAsync('retry the download'))) return;

    const selected = filteredFiles.filter(f => selectedFiles.has(f.filename));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      const f = selected[0];
      return f.longname.startsWith('d') ? handleDownloadFolder(f) : handleDownload(f);
    }
    const paths = selected.map(f => ({
      filePath: currentPath === '.' ? f.filename : `${currentPath}/${f.filename}`,
      isDir: f.longname.startsWith('d'),
    }));
    const dlName = 'selection.tar.gz';
    
    const tId = addNotification({ 
        title: t('files.status.download'), 
        message: `${t('files.actions.loading', { action: t('files.context.download') })} ${dlName}...`, 
        type: 'loading', 
        duration: 0 
    });

    downloadBufferRef.current[dlName] = { buffer: [], toastId: tId };
    setTransfer({ filename: dlName, progress: -1, action: 'download' });
    socket.emit('sftp:download_folder', { paths });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if it's a cross-server file drag
    if (e.dataTransfer.types.includes('application/ssh-file')) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
      return;
    }
    // Local file upload from desktop
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    }
  };

  const handleFolderUpload = async (entries, targetPath, folderName) => {
    let socket = socketRef.current;
    if (!socket) return;
    if (!(await ensureSocketReadyAsync('retry the folder upload'))) return;
    socket = socketRef.current;
    if (!socket?.connected) return;

    const totalTarSize = calculateTarTotalSize(entries);
    const tempArchiveName = `.__ssh_monitor_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tar`;
    const destArchivePath = targetPath === '.' ? tempArchiveName : `${targetPath}/${tempArchiveName}`;

    const transferObj = {
      filename: folderName,
      realFilename: tempArchiveName,
      path: destArchivePath,
      progress: 0,
      action: 'upload',
      waiting: false,
      channel: (rtcPeerRef.current && relayConnIdRef.current) ? 'webrtc' : 'socket',
    };
    setTransfer(transferObj);
    transferRef.current = transferObj;

    const uploadNotifId = addNotification({
      title: t('files.status.upload'),
      message: `${folderName} — 0%`,
      type: 'loading',
      duration: 0,
    });
    toastRef.current = uploadNotifId;
    transferObj.toastId = uploadNotifId;

    let lastProgressUi = 0;
    let lastReportedPct = -1;
    let lastBytes = 0;
    let lastSpeedCalcTime = Date.now();
    let currentSpeedText = '';

    const onProgress = (sent, total, meta = {}) => {
      if (transferRef.current !== transferObj) return;
      const now = Date.now();
      const isFinalizing = meta.finalizing || sent >= total;
      const pct = isFinalizing ? 100 : Math.min(99, Math.round((sent / total) * 100));

      const dt = (now - lastSpeedCalcTime) / 1000;
      if (dt >= 0.4) {
        const dBytes = sent - lastBytes;
        const bps = dBytes / dt;
        lastBytes = sent;
        lastSpeedCalcTime = now;
        currentSpeedText = bps >= 1024 * 1024
          ? `${(bps / 1024 / 1024).toFixed(1)} MB/s`
          : `${(bps / 1024).toFixed(0)} KB/s`;
      }

      if (pct !== lastReportedPct && (now - lastProgressUi >= 250 || pct === 99 || isFinalizing)) {
        lastProgressUi = now;
        lastReportedPct = pct;
        setTransfer(prev => prev ? {
          ...prev,
          progress: pct,
          waiting: false,
          speed: currentSpeedText,
          finalizing: isFinalizing,
          status: meta.status || (isFinalizing ? '✓ 100% Uploaded — Server finalizing write...' : null),
        } : null);
        updateNotification(uploadNotifId, {
          message: `${folderName} — ${isFinalizing ? 'Finalizing...' : `${pct}%${currentSpeedText ? ` (${currentSpeedText})` : ''}`}`
        });
      }
    };

    // ── WebRTC Direct TAR Streaming (Zero Composite Blobs, Zero Memory) ──
    if (rtcPeerRef.current && relayConnIdRef.current) {
      const peer = rtcPeerRef.current;
      const connId = relayConnIdRef.current;
      const abortController = new AbortController();
      try {
        await streamTarUpload(peer, connId, entries, destArchivePath, tempArchiveName, {
          onProgress,
          signal: abortController.signal,
        });

        if (transferRef.current === transferObj) {
          const extractTransferObj = {
            filename: folderName,
            realFilename: tempArchiveName,
            path: destArchivePath,
            progress: 0,
            action: 'extract',
            totalFiles: entries.length,
            totalBytes: totalTarSize,
            extractedCount: 0,
            status: `Starting extraction of ${entries.length.toLocaleString()} files...`,
            toastId: uploadNotifId,
          };
          setTransfer(extractTransferObj);
          transferRef.current = extractTransferObj;

          updateNotification(uploadNotifId, {
            title: t('files.status.upload'),
            message: `${folderName} — Extracting ${entries.length.toLocaleString()} files...`,
            type: 'loading',
            duration: 0,
          });

          socket.emit('sftp:extract', { path: destArchivePath, type: 'tar', cleanupArchive: true });

          // Wait for extraction to complete
          await new Promise((resolve) => {
            const onExtractDone = (data) => {
              if (data?.action === 'extract') {
                socket.off('sftp:action_success', onExtractDone);
                socket.off('sftp:error', onExtractDone);
                resolve(data);
              }
            };
            socket.on('sftp:action_success', onExtractDone);
            socket.on('sftp:error', onExtractDone);
          });

          setTransfer(null);
          transferRef.current = null;

          addNotification({
            title: 'Upload Complete',
            message: `Extracted ${folderName} (${entries.length} files, ${(totalTarSize / 1024 / 1024).toFixed(1)} MB)`,
            type: 'success',
            duration: 5000,
          });
          socket.emit('sftp:list', currentPathRef.current || '.');
          return;
        }
      } catch (rtcErr) {
        if (rtcErr.name === 'AbortError') {
          setTransfer(null);
          transferRef.current = null;
          updateNotification(uploadNotifId, { title: t('files.status.upload'), message: `${folderName} — cancelled`, type: 'warning', duration: 3000 });
          return;
        }
        console.warn(`[Folder Upload][WebRTC] streamTarUpload failed (${rtcErr.message}), falling back to socket path`);
        try { peer.close(); } catch (_) {}
        rtcPeerRef.current = null;
      }
    }

    // ── Socket Mode Direct TAR Streaming ──
    try {
      socket = socketRef.current;
      if (!socket?.connected) throw new Error('Socket disconnected');
      socket.emit('sftp:upload', { filename: tempArchiveName, path: destArchivePath, size: totalTarSize, offset: 0 });

      // Handshake
      const startData = await new Promise(resolve => {
        const h = (d) => { if (d.filename === tempArchiveName) { cleanup(); resolve(d); } };
        const cleanup = () => { clearTimeout(timer); socket.off('sftp:can_upload', h); };
        const timer = setTimeout(() => { cleanup(); resolve({ error: 'Handshake timeout' }); }, 20000);
        socket.on('sftp:can_upload', h);
      });

      if (startData.error) throw new Error(startData.error);

      const CHUNK_SIZE = 64 * 1024;
      let sentBytes = 0;

      for (const { entry, file: storedFile, relativePath, size: entrySize, lastModified: entryLastModified } of entries) {
        if (transferRef.current !== transferObj) break;

        const fileSize = entrySize ?? storedFile?.size ?? 0;
        const fileLastModified = entryLastModified ?? storedFile?.lastModified ?? Date.now();

        const headerBlocks = getTarHeaderBlocks(relativePath, fileSize, fileLastModified);
        for (const h of headerBlocks) {
          socket.emit(`sftp:upload_chunk:${tempArchiveName}`, h);
          sentBytes += h.length;
        }

        // Lazily fetch a fresh File handle just before reading to avoid NotReadableError
        let file = storedFile;
        if (!file && entry) {
          file = await new Promise((res, rej) => entry.file(res, rej));
        }

        let fileOffset = 0;
        while (fileOffset < fileSize) {
          if (transferRef.current !== transferObj) break;
          const sliceEnd = Math.min(fileOffset + CHUNK_SIZE, fileSize);
          let buf;
          try {
            buf = await file.slice(fileOffset, sliceEnd).arrayBuffer();
          } catch (readErr) {
            if (entry && readErr.name === 'NotReadableError') {
              // File handle expired — re-obtain fresh File from the FileSystemEntry
              file = await new Promise((res, rej) => entry.file(res, rej));
              buf = await file.slice(fileOffset, sliceEnd).arrayBuffer();
            } else {
              throw readErr;
            }
          }
          socket.emit(`sftp:upload_chunk:${tempArchiveName}`, buf);
          sentBytes += buf.byteLength;
          fileOffset = sliceEnd;
          onProgress(sentBytes, totalTarSize);
          const delay = getPacingDelayMs();
          if (delay > 0) {
            await new Promise(r => setTimeout(r, delay));
          } else {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const padLen = (512 - (fileSize % 512)) % 512;
        if (padLen > 0) {
          socket.emit(`sftp:upload_chunk:${tempArchiveName}`, new Uint8Array(padLen));
          sentBytes += padLen;
        }
      }

      socket.emit(`sftp:upload_chunk:${tempArchiveName}`, new Uint8Array(1024));
      socket.emit(`sftp:upload_done:${tempArchiveName}`);

      if (transferRef.current === transferObj) {
        const extractTransferObj = {
          filename: folderName,
          realFilename: tempArchiveName,
          path: destArchivePath,
          progress: 0,
          action: 'extract',
          totalFiles: entries.length,
          totalBytes: totalTarSize,
          extractedCount: 0,
          status: `Starting extraction of ${entries.length.toLocaleString()} files...`,
          toastId: uploadNotifId,
        };
        setTransfer(extractTransferObj);
        transferRef.current = extractTransferObj;

        updateNotification(uploadNotifId, {
          title: t('files.status.upload'),
          message: `${folderName} — Extracting ${entries.length.toLocaleString()} files...`,
          type: 'loading',
          duration: 0,
        });

        socket.emit('sftp:extract', { path: destArchivePath, type: 'tar', cleanupArchive: true });

        // Wait for extraction to complete
        await new Promise((resolve) => {
          const onExtractDone = (data) => {
            if (data?.action === 'extract') {
              socket.off('sftp:action_success', onExtractDone);
              socket.off('sftp:error', onExtractDone);
              resolve(data);
            }
          };
          socket.on('sftp:action_success', onExtractDone);
          socket.on('sftp:error', onExtractDone);
        });

        setTransfer(null);
        transferRef.current = null;

        addNotification({
          title: 'Upload Complete',
          message: `Extracted ${folderName} (${entries.length} files, ${(totalTarSize / 1024 / 1024).toFixed(1)} MB)`,
          type: 'success',
          duration: 5000,
        });
        socket.emit('sftp:list', currentPathRef.current || '.');
      }
    } catch (err) {
      console.error('❌ Folder upload error:', err);
      updateNotification(uploadNotifId, { title: 'Upload Error', message: `${folderName}: ${err.message}`, type: 'error', duration: 5000 });
      setTransfer(null);
      transferRef.current = null;
      socket.emit('sftp:delete', destArchivePath);
    }
  };

  const traverseEntry = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      await handleFileUpload(null, file, 0, path);
    } else if (entry.isDirectory) {
      const allEntries = [];
      let totalFilesSize = 0;

      const collectEntries = async (ent, currentRelPath = '') => {
        if (ent.isFile) {
          // Get size/lastModified for TAR metadata, but store the FileSystemFileEntry
          // for lazy re-read at upload time. Holding a File object long-term causes
          // NotReadableError in Chrome when the drag-and-drop file handle expires.
          const f = await new Promise((res, rej) => ent.file(res, rej));
          if (f) {
            allEntries.push({
              entry: ent,                     // FileSystemFileEntry — used for lazy re-read
              relativePath: currentRelPath + ent.name,
              size: f.size,
              lastModified: f.lastModified,
            });
            totalFilesSize += f.size;
            if (allEntries.length % 50 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }
        } else if (ent.isDirectory) {
          const reader = ent.createReader();
          const readBatch = async () => {
            const results = await new Promise(r => reader.readEntries(r));
            if (results && results.length > 0) {
              for (const result of results) {
                await collectEntries(result, currentRelPath + ent.name + '/');
              }
              await readBatch();
            }
          };
          await readBatch();
        }
      };

      setTransfer({ filename: entry.name, progress: 0, action: 'scan', status: 'Scanning folder contents...' });
      await collectEntries(entry);

      if (allEntries.length === 0) {
        const targetDir = path === '.' ? entry.name : `${path}/${entry.name}`;
        socketRef.current?.emit('sftp:mkdir', targetDir);
        setTransfer(null);
        addNotification({ title: 'Folder Created', message: `${entry.name} (empty folder)`, type: 'success' });
        loadFiles(currentPath);
        return;
      }

      await handleFolderUpload(allEntries, path, entry.name);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Check for cross-server file drop
    const sshFileData = e.dataTransfer.getData('application/ssh-file');
    if (sshFileData) {
      try {
        const dragData = JSON.parse(sshFileData);
        const dragItems = dragData.files || [{
          filename: dragData.filename,
          filePath: dragData.filePath,
          isDir: dragData.isDir,
          size: dragData.size
        }];

        // Only do cross-server transfer if from a different connection
        if (dragData.connectionId !== connectionId) {
          const transferObj = {
            filename: dragItems.length > 1 ? `${dragItems.length} items` : dragItems[0].filename,
            progress: 0,
            action: 'copy',
            isCrossServer: true,
            status: '🚀 High-Speed Direct Stream in progress...',
            waiting: false
          };
          setTransfer(transferObj);
          transferRef.current = transferObj;

          toastRef.current = addNotification({ 
            title: '🚀 High-Speed Direct Stream', 
            message: `${t('files.status.uploadingTo')} ${dragItems.length > 1 ? `${dragItems.length} items` : dragItems[0].filename}...`, 
            type: 'loading', 
            duration: 0 
          });

          dragItems.forEach(item => {
            const destPath = currentPath === '.' 
              ? item.filename 
              : `${currentPath}/${item.filename}`;
            socket.emit('sftp:cross_server_transfer', {
              srcConnId: dragData.connectionId,
              srcPath: item.filePath,
              destPath: destPath,
              action: 'copy'
            });
          });
          return;
        } else {
          // Same server - do a regular copy
          const transferObj = {
            filename: dragItems.length > 1 ? `${dragItems.length} items` : dragItems[0].filename,
            progress: 0,
            action: 'copy',
            waiting: false
          };
          setTransfer(transferObj);
          transferRef.current = transferObj;

          toastRef.current = addNotification({ 
            title: t('files.context.copy'), 
            message: `${t('files.context.copy')} ${dragItems.length > 1 ? `${dragItems.length} items` : dragItems[0].filename}...`, 
            type: 'loading', 
            duration: 0 
          });

          dragItems.forEach(item => {
            const destPath = currentPath === '.' 
              ? item.filename 
              : `${currentPath}/${item.filename}`;
            if (item.filePath !== destPath) {
              socket.emit('sftp:copy', { src: item.filePath, dest: destPath });
            }
          });
          return;
        }
      } catch (err) {
        console.error('Cross-server drop parse error:', err);
      }
    }
    
    // Regular local file uploads
    const items = e.dataTransfer.items;
    if (items) {
      // Collect entries synchronously because awaiting invalidates DataTransferItemList
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }
      for (const entry of entries) {
        await traverseEntry(entry, currentPath);
      }
    } else {
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (!droppedFiles || droppedFiles.length === 0 || !socket) return;

      // Bulk overwrite check for multi-file uploads
      const conflicting = droppedFiles.filter(f => files.some(existing => existing.filename === f.name));
      if (conflicting.length > 0) {
        const choice = await new Promise(resolve => {
          showConfirm(
            `${conflicting.length} file${conflicting.length > 1 ? 's' : ''} already exist${conflicting.length === 1 ? 's' : ''} on the server:\n${conflicting.map(f => `• ${f.name}`).join('\n')}\n\nOverwrite all existing files?`,
            () => resolve('overwrite'),
            'Files Already Exist',
            'Overwrite All',
            'Skip Existing',
            () => resolve('skip'),
          );
        });
        if (choice === 'skip') {
          // Upload only non-conflicting files
          const nonConflicting = droppedFiles.filter(f => !conflicting.some(c => c.name === f.name));
          for (const file of nonConflicting) {
            await handleFileUpload(null, file, 0, null, null, true);
          }
        } else {
          // Overwrite all
          for (const file of droppedFiles) {
            await handleFileUpload(null, file, 0, null, null, true);
          }
        }
      } else {
        // No conflicts, upload all
        for (const file of droppedFiles) {
          await handleFileUpload(null, file, 0, null, null, true);
        }
      }
    }
  };

  // System Copy-Paste Support
  useEffect(() => {
    const handleSystemPaste = async (e) => {
      // Split-pane fix: inactive panes must never react to global Ctrl+V
      if (isSplit && !isActivePane) return;
      // Only handle paste if something else isn't focused (inputs/textareas)
      if (document.activeElement.tagName === 'INPUT' || 
          (document.activeElement.tagName === 'TEXTAREA' && !document.activeElement.closest('.FileManager'))) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) {
        if (clipboard) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }

      // First check for files (including folders in some browsers)
      let foundFiles = false;
      
      // Collect synchronously 
      const entriesToProcess = [];
      const filesToUpload = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            foundFiles = true;
            // WebkitGetAsEntry also works for paste in some newer browsers
            const entry = item.webkitGetAsEntry?.();
            if (entry) {
              entriesToProcess.push(entry);
            } else {
              filesToUpload.push(file);
            }
          }
        }
      }
      
      if (foundFiles) {
        e.preventDefault();
        addNotification({ 
          title: t('files.toasts.uploadStarted') || 'Upload Started', 
          message: t('files.toasts.uploadingFiles') || 'Uploading files to current folder...', 
          type: 'info' 
        });

        // Process asynchronously after collecting
        for (const entry of entriesToProcess) {
          await traverseEntry(entry, currentPath);
        }
        for (const file of filesToUpload) {
          await handleFileUpload(null, file);
        }
      } else if (clipboard) {
        e.preventDefault();
        handlePaste();
      }
    };

    window.addEventListener('paste', handleSystemPaste);
    return () => window.removeEventListener('paste', handleSystemPaste);
  }, [currentPath, socket, clipboard, handlePaste]);

   const handleCreate = () => {
    if (!createModal.name || !socket) return;
    const path = currentPath === '.' ? createModal.name : `${currentPath}/${createModal.name}`;
    
    // Check if folder/file already exists
    const existing = files.find(f => f.filename === createModal.name);
    if (existing) {
      addNotification({
        title: t('files.modals.create.create'),
        message: `"${createModal.name}" already exists.`,
        type: 'error',
      });
      return;
    }

    toastRef.current = addNotification({ title: t('files.modals.create.create'), message: `${t('files.actions.loading', { action: t('files.modals.create.create') })} ${createModal.type}...`, type: 'loading', duration: 0 });
    if (createModal.type === 'folder') {
      socket.emit('sftp:mkdir', path);
    } else {
      socket.emit('sftp:writeFile', { path, content: '' });
    }
    setCreateModal({ ...createModal, visible: false, name: '' });
  };

  const handleDelete = () => {
    if ((!contextMenu.file && selectedFiles.size === 0) || !socket) return;
    
    // Pre-flight: ensure connection is alive before attempting delete
    if (!ensureSocketReady('delete files')) return;
    
    const fileTarget = contextMenu.file ? contextMenu.file.filename : null;
    let targets = Array.from(selectedFiles);
    if (fileTarget && !selectedFiles.has(fileTarget)) {
       targets = [fileTarget];
    }
    
    if (targets.length === 0) return;

    showConfirm(
      targets.length > 1 ? `${t('files.modals.delete.confirm')} ${targets.length} items?` : `${t('files.modals.delete.confirm')} '${targets[0]}'?`,
      () => {
        // Double-check socket is still connected right before emitting
        if (!socketRef.current?.connected || statusRef.current !== 'ready') {
          addNotification({ title: t('files.status.error'), message: t('files.errors.deleteDisconnect', 'Connection lost before deletion could start. Please reconnect and try again.'), type: 'error' });
          requestReconnect('Connection lost. Reconnecting...');
          return;
        }
        
        const toastId = addNotification({ 
          title: t('files.modals.delete.delete'), 
          message: `${t('files.actions.deleting')}: ${truncateName(targets[0], 15)}${targets.length > 1 ? ` (+${targets.length - 1})` : ''} (0/${targets.length})`, 
          type: 'loading', 
          duration: 0 
        });
        
        deleteBatchRef.current = {
          count: 0,
          total: targets.length,
          toastId: toastId
        };
        
        // Safety timeout — if the server goes silent, notify the user instead of silently clearing
        setTimeout(() => {
           if (deleteBatchRef.current.toastId === toastId) {
              removeNotification(toastId);
              deleteBatchRef.current = { count: 0, total: 0, toastId: null };
              setDeletingFiles(new Set());
              addNotification({ 
                title: t('files.status.error'), 
                message: t('files.errors.deleteTimeout', 'Deletion timed out — the server may be unreachable. Please refresh the file list to verify.'), 
                type: 'error',
                duration: 8000
              });
              // Refresh file list so UI reflects actual server state
              const targetPath = currentPathRef.current || '.';
              if (socketRef.current?.connected) {
                socketRef.current.emit('sftp:list', targetPath);
              }
           }
        }, 60000);

        const targetSet = new Set(targets);
        setDeletingFiles(prev => new Set([...prev, ...targetSet]));
        
        // Purge any deleted items from uploadQueue so re-pasted uploads start cleanly from 0%
        setUploadQueue(prev => prev.filter(item => {
          const itemFilename = item.path ? item.path.split('/').pop() : item.displayName;
          return !targetSet.has(itemFilename) && !targetSet.has(item.path);
        }));

        targets.forEach(filename => {
           const path = currentPath === '.' ? filename : `${currentPath}/${filename}`;
           socket.emit('sftp:delete', path);
        });
        setSelectedFiles(new Set());
        setContextMenu({ ...contextMenu, visible: false });
      },
      t('files.modals.delete.title'),
      t('files.modals.delete.yes'),
      t('files.modals.delete.no')
    );
  };

  const handleInfo = () => {
    if (!contextMenu.file) return;
    const isDir = contextMenu.file.longname?.startsWith('d');
    const filePath = currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`;
    setInfoModal({ visible: true, file: contextMenu.file, sizeLoading: isDir, realSize: null });
    setContextMenu({ ...contextMenu, visible: false });
    // Always fetch real size via du -sb (works for both files and folders)
    if (socket) {
      socket.emit('sftp:getSize', { path: filePath });
    }
  };

  const handleOpenTerminalHere = (targetPath = null) => {
    if (!connection) return;
    const path = targetPath || currentPath || '.';
    const safePath = String(path).replace(/"/g, '\\"');
    const initialCommand = `cd "${safePath}"\r`;
    window.dispatchEvent(new CustomEvent('open-terminal', {
      detail: {
        connection,
        initialCommand,
        title: `${connectionName || 'Terminal'}: ${path}`,
      },
    }));
    setContextMenu({ ...contextMenu, visible: false });
  };

  const handleRename = () => {
    if (!contextMenu.file || !socket) return;
    const originalName = contextMenu.file.filename;
    
    showPrompt(
      t('files.modals.rename.prompt') || `Enter new name for '${originalName}':`,
      (newName) => {
        if (!newName || newName.trim() === '' || newName === originalName) return;
        const trimmed = newName.trim();
        const srcPath = currentPath === '.' ? originalName : `${currentPath}/${originalName}`;
        const destPath = currentPath === '.' ? trimmed : `${currentPath}/${trimmed}`;

        // Optimistic UI — rename instantly so there's no perceived lag
        setFiles(prev => prev.map(f =>
          f.filename === originalName
            ? { ...f, filename: trimmed, longname: f.longname ? f.longname.replace(originalName, trimmed) : trimmed }
            : f
        ));

        toastRef.current = addNotification({ 
          title: t('files.status.renaming') || 'Renaming', 
          message: `${originalName} → ${trimmed}`, 
          type: 'loading', 
          duration: 4000,
        });
        
        // Use socketRef.current — socket state can be stale when the prompt modal
        // causes re-renders between handleRename call and the user clicking OK.
        // A stale socket's sftp:action_success listener was already torn down,
        // so the success event would never clear the toast.
        (socketRef.current || socket)?.emit('sftp:move', { src: srcPath, dest: destPath, overwrite: false });
        setContextMenu({ ...contextMenu, visible: false });
      },
      originalName,
      t('files.modals.rename.title') || 'Rename'
    );
    setContextMenu({ ...contextMenu, visible: false });
  };

  const startInlineRename = (filename) => {
    setRenamingFile({ filename, value: filename });
    // Focus input on next tick
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus();
        // Select filename without extension
        const dotIdx = filename.lastIndexOf('.');
        if (dotIdx > 0) {
          renameInputRef.current.setSelectionRange(0, dotIdx);
        } else {
          renameInputRef.current.select();
        }
      }
    }, 0);
  };

  const commitRename = () => {
    if (!renamingFile || !socketRef.current) return;
    const originalName = renamingFile.filename;
    const newName = renamingFile.value.trim();
    setRenamingFile(null);

    if (!newName || newName === originalName) return;

    const srcPath = currentPath === '.' ? originalName : `${currentPath}/${originalName}`;
    const destPath = currentPath === '.' ? newName : `${currentPath}/${newName}`;

    // Optimistic UI — rename instantly in the list so there's zero perceived lag.
    // The server confirms with sftp:action_success which triggers a real list refresh.
    setFiles(prev => prev.map(f =>
      f.filename === originalName
        ? { ...f, filename: newName, longname: f.longname ? f.longname.replace(originalName, newName) : newName }
        : f
    ));

    // Auto-dismiss after 4s as a safety net in case the success event closure
    // is stale and removeNotification doesn't fire
    toastRef.current = addNotification({
      title: t('files.status.renaming') || 'Renaming',
      message: `${originalName} → ${newName}`,
      type: 'loading',
      duration: 4000,
    });

    socketRef.current.emit('sftp:move', { src: srcPath, dest: destPath, overwrite: false });
  };

  const cancelRename = () => {
    setRenamingFile(null);
  };

  const handleCreatePrompt = (type) => {
    showPrompt(
      type === 'folder' ? t('files.modals.create.titleFolder') : t('files.modals.create.titleFile'),
      (name) => {
        if (!name) return;
        const path = currentPath === '.' ? name : `${currentPath}/${name}`;
        toastRef.current = addNotification({ title: t('files.modals.create.create'), message: `${t('files.actions.loading', { action: t('files.modals.create.create') })} ${type}...`, type: 'loading', duration: 0 });
        if (type === 'folder') {
          socket.emit('sftp:mkdir', path);
        } else {
          socket.emit('sftp:writeFile', { path, content: '' });
        }
      },
      '',
      type === 'folder' ? t('files.modals.create.titleFolder') : t('files.modals.create.titleFile')
    );
  };

  const handleEdit = () => {
    if (!contextMenu.file || !socket) return;
    if (contextMenu.file.longname.startsWith('d')) {
       addNotification({ title: t('common.error'), message: t('files.errors.cannotEditDir'), type: 'error' });
       return;
    }
    const path = contextMenu.file.absPath || (currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`);
    
    toastRef.current = addNotification({ title: t('common.loading'), message: t('files.actions.loading', { action: t('files.context.edit') }), type: 'loading', duration: 0 });
    setEditor({ visible: false, file: contextMenu.file, content: '', saving: false });
    socket.emit('sftp:readFile', path);
  };

  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
  const PDF_EXTS = ['.pdf'];
  const TEXT_EXTS = ['.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh', '.fish', '.env', '.log', '.csv', '.sql', '.dockerfile', '.makefile'];

  const getFilePreviewType = (filename) => {
    const lower = filename.toLowerCase();
    if (IMAGE_EXTS.some(ext => lower.endsWith(ext))) return 'image';
    if (PDF_EXTS.some(ext => lower.endsWith(ext))) return 'pdf';
    return 'text';
  };

  const PREVIEW_MAX_SIZE = 5 * 1024 * 1024; // 5MB limit for preview

  const handlePreview = () => {
    if (!contextMenu.file || !socket) return;
    if (contextMenu.file.longname.startsWith('d')) return;

    const file = contextMenu.file;
    const previewType = getFilePreviewType(file.filename);
    const path = file.absPath || (currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`);

    // Check file size for non-text files
    if (previewType !== 'text' && file.attrs?.size > PREVIEW_MAX_SIZE) {
      addNotification({
        title: 'File Too Large',
        message: `${file.filename} (${formatSize(file.attrs.size)}) is too large to preview. Maximum is 5MB.`,
        type: 'warning',
      });
      return;
    }

    setPreview({ visible: true, file, content: '', loading: true, type: previewType });

    if (previewType === 'text') {
      // Read text content
      const handler = (data) => {
        if (data.path === path) {
          socket.off('sftp:file_content', handler);
          setPreview(prev => ({ ...prev, content: data.content, loading: false }));
        }
      };
      socket.on('sftp:file_content', handler);
      socket.emit('sftp:readFile', path);
    } else {
      // For images/PDFs, read as base64
      const handler = (data) => {
        if (data.path === path) {
          socket.off('sftp:file_base64', handler);
          const mime = previewType === 'image' ? getMimeType(file.filename) : 'application/pdf';
          const dataUrl = `data:${mime};base64,${data.content}`;
          setPreview(prev => ({ ...prev, content: dataUrl, loading: false }));
        }
      };
      socket.on('sftp:file_base64', handler);
      socket.emit('sftp:readFileBase64', path);
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const getMimeType = (filename) => {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeMap = {
      'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
      'bmp': 'image/bmp', 'ico': 'image/x-icon', 'pdf': 'application/pdf'
    };
    return mimeMap[ext] || 'application/octet-stream';
  };

  const handleSave = () => {
     if (!editor.file || !socket) return;
     const path = editor.file.absPath || (currentPath === '.' ? editor.file.filename : `${currentPath}/${editor.file.filename}`);
     setEditor(prev => ({ ...prev, saving: true }));
     socket.emit('sftp:writeFile', { path, content: editor.content });
  };

  const handleCopy = (action = 'copy') => {
    const fileTarget = contextMenu.file;
    let targets = [];
    if (fileTarget && !selectedFiles.has(fileTarget.filename)) {
      targets = [fileTarget];
    } else {
      targets = Array.from(selectedFiles).map(name => files.find(f => f.filename === name)).filter(Boolean);
    }
    
    if (targets.length === 0 && fileTarget) {
      targets = [fileTarget];
    }
    
    if (targets.length === 0) return;
    
    const items = targets.map(t => {
      const path = currentPath === '.' ? t.filename : `${currentPath}/${t.filename}`;
      return { file: t, sourcePath: path };
    });
    
    setClipboard({ 
      file: items[0].file, 
      sourcePath: items[0].sourcePath,
      files: items,
      action, 
      connectionId: connectionId
    });
    
    addNotification({ 
      title: t('common.success'), 
      message: `${action === 'copy' ? t('files.actions.copied') : t('files.actions.cut')} ${items.length > 1 ? `${items.length} items` : items[0].file.filename}`, 
      type: 'success' 
    });
    setContextMenu({ ...contextMenu, visible: false });
  };

  function handlePaste() {
    if (!clipboard || !socket) return;
    if (!ensureSocketReady('paste again')) return;
    
    const items = clipboard.files || [{
      file: clipboard.file,
      sourcePath: clipboard.sourcePath
    }];
    
    const transferObj = {
      filename: items.length > 1 ? `${items.length} items` : items[0].file.filename,
      progress: 0,
      action: clipboard.action === 'cut' ? 'move' : 'copy',
      waiting: false
    };
    setTransfer(transferObj);
    transferRef.current = transferObj;

    // Check if Cross-Server Transfer
    if (clipboard.connectionId !== connectionId) {
      toastRef.current = addNotification({ 
        title: t('files.status.upload'), 
        message: `${t('files.actions.loading', { action: t('files.status.upload') })} ${items.length > 1 ? `${items.length} items` : items[0].file.filename}...`, 
        type: 'loading', 
        duration: 0 
      });

      items.forEach(item => {
        const destPath = currentPath === '.' ? item.file.filename : `${currentPath}/${item.file.filename}`;
        socket.emit('sftp:cross_server_transfer', {
          srcConnId: clipboard.connectionId,
          srcPath: item.sourcePath,
          destPath: destPath,
          action: clipboard.action
        });
      });

      if (clipboard.action === 'cut') setClipboard(null);
      return;
    }

    items.forEach(item => {
      const destPath = currentPath === '.' ? item.file.filename : `${currentPath}/${item.file.filename}`;
      let finalDest = destPath;
      if (item.sourcePath === destPath && clipboard.connectionId === connectionId && clipboard.action === 'copy') {
         finalDest = destPath + '_copy';
      }

      if (clipboard.action === 'copy') {
        socket.emit('sftp:copy', { src: item.sourcePath, dest: finalDest });
      } else {
        socket.emit('sftp:move', { src: item.sourcePath, dest: finalDest });
      }
    });

    if (clipboard.action === 'cut') {
      setClipboard(null); // Clear after move
    }
    toastRef.current = addNotification({ 
      title: t('files.context.paste'), 
      message: `${t('files.context.paste')} ${items.length > 1 ? `${items.length} items` : items[0].file.filename} ${t('common.to')} ${currentPath}...`, 
      type: 'loading', 
      duration: 0 
    });
  }

  // --- Keyboard Shortcuts for Copy, Cut, Paste ---
  // In search mode show global results; otherwise filter current-dir listing
  const filteredFiles = isSearchMode
    ? searchResults.map(r => ({
        filename: r.filename,
        absPath: r.absPath,
        dir: r.dir,
        longname: r.filename.includes('.') ? '-' : 'd', // best-effort dir detection by absence of extension
        attrs: {},
        _searchResult: true,
      }))
    : files
        .filter(f => (f.filename || '').toLowerCase().includes((searchQuery || '').toLowerCase()))
        .sort((a, b) => {
           const aIsDir = a.longname.startsWith('d');
           const bIsDir = b.longname.startsWith('d');
           if (aIsDir && !bIsDir) return -1;
           if (!aIsDir && bIsDir) return 1;
           return a.filename.localeCompare(b.filename);
        });
  const filteredFilesRef = useRef(filteredFiles);
  useEffect(() => { filteredFilesRef.current = filteredFiles; }, [filteredFiles]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if focus is in an input, textarea, contenteditable, ace editor, or terminal
      if (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable ||
        document.activeElement.closest('.ace_editor') ||
        document.activeElement.closest('.editor-container') ||
        document.activeElement.closest('.xterm')
      ) {
        return;
      }

      // Split-pane fix: shortcuts apply to the focused pane only
      if (isSplit && !isActivePane) return;

      const isModKey = e.ctrlKey || e.metaKey;

      // Ctrl+A — Select all files
      if (isModKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const allNames = filteredFilesRef.current.map(f => f.filename);
        setSelectedFiles(new Set(allNames));
        return;
      }

      // Delete — Delete selected files
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFiles.size > 0) {
          e.preventDefault();
          handleDelete();
        }
        return;
      }

      // Enter — Open selected folder
      if (e.key === 'Enter') {
        if (selectedFiles.size === 1) {
          const name = Array.from(selectedFiles)[0];
          const file = files.find(f => f.filename === name);
          if (file && file.longname.startsWith('d')) {
            e.preventDefault();
            handleFolderClick(name);
          }
        }
        return;
      }

      if (isModKey && (e.key === 'c' || e.key === 'C')) {
        const targets = Array.from(selectedFiles).map(name => files.find(f => f.filename === name)).filter(Boolean);
        if (targets.length > 0) {
          e.preventDefault();
          const items = targets.map(t => {
            const path = currentPath === '.' ? t.filename : `${currentPath}/${t.filename}`;
            return { file: t, sourcePath: path };
          });
          setClipboard({
            file: items[0].file,
            sourcePath: items[0].sourcePath,
            files: items,
            action: 'copy',
            connectionId: connectionId
          });
          addNotification({
            title: t('common.success'),
            message: `${t('files.actions.copied')} ${items.length > 1 ? `${items.length} items` : items[0].file.filename}`,
            type: 'success'
          });
        }
      } else if (isModKey && (e.key === 'x' || e.key === 'X')) {
        const targets = Array.from(selectedFiles).map(name => files.find(f => f.filename === name)).filter(Boolean);
        if (targets.length > 0) {
          e.preventDefault();
          const items = targets.map(t => {
            const path = currentPath === '.' ? t.filename : `${currentPath}/${t.filename}`;
            return { file: t, sourcePath: path };
          });
          setClipboard({
            file: items[0].file,
            sourcePath: items[0].sourcePath,
            files: items,
            action: 'cut',
            connectionId: connectionId
          });
          addNotification({
            title: t('common.success'),
            message: `${t('files.actions.cut')} ${items.length > 1 ? `${items.length} items` : items[0].file.filename}`,
            type: 'success'
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedFiles, lastSelectedFile, files, currentPath, clipboard, connectionId, handlePaste, handleDelete, t]);

  const getActionLabel = () => {
    if (!transfer) return '';
    const key = `files.status.${transfer.action}`;
    const val = t(key);
    if (val && val !== key) return val;
    const actionKey = `files.actions.${transfer.action === 'copy' ? 'copying' : transfer.action === 'move' ? 'moving' : transfer.action}`;
    const actionVal = t(actionKey);
    if (actionVal && actionVal !== actionKey) return actionVal;
    return transfer.action;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] relative overflow-hidden group/filemanager">
      {/* Floating Latency Badge */}
      {latency !== null && status === 'ready' && (
        <div 
          className="absolute top-20 right-6 z-[60] flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)]/80 backdrop-blur-xl border border-[var(--border-color)]/50 shadow-lg opacity-60 group-hover/filemanager:opacity-100 transition-all pointer-events-none"
          style={{ 
            color: latency < 150 ? (osState?.theme === 'light' ? '#059669' : '#4ade80') : latency < 300 ? (osState?.theme === 'light' ? '#d97706' : '#fbbf24') : (osState?.theme === 'light' ? '#dc2626' : '#f43f5e') 
          }}
          title={t('files.status.latency')}
        >
          <Wifi size={10} strokeWidth={3} />
          <span className="font-mono tracking-tighter">{latency}ms</span>
        </div>
      )}

      <AnimatePresence>
        {transfer && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className="w-[390px] bg-[#0d1117]/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85),0_0_35px_rgba(99,102,241,0.12)] overflow-hidden"
            >
              {/* Dynamic Top Ambient Accent Line */}
              <div className={`h-[3px] w-full ${
                transfer.action === 'extract'
                  ? 'bg-gradient-to-r from-purple-500 via-fuchsia-400 to-indigo-500'
                  : transfer.finalizing
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500'
                  : transfer.channel === 'webrtc'
                  ? 'bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-400'
                  : 'bg-gradient-to-r from-blue-500 via-indigo-400 to-sky-400'
              }`} />

              <div className="p-5">
                {/* Header Row */}
                <div className="flex items-start gap-3.5 mb-3.5">
                  {/* Dynamic Glow Icon Box */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border relative shadow-inner ${
                    transfer.action === 'extract'
                      ? 'bg-purple-500/15 border-purple-500/30 text-purple-400 shadow-purple-500/20'
                      : transfer.finalizing
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-emerald-500/20'
                      : transfer.channel === 'webrtc'
                      ? 'bg-violet-500/15 border-violet-500/30 text-violet-400 shadow-violet-500/20'
                      : 'bg-blue-500/15 border-blue-500/30 text-blue-400 shadow-blue-500/20'
                  }`}>
                    {transfer.action === 'extract' ? (
                      <RefreshCw size={20} className="animate-spin text-purple-400" />
                    ) : transfer.finalizing ? (
                      <CircleCheckBig size={20} className="text-emerald-400 animate-pulse" />
                    ) : transfer.action === 'upload' ? (
                      <Upload size={20} className={transfer.channel === 'webrtc' ? 'text-violet-400' : 'text-blue-400'} />
                    ) : transfer.action === 'download' ? (
                      <Download size={20} className={transfer.channel === 'webrtc' ? 'text-violet-400' : 'text-blue-400'} />
                    ) : (
                      <RefreshCw size={20} className="animate-spin text-indigo-400" />
                    )}
                  </div>

                  {/* Title + Meta Header */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Live beacon */}
                      {!transfer.waiting && !transfer.reconnecting && (
                        <span className="relative flex h-2 w-2 flex-shrink-0">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            transfer.action === 'extract' ? 'bg-purple-400' : transfer.finalizing ? 'bg-emerald-400' : transfer.channel === 'webrtc' ? 'bg-violet-400' : 'bg-blue-400'
                          }`} />
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${
                            transfer.action === 'extract' ? 'bg-purple-500' : transfer.finalizing ? 'bg-emerald-500' : transfer.channel === 'webrtc' ? 'bg-violet-500' : 'bg-blue-500'
                          }`} />
                        </span>
                      )}
                      {/* Transport Tag */}
                      <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${
                        transfer.action === 'extract'
                          ? 'bg-purple-500/10 text-purple-300 border-purple-500/25'
                          : transfer.channel === 'webrtc'
                          ? 'bg-violet-500/10 text-violet-300 border-violet-500/25'
                          : 'bg-blue-500/10 text-blue-300 border-blue-500/25'
                      }`}>
                        {transfer.action === 'extract' ? '📦 Archive Extract' : transfer.channel === 'webrtc' ? '⚡ WebRTC Direct P2P' : '☁ SFTP Relay'}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white truncate tracking-tight" title={transfer.filename}>
                      {transfer.filename}
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 font-mono">
                      {transfer.status ? (
                        <span className={transfer.action === 'extract' ? 'text-purple-300 font-medium' : 'text-blue-300 font-medium'}>
                          {transfer.status}
                        </span>
                      ) : transfer.reconnecting ? (
                        <span className="text-amber-400 font-medium">⟳ Reconnecting session...</span>
                      ) : transfer.waiting ? (
                        <span className="text-amber-400 font-medium">⏸ Paused (rate limit) · Retry in {transferCountdown || '...'}s</span>
                      ) : transfer.finalizing ? (
                        <span className="text-emerald-300 font-medium">✓ 100% Sent · Flushing write stream to disk...</span>
                      ) : (
                        <span className="text-white/60">
                          {transfer.action === 'upload' ? 'Active folder stream' : transfer.action === 'download' ? 'Downloading payload' : 'Processing transfer'}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Cancel Button */}
                  <button 
                    onClick={() => {
                      const filenameToAbort = transfer.realFilename || transfer.filename;
                      userCancelledUploadRef.current = true;
                      setTimeout(() => { userCancelledUploadRef.current = false; }, 3000);
                      if (activeAckCleanupRef.current) { activeAckCleanupRef.current(); activeAckCleanupRef.current = null; }
                      if (activeHandshakeCleanupRef.current) { activeHandshakeCleanupRef.current(); activeHandshakeCleanupRef.current = null; }
                      const notifIdToDismiss = transfer?.toastId || toastRef.current;
                      if (notifIdToDismiss) { removeNotification(notifIdToDismiss); toastRef.current = null; }
                      setTransfer(null);
                      transferRef.current = null;
                      if (socket) socket.emit(`sftp:upload_abort:${filenameToAbort}`);
                      if (transfer.path) setUploadQueue(prev => prev.filter(item => item.path !== transfer.path));
                    }}
                    title="Cancel transfer"
                    className="p-1.5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg transition-all text-white/40 border border-transparent hover:border-rose-500/30 flex-shrink-0"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Telemetry Dashboard 3-Stat Grid */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-black/40 border border-white/5 mb-3 font-mono">
                  {/* Stat 1: Progress */}
                  <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="text-[9px] uppercase tracking-wider text-white/40 block mb-0.5">Progress</span>
                    <span className={`text-[12px] font-bold block truncate ${
                      transfer.finalizing
                        ? 'text-emerald-400'
                        : transfer.action === 'extract'
                        ? 'text-purple-300'
                        : 'text-white'
                    }`}>
                      {transfer.finalizing
                        ? '100%'
                        : transfer.action === 'extract'
                        ? `${transfer.progress > 0 ? `${transfer.progress}%` : 'Unpacking'}`
                        : transfer.progress < 0
                        ? (transfer.bytes ? `${((transfer.bytes || 0) / 1024 / 1024).toFixed(1)} MB` : '...')
                        : `${transfer.progress}%`}
                    </span>
                  </div>

                  {/* Stat 2: Throughput / Rate */}
                  <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="text-[9px] uppercase tracking-wider text-white/40 block mb-0.5">Speed</span>
                    <span className="text-[12px] font-bold text-cyan-300 block truncate">
                      {transfer.speed && !transfer.finalizing && transfer.action !== 'extract'
                        ? transfer.speed
                        : transfer.action === 'extract' && transfer.extractedCount
                        ? `${transfer.extractedCount.toLocaleString()} f`
                        : transfer.finalizing
                        ? 'Flushing'
                        : 'Streaming'}
                    </span>
                  </div>

                  {/* Stat 3: Speed Profile */}
                  <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="text-[9px] uppercase tracking-wider text-white/40 block mb-0.5">Mode</span>
                    <span className={`text-[12px] font-bold block truncate ${
                      !isRelayMode || uploadCpuMode === 'eco'
                        ? 'text-cyan-400'
                        : uploadCpuMode === 'turbo'
                        ? 'text-amber-400'
                        : 'text-indigo-300'
                    }`}>
                      {!isRelayMode ? 'Eco Locked' : uploadCpuMode === 'eco' ? 'Eco' : uploadCpuMode === 'turbo' ? 'Turbo' : 'Balanced'}
                    </span>
                  </div>
                </div>

                {/* High-Precision Progress Bar */}
                <div className="relative h-2.5 bg-black/60 rounded-full overflow-hidden mb-3.5 border border-white/10 p-[1px]">
                  {transfer.finalizing ? (
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-300 to-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]"
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  ) : transfer.action === 'extract' ? (
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-purple-600 via-fuchsia-400 to-indigo-400 relative shadow-[0_0_12px_rgba(168,85,247,0.6)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(transfer.progress || 0, 5)}%` }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <motion.div
                        className="absolute top-0 bottom-0 w-20 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                        animate={{ x: ['-80px', '390px'] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                      />
                    </motion.div>
                  ) : transfer.waiting || transfer.reconnecting ? (
                    <motion.div
                      className="h-full bg-amber-500/70 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                      style={{ width: `${transfer.progress}%` }}
                      animate={{ opacity: [1, 0.35, 1] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  ) : (
                    <motion.div
                      className={`h-full rounded-full relative ${
                        transfer.channel === 'webrtc'
                          ? 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 shadow-[0_0_12px_rgba(139,92,246,0.6)]'
                          : 'bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 shadow-[0_0_12px_rgba(59,130,246,0.6)]'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(transfer.progress, 2)}%` }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      {transfer.progress > 0 && transfer.progress < 100 && (
                        <motion.div
                          className="absolute top-0 bottom-0 w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                          animate={{ x: ['-80px', '390px'] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', repeatDelay: 0.4 }}
                        />
                      )}
                    </motion.div>
                  )}
                </div>

                {/* Hardware Speed Engine & Dynamic Throttle Controls */}
                {transfer.action === 'upload' && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2.5">
                    {/* Control Header */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/90">
                        {isRelayMode ? <Unlock size={13} className="text-emerald-400" /> : <Lock size={13} className="text-cyan-400" />}
                        <span className="font-mono text-[10px] tracking-wide text-white/70">
                          {isRelayMode ? 'RELAY SPEED CONTROL' : 'SERVER ECO LOCK'}
                        </span>
                      </div>

                      {/* Auto-Cool Illuminated Switch Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const nextState = !autoCoolEnabled;
                          setAutoCoolEnabled(nextState);
                          if (typeof window !== 'undefined') {
                            localStorage.setItem('ssh_monitor_auto_cool', nextState ? 'true' : 'false');
                          }
                        }}
                        title="Automatically switch to Eco mode if system is under heavy load"
                        disabled={!isRelayMode}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono transition-all border ${
                          !isRelayMode
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 cursor-default'
                            : autoCoolEnabled
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                            : 'bg-white/5 border-white/10 text-white/40 hover:text-white/70'
                        }`}
                      >
                        {!isRelayMode ? <Lock size={10} className="text-cyan-300" /> : <Zap size={10} className={autoCoolEnabled ? 'text-emerald-400 animate-pulse' : 'text-white/30'} />}
                        <span className="font-bold">{!isRelayMode ? 'ECO ONLY' : autoCoolEnabled ? 'AUTO-COOL ON' : 'AUTO-COOL OFF'}</span>
                      </button>
                    </div>

                    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                      isRelayMode
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                        : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200'
                    }`}>
                      {isRelayMode ? <Unlock size={14} className="mt-0.5 shrink-0 text-emerald-300" /> : <Lock size={14} className="mt-0.5 shrink-0 text-cyan-300" />}
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold">
                          {isRelayMode ? 'Relay mode unlocks speed profiles' : 'Server mode always uses ECO'}
                        </div>
                        <div className="text-[9px] opacity-75 leading-relaxed">
                          {isRelayMode
                            ? 'Balanced and Turbo send through your local relay/WebRTC path.'
                            : 'Balanced and Turbo require Local Relay mode, so server bandwidth stays protected.'}
                        </div>
                      </div>
                    </div>

                    {/* Segmented Speed Profile Selector */}
                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/50 rounded-xl border border-white/10">
                      {[
                        { 
                          id: 'eco', 
                          title: 'Eco', 
                          badge: '❄️ Slow', 
                          desc: 'Low CPU & network bandwidth',
                          activeClass: 'bg-gradient-to-br from-cyan-600/30 to-blue-600/30 text-cyan-300 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.25)]' 
                        },
                        { 
                          id: 'balanced', 
                          title: 'Balanced', 
                          badge: '⚖️ Fast', 
                          desc: 'Fast and responsive',
                          activeClass: 'bg-gradient-to-br from-indigo-600/30 to-violet-600/30 text-indigo-200 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.25)]' 
                        },
                        { 
                          id: 'turbo', 
                          title: 'Turbo', 
                          badge: '🚀 Max', 
                          desc: 'Maximum throughput',
                          activeClass: 'bg-gradient-to-br from-amber-600/30 to-rose-600/30 text-amber-200 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.25)]' 
                        },
                      ].map((m) => {
                        const isLocked = !isRelayMode && m.id !== 'eco';
                        const isActive = (!isRelayMode && m.id === 'eco') || uploadCpuMode === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => changeUploadCpuMode(m.id)}
                            disabled={isLocked}
                            title={isLocked ? `${m.title} requires Local Relay mode` : m.desc}
                            className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg text-center transition-all border ${
                              isActive
                                ? `${m.activeClass} font-semibold scale-[1.02]`
                                : isLocked
                                ? 'bg-white/[0.02] border-white/5 text-white/25 cursor-not-allowed'
                                : 'bg-transparent border-transparent text-white/40 hover:text-white/80 hover:bg-white/5'
                            }`}
                          >
                            <span className="text-[11px] leading-tight font-medium flex items-center gap-1">
                              {isLocked && <Lock size={9} />}
                              {m.badge}
                            </span>
                            <span className="text-[9px] opacity-75 font-mono mt-0.5">{m.title}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* High System Load Surge Alert Bar */}
                    {cpuThermalWarning && uploadCpuMode !== 'eco' && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-amber-500/20 via-rose-500/15 to-amber-500/20 border border-amber-500/40 flex items-center justify-between gap-2 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Flame size={15} className="text-amber-400 animate-pulse flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[11px] font-semibold text-amber-200 block truncate">High System Load</span>
                            <span className="text-[9px] text-amber-300/75 block truncate">Heavy CPU load. Reduce speed?</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              changeUploadCpuMode('eco');
                              setCpuThermalWarning(false);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/25 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 text-[10px] font-semibold transition-colors shadow-sm"
                          >
                            ❄️ Switch to Eco
                          </button>
                          <button
                            type="button"
                            onClick={() => setCpuThermalWarning(false)}
                            className="px-1.5 py-1 rounded hover:bg-white/10 text-white/40 text-[10px]"
                          >
                            Ignore
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Editor Modal - Portaled to escape window transforms */}
      {editor.visible && createPortal(
        <MacOSModalWindow
          isOpen
          title={editor.file?.filename || (t('files.modals.editor.title') || 'Editor')}
          icon={FileText}
          onClose={() => setEditor({ ...editor, visible: false })}
          zIndexClassName="z-[9999]"
          draggable={true}
          resizable={true}
          defaultWidth={800}
          defaultHeight={600}
          minWidth={500}
          minHeight={400}
          contentClassName="p-4"
          closeOnOverlayClick
           overlayClassName="bg-black/40 backdrop-blur-sm"
        >
          <div className="flex flex-col h-full relative">
            {/* @ Mention file picker dropdown */}
            {mentionState.active && mentionState.results.length > 0 && (
              <div className="absolute top-10 left-0 z-[60] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl w-72 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-[var(--border-color)] text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <AtSign size={10} /> Mention File
                  <span className="ml-auto text-[9px] opacity-50">↑↓ navigate · Enter select · Esc close</span>
                </div>
                <div className="overflow-y-auto max-h-52 custom-scrollbar">
                  {mentionState.results.map((file, i) => {
                    const isDir = file.longname?.startsWith('d');
                    return (
                      <button
                        key={file.filename}
                        onMouseDown={e => { e.preventDefault(); insertMention(file); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                          i === mentionState.selectedIndex
                            ? 'bg-[var(--accent-indigo)]/20 text-[var(--accent-indigo)]'
                            : 'hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                        }`}
                      >
                        {isDir
                          ? <Folder size={14} className="text-blue-400 shrink-0" />
                          : <FileIcon size={14} className="text-[var(--text-muted)] shrink-0" />}
                        <span className="truncate font-mono">{file.filename}</span>
                        {isDir && <span className="ml-auto text-[9px] text-blue-400/60 uppercase shrink-0">dir</span>}
                      </button>
                    );
                  })}
                  {mentionState.results.length === 0 && (
                    <div className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">No matches</div>
                  )}
                </div>
              </div>
            )}
            {/* ── Find / Replace bar ── */}
            {findBar.visible && (() => {
              const matches = computeMatches(editor.content, findBar.query, findBar.matchCase, findBar.useRegex);
              const safeIdx = matches.length ? findBar.currentIndex % matches.length : -1;
              return (
                <div className="mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
                  {/* Search row */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <Search size={13} className="text-[var(--text-muted)] shrink-0" />
                    <input
                      ref={findInputRef}
                      value={findBar.query}
                      onChange={e => setFindBar(prev => ({ ...prev, query: e.target.value, currentIndex: 0 }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); findNavigate(e.shiftKey ? -1 : 1); }
                        if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
                      }}
                      placeholder="Find…"
                      className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
                      spellCheck={false}
                    />
                    {/* match counter */}
                    <span className="text-[10px] font-mono text-[var(--text-muted)] select-none whitespace-nowrap shrink-0">
                      {findBar.query
                        ? matches.length
                          ? `${safeIdx + 1} / ${matches.length}`
                          : 'no match'
                        : ''}
                    </span>
                    {/* Case sensitive toggle */}
                    <button
                      title="Match case (Alt+C)"
                      onClick={() => setFindBar(prev => ({ ...prev, matchCase: !prev.matchCase, currentIndex: 0 }))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors select-none ${
                        findBar.matchCase
                          ? 'bg-[var(--accent-indigo)] text-white'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >Aa</button>
                    {/* Regex toggle */}
                    <button
                      title="Use regular expression (Alt+R)"
                      onClick={() => setFindBar(prev => ({ ...prev, useRegex: !prev.useRegex, currentIndex: 0 }))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors select-none ${
                        findBar.useRegex
                          ? 'bg-[var(--accent-indigo)] text-white'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >.*</button>
                    {/* Prev / Next */}
                    <button
                      title="Previous match (Shift+Enter)"
                      onClick={() => findNavigate(-1)}
                      disabled={!matches.length}
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 transition-colors"
                    ><ChevronUp size={14} /></button>
                    <button
                      title="Next match (Enter)"
                      onClick={() => findNavigate(1)}
                      disabled={!matches.length}
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 transition-colors"
                    ><ChevronDown size={14} /></button>
                    {/* Replace toggle */}
                    <button
                      title="Toggle replace"
                      onClick={() => setFindBar(prev => ({ ...prev, replaceVisible: !prev.replaceVisible }))}
                      className={`p-0.5 rounded transition-colors ${
                        findBar.replaceVisible
                          ? 'text-[var(--accent-indigo)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    ><Replace size={13} /></button>
                    {/* Close */}
                    <button
                      onClick={closeFindBar}
                      className="ml-1 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                    ><X size={13} /></button>
                  </div>

                  {/* Replace row */}
                  {findBar.replaceVisible && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[var(--border-color)]">
                      <Replace size={13} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        value={findBar.replace}
                        onChange={e => setFindBar(prev => ({ ...prev, replace: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); } }}
                        placeholder="Replace with…"
                        className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
                        spellCheck={false}
                      />
                      <button
                        onClick={findReplaceOne}
                        disabled={!matches.length}
                        className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-card-hover)] hover:bg-[var(--accent-indigo)]/20 text-[var(--text-primary)] hover:text-[var(--accent-indigo)] disabled:opacity-30 transition-colors whitespace-nowrap"
                      >Replace</button>
                      <button
                        onClick={findReplaceAll}
                        disabled={!matches.length}
                        className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-card-hover)] hover:bg-[var(--accent-indigo)]/20 text-[var(--text-primary)] hover:text-[var(--accent-indigo)] disabled:opacity-30 transition-colors whitespace-nowrap"
                      >Replace All</button>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center justify-between gap-2 mb-3">
              {/* Cursor position indicator */}
              <span className="text-[11px] font-mono text-[var(--text-muted)] select-none">
                {(() => {
                  const content = editor.content || '';
                  const pos = editor.cursorPos ?? content.length;
                  const before = content.slice(0, pos);
                  const line = before.split('\n').length;
                  const col = before.split('\n').pop().length + 1;
                  const totalLines = content.split('\n').length;
                  return `Ln ${line}, Col ${col}  |  ${totalLines} lines`;
                })()}
              </span>
              <button
                onClick={handleSave}
                disabled={editor.saving}
                className="px-3 py-1.5 bg-[var(--accent-indigo)] hover:opacity-90 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50 text-white font-bold"
              >
                <Save size={14} />
                {editor.saving ? t('files.modals.editor.saving') : t('files.modals.editor.save')}
              </button>
            </div>

            <div className="flex-1 relative overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
              {/* Line number gutter + textarea side by side */}
              <div
                className="flex h-full w-full overflow-auto"
                ref={el => {
                  // Keep gutter scroll in sync with textarea scroll
                  if (!el) return;
                  el._scrollSyncInstalled = el._scrollSyncInstalled || (() => {
                    const ta = el.querySelector('textarea');
                    const gutter = el.querySelector('[data-gutter]');
                    if (!ta || !gutter) return;
                    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
                    el._scrollSyncInstalled = true;
                  })();
                }}
              >
                {/* Gutter */}
                <div
                  data-gutter="1"
                  className="select-none overflow-hidden shrink-0 text-right font-mono text-xs leading-5 pt-4 pb-4 pr-3 pl-3"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)',
                    borderRight: '1px solid var(--border-color)',
                    minWidth: `${String((editor.content || '').split('\n').length).length * 9 + 28}px`,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {(editor.content || '').split('\n').map((_, i) => (
                    <div key={i} style={{ lineHeight: '1.25rem' }}>{i + 1}</div>
                  ))}
                </div>

                {/* Editor textarea */}
                <textarea
                  ref={editorTextareaRef}
                  value={editor.content}
                  onChange={e => {
                    const val = e.target.value;
                    const pos = e.target.selectionStart;
                    setEditor(prev => ({ ...prev, content: val, cursorPos: pos }));
                    // @mention detection
                    const textBeforeCursor = val.slice(0, pos);
                    const lastAt = textBeforeCursor.lastIndexOf('@');
                    if (lastAt !== -1) {
                      const segment = textBeforeCursor.slice(lastAt + 1);
                      if (!segment.includes(' ') && !segment.includes('\n')) {
                        const results = files
                          .filter(f => f.filename.toLowerCase().includes(segment.toLowerCase()))
                          .slice(0, 10);
                        setMentionState({ active: true, query: segment, results, selectedIndex: 0, triggerPos: lastAt });
                        return;
                      }
                    }
                    setMentionState(prev => ({ ...prev, active: false }));
                  }}
                  onKeyDown={e => {
                    // Global shortcuts (mention inactive)
                    const isMod = e.metaKey || e.ctrlKey;
                    if (isMod && e.key === 'f') {
                      e.preventDefault();
                      openFindBar(false);
                      return;
                    }
                    if (isMod && e.key === 'h') {
                      e.preventDefault();
                      openFindBar(true);
                      return;
                    }
                    if (e.key === 'F3' || (isMod && e.key === 'g')) {
                      e.preventDefault();
                      if (findBar.visible) findNavigate(e.shiftKey ? -1 : 1);
                      return;
                    }
                    if (e.key === 'Escape' && findBar.visible) {
                      e.preventDefault();
                      closeFindBar();
                      return;
                    }
                    // Mention navigation
                    if (!mentionState.active) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setMentionState(prev => ({ ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, prev.results.length - 1) }));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setMentionState(prev => ({ ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) }));
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      if (mentionState.results.length > 0) {
                        e.preventDefault();
                        insertMention(mentionState.results[mentionState.selectedIndex]);
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setMentionState(prev => ({ ...prev, active: false }));
                    }
                  }}
                  onSelect={e => setEditor(prev => ({ ...prev, cursorPos: e.target.selectionStart }))}
                  onClick={e => {
                    setEditor(prev => ({ ...prev, cursorPos: e.target.selectionStart }));
                    setMentionState(prev => ({ ...prev, active: false }));
                  }}
                  onKeyUp={e => setEditor(prev => ({ ...prev, cursorPos: e.target.selectionStart }))}
                  className="flex-1 bg-transparent text-[var(--text-primary)] font-mono text-sm pt-4 pb-4 pl-4 pr-4 focus:outline-none resize-none leading-5"
                  style={{ tabSize: 2 }}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </MacOSModalWindow>,
        document.body
      )}

      {/* File Preview Modal */}
      {preview.visible && createPortal(
        <MacOSModalWindow
          isOpen
          title={`Preview: ${preview.file?.filename || ''}`}
          icon={Eye}
          onClose={() => {
            setPreview({ visible: false, file: null, content: '', loading: false, type: 'text' });
          }}
          zIndexClassName="z-[9999]"
          draggable={true}
          resizable={true}
          defaultWidth={800}
          defaultHeight={600}
          contentClassName="p-0 overflow-hidden"
        >
          {preview.loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw size={24} className="animate-spin text-[var(--accent-indigo)]" />
            </div>
          ) : preview.type === 'image' ? (
            <div className="flex items-center justify-center h-full bg-[var(--bg-primary)] p-4">
              <img src={preview.content} alt={preview.file?.filename} className="max-w-full max-h-full object-contain" />
            </div>
          ) : preview.type === 'pdf' ? (
            <iframe src={preview.content} className="w-full h-full border-0" title={preview.file?.filename} />
          ) : (
            <pre className="p-4 text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words overflow-auto h-full bg-[var(--bg-primary)]">
              {preview.content}
            </pre>
          )}
        </MacOSModalWindow>,
        document.body
      )}



      {contextMenu.visible && createPortal(
        <div 
          className="fixed z-[20000] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-[var(--border-color)] text-xs text-[var(--text-muted)] font-medium truncate max-w-[200px]">
            {contextMenu.file ? contextMenu.file.filename : t('files.context.currentFolder')}
          </div>
          
          {contextMenu.file ? (
            <>
              {contextMenu.file._searchResult && (
                <>
                  <button
                    onClick={() => {
                      const dir = contextMenu.file.dir || '.';
                      setCurrentPath(dir);
                      currentPathRef.current = dir;
                      setSearchQuery('');
                      refreshFiles(dir);
                      setContextMenu({ ...contextMenu, visible: false });
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-blue-400 flex items-center gap-2 transition-colors"
                  >
                    <Folder size={14} /> Navigate to folder
                  </button>
                  <div className="h-px bg-[var(--border-color)] my-1" />
                </>
              )}
              <button 
                onClick={() => { handleEdit(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-indigo)] text-[var(--text-primary)] hover:text-[var(--accent-indigo)] flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={contextMenu.file?.longname.startsWith('d')}
              >
                <Pen size={14} /> {t('files.context.edit')}
              </button>
              <button 
                onClick={handlePreview}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-emerald)] text-[var(--text-primary)] hover:text-[var(--accent-emerald)] flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={contextMenu.file?.longname.startsWith('d')}
              >
                <Eye size={14} /> Preview
              </button>
              <button 
                onClick={() => {
                  const f = contextMenu.file;
                  if (f?.longname.startsWith('d')) handleDownloadFolder(f);
                  else handleDownload(f);
                  setContextMenu({ ...contextMenu, visible: false });
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-emerald)] text-[var(--text-primary)] hover:text-[var(--accent-emerald)] flex items-center gap-2 transition-colors"
              >
                <Download size={14} />
                {contextMenu.file?.longname.startsWith('d') ? 'Download as .tar.gz' : t('files.context.download')}
              </button>
              {contextMenu.file?.longname.startsWith('d') && (
                <button
                  onClick={() => {
                    const path = contextMenu.file.absPath || (currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`);
                    handleOpenTerminalHere(path);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-indigo)] text-[var(--text-primary)] hover:text-[var(--accent-indigo)] flex items-center gap-2 transition-colors"
                >
                  <Terminal size={14} className="text-indigo-400" /> {t('files.context.openTerminal') || 'Open Terminal Here'}
                </button>
              )}
               <button 
                onClick={() => { startInlineRename(contextMenu.file.filename); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-indigo)] text-[var(--text-primary)] hover:text-[var(--accent-indigo)] flex items-center gap-2 transition-colors"
              >
                <Replace size={14} className="text-indigo-400" /> {t('files.context.rename') || 'Rename'}
              </button>
              <button 
                onClick={() => { handleDelete(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-rose)] text-[var(--accent-rose)] flex items-center gap-2 transition-colors"
              >
                <Trash2 size={14} /> {t('files.context.delete')}
              </button>
              <button 
                onClick={handleInfo}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-indigo)] text-[var(--accent-indigo)] flex items-center gap-2 transition-colors"
              >
                <AlertCircle size={14} /> {t('files.context.getInfo')}
              </button>
              {(contextMenu.file?.filename.endsWith('.zip') || contextMenu.file?.filename.endsWith('.tar.gz') || contextMenu.file?.filename.endsWith('.tgz')) && (
                <button 
                  onClick={() => { 
                    const isZip = contextMenu.file.filename.endsWith('.zip');
                    const zipPath = currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`;
                    console.log(`[FileManager] Starting extraction: ${zipPath}, type: ${isZip ? 'zip' : 'tar'}`);
                    setTransfer({ filename: contextMenu.file.filename, progress: 5, action: 'extract', status: 'Initializing extraction...' });
                    socket.emit('sftp:extract', { path: zipPath, type: isZip ? 'zip' : 'tar' });
                    setContextMenu({ ...contextMenu, visible: false });
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-orange-600/20 text-orange-400 flex items-center gap-2 transition-colors"
                >
                  <FolderPlus size={14} /> Extract
                </button>
              )}
              <div className="h-px bg-[var(--border-color)] my-1" />
              <button 
                onClick={() => handleCopy('copy')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-2 transition-colors"
              >
                <Copy size={14} /> {t('files.context.copy')}
              </button>
              <button 
                onClick={() => handleCopy('cut')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-2 transition-colors"
              >
                <Scissors size={14} /> {t('files.context.cut')}
              </button>
            </>
          ) : (
            <>
              {clipboard && (
                <button 
                  onClick={() => { handlePaste(); setContextMenu({ ...contextMenu, visible: false }); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-blue-400 flex items-center gap-2 transition-colors mb-1"
                >
                  <Clipboard size={14} /> {t('files.context.paste')}
                </button>
              )}
              <button 
                onClick={() => { handleCreatePrompt('file'); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-2 transition-colors"
              >
                <FileText size={14} /> {t('files.context.newFile')}
              </button>
              <button 
                onClick={() => { handleCreatePrompt('folder'); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-2 transition-colors"
              >
                <FolderPlus size={14} /> {t('files.context.newFolder')}
              </button>
              <div className="h-px bg-[var(--border-color)] my-1" />
              <button 
                onClick={() => { handleOpenTerminalHere(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--glow-indigo)] text-[var(--text-primary)] hover:text-[var(--accent-indigo)] flex items-center gap-2 transition-colors"
              >
                <Terminal size={14} className="text-indigo-400" /> {t('files.context.openTerminal') || 'Open Terminal Here'}
              </button>
              <button 
                onClick={() => { refreshFiles(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={14} /> {t('files.context.refresh')}
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Info Modal */}
      {infoModal.visible && (
        <MacOSModalWindow
          isOpen
          title={`Info: ${infoModal.file?.filename}`}
          onClose={() => setInfoModal({ visible: false, file: null })}
          defaultWidth={280}
          minWidth={280}
          defaultHeight={420}
          draggable
          resizable={false}
          contentClassName="p-4"
        >
          <div className="flex flex-col items-center gap-4 pt-2">
             <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-2xl flex items-center justify-center shadow-md border border-[var(--border-color)]">
               {infoModal.file?.longname.startsWith('d') ? (
                 <Folder className="text-blue-400" size={32} />
               ) : (
                 <FileIcon className="text-[var(--text-muted)]" size={32} />
               )}
             </div>
             <div className="w-full space-y-3">
               <div className="flex justify-between items-start border-b border-[var(--border-color)] pb-2 pt-1 gap-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase shrink-0">{t('files.info.name')}</span>
                 <p className="text-xs font-medium text-right break-all leading-tight">{infoModal.file?.filename}</p>
               </div>
               <div className="flex justify-between items-center border-b border-[var(--border-color)] pb-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{t('files.info.type')}</span>
                  <p className="text-xs font-medium">{infoModal.file?.longname.startsWith('d') ? t('files.info.directory') : t('files.info.file')}</p>
               </div>
               <div className="flex justify-between items-center border-b border-[var(--border-color)] pb-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{t('files.info.size')}</span>
                 <p className="text-xs font-medium font-mono flex items-center gap-1.5">
                    {infoModal.sizeLoading ? (
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                        </svg>
                        Calculating...
                      </span>
                    ) : (
                      formatSize(infoModal.realSize ?? infoModal.file?.attrs?.size)
                    )}
                 </p>
               </div>
               <div className="flex justify-between items-center border-b border-[var(--border-color)] pb-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{t('files.info.modified')}</span>
                 <p className="text-[11px] font-medium">{new Date(infoModal.file?.attrs?.mtime * 1000).toLocaleDateString()}</p>
               </div>
               <div className="space-y-1">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{t('files.info.path')}</span>
                 <p className="text-[10px] font-mono break-all opacity-60 leading-tight">{currentPath === '.' ? infoModal.file?.filename : `${currentPath}/${infoModal.file?.filename}`}</p>
               </div>
             </div>
          </div>
        </MacOSModalWindow>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3 lg:p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/50">
        <div className="flex items-center gap-1.5 lg:gap-2 flex-1 min-w-[120px]">
          <button onClick={goBack} disabled={currentPath === '.'} className="p-1.5 lg:p-2 hover:bg-[var(--border-color)] rounded-lg disabled:opacity-30 flex-shrink-0">
            <ChevronLeft size={18} />
          </button>
          <div 
            className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-[var(--bg-primary)]/50 rounded-lg border border-[var(--border-color)] w-full min-w-0 max-w-md group/path cursor-text"
            onClick={() => setIsEditingPath(true)}
          >
            {connectionName && (
              <span 
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 shrink-0 font-mono tracking-wide"
                title={`Connected SSH: ${connectionName}`}
              >
                {connectionName}
              </span>
            )}
            <Folder size={14} className="text-blue-400 flex-shrink-0" />
            {isEditingPath ? (
              <input
                autoFocus
                type="text"
                value={pathInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setPathInput(val);
                  
                  // Auto-navigate preview as user types (only for absolute paths)
                  if (val.trim().startsWith('/')) {
                    if (pathPreviewDebounceRef.current) clearTimeout(pathPreviewDebounceRef.current);
                    pathPreviewDebounceRef.current = setTimeout(() => {
                      const targetPath = val.trim();
                      if (targetPath && targetPath !== currentPathRef.current) {
                        setCurrentPath(targetPath);
                        currentPathRef.current = targetPath;
                        refreshFiles(targetPath);
                      }
                    }, 600);
                  }
                }}
                onBlur={() => { 
                  // Close editing mode after a short delay to allow for Enter key processing
                  setTimeout(() => {
                    setIsEditingPath(false); 
                    setPathInput(currentPath);
                  }, 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (pathPreviewDebounceRef.current) clearTimeout(pathPreviewDebounceRef.current);
                    const targetPath = pathInput.trim() || '.';
                    setCurrentPath(targetPath);
                    currentPathRef.current = targetPath;
                    refreshFiles(targetPath);
                    setIsEditingPath(false);
                  }
                  if (e.key === 'Escape') {
                    if (pathPreviewDebounceRef.current) clearTimeout(pathPreviewDebounceRef.current);
                    setIsEditingPath(false);
                    setPathInput(currentPath);
                  }
                }}
                className="bg-transparent text-[11px] lg:text-xs font-mono focus:outline-none w-full text-[var(--text-primary)]"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-[11px] lg:text-xs font-mono truncate">{currentPath}</span>
            )}
          </div>
          <button onClick={() => refreshFiles()} className="p-1.5 lg:p-2 hover:bg-[var(--border-color)] rounded-lg flex-shrink-0">
            <RefreshCw size={18} className={loading ? 'animate-spin text-blue-400' : ''} />
          </button>
        </div>

        {/* Split / Close Pane Controls */}
        {(onSplit || isSplit) && (
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onSplit?.('horizontal')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[var(--text-muted)] hover:text-[var(--accent-indigo)] rounded-lg hover:bg-[var(--accent-indigo)]/10 transition-all text-[11px] font-medium"
              title={t('files.layout.splitLeftRight')}
            >
              <Columns size={14} />
              <span className="hidden lg:inline">{t('files.layout.split')}</span>
            </button>
            {isSplit && (
              <button 
                onClick={() => onClosePane?.()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-rose-400/70 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-all text-[11px] font-medium"
                title={t('files.layout.closePane')}
              >
                <X size={14} strokeWidth={2.5} />
                <span className="hidden lg:inline">{t('files.layout.close')}</span>
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 lg:gap-4 shrink-0">
          <div className="relative flex-shrink min-w-[100px] w-full max-w-[200px] sm:max-w-none sm:w-40 lg:w-52">
            {searchLoading
              ? <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" size={14} />
              : <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />}
            <input 
              type="text" 
              placeholder={t('files.status.searchWhole')}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchQuery('');
              }}
              className={`bg-[var(--bg-primary)]/50 border rounded-lg py-1.5 pl-9 pr-6 lg:pr-8 text-[11px] lg:text-xs focus:outline-none w-full text-[var(--text-primary)] transition-colors ${
                isSearchMode ? 'border-blue-500/60 focus:border-blue-500' : 'border-[var(--border-color)] focus:border-blue-500/50'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >✕</button>
            )}
          </div>
          {clipboard && (
            <button 
              onClick={handlePaste}
              className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-xs font-bold flex items-center gap-2 transition-all border border-blue-500/30 shadow-lg shadow-blue-500/10"
              title={`${t('files.context.paste')} ${clipboard.files && clipboard.files.length > 1 ? `${clipboard.files.length} items` : clipboard.file.filename}`}
            >
              <Clipboard size={14} /> {t('files.context.paste')}
            </button>
          )}
          <div className="flex bg-[var(--bg-primary)]/50 p-1 rounded-lg border border-[var(--border-color)]">
            <button 
              onClick={() => uploadInputRef.current?.click()}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--border-color)] transition-all"
              title={t('files.status.uploadLocal')}
            >
              <Upload size={16} />
            </button>
            <input 
              type="file" 
              ref={uploadInputRef} 
              onChange={handleFileUpload} 
              className="hidden"
              multiple
            />
            {selectedFiles.size > 0 && (
              <button
                onClick={handleDownloadSelected}
                className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-all"
                title={selectedFiles.size > 1 ? t('files.layout.downloadSelected', { count: selectedFiles.size }) : t('files.layout.downloadSingle')}
              >
                <Download size={16} />
              </button>
            )}
            <div className="w-px h-4 bg-[var(--border-color)] my-auto mx-1" />
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <Grid size={16} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <ListIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Explorer Area */}
      <div 
        className={`flex-1 overflow-y-auto p-6 pb-20 custom-scrollbar relative transition-colors ${isDragging ? 'bg-blue-600/10' : ''}`} 
        onClick={() => { setContextMenu({ ...contextMenu, visible: false }); setSelectedFiles(new Set()); setLastSelectedFile(null); }}
        onContextMenu={(e) => handleContextMenu(e, null)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {reconnectAlert && (
          <div className={`mx-3 mb-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${reconnectAlert.exhausted ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-100'}`}>
            <div className="flex items-start gap-2 min-w-0">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">{reconnectAlert.exhausted ? 'Reconnect paused' : 'Reconnecting session'}</div>
                <div className="text-[11px] opacity-90 break-words">{reconnectAlert.message}</div>
              </div>
            </div>
            <button
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                setReconnectAlert(null);
                setStatus('connecting');
                setLoading(true);
                setReconnectNonce((n) => n + 1);
              }}
              className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 font-medium hover:bg-white/15 transition-colors"
            >
              Retry now
            </button>
          </div>
        )}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-blue-600/20 border-2 border-dashed border-blue-500 rounded-3xl p-12 flex flex-col items-center gap-4 backdrop-blur-md">
              <Upload size={48} className="text-blue-400 animate-bounce" />
              <span className="text-xl font-bold text-[var(--text-primary)]">{t('files.status.dropToUpload') || 'Drop here'}</span>
              <span className="text-sm text-[var(--text-muted)]">{connectionName} — {currentPath}</span>
            </div>
          </div>
        )}
        {status === 'error' ? (
          error === 'vault_not_ready' ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-2 animate-pulse">
                <ShieldAlert size={32} className="text-amber-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Waiting for Vault</h3>
              <p className="text-sm text-[var(--text-muted)] max-w-md">
                Unlock your private vault to reconnect. The file manager will automatically retry once the vault is open.
              </p>
            </div>
          ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-2">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">{t('files.status.errorTitle')}</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md">{error}</p>
            <button 
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                setReconnectAlert(null);
                setStatus('connecting');
                setLoading(true);
                setReconnectNonce((n) => n + 1);
              }}
              className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              Retry Connection
            </button>
          </div>
          )
        ) : loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-center">
              <span className="text-sm text-[var(--text-secondary)] block mb-1">
                {status === 'connecting' ? t('files.status.establishingSocket') : t('files.status.initializingSshSftp')}
              </span>
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest">{connectionName}</span>
            </div>
          </div>
        ) : (
          filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
              <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-full flex items-center justify-center mb-2">
                <Folder size={30} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  {isSearchMode ? (t('files.status.noMatches') || 'No matches found') : (t('files.status.emptyFolder') || 'No files found')}
                </h3>
                <p className="text-sm text-[var(--text-muted)] max-w-md mt-1">
                  {isSearchMode
                    ? (t('files.status.tryDifferentSearch') || 'Try a different search term.')
                    : (t('files.status.emptyFolderHint') || 'This folder may be empty, or the listing may still be catching up.')}
                </p>
              </div>
              <button
                onClick={() => refreshFiles(currentPathRef.current)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw size={14} /> {t('files.toolbar.refresh') || t('common.refresh') || 'Refresh'}
              </button>
            </div>
          ) : (
          <div className={viewMode === 'grid' 
            ? "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4"
            : "flex flex-col gap-1"
          }>
            {filteredFiles.map(file => {
              const isDir = file.longname.startsWith('d');
              return (
                <div 
                  key={file._searchResult ? file.absPath : file.filename}
                  draggable={!file._searchResult}
                  onClick={(e) => {
                    if (file._searchResult) {
                      // Navigate to the file's parent directory
                      const dir = file.dir || '.';
                      setCurrentPath(dir);
                      currentPathRef.current = dir;
                      setSearchQuery('');
                      refreshFiles(dir);
                      return;
                    }
                    e.stopPropagation();
                    if (e.metaKey || e.ctrlKey) {
                      const newSelected = new Set(selectedFiles);
                      if (newSelected.has(file.filename)) newSelected.delete(file.filename);
                      else newSelected.add(file.filename);
                      setSelectedFiles(newSelected);
                      setLastSelectedFile(file.filename);
                    } else if (e.shiftKey && lastSelectedFile) {
                      const fileNames = filteredFiles.map(f => f.filename);
                      const startIdx = fileNames.indexOf(lastSelectedFile);
                      const endIdx = fileNames.indexOf(file.filename);
                      const minIdx = Math.min(startIdx, endIdx);
                      const maxIdx = Math.max(startIdx, endIdx);
                      const newSelected = new Set(selectedFiles);
                      for (let i = minIdx; i <= maxIdx; i++) {
                        newSelected.add(fileNames[i]);
                      }
                      setSelectedFiles(newSelected);
                    } else {
                      setSelectedFiles(new Set([file.filename]));
                      setLastSelectedFile(file.filename);
                    }
                  }}
                  onDragStart={(e) => {
                    const isSelected = selectedFiles.has(file.filename);
                    const filesToDrag = isSelected ? Array.from(selectedFiles) : [file.filename];

                    const dragItems = filesToDrag.map(name => {
                      const f = files.find(x => x.filename === name);
                      const filePath = currentPath === '.' ? name : `${currentPath}/${name}`;
                      return {
                        filename: name,
                        filePath,
                        isDir: f ? f.longname.startsWith('d') : false,
                        size: f?.attrs?.size || 0
                      };
                    });

                    const dragData = JSON.stringify({
                      files: dragItems,
                      connectionId,
                      connectionName,
                      // For backward compatibility:
                      filename: file.filename,
                      filePath: currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`,
                      isDir: isDir,
                      size: file.attrs?.size || 0,
                    });
                    e.dataTransfer.setData('application/ssh-file', dragData);
                    e.dataTransfer.effectAllowed = 'copyMove';
                    // Visual drag image
                    const ghost = document.createElement('div');
                    ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;z-index:99999;background:var(--bg-secondary);color:var(--text-primary);padding:6px 14px;border-radius:8px;font-size:12px;border:1px solid var(--border-color);pointer-events:none;display:flex;align-items:center;gap:6px;';
                    ghost.innerHTML = filesToDrag.length > 1
                      ? `🗂️ ${filesToDrag.length} items`
                      : `${isDir ? '📁' : '📄'} ${file.filename}`;
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 0, 0);
                    setTimeout(() => document.body.removeChild(ghost), 0);
                  }}
                  onDoubleClick={() => {
                    if (file._searchResult) return; // single-click already navigates
                    if (isDir) {
                      setSelectedFiles(new Set());
                      setLastSelectedFile(null);
                      handleFolderClick(file.filename);
                    } else {
                      // Open preview for files
                      const previewType = getFilePreviewType(file.filename);
                      const path = file.absPath || (currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`);

                      // Check file size for non-text files
                      if (previewType !== 'text' && file.attrs?.size > PREVIEW_MAX_SIZE) {
                        addNotification({
                          title: 'File Too Large',
                          message: `${file.filename} (${formatSize(file.attrs.size)}) is too large to preview. Maximum is 5MB.`,
                          type: 'warning',
                        });
                        return;
                      }

                      setPreview({ visible: true, file, content: '', loading: true, type: previewType });

                      if (previewType === 'text') {
                        const handler = (data) => {
                          if (data.path === path) {
                            socket.off('sftp:file_content', handler);
                            setPreview(prev => ({ ...prev, content: data.content, loading: false }));
                          }
                        };
                        socket.on('sftp:file_content', handler);
                        socket.emit('sftp:readFile', path);
                      } else {
                        const handler = (data) => {
                          if (data.path === path) {
                            socket.off('sftp:file_base64', handler);
                            const mime = getMimeType(file.filename);
                            const dataUrl = `data:${mime};base64,${data.content}`;
                            setPreview(prev => ({ ...prev, content: dataUrl, loading: false }));
                          }
                        };
                        socket.on('sftp:file_base64', handler);
                        socket.emit('sftp:readFileBase64', path);
                      }
                    }
                  }}
                  onContextMenu={(e) => {
                    handleContextMenu(e, file);
                  }}
                  className={viewMode === 'grid'
                    ? `group flex flex-col items-center p-3 rounded-xl border transition-all ${file._searchResult ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${deletingFiles.has(file.filename) ? 'opacity-50 pointer-events-none' : ''} ${selectedFiles.has(file.filename) ? 'bg-blue-600/20 border-blue-500 shadow-md shadow-blue-500/10' : 'hover:bg-[var(--border-color)] border-transparent hover:border-[var(--border-hover)]'}`
                    : `flex items-center gap-3 p-2 rounded-lg group transition-all ${file._searchResult ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${deletingFiles.has(file.filename) ? 'opacity-50 pointer-events-none' : ''} ${selectedFiles.has(file.filename) ? 'bg-blue-600/20 border border-blue-500 shadow-inner' : 'hover:bg-[var(--border-color)] border border-transparent'}`
                  }
                >
                  <div className={viewMode === 'grid'
                    ? "w-16 h-16 flex items-center justify-center mb-2 relative"
                    : "w-8 h-8 flex items-center justify-center relative"
                  }>
                    {isDir ? (
                      <Folder className="text-blue-400 drop-shadow-lg" size={viewMode === 'grid' ? 48 : 20} />
                    ) : (
                      <FileIcon className="text-[var(--text-muted)]" size={viewMode === 'grid' ? 48 : 20} />
                    )}
                    {deletingFiles.has(file.filename) && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <RefreshCw size={viewMode === 'grid' ? 20 : 14} className="animate-spin text-amber-400 drop-shadow-lg" />
                      </div>
                    )}
                  </div>
                  <div className={viewMode === 'grid' ? "text-center" : "flex-1 flex items-center justify-between"}>
                    {renamingFile?.filename === file.filename ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renamingFile.value}
                        onChange={(e) => setRenamingFile(prev => prev ? { ...prev, value: e.target.value } : null)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={() => commitRename()}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-medium w-full max-w-[180px] px-1.5 py-0.5 rounded border border-[var(--accent-indigo)] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                        style={{ minWidth: '60px' }}
                      />
                    ) : (
                      <span
                        className="text-xs font-medium truncate max-w-[120px] block text-[var(--text-primary)] cursor-text"
                        title={file.filename}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!file._searchResult) startInlineRename(file.filename);
                        }}
                      >
                        {file.filename}
                      </span>
                    )}
                    {file._searchResult && (
                      <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[120px] block mt-0.5" title={file.dir}>
                        {file.dir}
                      </span>
                    )}
                    {viewMode === 'list' && !file._searchResult && (
                      <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
                        <span>{formatSize(file.attrs.size)}</span>
                        <span className="w-32 truncate text-right">
                          {new Date(file.attrs.mtime * 1000).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    {viewMode === 'list' && file._searchResult && (
                      <span className="text-[10px] text-[var(--text-muted)] truncate max-w-xs" title={file.absPath}>{file.absPath}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )
        )}
      </div>

      {/* Footer / Status */}
      <div className="px-4 py-2 bg-[var(--bg-tertiary)]/80 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] text-[var(--text-muted)]">
        <div className="flex gap-4">
          <span>{filteredFiles.length} {isSearchMode ? t('files.status.matches') : t('files.status.items')}</span>
          <span>{filteredFiles.filter(f => !f.longname.startsWith('d')).length} {t('files.status.filesPlural')}</span>
          {isSearchMode && <span className="text-blue-400">{t('files.status.wholeServerNavigate')}</span>}
          {status !== 'ready' && <span className="animate-pulse text-amber-500">{t('files.status.systemState', { status })}</span>}
        </div>
        <div className="flex gap-4">
          {uploadQueue.length > 0 && (
             <div className="flex items-center gap-2 text-blue-400">
                <span className="animate-pulse">●</span>
                 <span>{uploadQueue.length} {t('files.status.filesInQueue')}</span>
                <button 
                  onClick={() => {
                     const next = uploadQueue[0];
                     handleFileUpload(null, next.file, next.offset);
                  }}
                  className="px-2 py-0.5 bg-blue-500/20 rounded hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                >
                   <RefreshCw size={8} /> {t('files.status.resync')}
                </button>
             </div>
          )}
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
              isRelayMode ? 'bg-emerald-500/15 text-emerald-400' : 'bg-cyan-500/15 text-cyan-400'
            }`}
            title={isRelayMode ? 'Local Relay mode: Balanced and Turbo upload profiles are available' : 'Server mode: uploads are locked to ECO'}
          >
            {isRelayMode ? <Unlock size={9} /> : <Lock size={9} />}
            {isRelayMode ? 'Relay · Speed Unlocked' : 'Server · ECO Locked'}
          </span>
          {rtcActive && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-500/15 text-violet-400" title="File transfers use direct WebRTC P2P — bypassing the server entirely">
              ⚡ WebRTC P2P
            </span>
          )}
          <span className={status === 'ready' ? 'text-emerald-500' : status === 'error' ? 'text-rose-500' : 'text-amber-500'}>
            {status === 'ready' ? t('files.status.sftpActive') : status === 'error' ? t('files.status.connFailed') : t('files.status.initializing')}
          </span>
          
          {/* AI Helper Button */}
          <div className="relative">
            <button
               onClick={() => { setAiOpen(!aiOpen); setAiHasOpenedOnce(true); }}
               className={`flex items-center gap-1.5 px-2 py-1 rounded transition-all ${aiOpen ? 'bg-indigo-600 text-white' : 'hover:bg-white/5 text-[var(--accent-indigo)]'}`}
            >
               <Sparkles size={12} className={isAiLoading ? 'animate-spin' : ''} />
               <span className="font-bold">AI</span>
            </button>

            {/* AI Panel */}
            <AnimatePresence>
               {aiOpen && (
                 <motion.div
                   initial={{ opacity: 0, scale: 0.95, y: 10 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   exit={{ opacity: 0, scale: 0.95, y: 10 }}
                   className="absolute bottom-full right-0 mb-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-4 z-50 flex flex-col gap-3"
                   style={{ maxHeight: '70vh' }}
                 >
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                       <div className="flex items-center gap-2">
                          <BrainCircuit size={16} className="text-indigo-400" />
                          <span className="text-xs font-bold uppercase tracking-wider">{t('ai.title')}</span>
                       </div>
                       <div className="flex gap-1">
                          <button onClick={() => setAiSettingsOpen(!aiSettingsOpen)} className={`p-1 rounded hover:bg-white/5 ${aiSettingsOpen ? 'text-indigo-400' : 'text-white/40'}`} title={t('ai.settings')}><Settings2 size={14} /></button>
                          <button onClick={() => setAiOpen(false)} className="p-1 rounded hover:bg-white/5 text-white/40"><X size={14} /></button>
                       </div>
                    </div>

                    {aiSettingsOpen ? (
                       <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-200 overflow-y-auto custom-scrollbar pr-1" style={{ maxHeight: '300px' }}>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{t('ai.settings')}</span>
                          
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-[11px]">
                               <span>{t('ai.aiModel')}</span>
                               <ThemeSelect
                                 className="w-44"
                                 size="xs"
                                 value={sshAiPrefs.aiModel || 'auto'}
                                 onChange={(v) => setSshAiPrefs({ aiModel: v })}
                                 options={[
                                   { value: 'auto', label: 'Auto' },
                                   { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
                                   { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
                                   { value: 'manual', label: 'Manual Configuration' },
                                 ]}
                               />
                            </div>

                            {sshAiPrefs.aiModel === 'manual' && (
                               <div className="space-y-2 pt-2 border-t border-white/10">
                                  <div className="flex flex-col gap-2">
                                     <span className="text-[9px] font-bold text-purple-400/60 uppercase tracking-tighter">Quick Presets</span>
                                     <div className="flex gap-2">
                                        <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', aiCustomModel: 'anthropic/claude-3.5-sonnet' })} className="text-[9px] px-2 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30 transition-all active:scale-95 whitespace-nowrap">
                                          🌐 OpenRouter
                                        </button>
                                        <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://api.openai.com/v1/chat/completions', aiCustomModel: 'gpt-4o' })} className="text-[9px] px-2 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-all active:scale-95 whitespace-nowrap">
                                          🟢 OpenAI
                                        </button>
                                     </div>
                                  </div>
                                  <input type="text" placeholder="Endpoint URL" value={sshAiPrefs.aiEndpoint || ''} onChange={(e) => setSshAiPrefs({ ...sshAiPrefs, aiEndpoint: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] outline-none focus:border-indigo-500/50" />
                                  <input type="password" placeholder="API Key" value={sshAiPrefs.aiApiKey || ''} onChange={(e) => setSshAiPrefs({ ...sshAiPrefs, aiApiKey: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] outline-none focus:border-indigo-500/50" />
                                  <input type="text" placeholder="Model Name" value={sshAiPrefs.aiCustomModel || ''} onChange={(e) => setSshAiPrefs({ ...sshAiPrefs, aiCustomModel: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] outline-none focus:border-indigo-500/50" />
                               </div>
                            )}
                          </div>
                          
                          <button onClick={() => setAiSettingsOpen(false)} className="w-full py-1.5 bg-indigo-600 rounded text-white text-[10px] font-bold uppercase mt-2">Save Settings</button>
                       </div>
                    ) : (
                       <div className="flex flex-col gap-2 flex-1 overflow-hidden">
                          {/* Chat / Result Area */}
                          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 min-h-[100px] max-h-[300px] pr-1">
                             {aiHistory.length === 0 && !aiAnswer && !isAiLoading && (
                                <div className="flex flex-col items-center justify-center gap-2 py-8 opacity-30">
                                   <MessagesSquare size={32} />
                                   <span className="text-[10px] uppercase font-bold tracking-widest text-center">Ask me anything about these files</span>
                                </div>
                             )}

                             {isAiLoading && (
                                <div className="flex items-start gap-2 animate-pulse">
                                   <div className="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center shrink-0"><Sparkles size={12} className="text-indigo-400" /></div>
                                   <div className="bg-white/5 rounded-lg p-2 flex-1">
                                      <div className="h-2 w-20 bg-white/20 rounded mb-1.5"></div>
                                      <div className="h-2 w-32 bg-white/10 rounded"></div>
                                   </div>
                                </div>
                             )}

                             {aiAnswer && (
                                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-[11px] leading-relaxed relative group">
                                   <div className="absolute -top-2 -left-2 w-6 h-6 rounded bg-indigo-600 flex items-center justify-center shadow-lg"><Sparkles size={12} className="text-white" /></div>
                                   <div className="text-[var(--text-primary)] whitespace-pre-wrap">{aiAnswer}</div>
                                   <button onClick={() => navigator.clipboard.writeText(aiAnswer)} className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"><Copy size={10} /></button>
                                </div>
                             )}

                             {aiError && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-[11px] text-red-400 flex items-start gap-2">
                                   <ShieldAlert size={14} className="shrink-0" />
                                   <span>{aiError}</span>
                                </div>
                             )}

                             {aiHistory.slice(1).map((h, i) => (
                                <div key={i} className="border-t border-white/5 pt-2 flex flex-col gap-1">
                                   <div className="text-[9px] font-bold opacity-30 uppercase">{h.prompt}</div>
                                   <div className="text-[10px] opacity-70">{h.answer.slice(0, 100)}{h.answer.length > 100 ? '...' : ''}</div>
                                </div>
                             ))}
                          </div>

                          {/* Input Area */}
                          <div className="relative mt-auto">
                             <textarea
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAskAI(); } }}
                                placeholder="Describe files, ask help..."
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-indigo-500/50 resize-none min-h-[60px]"
                             />
                             <button
                                onClick={handleAskAI}
                                disabled={isAiLoading || !aiPrompt.trim()}
                                className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-90"
                             >
                                <CornerDownLeft size={14} />
                             </button>
                          </div>
                       </div>
                    )}
                 </motion.div>
               )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
