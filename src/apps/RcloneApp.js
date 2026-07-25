'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  CloudSync, HardDrive, RefreshCw, Terminal, CheckCircle2, AlertTriangle,
  Plus, Trash2, Folder, File, Play, Shield, Settings, Server, Database,
  ArrowRight, Download, Eye, ExternalLink, Cpu, Info, Check, ShieldCheck,
  Zap, Copy, ArrowLeftRight, Monitor, ChevronRight
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
  
  // Remote Builder Modal State
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);
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
          if (res?.success && Array.isArray(res.connections)) list = res.connections;
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

  // Fetch Rclone status whenever selected connection changes
  useEffect(() => {
    if (selectedConnId && vaultStatus === 'unlocked') {
      fetchRcloneStatus();
    }
  }, [selectedConnId, vaultStatus]);

  // Auto-scroll log terminal
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [jobLog]);

  // Poll active job status
  useEffect(() => {
    let interval = null;
    if (activeJob && isJobRunning) {
      interval = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/rclone/exec?connectionId=${selectedConnId}&logFile=${encodeURIComponent(activeJob.logFile)}&pid=${activeJob.pid || ''}`);
          if (res?.success) {
            setJobLog(res.log || '');
            setIsJobRunning(res.running);
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
      if (res?.success) {
        setRcloneStatus(res);
        if (res.remotes && res.remotes.length > 0 && !targetPath) {
          setTargetPath(`${res.remotes[0]}:backup`);
          setBrowseRemote(`${res.remotes[0]}:`);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleInstallRclone = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/rclone/install', {
        method: 'POST',
        body: JSON.stringify({ connectionId: selectedConnId })
      });
      if (res?.success) {
        fetchRcloneStatus();
      } else {
        alert(res?.error || 'Failed to install Rclone');
      }
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
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
        body: JSON.stringify({
          connectionId: selectedConnId,
          name: newRemoteName,
          type: newRemoteType,
          config: remoteConfig,
        })
      });
      if (res?.success) {
        setShowAddRemoteModal(false);
        setNewRemoteName('');
        setRemoteConfig({});
        fetchRcloneStatus();
      } else {
        alert(res?.error || 'Failed to add remote');
      }
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  };

  const handleDeleteRemote = async (name) => {
    if (!confirm(`Delete remote "${name}" from rclone config?`)) return;
    try {
      const res = await apiFetch(`/api/rclone/remote?connectionId=${selectedConnId}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res?.success) {
        fetchRcloneStatus();
      } else {
        alert(res?.error || 'Failed to delete remote');
      }
    } catch (err) {
      alert(err.message);
    }
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
        body: JSON.stringify({
          connectionId: selectedConnId,
          action,
          source: sourcePath,
          target: targetPath,
          options: {
            dryRun,
            bwlimit,
            transfers,
          }
        })
      });
      if (res?.success) {
        setActiveJob(res);
      } else {
        setIsJobRunning(false);
        alert(res?.error || 'Failed to start Rclone job');
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
      if (res?.success) {
        setRemoteItems(res.items || []);
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

                {!rcloneStatus?.installed && (
                  <button
                    onClick={handleInstallRclone}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
                  >
                    <Download size={14} /> 1-Click Initialize Rclone
                  </button>
                )}
              </div>

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
              <button
                onClick={() => setShowAddRemoteModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20"
              >
                <Plus size={14} /> Add Cloud Remote
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rcloneStatus?.remotes?.map((remote) => (
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
                      <p className="text-[10px] text-[var(--text-muted)]">Remote storage target</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setTargetPath(`${remote}:backup`); setActiveTab('backup'); }}
                      className="p-2 text-xs text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-colors"
                      title="Use in Backup"
                    >
                      <ArrowRight size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteRemote(remote)}
                      className="p-2 text-xs text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                      title="Delete Remote"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}

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
                <h3 className="text-sm font-bold mb-2">Configure Backup Action for {selectedConn?.name}</h3>

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
                        className={`py-2 px-1 text-center rounded-xl border transition-all ${
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
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Source Path (Local or Remote):</label>
                  <input
                    type="text"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="/var/www/html or gdrive:source"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">Destination Target Path:</label>
                  <input
                    type="text"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    placeholder="s3_remote:bucket/backups"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>

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
                    Dry Run (Test Simulation)
                  </label>

                  <button
                    onClick={handleStartBackupJob}
                    disabled={isJobRunning}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-lg shadow-emerald-600/20"
                  >
                    <Play size={14} /> Execute Rclone {action.toUpperCase()}
                  </button>
                </div>
              </div>

              {/* Terminal Log Output */}
              <div className="flex flex-col rounded-2xl bg-black border border-[var(--border-color)] overflow-hidden h-[380px]">
                <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
                  <span className="flex items-center gap-2">
                    <Terminal size={14} /> Live Rclone Terminal Logs ({selectedConn?.name})
                  </span>
                  {isJobRunning && <span className="text-emerald-400 animate-pulse font-mono">● RUNNING</span>}
                </div>
                <pre
                  ref={logTerminalRef}
                  className="flex-1 p-4 font-mono text-[11px] text-emerald-400 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                >
                  {jobLog || 'Select source and destination, then click Execute Rclone.'}
                </pre>
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
                className="px-4 py-2 rounded-xl bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRemote}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
              >
                Save Remote Target
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
