'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { 
  Database, Upload, Cloud, RefreshCw, Play, Trash2, Plus, 
  CheckCircle, AlertCircle, Calendar, ShieldAlert, ArrowRight,
  FolderPlus, History, Key, Settings, Loader, CloudLightning, FileJson, ShieldCheck,
  Copy, Server, Wifi, WifiOff, Terminal, ChevronDown, Check, Clock
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

  // ── Google Drive Link State ──────────────────────────────────────────────
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEmail, setDriveEmail] = useState('');
  const [driveName, setDriveName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [driveFolders, setDriveFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);

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
  const [filteredDriveFolderOptions, setFilteredDriveFolderOptions] = useState([]);
  const [driveBrowseVisible, setDriveBrowseVisible] = useState(false);
  const [driveBrowseMode, setDriveBrowseMode] = useState('job');
  const [driveBrowsePath, setDriveBrowsePath] = useState([{ id: 'root', name: 'My Drive' }]);
  const [driveBrowseFolders, setDriveBrowseFolders] = useState([]);
  const [driveBrowseLoading, setDriveBrowseLoading] = useState(false);
  // ── Sync History State ─────────────────────────────────────────────
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
        setDriveFolders(data.folders || []);
        if (data.folders.length > 0) {
          setJobFolderId(data.folders[0].id);
          setRestoreFolderId(data.folders[0].id);
          setJobFolderName(data.folders[0].name);
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
    if (jobSchedule !== 'manual' && !targetSshConnId) {
      addNotification({ title: 'SSH Server Required', message: 'Please select a Target SSH Server for scheduled jobs.', type: 'error' });
      return;
    }

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
          driveFolderName: jobFolderName || driveFolders.find(f => f.id === jobFolderId)?.name || 'Default Folder',
          schedule: jobSchedule,
          enabled: jobEnabled,
          targetSshConnId: jobSchedule !== 'manual' ? targetSshConnId : null
        })
      });
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
        // If schedule is set, install the cron on the user's SSH server
        if (jobSchedule !== 'manual' && targetSshConnId) {
          const savedJob = data.data.find(j =>
            j.name === jobName.trim() && j.connectionId === jobConnId
          );
          if (savedJob) {
            try {
              const cronRes = await apiFetch('/api/mongo-sync/cron', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: savedJob.id,
                  jobName: savedJob.name,
                  schedule: jobSchedule,
                  targetSshConnId,
                  connectionId: jobConnId,
                  database: jobDbName.trim(),
                  collection: jobCollName.trim(),
                  driveFolderId: jobFolderId
                })
              });
              const cronData = await cronRes.json();
              if (cronData.success) {
                addNotification({
                  title: editingJobId ? 'Job Updated' : 'Job Created',
                  message: `✅ Schedule installed on SSH server — ${cronData.humanSchedule}. 100% user-side execution.`,
                  type: 'success'
                });
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
            title: editingJobId ? 'Job Updated' : 'Job Created',
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
          setSelectedFileId(data.files[0].id);
          const fname = data.files[0].name;
          const cleanName = fname.replace(/\.json$/i, '');
          const parts = cleanName.split('_');
          if (parts.length >= 3 && parts[0] === 'backup') {
            setRestoreDbName(parts[1]);
            setRestoreCollName(parts[2]);
          } else if (cleanName) {
            setRestoreCollName(cleanName);
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
    const filtered = driveFolders.filter(f => f.name.toLowerCase().includes(value.toLowerCase()));
    setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : driveFolders);
    const exact = driveFolders.find(f => f.name.toLowerCase() === value.toLowerCase());
    if (exact) {
      setJobFolderId(exact.id);
    }
  };

  const handleSelectJobFolder = (folder) => {
    setJobFolderId(folder.id);
    setJobFolderName(folder.name);
    setJobFolderInputActive(false);
    setFilteredDriveFolderOptions([]);
  };

  const handleJobFolderInputBlur = () => {
    setTimeout(() => setJobFolderInputActive(false), 150);
  };

  const executeRestore = async () => {
    if (!selectedFileId || !restoreDbName.trim()) return;
    const selectedFile = backupFiles.find(f => f.id === selectedFileId);
    const isAllColBackup = selectedFile?.name?.includes('ALL_COLLECTIONS');
    const collectionLabel = isAllColBackup ? 'ALL collections' : `"${restoreCollName}"`;
    if (!confirm(`Are you sure you want to restore data from Google Drive into ${collectionLabel} in database "${restoreDbName}"? This will run in ${restoreMode} mode.`)) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/mongo-sync/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          fileName: selectedFile?.name,
          connectionId: restoreConnId,
          database: restoreDbName.trim(),
          collection: isAllColBackup ? 'ALL_COLLECTIONS' : restoreCollName.trim(),
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
                    <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
                      <CloudLightning className="text-emerald-400" size={16} /> 1. Google Account Linkage
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

                      <div className="grid grid-cols-2 gap-2">
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
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">Drive Folder</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input
                                type="text"
                                value={jobFolderName}
                                onChange={(e) => handleJobFolderInputChange(e.target.value)}
                                onFocus={() => setJobFolderInputActive(true)}
                                onBlur={handleJobFolderInputBlur}
                                placeholder="Type or browse folder..."
                                className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                                required
                                disabled={!driveConnected}
                              />
                              {jobFolderInputActive && filteredDriveFolderOptions.length > 0 && (
                                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
                                  {filteredDriveFolderOptions.map(folder => (
                                    <button
                                      key={folder.id}
                                      type="button"
                                      onMouseDown={() => handleSelectJobFolder(folder)}
                                      className="w-full px-3 py-2 text-left text-xs font-mono text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                                    >
                                      {folder.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => openDriveBrowser('job')}
                              disabled={!driveConnected}
                              className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/15 transition-all"
                            >
                              Browse
                            </button>
                          </div>
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
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-[var(--text-primary)]">{job.name}</span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                job.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                                {job.schedule}
                              </span>
                              {job.targetSshConnId && job.schedule !== 'manual' && (() => {
                                const sshConn = sshConnections.find(c => c._id === job.targetSshConnId);
                                return sshConn ? (
                                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                                    <Server size={8} />⚡ {sshConn.name}
                                  </span>
                                ) : null;
                              })()}
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
                                <Clock size={9} />
                                <span>Last Run: {new Date(job.lastRun).toLocaleString()}</span>
                                <span className="opacity-60">•</span>
                                <span className="truncate max-w-xs">{job.lastMessage}</span>
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
                          <input
                            type="text"
                            value={restoreFolderName || (restoreFolderId ? driveFolders.find(f => f.id === restoreFolderId)?.name || '' : '')}
                            readOnly
                            placeholder="Choose folder..."
                            className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                            disabled={!driveConnected}
                          />
                          <button
                            type="button"
                            onClick={() => openDriveBrowser('restore')}
                            disabled={!driveConnected}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/15 transition-all"
                          >
                            Browse
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
                        {backupFiles.find(f => f.id === selectedFileId)?.name?.includes('ALL_COLLECTIONS') ? (
                          <div className="input-field text-xs w-full bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-2 px-3 py-2 rounded-xl">
                            <CheckCircle size={12} />
                            <span>All Collections (auto-detected)</span>
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
                          <span>Restoring...</span>
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
                      onClick={fetchHistory}
                      disabled={historyLoading}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} />
                      <span>Refresh Log</span>
                    </button>
                    <button
                      onClick={handleClearHistory}
                      disabled={historyLoading || historyRuns.length === 0}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      <span>Clear Log</span>
                    </button>
                  </div>
                </div>

                <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
                  {historyLoading && historyRuns.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                      <Loader size={16} className="animate-spin text-emerald-400" />
                      <span>Loading execution history...</span>
                    </div>
                  ) : historyRuns.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[var(--text-muted)] italic">
                      No backup execution history recorded yet. Run a manual backup or wait for a scheduled task.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-1 divide-y divide-[var(--border-color)]/40">
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
                            <span>Database: <strong className="text-[var(--text-primary)]">{run.database}</strong> | Collection: <strong className="text-[var(--text-primary)]">{run.collection}</strong></span>
                            {run.count !== undefined && <span className="text-emerald-400 font-bold">{run.count} docs</span>}
                          </div>

                          {run.message && (
                            <div className="text-[11px] font-mono bg-[var(--bg-tertiary)] p-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] leading-relaxed">
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

          {driveBrowseVisible && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-3xl rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
                  <div>
                    <div className="text-sm font-bold">Browse Google Drive</div>
                    <div className="text-[11px] text-[var(--text-muted)]">Select a folder for {driveBrowseMode === 'job' ? 'backup jobs' : 'restore files'}.</div>
                  </div>
                  <button
                    onClick={() => setDriveBrowseVisible(false)}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-[11px] font-bold hover:bg-[var(--bg-card-hover)]"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4 p-5">
                  <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                    {driveBrowsePath.map((folder, idx) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => navigateDriveFolder(folder)}
                        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-1 text-[11px] font-semibold hover:bg-[var(--bg-card-hover)]"
                      >
                        {folder.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Folders</span>
                    {driveBrowseLoading && <Loader size={12} className="animate-spin text-emerald-400" />}
                  </div>
                  <div className="grid gap-3 max-h-[360px] overflow-y-auto">
                    {driveBrowseFolders.length > 0 ? driveBrowseFolders.map(folder => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => handleDriveFolderSelect(folder)}
                        className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-4 text-left transition hover:border-emerald-500/30 hover:bg-[var(--bg-card-hover)]"
                      >
                        <div className="font-semibold text-sm text-[var(--text-primary)]">{folder.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">{folder.id}</div>
                      </button>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] p-6 text-center text-[11px] text-[var(--text-muted)]">
                        {driveBrowseLoading ? 'Loading folders...' : 'No folders found under this path.'}
                      </div>
                    )}
                  </div>
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
