'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { 
  Database, Upload, Cloud, RefreshCw, Play, Trash2, Plus, 
  CheckCircle, AlertCircle, Calendar, ShieldAlert, ArrowRight,
  FolderPlus, History, Key, Settings, Loader, CloudLightning, FileJson
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MongoBackupApp() {
  const { state, apiFetch } = useApp();
  const { addNotification } = useOS();
  const { connections } = state;

  const [activeTab, setActiveTab] = useState('import');
  const [loading, setLoading] = useState(false);

  // Connection selector (only MongoDB connections)
  const dbConnections = [{ _id: 'default', name: 'System Database (Default)', dbProvider: 'mongodb' }, ...connections.filter(c => c.type === 'database' && c.dbProvider === 'mongodb')];

  // ── Import Collection State ──────────────────────────────────────────────
  const [importConnId, setImportConnId] = useState('default');
  const [importDbName, setImportDbName] = useState('monitor');
  const [importCollName, setImportCollName] = useState('');
  const [importMode, setImportMode] = useState('insert'); // insert, upsert
  const [importFile, setImportFile] = useState(null);
  const [importFileData, setImportFileData] = useState(null);
  const [importLogs, setImportLogs] = useState([]);
  const fileInputRef = useRef(null);

  // ── Google Drive Link State ──────────────────────────────────────────────
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEmail, setDriveEmail] = useState('');
  const [driveName, setDriveName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [driveFolders, setDriveFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);

  // ── Sync Jobs State ─────────────────────────────────────────────
  const [jobs, setJobs] = useState([]);
  const [jobName, setJobName] = useState('');
  const [jobConnId, setJobConnId] = useState('default');
  const [jobDbName, setJobDbName] = useState('monitor');
  const [jobCollName, setJobCollName] = useState('');
  const [jobFolderId, setJobFolderId] = useState('');
  const [jobSchedule, setJobSchedule] = useState('daily'); // manual, hourly, daily, weekly
  const [jobEnabled, setJobEnabled] = useState(true);
  const [editingJobId, setEditingJobId] = useState(null);

  // ── Restore State ───────────────────────────────────────────────
  const [restoreFolderId, setRestoreFolderId] = useState('');
  const [backupFiles, setBackupFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [restoreConnId, setRestoreConnId] = useState('default');
  const [restoreDbName, setRestoreDbName] = useState('monitor');
  const [restoreCollName, setRestoreCollName] = useState('');
  const [restoreMode, setRestoreMode] = useState('insert');

  // Load configuration and data
  useEffect(() => {
    fetchGDriveStatus();
    fetchJobs();
  }, []);

  const fetchGDriveStatus = async () => {
    try {
      const res = await apiFetch('/api/mongo-sync/gdrive/status');
      const data = await res.json();
      if (data.success) {
        setDriveConnected(data.connected);
        setDriveEmail(data.email || '');
        setDriveName(data.name || '');
        setClientId(data.clientId || '');
        setDriveFolders(data.folders || []);
        if (data.folders.length > 0) {
          setJobFolderId(data.folders[0].id);
          setRestoreFolderId(data.folders[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch Google Drive status:', err);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await apiFetch('/api/mongo-sync/jobs');
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch backup jobs:', err);
    }
  };

  // ── Import Logic ──────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (Array.isArray(parsed)) {
          setImportFileData(parsed);
          setImportLogs([`Parsed JSON file successfully. Found ${parsed.length} documents.`]);
          // Guess collection name from filename
          const nameWithoutExt = file.name.split('.')[0];
          setImportCollName(nameWithoutExt);
        } else {
          setImportLogs(['Error: JSON file must contain a top-level array of documents.']);
          setImportFileData(null);
        }
      } catch (err) {
        setImportLogs(['Error: Invalid JSON format.']);
        setImportFileData(null);
      }
    };
    reader.readAsText(file);
  };

  const executeImport = async () => {
    if (!importFileData || !importCollName.trim()) return;
    setLoading(true);
    setImportLogs(prev => [...prev, 'Starting import...']);
    try {
      const res = await apiFetch('/api/mongo-sync/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: importConnId,
          database: importDbName,
          collection: importCollName.trim(),
          documents: importFileData,
          mode: importMode
        })
      });
      const data = await res.json();
      if (data.success) {
        setImportLogs(prev => [
          ...prev,
          `✅ Import finished!`,
          `Documents imported: ${data.insertedCount}`,
          `Documents updated: ${data.updatedCount}`,
          `Total docs in file: ${data.totalCount}`
        ]);
        addNotification({
          title: 'Import Successful',
          message: `Imported ${data.insertedCount} docs to ${importCollName}`,
          type: 'success'
        });
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      setImportLogs(prev => [...prev, `❌ Import failed: ${err.message}`]);
      addNotification({ title: 'Import Failed', message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // ── Google Drive Setup Logic ──────────────────────────────────────────────
  const handleSaveCredentials = async () => {
    setDriveLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/gdrive/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Config Saved', message: 'Google OAuth Client Credentials updated.', type: 'success' });
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      addNotification({ title: 'Error Saving Config', message: err.message, type: 'error' });
    } finally {
      setDriveLoading(false);
    }
  };

  const handleLinkDrive = () => {
    const width = 600;
    const height = 650;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const win = window.open(
      '/api/mongo-sync/gdrive/auth',
      'LinkGoogleDrive',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );

    const checkClosed = setInterval(() => {
      if (!win || win.closed) {
        clearInterval(checkClosed);
        fetchGDriveStatus();
      }
    }, 1000);
  };

  const handleDisconnectDrive = async () => {
    if (!confirm('Are you sure you want to disconnect Google Drive? This will revoke active sync configurations.')) return;
    setDriveLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/gdrive/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disconnect: true })
      });
      const data = await res.json();
      if (data.success) {
        setDriveConnected(false);
        setDriveEmail('');
        setDriveName('');
        addNotification({ title: 'Disconnected', message: 'Google Drive unlinked successfully.', type: 'info' });
        fetchGDriveStatus();
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setDriveLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setDriveLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/gdrive/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: newFolderName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewFolderName('');
        addNotification({ title: 'Folder Created', message: `Folder "${data.folderName}" created in Drive.`, type: 'success' });
        fetchGDriveStatus();
      }
    } catch (err) {
      addNotification({ title: 'Folder Create Failed', message: err.message, type: 'error' });
    } finally {
      setDriveLoading(false);
    }
  };

  // ── Sync Jobs Logic ────────────────────────────────────────────────────────
  const handleSaveJob = async (e) => {
    e.preventDefault();
    if (!jobName.trim() || !jobDbName.trim() || !jobCollName.trim() || !jobFolderId) return;

    const targetConn = dbConnections.find(c => c._id === jobConnId);
    setLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingJobId,
          name: jobName.trim(),
          connectionId: jobConnId,
          connectionName: targetConn?.name || 'Local Database',
          database: jobDbName.trim(),
          collection: jobCollName.trim(),
          driveFolderId: jobFolderId,
          driveFolderName: driveFolders.find(f => f.id === jobFolderId)?.name || 'Default Folder',
          schedule: jobSchedule,
          enabled: jobEnabled
        })
      });
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
        resetJobForm();
        addNotification({
          title: editingJobId ? 'Job Updated' : 'Job Created',
          message: `Job saved successfully.`,
          type: 'success'
        });
      }
    } catch (err) {
      addNotification({ title: 'Save Job Failed', message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const resetJobForm = () => {
    setJobName('');
    setJobConnId('default');
    setJobDbName('monitor');
    setJobCollName('');
    setJobSchedule('daily');
    setJobEnabled(true);
    setEditingJobId(null);
  };

  const handleEditJob = (job) => {
    setEditingJobId(job.id);
    setJobName(job.name);
    setJobConnId(job.connectionId);
    setJobDbName(job.database);
    setJobCollName(job.collection);
    setJobFolderId(job.driveFolderId);
    setJobSchedule(job.schedule);
    setJobEnabled(job.enabled);
  };

  const handleDeleteJob = async (id) => {
    if (!confirm('Are you sure you want to delete this sync job?')) return;
    try {
      const res = await apiFetch(`/api/mongo-sync/jobs?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
        addNotification({ title: 'Job Deleted', message: 'Sync job removed successfully.', type: 'info' });
      }
    } catch (err) {
      addNotification({ title: 'Delete Failed', message: err.message, type: 'error' });
    }
  };

  const handleRunJob = async (id) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/mongo-sync/jobs/${id}/run`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Backup Successful', message: data.message, type: 'success' });
        fetchJobs();
      } else {
        throw new Error(data.message);
      }
    } catch (err) {
      addNotification({ title: 'Backup Failed', message: err.message, type: 'error' });
      fetchJobs();
    } finally {
      setLoading(false);
    }
  };

  // ── Restore Logic ──────────────────────────────────────────────────────────
  const fetchBackups = async (folderId) => {
    if (!folderId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/mongo-sync/restore?driveFolderId=${folderId}`);
      const data = await res.json();
      if (data.success) {
        setBackupFiles(data.files);
        if (data.files.length > 0) {
          setSelectedFileId(data.files[0].id);
          // Try to autofill DB/Coll name from filename (e.g. backup_dbname_collname_timestamp.json)
          const fname = data.files[0].name;
          const parts = fname.split('_');
          if (parts.length >= 3) {
            setRestoreDbName(parts[1]);
            setRestoreCollName(parts[2]);
          }
        } else {
          setSelectedFileId('');
        }
      }
    } catch (err) {
      console.error('Failed to load backup files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (restoreFolderId) {
      fetchBackups(restoreFolderId);
    } else {
      setBackupFiles([]);
      setSelectedFileId('');
    }
  }, [restoreFolderId]);

  const handleBackupFileSelect = (fileId) => {
    setSelectedFileId(fileId);
    const file = backupFiles.find(f => f.id === fileId);
    if (!file) return;
    const parts = file.name.split('_');
    if (parts.length >= 3) {
      setRestoreDbName(parts[1]);
      setRestoreCollName(parts[2]);
    }
  };

  const executeRestore = async () => {
    if (!selectedFileId || !restoreDbName.trim() || !restoreCollName.trim()) return;
    if (!confirm(`Are you sure you want to restore data from Google Drive into target collection "${restoreCollName}"? This will run in ${restoreMode} mode.`)) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          connectionId: restoreConnId,
          database: restoreDbName.trim(),
          collection: restoreCollName.trim(),
          mode: restoreMode
        })
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Restore Complete', message: data.message, type: 'success' });
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      addNotification({ title: 'Restore Failed', message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-transparent text-[var(--text-primary)] border-[var(--border-color)] overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <div className="w-56 border-r border-[var(--border-color)] p-4 flex flex-col shrink-0 h-full bg-[var(--bg-secondary)]/30">
        <div className="flex items-center gap-2 mb-6 px-1">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-inner">
            <Database size={16} className="text-emerald-400" />
          </div>
          <span className="font-extrabold text-sm tracking-tight italic uppercase">Mongo Sync</span>
        </div>

        <nav className="flex-1 space-y-1.5">
          <button
            onClick={() => setActiveTab('import')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'import' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Upload size={14} />
            <span>Import JSON</span>
          </button>
          <button
            onClick={() => setActiveTab('gdrive')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all relative ${
              activeTab === 'gdrive' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Cloud size={14} />
            <span>Google Drive</span>
            {driveConnected && (
              <span className="absolute right-3 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'jobs' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <RefreshCw size={14} />
            <span>Sync Jobs</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('restore');
              if (restoreFolderId) fetchBackups(restoreFolderId);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'restore' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <History size={14} />
            <span>Restore Backup</span>
          </button>
        </nav>

        {/* Status display footer */}
        <div className="p-3 bg-[var(--bg-tertiary)]/20 rounded-xl border border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-2 h-2 rounded-full ${driveConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Cloud Sync</span>
          </div>
          <span className="text-[9px] text-[var(--text-muted)] block truncate max-w-full font-mono">
            {driveConnected ? driveEmail : 'Not Connected'}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'import' && (
              <motion.div
                key="import"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                    <Upload className="text-emerald-500" /> Import MongoDB Collection
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">Upload a JSON file containing a MongoDB collection array to auto-import into your database.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Configuration Form */}
                  <div className="lg:col-span-2 space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Connection</label>
                        <select
                          value={importConnId}
                          onChange={(e) => setImportConnId(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                        >
                          {dbConnections.map(c => (
                            <option key={c._id} value={c._id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Database</label>
                        <input
                          type="text"
                          value={importDbName}
                          onChange={(e) => setImportDbName(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="e.g. monitor"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Collection Name</label>
                        <input
                          type="text"
                          value={importCollName}
                          onChange={(e) => setImportCollName(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="e.g. connections"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Import Mode</label>
                        <select
                          value={importMode}
                          onChange={(e) => setImportMode(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                        >
                          <option value="insert">Insert (Fail on duplicate ID)</option>
                          <option value="upsert">Upsert (Overwrite matching ID)</option>
                        </select>
                      </div>
                    </div>

                    {/* Drag and Drop Zone */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Backup JSON File</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-[var(--border-color)] hover:border-emerald-500/40 bg-[var(--bg-tertiary)]/20 hover:bg-emerald-500/5 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".json"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                        <Upload className="text-[var(--text-muted)] group-hover:text-emerald-400 transition-colors" size={28} />
                        <span className="text-xs font-bold">{importFile ? importFile.name : 'Select or drag JSON collection file'}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : 'Must contain a top-level array of documents'}</span>
                      </div>
                    </div>

                    <button
                      onClick={executeImport}
                      disabled={loading || !importFileData || !importCollName.trim()}
                      className="w-full btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
                    >
                      {loading ? (
                        <>
                          <Loader size={14} className="animate-spin" />
                          <span>Importing documents...</span>
                        </>
                      ) : (
                        <>
                          <Play size={14} />
                          <span>Import Collection</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Log Output Panel */}
                  <div className="flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden min-h-[300px]">
                    <div className="bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Import Console</span>
                      <button 
                        onClick={() => setImportLogs([])} 
                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex-1 p-4 font-mono text-[10px] bg-slate-950/40 text-slate-300 space-y-1 overflow-y-auto custom-scrollbar">
                      {importLogs.map((log, i) => (
                        <div key={i} className="leading-relaxed whitespace-pre-wrap">{log}</div>
                      ))}
                      {importLogs.length === 0 && (
                        <div className="text-slate-600 italic">No logs. Upload a file and click Import to begin.</div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'gdrive' && (
              <motion.div
                key="gdrive"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                    <Cloud className="text-emerald-500" /> Google Drive Linkage
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">Configure and authenticate your Google OAuth application to upload backups securely to your Google Drive.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Auth Setup */}
                  <div className="space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <Key className="text-emerald-400" size={16} /> 1. OAuth API Configuration
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      By default, this app will use credentials defined in the server's `.env` configuration file. If you need to set up custom OAuth client details, you can override them here:
                    </p>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Google OAuth Client ID</label>
                        <input
                          type="text"
                          value={clientId}
                          onChange={(e) => setClientId(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Google OAuth Client Secret</label>
                        <input
                          type="password"
                          value={clientSecret}
                          onChange={(e) => setClientSecret(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="••••••••••••••••••••••••••••••••"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handleSaveCredentials}
                        disabled={driveLoading}
                        className="btn-primary text-xs font-bold py-1.5 px-4"
                      >
                        {driveLoading ? <Loader className="animate-spin" size={12} /> : 'Save API Config'}
                      </button>
                    </div>

                    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
                      <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
                        <CloudLightning className="text-emerald-400" size={16} /> 2. Account Linkage
                      </h3>
                      {driveConnected ? (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-3">
                          <div className="flex items-center gap-3">
                            <CheckCircle className="text-emerald-400" size={20} />
                            <div>
                              <div className="text-xs font-bold text-emerald-400">Connected to Google Drive</div>
                              <div className="text-[10px] text-[var(--text-muted)]">{driveEmail} ({driveName})</div>
                            </div>
                          </div>
                          <button
                            onClick={handleDisconnectDrive}
                            className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider block"
                          >
                            Unlink Account
                          </button>
                        </div>
                      ) : (
                        <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl space-y-3">
                          <div className="flex items-center gap-3">
                            <ShieldAlert className="text-amber-400" size={20} />
                            <div>
                              <div className="text-xs font-bold text-amber-400">Account Not Connected</div>
                              <div className="text-[10px] text-[var(--text-muted)]">Authorize this app to access a dedicated folder on your Google Drive.</div>
                            </div>
                          </div>
                          <button
                            onClick={handleLinkDrive}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2"
                          >
                            <Cloud size={14} /> Link Google Drive
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Folders Management */}
                  <div className="space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)] flex flex-col">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <FolderPlus className="text-emerald-400" size={16} /> 3. Dedicated Sync Folders
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      Select or create a dedicated folder in your Google Drive where automated JSON backups will be uploaded.
                    </p>

                    <div className="flex-1 space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          className="input-field text-xs flex-1 bg-[var(--bg-tertiary)]"
                          placeholder="New folder name..."
                          disabled={!driveConnected || driveLoading}
                        />
                        <button
                          onClick={handleCreateFolder}
                          disabled={!driveConnected || driveLoading || !newFolderName.trim()}
                          className="btn-primary text-xs font-bold py-1.5 px-4 disabled:opacity-40"
                        >
                          {driveLoading ? <Loader className="animate-spin" size={12} /> : 'Create'}
                        </button>
                      </div>

                      <div className="border border-[var(--border-color)] rounded-xl overflow-hidden flex-1 min-h-[160px] max-h-[200px] flex flex-col bg-[var(--bg-tertiary)]/20">
                        <div className="bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Accessible Folders ({driveFolders.length})
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                          {driveFolders.map(folder => (
                            <div key={folder.id} className="flex items-center justify-between p-2 hover:bg-[var(--bg-card-hover)] rounded-lg text-xs">
                              <span className="font-bold truncate">{folder.name}</span>
                              <span className="font-mono text-[9px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-color)]">{folder.id}</span>
                            </div>
                          ))}
                          {driveFolders.length === 0 && (
                            <div className="text-center py-8 text-[11px] text-[var(--text-muted)] italic">
                              {driveConnected ? 'No sync folders created yet.' : 'Please connect Google Drive to list folders.'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'jobs' && (
              <motion.div
                key="jobs"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                    <RefreshCw className="text-emerald-500" /> Sync Jobs Scheduler
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">Configure automated sync jobs to backup MongoDB collections directly to your linked Google Drive folder.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Job Form */}
                  <form onSubmit={handleSaveJob} className="space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                    <h3 className="text-sm font-bold flex items-center gap-2 border-b border-[var(--border-color)] pb-2">
                      <Plus className="text-emerald-400" size={16} /> 
                      {editingJobId ? 'Edit Sync Job' : 'Create Sync Job'}
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Job Name</label>
                        <input
                          type="text"
                          value={jobName}
                          onChange={(e) => setJobName(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="e.g. Connections Daily Backup"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Source Conn</label>
                          <select
                            value={jobConnId}
                            onChange={(e) => setJobConnId(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          >
                            {dbConnections.map(c => (
                              <option key={c._id} value={c._id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Database</label>
                          <input
                            type="text"
                            value={jobDbName}
                            onChange={(e) => setJobDbName(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Collection</label>
                          <input
                            type="text"
                            value={jobCollName}
                            onChange={(e) => setJobCollName(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                            placeholder="e.g. connections"
                            required
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Drive Folder</label>
                          <select
                            value={jobFolderId}
                            onChange={(e) => setJobFolderId(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                            required
                          >
                            {driveFolders.map(f => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                            {driveFolders.length === 0 && (
                              <option value="">(No folders available)</option>
                            )}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Schedule</label>
                          <select
                            value={jobSchedule}
                            onChange={(e) => setJobSchedule(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          >
                            <option value="manual">Manual Only</option>
                            <option value="hourly">Hourly</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-center pt-4">
                          <label className="flex items-center gap-2 cursor-pointer text-xs font-bold">
                            <input
                              type="checkbox"
                              checked={jobEnabled}
                              onChange={(e) => setJobEnabled(e.target.checked)}
                              className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-emerald-500 focus:ring-emerald-500"
                            />
                            <span>Enabled</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="submit"
                        disabled={loading || !driveConnected || driveFolders.length === 0}
                        className="flex-1 btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40"
                      >
                        {loading ? <Loader className="animate-spin" size={14} /> : 'Save Job'}
                      </button>
                      {editingJobId && (
                        <button
                          type="button"
                          onClick={resetJobForm}
                          className="px-3 py-2 text-xs rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-all"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>

                  {/* Jobs List */}
                  <div className="lg:col-span-2 space-y-3">
                    <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                      <Calendar className="text-emerald-400" size={16} /> 
                      Configured Sync Jobs ({jobs.length})
                    </h3>

                    <div className="space-y-3 max-h-[450px] overflow-y-auto custom-scrollbar pr-1">
                      {jobs.map(job => (
                        <div key={job.id} className="bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-emerald-500/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-sm">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-[var(--text-primary)]">{job.name}</span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                job.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                                {job.schedule}
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-2">
                              <span>Source: {job.connectionName} / {job.database} / {job.collection}</span>
                              <ArrowRight size={10} className="text-slate-500" />
                              <span>GDrive: {job.driveFolderName}</span>
                            </div>
                            {job.lastRun && (
                              <div className={`text-[9px] font-semibold flex items-center gap-1.5 ${
                                job.lastStatus === 'success' ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                <ClockIcon size={9} />
                                <span>Last Run: {new Date(job.lastRun).toLocaleString()}</span>
                                <span className="opacity-60">•</span>
                                <span className="truncate max-w-xs">{job.lastMessage}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleRunJob(job.id)}
                              disabled={loading || !driveConnected}
                              className="p-2 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 rounded-xl transition-all disabled:opacity-40"
                              title="Run backup now"
                            >
                              <Play size={14} />
                            </button>
                            <button
                              onClick={() => handleEditJob(job)}
                              className="p-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded-xl transition-all"
                              title="Edit job"
                            >
                              <Settings size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-2 bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-xl transition-all"
                              title="Delete job"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}

                      {jobs.length === 0 && (
                        <div className="bg-[var(--bg-card)] border border-dashed border-[var(--border-color)] rounded-2xl p-10 text-center text-[11px] text-[var(--text-muted)] italic">
                          No sync jobs scheduled. Fill in the form on the left to schedule collection backups.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'restore' && (
              <motion.div
                key="restore"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                    <History className="text-emerald-500" /> Restore Collection Backup
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">Retrieve JSON backup files from Google Drive and restore them into your server databases.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Backup selector / Setup */}
                  <div className="lg:col-span-2 space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)] flex flex-col min-h-[300px]">
                    <div className="flex flex-col md:flex-row gap-4 mb-2">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Select Backup Folder</label>
                        <select
                          value={restoreFolderId}
                          onChange={(e) => setRestoreFolderId(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          disabled={!driveConnected}
                        >
                          <option value="">(Select Folder)</option>
                          {driveFolders.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end shrink-0">
                        <button
                          onClick={() => fetchBackups(restoreFolderId)}
                          disabled={loading || !restoreFolderId}
                          className="px-4 py-2 border border-[var(--border-color)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                        >
                          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                          <span>Refresh Files</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 border border-[var(--border-color)] rounded-xl overflow-hidden flex flex-col bg-[var(--bg-tertiary)]/20 min-h-[200px]">
                      <div className="bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex justify-between">
                        <span>Backup Files ({backupFiles.length})</span>
                        <span>Select file to restore</span>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {backupFiles.map(file => (
                          <button
                            key={file.id}
                            onClick={() => handleBackupFileSelect(file.id)}
                            className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex items-center justify-between border ${
                              selectedFileId === file.id 
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-sm font-bold' 
                                : 'hover:bg-[var(--bg-card-hover)] border-transparent text-[var(--text-secondary)]'
                            }`}
                          >
                            <span className="truncate flex-1 flex items-center gap-2">
                              <FileJson size={14} className={selectedFileId === file.id ? 'text-emerald-400' : 'text-slate-500'} />
                              {file.name}
                            </span>
                            <span className="text-[9px] text-[var(--text-muted)] shrink-0 font-mono pl-4">
                              {new Date(file.createdTime).toLocaleString()} ({(parseFloat(file.size || 0) / 1024).toFixed(1)} KB)
                            </span>
                          </button>
                        ))}
                        {backupFiles.length === 0 && (
                          <div className="text-center py-12 text-[11px] text-[var(--text-muted)] italic">
                            {restoreFolderId ? 'No backup files found in this folder.' : 'Please select a backup folder above.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Restore Target Configuration */}
                  <div className="space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                    <h3 className="text-sm font-bold flex items-center gap-2 border-b border-[var(--border-color)] pb-2">
                      <History className="text-emerald-400" size={16} /> 
                      Restore Parameters
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Connection</label>
                        <select
                          value={restoreConnId}
                          onChange={(e) => setRestoreConnId(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                        >
                          {dbConnections.map(c => (
                            <option key={c._id} value={c._id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Database</label>
                        <input
                          type="text"
                          value={restoreDbName}
                          onChange={(e) => setRestoreDbName(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="e.g. monitor"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Target Collection Name</label>
                        <input
                          type="text"
                          value={restoreCollName}
                          onChange={(e) => setRestoreCollName(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                          placeholder="e.g. connections"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Restore Mode</label>
                        <select
                          value={restoreMode}
                          onChange={(e) => setRestoreMode(e.target.value)}
                          className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                        >
                          <option value="insert">Insert (Fail on duplicate ID)</option>
                          <option value="upsert">Upsert (Overwrite matching ID)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={executeRestore}
                      disabled={loading || !selectedFileId || !restoreDbName.trim() || !restoreCollName.trim()}
                      className="w-full btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg mt-2"
                    >
                      {loading ? (
                        <>
                          <Loader className="animate-spin" size={14} />
                          <span>Restoring collection...</span>
                        </>
                      ) : (
                        <>
                          <History size={14} />
                          <span>Execute Restore</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// Simple internal icon component for clock
function ClockIcon({ size = 12 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
