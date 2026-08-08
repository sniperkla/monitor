'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { 
  Database, Upload, Cloud, RefreshCw, Play, Trash2, Plus, 
  CheckCircle, AlertCircle, Calendar, ShieldAlert, ArrowRight,
  FolderPlus, History, Key, Settings, Loader, CloudLightning, FileJson, ShieldCheck,
  Copy, Server, Wifi, WifiOff, Terminal, ChevronDown, Check, Clock,
  XCircle, TrendingUp, X, Zap, Shield, BarChart3, Folder, ExternalLink, Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ALL_DATABASES = 'All Databases (*)';
const ALL_COLLECTIONS = 'All Collections (*)';

// 🎨 Custom Styled Popover Select Component (Matching Rclone / App Design System)
function CustomSelect({ value, onChange, options = [], className = '', textClass = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedOpt = options.find(o => String(o.value) === String(value)) || options[0];

  return (
    <div className="relative inline-block w-full" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono flex items-center justify-between gap-2 cursor-pointer hover:border-emerald-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className={`truncate ${textClass}`}>{selectedOpt?.label || value}</span>
        <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[9999] overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]/30">
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.key || `${opt.value}-${idx}`}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected ? 'bg-emerald-500/15 text-emerald-400 font-bold' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check size={12} className="text-emerald-400 shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ⏰ Modern Cron Builder Component for MongoSync
function CronBuilder({ value, onChange }) {
  const [mode, setMode] = useState('everyday'); // everyday, weekly, monthly, interval, custom
  const [time, setTime] = useState('02:00');
  const [weekDay, setWeekDay] = useState('0'); // 0 = Sunday
  const [monthDay, setMonthDay] = useState('1');
  const [intervalVal, setIntervalVal] = useState('*/5 * * * *');
  const [customVal, setCustomVal] = useState('*/5 * * * *');

  useEffect(() => {
    if (!value || value === 'manual') return;
    if (value === '0 * * * *' || value === 'hourly') {
      setMode('interval');
      setIntervalVal('0 * * * *');
    } else if (value === '0 2 * * *' || value === 'daily') {
      setMode('everyday');
      setTime('02:00');
    } else if (value === '0 2 * * 0' || value === 'weekly') {
      setMode('weekly');
      setTime('02:00');
      setWeekDay('0');
    } else if (value.startsWith('*/')) {
      setMode('interval');
      setIntervalVal(value);
    } else {
      const parts = value.trim().split(/\s+/);
      if (parts.length === 5) {
        const [min, hr, dom, mon, dow] = parts;
        if (dom === '*' && dow === '*' && mon === '*' && !min.includes('/') && !hr.includes('/')) {
          setMode('everyday');
          setTime(`${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
        } else if (dom === '*' && mon === '*' && dow !== '*' && !min.includes('/') && !hr.includes('/')) {
          setMode('weekly');
          setTime(`${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
          setWeekDay(dow);
        } else if (dom !== '*' && mon === '*' && dow === '*' && !min.includes('/') && !hr.includes('/')) {
          setMode('monthly');
          setTime(`${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
          setMonthDay(dom);
        } else {
          setMode('custom');
          setCustomVal(value);
        }
      } else {
        setMode('custom');
        setCustomVal(value);
      }
    }
  }, []);

  const updateCron = (newMode, newTime, newWeekDay, newMonthDay, newInterval, newCustom) => {
    let cron = '0 2 * * *';
    const [hrStr, minStr] = (newTime || '02:00').split(':');
    const hr = parseInt(hrStr || '0', 10);
    const min = parseInt(minStr || '0', 10);

    if (newMode === 'everyday') {
      cron = `${min} ${hr} * * *`;
    } else if (newMode === 'weekly') {
      cron = `${min} ${hr} * * ${newWeekDay}`;
    } else if (newMode === 'monthly') {
      cron = `${min} ${hr} ${newMonthDay} * *`;
    } else if (newMode === 'interval') {
      cron = newInterval;
    } else if (newMode === 'custom') {
      cron = newCustom;
    }

    onChange(cron);
  };

  const getHumanReadable = () => {
    const [hrStr, minStr] = (time || '00:00').split(':');
    const hr = parseInt(hrStr || '0', 10);
    const min = parseInt(minStr || '0', 10);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr % 12 === 0 ? 12 : hr % 12;
    const timeFormatted = `${String(hr12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${ampm}`;
    const daysMap = { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' };

    if (mode === 'everyday') return `Every day at ${timeFormatted} (${time} server time)`;
    if (mode === 'weekly') return `Every ${daysMap[weekDay] || 'day'} at ${timeFormatted}`;
    if (mode === 'monthly') return `Day ${monthDay} of every month at ${timeFormatted}`;
    if (mode === 'interval') {
      if (intervalVal === '*/5 * * * *') return 'Every 5 minutes (*/5 * * * *)';
      if (intervalVal === '*/15 * * * *') return 'Every 15 minutes (*/15 * * * *)';
      if (intervalVal === '*/30 * * * *') return 'Every 30 minutes (*/30 * * * *)';
      if (intervalVal === '0 * * * *') return 'Every hour (at :00)';
      if (intervalVal === '0 */2 * * *') return 'Every 2 hours';
      if (intervalVal === '0 */6 * * *') return 'Every 6 hours';
      if (intervalVal === '0 */12 * * *') return 'Every 12 hours';
      return `Interval: ${intervalVal}`;
    }
    return `Custom cron: ${customVal}`;
  };

  return (
    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
          <Clock size={12} /> Schedule & Time Picker
        </label>
        <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded font-bold">
          {value}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {[
          { id: 'everyday', label: 'Everyday' },
          { id: 'weekly',   label: 'Weekly' },
          { id: 'monthly',  label: 'Monthly' },
          { id: 'interval', label: 'Interval' },
          { id: 'custom',   label: 'Custom' },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id);
              updateCron(m.id, time, weekDay, monthDay, intervalVal, customVal);
            }}
            className={`py-1 px-1 text-center rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
              mode === m.id
                ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/20'
                : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="pt-2 border-t border-[var(--border-color)]/40 space-y-2">
        {(mode === 'everyday' || mode === 'weekly' || mode === 'monthly') && (
          <div className="grid grid-cols-2 gap-2 items-center">
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                Execution Time (HH:MM):
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const newT = e.target.value || '00:00';
                  setTime(newT);
                  updateCron(mode, newT, weekDay, monthDay, intervalVal, customVal);
                }}
                className="w-full px-2.5 py-1 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none cursor-pointer"
              />
            </div>

            {mode === 'weekly' && (
              <div>
                <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                  Day of Week:
                </label>
                <CustomSelect
                  value={weekDay}
                  onChange={(val) => {
                    setWeekDay(val);
                    updateCron(mode, time, val, monthDay, intervalVal, customVal);
                  }}
                  options={[
                    { value: '1', label: 'Every Monday' },
                    { value: '2', label: 'Every Tuesday' },
                    { value: '3', label: 'Every Wednesday' },
                    { value: '4', label: 'Every Thursday' },
                    { value: '5', label: 'Every Friday' },
                    { value: '6', label: 'Every Saturday' },
                    { value: '0', label: 'Every Sunday' },
                  ]}
                />
              </div>
            )}

            {mode === 'monthly' && (
              <div>
                <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                  Day of Month:
                </label>
                <CustomSelect
                  value={monthDay}
                  onChange={(val) => {
                    setMonthDay(val);
                    updateCron(mode, time, weekDay, val, intervalVal, customVal);
                  }}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }))}
                />
              </div>
            )}
          </div>
        )}

        {mode === 'interval' && (
          <div>
            <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
              Select Recurrence Interval:
            </label>
            <CustomSelect
              value={intervalVal}
              onChange={(val) => {
                setIntervalVal(val);
                updateCron(mode, time, weekDay, monthDay, val, customVal);
              }}
              options={[
                { value: '*/5 * * * *', label: 'Every 5 Minutes (*/5 * * * *)' },
                { value: '*/15 * * * *', label: 'Every 15 Minutes (*/15 * * * *)' },
                { value: '*/30 * * * *', label: 'Every 30 Minutes (*/30 * * * *)' },
                { value: '0 * * * *', label: 'Every Hour (0 * * * *)' },
                { value: '0 */2 * * *', label: 'Every 2 Hours (0 */2 * * *)' },
                { value: '0 */6 * * *', label: 'Every 6 Hours (0 */6 * * *)' },
                { value: '0 */12 * * *', label: 'Every 12 Hours (0 */12 * * *)' },
              ]}
            />
          </div>
        )}

        {mode === 'custom' && (
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[var(--text-muted)] block">
              Custom Cron or Natural Input (e.g., "5 min", "18:00", "every 2 hours", "*/5 * * * *"):
            </label>
            <input
              type="text"
              value={customVal}
              onChange={(e) => {
                const raw = e.target.value;
                setCustomVal(raw);

                // Auto-convert natural input phrases to 5-field cron
                let parsedCron = raw.trim();
                const lower = raw.trim().toLowerCase();

                // Match "5 min", "5m", "every 5 min", "5 mins", "every 5m"
                const minMatch = lower.match(/^(?:every\s+)?(\d+)\s*(?:m|min|mins|minutes)$/);
                // Match "18:00", "6pm", "18.00"
                const timeMatch = lower.match(/^(\d{1,2})[:.](\d{2})$/);
                // Match "1 hour", "every 2 hours", "2h"
                const hrMatch = lower.match(/^(?:every\s+)?(\d+)\s*(?:h|hr|hrs|hour|hours)$/);

                if (minMatch) {
                  const m = parseInt(minMatch[1], 10);
                  if (m > 0 && m < 60) parsedCron = `*/${m} * * * *`;
                } else if (timeMatch) {
                  const hr = parseInt(timeMatch[1], 10);
                  const min = parseInt(timeMatch[2], 10);
                  if (hr >= 0 && hr < 24 && min >= 0 && min < 60) parsedCron = `${min} ${hr} * * *`;
                } else if (hrMatch) {
                  const h = parseInt(hrMatch[1], 10);
                  if (h > 0 && h < 24) parsedCron = `0 */${h} * * *`;
                }

                updateCron(mode, time, weekDay, monthDay, intervalVal, parsedCron);
              }}
              placeholder="e.g. 5 min, 18:00, or 0 18 * * *"
              className="w-full px-3 py-1 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        <div className="text-[10px] text-emerald-400 font-medium italic pt-1">
          {getHumanReadable()}
        </div>
      </div>
    </div>
  );
}

export default function MongoBackupApp() {
  const { state, apiFetch } = useApp();
  const { addNotification } = useOS();
  const { connections } = state;

  const [activeTab, setActiveTab] = useState('import');
  const [loading, setLoading] = useState(false);

  // Connection selector: include Mongo `database` entries and SSH entries that are configured as DB targets
  const dbConnections = [
    { _id: 'default', name: 'System Database (Default)', dbProvider: 'mongodb' },
    ...connections.filter(c => (
      // Normal DB connections for Mongo
      (c.type === 'database' && c.dbProvider === 'mongodb') ||
      // SSH entries that explicitly specify a target database or mongo-specific host/port
      (c.type === 'ssh' && (
        !!c.database || !!c.mongoHost || !!c.mongoPort || !!c.mongoUsername || !!c.mongoPassword
      ))
    ))
  ];

  // ── Import Collection State ──────────────────────────────────────────────
  const [importConnId, setImportConnId] = useState('default');
  const [importDbName, setImportDbName] = useState('monitor');
  const [importCollName, setImportCollName] = useState('');
  const [importMode, setImportMode] = useState('insert'); // insert, upsert
  const [importFile, setImportFile] = useState(null);
  const [importFileData, setImportFileData] = useState(null);
  const [importLogs, setImportLogs] = useState([]);
  const fileInputRef = useRef(null);
  // Batch import state
  const [batchImportMode, setBatchImportMode] = useState(false);
  const [batchFiles, setBatchFiles] = useState([]); // [{ file, name, data, collection }]
  const [batchImporting, setBatchImporting] = useState(false);

  // ── Google Drive Link State ──────────────────────────────────────────────
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEmail, setDriveEmail] = useState('');
  const [driveName, setDriveName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [driveFolders, setDriveFolders] = useState([]);
  const [driveAllFolders, setDriveAllFolders] = useState([]); // flat list with paths for autocomplete
  const [newFolderName, setNewFolderName] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);
  const [showCredGuide, setShowCredGuide] = useState(true);

  // SSH Server connections for runner execution target & replica set scanning
  const sshConnections = connections.filter(c => c.type === 'ssh' || (!c.type && !c.dbProvider));

  // ── Sync Jobs State ─────────────────────────────────────────────
  const [jobs, setJobs] = useState([]);
  const [jobName, setJobName] = useState('');
  const [jobConnId, setJobConnId] = useState('default');
  const [targetSshConnId, setTargetSshConnId] = useState('');
  const [jobDbName, setJobDbName] = useState(ALL_DATABASES);
  const [jobCollName, setJobCollName] = useState(ALL_COLLECTIONS);
  const [jobFolderId, setJobFolderId] = useState('');
  const [jobFolderName, setJobFolderName] = useState('');
  const [restoreFolderName, setRestoreFolderName] = useState('');
  const [jobSchedule, setJobSchedule] = useState('daily'); // manual, hourly, daily, weekly
  const [jobEnabled, setJobEnabled] = useState(true);
  const [editingJobId, setEditingJobId] = useState(null);
  const [jobFolderInputActive, setJobFolderInputActive] = useState(false);
  const [jobFolderSelectedIndex, setJobFolderSelectedIndex] = useState(-1);
  const jobFolderDropdownRef = useRef(null); // For scroll-into-view
  const [filteredDriveFolderOptions, setFilteredDriveFolderOptions] = useState([]);
  const [driveBrowseVisible, setDriveBrowseVisible] = useState(false);
  const [driveBrowseMode, setDriveBrowseMode] = useState('job');
  const [driveBrowsePath, setDriveBrowsePath] = useState([{ id: 'root', name: 'My Drive' }]);
  const [driveBrowseFolders, setDriveBrowseFolders] = useState([]);
  const [driveBrowseLoading, setDriveBrowseLoading] = useState(false);
  // ── Sync History State ─────────────────────────────────────────────
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // ── SSH Cron Log State ─────────────────────────────────────────────
  const [cronLogs, setCronLogs] = useState({}); // { [jobId]: { logTail, lastRunFromLog } }
  const [cronLogLoading, setCronLogLoading] = useState({}); // { [jobId]: bool }
  const [cronLogExpanded, setCronLogExpanded] = useState({}); // { [jobId]: bool } - collapse state
  // ── Restore Result Modal & Live Progress State ─────────────────────
  const [restoreResult, setRestoreResult] = useState(null); // null = closed
  const [restoreProgress, setRestoreProgress] = useState(null); // { active, total, current, percent, currentFile, processedFiles }
  // ── Dependency Pre-flight Check Modal ─────────────────────────────
  const [depCheckModal, setDepCheckModal] = useState(null); // null = closed, { status, missingTools, recommendations, pendingJobPayload }
  const [depCheckLoading, setDepCheckLoading] = useState(false);
  // ── Live Install Terminal Modal ────────────────────────────────────
  const [installTerminal, setInstallTerminal] = useState(null); // null = closed, { lines[], done, code, pendingJobPayload }
  const installTerminalRef = useRef(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/history');
      const data = await res.json();
      if (data.success) {
        setHistoryRuns(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch sync history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Auto-refresh execution history every 10 seconds when on History tab
  useEffect(() => {
    if (activeTab !== 'history') return;
    
    // Initial fetch
    fetchHistory();
    fetchAllCronLogs();
    
    // Set up polling
    const interval = setInterval(() => {
      fetchHistory();
      fetchAllCronLogs();
    }, 10000); // 10 seconds
    
    return () => clearInterval(interval);
  }, [activeTab]);

  const fetchCronLog = async (job) => {
    if (!job.targetSshConnId) return;
    setCronLogLoading(prev => ({ ...prev, [job.id]: true }));
    try {
      const res = await apiFetch(
        `/api/mongo-sync/cron?jobId=${encodeURIComponent(job.id)}&targetSshConnId=${encodeURIComponent(job.targetSshConnId)}&fetchLogs=1`
      );
      const data = await res.json();
      if (data.success) {
        setCronLogs(prev => ({ ...prev, [job.id]: {
          logTail: data.logTail || '(no log output)',
          lastRunFromLog: data.lastRunFromLog,
          installed: data.installed,
          cronLine: data.cronLine,
        }}));
      } else {
        setCronLogs(prev => ({ ...prev, [job.id]: { logTail: `Error: ${data.error}`, lastRunFromLog: null } }));
      }
    } catch (err) {
      setCronLogs(prev => ({ ...prev, [job.id]: { logTail: `Error: ${err.message}`, lastRunFromLog: null } }));
    } finally {
      setCronLogLoading(prev => ({ ...prev, [job.id]: false }));
    }
  };

  const fetchAllCronLogs = () => {
    jobs.filter(j => j.targetSshConnId && j.schedule !== 'manual').forEach(j => fetchCronLog(j));
  };

  const handleClearHistory = async () => {
    if (!confirm('Are you sure you want to clear all backup history logs?')) return;
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/history', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setHistoryRuns([]);
        addNotification({ title: 'History Cleared', message: 'Backup execution history has been cleared.', type: 'success' });
      }
    } catch (err) {
      addNotification({ title: 'Clear Failed', message: err.message, type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  };

  // Auto-fetch Database & Collection lists for selected Connection
  const [fetchedDbs, setFetchedDbs] = useState([]);
  const [fetchedColls, setFetchedColls] = useState([]);
  const [fetchingDbs, setFetchingDbs] = useState(false);
  const [fetchingColls, setFetchingColls] = useState(false);

  // Auto-fetch DB & Collections for Import JSON target connection
  const [importFetchedDbs, setImportFetchedDbs] = useState([]);
  const [importFetchedColls, setImportFetchedColls] = useState([]);
  const [importFetchingDbs, setImportFetchingDbs] = useState(false);
  const [importFetchingColls, setImportFetchingColls] = useState(false);

  useEffect(() => {
    if (!importConnId) return;
    const fetchDatabases = async () => {
      setImportFetchingDbs(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: importConnId })
        });
        const data = await res.json();
        if (data.success && data.databases?.length > 0) {
          setImportFetchedDbs(data.databases);
          if (!importDbName || !data.databases.includes(importDbName)) {
            setImportDbName(data.databases[0]);
          }
        } else { setImportFetchedDbs([]); }
      } catch { setImportFetchedDbs([]); }
      finally { setImportFetchingDbs(false); }
    };
    fetchDatabases();
  }, [importConnId]);

  useEffect(() => {
    if (!importConnId || !importDbName) return;
    const fetchCollections = async () => {
      setImportFetchingColls(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: importConnId, database: importDbName })
        });
        const data = await res.json();
        if (data.success && data.collections?.length > 0) {
          const filtered = data.collections.filter(c => c !== 'All Collections (*)');
          setImportFetchedColls(filtered);
          if (filtered.length > 0 && !filtered.includes(importCollName)) {
            setImportCollName(filtered[0]);
          }
        } else { setImportFetchedColls([]); }
      } catch { setImportFetchedColls([]); }
      finally { setImportFetchingColls(false); }
    };
    fetchCollections();
  }, [importConnId, importDbName]);

  // Fetch databases when connection changes
  useEffect(() => {
    if (!jobConnId) return;
    const fetchDatabases = async () => {
      setFetchingDbs(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: jobConnId })
        });
        const data = await res.json();
        if (data.success && data.databases?.length > 0) {
          setFetchedDbs(data.databases);
          // If connection returns only 1 DB (single-DB URI), auto-select it
          if (data.databases.length === 1) {
            setJobDbName(data.databases[0]);
          } else if (jobDbName !== ALL_DATABASES && !data.databases.includes(jobDbName)) {
            setJobDbName(ALL_DATABASES);
          }
        } else {
          setFetchedDbs([]);
        }
      } catch (err) {
        console.error('Failed to fetch databases:', err);
        setFetchedDbs([]);
      } finally {
        setFetchingDbs(false);
      }
    };
    fetchDatabases();
  }, [jobConnId]);

  // Fetch collections when database changes
  useEffect(() => {
    if (!jobConnId || !jobDbName) return;
    if (jobDbName === ALL_DATABASES) {
      setFetchedColls([ALL_COLLECTIONS]);
      setJobCollName(ALL_COLLECTIONS);
      return;
    }
    const fetchCollections = async () => {
      setFetchingColls(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: jobConnId, database: jobDbName })
        });
        const data = await res.json();
        if (data.success && data.collections?.length > 0) {
          setFetchedColls(data.collections);
          if (jobCollName !== ALL_COLLECTIONS && !data.collections.includes(jobCollName)) {
            setJobCollName(data.collections[0]);
          }
        } else {
          setFetchedColls([ALL_COLLECTIONS]);
        }
      } catch (err) {
        console.error('Failed to fetch collections:', err);
        setFetchedColls([ALL_COLLECTIONS]);
      } finally {
        setFetchingColls(false);
      }
    };
    fetchCollections();
  }, [jobConnId, jobDbName]);

  // ── Restore State ───────────────────────────────────────────────
  const [restoreFolderId, setRestoreFolderId] = useState('');
  const [restoreFolderInputActive, setRestoreFolderInputActive] = useState(false);
  const [restoreFolderSelectedIndex, setRestoreFolderSelectedIndex] = useState(-1);
  const restoreFolderDropdownRef = useRef(null); // For scroll-into-view
  const [filteredRestoreFolderOptions, setFilteredRestoreFolderOptions] = useState([]);
  const [backupFiles, setBackupFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [restoreConnId, setRestoreConnId] = useState('default');
  const [restoreDbName, setRestoreDbName] = useState(ALL_DATABASES);
  const [restoreCollName, setRestoreCollName] = useState(ALL_COLLECTIONS);
  const [restoreMode, setRestoreMode] = useState('insert');

  // Auto-fetch DB & Collections for Restore target connection
  const [restoreFetchedDbs, setRestoreFetchedDbs] = useState([]);
  const [restoreFetchedColls, setRestoreFetchedColls] = useState([]);
  const [restoreFetchingDbs, setRestoreFetchingDbs] = useState(false);
  const [restoreFetchingColls, setRestoreFetchingColls] = useState(false);

  useEffect(() => {
    if (!restoreConnId) return;
    const fetchDatabases = async () => {
      setRestoreFetchingDbs(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: restoreConnId })
        });
        const data = await res.json();
        if (data.success && data.databases?.length > 0) {
          setRestoreFetchedDbs(data.databases);
          // If connection returns only 1 DB (single-DB URI), auto-select it
          if (data.databases.length === 1) {
            setRestoreDbName(data.databases[0]);
          } else if (restoreDbName !== ALL_DATABASES && !data.databases.includes(restoreDbName)) {
            setRestoreDbName(data.databases[0]);
          }
        } else { setRestoreFetchedDbs([]); }
      } catch { setRestoreFetchedDbs([]); }
      finally { setRestoreFetchingDbs(false); }
    };
    fetchDatabases();
  }, [restoreConnId]);

  useEffect(() => {
    if (!restoreConnId || !restoreDbName) return;
    if (restoreDbName === ALL_DATABASES) {
      setRestoreFetchedColls([ALL_COLLECTIONS]);
      setRestoreCollName(ALL_COLLECTIONS);
      return;
    }
    const fetchCollections = async () => {
      setRestoreFetchingColls(true);
      try {
        const res = await apiFetch('/api/mongo-sync/schema-explorer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: restoreConnId, database: restoreDbName })
        });
        const data = await res.json();
        if (data.success && data.collections?.length > 0) {
          setRestoreFetchedColls(data.collections);
          if (restoreCollName !== ALL_COLLECTIONS && !data.collections.includes(restoreCollName)) {
            setRestoreCollName(data.collections[0]);
          }
        } else { setRestoreFetchedColls([ALL_COLLECTIONS]); }
      } catch { setRestoreFetchedColls([ALL_COLLECTIONS]); }
      finally { setRestoreFetchingColls(false); }
    };
    fetchCollections();
  }, [restoreConnId, restoreDbName]);

  // ── Replica Set Failover State ──────────────────────────────────────────
  const [rsConnId, setRsConnId] = useState('default');
  const [rsData, setRsData] = useState(null);
  const [rsLoading, setRsLoading] = useState(false);
  const [rsActionLoading, setRsActionLoading] = useState(false);

  // Setup / Init wizard state
  const [initSetName, setInitSetName] = useState('rs0');
  const [addNodeHost, setAddNodeHost] = useState('');

  // Per-node SSH scan wizard
  const emptyNode = () => ({
    sshConnId: '', instances: [], selectedPort: '', selectedHost: '',
    scanning: false, scanError: null, verifying: false, verified: null
  });
  const [nodes, setNodes] = useState([emptyNode(), emptyNode(), emptyNode()]);
  const updateNode = (i, patch) => setNodes(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));

  const scanNode = async (i) => {
    const node = nodes[i];
    if (!node.sshConnId) return;
    updateNode(i, { scanning: true, scanError: null, instances: [], selectedPort: '', selectedHost: '', verified: null });
    const isLocalRelayMode = localStorage.getItem('ssh_monitor_ssh_mode') === 'local';
    try {
      const res = await apiFetch('/api/mongo-sync/scan-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', sshConnId: node.sshConnId, useRelay: isLocalRelayMode })
      });
      const data = await res.json();
      if (data.success && data.instances?.length > 0) {
        const first = data.instances[0];
        updateNode(i, {
          scanning: false,
          instances: data.instances,
          selectedPort: String(first.port || ''),
          selectedHost: first.host || data.host || '',
          verified: { connected: first.connected, isReplSet: first.isReplSet, setName: first.setName, state: first.state, error: first.error }
        });
      } else {
        updateNode(i, { scanning: false, scanError: data.error || 'No MongoDB instances found' });
      }
    } catch (err) {
      updateNode(i, { scanning: false, scanError: err.message });
    }
  };

  const verifyNodePort = async (i, port, host) => {
    if (!port || !host) return;
    const sshConnId = nodes[i]?.sshConnId;
    if (!sshConnId) return;
    updateNode(i, { verifying: true, verified: null });
    const isLocalRelayMode = localStorage.getItem('ssh_monitor_ssh_mode') === 'local';
    try {
      const res = await apiFetch('/api/mongo-sync/scan-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', sshConnId, mongoUri: `mongodb://${host}:${port}`, useRelay: isLocalRelayMode })
      });
      const data = await res.json();
      updateNode(i, { verifying: false, verified: data });
    } catch (err) {
      updateNode(i, { verifying: false, verified: { connected: false, error: err.message } });
    }
  };

  const fetchReplicaSetStatus = async (connId = rsConnId) => {
    setRsLoading(true);
    try {
      const res = await apiFetch(`/api/mongo-sync/replica-set?connectionId=${connId}`);
      if (res.success) {
        setRsData(res);
      } else {
        setRsData({ isReplSet: false, error: res.error || 'Failed to query Replica Set' });
      }
    } catch (err) {
      setRsData({ isReplSet: false, error: err.message });
    } finally {
      setRsLoading(false);
    }
  };

  const handleFailoverAction = async (action, extraData = {}) => {
    setRsActionLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/replica-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, connectionId: rsConnId, ...extraData })
      });
      if (res.success) {
        addNotification({ title: 'Replica Set', message: res.message, type: 'success' });
        setTimeout(() => fetchReplicaSetStatus(rsConnId), 2000);
      } else {
        addNotification({ title: 'Failover Error', message: res.error || 'Action failed', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Failover Error', message: err.message, type: 'error' });
    } finally {
      setRsActionLoading(false);
    }
  };

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
        if (data.hasClientSecret) setClientSecret('••••••••••••••••••••');
        setDriveFolders(data.folders || []);
        if (data.folders.length > 0) {
          setJobFolderId(data.folders[0].id);
          setRestoreFolderId(data.folders[0].id);
          setJobFolderName(data.folders[0].name);
          setRestoreFolderName(data.folders[0].name);
          // Seed autocomplete pool with root-level folders (path = name)
          setDriveAllFolders(data.folders.map(f => ({ ...f, path: f.name })));
        }
        // folder tree loaded on-demand via drivePicker
      }
    } catch (err) {
      console.error('Failed to fetch Google Drive status:', err);
    }
  };

  // Live folder drill-down picker state — shared by job and restore
  const [drivePicker, setDrivePicker] = useState({
    open: false,
    mode: 'job', // 'job' | 'restore'
    path: [{ id: null, name: 'My Drive' }], // breadcrumb
    folders: [],
    loading: false,
    search: '',
  });

  const openDrivePicker = async (mode) => {
    setDrivePicker({ open: true, mode, path: [{ id: null, name: 'My Drive' }], folders: [], loading: true, search: '' });
    try {
      const res = await apiFetch('/api/mongo-sync/gdrive/folders');
      const data = await res.json();
      const folders = data.folders || [];
      setDrivePicker(p => ({ ...p, folders, loading: false }));
      // Seed autocomplete pool with root folders (path = name for root level)
      if (folders.length > 0) {
        setDriveAllFolders(prev => {
          const existingIds = new Set(prev.map(f => f.id));
          const newEntries = folders
            .filter(f => !existingIds.has(f.id))
            .map(f => ({ ...f, path: f.name }));
          return newEntries.length > 0 ? [...prev, ...newEntries] : prev;
        });
      }
    } catch {
      setDrivePicker(p => ({ ...p, loading: false }));
    }
  };

  const drivePickerNavigate = async (folder) => {
    setDrivePicker(p => ({
      ...p,
      path: [...p.path, folder],
      folders: [],
      loading: true,
      search: '',
    }));
    try {
      const res = await apiFetch(`/api/mongo-sync/gdrive/folders?parentId=${folder.id}`);
      const data = await res.json();
      const subFolders = data.folders || [];
      setDrivePicker(p => {
        // Build full path for the navigated folder using the updated breadcrumb
        const newPath = [...p.path]; // p.path already has folder appended above
        // Add the navigated folder itself to autocomplete pool with its path
        const folderPathStr = newPath
          .filter(seg => seg.id !== null)
          .map(seg => seg.name)
          .join(' / ');
        // Add subfolders to autocomplete pool with full paths
        setDriveAllFolders(prev => {
          const existingIds = new Set(prev.map(f => f.id));
          const entries = [];
          // Add navigated folder itself if not already present
          if (!existingIds.has(folder.id)) {
            entries.push({ ...folder, path: folderPathStr || folder.name });
          }
          // Add subfolders
          subFolders.forEach(sf => {
            if (!existingIds.has(sf.id)) {
              const sfPath = folderPathStr ? `${folderPathStr} / ${sf.name}` : sf.name;
              entries.push({ ...sf, path: sfPath });
            }
          });
          return entries.length > 0 ? [...prev, ...entries] : prev;
        });
        return { ...p, folders: subFolders, loading: false };
      });
    } catch {
      setDrivePicker(p => ({ ...p, loading: false }));
    }
  };

  const drivePickerBack = async (idx) => {
    const newPath = drivePicker.path.slice(0, idx + 1);
    const parent = newPath[newPath.length - 1];
    setDrivePicker(p => ({ ...p, path: newPath, folders: [], loading: true, search: '' }));
    try {
      const url = parent.id ? `/api/mongo-sync/gdrive/folders?parentId=${parent.id}` : '/api/mongo-sync/gdrive/folders';
      const res = await apiFetch(url);
      const data = await res.json();
      const subFolders = data.folders || [];
      // Build path prefix for subfolders at this level
      const pathPrefix = newPath
        .filter(seg => seg.id !== null)
        .map(seg => seg.name)
        .join(' / ');
      setDriveAllFolders(prev => {
        const existingIds = new Set(prev.map(f => f.id));
        const entries = subFolders
          .filter(sf => !existingIds.has(sf.id))
          .map(sf => ({ ...sf, path: pathPrefix ? `${pathPrefix} / ${sf.name}` : sf.name }));
        return entries.length > 0 ? [...prev, ...entries] : prev;
      });
      setDrivePicker(p => ({ ...p, folders: subFolders, loading: false }));
    } catch {
      setDrivePicker(p => ({ ...p, loading: false }));
    }
  };

  const drivePickerSelect = () => {
    const current = drivePicker.path[drivePicker.path.length - 1];
    if (!current.id) return; // can't select root
    // Build the full path string from breadcrumbs (skip "My Drive" root segment)
    const fullPath = drivePicker.path
      .filter(seg => seg.id !== null)
      .map(seg => seg.name)
      .join(' / ');
    // Ensure this folder (with full path) is in the autocomplete pool
    setDriveAllFolders(prev => {
      if (prev.find(f => f.id === current.id)) return prev;
      return [...prev, { ...current, path: fullPath || current.name }];
    });
    if (drivePicker.mode === 'job') {
      setJobFolderId(current.id);
      setJobFolderName(fullPath || current.name);
    } else {
      setRestoreFolderId(current.id);
      setRestoreFolderName(fullPath || current.name);
    }
    setDrivePicker(p => ({ ...p, open: false }));
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Batch mode: handle multiple files
    if (batchImportMode) {
      const filePromises = Array.from(files).map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const parsed = JSON.parse(evt.target.result);
              if (Array.isArray(parsed)) {
                const collectionName = file.name.replace(/\.json$/i, '');
                resolve({
                  file,
                  name: file.name,
                  data: parsed,
                  collection: collectionName,
                  size: parsed.length,
                  error: null
                });
              } else {
                resolve({
                  file,
                  name: file.name,
                  data: null,
                  collection: null,
                  size: 0,
                  error: 'JSON must contain an array of documents'
                });
              }
            } catch (err) {
              resolve({
                file,
                name: file.name,
                data: null,
                collection: null,
                size: 0,
                error: 'Invalid JSON format'
              });
            }
          };
          reader.readAsText(file);
        });
      });

      Promise.all(filePromises).then(results => {
        setBatchFiles(results);
        const validCount = results.filter(r => r.data).length;
        const errorCount = results.filter(r => r.error).length;
        setImportLogs([
          `Loaded ${results.length} file(s): ${validCount} valid, ${errorCount} invalid`,
          ...results.filter(r => r.error).map(r => `❌ ${r.name}: ${r.error}`)
        ]);
      });
      return;
    }

    // Single file mode (original behavior)
    const file = files[0];
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
    // Batch mode
    if (batchImportMode) {
      const validFiles = batchFiles.filter(f => f.data && f.collection);
      if (validFiles.length === 0) {
        setImportLogs(['No valid files to import']);
        return;
      }

      setBatchImporting(true);
      setImportLogs([`Starting batch import of ${validFiles.length} file(s)...`]);

      let successCount = 0;
      let failCount = 0;
      const logs = [`Starting batch import of ${validFiles.length} file(s)...`];

      for (const fileObj of validFiles) {
        logs.push(`\n📄 Importing ${fileObj.name} → ${importDbName}.${fileObj.collection}`);
        setImportLogs([...logs]);

        try {
          const res = await apiFetch('/api/mongo-sync/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: importConnId,
              database: importDbName,
              collection: fileObj.collection,
              documents: fileObj.data,
              mode: importMode
            })
          });
          const data = await res.json();
          
          if (data.success) {
            successCount++;
            logs.push(`  ✅ Success: ${data.insertedCount} inserted, ${data.updatedCount} updated`);
          } else {
            failCount++;
            logs.push(`  ❌ Failed: ${data.error}`);
          }
        } catch (err) {
          failCount++;
          logs.push(`  ❌ Error: ${err.message}`);
        }
        
        setImportLogs([...logs]);
      }

      logs.push(`\n=== Batch Import Complete ===`);
      logs.push(`✅ Succeeded: ${successCount}`);
      logs.push(`❌ Failed: ${failCount}`);
      logs.push(`📊 Total: ${validFiles.length}`);
      setImportLogs(logs);

      addNotification({
        title: 'Batch Import Complete',
        message: `${successCount} of ${validFiles.length} files imported successfully`,
        type: successCount === validFiles.length ? 'success' : 'warning'
      });

      setBatchImporting(false);
      return;
    }

    // Single file mode (original)
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
      // Don't overwrite the saved secret with the masked placeholder
      const secretToSave = clientSecret.includes('•') ? undefined : clientSecret;
      const res = await apiFetch('/api/mongo-sync/gdrive/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret: secretToSave })
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Credentials Saved', message: 'Google OAuth Client ID & Secret saved to database.', type: 'success' });
        fetchGDriveStatus();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      addNotification({ title: 'Error Saving Credentials', message: err.message, type: 'error' });
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
    if (jobSchedule !== 'manual' && !targetSshConnId) {
      addNotification({ title: 'SSH Server Required', message: 'Please select a Target SSH Server for scheduled jobs.', type: 'error' });
      return;
    }

    const targetConn = dbConnections.find(c => c._id === jobConnId);

    // ── Pre-flight dependency check for scheduled jobs ─────────────────────
    if (jobSchedule !== 'manual' && targetSshConnId) {
      setDepCheckLoading(true);
      try {
        const checkRes = await apiFetch('/api/mongo-sync/check-dependencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetSshConnId })
        });
        const checkData = await checkRes.json();
        setDepCheckLoading(false);

        if (!checkData.success) {
          addNotification({ title: 'Dependency Check Failed', message: checkData.error, type: 'error' });
          return;
        }

        // Show confirmation modal if any tools are missing
        if (checkData.missingTools.length > 0) {
          setDepCheckModal({
            status: checkData.status,
            missingTools: checkData.missingTools,
            recommendations: checkData.recommendations,
            canAutoInstall: checkData.canAutoInstall,
            pendingJobPayload: {
              name: jobName.trim(),
              connectionId: jobConnId,
              connectionName: targetConn?.name || 'Local Database',
              database: jobDbName.trim(),
              collection: jobCollName.trim(),
              driveFolderId: jobFolderId,
              driveFolderName: jobFolderName || driveFolders.find(f => f.id === jobFolderId)?.name || 'Default Folder',
              schedule: jobSchedule,
              enabled: jobEnabled,
              targetSshConnId,
              isEdit: !!editingJobId,
              editingJobId
            }
          });
          return; // Wait for user to confirm in modal
        }
      } catch (checkErr) {
        setDepCheckLoading(false);
        addNotification({ title: 'Dependency Check Error', message: checkErr.message, type: 'error' });
        return;
      }
    }

    // All deps OK — proceed straight to save + cron install
    await saveJobAndInstallCron({
      name: jobName.trim(),
      connectionId: jobConnId,
      connectionName: targetConn?.name || 'Local Database',
      database: jobDbName.trim(),
      collection: jobCollName.trim(),
      driveFolderId: jobFolderId,
      driveFolderName: jobFolderName || driveFolders.find(f => f.id === jobFolderId)?.name || 'Default Folder',
      schedule: jobSchedule,
      enabled: jobEnabled,
      targetSshConnId: jobSchedule !== 'manual' ? targetSshConnId : null,
      isEdit: !!editingJobId,
      editingJobId
    });
  };

  const saveJobAndInstallCron = async (payload) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: payload.editingJobId,
          name: payload.name,
          connectionId: payload.connectionId,
          connectionName: payload.connectionName,
          database: payload.database,
          collection: payload.collection,
          driveFolderId: payload.driveFolderId,
          driveFolderName: payload.driveFolderName,
          schedule: payload.schedule,
          enabled: payload.enabled,
          targetSshConnId: payload.targetSshConnId,
          depWarning: payload.depWarning || null
        })
      });
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
        if (payload.schedule !== 'manual' && payload.targetSshConnId) {
          const savedJob = data.data.find(j =>
            j.name === payload.name && j.connectionId === payload.connectionId
          );
          if (savedJob) {
            try {
              const cronRes = await apiFetch('/api/mongo-sync/cron', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: savedJob.id,
                  jobName: savedJob.name,
                  schedule: payload.schedule,
                  targetSshConnId: payload.targetSshConnId,
                  connectionId: payload.connectionId,
                  database: payload.database,
                  collection: payload.collection,
                  driveFolderId: payload.driveFolderId
                })
              });
              const cronData = await cronRes.json();
              if (cronData.success) {
                if (cronData.probeWarnings && cronData.probeWarnings.length > 0) {
                  // Install succeeded but preflight found issues — show them prominently
                  addNotification({
                    title: '⚠️ Schedule Installed — Preflight Warnings',
                    message: `Cron installed (${cronData.humanSchedule}) but preflight detected:\n${cronData.probeWarnings.map(w => `• ${w}`).join('\n')}`,
                    type: 'warning'
                  });
                } else {
                  addNotification({
                    title: payload.isEdit ? 'Job Updated' : 'Job Created',
                    message: `✅ Schedule installed on SSH server — ${cronData.humanSchedule}. Preflight checks passed.`,
                    type: 'success'
                  });
                }
              } else {
                addNotification({
                  title: 'Job Saved (Cron Failed)',
                  message: `Job saved but cron install failed: ${cronData.error}`,
                  type: 'warning'
                });
              }
            } catch (cronErr) {
              addNotification({
                title: 'Job Saved (Cron Error)',
                message: `Job saved but cron install error: ${cronErr.message}`,
                type: 'warning'
              });
            }
          }
        } else {
          addNotification({
            title: payload.isEdit ? 'Job Updated' : 'Job Created',
            message: 'Job saved as manual-only (no scheduled cron).',
            type: 'success'
          });
        }
        resetJobForm();
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
    setTargetSshConnId('');
    setJobDbName('monitor');
    setJobCollName('');
    setJobFolderId('');
    setJobFolderName('');
    setJobSchedule('daily');
    setJobEnabled(true);
    setEditingJobId(null);
    setDriveBrowseVisible(false);
    setDriveBrowsePath([{ id: 'root', name: 'My Drive' }]);
    setDriveBrowseFolders([]);
  };

  const handleEditJob = (job) => {
    setActiveTab('jobs'); // Switch to jobs tab so form is visible
    setEditingJobId(job.id);
    setJobName(job.name);
    setJobConnId(job.connectionId);
    setTargetSshConnId(job.targetSshConnId || '');
    setJobDbName(job.database);
    setJobCollName(job.collection);
    setJobFolderId(job.driveFolderId);
    setJobFolderName(job.driveFolderName || '');
    setRestoreFolderName(job.driveFolderName || '');
    setJobSchedule(job.schedule);
    setJobEnabled(job.enabled);
    // Scroll form into view after a short delay for tab animation
    setTimeout(() => {
      const formEl = document.querySelector('form[onsubmit]');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const handleDeleteJob = async (id) => {
    if (!confirm('Are you sure you want to delete this sync job?')) return;
    const job = jobs.find(j => j.id === id);
    try {
      // If job has a scheduled cron on an SSH server, remove it first
      if (job?.targetSshConnId && job?.schedule !== 'manual') {
        try {
          await apiFetch('/api/mongo-sync/cron', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: id, targetSshConnId: job.targetSshConnId })
          });
        } catch (cronErr) {
          console.warn('Could not remove cron from SSH server:', cronErr.message);
        }
      }
      const res = await apiFetch(`/api/mongo-sync/jobs?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
        addNotification({ title: 'Job Deleted', message: 'Sync job and remote cron schedule removed.', type: 'info' });
      }
    } catch (err) {
      addNotification({ title: 'Delete Failed', message: err.message, type: 'error' });
    }
  };

  const handleRunJob = async (id) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/mongo-sync/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Backup Successful', message: data.message, type: 'success' });
        fetchJobs();
      } else {
        throw new Error(data.message || 'Unknown error');
      }
    } catch (err) {
      addNotification({ title: 'Backup Failed', message: err.message, type: 'error' });
      fetchJobs();
    } finally {
      setLoading(false);
    }
  };

  const handleSyncSshStatus = async (job) => {
    if (!job.targetSshConnId) {
      addNotification({ title: 'No SSH Server', message: 'This job is not configured to run on an SSH server.', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/mongo-sync/cron?jobId=${job.id}&targetSshConnId=${job.targetSshConnId}&fetchLogs=1`);
      const data = await res.json();
      if (data.success) {
        if (!data.installed) {
          addNotification({ title: 'Cron Not Installed', message: 'Cron job is not installed on the target SSH server.', type: 'warning' });
        } else if (data.lastRunFromLog) {
          addNotification({ 
            title: 'SSH Status Synced', 
            message: `Latest SSH execution: ${new Date(data.lastRunFromLog).toLocaleString()}`, 
            type: 'info' 
          });
          // Update local state with latest SSH lastRun time
          setJobs(prevJobs => prevJobs.map(j => j.id === job.id ? { 
            ...j, 
            lastRun: new Date(data.lastRunFromLog).getTime(),
            lastStatus: 'success',
            lastMessage: `Cron executed on SSH server (Log: ${data.latestLogFile || 'active'})`
          } : j));
        } else {
          addNotification({ title: 'No Log Found', message: 'Cron is installed on SSH server, but no execution log was found yet.', type: 'info' });
        }
      } else {
        throw new Error(data.error || 'Failed to sync SSH cron status');
      }
    } catch (err) {
      addNotification({ title: 'Sync Error', message: err.message, type: 'error' });
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
          setSelectedFileId('ALL');
          setRestoreCollName(ALL_COLLECTIONS);
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

  const handleDriveBrowseFolders = async (parentId = null) => {
    setDriveBrowseLoading(true);
    try {
      const url = parentId ? `/api/mongo-sync/gdrive/folders?parentId=${parentId}` : '/api/mongo-sync/gdrive/folders';
      const res = await apiFetch(url);
      const data = await res.json();
      if (data.success) {
        setDriveBrowseFolders(data.folders || []);
      }
    } catch (err) {
      console.error('Failed to load drive folders:', err);
    } finally {
      setDriveBrowseLoading(false);
    }
  };

  const openDriveBrowser = (mode = 'job') => {
    setDriveBrowseMode(mode);
    setDriveBrowseVisible(true);
    setDriveBrowsePath([{ id: 'root', name: 'My Drive' }]);
    setDriveBrowseFolders([]);
    handleDriveBrowseFolders();
  };

  const navigateDriveFolder = async (folder) => {
    if (folder.id === 'root') {
      setDriveBrowsePath([{ id: 'root', name: 'My Drive' }]);
      await handleDriveBrowseFolders();
      return;
    }
    const nextPath = [...driveBrowsePath];
    const existingIndex = nextPath.findIndex(p => p.id === folder.id);
    if (existingIndex !== -1) {
      setDriveBrowsePath(nextPath.slice(0, existingIndex + 1));
    } else {
      setDriveBrowsePath([...nextPath, folder]);
    }
    await handleDriveBrowseFolders(folder.id);
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
    if (fileId === 'ALL') {
      setRestoreCollName(ALL_COLLECTIONS);
      return;
    }
    const file = backupFiles.find(f => f.id === fileId);
    if (!file) return;
    const cleanName = file.name.replace(/\.json$/i, '');
    const parts = cleanName.split('_');
    if (parts.length >= 3 && parts[0] === 'backup') {
      setRestoreDbName(parts[1]);
      setRestoreCollName(parts[2]);
    } else if (cleanName) {
      setRestoreCollName(cleanName);
    }
  };

  const handleDriveFolderSelect = (folder) => {
    if (driveBrowseMode === 'job') {
      setJobFolderId(folder.id);
      setJobFolderName(folder.name);
    } else {
      setRestoreFolderId(folder.id);
      setRestoreFolderName(folder.name);
    }
    setDriveBrowseVisible(false);
  };

  const handleJobFolderInputChange = (value) => {
    setJobFolderName(value);
    setJobFolderInputActive(true);
    const pool = driveAllFolders.length > 0 ? driveAllFolders : driveFolders;
    const q = value.toLowerCase().replace(/\s*\/\s*/g, '/');
    const filtered = pool.filter(f => {
      const name = f.name.toLowerCase();
      const path = (f.path || '').toLowerCase().replace(/\s*\/\s*/g, '/');
      return name.includes(q) || path.includes(q);
    });
    setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : pool);
    setJobFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
    const qNorm = value.toLowerCase().replace(/\s*\/\s*/g, '/');
    const exact = pool.find(f =>
      (f.path || f.name).toLowerCase().replace(/\s*\/\s*/g, '/') === qNorm ||
      f.name.toLowerCase() === value.toLowerCase()
    );
    if (exact) setJobFolderId(exact.id);
  };

  const handleSelectJobFolder = (folder) => {
    setJobFolderId(folder.id);
    setJobFolderName(folder.path || folder.name);
    setJobFolderInputActive(false);
    setJobFolderSelectedIndex(-1);
    setFilteredDriveFolderOptions([]);
  };

  const handleJobFolderInputBlur = () => {
    setTimeout(() => {
      setJobFolderInputActive(false);
      setJobFolderSelectedIndex(-1);
    }, 150);
  };

  const handleJobFolderKeyDown = (e) => {
    if (!jobFolderInputActive || filteredDriveFolderOptions.length === 0) {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setJobFolderInputActive(true);
        const filtered = driveFolders.filter(f => f.name.toLowerCase().includes(jobFolderName.toLowerCase()));
        setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : driveFolders);
        setJobFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const idxToUse = jobFolderSelectedIndex >= 0 ? jobFolderSelectedIndex : 0;
      if (filteredDriveFolderOptions[idxToUse]) {
        handleSelectJobFolder(filteredDriveFolderOptions[idxToUse]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIdx = jobFolderSelectedIndex < filteredDriveFolderOptions.length - 1 ? jobFolderSelectedIndex + 1 : 0;
      setJobFolderSelectedIndex(newIdx);
      // Scroll into view
      setTimeout(() => {
        const dropdown = jobFolderDropdownRef.current;
        if (dropdown) {
          const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
          if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 10);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIdx = jobFolderSelectedIndex > 0 ? jobFolderSelectedIndex - 1 : filteredDriveFolderOptions.length - 1;
      setJobFolderSelectedIndex(newIdx);
      // Scroll into view
      setTimeout(() => {
        const dropdown = jobFolderDropdownRef.current;
        if (dropdown) {
          const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
          if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 10);
    } else if (e.key === 'Enter' && jobFolderSelectedIndex >= 0) {
      e.preventDefault();
      handleSelectJobFolder(filteredDriveFolderOptions[jobFolderSelectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setJobFolderInputActive(false);
      setJobFolderSelectedIndex(-1);
    }
  };

  const handleRestoreFolderInputChange = (value) => {
    setRestoreFolderName(value);
    setRestoreFolderInputActive(true);
    const pool = driveAllFolders.length > 0 ? driveAllFolders : driveFolders;
    const q = value.toLowerCase().replace(/\s*\/\s*/g, '/');
    const filtered = pool.filter(f => {
      const name = f.name.toLowerCase();
      const path = (f.path || '').toLowerCase().replace(/\s*\/\s*/g, '/');
      return name.includes(q) || path.includes(q);
    });
    setFilteredRestoreFolderOptions(filtered.length > 0 ? filtered : pool);
    setRestoreFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
    const qNorm = value.toLowerCase().replace(/\s*\/\s*/g, '/');
    const exact = pool.find(f =>
      (f.path || f.name).toLowerCase().replace(/\s*\/\s*/g, '/') === qNorm ||
      f.name.toLowerCase() === value.toLowerCase()
    );
    if (exact) setRestoreFolderId(exact.id);
  };

  const handleSelectRestoreFolder = (folder) => {
    setRestoreFolderId(folder.id);
    setRestoreFolderName(folder.path || folder.name);
    setRestoreFolderInputActive(false);
    setRestoreFolderSelectedIndex(-1);
    setFilteredRestoreFolderOptions([]);
  };

  const handleRestoreFolderInputBlur = () => {
    setTimeout(() => {
      setRestoreFolderInputActive(false);
      setRestoreFolderSelectedIndex(-1);
    }, 150);
  };

  const handleRestoreFolderKeyDown = (e) => {
    if (!restoreFolderInputActive || filteredRestoreFolderOptions.length === 0) {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setRestoreFolderInputActive(true);
        const filtered = driveFolders.filter(f => f.name.toLowerCase().includes(restoreFolderName.toLowerCase()));
        setFilteredRestoreFolderOptions(filtered.length > 0 ? filtered : driveFolders);
        setRestoreFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const idxToUse = restoreFolderSelectedIndex >= 0 ? restoreFolderSelectedIndex : 0;
      if (filteredRestoreFolderOptions[idxToUse]) {
        handleSelectRestoreFolder(filteredRestoreFolderOptions[idxToUse]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIdx = restoreFolderSelectedIndex < filteredRestoreFolderOptions.length - 1 ? restoreFolderSelectedIndex + 1 : 0;
      setRestoreFolderSelectedIndex(newIdx);
      // Scroll into view
      setTimeout(() => {
        const dropdown = restoreFolderDropdownRef.current;
        if (dropdown) {
          const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
          if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 10);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIdx = restoreFolderSelectedIndex > 0 ? restoreFolderSelectedIndex - 1 : filteredRestoreFolderOptions.length - 1;
      setRestoreFolderSelectedIndex(newIdx);
      // Scroll into view
      setTimeout(() => {
        const dropdown = restoreFolderDropdownRef.current;
        if (dropdown) {
          const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
          if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 10);
    } else if (e.key === 'Enter' && restoreFolderSelectedIndex >= 0) {
      e.preventDefault();
      handleSelectRestoreFolder(filteredRestoreFolderOptions[restoreFolderSelectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setRestoreFolderInputActive(false);
      setRestoreFolderSelectedIndex(-1);
    }
  };

  const executeRestore = async () => {
    if (!selectedFileId || !restoreDbName.trim()) return;
    const selectedFile = backupFiles.find(f => f.id === selectedFileId);
    const isAllColBackup = selectedFileId === 'ALL' || selectedFile?.name?.includes('ALL_COLLECTIONS');
    const collectionLabel = isAllColBackup ? `ALL ${backupFiles.length} collections` : `"${restoreCollName}"`;
    
    if (!confirm(`Are you sure you want to restore data from Google Drive into ${collectionLabel} in database "${restoreDbName}"? This will run in ${restoreMode} mode.`)) return;

    setLoading(true);

    const filesToProcess = selectedFileId === 'ALL' 
      ? backupFiles.filter(f => f.name && f.name.endsWith('.json'))
      : selectedFile ? [selectedFile] : [];

    if (filesToProcess.length === 0) {
      addNotification({ title: 'No Files', message: 'No valid JSON files found to restore.', type: 'warning' });
      setLoading(false);
      return;
    }

    setRestoreProgress({
      active: true,
      total: filesToProcess.length,
      current: 1,
      percent: 0,
      currentFile: filesToProcess[0].name,
      processedFiles: []
    });

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalMatched = 0;
    let totalDocsProcessed = 0;
    const processedLog = [];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const currentPercent = Math.round(((i + 1) / filesToProcess.length) * 100);

      setRestoreProgress(prev => ({
        ...prev,
        current: i + 1,
        percent: currentPercent,
        currentFile: file.name
      }));

      try {
        const cleanName = file.name.replace(/\.json$/i, '');
        const parts = cleanName.split('_');
        const collName = parts.length >= 3 && parts[0] === 'backup' ? parts[2] : cleanName;

        const res = await apiFetch('/api/mongo-sync/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: file.id,
            fileName: file.name,
            connectionId: restoreConnId,
            database: restoreDbName.trim(),
            collection: selectedFileId === 'ALL' ? collName : restoreCollName.trim(),
            mode: restoreMode
          })
        });

        const data = await res.json();
        if (data.success) {
          totalInserted += data.insertedCount || 0;
          totalUpdated += data.updatedCount || 0;
          totalMatched += data.matchedCount || 0;
          totalDocsProcessed += data.totalCount || 0;

          const logItem = {
            name: file.name,
            success: true,
            count: data.totalCount || 0,
            inserted: data.insertedCount || 0,
            updated: data.updatedCount || 0,
            matched: data.matchedCount || 0
          };
          processedLog.push(logItem);
          setRestoreProgress(prev => ({
            ...prev,
            processedFiles: [logItem, ...prev.processedFiles]
          }));
        } else {
          const logItem = { name: file.name, success: false, error: data.error || 'Failed' };
          processedLog.push(logItem);
          setRestoreProgress(prev => ({
            ...prev,
            processedFiles: [logItem, ...prev.processedFiles]
          }));
        }
      } catch (err) {
        const logItem = { name: file.name, success: false, error: err.message };
        processedLog.push(logItem);
        setRestoreProgress(prev => ({
          ...prev,
          processedFiles: [logItem, ...prev.processedFiles]
        }));
      }
    }

    setRestoreProgress(null);
    setLoading(false);

    const buildMsg = () => {
      if (totalInserted > 0 || totalUpdated > 0) {
        return `Successfully restored ${totalInserted + totalUpdated + totalMatched} documents (${totalInserted} new, ${totalUpdated} updated, ${totalMatched} existing) across ${filesToProcess.length} collection file(s).`;
      } else if (totalDocsProcessed > 0) {
        return `All ${totalDocsProcessed} documents across ${filesToProcess.length} collection file(s) already match existing records in MongoDB (0 modified).`;
      } else {
        return `Checked ${filesToProcess.length} backup file(s), but no documents were found to import.`;
      }
    };

    setRestoreResult({
      success: true,
      database: restoreDbName.trim(),
      collection: isAllColBackup ? `All Collections (${filesToProcess.length} files)` : restoreCollName.trim(),
      mode: restoreMode,
      insertedCount: totalInserted,
      updatedCount: totalUpdated,
      matchedCount: totalMatched,
      totalCount: totalDocsProcessed,
      message: buildMsg(),
      timestamp: new Date().toLocaleString(),
      folderName: restoreFolderName,
      processedLog
    });
  };

  return (
    <div className="flex h-full w-full bg-transparent text-[var(--text-primary)] border-[var(--border-color)] overflow-hidden font-sans">

      {/* ── Real-Time Live Restore Progress Modal ──────────────────────────── */}
      <AnimatePresence>
        {restoreProgress && restoreProgress.active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className="w-full max-w-lg rounded-3xl border border-emerald-500/30 bg-[var(--bg-card)] p-6 shadow-2xl overflow-hidden"
              style={{
                boxShadow: '0 0 60px rgba(52,211,153,0.15), 0 25px 50px rgba(0,0,0,0.6)'
              }}
            >
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shadow-lg shrink-0">
                  <RefreshCw className="animate-spin text-emerald-400" size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-extrabold text-sm tracking-tight text-[var(--text-primary)]">Restoring Backup Data</h3>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    Processing file {restoreProgress.current} of {restoreProgress.total}...
                  </p>
                </div>
                <span className="text-2xl font-black text-emerald-400 shrink-0 font-mono">
                  {restoreProgress.percent}%
                </span>
              </div>

              {/* Progress bar container */}
              <div className="w-full h-3 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-4 border border-[var(--border-color)] p-0.5">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 rounded-full"
                  style={{ width: `${restoreProgress.percent}%` }}
                  transition={{ ease: 'easeOut', duration: 0.2 }}
                />
              </div>

              {/* Active File indicator */}
              <div className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 rounded-xl mb-4 flex items-center justify-between">
                <span className="truncate flex items-center gap-2">
                  <Loader size={12} className="animate-spin text-emerald-400 shrink-0" />
                  <span className="truncate">Active: <b className="text-emerald-200">{restoreProgress.currentFile}</b></span>
                </span>
                <span className="text-[10px] font-bold text-emerald-400 shrink-0 pl-2">
                  {restoreProgress.current}/{restoreProgress.total}
                </span>
              </div>

              {/* Live Processed Log list */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] px-1 flex justify-between">
                  <span>Processed Files ({restoreProgress.processedFiles.length})</span>
                  <span>Status</span>
                </div>
                <div className="max-h-44 overflow-y-auto custom-scrollbar border border-[var(--border-color)] bg-[var(--bg-tertiary)]/40 rounded-2xl p-2 space-y-1.5 font-mono text-[10px]">
                  {restoreProgress.processedFiles.map((f, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)]">
                      <span className="flex items-center gap-2 truncate text-[var(--text-secondary)]">
                        {f.success 
                          ? <CheckCircle size={13} className="text-emerald-400 shrink-0" /> 
                          : <XCircle size={13} className="text-red-400 shrink-0" />
                        }
                        <span className="truncate">{f.name}</span>
                      </span>
                      <span className="text-[9px] font-bold text-[var(--text-muted)] shrink-0 pl-2">
                        {f.success ? `${f.count || 0} docs` : 'Failed'}
                      </span>
                    </div>
                  ))}
                  {restoreProgress.processedFiles.length === 0 && (
                    <div className="text-center py-6 text-[10px] text-[var(--text-muted)] italic font-sans">
                      Starting file restoration...
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── macOS-style Restore Result Modal ──────────────────────────────── */}
      <AnimatePresence>
        {restoreResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            onClick={() => setRestoreResult(null)}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 30 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                borderColor: restoreResult.success ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)',
                boxShadow: restoreResult.success
                  ? '0 0 60px rgba(52,211,153,0.15), 0 25px 50px rgba(0,0,0,0.5)'
                  : '0 0 60px rgba(239,68,68,0.15), 0 25px 50px rgba(0,0,0,0.5)',
              }}
            >
              {/* Header stripe */}
              <div className={`px-6 pt-7 pb-5 text-center border-b border-[var(--border-color)] relative`}
                style={{ background: restoreResult.success ? 'rgba(52,211,153,0.06)' : 'rgba(239,68,68,0.06)' }}
              >
                <button
                  onClick={() => setRestoreResult(null)}
                  className="absolute top-4 right-4 w-7 h-7 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                >
                  <X size={13} />
                </button>

                {/* macOS traffic-light style icon */}
                <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg border ${
                  restoreResult.success
                    ? 'bg-emerald-500/15 border-emerald-500/30'
                    : 'bg-red-500/15 border-red-500/30'
                }`}>
                  {restoreResult.success
                    ? <CheckCircle size={32} className="text-emerald-400" />
                    : <XCircle size={32} className="text-red-400" />
                  }
                </div>

                <h2 className="text-base font-black tracking-tight text-[var(--text-primary)] mb-0.5">
                  {restoreResult.success ? 'Restore Complete' : 'Restore Failed'}
                </h2>
                <p className="text-[11px] text-[var(--text-muted)]">{restoreResult.timestamp}</p>
              </div>

              {/* Stats grid (only on success) */}
              {restoreResult.success && (
                <div className="grid grid-cols-3 gap-px bg-[var(--border-color)] border-b border-[var(--border-color)]">
                  {[
                    { label: 'New', value: restoreResult.insertedCount, icon: <Zap size={12} />, color: 'text-emerald-400' },
                    { label: 'Updated', value: restoreResult.updatedCount, icon: <TrendingUp size={12} />, color: 'text-blue-400' },
                    { label: 'Existing', value: restoreResult.matchedCount, icon: <Shield size={12} />, color: 'text-slate-400' },
                  ].map(stat => (
                    <div key={stat.label} className="flex flex-col items-center py-4 gap-1 bg-[var(--bg-card)]">
                      <span className={`flex items-center gap-1 ${stat.color} text-[10px] font-bold uppercase tracking-wider`}>
                        {stat.icon}{stat.label}
                      </span>
                      <span className={`text-2xl font-black ${stat.color}`}>{stat.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Details */}
              <div className="px-6 py-5 space-y-3">
                {restoreResult.success && (
                  <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Total Processed</span>
                    <span className="text-sm font-black text-[var(--text-primary)]">{restoreResult.totalCount} docs</span>
                  </div>
                )}
                {[
                  { label: 'Target DB', value: restoreResult.database },
                  { label: 'Collection', value: restoreResult.collection },
                  { label: 'Mode', value: restoreResult.mode === 'upsert' ? 'Upsert (Overwrite)' : 'Insert (Strict)' },
                  ...(restoreResult.folderName ? [{ label: 'Source Folder', value: restoreResult.folderName }] : []),
                ].map(row => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shrink-0">{row.label}</span>
                    <span className="text-[11px] font-mono text-[var(--text-secondary)] text-right truncate max-w-[200px]">{row.value}</span>
                  </div>
                ))}

                {/* Summary message */}
                <div className={`mt-1 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed border ${
                  restoreResult.success
                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/5 border-red-500/20 text-red-300'
                }`}>
                  {restoreResult.message}
                </div>

                {/* Per-file breakdown if batch restore */}
                {restoreResult.processedLog && restoreResult.processedLog.length > 0 && (
                  <div className="pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                      File Breakdown ({restoreResult.processedLog.length})
                    </span>
                    <div className="max-h-36 overflow-y-auto custom-scrollbar border border-[var(--border-color)] bg-[var(--bg-tertiary)]/40 rounded-xl p-1.5 space-y-1 font-mono text-[9px]">
                      {restoreResult.processedLog.map((f, idx) => (
                        <div key={idx} className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)]">
                          <span className="flex items-center gap-1.5 truncate text-[var(--text-secondary)]">
                            {f.success ? <CheckCircle size={10} className="text-emerald-400 shrink-0" /> : <XCircle size={10} className="text-red-400 shrink-0" />}
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="text-[9px] font-bold text-[var(--text-muted)] shrink-0 pl-2">
                            {f.count || 0} docs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer button */}
              <div className="px-6 pb-6">
                <button
                  onClick={() => setRestoreResult(null)}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all ${
                    restoreResult.success
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/25'
                      : 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/25'
                  }`}
                >
                  {restoreResult.success ? 'Done' : 'Close'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Live Install Terminal Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {installTerminal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className="w-full max-w-2xl rounded-3xl border border-emerald-500/20 bg-[#0d1117] shadow-2xl overflow-hidden"
              style={{ boxShadow: '0 0 80px rgba(52,211,153,0.08), 0 25px 50px rgba(0,0,0,0.7)' }}
            >
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#161b22]">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                </div>
                <span className="flex-1 text-center text-[11px] font-mono text-white/40">
                  mongosync — install-deps
                </span>
                {!installTerminal.done && (
                  <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    running...
                  </span>
                )}
                {installTerminal.done && (
                  <span className={`text-[10px] font-mono font-bold ${installTerminal.code === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {installTerminal.code === 0 ? '✅ done' : `❌ exit ${installTerminal.code}`}
                  </span>
                )}
              </div>

              {/* Terminal output */}
              <div
                ref={installTerminalRef}
                className="font-mono text-[11px] leading-relaxed p-4 overflow-y-auto bg-[#0d1117] text-green-300"
                style={{ height: '380px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              >
                {installTerminal.lines.length === 0 && (
                  <span className="text-white/30">
                    Connecting to SSH server
                    <span className="animate-pulse">...</span>
                    <br />
                    <span className="text-white/20 text-[10px]">(timeout in 2 min if unreachable)</span>
                  </span>
                )}
                {installTerminal.lines.map((line, i) => {
                  const color =
                    line.includes('✅') ? 'text-emerald-400' :
                    line.includes('❌') ? 'text-red-400' :
                    line.includes('⚠️') ? 'text-amber-400' :
                    line.includes('===') ? 'text-white font-bold' :
                    line.includes('---') ? 'text-blue-300' :
                    line.includes('Downloading') || line.includes('Trying') ? 'text-yellow-300' :
                    'text-green-300';
                  return (
                    <div key={i} className={color}>{line}</div>
                  );
                })}
                {!installTerminal.done && (
                  <span className="text-white/40 animate-pulse">█</span>
                )}
              </div>

              {/* Footer — smart status based on what actually installed */}
              {(() => {
                const lines = installTerminal.lines.join('\n');
                const hasMongoexport = lines.includes('✅ mongoexport');
                const hasShell = lines.includes('✅ mongosh') || lines.includes('✅ mongo:');
                const hasPymongo = lines.includes('✅ pymongo');
                const canList = hasShell || hasPymongo;
                const fullyReady = hasMongoexport && canList;
                const missingList = [];
                if (!hasMongoexport) missingList.push('mongoexport');
                if (!canList) missingList.push('mongosh or pymongo');

                return (
                  <div className="px-4 py-3 border-t border-white/5 bg-[#161b22] space-y-2">
                    {/* Status summary */}
                    {installTerminal.done && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-mono ${
                        fullyReady
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                          : hasMongoexport
                          ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                          : 'bg-red-500/10 border border-red-500/30 text-red-400'
                      }`}>
                        {fullyReady ? '✅' : hasMongoexport ? '⚠️' : '❌'}
                        <span className="flex-1">
                          {fullyReady
                            ? 'All dependencies ready. You can proceed.'
                            : hasMongoexport
                            ? 'mongoexport OK but no collection listing tool. "All Collections" jobs may fail.'
                            : 'Required tools missing. Cannot install cron until fixed.'}
                        </span>
                      </div>
                    )}

                    {/* Manual install instructions if anything failed */}
                    {installTerminal.done && missingList.length > 0 && (
                      <div className="bg-[#0d1117] border border-white/10 rounded-xl p-3 text-[10px] font-mono text-white/60 space-y-1">
                        <p className="text-white/40 font-bold uppercase tracking-wider mb-1.5">Manual install required on the SSH server:</p>
                        {!hasMongoexport && (
                          <p className="text-amber-300">
                            # mongoexport (mongodb-database-tools)<br/>
                            curl -fsSL https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.tgz | tar -xz -C /tmp && cp /tmp/mongodb-database-tools-*/bin/mongoexport ~/.local/bin/ && chmod +x ~/.local/bin/mongoexport
                          </p>
                        )}
                        {!canList && (
                          <p className="text-blue-300 mt-1">
                            # pymongo (recommended — python3 is already installed)<br/>
                            pip3 install pymongo --user
                          </p>
                        )}
                      </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setInstallTerminal(null)}
                        disabled={!installTerminal.done}
                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 border border-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {installTerminal.done ? 'Close' : 'Running...'}
                      </button>
                      {installTerminal.done && (
                        <button
                          disabled={!hasMongoexport}
                          onClick={async () => {
                            const payload = {
                              ...installTerminal.pendingJobPayload,
                              depWarning: fullyReady ? null : missingList.length > 0
                                ? 'Missing: ' + missingList.join(', ') + '. Install manually on SSH server.'
                                : null
                            };
                            setInstallTerminal(null);
                            await saveJobAndInstallCron(payload);
                          }}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            fullyReady
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/25'
                              : hasMongoexport
                              ? 'bg-amber-500 hover:bg-amber-400 text-black'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30 cursor-not-allowed'
                          }`}
                          title={!hasMongoexport ? 'Install mongoexport first before creating this job' : ''}
                        >
                          {fullyReady
                            ? '✅ Continue → Save & Install Cron'
                            : hasMongoexport
                            ? '⚠️ Continue (collection listing limited)'
                            : '❌ Cannot Continue — Install Tools First'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Dependency Pre-flight Check Modal ──────────────────────────────── */}
      <AnimatePresence>
        {depCheckModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)' }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-[var(--bg-card)] p-6 shadow-2xl"
              style={{ boxShadow: '0 0 60px rgba(245,158,11,0.12), 0 25px 50px rgba(0,0,0,0.6)' }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <ShieldAlert size={22} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-[var(--text-primary)]">Missing Dependencies Detected</h3>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Required tools not found on the target SSH server</p>
                </div>
                <button onClick={() => setDepCheckModal(null)} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Tool Status Grid */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {['mongoexport', 'mongosh', 'python3'].map(tool => {
                  const info = depCheckModal.status[tool];
                  const installed = info?.installed;
                  return (
                    <div key={tool} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono ${
                      installed
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}>
                      {installed
                        ? <CheckCircle size={13} className="shrink-0" />
                        : <XCircle size={13} className="shrink-0" />}
                      <span className="truncate">{tool}</span>
                    </div>
                  );
                })}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono ${
                  depCheckModal.status.mongosh?.installed || depCheckModal.status.mongo?.installed
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                }`}>
                  {depCheckModal.status.mongosh?.installed || depCheckModal.status.mongo?.installed
                    ? <CheckCircle size={13} className="shrink-0" />
                    : <AlertCircle size={13} className="shrink-0" />}
                  <span className="truncate">mongo shell</span>
                </div>
              </div>

              {/* What will be installed */}
              <div className="rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-3 mb-4 space-y-1.5">
                <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Auto-install plan</p>
                {depCheckModal.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span className="mt-0.5 shrink-0">
                      {rec.startsWith('⚠️') ? '⚠️' : rec.startsWith('ℹ️') ? 'ℹ️' : '✅'}
                    </span>
                    <span>{rec.replace(/^[⚠️ℹ️✅]\s*/, '')}</span>
                  </div>
                ))}
                {!depCheckModal.canAutoInstall && (
                  <p className="text-[11px] text-red-400 font-semibold mt-1">
                    ⚠️ Cannot auto-install. Please install manually before creating this job.
                  </p>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setDepCheckModal(null)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-all"
                >
                  Cancel
                </button>
                <button
                  disabled={!depCheckModal.canAutoInstall}
                  onClick={async () => {
                    const payload = depCheckModal.pendingJobPayload;
                    const sshConnId = payload.targetSshConnId;
                    setDepCheckModal(null);
                    // Open live terminal and stream install output
                    setInstallTerminal({ lines: [], done: false, code: null, pendingJobPayload: payload });
                    try {
                      const res = await apiFetch('/api/mongo-sync/install-deps', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetSshConnId: sshConnId })
                      });
                      const reader = res.body.getReader();
                      const decoder = new TextDecoder();
                      let buf = '';
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        const parts = buf.split('\n\n');
                        buf = parts.pop();
                        for (const part of parts) {
                          const dataLine = part.replace(/^data: /, '').trim();
                          if (!dataLine) continue;
                          try {
                            const msg = JSON.parse(dataLine);
                            if (msg.line !== undefined) {
                              setInstallTerminal(prev => {
                                const next = { ...prev, lines: [...prev.lines, msg.line] };
                                setTimeout(() => {
                                  if (installTerminalRef.current) {
                                    installTerminalRef.current.scrollTop = installTerminalRef.current.scrollHeight;
                                  }
                                }, 20);
                                return next;
                              });
                            }
                            if (msg.done) {
                              setInstallTerminal(prev => ({ ...prev, done: true, code: msg.code }));
                            }
                          } catch {}
                        }
                      }
                    } catch (err) {
                      setInstallTerminal(prev => ({ ...prev, lines: [...prev.lines, `❌ Error: ${err.message}`], done: true, code: 1 }));
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {depCheckModal.canAutoInstall ? 'Install & Continue' : 'Cannot Auto-install'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
            disabled={!driveConnected}
            title={!driveConnected ? 'Please connect Google Drive first' : ''}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              !driveConnected
                ? 'opacity-40 cursor-not-allowed border border-transparent text-[var(--text-muted)]'
                : activeTab === 'jobs'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm'
                : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <RefreshCw size={14} />
            <span>Sync Jobs</span>
          </button>
          <button
            onClick={() => {
              if (!driveConnected) return;
              setActiveTab('restore');
              if (restoreFolderId) fetchBackups(restoreFolderId);
            }}
            disabled={!driveConnected}
            title={!driveConnected ? 'Please connect Google Drive first' : ''}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              !driveConnected
                ? 'opacity-40 cursor-not-allowed border border-transparent text-[var(--text-muted)]'
                : activeTab === 'restore'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm'
                : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <History size={14} />
            <span>Restore Backup</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('history');
              fetchHistory();
              fetchAllCronLogs();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'history' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Clock size={14} />
            <span>Execution History</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('failover');
              fetchReplicaSetStatus(rsConnId);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'failover' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <ShieldAlert size={14} />
            <span>Failover & Replica Set</span>
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
                        <CustomSelect
                          value={importConnId}
                          onChange={(val) => setImportConnId(val)}
                          options={dbConnections.map(c => ({ value: c._id, label: c.name }))}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                          <span>Target Database</span>
                          {importFetchingDbs && <Loader size={10} className="animate-spin text-emerald-400" />}
                        </label>
                        {importFetchedDbs.length > 0 ? (
                          <CustomSelect
                            value={importDbName}
                            onChange={(val) => setImportDbName(val)}
                            options={importFetchedDbs.map(db => ({ value: db, label: db }))}
                          />
                        ) : (
                          <input
                            type="text"
                            value={importDbName}
                            onChange={(e) => setImportDbName(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                            placeholder="e.g. monitor"
                          />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                          <span>Target Collection Name</span>
                          {importFetchingColls && <Loader size={10} className="animate-spin text-emerald-400" />}
                        </label>
                        {importFetchedColls.length > 0 ? (
                          <CustomSelect
                            value={importCollName}
                            onChange={(val) => setImportCollName(val)}
                            options={importFetchedColls.map(c => ({ value: c, label: c }))}
                          />
                        ) : (
                          <input
                            type="text"
                            value={importCollName}
                            onChange={(e) => setImportCollName(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)]"
                            placeholder="e.g. connections"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Import Mode</label>
                        <CustomSelect
                          value={importMode}
                          onChange={(val) => setImportMode(val)}
                          options={[
                            { value: 'insert', label: 'Insert (Fail on duplicate ID)' },
                            { value: 'upsert', label: 'Upsert (Overwrite matching ID)' }
                          ]}
                        />
                      </div>
                    </div>

                    {/* Batch Import Mode Toggle */}
                    <div className="flex items-center justify-between p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="batchMode"
                          checked={batchImportMode}
                          onChange={(e) => {
                            setBatchImportMode(e.target.checked);
                            setBatchFiles([]);
                            setImportFile(null);
                            setImportFileData(null);
                            setImportLogs([]);
                          }}
                          className="w-4 h-4 rounded border-blue-500/30 bg-[var(--bg-tertiary)] checked:bg-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                        <label htmlFor="batchMode" className="text-xs font-bold text-blue-400 cursor-pointer">
                          Batch Import Mode
                        </label>
                      </div>
                      <span className="text-[10px] text-blue-400/60">
                        {batchImportMode ? 'Multi-file: auto-map filename → collection' : 'Single file: manual collection name'}
                      </span>
                    </div>

                    {/* Drag and Drop Zone */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                        {batchImportMode ? 'Backup JSON Files (Multiple)' : 'Backup JSON File'}
                      </label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-[var(--border-color)] hover:border-emerald-500/40 bg-[var(--bg-tertiary)]/20 hover:bg-emerald-500/5 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".json"
                          multiple={batchImportMode}
                          className="hidden"
                          onChange={handleFileChange}
                        />
                        <Upload className="text-[var(--text-muted)] group-hover:text-emerald-400 transition-colors" size={28} />
                        <span className="text-xs font-bold">
                          {batchImportMode 
                            ? (batchFiles.length > 0 ? `${batchFiles.length} file(s) selected` : 'Select or drag JSON files')
                            : (importFile ? importFile.name : 'Select or drag JSON collection file')
                          }
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {batchImportMode
                            ? 'Filenames will auto-map to collection names (e.g., users.json → users)'
                            : (importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : 'Must contain a top-level array of documents')
                          }
                        </span>
                      </div>

                      {/* Batch Files List */}
                      {batchImportMode && batchFiles.length > 0 && (
                        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                          {batchFiles.map((fileObj, idx) => (
                            <div
                              key={idx}
                              className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
                                fileObj.error
                                  ? 'bg-red-500/5 border-red-500/20'
                                  : 'bg-emerald-500/5 border-emerald-500/20'
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {fileObj.error ? (
                                  <XCircle size={14} className="text-red-400 shrink-0" />
                                ) : (
                                  <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                )}
                                <span className="font-mono truncate">{fileObj.name}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {fileObj.error ? (
                                  <span className="text-[10px] text-red-400">{fileObj.error}</span>
                                ) : (
                                  <>
                                    <ArrowRight size={12} className="text-[var(--text-muted)]" />
                                    <span className="font-bold text-emerald-400">{fileObj.collection}</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">({fileObj.size} docs)</span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={executeImport}
                      disabled={
                        batchImporting ||
                        (batchImportMode
                          ? batchFiles.filter(f => f.data).length === 0
                          : (loading || !importFileData || !importCollName.trim()))
                      }
                      className="w-full btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
                    >
                      {(loading || batchImporting) ? (
                        <>
                          <Loader size={14} className="animate-spin" />
                          <span>{batchImportMode ? 'Importing files...' : 'Importing documents...'}</span>
                        </>
                      ) : (
                        <>
                          <Play size={14} />
                          <span>
                            {batchImportMode
                              ? `Import ${batchFiles.filter(f => f.data).length} Collection(s)`
                              : 'Import Collection'
                            }
                          </span>
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

                {/* 1. OAuth Client Credentials — full width, do this first */}
                <div className="bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)] space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <Key className="text-amber-400" size={16} /> 1. Connect with Google Cloud
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                        To link Google Drive, you need a free <strong>Client ID</strong> and <strong>Client Secret</strong> from Google Cloud. It only takes a few minutes — follow the steps below.
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">Saved securely</span>
                  </div>

                  {/* Step-by-step guide */}
                  <div className="border border-[var(--border-color)] rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowCredGuide(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--bg-tertiary)]/40 hover:bg-[var(--bg-tertiary)]/70 transition-colors"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">How to get your credentials</span>
                      <div className="flex items-center gap-2">
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Open Console <ExternalLink size={10} />
                        </a>
                        <ChevronDown size={13} className={`text-[var(--text-muted)] transition-transform duration-200 ${showCredGuide ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {showCredGuide && (
                      <div className="p-4 space-y-3 bg-[var(--bg-tertiary)]/20">
                        {[
                          { step: 1, text: 'Go to', link: 'https://console.cloud.google.com', label: 'Google Cloud Console', after: 'and sign in with your Google account.' },
                          { step: 2, text: 'Create a new project (or select an existing one) from the top bar.' },
                          { step: 3, text: 'In the left menu go to', link: 'https://console.cloud.google.com/apis/library/drive.googleapis.com', label: 'APIs & Services → Library', after: ', search for "Google Drive API" and click Enable.' },
                          { step: 4, text: 'Go to', link: 'https://console.cloud.google.com/apis/credentials/consent', label: 'OAuth Consent Screen', after: '. Set User Type to External, fill in your app name, then save.' },
                          { step: 5, text: 'Go to', link: 'https://console.cloud.google.com/apis/credentials', label: 'Credentials', after: ', click + Create Credentials → OAuth Client ID → choose Web application.' },
                          { step: 6, text: 'Copy the Client ID and Client Secret shown — paste them into the fields below.' },
                        ].map(({ step, text, link, label, after }) => (
                          <div key={step} className="flex items-start gap-3">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{step}</span>
                            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                              {text}{' '}
                              {link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-semibold transition-colors">{label}</a>}
                              {after && <> {after}</>}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Credential inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1.5">Client ID</label>
                      <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxxxxxx-xxxx.apps.googleusercontent.com" className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1.5">Client Secret</label>
                      <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-xxxxxxxxxxxxxxxxxxxx" className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                    </div>
                    <button onClick={handleSaveCredentials} disabled={driveLoading || !clientId.trim() || !clientSecret.trim()} className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all">
                      {driveLoading ? <Loader className="animate-spin" size={12} /> : <><ShieldCheck size={13} /> Save &amp; Continue</>}
                    </button>
                  </div>

                  <p className="text-[10px] text-[var(--text-muted)] opacity-70 flex items-start gap-1.5">
                    <span className="text-amber-400 mt-0.5">💡</span>
                    After saving, click <strong className="text-[var(--text-primary)]">Link Google Drive</strong> in section 2 below to complete the connection.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                    <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
                      <CloudLightning className="text-emerald-400" size={16} /> 2. Link Your Google Account
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      Authenticate with your Google account to enable automated collection backups and cloud restore capabilities.
                    </p>

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
                      <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-3">
                        <div className="flex items-center gap-3">
                          <ShieldAlert className="text-amber-400" size={20} />
                          <div>
                            <div className="text-xs font-bold text-amber-400">Account Not Connected</div>
                            <div className="text-[10px] text-[var(--text-muted)]">Click below to authorize access to your Google Drive folder.</div>
                          </div>
                        </div>
                        <button
                          onClick={handleLinkDrive}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all"
                        >
                          <Cloud size={14} /> Link Google Drive
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Folders Management */}
                  <div className="bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)] flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold flex items-center gap-2">
                          <FolderPlus className="text-emerald-400" size={16} />
                          3. Dedicated Sync Folders
                        </h3>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                          Create a folder in your Google Drive to store automated JSON backups.
                        </p>
                      </div>
                      {driveFolders.length > 0 && (
                        <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          {driveFolders.length} folder{driveFolders.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Create new folder */}
                    <div className="bg-[var(--bg-tertiary)]/40 rounded-xl p-3 border border-[var(--border-color)]">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
                        Create New Folder
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !(!driveConnected || driveLoading || !newFolderName.trim()) && handleCreateFolder()}
                          className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none placeholder:text-[var(--text-muted)]"
                          placeholder="e.g. mongo-backups-prod"
                          disabled={!driveConnected || driveLoading}
                        />
                        <button
                          onClick={handleCreateFolder}
                          disabled={!driveConnected || driveLoading || !newFolderName.trim()}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                        >
                          {driveLoading ? <Loader className="animate-spin" size={12} /> : <><FolderPlus size={12} /> Create</>}
                        </button>
                      </div>
                    </div>

                    {/* Folder list */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
                        Available Folders
                      </label>
                      <div className="rounded-xl overflow-hidden border border-[var(--border-color)] flex-1 min-h-[140px] max-h-[200px] flex flex-col">
                        {driveFolders.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6 text-[var(--text-muted)]">
                            <Folder size={22} className="opacity-30" />
                            <p className="text-[11px] italic">
                              {driveConnected ? 'No folders yet — create one above.' : 'Connect Google Drive first.'}
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-y-auto custom-scrollbar divide-y divide-[var(--border-color)]">
                            {driveFolders.map((folder, i) => (
                              <div key={folder.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[var(--bg-card-hover)] transition-colors group">
                                <Folder size={13} className="text-amber-400 shrink-0" />
                                <span className="flex-1 text-xs font-semibold text-[var(--text-primary)] truncate">{folder.name}</span>
                                <span className="font-mono text-[9px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-color)] opacity-60 group-hover:opacity-100 transition-opacity truncate max-w-[100px]">
                                  {folder.id}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
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

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Job Form - Now takes half width (lg:col-span-1) for better readability */}
                  <form onSubmit={handleSaveJob} className="space-y-4 bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border-color)]">
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

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Source Connection</label>
                          <CustomSelect
                            value={jobConnId}
                            onChange={(val) => setJobConnId(val)}
                            options={dbConnections.map(c => ({ value: c._id, label: c.name }))}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                            <span>Database</span>
                            {fetchingDbs && <Loader size={10} className="animate-spin text-emerald-400" />}
                          </label>
                          <CustomSelect
                            value={jobDbName}
                            onChange={(val) => setJobDbName(val)}
                            options={[
                              ...(fetchedDbs.length !== 1 ? [{ value: ALL_DATABASES, label: ALL_DATABASES }] : []),
                              ...fetchedDbs.map(db => ({ value: db, label: db }))
                            ]}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                          <span>Collection</span>
                          {fetchingColls && <Loader size={10} className="animate-spin text-emerald-400" />}
                        </label>
                        <CustomSelect
                          value={jobCollName}
                          onChange={(val) => setJobCollName(val)}
                          options={Array.from(new Set([ALL_COLLECTIONS, ...fetchedColls])).map(c => ({ value: c, label: c }))}
                        />
                      </div>

                      {/* Drive Folder - Full width for better UX */}
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center gap-2">
                          <Cloud size={11} className="text-emerald-400" />
                          <span>Google Drive Target Folder</span>
                        </label>
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={jobFolderName}
                              onChange={(e) => handleJobFolderInputChange(e.target.value)}
                              onKeyDown={handleJobFolderKeyDown}
                              onFocus={() => {
                                setJobFolderInputActive(true);
                                const pool = driveAllFolders.length > 0 ? driveAllFolders : driveFolders;
                                const q = jobFolderName.toLowerCase().replace(/\s*\/\s*/g, '/');
                                const filtered = pool.filter(f => {
                                  const name = f.name.toLowerCase();
                                  const path = (f.path || '').toLowerCase().replace(/\s*\/\s*/g, '/');
                                  return name.includes(q) || path.includes(q);
                                });
                                setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : pool);
                                setJobFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
                              }}
                              onBlur={handleJobFolderInputBlur}
                              placeholder="Type to search or browse folders..."
                              className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                              required
                              disabled={!driveConnected}
                            />
                            {jobFolderInputActive && filteredDriveFolderOptions.length > 0 && (
                              <div ref={jobFolderDropdownRef} style={{ zIndex: 10000 }} className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
                                <div className="px-3 py-1 bg-[var(--bg-tertiary)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                                  <span>Folders ({filteredDriveFolderOptions.length})</span>
                                  <span className="text-emerald-400 font-semibold">Press <kbd className="bg-black/40 px-1 py-0.5 rounded text-white border border-[var(--border-color)]">Tab ⇥</kbd> or <kbd className="bg-black/40 px-1 py-0.5 rounded text-white border border-[var(--border-color)]">↵</kbd></span>
                                </div>
                                {filteredDriveFolderOptions.map((folder, idx) => {
                                  const isSelected = idx === jobFolderSelectedIndex;
                                  return (
                                    <div
                                      key={folder.id}
                                      data-index={idx}
                                      onClick={() => handleSelectJobFolder(folder)}
                                      onMouseEnter={() => {
                                        setJobFolderSelectedIndex(idx);
                                      }}
                                      className={`px-3 py-2 flex items-center gap-2 font-mono text-xs cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'bg-emerald-500/15 text-emerald-400 font-bold'
                                          : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                                      }`}
                                    >
                                      <Folder size={13} className="text-amber-400 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="truncate font-semibold">{folder.name}</div>
                                        {folder.path && folder.path !== folder.name && (
                                          <div className="text-[9px] text-[var(--text-muted)] truncate">{folder.path}</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => openDrivePicker('job')}
                            disabled={!driveConnected}
                            className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-400 hover:bg-emerald-500/15 transition-all flex items-center gap-2 shrink-0"
                          >
                            <FolderPlus size={14} />
                            Browse
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Schedule Mode</label>
                            <CustomSelect
                              value={jobSchedule === 'manual' ? 'manual' : 'scheduled'}
                              onChange={(val) => {
                                if (val === 'manual') {
                                  setJobSchedule('manual');
                                } else {
                                  if (jobSchedule === 'manual') setJobSchedule('0 18 * * *');
                                }
                              }}
                              options={[
                                { value: 'manual', label: 'Manual Only' },
                                { value: 'scheduled', label: 'Scheduled Cron ⏰' }
                              ]}
                            />
                          </div>
                          {jobSchedule !== 'manual' ? (
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block mb-1 flex items-center gap-1">
                                <Server size={10} /> Target SSH Server
                              </label>
                              <CustomSelect
                                value={targetSshConnId}
                                onChange={(val) => setTargetSshConnId(val)}
                                options={[
                                  { value: '', label: '(Select User SSH Server)' },
                                  ...sshConnections.map(c => ({ value: c._id, label: `${c.name} (${c.host})` }))
                                ]}
                              />
                            </div>
                          ) : (
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
                          )}
                        </div>

                        {jobSchedule !== 'manual' && (
                          <CronBuilder
                            value={jobSchedule}
                            onChange={(newCron) => setJobSchedule(newCron)}
                          />
                        )}
                      </div>

                      {jobSchedule !== 'manual' && (
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]/40">
                          <span className="text-[10px] text-[var(--text-muted)] font-mono">
                            ⚡ 100% User Resource Execution (Cron runs on target SSH server)
                          </span>
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
                      )}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="submit"
                        disabled={loading || depCheckLoading || !driveConnected || driveFolders.length === 0}
                        className="flex-1 btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40"
                      >
                        {loading || depCheckLoading ? <Loader className="animate-spin" size={14} /> : 'Save Job'}
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

                  {/* Jobs List - Now takes the other half of the layout */}
                  <div className="lg:col-span-1 space-y-3">
                    <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                      <Calendar className="text-emerald-400" size={16} /> 
                      Configured Sync Jobs ({jobs.length})
                    </h3>

                    <div className="space-y-3 max-h-[450px] overflow-y-auto custom-scrollbar pr-1">
                      {jobs.map(job => (
                        <div key={job.id} className="bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-emerald-500/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-sm">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-[var(--text-primary)] truncate max-w-[200px]" title={job.name}>{job.name}</span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${
                                job.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                                {job.schedule}
                              </span>
                              {job.targetSshConnId && job.schedule !== 'manual' && (() => {
                                const sshConn = sshConnections.find(c => c._id === job.targetSshConnId);
                                return sshConn ? (
                                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1 shrink-0">
                                    <Server size={8} />⚡ {sshConn.name}
                                  </span>
                                ) : null;
                              })()}
                              {(job.depWarning || (job.lastStatus === 'failed' && job.lastMessage?.includes('Could not list collections'))) && (
                                <span
                                  className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 shrink-0"
                                  title={job.depWarning || 'Collection listing failed — mongosh or pymongo not installed on SSH server. Run: pip3 install pymongo --user'}
                                >
                                  <AlertCircle size={8} />⚠️ deps missing
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-1.5 min-w-0 overflow-hidden">
                              <span className="truncate" title={`${job.connectionName} / ${job.database} / ${job.collection}`}>
                                {job.connectionName} / {job.database} / {job.collection}
                              </span>
                              <ArrowRight size={10} className="text-slate-500 shrink-0" />
                              <span className="truncate shrink-0 max-w-[120px]" title={job.driveFolderName}>{job.driveFolderName}</span>
                            </div>
                            {job.lastRun && (
                              <div className={`text-[9px] font-semibold flex items-center gap-1.5 min-w-0 ${
                                job.lastStatus === 'success' ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                <Clock size={9} className="shrink-0" />
                                <span className="shrink-0">Last Run: {new Date(job.lastRun).toLocaleString()}</span>
                                <span className="opacity-60 shrink-0">•</span>
                                <span className="truncate">{job.lastMessage}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {job.targetSshConnId && job.schedule !== 'manual' && (
                              <button
                                onClick={() => handleSyncSshStatus(job)}
                                disabled={loading}
                                className="p-2 bg-blue-500/10 hover:bg-blue-500/25 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 rounded-xl transition-all disabled:opacity-40"
                                title="Check & sync SSH execution log timestamp"
                              >
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setRestoreFolderId(job.driveFolderId);
                                setRestoreFolderName(job.driveFolderName);
                                setActiveTab('restore');
                                fetchBackups(job.driveFolderId);
                              }}
                              className="p-2 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 rounded-xl transition-all"
                              title="Navigate to backup files in Restore"
                            >
                              <FileJson size={14} />
                            </button>
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
                              title="Edit job config"
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
                        <div className="flex gap-2">
                          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] min-w-0">
                            <Folder size={13} className="text-amber-400 shrink-0" />
                            <span className={`text-xs font-mono truncate ${restoreFolderName ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] italic'}`}>
                              {restoreFolderName || 'No folder selected — click Browse'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openDrivePicker('restore')}
                            disabled={!driveConnected}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/15 transition-all flex items-center gap-1.5 shrink-0"
                          >
                            <Search size={12} /> Browse
                          </button>
                        </div>
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
                        <span>Select option to restore</span>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {backupFiles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleBackupFileSelect('ALL')}
                            className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex items-center justify-between border ${
                              selectedFileId === 'ALL' 
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm font-bold' 
                                : 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-semibold'
                            }`}
                          >
                            <span className="truncate flex-1 flex items-center gap-2">
                              <Database size={14} className="text-emerald-400 shrink-0" />
                              <span>All Collections (Batch Restore All {backupFiles.length} Files)</span>
                            </span>
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30 shrink-0">
                              ALL FILES
                            </span>
                          </button>
                        )}
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
                        <CustomSelect
                          value={restoreConnId}
                          onChange={(val) => setRestoreConnId(val)}
                          options={dbConnections.map(c => ({ value: c._id, label: c.name }))}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                          <span>Target Database</span>
                          {restoreFetchingDbs && <Loader size={10} className="animate-spin text-emerald-400" />}
                        </label>
                        <CustomSelect
                          value={restoreDbName}
                          onChange={(val) => setRestoreDbName(val)}
                          options={[
                            ...(restoreFetchedDbs.length !== 1 ? [{ value: ALL_DATABASES, label: ALL_DATABASES }] : []),
                            ...restoreFetchedDbs.map(db => ({ value: db, label: db }))
                          ]}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1 flex items-center justify-between">
                          <span>Target Collection</span>
                          {restoreFetchingColls && <Loader size={10} className="animate-spin text-emerald-400" />}
                        </label>
                        {selectedFileId === 'ALL' || backupFiles.find(f => f.id === selectedFileId)?.name?.includes('ALL_COLLECTIONS') ? (
                          <div className="input-field text-xs w-full bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-2 px-3 py-2 rounded-xl">
                            <CheckCircle size={12} />
                            <span>{selectedFileId === 'ALL' ? `All Collections (Restore All ${backupFiles.length} Files)` : 'All Collections (auto-detected)'}</span>
                          </div>
                        ) : (
                          <CustomSelect
                            value={restoreCollName}
                            onChange={(val) => setRestoreCollName(val)}
                            options={Array.from(new Set([ALL_COLLECTIONS, ...restoreFetchedColls])).map(c => ({ value: c, label: c }))}
                          />
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Restore Mode</label>
                        <CustomSelect
                          value={restoreMode}
                          onChange={(val) => setRestoreMode(val)}
                          options={[
                            { value: 'insert', label: 'Insert (Fail on duplicate ID)' },
                            { value: 'upsert', label: 'Upsert (Overwrite matching ID)' }
                          ]}
                        />
                      </div>
                    </div>

                    <button
                      onClick={executeRestore}
                      disabled={loading || !selectedFileId || !restoreDbName.trim()}
                      className="w-full btn-primary justify-center font-bold text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg mt-2"
                    >
                      {loading ? (
                        <>
                          <Loader className="animate-spin" size={14} />
                          <span>Restoring Data...</span>
                        </>
                      ) : (
                        <>
                          <History size={14} />
                          <span>{selectedFileId === 'ALL' ? `Execute Restore (All ${backupFiles.length} Collections)` : 'Execute Restore'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── EXECUTION HISTORY TAB ── */}
            {activeTab === 'history' && (
              <motion.div
                key="tab-history"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border-color)]">
                  <div>
                    <h2 className="text-xl font-black italic uppercase tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                      <Clock className="text-emerald-500" /> Backup Execution History
                    </h2>
                    <p className="text-xs text-[var(--text-muted)]">View real-time status and logs of manual and scheduled MongoDB sync jobs.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { fetchHistory(); fetchAllCronLogs(); }}
                      disabled={historyLoading}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} />
                      <span>Refresh</span>
                    </button>
                    <button
                      onClick={handleClearHistory}
                      disabled={historyLoading || historyRuns.length === 0}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>

                {/* ── SSH Cron Logs ── */}
                {jobs.filter(j => j.targetSshConnId && j.schedule !== 'manual').length > 0 && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold flex items-center gap-2 text-[var(--text-primary)]">
                      <Terminal size={14} className="text-blue-400" /> SSH Cron Execution Logs
                      <span className="text-[10px] font-normal text-[var(--text-muted)]">— from log files on remote servers</span>
                    </h3>
                    <div className="space-y-3">
                      {jobs.filter(j => j.targetSshConnId && j.schedule !== 'manual').map(job => {
                        const cronLog = cronLogs[job.id];
                        const sshConn = sshConnections.find(c => c._id === job.targetSshConnId);
                        // A successful run always contains "❌ Failed: 0" — that is NOT an error.
                        // hasError = true only when there's a real ERROR: line, or a ❌ line that
                        // isn't "Failed: 0" (meaning at least one upload/export actually failed).
                        const logLines = (cronLog?.logTail || '').split('\n');
                        const hasError = logLines.some(l =>
                          l.includes('ERROR:') ||
                          (l.includes('❌') && !l.includes('Failed: 0') && !l.includes(': 0'))
                        );
                        const hasDone = cronLog?.logTail?.includes('=== Done');
                        return (
                          <div key={job.id} className="rounded-xl border border-[var(--border-color)] overflow-hidden">
                            {/* Job header */}
                            <div className={`flex items-center justify-between px-3 py-2 text-[11px] ${
                              hasError ? 'bg-red-500/5 border-b border-red-500/20' :
                              hasDone ? 'bg-emerald-500/5 border-b border-emerald-500/20' :
                              'bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]'
                            }`}>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setCronLogExpanded(prev => {
                                      const currentState = prev[job.id] !== false; // Default to true (expanded)
                                      return { ...prev, [job.id]: !currentState };
                                    });
                                  }}
                                  className="p-0.5 hover:bg-white/5 rounded transition-all"
                                  title={(cronLogExpanded[job.id] !== false) ? 'Collapse' : 'Expand'}
                                >
                                  <ChevronDown
                                    size={14}
                                    className={`text-[var(--text-muted)] transition-transform ${(cronLogExpanded[job.id] !== false) ? '' : '-rotate-90'}`}
                                  />
                                </button>
                                <span className={`w-2 h-2 rounded-full ${hasError ? 'bg-red-400' : hasDone ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                <span className="font-bold text-[var(--text-primary)]">{job.name}</span>
                                <span className="text-[var(--text-muted)]">→</span>
                                <span className="font-mono text-[var(--text-muted)]">{job.database}/{job.collection}</span>
                                {sshConn && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    ⚡ {sshConn.name}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {cronLog?.lastRunFromLog && (
                                  <span className="text-[var(--text-muted)] font-mono">
                                    Last: {new Date(cronLog.lastRunFromLog).toLocaleString()}
                                  </span>
                                )}
                                <button
                                  onClick={() => fetchCronLog(job)}
                                  disabled={cronLogLoading[job.id]}
                                  className="px-2 py-0.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold border border-blue-500/20 flex items-center gap-1 transition-all"
                                >
                                  <RefreshCw size={10} className={cronLogLoading[job.id] ? 'animate-spin' : ''} />
                                  {cronLog ? 'Refresh' : 'Fetch Log'}
                                </button>
                              </div>
                            </div>
                            {/* Log output - collapsible */}
                            {cronLogExpanded[job.id] !== false && ( // default to expanded
                              cronLog?.logTail ? (
                                <pre className={`text-[10px] font-mono p-3 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed ${
                                  hasError ? 'bg-red-950/20 text-red-200' : hasDone ? 'bg-emerald-950/20 text-emerald-200' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                                }`}>
                                {cronLog.logTail.split('\n').map((line, i) => {
                                  const color =
                                    // "Failed: 0" is a success — show as muted, not red
                                    (line.includes('Failed: 0') || line.includes('❌ Failed: 0')) ? 'text-slate-400' :
                                    // Real errors: must have "ERROR:" (with colon) or a ❌ that isn't "Failed: 0"
                                    line.includes('ERROR:') || (line.includes('❌') && !line.includes('Failed: 0') && !line.includes(': 0')) ? 'text-red-400' :
                                    // Success indicators
                                    line.includes('=== Done') || line.includes('Uploaded:') || line.includes('✅') || line.includes('Success rate: 100%') ? 'text-emerald-400' :
                                    // Warnings
                                    line.includes('WARNING') || line.includes('⚠️') ? 'text-amber-400' :
                                    // Summary section headers
                                    line.includes('===') ? 'text-white font-bold' :
                                    '';
                                  return <span key={i} className={`block ${color}`}>{line}</span>;
                                })}
                              </pre>
                              ) : cronLogLoading[job.id] ? (
                                <div className="p-4 text-center text-[11px] text-[var(--text-muted)] flex items-center justify-center gap-2">
                                  <Loader size={12} className="animate-spin text-blue-400" /> Fetching log...
                                </div>
                              ) : (
                                <div className="p-4 text-center text-[11px] text-[var(--text-muted)] italic">
                                  Click "Fetch Log" to load the latest cron run output from the SSH server.
                                </div>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── In-app Manual Run History ── */}
                <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
                  <h3 className="text-sm font-bold flex items-center gap-2 mb-4 text-[var(--text-primary)]">
                    <Play size={14} className="text-emerald-400" /> Manual Run History
                    <span className="text-[10px] font-normal text-[var(--text-muted)]">— from in-app "Run Now" button</span>
                  </h3>
                  {historyLoading && historyRuns.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                      <Loader size={16} className="animate-spin text-emerald-400" />
                      <span>Loading execution history...</span>
                    </div>
                  ) : historyRuns.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--text-muted)] italic">
                      No manual run history yet. Use the "Run Now" button on a job to trigger a manual backup.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1 divide-y divide-[var(--border-color)]/40">
                      {historyRuns.map(run => (
                        <div key={run.id} className="pt-3 first:pt-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${run.status === 'success' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-rose-500'}`} />
                              <span className="font-bold text-xs text-[var(--text-primary)]">{run.jobName || 'Mongo Backup'}</span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                run.status === 'success' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              }`}>
                                {run.status}
                              </span>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              {new Date(run.runAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)] flex items-center justify-between gap-2">
                            <span>DB: <strong className="text-[var(--text-primary)]">{run.database}</strong> | Col: <strong className="text-[var(--text-primary)]">{run.collection}</strong></span>
                            {run.count !== undefined && <span className="text-emerald-400 font-bold">{run.count} docs</span>}
                          </div>
                          {run.message && (
                            <div className={`text-[11px] font-mono p-2.5 rounded-xl border leading-relaxed ${
                              run.status === 'success'
                                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                                : 'bg-red-500/5 border-red-500/20 text-red-300'
                            }`}>
                              {run.message}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── FAILOVER & REPLICA SET MANAGER TAB ── */}
            {activeTab === 'failover' && (
              <motion.div
                key="tab-failover"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                {/* Header controls & Target Database Connection */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[var(--bg-secondary)]/40 border border-[var(--border-color)]">
                  <div>
                    <h3 className="font-extrabold text-sm flex items-center gap-2 text-emerald-400">
                      <ShieldAlert size={16} />
                      <span>MongoDB Replica Set & Failover Manager</span>
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Monitor 3-node High Availability clusters, trigger one-click failover elections, or initialize new replica sets.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-[var(--text-muted)]">Cluster Target:</label>
                      <select
                        value={rsConnId}
                        onChange={(e) => {
                          setRsConnId(e.target.value);
                          fetchReplicaSetStatus(e.target.value);
                        }}
                        className="select-field text-xs bg-[var(--bg-tertiary)] py-1 px-2 font-mono"
                      >
                        {dbConnections.map(c => (
                          <option key={c._id} value={c._id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => fetchReplicaSetStatus(rsConnId)}
                      disabled={rsLoading}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-500/25 transition-all disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={rsLoading ? 'animate-spin' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {/* Loading / Status State */}
                {rsLoading && !rsData && (
                  <div className="p-8 text-center bg-[var(--bg-secondary)]/20 rounded-xl border border-[var(--border-color)]">
                    <Loader size={24} className="animate-spin text-emerald-400 mx-auto mb-2" />
                    <p className="text-xs text-[var(--text-muted)] font-medium">Inspecting MongoDB Replica Set status across nodes...</p>
                  </div>
                )}

                {/* Replica Set Active Status View */}
                {rsData?.isReplSet && (
                  <div className="space-y-5">
                    {/* Overview Banner */}
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-extrabold border border-emerald-500/30">
                          RS
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-[var(--text-primary)]">Replica Set: {rsData.setName}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              ACTIVE (HA)
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                            Connected Host: {rsData.me || 'Unknown'} | Primary Host: <strong className="text-emerald-400">{rsData.primary || 'Detecting...'}</strong>
                          </p>
                        </div>
                      </div>

                      {/* Primary Step-Down Action */}
                      <button
                        onClick={() => {
                          if (confirm('Trigger Primary Step-Down? The current primary will step down for 60 seconds to force an election.')) {
                            handleFailoverAction('stepDown', { stepDownSecs: 60 });
                          }
                        }}
                        disabled={rsActionLoading}
                        className="px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-2 hover:bg-amber-500/25 transition-all disabled:opacity-50 shadow-sm"
                      >
                        <ShieldAlert size={14} />
                        <span>Step Down Primary (Force Election)</span>
                      </button>
                    </div>

                    {/* Nodes Grid (Members) */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center justify-between">
                        <span>Cluster Member Nodes ({rsData.rsStatus?.members?.length || rsData.hosts?.length || 0})</span>
                        <span className="text-[10px] font-mono text-emerald-400">Auto-Election Enabled</span>
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(rsData.rsStatus?.members || (rsData.hosts || []).map((h, i) => ({ host: h, stateStr: h === rsData.primary ? 'PRIMARY' : 'SECONDARY', health: 1 }))).map((member, idx) => {
                          const isPrimary = member.stateStr === 'PRIMARY' || member.host === rsData.primary;
                          const isHealthy = member.health === 1 || member.health === undefined;
                          const priority = rsData.rsConfig?.members?.find(m => m.host === member.host || member.name === m.host)?.priority ?? (isPrimary ? 10 : 1);

                          return (
                            <div
                              key={member.id || member.host || idx}
                              className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                                isPrimary
                                  ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                                  : isHealthy
                                  ? 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)]'
                                  : 'bg-rose-500/10 border-rose-500/30'
                              }`}
                            >
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                                    isPrimary
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                      : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                  }`}>
                                    {member.stateStr || (isPrimary ? 'PRIMARY' : 'SECONDARY')}
                                  </span>

                                  <div className="flex items-center gap-1.5">
                                    <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500 animate-pulse'}`} />
                                    <span className="text-[10px] font-mono font-bold text-[var(--text-muted)]">
                                      {isHealthy ? 'Healthy' : 'Down'}
                                    </span>
                                  </div>
                                </div>

                                <div className="font-mono text-xs font-bold text-[var(--text-primary)] truncate" title={member.name || member.host}>
                                  {member.name || member.host}
                                </div>

                                <div className="mt-2 space-y-1 text-[11px] text-[var(--text-muted)] font-mono">
                                  <div className="flex justify-between">
                                    <span>Member ID:</span>
                                    <span className="font-bold text-[var(--text-primary)]">#{member._id ?? idx}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Election Priority:</span>
                                    <span className="font-bold text-amber-400">{priority}</span>
                                  </div>
                                  {member.pingMs !== undefined && (
                                    <div className="flex justify-between">
                                      <span>Latency:</span>
                                      <span className="font-bold text-emerald-400">{member.pingMs}ms</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Action: Failover Promote to Primary */}
                              {!isPrimary && (
                                <button
                                  onClick={() => {
                                    if (confirm(`Promote node ${member.name || member.host} to Primary? This will update priority to 10 and trigger failover.`)) {
                                      handleFailoverAction('promoteNode', { targetHost: member.name || member.host });
                                    }
                                  }}
                                  disabled={rsActionLoading}
                                  className="w-full py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-500/25 transition-all disabled:opacity-50 mt-2"
                                >
                                  <CloudLightning size={12} />
                                  <span>Promote to Primary</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Manage Nodes (Add / Remove) */}
                    <div className="p-4 rounded-xl bg-[var(--bg-secondary)]/30 border border-[var(--border-color)] space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Add Member Node to Cluster</h4>
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={addNodeHost}
                          onChange={(e) => setAddNodeHost(e.target.value)}
                          placeholder="e.g. 192.168.1.102:27017"
                          className="input-field text-xs bg-[var(--bg-tertiary)] flex-1 font-mono"
                        />
                        <button
                          onClick={() => {
                            if (!addNodeHost.trim()) return;
                            handleFailoverAction('addMember', { targetHost: addNodeHost.trim() });
                            setAddNodeHost('');
                          }}
                          disabled={rsActionLoading || !addNodeHost.trim()}
                          className="btn-primary text-xs py-1.5 px-4 font-bold disabled:opacity-40"
                        >
                          <Plus size={14} />
                          <span>Add Node</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Not a Replica Set / Setup Wizard */}
                {rsData && !rsData.isReplSet && (
                  <div className="space-y-5">
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                      <AlertCircle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-extrabold text-sm text-amber-400">Standalone MongoDB Detected (Not a Replica Set)</h4>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {rsData.error || 'The selected database connection is running in standalone mode. Initialize a 3-node replica set below to enable automated High-Availability failover.'}
                        </p>
                      </div>
                    </div>

                    {/* 3-Node SSH-Scan Setup Wizard */}
                    <div className="p-5 rounded-xl bg-[var(--bg-secondary)]/40 border border-[var(--border-color)] space-y-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={16} className="text-emerald-400" />
                          <h4 className="font-extrabold text-sm text-[var(--text-primary)]">Initialize 3-Node High-Availability Replica Set</h4>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Auto-Scan Mode</span>
                      </div>

                      {/* Replica Set Name */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Replica Set Name</label>
                          <input
                            type="text"
                            value={initSetName}
                            onChange={(e) => setInitSetName(e.target.value)}
                            className="input-field text-xs w-full bg-[var(--bg-tertiary)] font-mono"
                            placeholder="rs0"
                          />
                        </div>
                        <div className="sm:col-span-2 flex items-end">
                          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                            Select an SSH connection for each node, click <strong className="text-emerald-400">Scan</strong> to auto-discover MongoDB instances, then pick the port. If MongoDB isn&apos;t running with <code className="text-amber-400">--replSet</code>, a docker command will appear.
                          </p>
                        </div>
                      </div>

                      {/* 3 Node Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {nodes.map((node, i) => {
                          const nodeLabels = ['Primary', 'Secondary 1', 'Secondary 2'];
                          const nodeColors = ['emerald', 'indigo', 'violet'];
                          const col = nodeColors[i];
                          const v = node.verified;
                          const isConnected = v?.connected;
                          const isInitialized = v?.isReplSet;
                          const isNotInit = isConnected && !isInitialized;
                          const isDown = v && !isConnected;
                          const dockerPort = node.selectedPort || String(27017 + i);
                          const dockerHost = node.selectedHost || `10.0.0.${i + 1}`;
                          const dockerCmd = `docker run -d --name mongo${i + 1} -p ${dockerPort}:27017 mongo:latest mongod --replSet ${initSetName} --bind_ip_all`;

                          return (
                            <div
                              key={i}
                              className={`rounded-xl border p-4 space-y-3 flex flex-col ${
                                isInitialized
                                  ? 'bg-emerald-500/5 border-emerald-500/25'
                                  : isNotInit
                                  ? 'bg-amber-500/5 border-amber-500/25'
                                  : isDown
                                  ? 'bg-rose-500/5 border-rose-500/25'
                                  : 'bg-[var(--bg-secondary)]/30 border-[var(--border-color)]'
                              }`}
                            >
                              {/* Node header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-lg bg-${col}-500/15 border border-${col}-500/30 text-${col}-400 text-xs font-black flex items-center justify-center`}>
                                    {i + 1}
                                  </div>
                                  <div>
                                    <div className="text-xs font-extrabold">Node {i + 1}</div>
                                    <div className={`text-[10px] text-${col}-400 font-mono`}>{nodeLabels[i]}</div>
                                  </div>
                                </div>
                                {/* Status badge */}
                                {node.verifying ? (
                                  <Loader size={12} className="animate-spin text-emerald-400" />
                                ) : v ? (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                                    isInitialized
                                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                      : isNotInit
                                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                      : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                  }`}>
                                    {isInitialized ? <Wifi size={10} /> : isNotInit ? <AlertCircle size={10} /> : <WifiOff size={10} />}
                                    {isInitialized ? v.state : isNotInit ? 'No replSet' : 'Down'}
                                  </span>
                                ) : null}
                              </div>

                              {/* SSH connection selector */}
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">SSH Server</label>
                                <div className="flex gap-1.5">
                                  <select
                                    value={node.sshConnId}
                                    onChange={(e) => updateNode(i, { sshConnId: e.target.value, instances: [], selectedPort: '', selectedHost: '', verified: null, scanError: null })}
                                    className="select-field text-xs flex-1 bg-[var(--bg-tertiary)] min-w-0 truncate"
                                  >
                                    <option value="">(Select SSH Server)</option>
                                    {sshConnections.map(c => (
                                      <option key={c._id} value={c._id}>{c.name} — {c.host}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => scanNode(i)}
                                    disabled={!node.sshConnId || node.scanning}
                                    title="Scan MongoDB instances on this server"
                                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-all disabled:opacity-40 flex items-center gap-1 shrink-0"
                                  >
                                    {node.scanning
                                      ? <Loader size={11} className="animate-spin" />
                                      : <RefreshCw size={11} />}
                                    Scan
                                  </button>
                                </div>
                              </div>

                              {/* Scan error */}
                              {node.scanError && (
                                <div className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 leading-relaxed">
                                  ❌ {node.scanError}
                                </div>
                              )}

                              {/* MongoDB instance selector (from scan) */}
                              {node.instances.length > 0 && (
                                <div>
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">MongoDB Instance</label>
                                  <select
                                    value={`${node.selectedHost}:${node.selectedPort}`}
                                    onChange={(e) => {
                                      const [h, ...pParts] = e.target.value.split(':');
                                      const p = pParts.join(':');
                                      updateNode(i, { selectedHost: h, selectedPort: p, verified: null });
                                      verifyNodePort(i, p, h);
                                    }}
                                    className="select-field text-xs w-full bg-[var(--bg-tertiary)] font-mono"
                                  >
                                    {node.instances.map(inst => (
                                      <option key={inst.port} value={`${inst.host}:${inst.port}`}>
                                        {inst.host}:{inst.port}
                                        {inst.connected
                                          ? inst.isReplSet ? ` ✅ ${inst.state}` : ' ⚠️ Standalone'
                                          : ' ❌ Unreachable'}
                                      </option>
                                    ))}
                                  </select>
                                  {node.selectedHost && node.selectedPort && (
                                    <div className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">
                                      Selected: <span className="text-emerald-400">{node.selectedHost}:{node.selectedPort}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* ── Not initialized → show docker run command with Auto-Run button ── */}
                              {isNotInit && (
                                <div className="rounded-lg bg-[var(--bg-card)]/60 border border-amber-500/25 p-3 space-y-2 flex-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                                      <Terminal size={10} /> Docker command (Node {i + 1}):
                                    </span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(dockerCmd);
                                        addNotification({ title: `Copied Node ${i + 1}!`, message: 'Docker command copied to clipboard', type: 'info' });
                                      }}
                                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
                                    >
                                      <Copy size={10} /> Copy
                                    </button>
                                  </div>
                                  <code className="block text-[10px] font-mono text-[var(--text-primary)] break-all leading-relaxed bg-slate-900/50 rounded p-2 select-all">
                                    {dockerCmd}
                                  </code>
                                  <button
                                    onClick={async () => {
                                      if (!node.sshConnId) return addNotification({ title: 'SSH Missing', message: 'Select SSH connection first', type: 'error' });
                                      updateNode(i, { verifying: true });
                                      try {
                                        const res = await apiFetch('/api/mongo-sync/scan-node', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'run-docker', sshConnId: node.sshConnId, command: dockerCmd })
                                        });
                                        const data = await res.json();
                                        if (data.success) {
                                          addNotification({ title: `Node ${i + 1} Started!`, message: 'MongoDB container launched. Re-verifying...', type: 'success' });
                                          setTimeout(() => scanNode(i), 2000);
                                        } else {
                                          addNotification({ title: `Launch Failed`, message: data.output || 'Could not run docker container', type: 'error' });
                                          updateNode(i, { verifying: false });
                                        }
                                      } catch (err) {
                                        addNotification({ title: `Error`, message: err.message, type: 'error' });
                                        updateNode(i, { verifying: false });
                                      }
                                    }}
                                    disabled={node.verifying}
                                    className="w-full py-1.5 rounded bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 text-amber-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                                  >
                                    <Play size={12} />
                                    <span>{node.verifying ? 'Starting Container via SSH...' : `1-Click Auto-Run Docker Container`}</span>
                                  </button>
                                </div>
                              )}

                              {/* Already in replica set — show info */}
                              {isInitialized && (
                                <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                                  ✅ Set: <strong>{v.setName}</strong> | State: <strong>{v.state}</strong>
                                </div>
                              )}

                              {/* Show selected host:port as final value */}
                              {node.selectedHost && node.selectedPort && !node.instances.length && (
                                <div className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] rounded px-2 py-1">
                                  {node.selectedHost}:{node.selectedPort}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Summary of selected nodes */}
                      {(() => {
                        const selected = nodes.filter(n => n.selectedHost && n.selectedPort);
                        if (selected.length === 0) return null;
                        return (
                          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)] text-[11px] font-mono space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Replica Set Members to Initialize:</div>
                            {selected.map((n, i) => (
                              <div key={i} className="text-emerald-400">
                                Member {i}: <span className="text-[var(--text-primary)]">{n.selectedHost}:{n.selectedPort}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* One-Click Initialize Button */}
                      <button
                        onClick={() => {
                          const members = nodes
                            .filter(n => n.selectedHost && n.selectedPort)
                            .map(n => `${n.selectedHost}:${n.selectedPort}`);
                          if (members.length === 0) return alert('Configure and scan at least 1 node first');
                          handleFailoverAction('initiate', { setName: initSetName, members });
                        }}
                        disabled={rsActionLoading || !nodes.some(n => n.selectedHost && n.selectedPort)}
                        className="w-full btn-primary justify-center font-bold text-xs py-2.5 shadow-lg"
                      >
                        {rsActionLoading ? (
                          <>
                            <Loader className="animate-spin" size={14} />
                            <span>Connecting &amp; Initializing {nodes.filter(n => n.selectedHost && n.selectedPort).length}-Node Cluster...</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={14} />
                            <span>One-Click Initialize Replica Set ({nodes.filter(n => n.selectedHost && n.selectedPort).length} node{nodes.filter(n => n.selectedHost && n.selectedPort).length !== 1 ? 's' : ''} ready)</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {drivePicker.open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4 shrink-0">
                  <div>
                    <div className="text-sm font-bold">Select Google Drive Folder</div>
                    <div className="text-[11px] text-[var(--text-muted)]">Navigate into subfolders, then click Select.</div>
                  </div>
                  <button onClick={() => setDrivePicker(p => ({ ...p, open: false }))} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-[11px] font-bold hover:bg-[var(--bg-card-hover)]">Close</button>
                </div>

                {/* Breadcrumb */}
                <div className="flex items-center gap-1 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/40 flex-wrap shrink-0">
                  {drivePicker.path.map((crumb, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      {idx > 0 && <span className="text-[var(--text-muted)] text-[11px]">/</span>}
                      <button
                        onClick={() => drivePickerBack(idx)}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${idx === drivePicker.path.length - 1 ? 'bg-indigo-500/15 text-indigo-400' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                  {drivePicker.loading && <Loader size={11} className="animate-spin text-emerald-400 ml-1" />}
                </div>

                {/* Search bar */}
                <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      value={drivePicker.search}
                      onChange={e => setDrivePicker(p => ({ ...p, search: e.target.value }))}
                      placeholder="Search folders in current level..."
                      className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none font-mono"
                    />
                    {drivePicker.search && (
                      <button
                        onClick={() => setDrivePicker(p => ({ ...p, search: '' }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Folder list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                  {drivePicker.loading && drivePicker.folders.length === 0 ? (
                    <div className="flex items-center justify-center py-10 text-[var(--text-muted)] text-xs gap-2">
                      <Loader size={14} className="animate-spin" /> Loading...
                    </div>
                  ) : (() => {
                    const q = drivePicker.search.toLowerCase().trim();
                    const visible = q
                      ? drivePicker.folders.filter(f => f.name.toLowerCase().includes(q))
                      : drivePicker.folders;
                    if (visible.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)] text-xs gap-2">
                          {q ? (
                            <span>No folders match <b className="text-[var(--text-primary)]">"{drivePicker.search}"</b></span>
                          ) : (
                            <>
                              <span>No subfolders here.</span>
                              <span className="text-[10px]">Click <b>Select This Folder</b> below to use the current folder.</span>
                            </>
                          )}
                        </div>
                      );
                    }
                    return visible.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => drivePickerNavigate(folder)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all text-left"
                      >
                        <span className="text-amber-400">📁</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{folder.name}</div>
                          {folder.modifiedTime && (
                            <div className="text-[9px] text-[var(--text-muted)]">
                              {new Date(folder.modifiedTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">open →</span>
                      </button>
                    ));
                  })()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/40 shrink-0">
                  <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[60%]">
                    {drivePicker.path.length > 1
                      ? <span>📁 <b className="text-[var(--text-primary)]">{drivePicker.path[drivePicker.path.length - 1].name}</b></span>
                      : <span className="italic">No folder selected</span>
                    }
                  </div>
                  <button
                    onClick={drivePickerSelect}
                    disabled={drivePicker.path.length <= 1}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition-all"
                  >
                    Select This Folder
                  </button>
                </div>
              </div>
            </div>
          )}
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
