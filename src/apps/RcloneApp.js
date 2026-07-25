'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  CloudSync, HardDrive, RefreshCw, Terminal, CheckCircle2, AlertTriangle,
  Plus, Trash2, Folder, File, Play, Shield, Settings, Server, Database,
  ArrowRight, Download, Eye, ExternalLink, Cpu, Info, Check, ShieldCheck,
  Zap, Copy, ArrowLeftRight, Monitor, ChevronRight, Link2
} from 'lucide-react';
import { useVault } from '@/context/VaultContext';
import { useApp } from '@/context/AppContext';
import MasterPasswordModal from '@/components/MasterPasswordModal';
import { getLocalConnections } from '@/utils/localConnections';

export default function RcloneApp() {
  const { vaultStatus } = useVault();
  const { state: appState, apiFetch } = useApp();
  
  const [connections, setConnections] = useState([]);
  const [selectedConnId, setSelectedConnId] = useState('');
  const [activeTab, setActiveTab] = useState('setup'); // 'setup' | 'remotes' | 'backup' | 'browser'
  const [loading, setLoading] = useState(false);
  const [rcloneStatus, setRcloneStatus] = useState(null); // { installed, version, remotes, configPath }
  
  // Installation Live Terminal Preview State
  const [installJob, setInstallJob] = useState(null); // { logFile, pid }
  const [installLog, setInstallLog] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const installTerminalRef = useRef(null);

  // Remote Builder Modal State
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);
  const [viewingRemoteDetails, setViewingRemoteDetails] = useState(null); // { name, details }
  const [showRawConfigModal, setShowRawConfigModal] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState('');
  const [newRemoteType, setNewRemoteType] = useState('s3'); // 's3' | 'drive' | 'sftp' | 'webdav'
  const [remoteConfig, setRemoteConfig] = useState({});

  // Backup Execution State
  const [action, setAction] = useState('copy'); // 'copy' | 'sync' | 'move' | 'check'
  const [sourcePath, setSourcePath] = useState('/var/www/html');
  const [targetPath, setTargetPath] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [bwlimit, setBwlimit] = useState('');
  const [transfers, setTransfers] = useState('4');
  
  // Execution Mode & Crontab Scheduler State
  const [execMode, setExecMode] = useState('now'); // 'now' | 'cron'
  const [cronSchedule, setCronSchedule] = useState('0 0 * * *');
  const [customCron, setCustomCron] = useState('0 0 * * *');
  const [serverCrons, setServerCrons] = useState([]);
  const [driveFolderId, setDriveFolderId] = useState(''); // Google Drive folder ID for --drive-root-folder-id
  const [driveFolderUrl, setDriveFolderUrl] = useState(''); // raw pasted URL
  const [useTimestampFolder, setUseTimestampFolder] = useState(true); // create timestamped folder
  const [timestampFormat, setTimestampFormat] = useState('YMD_MMM_HM'); // 'YMD_MMM_HM' (2026_Jul_25_22_05) | 'DMY_HM' | 'YMD_HMS'
  const [enableRetention, setEnableRetention] = useState(true); // auto clean old backups
  const [retentionDays, setRetentionDays] = useState('7'); // delete older than X days
  
  // Interactive Path Picker Modal State
  const [pickerMode, setPickerMode] = useState(null); // 'source' | 'target' | null
  const [pickerTargetType, setPickerTargetType] = useState('local'); // 'local' | 'gdrive:' etc.
  const [pickerCurrentPath, setPickerCurrentPath] = useState('/var/www');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Job Execution & Logs
  const [activeJob, setActiveJob] = useState(null);
  const [jobLog, setJobLog] = useState('');
  const [isJobRunning, setIsJobRunning] = useState(false);
  const logTerminalRef = useRef(null);

  // File Browser State
  const [browseRemote, setBrowseRemote] = useState('');
  const [browsePath, setBrowsePath] = useState('');
  const [remoteItems, setRemoteItems] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Load SSH connections from app state, local encrypted storage, or API
  useEffect(() => {
    const loadConnections = async () => {
      let list = appState?.connections || [];
      if (!list || list.length === 0) {
        try {
          const local = await getLocalConnections();
          if (Array.isArray(local) && local.length > 0) list = local;
        } catch (_) {}
      }
      if (!list || list.length === 0) {
        try {
          const res = await apiFetch('/api/connections');
          const data = await res.json();
          if (data?.success && Array.isArray(data.connections)) list = data.connections;
        } catch (_) {}
      }

      // Filter SSH / Server connections (exclude database-only connections)
      const sshOnly = (list || []).filter(c => c.type !== 'database');
      setConnections(sshOnly);

      if (sshOnly.length > 0 && !selectedConnId) {
        const firstId = sshOnly[0].id || sshOnly[0]._id;
        setSelectedConnId(firstId);
      }
    };

    loadConnections();
  }, [appState?.connections, selectedConnId, apiFetch]);

  // Fetch Rclone status whenever selected connection changes & clear stale data
  useEffect(() => {
    if (selectedConnId && vaultStatus === 'unlocked') {
      setRcloneStatus(null);
      setInstallJob(null);
      setInstallLog('');
      setIsInstalling(false);
      setActiveJob(null);
      setJobLog('');
      setIsJobRunning(false);
      setRemoteItems([]);
      setBrowseRemote('');
      setBrowsePath('');
      setTargetPath('');
      setServerCrons([]);
      fetchRcloneStatus();
      fetchCrons();
    }
  }, [selectedConnId, vaultStatus]);

  // Auto-scroll log terminals
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [jobLog]);

  useEffect(() => {
    if (installTerminalRef.current) {
      installTerminalRef.current.scrollTop = installTerminalRef.current.scrollHeight;
    }
  }, [installLog]);

  // Poll installation live terminal logs
  useEffect(() => {
    let interval = null;
    if (installJob && isInstalling) {
      interval = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/rclone/install?connectionId=${selectedConnId}&logFile=${encodeURIComponent(installJob.logFile)}&sessionName=${encodeURIComponent(installJob.sessionName || '')}&pid=${installJob.pid || ''}`);
          const data = await res.json();
          if (data?.success) {
            setInstallLog(data.log || '');
            setIsInstalling(data.running);
            if (!data.running) {
              fetchRcloneStatus();
            }
          }
        } catch (_) {}
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [installJob, isInstalling, selectedConnId, apiFetch]);

  // Poll active backup job status
  useEffect(() => {
    let interval = null;
    if (activeJob && isJobRunning) {
      interval = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/rclone/exec?connectionId=${selectedConnId}&logFile=${encodeURIComponent(activeJob.logFile)}&sessionName=${encodeURIComponent(activeJob.sessionName || '')}&pid=${activeJob.pid || ''}`);
          const data = await res.json();
          if (data?.success) {
            setJobLog(data.log || '');
            setIsJobRunning(data.running);
          }
        } catch (_) {}
      }, 1500);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activeJob, isJobRunning, selectedConnId, apiFetch]);

  const selectedConn = connections?.find(c => (c.id || c._id) === selectedConnId);

  const fetchRcloneStatus = async () => {
    if (!selectedConnId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/rclone/status?connectionId=${selectedConnId}`);
      const data = await res.json();
      if (data?.success) {
        setRcloneStatus(data);
        if (data.remotes && data.remotes.length > 0 && !targetPath) {
          setTargetPath(`${data.remotes[0]}:backup`);
          setBrowseRemote(`${data.remotes[0]}:`);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleInstallRclone = async () => {
    setIsInstalling(true);
    setInstallLog('🚀 Initializing Rclone installer preview...\n--------------------------------------------------');
    try {
      const res = await apiFetch('/api/rclone/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedConnId })
      });
      const data = await res.json();
      if (data?.success) {
        if (data.logFile) {
          setInstallJob(data);
        } else {
          setIsInstalling(false);
          setInstallLog(data.output || '✅ Rclone installed successfully!');
          fetchRcloneStatus();
        }
      } else {
        setIsInstalling(false);
        setInstallLog(`❌ Failed to launch installer:\n${data?.error || data?.details || 'Unknown error'}`);
      }
    } catch (err) {
      setIsInstalling(false);
      setInstallLog(`❌ Error: ${err.message}`);
    }
  };

  const handleSaveRemote = async () => {
    if (!newRemoteName || !newRemoteType) {
      alert('Please enter remote name and select type');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/rclone/remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnId,
          name: newRemoteName,
          type: newRemoteType,
          config: remoteConfig,
        })
      });
      const data = await res.json();
      if (data?.success) {
        setShowAddRemoteModal(false);
        setNewRemoteName('');
        setRemoteConfig({});
        fetchRcloneStatus();
      } else {
        alert(data?.error || 'Failed to add remote');
      }
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  };

  const fetchCrons = async () => {
    if (!selectedConnId) return;
    try {
      const res = await apiFetch(`/api/rclone/cron?connectionId=${selectedConnId}`);
      const data = await res.json();
      if (data?.success) {
        setServerCrons(data.jobs || []);
      }
    } catch (_) {}
  };

  const handleSaveCron = async () => {
    if (!sourcePath || !targetPath) {
      alert('Please specify source and target paths');
      return;
    }
    const finalSchedule = cronSchedule === 'custom' ? customCron : cronSchedule;
    setLoading(true);
    try {
      const res = await apiFetch('/api/rclone/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnId,
          schedule: finalSchedule,
          action,
          source: sourcePath,
          target: targetPath,
          options: {
            dryRun,
            bwlimit,
            transfers,
            driveFolderId: driveFolderId || '',
            useTimestampFolder,
            timestampFormat,
            enableRetention,
            retentionDays,
          },
        })
      });
      const data = await res.json();
      if (data?.success) {
        alert(`✅ Crontab job scheduled successfully!\n\n${data.humanSchedule || finalSchedule}`);
        fetchCrons();
        fetchRcloneStatus();
      } else {
        alert(data?.error || 'Failed to add crontab job');
      }
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  };

  const handleDeleteCron = async (rawLine) => {
    if (!confirm('Remove this crontab schedule from server?')) return;
    try {
      const res = await apiFetch(`/api/rclone/cron?connectionId=${selectedConnId}&rawLine=${encodeURIComponent(rawLine)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data?.success) {
        fetchCrons();
        fetchRcloneStatus();
      } else {
        alert(data?.error || 'Failed to remove crontab job');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteRemote = async (name) => {
    if (!confirm(`Delete remote "${name}" from rclone config?`)) return;
    try {
      const res = await apiFetch(`/api/rclone/remote?connectionId=${selectedConnId}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data?.success) {
        fetchRcloneStatus();
      } else {
        alert(data?.error || 'Failed to delete remote');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const openPathPicker = (mode) => {
    setPickerMode(mode);
    if (mode === 'source') {
      setPickerTargetType('local');
      const initialPath = sourcePath && sourcePath.startsWith('/') ? sourcePath : '/var/www';
      setPickerCurrentPath(initialPath);
      fetchPickerItems('local', initialPath);
    } else {
      const defaultRemote = rcloneStatus?.remotes?.[0] ? `${rcloneStatus.remotes[0]}:` : 'gdrive:';
      setPickerTargetType(defaultRemote);
      setPickerCurrentPath('');
      fetchPickerItems(defaultRemote, '');
    }
  };

  const fetchPickerItems = async (targetType, subPath) => {
    if (!selectedConnId) return;
    setPickerLoading(true);
    try {
      const remote = targetType === 'local' ? 'local' : targetType;
      const res = await apiFetch(`/api/rclone/browse?connectionId=${selectedConnId}&remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(subPath)}`);
      const data = await res.json();
      if (data?.success) {
        setPickerItems(data.items || []);
      }
    } catch (_) {}
    setPickerLoading(false);
  };

  const selectPickerFolder = () => {
    let fullPath = '';
    if (pickerTargetType === 'local') {
      fullPath = pickerCurrentPath.startsWith('/') ? pickerCurrentPath : `/${pickerCurrentPath}`;
    } else {
      const remoteBase = pickerTargetType.endsWith(':') ? pickerTargetType : `${pickerTargetType}:`;
      fullPath = pickerCurrentPath ? `${remoteBase}${pickerCurrentPath}` : remoteBase;
    }

    if (pickerMode === 'source') {
      setSourcePath(fullPath);
    } else {
      setTargetPath(fullPath);
    }
    setPickerMode(null);
  };

  const handleStartBackupJob = async () => {
    if (!sourcePath || !targetPath) {
      alert('Please specify source and target paths');
      return;
    }
    setJobLog('Launching Rclone operation...');
    setIsJobRunning(true);
    try {
      const res = await apiFetch('/api/rclone/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnId,
          action,
          source: sourcePath,
          target: targetPath,
          options: {
            dryRun,
            bwlimit,
            transfers,
            driveFolderId: driveFolderId || '',
            useTimestampFolder,
            timestampFormat,
            enableRetention,
            retentionDays,
          }
        })
      });
      const data = await res.json();
      if (data?.success) {
        setActiveJob(data);
      } else {
        setIsJobRunning(false);
        alert(data?.error || 'Failed to start Rclone job');
      }
    } catch (err) {
      setIsJobRunning(false);
      alert(err.message);
    }
  };

  const handleBrowseRemote = async (targetRemote = browseRemote, subPath = browsePath) => {
    if (!targetRemote) return;
    setBrowseLoading(true);
    try {
      const res = await apiFetch(`/api/rclone/browse?connectionId=${selectedConnId}&remote=${encodeURIComponent(targetRemote)}&path=${encodeURIComponent(subPath)}`);
      const data = await res.json();
      if (data?.success) {
        setRemoteItems(data.items || []);
      }
    } catch (err) {
      console.error(err);
    }
    setBrowseLoading(false);
  };

  if (vaultStatus !== 'unlocked') {
    return <MasterPasswordModal />;
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
      {/* 🚀 Top App Title Header */}
      <div className="px-6 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20">
            <CloudSync size={24} />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              Rclone Cloud Sync & Backup Manager
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Initialize rclone via browser and transfer files to 40+ cloud providers
            </p>
          </div>
        </div>

        <button
          onClick={fetchRcloneStatus}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-xs font-semibold text-[var(--text-muted)] transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh Status
        </button>
      </div>

      {/* 🖥️ STEP 1: PROMINENT SSH CONNECTION SELECTOR BANNER */}
      <div className="px-6 py-3 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-color)]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Server size={16} className="text-indigo-400" />
            STEP 1: Select Target SSH Connection to Manage:
          </div>
          {selectedConn && (
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full font-semibold">
              Active: {selectedConn.name} ({selectedConn.host})
            </span>
          )}
        </div>

        {/* Big Clickable Server Selector Cards */}
        <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-none">
          {connections?.map((c) => {
            const connId = c.id || c._id;
            const isSelected = connId === selectedConnId;
            return (
              <button
                key={connId}
                onClick={() => setSelectedConnId(connId)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500 text-indigo-400 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/20'
                    : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-indigo-400/50 hover:text-[var(--text-primary)]'
                }`}
              >
                <div className={`p-2 rounded-xl ${isSelected ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                  <Server size={18} />
                </div>
                <div>
                  <div className="text-xs font-bold leading-none mb-1 flex items-center gap-1.5">
                    {c.name}
                    {isSelected && <CheckCircle2 size={13} className="text-indigo-400" />}
                  </div>
                  <div className="text-[10px] font-mono opacity-80 leading-none">
                    {c.username || 'root'}@{c.host}:{c.port || 22}
                  </div>
                </div>
              </button>
            );
          })}

          {(!connections || connections.length === 0) && (
            <div className="p-3 text-xs text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20">
              No SSH connections found. Please add a connection in SSH Manager first.
            </div>
          )}
        </div>
      </div>

      {/* 📍 Navigation Tabs */}
      <div className="flex items-center gap-1 px-6 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
        <button
          onClick={() => setActiveTab('setup')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'setup'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Settings size={14} /> 1. Environment & Setup
        </button>

        <button
          onClick={() => setActiveTab('remotes')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'remotes'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <HardDrive size={14} /> 2. Cloud Remotes ({rcloneStatus?.remotes?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'backup'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Play size={14} /> 3. Sync & Backup Task
        </button>

        <button
          onClick={() => { setActiveTab('browser'); handleBrowseRemote(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'browser'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Eye size={14} /> 4. Cloud Explorer
        </button>
      </div>

      {/* Main Tab View */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* TAB 1: Setup & Initialization */}
        {activeTab === 'setup' && (
          <div className="max-w-4xl space-y-6">
            <div className="p-6 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${rcloneStatus?.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {rcloneStatus?.installed ? <ShieldCheck size={32} /> : <AlertTriangle size={32} />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">
                      {rcloneStatus?.installed
                        ? `Rclone Ready on ${selectedConn?.name || 'Target Server'}`
                        : `Rclone is Not Installed on ${selectedConn?.name || 'Target Server'}`}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      {rcloneStatus?.version || `Initialize rclone on ${selectedConn?.name || 'this server'} with 1 click below`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleInstallRclone}
                    disabled={isInstalling}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
                  >
                    <Download size={14} /> {isInstalling ? 'Installing...' : rcloneStatus?.installed ? 'Re-Initialize Rclone' : '1-Click Initialize Rclone'}
                  </button>
                </div>
              </div>

              {/* Active Background Jobs Banner */}
              {rcloneStatus?.runningJobs && rcloneStatus.runningJobs.length > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-2">
                  <div className="font-bold text-indigo-400 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin text-emerald-400" /> Active Rclone Backup Tasks Running on Server ({rcloneStatus.runningJobs.length})
                    </span>
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                      CRON / BACKGROUND
                    </span>
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px]">
                    {rcloneStatus.runningJobs.map((job, idx) => (
                      <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between text-[var(--text-muted)] bg-[var(--bg-tertiary)] p-2 rounded-lg border border-[var(--border-color)] gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-emerald-400 font-bold text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded">PID {job.pid}</span>
                          {job.user && <span className="text-indigo-400 text-[10px]">[{job.user}]</span>}
                          <span className="truncate text-[var(--text-primary)] font-semibold">{job.cmd}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] shrink-0">
                          {job.cpu && <span>CPU: {job.cpu}%</span>}
                          {job.mem && <span>RAM: {job.mem}%</span>}
                          {job.etime && <span className="text-indigo-400">Time: {job.etime}</span>}
                          <span className="text-emerald-400 font-bold">● ACTIVE</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* System Crontab Schedules List */}
              {rcloneStatus?.cronJobs && rcloneStatus.cronJobs.length > 0 && (
                <div className="mt-3 p-3.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs space-y-1.5">
                  <div className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Terminal size={14} className="text-indigo-400" /> System Crontab Backup Schedules ({rcloneStatus.cronJobs.length}):
                  </div>
                  <div className="space-y-1 font-mono text-[11px]">
                    {rcloneStatus.cronJobs.map((cron, idx) => (
                      <div key={idx} className="px-2.5 py-1 rounded bg-[var(--bg-secondary)] text-indigo-300 border border-[var(--border-color)] truncate">
                        {cron}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {rcloneStatus?.configPath && (
                <div className="mt-6 pt-4 border-t border-[var(--border-color)] text-xs font-mono text-[var(--text-muted)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <File size={14} className="text-indigo-400" /> Remote Config Location:
                    <span className="text-indigo-400 font-semibold">{rcloneStatus.configPath}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold text-[10px]">
                    Active
                  </span>
                </div>
              )}
            </div>

            {/* 🖥️ LIVE INSTALLATION TERMINAL PREVIEW CARD */}
            {(isInstalling || installLog) && (
              <div className="flex flex-col rounded-2xl bg-black border border-indigo-500/30 overflow-hidden shadow-xl">
                <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
                  <span className="flex items-center gap-2 text-indigo-400">
                    <Terminal size={14} /> Live Installation Preview ({selectedConn?.name})
                  </span>
                  {isInstalling ? (
                    <span className="text-amber-400 animate-pulse font-mono text-[11px] flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" /> INSTALLING...
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-mono text-[11px]">● COMPLETED</span>
                  )}
                </div>
                <pre
                  ref={installTerminalRef}
                  className="p-4 font-mono text-[11px] text-emerald-400 bg-black max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                >
                  {installLog || 'Initializing terminal stream...'}
                </pre>
              </div>
            )}

            {/* Visual Feature Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <CloudSync className="text-indigo-400 mb-3" size={24} />
                <h4 className="text-xs font-bold mb-1">40+ Cloud Destinations</h4>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Backup server folders to Google Drive, AWS S3, Cloudflare R2, Dropbox, SFTP, and WebDAV.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <Zap className="text-emerald-400 mb-3" size={24} />
                <h4 className="text-xs font-bold mb-1">High-Speed Parallel Transfer</h4>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Stream files directly from server to cloud with multi-threading and checksum verification.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <Shield className="text-amber-400 mb-3" size={24} />
                <h4 className="text-xs font-bold mb-1">Safe Dry-Run Testing</h4>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Test your sync and copy commands in simulation mode before making any changes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Remotes Manager */}
        {activeTab === 'remotes' && (
          <div className="max-w-5xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">Configured Cloud Remotes</h2>
                <p className="text-xs text-[var(--text-muted)]">Active storage targets on {selectedConn?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {rcloneStatus?.configContent && (
                  <button
                    onClick={() => setShowRawConfigModal(true)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[var(--text-primary)] font-semibold text-xs transition-colors border border-[var(--border-color)]"
                  >
                    <File size={14} className="text-indigo-400" /> View rclone.conf
                  </button>
                )}
                <button
                  onClick={() => setShowAddRemoteModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
                >
                  <Plus size={14} /> Add Cloud Remote
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rcloneStatus?.remotes?.map((remote) => {
                const details = rcloneStatus?.remoteDetails?.[remote] || {};
                const providerType = details.type || 'storage';
                return (
                  <div
                    key={remote}
                    className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                        <HardDrive size={20} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold font-mono">{remote}:</h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase">
                            {providerType}
                          </span>
                          {details.scope && (
                            <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[100px]">
                              {details.scope}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setViewingRemoteDetails({ name: remote, details })}
                        className="p-2 text-xs text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-colors cursor-pointer"
                        title="View Remote Config Parameters"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => { setTargetPath(`${remote}:backup`); setActiveTab('backup'); }}
                        className="p-2 text-xs text-emerald-400 hover:bg-emerald-500/10 rounded-xl transition-colors cursor-pointer"
                        title="Use in Backup"
                      >
                        <ArrowRight size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteRemote(remote)}
                        className="p-2 text-xs text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                        title="Delete Remote"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {(!rcloneStatus?.remotes || rcloneStatus.remotes.length === 0) && (
                <div className="col-span-full p-8 text-center bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl text-[var(--text-muted)] text-xs">
                  No cloud remotes configured on {selectedConn?.name}. Click "Add Cloud Remote" to connect S3, Google Drive, or SFTP.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Backup & Sync Runner */}
        {activeTab === 'backup' && (
          <div className="max-w-5xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Form Controls */}
              <div className="p-6 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">Configure Backup Action</h3>
                  <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                    {selectedConn?.name}
                  </span>
                </div>

                {/* Execution Mode Selector */}
                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1.5">Execution Method:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setExecMode('now')}
                      className={`py-2 px-3 text-center rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        execMode === 'now'
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/20'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-primary)]'
                      }`}
                    >
                      <Zap size={14} /> ⚡ Run Instant (One-Off)
                    </button>

                    <button
                      onClick={() => setExecMode('cron')}
                      className={`py-2 px-3 text-center rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        execMode === 'cron'
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-primary)]'
                      }`}
                    >
                      <Terminal size={14} /> ⏰ Schedule Server Cron
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Select Transfer Type:</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { id: 'copy', label: 'Copy', desc: 'Copy new/updated' },
                      { id: 'sync', label: 'Sync', desc: 'Mirror exact' },
                      { id: 'move', label: 'Move', desc: 'Transfer & delete' },
                      { id: 'check', label: 'Check', desc: 'Verify files' },
                    ].map((act) => (
                      <button
                        key={act.id}
                        onClick={() => setAction(act.id)}
                        className={`py-2 px-1 text-center rounded-xl border transition-all cursor-pointer ${
                          action === act.id
                            ? 'bg-indigo-600 border-indigo-500 text-white font-bold shadow-md shadow-indigo-500/20'
                            : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                        }`}
                      >
                        <div className="text-xs capitalize">{act.label}</div>
                        <div className="text-[9px] opacity-75">{act.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--text-muted)]">Source Path (Local or Remote):</label>
                    <button
                      onClick={() => openPathPicker('source')}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 rounded-lg border border-indigo-500/20 transition-colors"
                    >
                      <Folder size={12} /> Browse Server...
                    </button>
                  </div>
                  <input
                    type="text"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="/var/www/html or gdrive:source"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--text-muted)]">Destination Target Path:</label>
                    <button
                      onClick={() => openPathPicker('target')}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/20 transition-colors"
                    >
                      <HardDrive size={12} /> Browse Cloud Remotes...
                    </button>
                  </div>
                  <input
                    type="text"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    placeholder="gdrive: or gdrive:subfolder or s3_remote:bucket/backups"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* 📂 Google Drive Folder ID Helper */}
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                  <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <Link2 size={13} /> Google Drive: Paste Folder URL or ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={driveFolderUrl}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setDriveFolderUrl(raw);
                        // Extract folder ID from full URL or use as-is if it looks like an ID
                        const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
                        const id = match ? match[1] : raw.trim();
                        setDriveFolderId(id);
                      }}
                      placeholder="https://drive.google.com/drive/folders/1jIhZ9U02TdH... or just folder ID"
                      className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (driveFolderId) {
                          setTargetPath('gdrive:');
                        }
                      }}
                      disabled={!driveFolderId}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                    >
                      Use
                    </button>
                  </div>
                  {driveFolderId && (
                    <div className="text-[10px] font-mono space-y-0.5">
                      <div className="text-emerald-400">✓ Folder ID: <span className="font-bold">{driveFolderId}</span></div>
                      <div className="text-[var(--text-muted)]">→ Will upload directly into this specific folder using <code className="text-emerald-400">--drive-root-folder-id</code></div>
                    </div>
                  )}
                </div>

                {/* 📅 Timestamped Subfolder Options (Interval Mode) */}
                <div className="p-3.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2 text-xs">
                  <label className="flex items-center gap-2 font-bold text-[var(--text-primary)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useTimestampFolder}
                      onChange={(e) => setUseTimestampFolder(e.target.checked)}
                      className="rounded border-[var(--border-color)] text-indigo-600 focus:ring-0"
                    />
                    <span>📅 Create Automated Timestamped Folder (Interval Mode)</span>
                  </label>
                  {useTimestampFolder && (
                    <div className="pl-6 space-y-1.5 text-[11px] text-[var(--text-muted)]">
                      <div className="flex items-center gap-2">
                        <span>Folder Name Format:</span>
                        <select
                          value={timestampFormat}
                          onChange={(e) => setTimestampFormat(e.target.value)}
                          className="px-2.5 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-indigo-400 font-mono"
                        >
                          <option value="YMD_MMM_HM">2026_Jul_25_22_05 (YYYY_MMM_DD_HH_MM)</option>
                          <option value="DMY_HM">25-07-2026_22-03 (DD-MM-YYYY_HH-mm)</option>
                          <option value="YMD_HMS">2026-07-25_22-03-41 (YYYY-MM-DD_HH-mm-ss)</option>
                        </select>
                      </div>
                      <p className="font-mono text-emerald-400 text-[10px]">
                        → Each backup run creates a new folder: <code className="bg-black/30 px-1 py-0.5 rounded text-white">{targetPath || 'gdrive:'}/{timestampFormat === 'YMD_MMM_HM' ? '2026_Jul_25_22_05' : timestampFormat === 'DMY_HM' ? '25-07-2026_22-03' : '2026-07-25_22-03-41'}/</code>
                      </p>
                    </div>
                  )}
                </div>

                {/* 🧹 Auto Retention Policy (Storage Cleanup) */}
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2 text-xs">
                  <label className="flex items-center gap-2 font-bold text-amber-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enableRetention}
                      onChange={(e) => setEnableRetention(e.target.checked)}
                      className="rounded border-[var(--border-color)] text-amber-500 focus:ring-0"
                    />
                    <span>🧹 Auto Clean Old Backups (Prevent Storage Overflow)</span>
                  </label>
                  {enableRetention && (
                    <div className="pl-6 space-y-1.5 text-[11px] text-[var(--text-muted)]">
                      <div className="flex items-center gap-2">
                        <span>Delete files/folders older than:</span>
                        <select
                          value={retentionDays}
                          onChange={(e) => setRetentionDays(e.target.value)}
                          className="px-2.5 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-amber-400 font-mono"
                        >
                          <option value="3">3 Days</option>
                          <option value="7">7 Days (Default)</option>
                          <option value="14">14 Days (2 Weeks)</option>
                          <option value="30">30 Days (1 Month)</option>
                          <option value="90">90 Days (3 Months)</option>
                        </select>
                      </div>
                      <p className="text-[10px] text-amber-300">
                        ✓ Automatically deletes backup folders older than {retentionDays} days to save Google Drive disk space.
                      </p>
                    </div>
                  )}
                </div>

                {/* Crontab Frequency Controls */}
                {execMode === 'cron' && (
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-2.5">
                    <label className="text-xs font-bold text-indigo-400 block">Crontab Schedule Frequency:</label>
                    <select
                      value={cronSchedule}
                      onChange={(e) => setCronSchedule(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                    >
                      <option value="0 0 * * *">Every Day at Midnight (0 0 * * *)</option>
                      <option value="0 2 * * *">Every Day at 02:00 AM (0 2 * * *)</option>
                      <option value="0 * * * *">Every Hour (0 * * * *)</option>
                      <option value="*/30 * * * *">Every 30 Minutes (*/30 * * * *)</option>
                      <option value="*/15 * * * *">Every 15 Minutes (*/15 * * * *)</option>
                      <option value="0 0 * * 0">Every Sunday at Midnight (0 0 * * 0)</option>
                      <option value="0 0 1 * *">1st Day of Every Month (0 0 1 * *)</option>
                      <option value="custom">Custom Cron Expression...</option>
                    </select>

                    {cronSchedule === 'custom' && (
                      <input
                        type="text"
                        value={customCron}
                        onChange={(e) => setCustomCron(e.target.value)}
                        placeholder="e.g. 0 4 * * 1-5"
                        className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                      />
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[var(--border-color)]">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Parallel Threads:</label>
                    <input
                      type="number"
                      value={transfers}
                      onChange={(e) => setTransfers(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Speed Limit:</label>
                    <input
                      type="text"
                      value={bwlimit}
                      onChange={(e) => setBwlimit(e.target.value)}
                      placeholder="e.g. 10M"
                      className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dryRun}
                      onChange={(e) => setDryRun(e.target.checked)}
                      className="rounded border-[var(--border-color)] text-indigo-600 focus:ring-0"
                    />
                    Dry Run (Simulation)
                  </label>

                  {execMode === 'cron' ? (
                    <button
                      onClick={handleSaveCron}
                      disabled={loading}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-600/20 cursor-pointer"
                    >
                      <Terminal size={14} /> Add Task to Server Crontab
                    </button>
                  ) : (
                    <button
                      onClick={handleStartBackupJob}
                      disabled={isJobRunning}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer"
                    >
                      <Play size={14} /> Execute Instant {action.toUpperCase()}
                    </button>
                  )}
                </div>
              </div>

              {/* Right Column: Terminal Logs or Active Server Crontab Manager */}
              <div className="space-y-4">
                {/* Crontab Schedule Manager Panel */}
                <div className="p-5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2.5">
                    <h4 className="text-xs font-bold flex items-center gap-2">
                      <Terminal size={15} className="text-indigo-400" /> Active Server Crontab Tasks ({serverCrons.length})
                    </h4>
                    <button
                      onClick={fetchCrons}
                      className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw size={10} /> Refresh Crontabs
                    </button>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {serverCrons.map((cron) => (
                      <div key={cron.id} className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] flex items-start justify-between gap-3 text-xs">
                        <div className="space-y-1 truncate">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-[10px] font-mono">
                              {cron.humanSchedule}
                            </span>
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">[{cron.schedule}]</span>
                          </div>
                          <p className="font-mono text-[11px] text-[var(--text-primary)] truncate" title={cron.command}>
                            {cron.command}
                          </p>
                        </div>

                        <button
                          onClick={() => handleDeleteCron(cron.raw)}
                          className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0 cursor-pointer"
                          title="Delete Crontab Task from Server"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}

                    {serverCrons.length === 0 && (
                      <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                        No crontab schedule tasks found on {selectedConn?.name}. Select "Schedule Server Cron" above to create an automated schedule!
                      </div>
                    )}
                  </div>
                </div>

                {/* Terminal Log Output */}
                <div className="flex flex-col rounded-2xl bg-black border border-[var(--border-color)] overflow-hidden h-[240px]">
                  <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
                    <span className="flex items-center gap-2">
                      <Terminal size={14} /> Instant Execution Logs ({selectedConn?.name})
                    </span>
                    {isJobRunning && <span className="text-emerald-400 animate-pulse font-mono">● RUNNING</span>}
                  </div>
                  <pre
                    ref={logTerminalRef}
                    className="flex-1 p-3 font-mono text-[11px] text-emerald-400 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                  >
                    {jobLog || 'Click "Execute Instant" to run a one-off backup task with live logs.'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Cloud Explorer */}
        {activeTab === 'browser' && (
          <div className="max-w-5xl space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={browseRemote}
                onChange={(e) => setBrowseRemote(e.target.value)}
                placeholder="gdrive: or s3remote:mybucket"
                className="flex-1 px-4 py-2 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
              />
              <button
                onClick={() => handleBrowseRemote()}
                disabled={browseLoading}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors"
              >
                Browse Remote Storage
              </button>
            </div>

            <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border-color)] font-mono text-xs text-[var(--text-muted)]">
                Files in: {browseRemote || 'Select a remote storage above'}
              </div>
              <div className="divide-y divide-[var(--border-color)] max-h-96 overflow-y-auto font-mono text-xs">
                {remoteItems.map((item, idx) => (
                  <div key={idx} className="px-4 py-2 flex items-center justify-between hover:bg-[var(--bg-tertiary)]">
                    <div className="flex items-center gap-2">
                      {item.IsDir ? <Folder size={14} className="text-amber-400" /> : <File size={14} className="text-blue-400" />}
                      <span>{item.Name || item.Path}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {item.Size ? `${(item.Size / 1024 / 1024).toFixed(2)} MB` : 'DIRECTORY'}
                    </span>
                  </div>
                ))}
                {remoteItems.length === 0 && (
                  <div className="p-6 text-center text-[var(--text-muted)] text-xs">
                    {browseLoading ? 'Loading files from remote storage...' : 'No files found or remote not selected.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Remote Modal */}
      {showAddRemoteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl space-y-4">
            <h3 className="text-sm font-bold">Add Cloud Storage Target on {selectedConn?.name}</h3>

            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Remote Name:</label>
              <input
                type="text"
                value={newRemoteName}
                onChange={(e) => setNewRemoteName(e.target.value)}
                placeholder="e.g. cloudflare_r2 or gdrive_backup"
                className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Storage Provider:</label>
              <select
                value={newRemoteType}
                onChange={(e) => setNewRemoteType(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]"
              >
                <option value="s3">AWS S3 / Cloudflare R2 / MinIO / Wasabi / B2</option>
                <option value="drive">Google Drive</option>
                <option value="sftp">SFTP / SSH Server</option>
                <option value="webdav">WebDAV / Nextcloud</option>
              </select>
            </div>

            {newRemoteType === 's3' && (
              <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                <input
                  type="text"
                  placeholder="Access Key ID"
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, access_key_id: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono"
                />
                <input
                  type="password"
                  placeholder="Secret Access Key"
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, secret_access_key: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono"
                />
                <input
                  type="text"
                  placeholder="Endpoint URL (e.g. https://xxx.r2.cloudflarestorage.com)"
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, endpoint: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono"
                />
              </div>
            )}

            {newRemoteType === 'drive' && (
              <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                <p className="text-[11px] text-[var(--text-muted)]">
                  Enter Google OAuth Client credentials or Service Account details below.
                </p>
                <input
                  type="text"
                  placeholder="Client ID (e.g. xxxx.apps.googleusercontent.com)"
                  value={remoteConfig.client_id || ''}
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, client_id: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                />
                <input
                  type="password"
                  placeholder="Client Secret"
                  value={remoteConfig.client_secret || ''}
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, client_secret: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                />
                <input
                  type="text"
                  placeholder="Service Account Credentials File Path (e.g. /etc/rclone/sa.json)"
                  value={remoteConfig.service_account_file || ''}
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, service_account_file: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                />

                {/* Root Folder ID — lock remote to a specific Drive folder */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-emerald-400">📂 Lock to Specific Google Drive Folder (Optional):</label>
                  <input
                    type="text"
                    placeholder="Paste Google Drive URL or Folder ID (e.g. 1jIhZ9U02TdHel_5fCsAUlws7YOjjCrFO)"
                    value={remoteConfig._drive_url || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
                      const id = match ? match[1] : raw.trim();
                      setRemoteConfig({ ...remoteConfig, _drive_url: raw, root_folder_id: id || '' });
                    }}
                    className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)]"
                  />
                  {remoteConfig.root_folder_id && (
                    <p className="text-[10px] text-emerald-400 font-mono">✓ Folder ID: {remoteConfig.root_folder_id}</p>
                  )}
                </div>

                <select
                  value={remoteConfig.scope || 'drive'}
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, scope: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                >
                  <option value="drive">Full Access (drive)</option>
                  <option value="drive.readonly">Read-Only (drive.readonly)</option>
                  <option value="drive.file">Application Data Only (drive.file)</option>
                </select>
              </div>
            )}

            {newRemoteType === 'sftp' && (
              <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                <input
                  type="text"
                  placeholder="Hostname / IP"
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, host: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono"
                />
                <input
                  type="text"
                  placeholder="Username"
                  onChange={(e) => setRemoteConfig({ ...remoteConfig, user: e.target.value })}
                  className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <button
                onClick={() => setShowAddRemoteModal(false)}
                className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRemote}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Save Remote Target
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔍 View Specific Remote Configuration Parameters Modal */}
      {viewingRemoteDetails && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <HardDrive size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-mono">[{viewingRemoteDetails.name}] Configuration</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">Active settings stored on {selectedConn?.name}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingRemoteDetails(null)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {/* How to use Destination Helper Box */}
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-1">
                <div className="font-bold text-indigo-400 flex items-center gap-1.5">
                  <Info size={14} /> Usage & Destination Syntax:
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Use <code className="text-emerald-400 bg-black/40 px-1.5 py-0.5 rounded font-mono font-bold">{viewingRemoteDetails.name}:folder_name</code> as your destination in Tab 3 or Cloud Explorer.
                </p>
                {viewingRemoteDetails.details?.token && (
                  <p className="text-[10px] text-emerald-400 font-medium">
                    ✓ Authenticated via Google OAuth Token (User Account)
                  </p>
                )}
                {viewingRemoteDetails.details?.service_account_file && (
                  <p className="text-[10px] text-amber-400 font-medium">
                    🔑 Authenticated via Service Account File: {viewingRemoteDetails.details.service_account_file}
                  </p>
                )}
              </div>

              {Object.keys(viewingRemoteDetails.details || {}).length > 0 ? (
                Object.entries(viewingRemoteDetails.details).map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] flex items-center justify-between font-mono text-xs">
                    <span className="text-indigo-400 font-semibold">{k}</span>
                    <span className="text-[var(--text-primary)] truncate max-w-[260px] bg-black/30 px-2 py-0.5 rounded text-[11px]">
                      {k.includes('secret') || k.includes('token') || k.includes('key') ? '••••••••••••' : String(v)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                  No explicit key-value parameters found for this remote.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-[var(--border-color)]">
              <button
                onClick={() => setViewingRemoteDetails(null)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📄 View Raw rclone.conf Modal */}
      {showRawConfigModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
              <div className="flex items-center gap-2">
                <File size={18} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold">rclone.conf File Inspector</h3>
                  <p className="text-[10px] font-mono text-indigo-400">{rcloneStatus?.configPath || 'Remote Config File'}</p>
                </div>
              </div>
              <button
                onClick={() => setShowRawConfigModal(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-black border border-indigo-500/20 font-mono text-[11px] text-emerald-400 max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {rcloneStatus?.configContent || '# Config file is empty or unreachable'}
            </pre>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowRawConfigModal(false)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Close File Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📁 Interactive Server & Cloud Path Picker Modal */}
      {pickerMode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
              <div className="flex items-center gap-2">
                <Folder size={20} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    Select {pickerMode === 'source' ? 'Source Directory (Server Filesystem)' : 'Destination Directory (Cloud Target)'}
                  </h3>
                  <p className="text-[10px] text-[var(--text-muted)]">Target Server: {selectedConn?.name}</p>
                </div>
              </div>
              <button
                onClick={() => setPickerMode(null)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Target Type Picker Selector */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => {
                  setPickerTargetType('local');
                  setPickerCurrentPath('/var/www');
                  fetchPickerItems('local', '/var/www');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  pickerTargetType === 'local'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)]'
                }`}
              >
                <Server size={13} /> Local Server (/var/www, /home, etc.)
              </button>

              {rcloneStatus?.remotes?.map(rem => {
                const remName = `${rem}:`;
                return (
                  <button
                    key={rem}
                    onClick={() => {
                      setPickerTargetType(remName);
                      setPickerCurrentPath('');
                      fetchPickerItems(remName, '');
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      pickerTargetType === remName
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)]'
                    }`}
                  >
                    <HardDrive size={13} /> {rem}:
                  </button>
                );
              })}
            </div>

            {/* Path Breadcrumb & Direct Jump */}
            <div className="flex items-center gap-2 bg-[var(--bg-tertiary)] p-2 rounded-xl border border-[var(--border-color)] text-xs font-mono">
              {/* Parent Directory Button */}
              <button
                onClick={() => {
                  let parent = '';
                  if (pickerTargetType === 'local') {
                    const parts = pickerCurrentPath.split('/').filter(Boolean);
                    parts.pop();
                    parent = parts.length > 0 ? `/${parts.join('/')}` : '/';
                  } else {
                    const parts = pickerCurrentPath.split('/').filter(Boolean);
                    parts.pop();
                    parent = parts.join('/');
                  }
                  setPickerCurrentPath(parent);
                  fetchPickerItems(pickerTargetType, parent);
                }}
                className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--border-color)] text-[var(--text-primary)] font-bold text-[11px] rounded-lg border border-[var(--border-color)] flex items-center gap-1 cursor-pointer shrink-0"
                title="Go to Parent Folder"
              >
                ⬆ Up
              </button>

              <span className="text-indigo-400 font-bold shrink-0">{pickerTargetType}</span>
              <input
                type="text"
                value={pickerCurrentPath}
                onChange={(e) => setPickerCurrentPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchPickerItems(pickerTargetType, pickerCurrentPath);
                }}
                className="flex-1 bg-transparent text-[var(--text-primary)] focus:outline-none"
                placeholder="Current folder path"
              />
              <button
                onClick={() => fetchPickerItems(pickerTargetType, pickerCurrentPath)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg cursor-pointer shrink-0"
              >
                Go
              </button>
            </div>

            {/* Folder & File List */}
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {pickerLoading ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-indigo-400" /> Scanning directory contents...
                </div>
              ) : pickerItems.length > 0 ? (
                pickerItems.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      if (item.IsDir) {
                        let newSub = '';
                        if (pickerTargetType === 'local') {
                          const base = pickerCurrentPath.replace(/\/+$/, '');
                          newSub = `${base}/${item.Name}`;
                        } else {
                          newSub = pickerCurrentPath
                            ? `${pickerCurrentPath.replace(/\/+$/, '')}/${item.Name}`
                            : item.Name;
                        }
                        setPickerCurrentPath(newSub);
                        fetchPickerItems(pickerTargetType, newSub);
                      }
                    }}
                    className={`p-2.5 rounded-xl border border-[var(--border-color)] flex items-center justify-between font-mono text-xs transition-colors ${
                      item.IsDir
                        ? 'bg-[var(--bg-tertiary)] hover:bg-indigo-500/10 hover:border-indigo-500/30 cursor-pointer'
                        : 'bg-black/20 text-[var(--text-muted)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      {item.IsDir ? (
                        <Folder size={16} className="text-amber-400 shrink-0" />
                      ) : (
                        <File size={16} className="text-indigo-400 shrink-0" />
                      )}
                      <span className={item.IsDir ? 'text-[var(--text-primary)] font-semibold' : ''}>
                        {item.Name}
                      </span>
                    </div>
                    {item.IsDir && (
                      <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded font-sans font-semibold">
                        Folder ↵
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                  Directory is empty or no subfolders found.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[var(--border-color)]">
              <span className="text-xs font-mono text-[var(--text-muted)] truncate max-w-sm">
                Selected: <strong className="text-indigo-400">{pickerTargetType}{pickerCurrentPath}</strong>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPickerMode(null)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={selectPickerFolder}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-600/20"
                >
                  ✓ Select This Directory
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
