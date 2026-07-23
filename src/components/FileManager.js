'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Folder, File as FileIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw, 
  Download, Upload, Trash2, FolderPlus, Search, Grid, List as ListIcon,
  AlertCircle, Edit, FileText, X, Save, AlertTriangle, Eye,
  Copy, Scissors, Clipboard, Wifi, AtSign, Replace, Columns, Rows,
  Sparkles, Brain, Clock, Settings2, Languages, CornerDownLeft, 
  MessagesSquare, BrainCircuit, ShieldAlert, Terminal
} from 'lucide-react';
import io from 'socket.io-client';
import * as fflate from 'fflate';
import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import MacOSModalWindow from '@/components/MacOSModalWindow';

import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';


/**
 * Minimal TAR packager for browser usage
 * @param {Object} files - { "path/to/file": Uint8Array }
 * @returns {Uint8Array} - The generated TAR archive
 */
function createTar(files) {
  const chunks = [];
  for (const name in files) {
    const data = files[name];
    const header = new Uint8Array(512);
    
    // Name (up to 100 bytes)
    for (let i = 0; i < Math.min(name.length, 99); i++) {
      header[i] = name.charCodeAt(i);
    }
    
    // Mode (0000644)
    const mode = "0000644\0";
    for (let i = 0; i < 8; i++) header[100 + i] = mode.charCodeAt(i);
    
    // Size (12 bytes, octal)
    const size = data.length.toString(8).padStart(11, '0') + "\0";
    for (let i = 0; i < 12; i++) header[124 + i] = size.charCodeAt(i);
    
    // Mtime (12 bytes, octal)
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + "\0";
    for (let i = 0; i < 12; i++) header[136 + i] = mtime.charCodeAt(i);
    
    // Checksum placeholder (blanks)
    for (let i = 0; i < 8; i++) header[148 + i] = 32; 
    
    // Magic (ustar)
    const magic = "ustar\0";
    for (let i = 0; i < 6; i++) header[257 + i] = magic.charCodeAt(i);
    const version = "00";
    for (let i = 0; i < 2; i++) header[263 + i] = version.charCodeAt(i);
    
    // Calculate checksum
    let chk = 0;
    for (let i = 0; i < 512; i++) chk += header[i];
    const chkStr = chk.toString(8).padStart(6, '0') + "\0 ";
    for (let i = 0; i < 8; i++) header[148 + i] = chkStr.charCodeAt(i);
    
    chunks.push(header);
    chunks.push(data);
    
    // Padding to 512-byte boundary
    const paddingLength = (512 - (data.length % 512)) % 512;
    if (paddingLength > 0) chunks.push(new Uint8Array(paddingLength));
  }
  
  // Final 1024-byte null padding (End of Archive)
  chunks.push(new Uint8Array(1024));
  
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

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
  initialPath = '.',
  onClosePane,
  onSplit
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
  const lastDownloadRef = useRef(null); // { file, offset }
  const transferRef = useRef(null); // Keep a ref of transfer for loop cancellation
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
  const handleFileUploadRef = useRef(null);
  
  useEffect(() => { 
    currentPathRef.current = currentPath; 
    if (!isEditingPath) {
      setPathInput(currentPath);
    }
  }, [currentPath, isEditingPath]);

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

  useEffect(() => {
    if (vaultStatus === 'loading') return;

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

      const currentDbUri = dbUriRef.current;
      newSocket = io({
        path: '/api/socket',
        transports: ['websocket'],
        reconnection: false,
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
        if (statusRef.current === 'ready' && filesRef.current.length > 0) return;
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
        if (!prev) return null; // Don't resurrect late progress messages
        return { ...prev, ...data };
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

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      clearTimeout(timeout);
      clearTimeout(reuseInitTimeout);

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
      _fmSocketPool.set(connectionId, {
        socket: newSocket,
        status: statusRef.current,
        currentPath: currentPathRef.current,
        files: filesRef.current,
        cleanupTimer: setTimeout(() => {
          const entry = _fmSocketPool.get(connectionId);
          if (entry?.socket === newSocket) {
            console.log('🔌 Pool TTL expired — disconnecting socket for', connectionId);
            newSocket.emit('ssh:disconnect');
            newSocket.disconnect();
            _fmSocketPool.delete(connectionId);
          }
        }, POOL_TTL),
      });
    };
  }, [connectionId, reconnectNonce, isTransferChannelError, requestReconnect, vaultStatus, resumePendingUploads, addNotification, t]); // Removed 'connection' from dependencies to prevent loop

  // --- Auto-Refresh Logic ---
  
  // 1. Background Polling (Every 10 seconds if ready)
  useEffect(() => {
    if (status !== 'ready' || !socket) return;
    
    const interval = setInterval(() => {
      console.log('🔄 Auto-refreshing file list (polling)...', currentPathRef.current);
      refreshFiles(currentPathRef.current);
    }, 15000); // Increased to 15s to be less aggressive
    
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

  // Safety timeout: auto-dismiss copy/move transfer if stuck (no progress/success)
  useEffect(() => {
    if (transferSafetyTimerRef.current) {
      clearTimeout(transferSafetyTimerRef.current);
      transferSafetyTimerRef.current = null;
    }
    if (transfer && (transfer.action === 'copy' || transfer.action === 'move') && !transfer.waiting && !transfer.reconnecting) {
      transferSafetyTimerRef.current = setTimeout(() => {
        console.warn('⚠️ Transfer safety timeout — auto-dismissing stuck copy/move modal');
        setTransfer(null);
        transferRef.current = null;
        if (socket) {
          const targetPath = currentPathRef.current || '.';
          socket.emit('sftp:list', targetPath);
        }
      }, 60000);
    }
    return () => {
      if (transferSafetyTimerRef.current) {
        clearTimeout(transferSafetyTimerRef.current);
        transferSafetyTimerRef.current = null;
      }
    };
  }, [transfer?.action, transfer?.waiting, transfer?.reconnecting, transfer?.filename]);

  // 2. Refresh on Window Focus / tab visibility (When user clicks back into the tab)
  useEffect(() => {
    let returnCheckTimer = null;

    const verifyAfterReturn = () => {
      // Only act if we were in a ready state
      if (statusRef.current !== 'ready') return;

      // If the socket is already disconnected, trigger a reconnect immediately
      if (!socketRef.current?.connected) {
        if (statusRef.current === 'ready') {
          requestReconnect('Connection lost while tab was inactive. Reconnecting...', {
            preserveTransfer: !!transferRef.current || uploadQueueRef.current.length > 0,
            notificationMessage: 'Connection lost while you were away. Reconnecting now.',
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

  const handleFileUpload = async (e, specificFile = null, resumeOffset = 0, overridePath = null, displayName = null, skipOverwriteCheck = false) => {
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
      waiting: false 
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

    let activeHandshakeCleanup = null;
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
        if (data.filename !== file.name) return;
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
        activeHandshakeCleanup = null;
      };

      activeHandshakeCleanup = cleanup;
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

      const successHandler = (data) => {
        if (data?.action !== 'upload' || data?.path !== path) {
          console.log(`📤 Ignoring sftp:action_success for different upload: ${data?.action} ${data?.path} (expecting upload ${path})`);
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
    
    let activeAckCleanup = null;

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

      const chunkSize = 128 * 1024; // 128KB chunks
      let offset = startData.offset || resumeOffset;

      while (offset < file.size) {
        // If transfer was closed/cancelled, stop the loop
        if (transferRef.current !== transferObj) break;

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

        const chunk = file.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        
        if (transferRef.current !== transferObj) break;

        // Send chunk and wait for ACK (Ensures server keeps up and allows pausing)
        const ack = new Promise((resolve, reject) => {
          const sock = getSocket();
          if (!sock?.connected) {
            reject(new Error('Socket disconnected before sending chunk'));
            return;
          }

          const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Upload acknowledgment timeout'));
          }, 15000);

          const handler = (data) => {
            cleanup();
            resolve(data);
          };
          const errHandler = (err) => {
            if (err.resetIn) { // Rate limit — keep transfer alive
              cleanup();
              resolve({ rateLimited: true, resetIn: err.resetIn });
            } else if (err?.guard === 'memory' || err?.guard === 'concurrency') {
              // Guard block mid-transfer — pause and re-open upload session
              cleanup();
              resolve({ guardBlocked: err.guard, retryAfter: 5000 });
            } else {
              cleanup();
              reject(err);
            }
          };
          const cleanup = () => {
            clearTimeout(timeoutId);
            sock.off(`sftp:upload_ack:${file.name}`, handler);
            sock.off('sftp:error', errHandler);
            activeAckCleanup = null;
          };
          activeAckCleanup = cleanup;
          sock.on(`sftp:upload_ack:${file.name}`, handler);
          sock.on('sftp:error', errHandler);
        });

        console.log(`📤 [${file.name}] Sending chunk at offset=${offset}, size=${chunk.size}`);
        getSocket()?.emit(`sftp:upload_chunk:${file.name}`, buffer);
        
        const ackResult = await ack;
        console.log(`📤 [${file.name}] ACK received:`, JSON.stringify(ackResult));
        if (transferRef.current !== transferObj) break;

        if (ackResult.rateLimited && !ackResult.guardBlocked) {
          const waitMs = ackResult.resetIn || 5000;
          const seconds = Math.ceil(waitMs / 1000);
          console.log(`⏳ Rate limited mid-transfer — waiting ${waitMs}ms before retry`);
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
          if (transferRef.current !== transferObj) break;
          setTransfer(prev => prev ? { ...prev, waiting: false, countdown: 0 } : null);
          
          // Re-open upload session from current offset
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
          : offset + chunk.size;
        
        // Update queue offset for persistence
        setUploadQueue(prev => prev.map(item => item.path === path ? { ...item, offset } : item));

        setTransfer(prev => ({ 
          ...prev, 
          progress: Math.round((offset / file.size) * 100),
          waiting: false
        }));

        // Update upload notification with progress
        const pct = Math.round((offset / file.size) * 100);
        updateNotification(uploadNotifId, {
          message: `${file.name} — ${pct}%`,
        });
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
          // Remove from queue on completion
          setUploadQueue(prev => prev.filter(item => item.path !== path));
          setTransfer(null);
          transferRef.current = null;
          if (e) e.target.value = null; // Reset input if it was from event
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
      if (activeHandshakeCleanup) activeHandshakeCleanup();
      if (activeAckCleanup) activeAckCleanup();
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

  const traverseEntry = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      await handleFileUpload(null, file, 0, path);
    } else if (entry.isDirectory) {
      const filesToZip = {};
      let totalSize = 0;
      let processedSize = 0;
      const allEntries = [];

      // Recursive helper to get all file entries first to calculate total size
      const collectEntries = async (ent) => {
        if (ent.isFile) {
          allEntries.push(ent);
          const f = await new Promise(r => ent.file(r));
          totalSize += f.size;
        } else if (ent.isDirectory) {
          const reader = ent.createReader();
          const read = async () => {
            const results = await new Promise(r => reader.readEntries(r));
            if (results.length > 0) {
              for (const result of results) await collectEntries(result);
              await read();
            }
          };
          await read();
        }
      };

      setTransfer({ filename: entry.name, progress: 0, action: 'compress', status: 'Scanning...' });
      await collectEntries(entry);
      
      const zipHelper = async (ent, relPath = '') => {
        if (ent.isFile) {
          const file = await new Promise((resolve) => ent.file(resolve));
          const buf = await file.arrayBuffer();
          filesToZip[relPath + ent.name] = new Uint8Array(buf);
          processedSize += file.size;
          
          if (totalSize > 0) {
            setTransfer({ 
               filename: entry.name, 
               progress: Math.min(99, Math.round((processedSize / totalSize) * 100)), 
               action: 'compress',
               status: `Reading: ${relPath}${ent.name}`
            });
          }
        } else if (ent.isDirectory) {
          const reader = ent.createReader();
          const read = async () => {
            const results = await new Promise((resolve) => reader.readEntries(resolve));
            if (results.length > 0) {
              for (const child of results) await zipHelper(child, relPath + ent.name + '/');
              await read();
            }
          };
          await read();
        }
      };

      await zipHelper(entry);
      
      setTransfer({ filename: entry.name, progress: 99, action: 'compress', status: 'Zipping...' });
      
      try {
        // Use zipSync with level 1 (fastest) to avoid massive CPU/Memory spikes on large folders
        // We wrap in a small timeout to allow the 99% UI state to render first
        const gzData = await new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              // Create TAR first, then GZIP it
              const tar = createTar(filesToZip);
              const compressed = fflate.gzipSync(tar, { level: 6 });
              resolve(compressed);
            } catch (err) {
              reject(err);
            }
          }, 100);
        });

        const blob = new Blob([gzData], { type: 'application/gzip' });
        const tempArchiveName = `.__ssh_monitor_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tar.gz`;
        const archiveFile = new File([blob], tempArchiveName, { type: 'application/gzip' });
        
        console.log(`✅ TAR.GZ creation complete: ${archiveFile.size} bytes`);
        
        // Proceed to the actual upload
        console.log(`📤 Starting upload for archive: ${archiveFile.name} (${archiveFile.size} bytes)`);
        const uploadResult = await handleFileUpload(null, archiveFile, 0, path, entry.name);
        console.log(`📤 Upload result:`, uploadResult);
        
        if (!uploadResult?.path || uploadResult?.interrupted) {
          // Upload was interrupted — the partial archive may already exist on the server.
          // Attempt a best-effort cleanup so it doesn't linger as a corrupt .tar.gz junk file.
          const partialArchivePath = uploadResult?.path || (path === '.' ? tempArchiveName : `${path}/${tempArchiveName}`);
          const cleanupSocket = socketRef.current;
          if (cleanupSocket?.connected) {
            console.warn(`🗑️ Cleaning up partial archive after interrupted upload: ${partialArchivePath}`);
            cleanupSocket.emit('sftp:delete', partialArchivePath);
          }
          throw new Error('Archive upload paused while reconnecting. Please retry after the SSH session is ready.');
        }
        
        // Once upload loop is done, trigger extraction
        const archivePath = uploadResult.path;
        console.log(`🚀 Upload finished, triggering extraction: ${archivePath}`);
        socket.emit('sftp:extract', { path: archivePath, type: 'tar', cleanupArchive: true });
        addNotification({ title: 'Upload Complete', message: `Starting extraction for ${entry.name}...`, type: 'info' });
      } catch (err) {
        console.error('❌ Folder upload failed:', err);
        const errorTitle = err.message?.includes('timeout') ? 'Upload Timeout' : 
                          err.message?.includes('reconnect') ? 'Connection Lost' : 
                          'Upload Error';
        addNotification({ title: errorTitle, message: err.message, type: 'error' });
        setTransfer(null);
        // Refresh file list so any partially uploaded archive is reflected accurately
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = setTimeout(() => {
          if (socketRef.current?.connected) {
            socketRef.current.emit('sftp:list', currentPathRef.current || '.');
          }
        }, 800);
      }
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
            waiting: false
          };
          setTransfer(transferObj);
          transferRef.current = transferObj;

          toastRef.current = addNotification({ 
            title: t('files.status.upload'), 
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
        
        const srcPath = currentPath === '.' ? originalName : `${currentPath}/${originalName}`;
        const destPath = currentPath === '.' ? newName.trim() : `${currentPath}/${newName.trim()}`;
        
        toastRef.current = addNotification({ 
          title: t('files.status.renaming') || 'Renaming', 
          message: `Renaming ${originalName} to ${newName.trim()}...`, 
          type: 'loading', 
          duration: 0 
        });
        
        socket.emit('sftp:move', { src: srcPath, dest: destPath, overwrite: false });
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
    if (!renamingFile || !socket) return;
    const originalName = renamingFile.filename;
    const newName = renamingFile.value.trim();
    setRenamingFile(null);

    if (!newName || newName === originalName) return;

    const srcPath = currentPath === '.' ? originalName : `${currentPath}/${originalName}`;
    const destPath = currentPath === '.' ? newName : `${currentPath}/${newName}`;

    toastRef.current = addNotification({
      title: t('files.status.renaming') || 'Renaming',
      message: `Renaming ${originalName} to ${newName}...`,
      type: 'loading',
      duration: 0,
    });

    socket.emit('sftp:move', { src: srcPath, dest: destPath, overwrite: false });
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
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-80 bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--glow-indigo)] flex items-center justify-center">
                  {transfer.action === 'upload' ? <Upload className="text-[var(--accent-indigo)]" /> : 
                   transfer.action === 'download' ? <Download className="text-[var(--accent-indigo)]" /> :
                   <RefreshCw className="text-[var(--accent-indigo)] animate-spin" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">{transfer.filename}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {transfer.status ? (
                        <span className="text-blue-400 font-medium">{transfer.status}</span>
                    ) : transfer.reconnecting ? (
                        <span className="text-[var(--accent-amber)] font-bold">{t('files.status.reconnecting') || 'Reconnecting...'}</span>
                    ) : transfer.waiting ? (
                        <span className="text-[var(--accent-amber)] font-bold">{t('files.status.rateLimited')}. {t('files.status.retryIn', { seconds: transferCountdown || '...' })}</span>
                    ) : (
                        <span className="capitalize">{getActionLabel()} {t('files.status.inProgress') || 'in progress...'}</span>
                    )}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    const filenameToAbort = transfer.realFilename || transfer.filename;
                    setTransfer(null);
                    transferRef.current = null;
                    if (socket) {
                      socket.emit(`sftp:upload_abort:${filenameToAbort}`);
                    }
                    if (transfer.path) {
                      setUploadQueue(prev => prev.filter(item => item.path !== transfer.path));
                    }
                  }}
                  className="p-2 hover:bg-[var(--bg-tertiary)] rounded-full transition-colors text-[var(--text-muted)] hover:text-rose-500"
                >
                  <X size={18} />
                </button>
              </div>
              
              <div className="h-2 bg-[var(--border-color)] rounded-full overflow-hidden mb-2">
                <motion.div 
                  className={`h-full ${transfer.waiting ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-indigo)]'} shadow-[0_0_10px_var(--glow-indigo)]`}
                  initial={{ width: 0 }}
                  animate={
                    transfer.progress < 0
                      ? { width: ['20%', '75%', '20%'], opacity: [1, 0.55, 1] }
                      : { width: `${transfer.progress}%`, opacity: 1 }
                  }
                  transition={
                    transfer.progress < 0
                      ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                      : { duration: 0.3 }
                  }
                />
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-[var(--text-muted)]">
                <span>
                  {transfer.progress < 0
                    ? `${((transfer.bytes || 0) / 1024 / 1024).toFixed(1)} MB`
                    : `${transfer.progress}%`}
                </span>
                <div className="flex items-center gap-2">
                   {transfer.waiting && (
                      <button 
                        onClick={() => {
                           if (transfer.action === 'download' && lastDownloadRef.current) {
                             handleDownload(lastDownloadRef.current.file, lastDownloadRef.current.offset || 0);
                             return;
                           }
                           const queueItem = uploadQueue.find(qi => (qi.file?.name || qi.filename) === transfer.filename);
                           if (queueItem?.file) {
                             setTransferCountdown(0);
                             handleFileUpload(null, queueItem.file, queueItem.offset);
                           }
                        }}
                        className="text-blue-400 hover:underline flex items-center gap-1"
                      >
                         <RefreshCw size={10} /> Retry Now
                      </button>
                   )}
                   <span>{transfer.waiting ? 'Paused' : t('files.status.doNotClose')}</span>
                </div>
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
                <Edit size={14} /> {t('files.context.edit')}
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
            className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-[var(--bg-primary)]/50 rounded-lg border border-[var(--border-color)] w-full min-w-0 max-w-sm group/path cursor-text"
            onClick={() => setIsEditingPath(true)}
          >
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
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
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
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
            {typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? '⚡ Local' : '☁ Server'}
          </span>
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
                               <select value={sshAiPrefs.aiModel || 'auto'} onChange={(e) => setSshAiPrefs({ aiModel: e.target.value })} className="bg-black/40 border border-white/10 rounded px-1 py-0.5 outline-none text-[10px]">
                                  <option value="auto">Auto</option>
                                  <option value="llama-3.1-8b-instant">Llama 3.1 8B</option>
                                  <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout</option>
                                  <option value="manual">Manual Configuration</option>
                               </select>
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
