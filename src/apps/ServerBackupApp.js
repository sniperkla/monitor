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
          <select
            value={connectionId}
            onChange={e => setConnectionId(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none"
          >
            <option value="">Select connection...</option>
            {sshConnections.map(c => (
              <option key={c._id} value={c._id}>{c.name} ({c.host})</option>
            ))}
          </select>
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
                    {config.paths.length > 1 && <button onClick={() => removePath(i)} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
                  </div>
                ))}
                <button onClick={addPath} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold">+ Add Path</button>
                <ExcludeInput excludes={config.excludes} updateExclude={updateExclude} addExclude={addExclude} removeExclude={removeExclude} />
              </ConfigSection>
            )}

            {backupType === 'docker' && (
              <ConfigSection title="Docker Backup Options">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Containers (comma-separated, or leave empty for all)</label>
                  <input value={config.containers.join(',')} onChange={e => updateConfig('containers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="container1, container2" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none" />
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
                  <button onClick={handleDownload} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-2">
                    <Download size={14} /> Download
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
              <select value={restoreTargetId} onChange={e => setRestoreTargetId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none">
                <option value="">Select server...</option>
                {sshConnections.map(c => <option key={c._id} value={c._id}>{c.name} ({c.host})</option>)}
              </select>
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
              <select value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs focus:outline-none">
                <option value="">Select target server...</option>
                {sshConnections.filter(c => c._id !== connectionId).map(c => <option key={c._id} value={c._id}>{c.name} ({c.host})</option>)}
              </select>
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
          <ConfigSection title="Server Backup Files">
            <ServerFilesList connectionId={connectionId} apiFetch={apiFetch} />
          </ConfigSection>
        )}
      </div>
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

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/server-backup/jobs?connectionId=${connectionId}`);
        const data = await res.json();
        if (!cancelled && data.success) setFiles(data.files || []);
      } catch {}
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [connectionId, apiFetch]);

  if (!connectionId) return <div className="text-xs text-[var(--text-muted)]">Select a server connection first</div>;
  if (loading) return <div className="text-xs text-[var(--text-muted)]"><Loader size={12} className="animate-spin inline mr-1" /> Loading...</div>;
  if (files.length === 0) return <div className="text-xs text-[var(--text-muted)]">No backup files found on this server</div>;

  return (
    <div className="space-y-1.5">
      <button onClick={fetchFiles} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold mb-2 flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
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
