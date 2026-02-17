'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useRef } from 'react';
import { 
  Folder, File, ChevronLeft, ChevronRight, RefreshCw, 
  Download, Upload, Trash2, FolderPlus, Search, Grid, List as ListIcon,
  AlertCircle, Edit, FileText, X, Save, AlertTriangle, 
  Copy, Scissors, Clipboard, Wifi
} from 'lucide-react';
import io from 'socket.io-client';
import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import MacOSModalWindow from '@/components/MacOSModalWindow';

import { useApp } from '@/context/AppContext';

export default function FileManager({ connectionId, connectionName, connection }) {
  const { state: appState, dispatch: appDispatch } = useApp();
  const { addNotification, removeNotification, showConfirm, showPrompt } = useOS();
  const { t } = useTranslation();
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
  const [latency, setLatency] = useState(null);
  const socketRef = useRef(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });
  
  // Editor State
  const [editor, setEditor] = useState({ visible: false, file: null, content: '', saving: false });
  // Delete Confirmation and Create modals are now handled by global OS modal system

  // Transfer Progress State
  const [transfer, setTransfer] = useState(null); // { filename, progress, action, waiting, countdown }
  const [isDragging, setIsDragging] = useState(false);
  const [transferCountdown, setTransferCountdown] = useState(0);
  const lastDownloadRef = useRef(null); // { file, offset }
  const transferRef = useRef(null); // Keep a ref of transfer for loop cancellation

  // Ref to track latest currentPath and active toast
  const currentPathRef = useRef(currentPath);
  const toastRef = useRef(null);
  const uploadInputRef = useRef(null);
  const downloadBufferRef = useRef([]);
  
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
       if (toastRef.current) {
         removeNotification(toastRef.current);
         toastRef.current = null;
       }
       addNotification({ title: 'Success', message: t('files.actions.success', { action }), type: 'success' });
       setTransfer(null);
       // Always re-fetch the current file list using the ref (latest path)
       newSocket.emit('sftp:list', currentPathRef.current || '.');
       if (action === 'write') {
          setEditor(prev => ({ ...prev, saving: false, visible: false }));
       }
    });

    newSocket.on('sftp:progress', (data) => {
      setTransfer(prev => ({ ...prev, ...data }));
    });

    newSocket.on('sftp:download_start', ({ filename, size }) => {
       downloadBufferRef.current = [];
       setTransfer({ filename, progress: 0, action: 'download' });
    });

    newSocket.on('sftp:download_chunk', ({ filename, chunk, progress, offset }) => {
       downloadBufferRef.current.push(chunk);
       setTransfer({ filename, progress, action: "download", waiting: false }); if (lastDownloadRef.current) lastDownloadRef.current.offset = offset; 
    });

    newSocket.on('sftp:download_done', ({ filename }) => {
       const blob = new Blob(downloadBufferRef.current);
       const url = window.URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = filename;
       a.click();
       window.URL.revokeObjectURL(url);
       downloadBufferRef.current = [];
       setTransfer(null);
       addNotification({ title: 'Download Complete', message: `Downloaded ${filename}`, type: 'success' });
    });

    newSocket.on('sftp:error', (err) => {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      
      // Handle Rate Limit specifically
      if (err?.resetIn) {
         const seconds = Math.ceil(err.resetIn / 1000);
         setTransferCountdown(seconds);
         setTransfer(prev => prev ? { ...prev, waiting: true, countdown: seconds } : null);
         addNotification({ title: 'Rate Limited', message: `Pausing transfer. Retrying in ${seconds}s...`, type: 'warning' });
         return;
      }

      setTransfer(null);
      console.error('❌ SFTP Error:', err);
      addNotification({ title: 'SFTP Error', message: msg || 'SFTP Error', type: 'error' });
      if (status === 'connecting' || status === 'ssh_connecting') {
        setStatus('error');
        setError(msg);
        setLoading(false);
        clearTimeout(timeout);
      }
      // Reset editor saving state on error
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

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      console.log('🔌 Cleaning up FileManager socket');
      newSocket.disconnect();
      clearTimeout(timeout);
    };
  }, [connectionId]); // Removed 'connection' from dependencies to prevent loop

  // --- Auto-Refresh Logic ---
  
  // 1. Background Polling (Every 10 seconds if ready)
  useEffect(() => {
    if (status !== 'ready' || !socket) return;
    
    const interval = setInterval(() => {
      console.log('🔄 Auto-refreshing file list (polling)...');
      refreshFiles();
    }, 10000);
    
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

  const refreshFiles = (path = currentPath) => {
    if (socket) {
      // Don't full load, just refresh list
      socket.emit('sftp:list', path);
    }
  };

  const handleFolderClick = (name) => {
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    setCurrentPath(newPath);
    refreshFiles(newPath);
  };

  const goBack = () => {
    if (currentPath === '.') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length === 0 ? '.' : parts.join('/');
    setCurrentPath(newPath);
    refreshFiles(newPath);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

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

    setContextMenu({
      visible: true,
      x,
      y,
      file,
      isBackground: !file
    });
  };

  const handleFileUpload = async (e, specificFile = null, resumeOffset = 0) => {
    const file = specificFile || e?.target?.files[0];
    if (!file || !socket) return;

    const path = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
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
      setTimeout(() => { socket.off('sftp:can_upload', handler); resolve({ offset: resumeOffset }); }, 5000);
    });

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
          setTransfer(prev => ({ 
            ...prev, 
            progress: Math.round((offset / file.size) * 100),
            waiting: false
          }));
        }

        socket.emit(`sftp:upload_done:${file.name}`);
        if (e) e.target.value = null; // Reset input if it was from event
    } catch (err) {
        console.error("Upload Loop Error:", err);
        setTransfer(null);
    }
  };

  const handleDownload = (file, offset = 0) => {
     if (!socket) return;
     const path = currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`;
     lastDownloadRef.current = { file, offset };
     
     toastRef.current = addNotification({ 
        title: offset > 0 ? 'Resuming Download' : 'Downloading', 
        message: `Preparing download for ${file.filename}...`, 
        type: 'loading', 
        duration: 0 
     });
     socket.emit('sftp:download', { filePath: path, offset });
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
      setIsDragging(true);
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
          
          toastRef.current = addNotification({ title: 'Transferring', message: `Transferring ${dragData.filename} from ${dragData.connectionName || 'source'}...`, type: 'loading', duration: 0 });
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
            toastRef.current = addNotification({ title: 'Copying', message: `Copying ${dragData.filename}...`, type: 'loading', duration: 0 });
          }
          return;
        }
      } catch (err) {
        console.error('Cross-server drop parse error:', err);
      }
    }
    
    // Regular local file uploads
    const files = Array.from(e.dataTransfer.files);
    if (!files || files.length === 0 || !socket) return;

    // Upload files sequentially using the new robust handler
    for (const file of files) {
      await handleFileUpload(null, file);
    }
  };

   const handleCreate = () => {
    if (!createModal.name || !socket) return;
    const path = currentPath === '.' ? createModal.name : `${currentPath}/${createModal.name}`;
    
    toastRef.current = addNotification({ title: 'Creating', message: `Creating ${createModal.type}...`, type: 'loading', duration: 0 });
    if (createModal.type === 'folder') {
      socket.emit('sftp:mkdir', path);
    } else {
      socket.emit('sftp:writeFile', { path, content: '' });
    }
    setCreateModal({ ...createModal, visible: false, name: '' });
  };

  const handleDelete = () => {
    if (!contextMenu.file || !socket) return;
    const file = contextMenu.file;
    const path = currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`;
    
    showConfirm(
      `${t('files.modals.delete.confirm')} '${file.filename}'?`,
      () => {
        socket.emit('sftp:delete', path);
      },
      t('files.modals.delete.title'),
      t('files.modals.delete.yes'),
      t('files.modals.delete.no')
    );
  };

  const handleCreatePrompt = (type) => {
    showPrompt(
      type === 'folder' ? t('files.modals.create.titleFolder') : t('files.modals.create.titleFile'),
      (name) => {
        if (!name) return;
        const path = currentPath === '.' ? name : `${currentPath}/${name}`;
        toastRef.current = addNotification({ title: 'Creating', message: `Creating ${type}...`, type: 'loading', duration: 0 });
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
       addNotification({ title: 'Error', message: 'Cannot edit directory', type: 'error' });
       return;
    }
    const path = currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`;
    
    toastRef.current = addNotification({ title: 'Loading', message: 'Fetching file content...', type: 'loading', duration: 0 });
    setEditor({ visible: false, file: contextMenu.file, content: '', saving: false });
    socket.emit('sftp:readFile', path);
  };

  const handleSave = () => {
     if (!editor.file || !socket) return;
     const path = currentPath === '.' ? editor.file.filename : `${currentPath}/${editor.file.filename}`;
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
    addNotification({ title: 'Success', message: `${action === 'copy' ? 'Copied' : 'Cut'} ${contextMenu.file.filename}`, type: 'success' });
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
      toastRef.current = addNotification({ title: 'Transferring', message: `Transferring from source...`, type: 'loading', duration: 0 });
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
    toastRef.current = addNotification({ title: 'Pasting', message: `Pasting to ${currentPath}...`, type: 'loading', duration: 0 });
  };

  const filteredFiles = files
    .filter(f => f.filename.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
       // Folders first
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
            color: latency < 150 ? '#4ade80' : latency < 300 ? '#fbbf24' : '#f43f5e' 
          }}
          title="Network Latency (Ping)"
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
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  {transfer.action === 'upload' ? <Upload className="text-blue-400" /> : <Download className="text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">{transfer.filename}</h3>
                  <p className="text-xs text-[var(--text-muted)] capitalize">
                    {transfer.waiting ? (
                        <span className="text-amber-400">Rate Limited. Retrying in {transferCountdown || '...'}s</span>
                    ) : (
                        `${t(`files.status.${transfer.action}`)} ${t('files.status.inProgress') || 'in progress...'}`
                    )}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setTransfer(null);
                    transferRef.current = null;
                    if (socket) socket.emit(`sftp:upload_done:${transfer.filename}`); // Force end on server
                  }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-[var(--text-muted)] hover:text-rose-400"
                >
                  <X size={18} />
                </button>
              </div>
              
              <div className="h-2 bg-[var(--border-color)] rounded-full overflow-hidden mb-2">
                <motion.div 
                  className={`h-full ${transfer.waiting ? 'bg-amber-500' : 'bg-blue-500'} shadow-[0_0_10px_rgba(59,130,246,0.5)]`}
                  initial={{ width: 0 }}
                  animate={{ width: `${transfer.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)]">
                <span>{transfer.progress}%</span>
                <span>{transfer.waiting ? 'Waiting for server...' : t('files.status.doNotClose')}</span>
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
          overlayClassName="bg-black/80"
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-end gap-2 mb-3">
              <button
                onClick={handleSave}
                disabled={editor.saving}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                {editor.saving ? t('files.modals.editor.saving') : t('files.modals.editor.save')}
              </button>
            </div>

            <div className="flex-1 relative">
              <textarea
                value={editor.content}
                onChange={e => setEditor(prev => ({ ...prev, content: e.target.value }))}
                className="w-full h-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono text-sm p-4 focus:outline-none resize-none rounded-xl border border-[var(--border-color)]"
                spellCheck={false}
              />
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
            {contextMenu.file ? contextMenu.file.filename : 'Current Folder'}
          </div>
          
          {contextMenu.file ? (
            <>
              <button 
                onClick={() => { handleEdit(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-[var(--text-primary)] hover:text-blue-400 flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={contextMenu.file?.longname.startsWith('d')}
              >
                <Edit size={14} /> {t('files.context.edit')}
              </button>
              <button 
                onClick={() => { handleDownload(contextMenu.file); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-[var(--text-primary)] hover:text-emerald-400 flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={contextMenu.file?.longname.startsWith('d')}
              >
                <Download size={14} /> {t('files.context.download')}
              </button>
              <button 
                onClick={() => { handleDelete(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-red-500/10 text-rose-400 flex items-center gap-2 transition-colors"
              >
                <Trash2 size={14} /> {t('files.context.delete')}
              </button>
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

      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/50">
        <div className="flex items-center gap-2">
          <button onClick={goBack} disabled={currentPath === '.'} className="p-2 hover:bg-[var(--border-color)] rounded-lg disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)]/50 rounded-lg border border-[var(--border-color)] min-w-[300px]">
            <Folder size={14} className="text-blue-400" />
            <span className="text-xs font-mono truncate">{currentPath}</span>
          </div>
          <button onClick={() => refreshFiles()} className="p-2 hover:bg-[var(--border-color)] rounded-lg">
            <RefreshCw size={18} className={loading ? 'animate-spin text-blue-400' : ''} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input 
              type="text" 
              placeholder={t('files.toolbar.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-lg py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-blue-500/50 w-48 text-[var(--text-primary)]"
            />
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
              title="Upload from Local Computer"
            >
              <Upload size={16} />
            </button>
            <input 
              type="file" 
              ref={uploadInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
            />
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
        onClick={() => setContextMenu({ ...contextMenu, visible: false })}
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
                socket?.emit('ssh:connect', { connectionId });
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
                {status === 'connecting' ? 'Establishing Socket...' : 'Initializing SSH & SFTP...'}
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
                  key={file.filename}
                  draggable
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
                  onDoubleClick={() => isDir ? handleFolderClick(file.filename) : null}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                  className={viewMode === 'grid'
                    ? "group flex flex-col items-center p-3 rounded-xl hover:bg-[var(--border-color)] border border-transparent hover:border-[var(--border-hover)] transition-all cursor-grab active:cursor-grabbing"
                    : "flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--border-color)] group transition-all cursor-grab active:cursor-grabbing"
                  }
                >
                  <div className={viewMode === 'grid'
                    ? "w-16 h-16 flex items-center justify-center mb-2 relative"
                    : "w-8 h-8 flex items-center justify-center"
                  }>
                    {isDir ? (
                      <Folder className="text-blue-400 drop-shadow-lg" size={viewMode === 'grid' ? 48 : 20} />
                    ) : (
                      <File className="text-[var(--text-muted)]" size={viewMode === 'grid' ? 48 : 20} />
                    )}
                  </div>
                  <div className={viewMode === 'grid' ? "text-center" : "flex-1 flex items-center justify-between"}>
                    <span className="text-xs font-medium truncate max-w-[120px] block text-[var(--text-primary)]">
                      {file.filename}
                    </span>
                    {viewMode === 'list' && (
                      <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
                        <span>{formatSize(file.attrs.size)}</span>
                        <span className="w-32 truncate text-right">
                          {new Date(file.attrs.mtime * 1000).toLocaleDateString()}
                        </span>
                      </div>
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
          <span>{filteredFiles.length} items</span>
          <span>{filteredFiles.filter(f => !f.longname.startsWith('d')).length} files</span>
          {status !== 'ready' && <span className="animate-pulse text-amber-500">System State: {status}</span>}
        </div>
        <div className="flex gap-2">
          <span className={status === 'ready' ? 'text-emerald-500' : status === 'error' ? 'text-rose-500' : 'text-amber-500'}>
            {status === 'ready' ? '● SFTP Protocol Active' : status === 'error' ? '○ Connection Failed' : '○ Initializing...'}
          </span>
        </div>
      </div>
    </div>
  );
}
