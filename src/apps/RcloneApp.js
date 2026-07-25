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
  const [sourcePath, setSourcePath] = useState('/');
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
  const [editingCron, setEditingCron] = useState(null); // { rawLine, schedule, action, source, target, options }
  
  // Interactive Path Picker Modal State
  const [pickerMode, setPickerMode] = useState(null); // 'source' | 'target' | null
  const [pickerTargetType, setPickerTargetType] = useState('local'); // 'local' | 'gdrive:' etc.
  const [pickerCurrentPath, setPickerCurrentPath] = useState('/');
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

  const handleUpdateCron = async () => {
    if (!editingCron) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/rclone/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnId,
          oldRawLine: editingCron.rawLine,
          schedule: editingCron.schedule,
          action: editingCron.action || 'copy',
          source: editingCron.source,
          target: editingCron.target,
          options: editingCron.options || {},
        })
      });
      const data = await res.json();
      if (data?.success) {
        alert('✅ Server crontab task updated successfully!');
        setEditingCron(null);
        fetchCrons();
        fetchRcloneStatus();
      } else {
        alert(data?.error || 'Failed to update crontab task');
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
      const initialPath = sourcePath && sourcePath.startsWith('/') ? sourcePath : '/';
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
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden">

      {/* ── Top Bar ── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <CloudSync size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-bold leading-none">Rclone Cloud Sync</h1>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Manage backups & cloud transfers via SSH</p>
        </div>

        {/* Server Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <Server size={14} className="text-[var(--text-muted)] shrink-0" />
          <select
            value={selectedConnId}
            onChange={(e) => setSelectedConnId(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono max-w-[220px] cursor-pointer focus:border-indigo-500 focus:outline-none"
          >
            {connections?.map((c) => {
              const id = c.id || c._id;
              return (
                <option key={id} value={id}>
                  {c.name} ({c.host})
                </option>
              );
            })}
            {(!connections || connections.length === 0) && (
              <option disabled value="">No SSH connections found</option>
            )}
          </select>
          {selectedConn && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20 shrink-0 hidden sm:block">
              ● Connected
            </span>
          )}
        </div>

        <button
          onClick={fetchRcloneStatus}
          disabled={loading}
          className="p-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[var(--text-muted)] transition-colors shrink-0 cursor-pointer"
          title="Refresh Status"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="shrink-0 flex items-center gap-0 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/60">
        {[
          { id: 'setup',   icon: <Settings size={13} />,   label: 'Setup' },
          { id: 'remotes', icon: <HardDrive size={13} />,  label: `Remotes (${rcloneStatus?.remotes?.length || 0})` },
          { id: 'backup',  icon: <Play size={13} />,       label: 'Sync & Backup' },
          { id: 'browser', icon: <Eye size={13} />,        label: 'Cloud Explorer' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === 'browser') handleBrowseRemote(); }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ════════════════════ TAB 1: SETUP ════════════════════ */}
        {activeTab === 'setup' && (
          <div className="p-5 max-w-3xl space-y-4">

            {/* Status Card */}
            <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
              rcloneStatus?.installed
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-amber-500/5 border-amber-500/20'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${rcloneStatus?.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  {rcloneStatus?.installed ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    {rcloneStatus?.installed ? 'Rclone is Ready' : 'Rclone Not Installed'}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {rcloneStatus?.version || `Target: ${selectedConn?.name || 'No server selected'}`}
                  </p>
                  {rcloneStatus?.configPath && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <File size={11} className="text-indigo-400" />
                      <span className="text-[10px] font-mono text-indigo-400">{rcloneStatus.configPath}</span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={handleInstallRclone}
                disabled={isInstalling}
                className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
              >
                <Download size={13} />
                {isInstalling ? 'Installing...' : rcloneStatus?.installed ? 'Re-Install' : '1-Click Install'}
              </button>
            </div>

            {/* Active Running Jobs */}
            {rcloneStatus?.runningJobs && rcloneStatus.runningJobs.length > 0 && (
              <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <RefreshCw size={13} className="animate-spin" />
                  Active Rclone Processes ({rcloneStatus.runningJobs.length})
                </div>
                <div className="space-y-1.5">
                  {rcloneStatus.runningJobs.map((job, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl px-3 py-2 font-mono text-[11px] gap-3">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0">PID {job.pid}</span>
                        <span className="truncate text-[var(--text-primary)]">{job.cmd}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] shrink-0">
                        {job.cpu && <span>CPU {job.cpu}%</span>}
                        {job.mem && <span>RAM {job.mem}%</span>}
                        {job.etime && <span className="text-indigo-400">{job.etime}</span>}
                        <span className="text-emerald-400 font-bold">● LIVE</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Installation Terminal */}
            {(isInstalling || installLog) && (
              <div className="rounded-2xl bg-black border border-indigo-500/25 overflow-hidden">
                <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-semibold text-indigo-400">
                    <Terminal size={13} /> Installation Terminal — {selectedConn?.name}
                  </span>
                  {isInstalling
                    ? <span className="flex items-center gap-1.5 text-amber-400 animate-pulse font-mono text-[11px]"><RefreshCw size={11} className="animate-spin" /> RUNNING</span>
                    : <span className="text-emerald-400 font-mono text-[11px]">● DONE</span>
                  }
                </div>
                <pre ref={installTerminalRef} className="p-4 font-mono text-[11px] text-emerald-400 max-h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {installLog || 'Initializing...'}
                </pre>
              </div>
            )}

            {/* Feature Pills */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: <CloudSync size={18} />, color: 'text-indigo-400', label: '40+ Cloud Providers', desc: 'Google Drive, S3, R2, Dropbox, SFTP, WebDAV...' },
                { icon: <Zap size={18} />,       color: 'text-emerald-400', label: 'Parallel Transfers',  desc: 'Multi-threaded, checksum verified, resumable' },
                { icon: <Shield size={18} />,    color: 'text-amber-400',  label: 'Dry-Run Testing',     desc: 'Simulate operations safely before executing' },
              ].map((f, i) => (
                <div key={i} className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <div className={`mb-2 ${f.color}`}>{f.icon}</div>
                  <div className="text-xs font-bold mb-1">{f.label}</div>
                  <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════ TAB 2: REMOTES ════════════════════ */}
        {activeTab === 'remotes' && (
          <div className="p-5 max-w-4xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">Cloud Remotes</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Storage targets configured on {selectedConn?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {rcloneStatus?.configContent && (
                  <button
                    onClick={() => setShowRawConfigModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <File size={13} className="text-indigo-400" /> rclone.conf
                  </button>
                )}
                <button
                  onClick={() => setShowAddRemoteModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
                >
                  <Plus size={13} /> Add Remote
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rcloneStatus?.remotes?.map((remote) => {
                const details = rcloneStatus?.remoteDetails?.[remote] || {};
                return (
                  <div key={remote} className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-indigo-500/30 transition-colors group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                        <HardDrive size={18} />
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setViewingRemoteDetails({ name: remote, details })} className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer" title="Inspect Config"><Eye size={13} /></button>
                        <button onClick={() => { setTargetPath(`${remote}:backup`); setActiveTab('backup'); }} className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer" title="Use in Backup"><ArrowRight size={13} /></button>
                        <button onClick={() => handleDeleteRemote(remote)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer" title="Delete"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <h4 className="text-xs font-bold font-mono mb-1">{remote}:</h4>
                    <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase">{details.type || 'storage'}</span>
                    {details.scope && <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate">{details.scope}</p>}
                  </div>
                );
              })}
              {(!rcloneStatus?.remotes || rcloneStatus.remotes.length === 0) && (
                <div className="col-span-full p-10 text-center bg-[var(--bg-secondary)] border border-dashed border-[var(--border-color)] rounded-2xl">
                  <HardDrive size={28} className="text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
                  <p className="text-xs text-[var(--text-muted)]">No cloud remotes configured on {selectedConn?.name}.</p>
                  <button onClick={() => setShowAddRemoteModal(true)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer">
                    <Plus size={12} /> Add Your First Remote
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════ TAB 3: BACKUP ════════════════════ */}
        {activeTab === 'backup' && (
          <div className="p-5 max-w-3xl space-y-4">

            {/* ─ Row 1: Execution Mode + Action Type ─ */}
            <div className="grid grid-cols-2 gap-3">
              {/* Execution Mode */}
              <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Execution Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setExecMode('now')} className={`py-2 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${execMode === 'now' ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/20' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
                    <Zap size={12} /> Run Now
                  </button>
                  <button onClick={() => setExecMode('cron')} className={`py-2 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${execMode === 'cron' ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
                    <Terminal size={12} /> Schedule
                  </button>
                </div>
              </div>

              {/* Action Type */}
              <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Transfer Type</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'copy',  label: 'Copy',  sub: 'Add new' },
                    { id: 'sync',  label: 'Sync',  sub: 'Mirror' },
                    { id: 'move',  label: 'Move',  sub: '& Delete' },
                    { id: 'check', label: 'Check', sub: 'Verify' },
                  ].map((act) => (
                    <button key={act.id} onClick={() => setAction(act.id)} className={`py-2 text-center rounded-xl border transition-all cursor-pointer ${action === act.id ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-500/20' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
                      <div className="text-[11px] font-bold">{act.label}</div>
                      <div className="text-[9px] opacity-70">{act.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ─ Row 2: Source & Target Paths ─ */}
            <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
              <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Paths</label>

              <div className="grid grid-cols-1 gap-2.5">
                {/* Source */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                      <ArrowRight size={11} className="text-indigo-400" /> Source Path
                    </label>
                    <button onClick={() => openPathPicker('source')} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 rounded-lg border border-indigo-500/20 transition-colors">
                      <Folder size={11} /> Browse...
                    </button>
                  </div>
                  <input type="text" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="/var/www/html" className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
                </div>

                {/* Arrow divider */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                  <div className="p-1.5 rounded-full bg-indigo-600/20 border border-indigo-500/30">
                    <ArrowRight size={12} className="text-indigo-400" />
                  </div>
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                </div>

                {/* Target */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                      <HardDrive size={11} className="text-emerald-400" /> Destination Path
                    </label>
                    <button onClick={() => openPathPicker('target')} className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/20 transition-colors">
                      <HardDrive size={11} /> Browse Cloud...
                    </button>
                  </div>
                  <input type="text" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="gdrive:backup or s3remote:bucket/backups" className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>

              {/* Google Drive Folder URL */}
              <div className="pt-2 border-t border-[var(--border-color)]">
                <label className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 mb-1.5"><Link2 size={11} /> Google Drive: Paste folder URL or ID (optional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={driveFolderUrl}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setDriveFolderUrl(raw);
                      const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
                      setDriveFolderId(match ? match[1] : raw.trim());
                    }}
                    placeholder="https://drive.google.com/drive/folders/... or folder ID"
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                  />
                  <button onClick={() => { if (driveFolderId) setTargetPath('gdrive:'); }} disabled={!driveFolderId} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">Use</button>
                </div>
                {driveFolderId && (
                  <p className="text-[10px] font-mono text-emerald-400 mt-1">✓ Folder ID: <strong>{driveFolderId}</strong> — uses <code>--drive-root-folder-id</code></p>
                )}
              </div>
            </div>

            {/* ─ Row 3: Options ─ */}
            <div className="grid grid-cols-2 gap-3">
              {/* Timestamp Folders */}
              <div className={`p-3.5 rounded-2xl border space-y-2 ${useTimestampFolder ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-[var(--bg-secondary)] border-[var(--border-color)]'}`}>
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
                  <input type="checkbox" checked={useTimestampFolder} onChange={(e) => setUseTimestampFolder(e.target.checked)} className="rounded border-[var(--border-color)] text-indigo-600 focus:ring-0" />
                  <span>📅 Timestamped Folders</span>
                </label>
                {useTimestampFolder && (
                  <div className="space-y-1.5 pl-5">
                    <select value={timestampFormat} onChange={(e) => setTimestampFormat(e.target.value)} className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-indigo-400 font-mono">
                      <option value="YMD_MMM_HM">2026_Jul_25_22_05</option>
                      <option value="DMY_HM">25-07-2026_22-03</option>
                      <option value="YMD_HMS">2026-07-25_22-03-41</option>
                    </select>
                    <p className="text-[10px] text-indigo-300 font-mono">
                      → {targetPath || 'gdrive:'}/{timestampFormat === 'YMD_MMM_HM' ? '2026_Jul_25_22_05' : timestampFormat === 'DMY_HM' ? '25-07-2026_22-03' : '2026-07-25_22-03-41'}/
                    </p>
                  </div>
                )}
              </div>

              {/* Retention Policy */}
              <div className={`p-3.5 rounded-2xl border space-y-2 ${enableRetention ? 'bg-amber-500/5 border-amber-500/20' : 'bg-[var(--bg-secondary)] border-[var(--border-color)]'}`}>
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
                  <input type="checkbox" checked={enableRetention} onChange={(e) => setEnableRetention(e.target.checked)} className="rounded border-[var(--border-color)] text-amber-500 focus:ring-0" />
                  <span className="text-amber-400">🧹 Auto-Clean Old Backups</span>
                </label>
                {enableRetention && (
                  <div className="space-y-1.5 pl-5">
                    <select value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-amber-400 font-mono">
                      <option value="3">3 Days</option>
                      <option value="7">7 Days (Default)</option>
                      <option value="14">14 Days</option>
                      <option value="30">30 Days</option>
                      <option value="90">90 Days</option>
                    </select>
                    <p className="text-[10px] text-amber-300">Delete folders older than {retentionDays} days automatically</p>
                  </div>
                )}
              </div>
            </div>

            {/* ─ Row 4: Advanced + Cron Schedule ─ */}
            <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
              <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Advanced Options</label>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">Parallel Threads</label>
                  <input type="number" value={transfers} onChange={(e) => setTransfers(e.target.value)} className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">Speed Limit</label>
                  <input type="text" value={bwlimit} onChange={(e) => setBwlimit(e.target.value)} placeholder="e.g. 10M" className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
                    <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded border-[var(--border-color)] text-indigo-600 focus:ring-0" />
                    Dry Run
                  </label>
                </div>
              </div>

              {/* Cron Schedule (only in cron mode) */}
              {execMode === 'cron' && (
                <div className="pt-2 border-t border-[var(--border-color)] space-y-2">
                  <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide block">Crontab Schedule</label>
                  <select value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none">
                    <option value="0 0 * * *">Every Day at Midnight</option>
                    <option value="0 2 * * *">Every Day at 02:00 AM</option>
                    <option value="0 * * * *">Every Hour</option>
                    <option value="*/30 * * * *">Every 30 Minutes</option>
                    <option value="*/15 * * * *">Every 15 Minutes</option>
                    <option value="0 0 * * 0">Every Sunday at Midnight</option>
                    <option value="0 0 1 * *">1st Day of Every Month</option>
                    <option value="custom">Custom Expression...</option>
                  </select>
                  {cronSchedule === 'custom' && (
                    <input type="text" value={customCron} onChange={(e) => setCustomCron(e.target.value)} placeholder="e.g. 0 4 * * 1-5" className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                  )}
                </div>
              )}
            </div>

            {/* ─ Action Button ─ */}
            <div className="flex justify-end">
              {execMode === 'cron' ? (
                <button onClick={handleSaveCron} disabled={loading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-600/20 cursor-pointer">
                  {loading ? <RefreshCw size={13} className="animate-spin" /> : <Terminal size={13} />}
                  Add to Server Crontab
                </button>
              ) : (
                <button onClick={handleStartBackupJob} disabled={isJobRunning} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-xs transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer">
                  {isJobRunning ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  {isJobRunning ? 'Running...' : `Execute ${action.toUpperCase()}`}
                </button>
              )}
            </div>

            {/* ─ Execution Log Terminal ─ */}
            <div className="rounded-2xl bg-black border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-[var(--text-muted)]">
                  <Terminal size={12} /> Execution Log — {selectedConn?.name}
                </span>
                {isJobRunning && <span className="text-emerald-400 animate-pulse font-mono text-[10px]">● RUNNING</span>}
              </div>
              <pre ref={logTerminalRef} className="p-4 font-mono text-[11px] text-emerald-400 h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {jobLog || 'Run a backup task above to see live output here...'}
              </pre>
            </div>

            {/* ─ Active Crontab Tasks ─ */}
            <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
                <h4 className="text-xs font-bold flex items-center gap-2">
                  <Terminal size={13} className="text-indigo-400" />
                  Active Server Crontab Tasks
                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 text-[10px] font-mono">{serverCrons.length}</span>
                </h4>
                <button onClick={fetchCrons} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:underline cursor-pointer">
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>

              <div className="divide-y divide-[var(--border-color)]">
                {serverCrons.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                    No crontab tasks on {selectedConn?.name}. Switch to "Schedule" mode above and add one!
                  </div>
                ) : (
                  serverCrons.map((cron) => (
                    <div key={cron.id} className="group">
                      {/* Task Header */}
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[var(--bg-tertiary)] group-hover:bg-[var(--bg-tertiary)]/80">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-[10px] shrink-0">{cron.humanSchedule}</span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">{cron.schedule}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => navigator.clipboard.writeText(cron.raw)} className="p-1 text-[var(--text-muted)] hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer" title="Copy"><Copy size={12} /></button>
                          <button
                            onClick={() => {
                              const matches = cron.raw.match(/"([^"]+)"/g) || [];
                              const src = matches[0] ? matches[0].replace(/"/g, '') : '/var/www';
                              const tgt = matches[1] ? matches[1].replace(/"/g, '') : 'gdrive:';
                              const retMatch = cron.raw.match(/--min-age\s+(\d+)d/);
                              setEditingCron({
                                rawLine: cron.raw, schedule: cron.schedule,
                                action: cron.raw.includes(' sync ') ? 'sync' : 'copy',
                                source: src, target: tgt,
                                options: { useTimestampFolder: cron.raw.includes('$(date'), timestampFormat: cron.raw.includes('%b') ? 'YMD_MMM_HM' : 'YMD_HMS', enableRetention: !!retMatch, retentionDays: retMatch ? retMatch[1] : '7' }
                              });
                            }}
                            className="p-1 text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer" title="Edit"
                          >
                            <Settings size={12} />
                          </button>
                          <button onClick={() => handleDeleteCron(cron.raw)} className="p-1 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer" title="Delete"><Trash2 size={12} /></button>
                        </div>
                      </div>
                      {/* Code Block */}
                      <div className="bg-black/50 px-4 py-2.5 overflow-x-auto">
                        <pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                          <span className="text-amber-400 font-bold">{cron.schedule} </span>
                          {cron.raw.slice(cron.schedule.length + 1).split('; ').map((part, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-indigo-400 font-bold">; </span>}
                              {part.startsWith('export') ? (
                                <span><span className="text-emerald-400">export</span><span className="text-[var(--text-muted)]">{part.slice(6)}</span></span>
                              ) : part.startsWith('rclone') ? (
                                <span>
                                  <span className="text-cyan-400 font-bold">rclone</span>
                                  {part.slice(6).split(' ').map((tok, ti) =>
                                    tok.startsWith('--') ? <span key={ti} className="text-yellow-400"> {tok}</span>
                                    : (tok.startsWith('"') || tok.startsWith("'")) ? <span key={ti} className="text-emerald-300"> {tok}</span>
                                    : ['sync','copy','move','check','delete'].includes(tok) ? <span key={ti} className="text-purple-400 font-semibold"> {tok}</span>
                                    : <span key={ti} className="text-[var(--text-primary)]"> {tok}</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-[var(--text-muted)]">{part}</span>
                              )}
                            </span>
                          ))}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════ TAB 4: CLOUD EXPLORER ════════════════════ */}
        {activeTab === 'browser' && (
          <div className="p-5 max-w-4xl space-y-4">
            <div className="flex items-center gap-3">
              {/* Remote quick-select pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 shrink-0">
                {rcloneStatus?.remotes?.map(r => (
                  <button key={r} onClick={() => { setBrowseRemote(`${r}:`); setBrowsePath(''); handleBrowseRemote(`${r}:`, ''); }} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer shrink-0 border ${browseRemote.startsWith(r) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    {r}:
                  </button>
                ))}
              </div>
              <input type="text" value={browseRemote} onChange={(e) => setBrowseRemote(e.target.value)} placeholder="gdrive: or s3remote:mybucket" className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
              <button onClick={() => handleBrowseRemote()} disabled={browseLoading} className="shrink-0 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5">
                {browseLoading ? <RefreshCw size={12} className="animate-spin" /> : <Eye size={12} />} Browse
              </button>
            </div>

            <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] font-mono text-[11px] text-[var(--text-muted)] flex items-center gap-2">
                <HardDrive size={12} className="text-indigo-400" />
                {browseRemote ? `${browseRemote}${browsePath}` : 'Select a remote storage above'}
              </div>
              <div className="divide-y divide-[var(--border-color)] max-h-[420px] overflow-y-auto">
                {browseLoading ? (
                  <div className="p-10 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-indigo-400" /> Loading files...
                  </div>
                ) : remoteItems.length === 0 ? (
                  <div className="p-10 text-center text-xs text-[var(--text-muted)]">No files found or remote not selected.</div>
                ) : (
                  remoteItems.map((item, idx) => (
                    <div key={idx} className="px-4 py-2 flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors group">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {item.IsDir ? <Folder size={14} className="text-amber-400 shrink-0" /> : <File size={14} className="text-indigo-400 shrink-0" />}
                        <span className={`font-mono text-xs truncate ${item.IsDir ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>{item.Name || item.Path}</span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] shrink-0 ml-3">
                        {item.Size ? `${(item.Size / 1024 / 1024).toFixed(2)} MB` : item.IsDir ? 'DIR' : '—'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════ ADD REMOTE MODAL ════ */}
      {showAddRemoteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div>
                <h3 className="text-sm font-bold">Add Cloud Remote</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Target: {selectedConn?.name}</p>
              </div>
              <button onClick={() => setShowAddRemoteModal(false)} className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Remote Name</label>
                <input type="text" value={newRemoteName} onChange={(e) => setNewRemoteName(e.target.value)} placeholder="e.g. gdrive_backup" className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Storage Provider</label>
                <select value={newRemoteType} onChange={(e) => setNewRemoteType(e.target.value)} className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none">
                  <option value="s3">AWS S3 / Cloudflare R2 / MinIO / Wasabi / B2</option>
                  <option value="drive">Google Drive</option>
                  <option value="sftp">SFTP / SSH Server</option>
                  <option value="webdav">WebDAV / Nextcloud</option>
                </select>
              </div>

              {newRemoteType === 's3' && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                  <input type="text" placeholder="Access Key ID" onChange={(e) => setRemoteConfig({ ...remoteConfig, access_key_id: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                  <input type="password" placeholder="Secret Access Key" onChange={(e) => setRemoteConfig({ ...remoteConfig, secret_access_key: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                  <input type="text" placeholder="Endpoint URL (e.g. https://xxx.r2.cloudflarestorage.com)" onChange={(e) => setRemoteConfig({ ...remoteConfig, endpoint: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                </div>
              )}

              {newRemoteType === 'drive' && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                  <input type="text" placeholder="Client ID (xxxx.apps.googleusercontent.com)" value={remoteConfig.client_id || ''} onChange={(e) => setRemoteConfig({ ...remoteConfig, client_id: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                  <input type="password" placeholder="Client Secret" value={remoteConfig.client_secret || ''} onChange={(e) => setRemoteConfig({ ...remoteConfig, client_secret: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                  <input type="text" placeholder="Service Account File Path (optional)" value={remoteConfig.service_account_file || ''} onChange={(e) => setRemoteConfig({ ...remoteConfig, service_account_file: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                  <div>
                    <label className="text-[10px] font-semibold text-emerald-400 block mb-1">📂 Lock to Specific Drive Folder (Optional)</label>
                    <input type="text" placeholder="Paste Google Drive URL or Folder ID" value={remoteConfig._drive_url || ''} onChange={(e) => { const raw = e.target.value; const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/); setRemoteConfig({ ...remoteConfig, _drive_url: raw, root_folder_id: match ? match[1] : raw.trim() }); }} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                    {remoteConfig.root_folder_id && <p className="text-[10px] text-emerald-400 font-mono mt-1">✓ {remoteConfig.root_folder_id}</p>}
                  </div>
                  <select value={remoteConfig.scope || 'drive'} onChange={(e) => setRemoteConfig({ ...remoteConfig, scope: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none">
                    <option value="drive">Full Access (drive)</option>
                    <option value="drive.readonly">Read-Only (drive.readonly)</option>
                    <option value="drive.file">Application Data Only (drive.file)</option>
                  </select>
                </div>
              )}

              {newRemoteType === 'sftp' && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                  <input type="text" placeholder="Hostname / IP" onChange={(e) => setRemoteConfig({ ...remoteConfig, host: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                  <input type="text" placeholder="Username" onChange={(e) => setRemoteConfig({ ...remoteConfig, user: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setShowAddRemoteModal(false)} className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer">Cancel</button>
              <button onClick={handleSaveRemote} disabled={loading} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-500/20">
                {loading ? 'Saving...' : 'Save Remote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ REMOTE DETAILS MODAL ════ */}
      {viewingRemoteDetails && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400"><HardDrive size={16} /></div>
                <div>
                  <h3 className="text-sm font-bold font-mono">[{viewingRemoteDetails.name}]</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">Config on {selectedConn?.name}</p>
                </div>
              </div>
              <button onClick={() => setViewingRemoteDetails(null)} className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer">✕</button>
            </div>
            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-1">
                <div className="font-bold text-indigo-400 flex items-center gap-1.5"><Info size={13} /> Destination Syntax</div>
                <code className="text-emerald-400 bg-black/40 px-2 py-1 rounded font-mono text-[11px] block">{viewingRemoteDetails.name}:folder_name</code>
                {viewingRemoteDetails.details?.token && <p className="text-[10px] text-emerald-400">✓ Authenticated via OAuth Token</p>}
                {viewingRemoteDetails.details?.service_account_file && <p className="text-[10px] text-amber-400">🔑 Service Account: {viewingRemoteDetails.details.service_account_file}</p>}
              </div>
              {Object.entries(viewingRemoteDetails.details || {}).map(([k, v]) => (
                <div key={k} className="p-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] flex items-center justify-between font-mono text-xs gap-3">
                  <span className="text-indigo-400 font-semibold shrink-0">{k}</span>
                  <span className="text-[var(--text-primary)] truncate bg-black/30 px-2 py-0.5 rounded text-[11px]">
                    {k.includes('secret') || k.includes('token') || k.includes('key') ? '••••••••••••' : String(v)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end px-5 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setViewingRemoteDetails(null)} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ RCLONE.CONF MODAL ════ */}
      {showRawConfigModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <File size={16} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold">rclone.conf</h3>
                  <p className="text-[10px] font-mono text-indigo-400">{rcloneStatus?.configPath}</p>
                </div>
              </div>
              <button onClick={() => setShowRawConfigModal(false)} className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer">✕</button>
            </div>
            <pre className="p-5 font-mono text-[11px] text-emerald-400 bg-black max-h-[60vh] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {rcloneStatus?.configContent || '# Config file is empty or unreachable'}
            </pre>
            <div className="flex justify-end px-5 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setShowRawConfigModal(false)} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ PATH PICKER MODAL ════ */}
      {pickerMode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Folder size={16} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    {pickerMode === 'source' ? 'Select Source Directory' : 'Select Destination Directory'}
                  </h3>
                  <p className="text-[10px] text-[var(--text-muted)]">{selectedConn?.name}</p>
                </div>
              </div>
              <button onClick={() => setPickerMode(null)} className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer">✕</button>
            </div>

            <div className="p-4 space-y-3">
              {/* Source type buttons */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => { setPickerTargetType('local'); setPickerCurrentPath('/'); fetchPickerItems('local', '/'); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${pickerTargetType === 'local' ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-color)]'}`}
                >
                  <Server size={12} /> Local Server
                </button>
                {rcloneStatus?.remotes?.map(rem => (
                  <button key={rem} onClick={() => { setPickerTargetType(`${rem}:`); setPickerCurrentPath(''); fetchPickerItems(`${rem}:`, ''); }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${pickerTargetType === `${rem}:` ? 'bg-emerald-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-color)]'}`}
                  >
                    <HardDrive size={12} /> {rem}:
                  </button>
                ))}
              </div>

              {/* Path nav bar */}
              <div className="flex items-center gap-2 bg-[var(--bg-tertiary)] p-2 rounded-xl border border-[var(--border-color)] text-xs font-mono">
                <button onClick={() => { let p = ''; if (pickerTargetType === 'local') { const parts = pickerCurrentPath.split('/').filter(Boolean); parts.pop(); p = parts.length > 0 ? `/${parts.join('/')}` : '/'; } else { const parts = pickerCurrentPath.split('/').filter(Boolean); parts.pop(); p = parts.join('/'); } setPickerCurrentPath(p); fetchPickerItems(pickerTargetType, p); }} className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--border-color)] rounded-lg border border-[var(--border-color)] flex items-center gap-1 cursor-pointer shrink-0 text-[11px]">⬆ Up</button>
                <span className="text-indigo-400 font-bold shrink-0">{pickerTargetType}</span>
                <input type="text" value={pickerCurrentPath} onChange={(e) => setPickerCurrentPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fetchPickerItems(pickerTargetType, pickerCurrentPath); }} className="flex-1 bg-transparent text-[var(--text-primary)] focus:outline-none" placeholder="Path..." />
                <button onClick={() => fetchPickerItems(pickerTargetType, pickerCurrentPath)} className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg cursor-pointer shrink-0">Go</button>
              </div>

              {/* File list */}
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {pickerLoading ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2"><RefreshCw size={13} className="animate-spin text-indigo-400" /> Scanning...</div>
                ) : pickerItems.length > 0 ? (
                  pickerItems.map((item, idx) => (
                    <div key={idx} onClick={() => { if (item.IsDir) { let s = pickerTargetType === 'local' ? `${pickerCurrentPath.replace(/\/+$/, '')}/${item.Name}` : pickerCurrentPath ? `${pickerCurrentPath.replace(/\/+$/, '')}/${item.Name}` : item.Name; setPickerCurrentPath(s); fetchPickerItems(pickerTargetType, s); } }}
                      className={`p-2.5 rounded-xl border border-[var(--border-color)] flex items-center justify-between font-mono text-xs transition-colors ${item.IsDir ? 'bg-[var(--bg-tertiary)] hover:bg-indigo-500/10 hover:border-indigo-500/30 cursor-pointer' : 'bg-black/20 text-[var(--text-muted)]'}`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        {item.IsDir ? <Folder size={14} className="text-amber-400 shrink-0" /> : <File size={14} className="text-indigo-400 shrink-0" />}
                        <span className={item.IsDir ? 'text-[var(--text-primary)] font-semibold' : ''}>{item.Name}</span>
                      </div>
                      {item.IsDir && <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded shrink-0">Enter ↵</span>}
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)]">Directory is empty.</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border-color)]">
              <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-xs">
                → <strong className="text-indigo-400">{pickerTargetType}{pickerCurrentPath}</strong>
              </span>
              <div className="flex gap-2">
                <button onClick={() => setPickerMode(null)} className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer">Cancel</button>
                <button onClick={selectPickerFolder} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-600/20">✓ Select</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ EDIT CRONTAB MODAL ════ */}
      {editingCron && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold">Edit Crontab Task</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">{selectedConn?.name}</p>
                </div>
              </div>
              <button onClick={() => setEditingCron(null)} className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Schedule Preset</label>
                <select value={['0 0 * * *','0 2 * * *','0 * * * *','*/30 * * * *','*/15 * * * *','0 0 * * 0','0 0 1 * *'].includes(editingCron.schedule) ? editingCron.schedule : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setEditingCron({ ...editingCron, schedule: e.target.value }); }} className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none">
                  <option value="0 0 * * *">Every Day at Midnight</option>
                  <option value="0 2 * * *">Every Day at 02:00 AM</option>
                  <option value="0 * * * *">Every Hour</option>
                  <option value="*/30 * * * *">Every 30 Minutes</option>
                  <option value="*/15 * * * *">Every 15 Minutes</option>
                  <option value="0 0 * * 0">Every Sunday at Midnight</option>
                  <option value="0 0 1 * *">1st of Every Month</option>
                  <option value="custom">Custom...</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Cron Expression</label>
                <input type="text" value={editingCron.schedule} onChange={(e) => setEditingCron({ ...editingCron, schedule: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Source Path</label>
                  <input type="text" value={editingCron.source} onChange={(e) => setEditingCron({ ...editingCron, source: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Destination</label>
                  <input type="text" value={editingCron.target} onChange={(e) => setEditingCron({ ...editingCron, target: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-400 cursor-pointer select-none">
                  <input type="checkbox" checked={editingCron.options?.enableRetention ?? true} onChange={(e) => setEditingCron({ ...editingCron, options: { ...editingCron.options, enableRetention: e.target.checked } })} className="rounded border-[var(--border-color)] text-amber-500 focus:ring-0" />
                  🧹 Auto Retention Cleanup
                </label>
                {editingCron.options?.enableRetention && (
                  <div className="flex items-center gap-2 pl-5">
                    <span className="text-[11px] text-[var(--text-muted)]">Delete older than:</span>
                    <select value={editingCron.options?.retentionDays || '7'} onChange={(e) => setEditingCron({ ...editingCron, options: { ...editingCron.options, retentionDays: e.target.value } })} className="px-2.5 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-amber-400 font-mono focus:outline-none">
                      <option value="3">3 Days</option>
                      <option value="7">7 Days</option>
                      <option value="14">14 Days</option>
                      <option value="30">30 Days</option>
                      <option value="90">90 Days</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setEditingCron(null)} className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer">Cancel</button>
              <button onClick={handleUpdateCron} disabled={loading} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center gap-1.5">
                {loading ? <RefreshCw size={13} className="animate-spin" /> : '✓ Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
