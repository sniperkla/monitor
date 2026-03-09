'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Folder, File as FileIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw, 
  Download, Upload, Trash2, FolderPlus, Search, Grid, List as ListIcon,
  AlertCircle, Edit, FileText, X, Save, AlertTriangle, 
  Copy, Scissors, Clipboard, Wifi, AtSign, Replace, Columns, Rows
} from 'lucide-react';
import io from 'socket.io-client';
import * as fflate from 'fflate';
import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import MacOSModalWindow from '@/components/MacOSModalWindow';

import { useApp } from '@/context/AppContext';

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

export default function FileManager({ 
  connectionId, 
  connection, 
  connectionName,
  isSplit = false,
  onClosePane,
  onSplit
}) {
  const { t } = useTranslation();
  const { state: appState, dispatch: appDispatch } = useApp();
  const { state: osState, addNotification, removeNotification, updateNotification, showConfirm, showPrompt } = useOS();
  const { clipboard } = appState;
  const setClipboard = (payload) => appDispatch({ type: 'SET_CLIPBOARD', payload });
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('connecting'); // connecting, ssh_connecting, ready, error
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]); // global search results
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearchMode = searchQuery.trim().length > 0;
  const searchDebounceRef = useRef(null);
  const [latency, setLatency] = useState(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const socketRef = useRef(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [lastSelectedFile, setLastSelectedFile] = useState(null);
  
  // Editor State
  const [editor, setEditor] = useState({ visible: false, file: null, content: '', saving: false });
  const [infoModal, setInfoModal] = useState({ visible: false, file: null });
  const editorTextareaRef = useRef(null);
  const [mentionState, setMentionState] = useState({ active: false, query: '', results: [], selectedIndex: 0, triggerPos: 0 });

  // Find / Replace state
  const [findBar, setFindBar] = useState({ visible: false, query: '', replace: '', matchCase: false, useRegex: false, replaceVisible: false, currentIndex: 0 });
  const findInputRef = useRef(null);

  // Transfer Progress State
  const [transfer, setTransfer] = useState(null); // { filename, progress, action, waiting, countdown }
  const [isDragging, setIsDragging] = useState(false);
  const [transferCountdown, setTransferCountdown] = useState(0);
  const lastDownloadRef = useRef(null); // { file, offset }
  const transferRef = useRef(null); // Keep a ref of transfer for loop cancellation
  const deleteBatchRef = useRef({ count: 0, total: 0, toastId: null });

  // Ref to track latest currentPath and active toast
  const currentPathRef = useRef(currentPath);
  const toastRef = useRef(null);
  const uploadInputRef = useRef(null);
  const downloadBufferRef = useRef({});
  
  const [uploadQueue, setUploadQueue] = useState([]); // Array of { file, path, offset }
  
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

  useEffect(() => {
    // Close context menu on click elsewhere
    const handleClick = () => setContextMenu({ ...contextMenu, visible: false });
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Ref to hold connection object to access inside effect without triggering it
  const connectionRef = useRef(connection);
  useEffect(() => { connectionRef.current = connection; }, [connection]);

  useEffect(() => {
    console.log('📂 Initializing FileManager for:', connectionId);
    // Don't reset if we are just receiving a status update (handled by removing connection from deps)
    
    setCurrentPath('.');
    currentPathRef.current = '.';
    setLoading(true);
    setStatus('connecting');
    setError(null);

    const newSocket = io({
      path: '/api/socket',
      transports: ['websocket'],
      query: {
        dbUri: appState.dbConfig?.uri || ''
      }
    });

    const timeout = setTimeout(() => {
      if (status === 'connecting' || status === 'ssh_connecting') {
        setStatus('error');
        setError(t('files.status.timeout') || 'Connection timed out. Please check if the server is reachable.');
        setLoading(false);
      }
    }, 15000);

    newSocket.on('connect', () => {
      console.log('🔌 Socket connected, sending ssh:connect');
      setStatus('ssh_connecting');
      // Use ref to get latest connection config without breaking effect
      newSocket.emit('ssh:connect', { connectionId, connection: connectionRef.current });
    });

    newSocket.on('ssh:connected', () => {
      console.log('✅ SSH connected, listing files');
      setStatus('ready');
      newSocket.emit('sftp:list', '.');
      // Update global connection status
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'online' } });
    });

    newSocket.on('heartbeat:pong', (sentTimestamp) => {
      const now = Date.now();
      setLatency(now - sentTimestamp);
    });

    newSocket.on('sftp:list', (data) => {
      // Validate that the returned list matches the path we are currently looking at
      if (data.path !== currentPathRef.current) {
        console.warn('⚠️ Ignoring stale file list for:', data.path, 'current is:', currentPathRef.current);
        return;
      }
      console.log('📋 Received file list:', data.files?.length);
      setFiles(data.files || []);
      setLoading(false);
      setStatus('ready');
      clearTimeout(timeout);
    });

    newSocket.on('sftp:file_content', ({ path, content }) => {
       setEditor(prev => ({ ...prev, content, visible: true, saving: false }));
       if (toastRef.current) removeNotification(toastRef.current);
    });

    newSocket.on('sftp:action_success', ({ action, path }) => {
       if (action === 'delete') {
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
          if (deleteBatchRef.current.count >= deleteBatchRef.current.total && deleteBatchRef.current.toastId) {
            removeNotification(deleteBatchRef.current.toastId);
            deleteBatchRef.current.toastId = null;
          }
       } else if (toastRef.current) {
         removeNotification(toastRef.current);
         toastRef.current = null;
       }
       
       if (action === 'write') {
          addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
          setEditor(prev => ({ ...prev, saving: false, visible: false }));
       } else if (action === 'delete') {
          if (!window._lastDeleteToast || Date.now() - window._lastDeleteToast > 2000) {
            addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
            window._lastDeleteToast = Date.now();
          }
       } else {
          addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
       }
       
       setTransfer(null);
       
       if (window._refreshTimeout) clearTimeout(window._refreshTimeout);
       window._refreshTimeout = setTimeout(() => {
         const targetPath = currentPathRef.current || '.';
         newSocket.emit('sftp:list', targetPath);
       }, 300);
    });

    newSocket.on('sftp:progress', (data) => {
      setTransfer(prev => ({ ...prev, ...data }));
    });

    newSocket.on('sftp:download_start', ({ filename, size }) => {
       if (!downloadBufferRef.current[filename]) {
         downloadBufferRef.current[filename] = { buffer: [], toastId: null };
       } else {
         downloadBufferRef.current[filename].buffer = [];
       }
       setTransfer({ filename, progress: 0, action: 'download' });
    });

    newSocket.on('sftp:download_chunk', ({ filename, chunk, progress, offset }) => {
       if (downloadBufferRef.current[filename]) {
         downloadBufferRef.current[filename].buffer.push(chunk);
       }
       setTransfer({ filename, progress, action: 'download', waiting: false, bytes: offset });
       if (lastDownloadRef.current) lastDownloadRef.current.offset = offset;
    });

    newSocket.on('sftp:download_done', ({ filename }) => {
       const dlMeta = downloadBufferRef.current[filename];
       if (!dlMeta) return;
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
       if (toastRef.current === dlMeta?.toastId) {
         toastRef.current = null;
       }
       addNotification({ title: t('files.toasts.downloadComplete'), message: `${t('files.context.download')} ${filename}`, type: 'success' });
    });

    newSocket.on('sftp:error', (err) => {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      
      // Clear batch deletion toast on error too
      if (deleteBatchRef.current.toastId) {
        removeNotification(deleteBatchRef.current.toastId);
        deleteBatchRef.current.toastId = null;
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

      setTransfer(null);
      console.error('❌ SFTP Error:', err);
      addNotification({ title: t('files.status.errorTitle'), message: msg || t('files.status.errorTitle'), type: 'error' });
      
      const targetPath = currentPathRef.current || '.';
      newSocket.emit('sftp:list', targetPath);

      if (status === 'connecting' || status === 'ssh_connecting') {
        setStatus('error');
        setError(msg);
        setLoading(false);
        clearTimeout(timeout);
      }
      setEditor(prev => ({ ...prev, saving: false }));
    });

    newSocket.on('ssh:error', (err) => {
      console.error('❌ SSH Error:', err);
      setStatus('error');
      setError(err.message);
      setLoading(false);
      clearTimeout(timeout);
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
    });

    newSocket.on('ssh:idle_timeout', () => {
      setStatus('error');
      setError('Idle timeout: 2m');
      setLoading(false);
      appDispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: 'offline' } });
      addNotification({ title: 'Disconnected', message: 'Idle timeout: 2m', type: 'warning' });
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      console.log('🔌 Cleaning up FileManager socket');
      newSocket.disconnect();
      clearTimeout(timeout);
    };
  }, [connectionId, reconnectNonce]); // Removed 'connection' from dependencies to prevent loop

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

  // 2. Refresh on Window Focus (When user clicks back into the tab)
  useEffect(() => {
    const handleFocus = () => {
      if (status === 'ready' && socket) {
        console.log('🔄 Regained focus, refreshing file list...');
        refreshFiles();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [status, socket]);

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

  const refreshFiles = (path = currentPathRef.current) => {
    if (socket) {
      // Don't full load, just refresh list
      socket.emit('sftp:list', path || '.');
    }
  };

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

  const handleFileUpload = async (e, specificFile = null, resumeOffset = 0, overridePath = null) => {
    const file = specificFile || e?.target?.files[0];
    if (!file || !socket) return;

    const baseTarget = overridePath !== null ? overridePath : currentPath;
    const path = baseTarget === '.' ? file.name : `${baseTarget}/${file.name}`;
    
    // Add to queue if not already there (for manual retry support)
    setUploadQueue(prev => {
      const exists = prev.find(item => item.path === path);
      if (exists) return prev.map(item => item.path === path ? { file, path, offset: resumeOffset } : item);
      return [...prev, { file, path, offset: resumeOffset }];
    });

    const transferObj = { filename: file.name, progress: 0, action: 'upload', waiting: false };
    setTransfer(transferObj);
    transferRef.current = transferObj;
    
    // Request start
    socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset: resumeOffset });

    // Wait for server handshake
    const startData = await new Promise(resolve => {
      const handler = (data) => {
        if (data.filename === file.name) {
          socket.off('sftp:can_upload', handler);
          resolve(data);
        }
      };
      socket.on('sftp:can_upload', handler);
      setTimeout(() => { socket.off('sftp:can_upload', handler); resolve({ offset: resumeOffset, error: 'Handshake timeout' }); }, 8000);
    });

    if (startData.error) {
       setTransfer(prev => ({ ...prev, waiting: true, error: true }));
       return;
    }

    const chunkSize = 128 * 1024; // 128KB chunks
    let offset = startData.offset || resumeOffset;

    try {
        while (offset < file.size) {
          // If transfer was closed/cancelled, stop the loop
          if (!transferRef.current) break;

          // If we are rate limited, wait for the countdown
          if (transferCountdown > 0) {
              await new Promise(r => {
                  const check = setInterval(() => {
                      if (transferCountdown === 0) {
                          clearInterval(check);
                          r();
                      }
                  }, 500);
              });
              // After waiting, we need to RE-START the upload session from current offset
              socket.emit('sftp:upload', { filename: file.name, path, size: file.size, offset });
              await new Promise(r => socket.once('sftp:can_upload', r));
              setTransfer(prev => ({ ...prev, waiting: false, countdown: 0 }));
          }

          const chunk = file.slice(offset, offset + chunkSize);
          const buffer = await chunk.arrayBuffer();
          
          // Send chunk and wait for ACK (Ensures server keeps up and allows pausing)
          const ack = new Promise((resolve, reject) => {
             const handler = (data) => {
                socket.off(`sftp:upload_ack:${file.name}`, handler);
                socket.off('sftp:error', errHandler);
                resolve(data);
             };
             const errHandler = (err) => {
                if (err.resetIn) { // Just a rate limit, don't reject the whole transfer
                   socket.off(`sftp:upload_ack:${file.name}`, handler);
                   socket.off('sftp:error', errHandler);
                   resolve({ rateLimited: true });
                } else {
                   socket.off(`sftp:upload_ack:${file.name}`, handler);
                   socket.off('sftp:error', errHandler);
                   reject(err);
                }
             };
             socket.on(`sftp:upload_ack:${file.name}`, handler);
             socket.on('sftp:error', errHandler);
          });

          socket.emit(`sftp:upload_chunk:${file.name}`, buffer);
          
          const ackResult = await ack;
          if (ackResult.rateLimited) {
             // Loop will pick up transferCountdown logic on next iteration
             continue; 
          }

          offset += chunkSize;
          
          // Update queue offset for persistence
          setUploadQueue(prev => prev.map(item => item.path === path ? { ...item, offset } : item));

          setTransfer(prev => ({ 
            ...prev, 
            progress: Math.round((offset / file.size) * 100),
            waiting: false
          }));
        }

        socket.emit(`sftp:upload_done:${file.name}`);
        // Remove from queue on completion
        setUploadQueue(prev => prev.filter(item => item.path !== path));
        if (e) e.target.value = null; // Reset input if it was from event
    } catch (err) {
        console.error("Upload Loop Error:", err);
        setTransfer(null);
    }
  };

  const handleDownload = (file, offset = 0) => {
     if (!socket) return;
     const path = file.absPath || (currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`);
     lastDownloadRef.current = { file, offset };
     
     const tId = addNotification({ 
        title: offset > 0 ? t('files.status.resuming') : t('files.status.download'), 
        message: `${t('files.actions.loading', { action: t('files.context.download') })} ${file.filename}...`, 
        type: 'loading', 
        duration: 0 
     });
     
     // Initialize download buffer state
     downloadBufferRef.current[file.filename] = { buffer: [], toastId: tId };

     socket.emit('sftp:download', { filePath: path, offset });
  };

  const handleDownloadFolder = (file) => {
    if (!socket) return;
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

  const handleDownloadSelected = () => {
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
        const archiveFile = new File([blob], `${entry.name}.tar.gz`, { type: 'application/gzip' });
        
        console.log(`✅ TAR.GZ creation complete: ${archiveFile.size} bytes`);
        
        // Proceed to the actual upload
        await handleFileUpload(null, archiveFile, 0, path);
        
        // Once upload loop is done, trigger extraction
        const archivePath = path === '.' ? archiveFile.name : `${path}/${archiveFile.name}`;
        console.log(`🚀 Upload finished, triggering extraction: ${archivePath}`);
        socket.emit('sftp:extract', { path: archivePath, type: 'tar' });
        addNotification({ title: 'Upload Complete', message: 'Starting extraction (TAR.GZ)...', type: 'info' });
      } catch (err) {
        console.error('❌ Compression failed:', err);
        addNotification({ title: 'Compression Error', message: err.message, type: 'error' });
        setTransfer(null);
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
        // Only do cross-server transfer if from a different connection
        if (dragData.connectionId !== connectionId) {
          const destPath = currentPath === '.' 
            ? dragData.filename 
            : `${currentPath}/${dragData.filename}`;
          
          toastRef.current = addNotification({ title: t('files.status.upload'), message: `${t('files.status.uploadingTo')} ${dragData.filename}...`, type: 'loading', duration: 0 });
          socket.emit('sftp:cross_server_transfer', {
            srcConnId: dragData.connectionId,
            srcPath: dragData.filePath,
            destPath: destPath,
            action: 'copy'
          });
          return;
        } else {
          // Same server - do a regular copy
          const destPath = currentPath === '.' 
            ? dragData.filename 
            : `${currentPath}/${dragData.filename}`;
          if (dragData.filePath !== destPath) {
            socket.emit('sftp:copy', { src: dragData.filePath, dest: destPath });
            toastRef.current = addNotification({ title: t('files.context.copy'), message: `${t('files.context.copy')} ${dragData.filename}...`, type: 'loading', duration: 0 });
          }
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
      const files = Array.from(e.dataTransfer.files);
      if (!files || files.length === 0 || !socket) return;

      // Upload files sequentially using the new robust handler
      for (const file of files) {
        await handleFileUpload(null, file);
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

      const items = e.clipboardData.items;
      if (!items) return;

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
      }
    };

    window.addEventListener('paste', handleSystemPaste);
    return () => window.removeEventListener('paste', handleSystemPaste);
  }, [currentPath, socket]);

   const handleCreate = () => {
    if (!createModal.name || !socket) return;
    const path = currentPath === '.' ? createModal.name : `${currentPath}/${createModal.name}`;
    
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
    
    const fileTarget = contextMenu.file ? contextMenu.file.filename : null;
    let targets = Array.from(selectedFiles);
    if (fileTarget && !selectedFiles.has(fileTarget)) {
       targets = [fileTarget];
    }
    
    if (targets.length === 0) return;

    showConfirm(
      targets.length > 1 ? `${t('files.modals.delete.confirm')} ${targets.length} items?` : `${t('files.modals.delete.confirm')} '${targets[0]}'?`,
      () => {
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
        
        // Safety timeout to clear toast if server vanishes
        setTimeout(() => {
           if (deleteBatchRef.current.toastId === toastId) {
              removeNotification(toastId);
              deleteBatchRef.current.toastId = null;
           }
        }, 15000);

        const targetSet = new Set(targets);
        setFiles(prev => prev.filter(f => !targetSet.has(f.filename)));
        
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
    setInfoModal({ visible: true, file: contextMenu.file });
    setContextMenu({ ...contextMenu, visible: false });
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

  const handleSave = () => {
     if (!editor.file || !socket) return;
     const path = editor.file.absPath || (currentPath === '.' ? editor.file.filename : `${currentPath}/${editor.file.filename}`);
     setEditor(prev => ({ ...prev, saving: true }));
     socket.emit('sftp:writeFile', { path, content: editor.content });
  };

  const handleCopy = (action = 'copy') => {
    if (!contextMenu.file) return;
    const path = currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`;
    setClipboard({ 
      file: contextMenu.file, 
      action, 
      sourcePath: path,
      connectionId: connectionId // Store source connection
    });
    addNotification({ title: t('common.success'), message: `${action === 'copy' ? t('files.actions.copied') : t('files.actions.cut')} ${contextMenu.file.filename}`, type: 'success' });
    setContextMenu({ ...contextMenu, visible: false });
  };

  const handlePaste = () => {
    if (!clipboard || !socket) return;
    const destPath = currentPath === '.' ? clipboard.file.filename : `${currentPath}/${clipboard.file.filename}`;
    
    // Prevent pasting into same path with same name unless it's a copy
    let finalDest = destPath;
    if (clipboard.sourcePath === destPath && clipboard.connectionId === connectionId && clipboard.action === 'copy') {
       finalDest = destPath + '_copy';
    }

    // Check if Cross-Server Transfer
    if (clipboard.connectionId !== connectionId) {
      toastRef.current = addNotification({ title: t('files.status.upload'), message: `${t('files.actions.loading', { action: t('files.status.upload') })}...`, type: 'loading', duration: 0 });
      socket.emit('sftp:cross_server_transfer', {
        srcConnId: clipboard.connectionId,
        srcPath: clipboard.sourcePath,
        destPath: finalDest,
        action: clipboard.action
      });
      if (clipboard.action === 'cut') setClipboard(null);
      return;
    }

    if (clipboard.action === 'copy') {
      socket.emit('sftp:copy', { src: clipboard.sourcePath, dest: finalDest });
    } else {
      socket.emit('sftp:move', { src: clipboard.sourcePath, dest: finalDest });
      setClipboard(null); // Clear after move
    }
    toastRef.current = addNotification({ title: t('files.context.paste'), message: `${t('files.context.paste')} ${t('common.to')} ${currentPath}...`, type: 'loading', duration: 0 });
  };

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
                    ) : transfer.waiting ? (
                        <span className="text-[var(--accent-amber)] font-bold">{t('files.status.rateLimited')}. {t('files.status.retryIn', { seconds: transferCountdown || '...' })}</span>
                    ) : (
                        <span className="capitalize">{t(`files.status.${transfer.action}`)} {t('files.status.inProgress') || 'in progress...'}</span>
                    )}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setTransfer(null);
                    transferRef.current = null;
                    if (socket) socket.emit(`sftp:upload_done:${transfer.filename}`); // Force end on server
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
                           const queueItem = uploadQueue.find(qi => (qi.file?.name || qi.filename) === transfer.filename);
                           if (queueItem) {
                             if (queueItem.file) handleFileUpload(null, queueItem.file, queueItem.offset);
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
                 <p className="text-xs font-medium font-mono">{formatSize(infoModal.file?.attrs?.size)}</p>
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
          <div className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-[var(--bg-primary)]/50 rounded-lg border border-[var(--border-color)] w-full min-w-0 max-w-sm">
            <Folder size={14} className="text-blue-400 flex-shrink-0" />
            <span className="text-[11px] lg:text-xs font-mono truncate">{currentPath}</span>
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
              onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
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
              title={`${t('files.context.paste')} ${clipboard.file.filename}`}
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
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-2">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">{t('files.status.errorTitle')}</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md">{error}</p>
            <button 
              onClick={() => {
                setStatus('connecting');
                setLoading(true);
                setReconnectNonce((n) => n + 1);
              }}
              className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              Retry Connection
            </button>
          </div>
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
                    const filePath = currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`;
                    const dragData = JSON.stringify({
                      filename: file.filename,
                      filePath,
                      connectionId,
                      connectionName,
                      isDir: isDir,
                      size: file.attrs?.size || 0,
                    });
                    e.dataTransfer.setData('application/ssh-file', dragData);
                    e.dataTransfer.effectAllowed = 'copyMove';
                    // Visual drag image
                    const ghost = document.createElement('div');
                    ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;z-index:99999;background:var(--bg-secondary);color:var(--text-primary);padding:6px 14px;border-radius:8px;font-size:12px;border:1px solid var(--border-color);pointer-events:none;display:flex;align-items:center;gap:6px;';
                    ghost.innerHTML = `${isDir ? '📁' : '📄'} ${file.filename}`;
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
                    }
                  }}
                  onContextMenu={(e) => {
                    handleContextMenu(e, file);
                  }}
                  className={viewMode === 'grid'
                    ? `group flex flex-col items-center p-3 rounded-xl border transition-all ${file._searchResult ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${selectedFiles.has(file.filename) ? 'bg-blue-600/20 border-blue-500 shadow-md shadow-blue-500/10' : 'hover:bg-[var(--border-color)] border-transparent hover:border-[var(--border-hover)]'}`
                    : `flex items-center gap-3 p-2 rounded-lg group transition-all ${file._searchResult ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${selectedFiles.has(file.filename) ? 'bg-blue-600/20 border border-blue-500 shadow-inner' : 'hover:bg-[var(--border-color)] border border-transparent'}`
                  }
                >
                  <div className={viewMode === 'grid'
                    ? "w-16 h-16 flex items-center justify-center mb-2 relative"
                    : "w-8 h-8 flex items-center justify-center"
                  }>
                    {isDir ? (
                      <Folder className="text-blue-400 drop-shadow-lg" size={viewMode === 'grid' ? 48 : 20} />
                    ) : (
                      <FileIcon className="text-[var(--text-muted)]" size={viewMode === 'grid' ? 48 : 20} />
                    )}
                  </div>
                  <div className={viewMode === 'grid' ? "text-center" : "flex-1 flex items-center justify-between"}>
                    <span className="text-xs font-medium truncate max-w-[120px] block text-[var(--text-primary)]">
                      {file.filename}
                    </span>
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
          <span className={status === 'ready' ? 'text-emerald-500' : status === 'error' ? 'text-rose-500' : 'text-amber-500'}>
            {status === 'ready' ? t('files.status.sftpActive') : status === 'error' ? t('files.status.connFailed') : t('files.status.initializing')}
          </span>
        </div>
      </div>
    </div>
  );
}
