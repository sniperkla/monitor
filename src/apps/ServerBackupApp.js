'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import {
  HardDrive, Download, Upload, ArrowLeftRight, History, Play, Trash2,
  CheckCircle, AlertCircle, Loader, FolderOpen, Server, Database,
  Shield, FileBox, ChevronRight, RefreshCw, X
} from 'lucide-react';

const TABS = [
  { id: 'backup', label: 'Backup', icon: Download },
  { id: 'restore', label: 'Restore', icon: Upload },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'jobs', label: 'Jobs', icon: History },
];

const BACKUP_TYPES = [
  { id: 'webapp', label: 'Web App', icon: FileBox, desc: 'Source code, configs, public files' },
  { id: 'docker', label: 'Docker', icon: Server, desc: 'Containers, volumes, compose files' },
  { id: 'database', label: 'Database', icon: Database, desc: 'MongoDB, MySQL, PostgreSQL dumps' },
  { id: 'system', label: 'System', icon: Shield, desc: 'SSH keys, cron, systemd, firewall' },
  { id: 'custom', label: 'Custom', icon: FolderOpen, desc: 'Pick any files or directories' },
];

export default function ServerBackupApp() {
  const { state, apiFetch } = useApp();
  const { addNotification } = useOS();
  const { connections } = state;

  const [activeTab, setActiveTab] = useState('backup');
  const [connectionId, setConnectionId] = useState('');
  const [backupType, setBackupType] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [jobLogs, setJobLogs] = useState('');
  const [jobStatus, setJobStatus] = useState(null);
  const [outFilePath, setOutFilePath] = useState('');
  const [logFilePath, setLogFilePath] = useState('');
  const [r2UploadUrl, setR2UploadUrl] = useState('');
  const [isUploadingR2, setIsUploadingR2] = useState(false);
  const [backupHistory, setBackupHistory] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('server_backup_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [migrateModal, setMigrateModal] = useState({ isOpen: false, entry: null, targetId: '', status: 'idle', logs: '', mode: 'backup' });
  const [composeBrowse, setComposeBrowse] = useState({ isOpen: false, currentPath: '/', entries: [], loading: false, selectedFile: null, sourceConnectionId: '' });
  const composeBrowseHistory = useRef([]);

  // Load backup history from database on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await apiFetch('/api/server-backup/history');
        const data = await res.json();
        if (data.success && Array.isArray(data.history) && data.history.length > 0) {
          setBackupHistory(data.history);
        }
      } catch (err) {
        console.error('[backup history] Failed to load from DB:', err);
      }
    };
    loadHistory();
  }, []);

  // Persist backup history to database + localStorage
  useEffect(() => {
    try { localStorage.setItem('server_backup_history', JSON.stringify(backupHistory)); } catch {}
    // Debounce DB save to avoid too many requests
    const timer = setTimeout(async () => {
      try {
        await apiFetch('/api/server-backup/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history: backupHistory }),
        });
      } catch (err) {
        console.error('[backup history] Failed to save to DB:', err);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [backupHistory]);
  const [availableContainers, setAvailableContainers] = useState([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [containerSearch, setContainerSearch] = useState('');
  const [showContainerDropdown, setShowContainerDropdown] = useState(false);
  const containerDropdownRef = useRef(null);

  // Folder browser state
  const [folderBrowser, setFolderBrowser] = useState({ isOpen: false, currentPath: '/', entries: [], loading: false, targetPathIndex: null });
  const [folderHistory, setFolderHistory] = useState(['/']);
  const logRef = useRef(null);

  const [config, setConfig] = useState({
    paths: [''],
    excludes: ['node_modules', '.git', '__pycache__', '*.log'],
    containers: [],
    includeVolumes: false,
    includeImages: false,
    dbType: 'mongodb',
    dbHost: '127.0.0.1',
    dbPort: '27017',
    dbUser: '',
    dbPass: '',
    dbName: '',
    sshKeys: true,
    cron: true,
    systemd: true,
    aptSources: false,
    hostname: true,
    firewall: false,
    nginx: false,
  });

  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePath, setRestorePath] = useState('/tmp/restore');
  const [restoreType, setRestoreType] = useState('files');
  const [restoreTargetId, setRestoreTargetId] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef(null);

  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferTargetPath, setTransferTargetPath] = useState('/tmp/');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState('');

  const sshConnections = connections.filter(c => c.type !== 'database');

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [jobLogs]);

  // Fetch Docker containers when connection changes and backup type is docker
  useEffect(() => {
    if (!connectionId || backupType !== 'docker') {
      setAvailableContainers([]);
      return;
    }
    let cancelled = false;
    const fetchContainers = async () => {
      setLoadingContainers(true);
      try {
        const res = await apiFetch(`/api/server-backup/containers?connectionId=${connectionId}`);
        const data = await res.json();
        if (!cancelled && data.success) {
          setAvailableContainers(data.containers || []);
        }
      } catch (err) {
        console.error('Failed to fetch containers:', err);
      }
      if (!cancelled) setLoadingContainers(false);
    };
    fetchContainers();
    return () => { cancelled = true; };
  }, [connectionId, backupType]);

  // Fetch directory listing for folder browser
  const browseFolder = async (path) => {
    if (!connectionId) return;
    setFolderBrowser(prev => ({ ...prev, loading: true, currentPath: path }));
    try {
      const res = await apiFetch(`/api/server-backup/browse?connectionId=${connectionId}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success) {
        setFolderBrowser(prev => ({ ...prev, entries: data.entries || [], loading: false }));
      } else {
        addNotification({ title: 'Error', message: data.error || 'Cannot list directory', type: 'error' });
        setFolderBrowser(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      setFolderBrowser(prev => ({ ...prev, loading: false }));
    }
  };

  const openFolderBrowser = (pathIndex) => {
    const currentPath = config.paths[pathIndex] || '/';
    const dirPath = currentPath.endsWith('/') ? currentPath : currentPath.split('/').slice(0, -1).join('/') || '/';
    setFolderHistory([dirPath]);
    setFolderBrowser({ isOpen: true, currentPath: dirPath, entries: [], loading: false, targetPathIndex: pathIndex });
    browseFolder(dirPath);
  };

  const navigateToFolder = (folderPath) => {
    setFolderHistory(prev => [...prev, folderPath]);
    browseFolder(folderPath);
  };

  const goBackFolder = () => {
    if (folderHistory.length <= 1) return;
    const newHistory = folderHistory.slice(0, -1);
    const prevPath = newHistory[newHistory.length - 1];
    setFolderHistory(newHistory);
    browseFolder(prevPath);
  };

  const selectFolder = (folderPath) => {
    const idx = folderBrowser.targetPathIndex;
    if (idx !== null) {
      updatePath(idx, folderPath);
    }
    setFolderBrowser({ isOpen: false, currentPath: '/', entries: [], loading: false, targetPathIndex: null });
  };

  // Compose file browser functions
  const browseComposeDir = async (path, sourceConnId) => {
    const connId = sourceConnId || composeBrowse.sourceConnectionId || connectionId;
    if (!connId) return;
    setComposeBrowse(prev => ({ ...prev, loading: true, sourceConnectionId: connId }));
    try {
      const res = await apiFetch(`/api/server-backup/browse?connectionId=${connId}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success) {
        setComposeBrowse(prev => ({
          ...prev,
          currentPath: data.path,
          entries: data.entries,
          loading: false,
        }));
      } else {
        addNotification({ title: 'Error', message: data.error || 'Cannot browse directory', type: 'error' });
        setComposeBrowse(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
      setComposeBrowse(prev => ({ ...prev, loading: false }));
    }
  };

  const openComposeBrowser = () => {
    composeBrowseHistory.current = ['/'];
    setComposeBrowse({ isOpen: true, currentPath: '/', entries: [], loading: false, selectedFile: null, sourceConnectionId: connectionId });
    browseComposeDir('/', connectionId);
  };

  const navigateComposeDir = (dirPath) => {
    composeBrowseHistory.current.push(dirPath);
    browseComposeDir(dirPath);
  };

  const goBackComposeDir = () => {
    if (composeBrowseHistory.current.length <= 1) return;
    composeBrowseHistory.current.pop();
    const prevPath = composeBrowseHistory.current[composeBrowseHistory.current.length - 1];
    browseComposeDir(prevPath);
  };

  const selectComposeFile = (filePath) => {
    setComposeBrowse(prev => ({ ...prev, selectedFile: filePath, isOpen: false }));
  };

  // Close container dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerDropdownRef.current && !containerDropdownRef.current.contains(e.target)) {
        setShowContainerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const uploadToR2 = async (connId, outFile, historyId) => {
    const filename = outFile.split('/').pop() || 'backup.tar.gz';
    setIsUploadingR2(true);
    setR2UploadUrl('');
    try {
      const res = await apiFetch('/api/server-backup/upload-r2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId, filePath: outFile, filename })
      });
      const data = await res.json();
      if (data.success && data.downloadUrl) {
        setR2UploadUrl(data.downloadUrl);
        if (historyId) {
          setBackupHistory(prev => prev.map(h => h.id === historyId ? { ...h, r2Url: data.downloadUrl } : h));
        }
        addNotification({ title: 'Cloud Upload Complete', message: 'Backup uploaded to cloud storage', type: 'success' });
      } else {
        addNotification({ title: 'Cloud Upload Failed', message: data.error || 'Failed to upload to cloud', type: 'error' });
      }
    } catch (err) {
      console.error('[R2 upload] error:', err);
      addNotification({ title: 'Cloud Upload Failed', message: err.message || 'Failed to upload to cloud', type: 'error' });
    }
    setIsUploadingR2(false);
  };

  const pollStatus = (connId, logFile, outFile) => {
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/server-backup/status?connectionId=${connId}&logFile=${encodeURIComponent(logFile)}&outFile=${encodeURIComponent(outFile)}`);
        const data = await res.json();
        if (data.success) {
          setJobLogs(data.logs || '');
          if (data.status === 'completed') {
            clearInterval(interval);
            setIsRunning(false);
            setJobStatus('completed');
            setOutFilePath(outFile);
            addNotification({ title: 'Backup Complete', message: `Backup saved to ${outFile}${data.backupSize ? ` (${formatSize(data.backupSize)})` : ''}`, type: 'success' });
            // Add to history
            const historyEntry = {
              id: Date.now(),
              timestamp: new Date().toISOString(),
              type: backupType,
              connectionId: connId,
              filePath: outFile,
              logFilePath: logFile,
              size: data.backupSize || null,
              r2Url: null,
            };
            setBackupHistory(prev => [historyEntry, ...prev]);
            // Auto-upload to R2
            uploadToR2(connId, outFile, historyEntry.id);
          } else if (data.status === 'failed') {
            clearInterval(interval);
            setIsRunning(false);
            setJobStatus('failed');
            addNotification({ title: 'Backup Failed', message: 'Check logs for details', type: 'error' });
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 3000);
    return () => clearInterval(interval);
  };

  const handleStartBackup = async () => {
    if (!connectionId) return addNotification({ title: 'Error', message: 'Select a server connection', type: 'error' });
    if (!backupType) return addNotification({ title: 'Error', message: 'Select a backup type', type: 'error' });

    const cfg = { ...config };
    if (backupType === 'webapp' || backupType === 'custom') {
      cfg.paths = cfg.paths.filter(p => p.trim());
      if (cfg.paths.length === 0) return addNotification({ title: 'Error', message: 'Enter at least one path', type: 'error' });
    }
    if (backupType === 'database' && !cfg.dbName) {
      return addNotification({ title: 'Error', message: 'Enter database name', type: 'error' });
    }

    setIsRunning(true);
    setJobLogs('Starting backup...\n');
    setJobStatus(null);
    setOutFilePath('');
    setR2UploadUrl('');
    setIsUploadingR2(false);

    try {
      const res = await apiFetch('/api/server-backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, backupType, config: cfg }),
      });
      const data = await res.json();
      if (data.success) {
        setLogFilePath(data.logFile);
        setOutFilePath(data.outFile);
        pollStatus(connectionId, data.logFile, data.outFile);
      } else {
        setIsRunning(false);
        setJobStatus('failed');
        setJobLogs(`Error: ${data.error}`);
        addNotification({ title: 'Error', message: data.error, type: 'error' });
      }
    } catch (err) {
      setIsRunning(false);
      setJobStatus('failed');
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    }
  };

  const handleDownload = () => {
    if (!outFilePath || !connectionId) return;
    if (r2UploadUrl) {
      window.open(r2UploadUrl, '_blank');
      return;
    }
    // Fallback: stream through server (should rarely happen if R2 is configured)
    const filename = outFilePath.split('/').pop() || 'backup.tar.gz';
    const url = `/api/server-backup/download?connectionId=${connectionId}&filePath=${encodeURIComponent(outFilePath)}&filename=${encodeURIComponent(filename)}`;
    window.open(url, '_blank');
  };

  const handleRestore = async () => {
    if (!restoreFile || !restoreTargetId) return addNotification({ title: 'Error', message: 'Select file and target server', type: 'error' });

    setIsRestoring(true);
    try {
      const fd = new FormData();
      fd.append('file', restoreFile);
      fd.append('connectionId', restoreTargetId);
      fd.append('restorePath', restorePath);
      fd.append('restoreType', restoreType);

      const res = await fetch('/api/server-backup/restore', { method: 'POST', body: fd });
      const data = await res.json();

      if (data.success) {
        addNotification({ title: 'Restore Complete', message: 'Backup restored successfully', type: 'success' });
        setJobLogs(data.logs || 'Restore completed');
      } else {
        addNotification({ title: 'Restore Failed', message: data.error, type: 'error' });
        setJobLogs(data.logs || `Error: ${data.error}`);
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    }
    setIsRestoring(false);
  };

  const handleTransfer = async () => {
    if (!connectionId || !outFilePath || !transferTargetId) return addNotification({ title: 'Error', message: 'Complete a backup and select target server', type: 'error' });

    setIsTransferring(true);
    setTransferProgress('Transferring...');
    try {
      const filename = outFilePath.split('/').pop();
      const targetPath = transferTargetPath.endsWith('/') ? `${transferTargetPath}${filename}` : `${transferTargetPath}/${filename}`;

      const res = await apiFetch('/api/server-backup/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceConnectionId: connectionId,
          sourcePath: outFilePath,
          targetConnectionId: transferTargetId,
          targetPath,
        }),
      });
      const data = await res.json();

      if (data.success) {
        addNotification({ title: 'Transfer Complete', message: `Transferred ${formatSize(data.transferred)} to target server`, type: 'success' });
        setTransferProgress(`Done: ${formatSize(data.transferred)}`);
      } else {
        addNotification({ title: 'Transfer Failed', message: data.error, type: 'error' });
        setTransferProgress(`Error: ${data.error}`);
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
      setTransferProgress(`Error: ${err.message}`);
    }
    setIsTransferring(false);
  };

  const handleCleanup = async () => {
    if (!connectionId || !outFilePath) return;
    try {
      await apiFetch(`/api/server-backup/jobs?connectionId=${connectionId}&filePath=${encodeURIComponent(outFilePath)}${logFilePath ? `&logFile=${encodeURIComponent(logFilePath)}` : ''}`, { method: 'DELETE' });
      addNotification({ title: 'Cleaned', message: 'Backup files removed from server', type: 'info' });
      setOutFilePath('');
      setJobLogs('');
      setJobStatus(null);
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    }
  };

  const handleMigrate = async () => {
    if (!migrateModal.targetId) return;

    // Validate based on mode
    if (migrateModal.mode === 'backup' && !migrateModal.entry) return;
    if (migrateModal.mode === 'compose' && !composeBrowse.selectedFile) return;

    setMigrateModal(prev => ({ ...prev, status: 'running', logs: 'Starting Docker migration...\n' }));

    try {
      let res;
      if (migrateModal.mode === 'backup') {
        // Original backup restore flow
        setMigrateModal(prev => ({ ...prev, logs: prev.logs + 'Transferring backup from source to target server...\n' }));
        const entry = migrateModal.entry;
        res = await apiFetch('/api/server-backup/restore-docker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceConnectionId: entry.connectionId,
            sourceFilePath: entry.filePath,
            targetConnectionId: migrateModal.targetId,
          }),
        });
      } else {
        // Compose file deployment flow
        setMigrateModal(prev => ({ ...prev, logs: prev.logs + `Deploying compose file: ${composeBrowse.selectedFile}\n` }));
        res = await apiFetch('/api/server-backup/deploy-compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceConnectionId: composeBrowse.sourceConnectionId || connectionId,
            composeFilePath: composeBrowse.selectedFile,
            targetConnectionId: migrateModal.targetId,
          }),
        });
      }

      const data = await res.json();

      if (data.success) {
        setMigrateModal(prev => ({ ...prev, status: 'done', logs: prev.logs + (data.logs || 'Migration complete!') }));
        addNotification({ title: 'Migration Complete', message: migrateModal.mode === 'backup' ? 'Docker containers restored on target server' : 'Compose file deployed on target server', type: 'success' });
      } else {
        setMigrateModal(prev => ({ ...prev, status: 'error', logs: prev.logs + '\nError: ' + (data.error || 'Unknown error') }));
        addNotification({ title: 'Migration Failed', message: data.error || 'Failed to migrate', type: 'error' });
      }
    } catch (err) {
      setMigrateModal(prev => ({ ...prev, status: 'error', logs: prev.logs + '\nError: ' + err.message }));
      addNotification({ title: 'Migration Failed', message: err.message, type: 'error' });
    }
  };

  const updateConfig = (key, value) => setConfig(prev => ({ ...prev, [key]: value }));
  const addPath = () => updateConfig('paths', [...config.paths, '']);
  const removePath = (i) => updateConfig('paths', config.paths.filter((_, idx) => idx !== i));
  const updatePath = (i, v) => updateConfig('paths', config.paths.map((p, idx) => idx === i ? v : p));
  const updateExclude = (i, v) => updateConfig('excludes', config.excludes.map((p, idx) => idx === i ? v : p));
  const addExclude = () => updateConfig('excludes', [...config.excludes, '']);
  const removeExclude = (i) => updateConfig('excludes', config.excludes.filter((_, idx) => idx !== i));

  return (
    <div className="flex h-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="w-52 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-secondary)]/30 flex flex-col">
        <div className="p-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-sm font-bold">
            <HardDrive size={16} className="text-indigo-400" />
            <span>Server Backup</span>
          </div>
        </div>
        <div className="flex-1 p-2 space-y-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab === tab.id ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-transparent'}`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--border-color)]">
          <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Server</label>
          <SearchableSelect
            value={connectionId}
            onChange={setConnectionId}
            options={sshConnections.map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))}
            placeholder="Select connection..."
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {activeTab === 'backup' && (
          <>
            <div>
              <h2 className="text-sm font-bold mb-3">Backup Type</h2>
              <div className="grid grid-cols-5 gap-2">
                {BACKUP_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setBackupType(t.id)}
                    className={`p-3 rounded-xl border text-center transition-all ${backupType === t.id ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)] hover:border-[var(--border-hover)] text-[var(--text-secondary)]'}`}
                  >
                    <t.icon size={20} className="mx-auto mb-1.5" />
                    <div className="text-[11px] font-bold">{t.label}</div>
                    <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {backupType === 'webapp' && (
              <ConfigSection title="Web App Paths">
                {config.paths.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={p} onChange={e => updatePath(i, e.target.value)} placeholder="/var/www/myapp" className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none" />
                    <button onClick={() => openFolderBrowser(i)} disabled={!connectionId} className="px-2.5 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-indigo-500/10 border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-indigo-400 text-xs transition-all disabled:opacity-30" title="Browse server folders">
                      <FolderOpen size={14} />
                    </button>
                    {config.paths.length > 1 && <button onClick={() => removePath(i)} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
                  </div>
                ))}
                <button onClick={addPath} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold">+ Add Path</button>
                <ExcludeInput excludes={config.excludes} updateExclude={updateExclude} addExclude={addExclude} removeExclude={removeExclude} />
              </ConfigSection>
            )}

            {backupType === 'docker' && (
              <ConfigSection title="Docker Backup Options">
                <div className="space-y-2" ref={containerDropdownRef}>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Containers</label>
                    <span className="text-[9px] text-[var(--text-muted)]">{config.containers.length === 0 ? 'All containers' : `${config.containers.length} selected`}</span>
                  </div>
                  {/* Selected tags */}
                  {config.containers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {config.containers.map(c => (
                        <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[10px] text-indigo-400 font-mono">
                          {c}
                          <button onClick={() => updateConfig('containers', config.containers.filter(x => x !== c))} className="hover:text-red-400 transition-colors"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Search / select input */}
                  <div className="relative">
                    <input
                      type="text"
                      value={containerSearch}
                      onChange={e => { setContainerSearch(e.target.value); setShowContainerDropdown(true); }}
                      onFocus={() => setShowContainerDropdown(true)}
                      placeholder={loadingContainers ? 'Loading containers...' : 'Search containers...'}
                      disabled={loadingContainers}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-50"
                    />
                    {loadingContainers && <Loader size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />}
                    {/* Dropdown */}
                    {showContainerDropdown && availableContainers.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-xl">
                        {/* "All" option */}
                        <button
                          onClick={() => { updateConfig('containers', []); setContainerSearch(''); setShowContainerDropdown(false); }}
                          className={`w-full px-3 py-2 text-left text-xs hover:bg-indigo-500/10 transition-colors flex items-center gap-2 ${config.containers.length === 0 ? 'text-indigo-400' : 'text-[var(--text-secondary)]'}`}
                        >
                          <CheckCircle size={12} className={config.containers.length === 0 ? 'opacity-100' : 'opacity-0'} />
                          <span className="font-bold">All Containers</span>
                        </button>
                        <div className="border-t border-[var(--border-color)]" />
                        {availableContainers
                          .filter(c => !containerSearch || c.name.toLowerCase().includes(containerSearch.toLowerCase()) || c.image?.toLowerCase().includes(containerSearch.toLowerCase()))
                          .map(c => {
                            const selected = config.containers.includes(c.name);
                            return (
                              <button
                                key={c.id || c.name}
                                onClick={() => {
                                  updateConfig('containers', selected ? config.containers.filter(x => x !== c.name) : [...config.containers, c.name]);
                                }}
                                className="w-full px-3 py-2 text-left text-xs hover:bg-indigo-500/10 transition-colors flex items-center gap-2"
                              >
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-indigo-500 border-indigo-500' : 'border-[var(--border-color)]'}`}>
                                  {selected && <CheckCircle size={10} className="text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono font-bold text-[var(--text-primary)] truncate">{c.name}</div>
                                  <div className="text-[9px] text-[var(--text-muted)] truncate">{c.image} &middot; {c.status}</div>
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { updateConfig('containers', []); setContainerSearch(''); }} className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                    Reset to all containers
                  </button>
                </div>
                <Toggle label="Include named volumes" checked={config.includeVolumes} onChange={() => updateConfig('includeVolumes', !config.includeVolumes)} />
                <Toggle label="Include Docker images" checked={config.includeImages} onChange={() => updateConfig('includeImages', !config.includeImages)} />
              </ConfigSection>
            )}

            {backupType === 'database' && (
              <ConfigSection title="Database Configuration">
                <div className="flex gap-2 mb-3">
                  {['mongodb', 'mysql', 'postgres'].map(dt => (
                    <button key={dt} onClick={() => { updateConfig('dbType', dt); updateConfig('dbPort', dt === 'mongodb' ? '27017' : dt === 'mysql' ? '3306' : '5432'); }} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${config.dbType === dt ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
                      {dt.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <InputField label="Host" value={config.dbHost} onChange={v => updateConfig('dbHost', v)} placeholder="127.0.0.1" />
                  <InputField label="Port" value={config.dbPort} onChange={v => updateConfig('dbPort', v)} />
                  <InputField label="Username" value={config.dbUser} onChange={v => updateConfig('dbUser', v)} />
                  <InputField label="Password" value={config.dbPass} onChange={v => updateConfig('dbPass', v)} type="password" />
                </div>
                <InputField label="Database Name" value={config.dbName} onChange={v => updateConfig('dbName', v)} placeholder="mydb" />
              </ConfigSection>
            )}

            {backupType === 'system' && (
              <ConfigSection title="System Config Items">
                <div className="grid grid-cols-2 gap-2">
                  <Toggle label="SSH Keys & Config" checked={config.sshKeys} onChange={() => updateConfig('sshKeys', !config.sshKeys)} />
                  <Toggle label="Cron Jobs" checked={config.cron} onChange={() => updateConfig('cron', !config.cron)} />
                  <Toggle label="Systemd Services" checked={config.systemd} onChange={() => updateConfig('systemd', !config.systemd)} />
                  <Toggle label="APT Sources" checked={config.aptSources} onChange={() => updateConfig('aptSources', !config.aptSources)} />
                  <Toggle label="Hostname & Hosts" checked={config.hostname} onChange={() => updateConfig('hostname', !config.hostname)} />
                  <Toggle label="Firewall Rules" checked={config.firewall} onChange={() => updateConfig('firewall', !config.firewall)} />
                  <Toggle label="Nginx Config" checked={config.nginx} onChange={() => updateConfig('nginx', !config.nginx)} />
                </div>
              </ConfigSection>
            )}

            {backupType === 'custom' && (
              <ConfigSection title="Custom Paths">
                {config.paths.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={p} onChange={e => updatePath(i, e.target.value)} placeholder="/path/to/backup" className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none" />
                    <button onClick={() => openFolderBrowser(i)} disabled={!connectionId} className="px-2.5 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-indigo-500/10 border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-indigo-400 text-xs transition-all disabled:opacity-30" title="Browse server folders">
                      <FolderOpen size={14} />
                    </button>
                    {config.paths.length > 1 && <button onClick={() => removePath(i)} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
                  </div>
                ))}
                <button onClick={addPath} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold">+ Add Path</button>
                <ExcludeInput excludes={config.excludes} updateExclude={updateExclude} addExclude={addExclude} removeExclude={removeExclude} />
              </ConfigSection>
            )}

            <div className="flex gap-3">
              <button onClick={handleStartBackup} disabled={isRunning || !connectionId || !backupType} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                {isRunning ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
                {isRunning ? 'Running...' : 'Start Backup'}
              </button>
              {outFilePath && !isRunning && (
                <>
                  <button onClick={handleDownload} disabled={isUploadingR2} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-2">
                    {isUploadingR2 ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
                    {isUploadingR2 ? 'Uploading to cloud...' : r2UploadUrl ? 'Download from Cloud' : 'Download'}
                  </button>
                  <button onClick={handleCleanup} className="px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-bold transition-all flex items-center gap-2">
                    <Trash2 size={14} /> Cleanup
                  </button>
                </>
              )}
            </div>

            {jobLogs && (
              <ConfigSection title="Logs">
                <div ref={logRef} className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                  {jobLogs}
                  {isRunning && <span className="inline-block w-1.5 h-3 bg-emerald-400 ml-0.5 animate-pulse" />}
                </div>
                {jobStatus === 'completed' && <StatusBadge status="completed" />}
                {jobStatus === 'failed' && <StatusBadge status="failed" />}
              </ConfigSection>
            )}

          </>
        )}

        {activeTab === 'restore' && (
          <>
            <ConfigSection title="Upload Backup">
              <div className="border-2 border-dashed border-[var(--border-color)] rounded-xl p-6 text-center hover:border-indigo-500/40 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <Upload size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
                {restoreFile ? (
                  <div className="text-xs font-bold text-indigo-400">{restoreFile.name} ({formatSize(restoreFile.size)})</div>
                ) : (
                  <div className="text-xs text-[var(--text-muted)]">Click to select .tar.gz backup file</div>
                )}
                <input ref={fileInputRef} type="file" accept=".tar.gz,.tgz" className="hidden" onChange={e => setRestoreFile(e.target.files?.[0] || null)} />
              </div>
            </ConfigSection>

            <ConfigSection title="Target Server">
              <SearchableSelect
                value={restoreTargetId}
                onChange={setRestoreTargetId}
                options={sshConnections.map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))}
                placeholder="Select server..."
              />
            </ConfigSection>

            <ConfigSection title="Restore Settings">
              <div className="flex gap-2 mb-3">
                {['files', 'database-mongodb', 'database-mysql', 'database-postgres'].map(rt => (
                  <button key={rt} onClick={() => setRestoreType(rt)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${restoreType === rt ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
                    {rt === 'files' ? 'Files' : rt.replace('database-', '').toUpperCase()}
                  </button>
                ))}
              </div>
              {restoreType === 'files' && (
                <InputField label="Restore Path" value={restorePath} onChange={setRestorePath} placeholder="/tmp/restore" />
              )}
            </ConfigSection>

            <button onClick={handleRestore} disabled={isRestoring || !restoreFile || !restoreTargetId} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2">
              {isRestoring ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              {isRestoring ? 'Restoring...' : 'Restore Backup'}
            </button>

            {jobLogs && (
              <ConfigSection title="Restore Logs">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap">{jobLogs}</div>
              </ConfigSection>
            )}
          </>
        )}

        {activeTab === 'transfer' && (
          <>
            <ConfigSection title="Source (Current Backup)">
              {outFilePath ? (
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle size={14} className="text-emerald-400" />
                  <span className="font-mono text-[var(--text-secondary)]">{outFilePath}</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)]">Run a backup first to get a source file</div>
              )}
            </ConfigSection>

            <ConfigSection title="Target Server">
              <SearchableSelect
                value={transferTargetId}
                onChange={setTransferTargetId}
                options={sshConnections.filter(c => c._id !== connectionId).map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))}
                placeholder="Select target server..."
              />
              <InputField label="Target Path" value={transferTargetPath} onChange={setTransferTargetPath} placeholder="/tmp/" />
            </ConfigSection>

            <button onClick={handleTransfer} disabled={isTransferring || !outFilePath || !transferTargetId} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2">
              {isTransferring ? <Loader size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              {isTransferring ? 'Transferring...' : 'Transfer Backup'}
            </button>

            {transferProgress && (
              <div className="text-xs text-[var(--text-secondary)]">{transferProgress}</div>
            )}
          </>
        )}

        {activeTab === 'jobs' && (
          <>
            {/* Quick Actions */}
            <ConfigSection title="Quick Actions">
              <button
                onClick={() => setMigrateModal({ isOpen: true, entry: null, targetId: '', status: 'idle', logs: '', mode: 'compose' })}
                className="w-full p-3 rounded-xl border border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5 text-purple-400 transition-all flex items-center justify-center gap-2"
              >
                <FileBox size={16} />
                <span className="text-xs font-bold">Deploy from Compose File</span>
              </button>
            </ConfigSection>

            {/* Backup History */}
            <ConfigSection title="Backup History">
              {backupHistory.length === 0 ? (
                <div className="text-center py-6 text-[var(--text-muted)] text-xs">No backup history yet. Run a backup to see it here.</div>
              ) : (
                <div className="space-y-2">
                  {backupHistory.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)]/50 border border-[var(--border-color)]">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-[var(--text-primary)] truncate">{entry.filePath.split('/').pop()}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-bold uppercase">{entry.type}</span>
                          {entry.r2Url && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">Cloud</span>}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-1">
                          {new Date(entry.timestamp).toLocaleString()}
                          {entry.size ? ` · ${formatSize(entry.size)}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {entry.type === 'docker' && (
                          <button
                            onClick={() => setMigrateModal({ isOpen: true, entry, targetId: '', status: 'idle', logs: '', mode: 'backup' })}
                            className="px-3 py-1.5 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/20 text-purple-400 text-[10px] font-bold transition-all flex items-center gap-1.5"
                          >
                            <ArrowLeftRight size={12} /> Migrate
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (entry.r2Url) {
                              window.open(entry.r2Url, '_blank');
                            } else {
                              const filename = entry.filePath.split('/').pop() || 'backup.tar.gz';
                              const url = `/api/server-backup/download?connectionId=${entry.connectionId}&filePath=${encodeURIComponent(entry.filePath)}&filename=${encodeURIComponent(filename)}`;
                              window.open(url, '_blank');
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold transition-all flex items-center gap-1.5"
                        >
                          <Download size={12} /> Download
                        </button>
                        <button
                          onClick={() => setBackupHistory(prev => prev.filter(h => h.id !== entry.id))}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                          title="Remove"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {backupHistory.length > 0 && (
                <button onClick={() => setBackupHistory([])} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors mt-2">Clear all history</button>
              )}
            </ConfigSection>

            <ConfigSection title="Backup Files on Server">
              <ServerFilesList connectionId={connectionId} apiFetch={apiFetch} />
            </ConfigSection>
          </>
        )}
      </div>

      {/* Folder Browser Modal */}
      {folderBrowser.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[480px] max-h-[80vh] rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-indigo-400" />
                <span className="text-sm font-bold text-[var(--text-primary)]">Browse Server Folders</span>
              </div>
              <button onClick={() => setFolderBrowser({ isOpen: false, currentPath: '/', entries: [], loading: false, targetPathIndex: null })} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
                <X size={16} className="text-[var(--text-muted)]" />
              </button>
            </div>
            {/* Current path + navigation */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/50">
              <button onClick={goBackFolder} disabled={folderHistory.length <= 1} className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors">
                <ChevronRight size={14} className="rotate-180 text-[var(--text-secondary)]" />
              </button>
              <div className="flex-1 font-mono text-[11px] text-[var(--text-secondary)] truncate">{folderBrowser.currentPath}</div>
              <button onClick={() => browseFolder(folderBrowser.currentPath)} className="p-1 rounded hover:bg-white/5 transition-colors">
                <RefreshCw size={12} className={`text-[var(--text-muted)] ${folderBrowser.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {/* Directory listing */}
            <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
              {folderBrowser.loading ? (
                <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-xs"><Loader size={14} className="animate-spin mr-2" /> Loading...</div>
              ) : folderBrowser.entries.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-xs">Empty directory</div>
              ) : (
                <div className="space-y-0.5">
                  {folderBrowser.entries.map((entry) => (
                    <button
                      key={entry.name}
                      onClick={() => {
                        if (entry.isDir) {
                          const newPath = folderBrowser.currentPath === '/' ? `/${entry.name}` : `${folderBrowser.currentPath}/${entry.name}`;
                          navigateToFolder(newPath);
                        }
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${entry.isDir ? 'hover:bg-indigo-500/10 cursor-pointer' : 'opacity-50 cursor-default'}`}
                    >
                      {entry.isDir ? (
                        <FolderOpen size={14} className="text-amber-400 shrink-0" />
                      ) : (
                        <FileBox size={14} className="text-[var(--text-muted)] shrink-0" />
                      )}
                      <span className="text-xs font-mono text-[var(--text-primary)] truncate">{entry.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Footer - select current path */}
            <div className="flex items-center justify-between p-4 border-t border-[var(--border-color)]">
              <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[250px]">{folderBrowser.currentPath}</span>
              <button
                onClick={() => selectFolder(folderBrowser.currentPath)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all"
              >
                Select This Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Docker Migrate Modal */}
      {migrateModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[500px] max-h-[80vh] rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <ArrowLeftRight size={16} className="text-purple-400" />
                <span className="text-sm font-bold text-[var(--text-primary)]">Docker Migration</span>
              </div>
              <button onClick={() => setMigrateModal({ isOpen: false, entry: null, targetId: '', status: 'idle', logs: '', mode: 'backup' })} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
                <X size={16} className="text-[var(--text-muted)]" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Mode selector */}
              {migrateModal.status === 'idle' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setMigrateModal(prev => ({ ...prev, mode: 'backup' }))}
                    className={`flex-1 p-2.5 rounded-xl border text-center transition-all ${migrateModal.mode === 'backup' ? 'bg-purple-500/15 border-purple-500/40 text-purple-400' : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-purple-500/20'}`}
                  >
                    <History size={16} className="mx-auto mb-1" />
                    <div className="text-[10px] font-bold">From Backup</div>
                  </button>
                  <button
                    onClick={() => setMigrateModal(prev => ({ ...prev, mode: 'compose' }))}
                    className={`flex-1 p-2.5 rounded-xl border text-center transition-all ${migrateModal.mode === 'compose' ? 'bg-purple-500/15 border-purple-500/40 text-purple-400' : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-purple-500/20'}`}
                  >
                    <FileBox size={16} className="mx-auto mb-1" />
                    <div className="text-[10px] font-bold">From Compose File</div>
                  </button>
                </div>
              )}

              {/* Backup mode content */}
              {migrateModal.mode === 'backup' && (
                <>
                  <div className="p-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)]">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase mb-1">Source Backup</div>
                    <div className="text-xs font-mono text-[var(--text-primary)]">{migrateModal.entry?.filePath?.split('/').pop()}</div>
                    <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                      {migrateModal.entry?.timestamp ? new Date(migrateModal.entry.timestamp).toLocaleString() : ''}
                    </div>
                  </div>
                </>
              )}

              {/* Compose file mode content */}
              {migrateModal.mode === 'compose' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Source Server</label>
                    <SearchableSelect
                      value={composeBrowse.sourceConnectionId || connectionId}
                      onChange={(v) => setComposeBrowse(prev => ({ ...prev, sourceConnectionId: v }))}
                      options={sshConnections.map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))}
                      placeholder="Select source server..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Compose File</label>
                    {composeBrowse.selectedFile ? (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
                        <FileBox size={14} className="text-purple-400 shrink-0" />
                        <span className="text-xs font-mono text-[var(--text-primary)] truncate flex-1">{composeBrowse.selectedFile}</span>
                        <button onClick={() => setComposeBrowse(prev => ({ ...prev, selectedFile: null }))} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={openComposeBrowser}
                        disabled={!composeBrowse.sourceConnectionId && !connectionId}
                        className="w-full p-3 rounded-lg border border-dashed border-[var(--border-color)] hover:border-purple-500/40 hover:bg-purple-500/5 text-[var(--text-secondary)] hover:text-purple-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <FolderOpen size={14} />
                        <span className="text-xs font-bold">Browse for docker-compose.yml</span>
                      </button>
                    )}
                  </div>
                </>
              )}

              {migrateModal.status === 'idle' && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Target Server</label>
                    <SearchableSelect
                      value={migrateModal.targetId}
                      onChange={(v) => setMigrateModal(prev => ({ ...prev, targetId: v }))}
                      options={sshConnections.filter(c => {
                        if (migrateModal.mode === 'backup') return c._id !== migrateModal.entry?.connectionId;
                        return c._id !== (composeBrowse.sourceConnectionId || connectionId);
                      }).map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))}
                      placeholder="Select target server..."
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/15 text-[10px] text-purple-300">
                    {migrateModal.mode === 'backup'
                      ? 'This will restore all containers, volumes, and images on the target server. Existing containers with the same names will be replaced.'
                      : 'This will deploy the compose file on the target server. Existing containers with the same names will be replaced.'}
                  </div>
                </>
              )}

              {migrateModal.status === 'running' && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/15">
                  <Loader size={18} className="animate-spin text-indigo-400" />
                  <span className="text-xs text-indigo-300 font-bold">Migrating Docker containers...</span>
                </div>
              )}

              {(migrateModal.status === 'done' || migrateModal.status === 'error') && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                  {migrateModal.logs || 'No logs'}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border-color)]">
              <button onClick={() => setMigrateModal({ isOpen: false, entry: null, targetId: '', status: 'idle', logs: '', mode: 'backup' })} className="px-4 py-2 rounded-lg text-xs font-bold text-[var(--text-muted)] hover:bg-white/5 transition-all">
                {migrateModal.status === 'done' || migrateModal.status === 'error' ? 'Close' : 'Cancel'}
              </button>
              {migrateModal.status === 'idle' && (
                <button
                  onClick={handleMigrate}
                  disabled={!migrateModal.targetId || (migrateModal.mode === 'compose' && !composeBrowse.selectedFile)}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-2"
                >
                  <ArrowLeftRight size={14} /> Start Migration
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose File Browser Modal */}
      {composeBrowse.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[480px] max-h-[80vh] rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <FileBox size={16} className="text-purple-400" />
                <span className="text-sm font-bold text-[var(--text-primary)]">Browse for Compose File</span>
              </div>
              <button onClick={() => setComposeBrowse(prev => ({ ...prev, isOpen: false }))} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
                <X size={16} className="text-[var(--text-muted)]" />
              </button>
            </div>
            {/* Current path + navigation */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/50">
              <button onClick={goBackComposeDir} disabled={composeBrowseHistory.current.length <= 1} className="p-1 rounded hover:bg-white/5 disabled:opacity-30 transition-colors">
                <ChevronRight size={14} className="rotate-180 text-[var(--text-secondary)]" />
              </button>
              <div className="flex-1 font-mono text-[11px] text-[var(--text-secondary)] truncate">{composeBrowse.currentPath}</div>
              <button onClick={() => browseComposeDir(composeBrowse.currentPath)} className="p-1 rounded hover:bg-white/5 transition-colors">
                <RefreshCw size={12} className={`text-[var(--text-muted)] ${composeBrowse.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {/* Directory listing */}
            <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
              {composeBrowse.loading ? (
                <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-xs"><Loader size={14} className="animate-spin mr-2" /> Loading...</div>
              ) : composeBrowse.entries.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-xs">Empty directory</div>
              ) : (
                <div className="space-y-0.5">
                  {composeBrowse.entries
                    .filter(e => e.isDir || /^(docker-compose|compose)\.(yml|yaml)$/i.test(e.name))
                    .map((entry) => {
                      const isComposeFile = /^(docker-compose|compose)\.(yml|yaml)$/i.test(entry.name);
                      return (
                        <button
                          key={entry.name}
                          onClick={() => {
                            if (entry.isDir) {
                              const newPath = composeBrowse.currentPath === '/' ? `/${entry.name}` : `${composeBrowse.currentPath}/${entry.name}`;
                              navigateComposeDir(newPath);
                            } else if (isComposeFile) {
                              const fullPath = composeBrowse.currentPath === '/' ? `/${entry.name}` : `${composeBrowse.currentPath}/${entry.name}`;
                              selectComposeFile(fullPath);
                            }
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                            entry.isDir ? 'hover:bg-purple-500/10 cursor-pointer' : 
                            isComposeFile ? 'hover:bg-purple-500/10 cursor-pointer bg-purple-500/5' : 
                            'opacity-30 cursor-default'
                          }`}
                        >
                          {entry.isDir ? (
                            <FolderOpen size={14} className="text-amber-400 shrink-0" />
                          ) : (
                            <FileBox size={14} className={isComposeFile ? 'text-purple-400' : 'text-[var(--text-muted)]'} />
                          )}
                          <span className={`text-xs font-mono truncate ${isComposeFile ? 'text-purple-400 font-bold' : 'text-[var(--text-primary)]'}`}>{entry.name}</span>
                          {isComposeFile && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-bold ml-auto">COMPOSE</span>}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-[var(--border-color)]">
              <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[250px]">
                {composeBrowse.selectedFile ? `Selected: ${composeBrowse.selectedFile}` : 'Select a docker-compose.yml file'}
              </span>
              <button
                onClick={() => setComposeBrowse(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchableSelect({ value, onChange, options, placeholder = 'Select...', disabled = false, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 220;
      setPos({
        top: openUp ? rect.top - 8 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        transform: openUp ? 'translateY(-100%)' : '',
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target) && dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selected = options.find(o => o.value === value);
  const filtered = options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { if (!disabled) { setIsOpen(!isOpen); setSearch(''); } }}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-primary)] border text-xs text-left transition-all ${isOpen ? 'border-indigo-500/50' : 'border-[var(--border-color)]'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[var(--border-hover)]'}`}
      >
        <span className={selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronRight size={12} className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width, transform: pos.transform }}
        >
          <div className="p-1.5 border-b border-[var(--border-color)]">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">No results</div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.value}
                  onClick={() => { onChange(o.value); setIsOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${value === o.value ? 'bg-indigo-500/10 text-indigo-400' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                >
                  {value === o.value && <CheckCircle size={12} className="text-indigo-400 shrink-0" />}
                  <span className="truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigSection({ title, children }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-3">
      <h3 className="text-xs font-bold text-[var(--text-primary)]">{title}</h3>
      {children}
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none" />
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-2.5 text-xs">
      <div className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${checked ? 'bg-indigo-500' : 'bg-[var(--bg-tertiary)]'}`}>
        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0'}`} />
      </div>
      <span className="text-[var(--text-secondary)]">{label}</span>
    </button>
  );
}

function ExcludeInput({ excludes, updateExclude, addExclude, removeExclude }) {
  return (
    <div className="pt-2">
      <label className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Exclude Patterns</label>
      <div className="space-y-1.5">
        {excludes.map((e, i) => (
          <div key={i} className="flex gap-2">
            <input value={e} onChange={ev => updateExclude(i, ev.target.value)} placeholder="node_modules" className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[11px] focus:outline-none" />
            <button onClick={() => removeExclude(i)} className="text-red-400 hover:text-red-300"><X size={12} /></button>
          </div>
        ))}
        <button onClick={addExclude} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold">+ Add Pattern</button>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = status === 'completed' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30';
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${cls}`}>
      {status === 'completed' ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
      {status === 'completed' ? 'Completed' : 'Failed'}
    </div>
  );
}

function ServerFilesList({ connectionId, apiFetch }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/server-backup/jobs?connectionId=${connectionId}`);
      const data = await res.json();
      if (data.success) setFiles(data.files || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, [connectionId]);

  if (!connectionId) return <div className="text-xs text-[var(--text-muted)]">Select a server connection first</div>;
  if (loading) return <div className="text-xs text-[var(--text-muted)]"><Loader size={12} className="animate-spin inline mr-1" /> Loading...</div>;
  if (files.length === 0) return <div className="text-xs text-[var(--text-muted)]">No backup files found on this server</div>;

  return (
    <div className="space-y-1.5">
      <button onClick={loadFiles} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold mb-2 flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
      {files.map((f, i) => (
        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-secondary)]/50 border border-[var(--border-color)]">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-[var(--text-primary)] truncate">{f.path}</div>
            <div className="text-[9px] text-[var(--text-muted)]">{formatSize(f.size)} &middot; {f.date}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
