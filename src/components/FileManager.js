'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useRef } from 'react';
import { 
  Folder, File, ChevronLeft, ChevronRight, RefreshCw, 
  Download, Upload, Trash2, FolderPlus, Search, Grid, List as ListIcon,
  AlertCircle, Edit, FileText, X, Save, AlertTriangle, 
  Copy, Scissors, Clipboard
} from 'lucide-react';
import io from 'socket.io-client';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { useApp } from '@/context/AppContext';

export default function FileManager({ connectionId, connectionName, connection }) {
  const { state: appState, dispatch: appDispatch } = useApp();
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

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });
  
  // Editor State
  const [editor, setEditor] = useState({ visible: false, file: null, content: '', saving: false });
  // Create Modal State
  const [createModal, setCreateModal] = useState({ visible: false, type: 'file', name: '' }); 
  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState({ visible: false, file: null });

  // Transfer Progress State
  const [transfer, setTransfer] = useState(null); // { filename, progress, action }
  const [isDragging, setIsDragging] = useState(false);

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

    newSocket.on('sftp:list', (data) => {
      console.log('📋 Received file list:', data.files?.length);
      setFiles(data.files || []);
      setLoading(false);
      setStatus('ready');
      clearTimeout(timeout);
    });

    newSocket.on('sftp:file_content', ({ path, content }) => {
       setEditor(prev => ({ ...prev, content, visible: true, saving: false }));
       toast.dismiss(); 
    });

    newSocket.on('sftp:action_success', ({ action, path }) => {
       if (toastRef.current) {
         toast.dismiss(toastRef.current);
         toastRef.current = null;
       } else {
         toast.dismiss();
       }
       toast.success(t('files.actions.success', { action }));
       setTransfer(null);
       // Always re-fetch the current file list using the ref (latest path)
       newSocket.emit('sftp:list', currentPathRef.current || '.');
       if (action === 'write') {
          setEditor(prev => ({ ...prev, saving: false, visible: false }));
       }
    });

    newSocket.on('sftp:progress', (data) => {
      setTransfer(data);
    });

    newSocket.on('sftp:download_start', ({ filename, size }) => {
       downloadBufferRef.current = [];
       setTransfer({ filename, progress: 0, action: 'download' });
    });

    newSocket.on('sftp:download_chunk', ({ filename, chunk, progress }) => {
       downloadBufferRef.current.push(chunk);
       setTransfer({ filename, progress, action: 'download' });
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
       toast.success(`Downloaded ${filename}`);
    });

    newSocket.on('sftp:error', (err) => {
      if (toastRef.current) {
        toast.dismiss(toastRef.current);
        toastRef.current = null;
      } else {
        toast.dismiss();
      }
      setTransfer(null);
      console.error('❌ SFTP Error:', err);
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      toast.error(msg || 'SFTP Error');
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !socket) return;

    const path = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
    setTransfer({ filename: file.name, progress: 0, action: 'upload' });
    
    socket.emit('sftp:upload', { filename: file.name, path, size: file.size });

    // Chunk size: 64KB for optimal streaming over socket
    // Wait for server to be ready (Handshake)
    await new Promise(resolve => {
      const handler = ({ filename }) => {
        if (filename === file.name) {
          socket.off('sftp:can_upload', handler);
          resolve();
        }
      };
      socket.on('sftp:can_upload', handler);
      // Fallback in case event is missed (shouldn't happen with correct order but safe)
      setTimeout(() => { socket.off('sftp:can_upload', handler); resolve(); }, 5000);
    });

    const chunkSize = 64 * 1024;
    let offset = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      const buffer = await chunk.arrayBuffer();
      socket.emit(`sftp:upload_chunk:${file.name}`, buffer);
      offset += chunkSize;
    }

    socket.emit(`sftp:upload_done:${file.name}`);
    e.target.value = null; // Reset input
  };

  const handleDownload = (file) => {
     if (!socket) return;
     const path = currentPath === '.' ? file.filename : `${currentPath}/${file.filename}`;
     toast.loading(`Preparing download for ${file.filename}...`);
     socket.emit('sftp:download', path);
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
          
          toastRef.current = toast.loading(`Transferring ${dragData.filename} from ${dragData.connectionName || 'source'}...`);
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
            toast.loading(`Copying ${dragData.filename}...`);
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

    // Upload files sequentially for progress tracking stability
    for (const file of files) {
      const path = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
      setTransfer({ filename: file.name, progress: 0, action: 'upload' });
      
      socket.emit('sftp:upload', { filename: file.name, path, size: file.size });

      // Wait for server to be ready (Handshake)
      await new Promise(resolve => {
        const handler = ({ filename }) => {
          if (filename === file.name) {
            socket.off('sftp:can_upload', handler);
            resolve();
          }
        };
        socket.on('sftp:can_upload', handler);
        setTimeout(() => { socket.off('sftp:can_upload', handler); resolve(); }, 5000);
      });

      const chunkSize = 64 * 1024;
      let offset = 0;

      while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        socket.emit(`sftp:upload_chunk:${file.name}`, buffer);
        offset += chunkSize;
      }

      socket.emit(`sftp:upload_done:${file.name}`);
    }
  };

   const handleCreate = () => {
    if (!createModal.name || !socket) return;
    const path = currentPath === '.' ? createModal.name : `${currentPath}/${createModal.name}`;
    
    toast.loading(`Creating ${createModal.type}...`);
    if (createModal.type === 'folder') {
      socket.emit('sftp:mkdir', path);
    } else {
      socket.emit('sftp:writeFile', { path, content: '' });
    }
    setCreateModal({ ...createModal, visible: false, name: '' });
  };

  const handleDelete = () => {
    if (!contextMenu.file || !socket) return;
    setDeleteModal({ visible: true, file: contextMenu.file });
  };

  const confirmDelete = () => {
    if (!deleteModal.file || !socket) return;
    const path = currentPath === '.' ? deleteModal.file.filename : `${currentPath}/${deleteModal.file.filename}`;
    socket.emit('sftp:delete', path);
    setDeleteModal({ visible: false, file: null });
  };

  const cancelDelete = () => {
    setDeleteModal({ visible: false, file: null });
  };

  const handleEdit = () => {
    if (!contextMenu.file || !socket) return;
    if (contextMenu.file.longname.startsWith('d')) {
       toast.error('Cannot edit directory');
       return;
    }
    const path = currentPath === '.' ? contextMenu.file.filename : `${currentPath}/${contextMenu.file.filename}`;
    
    toast.loading('Fetching file content...');
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
    toast.success(`${action === 'copy' ? 'Copied' : 'Cut'} ${contextMenu.file.filename}`);
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
      toastRef.current = toast.loading(`Transferring from source...`);
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
    toast.loading(`Pasting to ${currentPath}...`);
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
    <div className="flex flex-col h-full bg-[#0a0e1a] text-white relative overflow-hidden">
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
              className="w-80 bg-[#1e293b] rounded-2xl p-6 border border-white/10 shadow-2xl"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  {transfer.action === 'upload' ? <Upload className="text-blue-400" /> : <Download className="text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">{transfer.filename}</h3>
                  <p className="text-xs text-gray-400 capitalize">{t(`files.status.${transfer.action}`)} {t('files.status.inProgress') || 'in progress...'}</p>
                </div>
              </div>
              
              <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                <motion.div 
                  className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${transfer.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-gray-500">
                <span>{transfer.progress}%</span>
                <span>{t('files.status.doNotClose')}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Editor Modal - Portaled to escape window transforms */}
      {editor.visible && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1e293b] w-full max-w-4xl h-[80vh] rounded-xl flex flex-col border border-white/10 shadow-2xl">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#111827]">
              <div className="flex items-center gap-2">
                <FileText className="text-blue-400" size={18} />
                <span className="font-medium text-sm text-gray-200">{editor.file?.filename}</span>
              </div>
              <div className="flex items-center gap-2">
                 <button 
                  onClick={handleSave} 
                  disabled={editor.saving}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
                 >
                   <Save size={14} />
                   {editor.saving ? t('files.modals.editor.saving') : t('files.modals.editor.save')}
                 </button>
                 <button onClick={() => setEditor({ ...editor, visible: false })} className="p-1 hover:bg-white/10 rounded">
                   <X size={18} className="text-gray-400" />
                 </button>
              </div>
            </div>
            <div className="flex-1 relative">
              <textarea 
                value={editor.content} 
                onChange={e => setEditor(prev => ({ ...prev, content: e.target.value }))}
                className="w-full h-full bg-[#0a0e1a] text-gray-300 font-mono text-sm p-4 focus:outline-none resize-none"
                spellCheck={false}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Create File/Folder Modal */}
      {createModal.visible && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4">
          <div className="bg-[#1e293b] w-full max-w-sm rounded-xl border border-white/10 shadow-2xl p-6">
            <h3 className="text-lg font-medium text-white mb-4">
              {createModal.type === 'folder' ? t('files.modals.create.titleFolder') : t('files.modals.create.titleFile')}
            </h3>
            <input
              autoFocus
              type="text"
              placeholder={createModal.type === 'folder' ? t('files.modals.create.placeholderFolder') : t('files.modals.create.placeholderFile')}
              value={createModal.name}
              onChange={(e) => setCreateModal({...createModal, name: e.target.value})}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setCreateModal({...createModal, visible: false})}
                className="px-3 py-1.5 hover:bg-white/10 rounded text-sm text-gray-400"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleCreate}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white font-medium"
              >
                {t('files.modals.create.create')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal - Windows-style */}
      {deleteModal.visible && createPortal(
        <div className="fixed inset-0 bg-black/60 z-[10001] flex items-center justify-center p-4">
          <div 
            className="bg-[#1e293b] w-full max-w-[420px] rounded-lg border border-white/10 shadow-2xl overflow-hidden"
            style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}
          >
            {/* Title bar */}
            <div className="px-4 py-2.5 bg-[#111827] border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" />
                <span className="text-sm font-medium text-gray-200">{t('files.modals.delete.title')}</span>
              </div>
              <button 
                onClick={cancelDelete}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            {/* Content */}
            <div className="p-6 flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
                  <AlertTriangle size={24} className="text-red-400" />
                </div>
              </div>
              <div className="flex-1 pt-1">
                <p className="text-sm text-gray-200 leading-relaxed">
                  {t('files.modals.delete.confirm')}
                </p>
                <p className="text-sm font-semibold text-white mt-1">
                  &apos;{deleteModal.file?.filename}&apos;?
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  {t('files.modals.delete.warning')}
                </p>
              </div>
            </div>
            {/* Buttons */}
            <div className="px-6 py-4 bg-black/20 border-t border-white/5 flex justify-end gap-2">
              <button
                onClick={cancelDelete}
                className="px-5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-sm text-gray-300 hover:text-white font-medium transition-colors min-w-[80px]"
              >
                {t('files.modals.delete.no')}
              </button>
              <button
                onClick={confirmDelete}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 rounded-md text-sm text-white font-medium transition-colors min-w-[80px] shadow-lg shadow-red-500/20"
                autoFocus
              >
                {t('files.modals.delete.yes')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {contextMenu.visible && createPortal(
        <div 
          className="fixed z-[20000] bg-[#1e293b] border border-white/10 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-white/5 text-xs text-gray-400 font-medium truncate max-w-[200px]">
            {contextMenu.file ? contextMenu.file.filename : 'Current Folder'}
          </div>
          
          {contextMenu.file ? (
            <>
              <button 
                onClick={() => { handleEdit(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-gray-200 hover:text-blue-400 flex items-center gap-2 transition-colors disabled:opacity-50"
                disabled={contextMenu.file?.longname.startsWith('d')}
              >
                <Edit size={14} /> {t('files.context.edit')}
              </button>
              <button 
                onClick={() => { handleDownload(contextMenu.file); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-600/20 text-gray-200 hover:text-emerald-400 flex items-center gap-2 transition-colors disabled:opacity-50"
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
              <div className="h-px bg-white/5 my-1" />
              <button 
                onClick={() => handleCopy('copy')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-gray-200 flex items-center gap-2 transition-colors"
              >
                <Copy size={14} /> {t('files.context.copy')}
              </button>
              <button 
                onClick={() => handleCopy('cut')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-gray-200 flex items-center gap-2 transition-colors"
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
                onClick={() => { setCreateModal({ visible: true, type: 'file', name: '' }); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-gray-200 flex items-center gap-2 transition-colors"
              >
                <FileText size={14} /> {t('files.context.newFile')}
              </button>
              <button 
                onClick={() => { setCreateModal({ visible: true, type: 'folder', name: '' }); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-gray-200 flex items-center gap-2 transition-colors"
              >
                <FolderPlus size={14} /> {t('files.context.newFolder')}
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button 
                onClick={() => { refreshFiles(); setContextMenu({ ...contextMenu, visible: false }); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-gray-200 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={14} /> {t('files.context.refresh')}
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#111827]/50">
        <div className="flex items-center gap-2">
          <button onClick={goBack} disabled={currentPath === '.'} className="p-2 hover:bg-white/5 rounded-lg disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/20 rounded-lg border border-white/5 min-w-[300px]">
            <Folder size={14} className="text-blue-400" />
            <span className="text-xs font-mono truncate">{currentPath}</span>
          </div>
          <button onClick={() => refreshFiles()} className="p-2 hover:bg-white/5 rounded-lg">
            <RefreshCw size={18} className={loading ? 'animate-spin text-blue-400' : ''} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
            <input 
              type="text" 
              placeholder={t('files.toolbar.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-black/20 border border-white/5 rounded-lg py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-blue-500/50 w-48"
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
          <div className="flex bg-white/5 p-1 rounded-lg">
            <button 
              onClick={() => uploadInputRef.current?.click()}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/5 transition-all"
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
            <div className="w-px h-4 bg-white/10 my-auto mx-1" />
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Grid size={16} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
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
              <span className="text-xl font-bold text-white">{t('files.status.dropToUpload') || 'Drop here'}</span>
              <span className="text-sm text-gray-400">{connectionName} — {currentPath}</span>
            </div>
          </div>
        )}
        {status === 'error' ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-2">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-white">{t('files.status.errorTitle')}</h3>
            <p className="text-sm text-gray-400 max-w-md">{error}</p>
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
              <span className="text-sm text-gray-200 block mb-1">
                {status === 'connecting' ? 'Establishing Socket...' : 'Initializing SSH & SFTP...'}
              </span>
              <span className="text-xs text-gray-500 uppercase tracking-widest">{connectionName}</span>
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
                    ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;z-index:99999;background:#1e293b;color:#e2e8f0;padding:6px 14px;border-radius:8px;font-size:12px;border:1px solid rgba(255,255,255,0.1);pointer-events:none;display:flex;align-items:center;gap:6px;';
                    ghost.innerHTML = `${isDir ? '📁' : '📄'} ${file.filename}`;
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 0, 0);
                    setTimeout(() => document.body.removeChild(ghost), 0);
                  }}
                  onDoubleClick={() => isDir ? handleFolderClick(file.filename) : null}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                  className={viewMode === 'grid'
                    ? "group flex flex-col items-center p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-grab active:cursor-grabbing"
                    : "flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 group transition-all cursor-grab active:cursor-grabbing"
                  }
                >
                  <div className={viewMode === 'grid'
                    ? "w-16 h-16 flex items-center justify-center mb-2 relative"
                    : "w-8 h-8 flex items-center justify-center"
                  }>
                    {isDir ? (
                      <Folder className="text-blue-400 drop-shadow-lg" size={viewMode === 'grid' ? 48 : 20} />
                    ) : (
                      <File className="text-gray-400" size={viewMode === 'grid' ? 48 : 20} />
                    )}
                  </div>
                  <div className={viewMode === 'grid' ? "text-center" : "flex-1 flex items-center justify-between"}>
                    <span className="text-xs font-medium truncate max-w-[120px] block text-gray-200">
                      {file.filename}
                    </span>
                    {viewMode === 'list' && (
                      <div className="flex items-center gap-4 text-[10px] text-gray-500">
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
      <div className="px-4 py-2 bg-black/40 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-500">
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
