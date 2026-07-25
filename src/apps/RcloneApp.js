'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  CloudSync, HardDrive, RefreshCw, Terminal, CheckCircle2, AlertTriangle,
  Plus, Trash2, Folder, File, Play, Shield, Settings, Server, Database,
  ArrowRight, Download, Eye, ExternalLink, Cpu, Info, Check, ShieldCheck,
  Zap, Copy, ArrowLeftRight, Monitor, ChevronRight, Link2, ChevronDown, Search, X, Clock
} from 'lucide-react';
import { useVault } from '@/context/VaultContext';
import { useApp } from '@/context/AppContext';
import MasterPasswordModal from '@/components/MasterPasswordModal';
import { getLocalConnections } from '@/utils/localConnections';

// 🎨 Custom Styled Popover Select Component
function CustomSelect({ value, onChange, options = [], className = '', textClass = '' }) {
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
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-500/50 transition-all ${className}`}
      >
        <span className={`truncate ${textClass}`}>{selectedOpt?.label || value}</span>
        <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[9999] overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected ? 'bg-indigo-500/15 text-indigo-400 font-bold' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check size={12} className="text-indigo-400 shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 💡 Path Input with Autocomplete & Tab Completion
function PathInputWithAutocomplete({
  value,
  onChange,
  placeholder,
  selectedConnId,
  apiFetch,
  remotes = [],
  accentColor = 'indigo',
  className = '',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const debounceTimer = useRef(null);

  const parsePath = (val) => {
    if (!val) return { targetType: 'local', dir: '/', prefix: '' };
    
    const colonIdx = val.indexOf(':');
    if (colonIdx !== -1) {
      const targetType = val.slice(0, colonIdx + 1);
      const rest = val.slice(colonIdx + 1);
      const lastSlashIdx = rest.lastIndexOf('/');
      if (lastSlashIdx === -1) {
        return { targetType, dir: '', prefix: rest };
      }
      return {
        targetType,
        dir: rest.slice(0, lastSlashIdx),
        prefix: rest.slice(lastSlashIdx + 1)
      };
    }

    const lastSlashIdx = val.lastIndexOf('/');
    if (lastSlashIdx === -1) {
      return { targetType: 'local', dir: '/', prefix: val };
    }
    const dir = val.slice(0, lastSlashIdx) || '/';
    const prefix = val.slice(lastSlashIdx + 1);
    return { targetType: 'local', dir, prefix };
  };

  const fetchItems = async (val) => {
    if (!selectedConnId) return;

    if (!val.includes(':') && !val.startsWith('/') && !val.startsWith('$') && !val.startsWith('~')) {
      const matchingRemotes = remotes
        .filter(r => r.toLowerCase().startsWith(val.toLowerCase()))
        .map(r => ({ Name: `${r}:`, IsDir: true, isRemoteName: true }));
      
      if (matchingRemotes.length > 0) {
        setSuggestions(matchingRemotes);
        setIsOpen(true);
        setSelectedIndex(0);
        return;
      }
    }

    const { targetType, dir, prefix } = parsePath(val);
    setLoading(true);

    try {
      const res = await apiFetch(`/api/rclone/browse?connectionId=${selectedConnId}&remote=${encodeURIComponent(targetType)}&path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.items)) {
        const filtered = data.items.filter(item =>
          item.Name && item.Name.toLowerCase().startsWith(prefix.toLowerCase())
        );
        setSuggestions(filtered);
        setIsOpen(filtered.length > 0);
        setSelectedIndex(filtered.length > 0 ? 0 : -1);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
    } catch (_) {
      setSuggestions([]);
      setIsOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const newVal = e.target.value;
    onChange(newVal);
    
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchItems(newVal);
    }, 200);
  };

  const applySuggestion = (item) => {
    if (item.isRemoteName) {
      onChange(item.Name);
      fetchItems(item.Name);
      return;
    }

    const { targetType, dir } = parsePath(value);
    let newPath = '';

    if (targetType === 'local') {
      const cleanDir = dir.endsWith('/') ? dir : `${dir}/`;
      newPath = `${cleanDir}${item.Name}${item.IsDir ? '/' : ''}`;
    } else {
      const cleanDir = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
      newPath = `${targetType}${cleanDir}${item.Name}${item.IsDir ? '/' : ''}`;
    }

    onChange(newPath);
    setIsOpen(false);
    setSelectedIndex(-1);

    if (item.IsDir) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        fetchItems(newPath);
      }, 150);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        fetchItems(value);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const idxToUse = selectedIndex >= 0 ? selectedIndex : 0;
      if (suggestions[idxToUse]) {
        applySuggestion(suggestions[idxToUse]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className={`relative w-full ${isOpen ? 'z-[990]' : 'z-10'}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => {
            if (value) fetchItems(value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
            <RefreshCw size={12} className="animate-spin text-[var(--text-muted)]" />
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div style={{ zIndex: 10000 }} className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
          <div className="px-3 py-1 bg-[var(--bg-tertiary)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
            <span>Suggestions ({suggestions.length})</span>
            <span className="text-indigo-400 font-semibold">Press <kbd className="bg-black/40 px-1 py-0.5 rounded text-white border border-[var(--border-color)]">Tab ⇥</kbd> or <kbd className="bg-black/40 px-1 py-0.5 rounded text-white border border-[var(--border-color)]">↵</kbd></span>
          </div>
          {suggestions.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={idx}
                onClick={() => applySuggestion(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`px-3 py-2 flex items-center justify-between font-mono text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? accentColor === 'emerald'
                      ? 'bg-emerald-500/15 text-emerald-400 font-bold'
                      : 'bg-indigo-500/15 text-indigo-400 font-bold'
                    : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {item.IsDir ? (
                    <Folder size={13} className="text-amber-400 shrink-0" />
                  ) : (
                    <File size={13} className="text-indigo-400 shrink-0" />
                  )}
                  <span className="truncate">{item.Name}</span>
                </div>
                {item.IsDir && (
                  <span className="text-[9px] text-[var(--text-muted)] opacity-70 shrink-0 ml-2 font-sans">
                    /
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ⏰ Dynamic Cron Schedule & Clock Picker Component
function DynamicCronPicker({ value, onChange }) {
  const parseCron = (str) => {
    if (!str) return { mode: 'everyday', time: '00:00', weekDay: '1', monthDay: '1', intervalVal: '*/30 * * * *', customVal: '0 0 * * *' };
    const parts = str.trim().split(/\s+/);
    if (parts.length !== 5) return { mode: 'custom', time: '00:00', weekDay: '1', monthDay: '1', intervalVal: '*/30 * * * *', customVal: str };

    const [min, hr, dom, mth, dow] = parts;

    if (min.startsWith('*/') || hr.startsWith('*/') || str === '0 * * * *') {
      return { mode: 'interval', time: '00:00', weekDay: '1', monthDay: '1', intervalVal: str, customVal: str };
    }

    const pad = (n) => String(n).padStart(2, '0');
    const isValidNum = (n) => !isNaN(parseInt(n, 10)) && !n.includes('*');

    if (isValidNum(min) && isValidNum(hr)) {
      const timeStr = `${pad(parseInt(hr, 10))}:${pad(parseInt(min, 10))}`;

      if (dom === '*' && mth === '*' && dow === '*') {
        return { mode: 'everyday', time: timeStr, weekDay: '1', monthDay: '1', intervalVal: '*/30 * * * *', customVal: str };
      }
      if (dom === '*' && mth === '*' && dow !== '*') {
        return { mode: 'weekly', time: timeStr, weekDay: dow, monthDay: '1', intervalVal: '*/30 * * * *', customVal: str };
      }
      if (dom !== '*' && mth === '*' && dow === '*') {
        return { mode: 'monthly', time: timeStr, weekDay: '1', monthDay: dom, intervalVal: '*/30 * * * *', customVal: str };
      }
    }

    return { mode: 'custom', time: '00:00', weekDay: '1', monthDay: '1', intervalVal: '*/30 * * * *', customVal: str };
  };

  const parsed = parseCron(value);
  const [mode, setMode] = useState(parsed.mode);
  const [time, setTime] = useState(parsed.time);
  const [weekDay, setWeekDay] = useState(parsed.weekDay);
  const [monthDay, setMonthDay] = useState(parsed.monthDay);
  const [intervalVal, setIntervalVal] = useState(parsed.intervalVal);
  const [customVal, setCustomVal] = useState(parsed.customVal);

  useEffect(() => {
    const p = parseCron(value);
    setMode(p.mode);
    setTime(p.time);
    setWeekDay(p.weekDay);
    setMonthDay(p.monthDay);
    setIntervalVal(p.intervalVal);
    setCustomVal(p.customVal);
  }, [value]);

  const updateCron = (newMode, newTime, newWeekDay, newMonthDay, newInterval, newCustom) => {
    let cron = '0 0 * * *';
    const [hrStr, minStr] = (newTime || '00:00').split(':');
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

    if (mode === 'everyday') return `Runs every day at ${timeFormatted} (${time} server time)`;
    if (mode === 'weekly') return `Runs every ${daysMap[weekDay] || 'day'} at ${timeFormatted}`;
    if (mode === 'monthly') return `Runs on day ${monthDay} of every month at ${timeFormatted}`;
    if (mode === 'interval') {
      if (intervalVal === '*/5 * * * *') return 'Runs every 5 minutes';
      if (intervalVal === '*/15 * * * *') return 'Runs every 15 minutes';
      if (intervalVal === '*/30 * * * *') return 'Runs every 30 minutes';
      if (intervalVal === '0 * * * *') return 'Runs every hour (at :00)';
      if (intervalVal === '0 */2 * * *') return 'Runs every 2 hours';
      if (intervalVal === '0 */6 * * *') return 'Runs every 6 hours';
      if (intervalVal === '0 */12 * * *') return 'Runs every 12 hours';
      return `Runs interval schedule: ${intervalVal}`;
    }
    return `Custom cron expression: ${customVal}`;
  };

  return (
    <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
          ⏰ Dynamic Schedule & Clock Picker
        </label>
        <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded font-bold">
          {value}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {[
          { id: 'everyday', label: 'Every Day' },
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
            className={`py-1.5 px-1.5 text-center rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
              mode === m.id
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20'
                : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="pt-2 border-t border-[var(--border-color)] space-y-2">
        {(mode === 'everyday' || mode === 'weekly' || mode === 'monthly') && (
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                Execution Time (HH:MM Clock):
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const newT = e.target.value || '00:00';
                  setTime(newT);
                  updateCron(mode, newT, weekDay, monthDay, intervalVal, customVal);
                }}
                className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none cursor-pointer"
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
                  Day of Month (1-31):
                </label>
                <CustomSelect
                  value={monthDay}
                  onChange={(val) => {
                    setMonthDay(val);
                    updateCron(mode, time, weekDay, val, intervalVal, customVal);
                  }}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1} of month` }))}
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
          <div>
            <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
              Custom Cron Expression (5 Fields):
            </label>
            <input
              type="text"
              value={customVal}
              onChange={(e) => {
                setCustomVal(e.target.value);
                updateCron(mode, time, weekDay, monthDay, intervalVal, e.target.value);
              }}
              placeholder="e.g. 0 4 * * 1-5"
              className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none"
            />
          </div>
        )}

        <div className="p-2.5 rounded-lg bg-black/40 border border-indigo-500/20 text-[11px] font-mono text-emerald-400 flex items-center justify-between">
          <span>📅 {getHumanReadable()}</span>
        </div>
      </div>
    </div>
  );
}

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
  const [projectName, setProjectName] = useState(''); // Optional project/task name
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

  // Backup History State
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyProjects, setHistoryProjects] = useState([]);
  const [historyFolders, setHistoryFolders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedLogIdx, setExpandedLogIdx] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState({}); // track which project groups are collapsed
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all' | 'backup' | 'cleanup'
  const [autoRefreshHistory, setAutoRefreshHistory] = useState(true); // real-time history polling

  // Custom Connection Dropdown State (matching AutoDeploy App)
  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [connSearch, setConnSearch] = useState('');
  const connDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (connDropdownRef.current && !connDropdownRef.current.contains(e.target)) {
        setConnDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      fetchHistory();
    }
  }, [selectedConnId, vaultStatus]);

  // 🛑 Abort / Terminate Running Rclone Process
  const handleKillProcess = async (pid = null, logFile = null) => {
    if (!selectedConnId) return;

    setLoading(true);
    try {
      const res = await apiFetch('/api/rclone/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedConnId, pid, logFile })
      });
      const data = await res.json();
      if (data?.success) {
        fetchRcloneStatus();
        fetchHistory(false);
      } else {
        alert(data?.error || 'Failed to kill process');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    setLoading(false);
  };

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

  const fetchHistory = async (silent = false) => {
    if (!selectedConnId) return;
    if (!silent) setHistoryLoading(true);
    try {
      const res = await apiFetch(`/api/rclone/history?connectionId=${selectedConnId}&target=${encodeURIComponent(targetPath || '')}`);
      const data = await res.json();
      if (data?.success) {
        setHistoryRuns(data.runs || []);
        setHistoryProjects(data.projects || []);
        setHistoryFolders(data.backupFolders || []);
      }
    } catch (_) {}
    if (!silent) setHistoryLoading(false);
  };

  const handleClearHistory = async () => {
    if (!selectedConnId) return;
    if (!confirm('Clear all backup history logs on server?')) return;

    setHistoryLoading(true);
    try {
      const res = await apiFetch(`/api/rclone/history?connectionId=${selectedConnId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data?.success) {
        setHistoryRuns([]);
        setHistoryProjects([]);
      } else {
        alert(data?.error || 'Failed to clear logs');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    setHistoryLoading(false);
  };

  // ⚡ Real-Time Auto-Refresh Effect for Backup History (6s Interval)
  useEffect(() => {
    if (!autoRefreshHistory || !selectedConnId) return;

    const interval = setInterval(() => {
      if (activeTab === 'history' || activeTab === 'backup') {
        fetchHistory(true);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [autoRefreshHistory, selectedConnId, activeTab, targetPath]);

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
          projectName: projectName,
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
        const testStatus = data.testPassed ? '✅ Connection & Path Test Verification Passed!' : '⚠️ Schedule Saved (Dry-Run Notice)';
        alert(`${testStatus}\n\nCrontab Schedule: ${data.humanSchedule || finalSchedule}\n\nTest Run Output Preview:\n${data.testOutput || 'Rclone connection & paths verified successfully.'}`);
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
    const activeSrc = editingCron ? editingCron.source : sourcePath;
    const activeTgt = editingCron ? editingCron.target : targetPath;

    if (mode === 'source') {
      setPickerTargetType('local');
      const initialPath = activeSrc && activeSrc.startsWith('/') ? activeSrc : '/';
      setPickerCurrentPath(initialPath);
      fetchPickerItems('local', initialPath);
    } else {
      const defaultRemote = rcloneStatus?.remotes?.[0] ? `${rcloneStatus.remotes[0]}:` : 'gdrive:';
      const targetRemote = activeTgt && activeTgt.includes(':') ? activeTgt.split(':')[0] + ':' : defaultRemote;
      const subPath = activeTgt && activeTgt.includes(':') ? activeTgt.split(':').slice(1).join(':') : '';
      setPickerTargetType(targetRemote);
      setPickerCurrentPath(subPath);
      fetchPickerItems(targetRemote, subPath);
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

    if (editingCron) {
      if (pickerMode === 'source') {
        setEditingCron({ ...editingCron, source: fullPath });
      } else {
        setEditingCron({ ...editingCron, target: fullPath });
      }
    } else {
      if (pickerMode === 'source') {
        setSourcePath(fullPath);
      } else {
        setTargetPath(fullPath);
      }
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

        {/* Server Selector Dropdown (Matching AutoDeploy App) */}
        <div className="relative shrink-0" ref={connDropdownRef} style={{ zIndex: 9999 }}>
          <button
            type="button"
            onClick={() => { setConnDropdownOpen(!connDropdownOpen); setConnSearch(''); }}
            className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] font-bold focus:outline-none focus:border-indigo-500 min-w-[200px] max-w-[280px] flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-500/50 transition-colors shadow-sm"
          >
            <span className="truncate flex items-center gap-1.5">
              <Server size={13} className="text-indigo-400 shrink-0" />
              {selectedConn ? (
                <span className="truncate font-mono">{selectedConn.name} <span className="text-[var(--text-muted)] font-normal">({selectedConn.host})</span></span>
              ) : (
                <span className="text-[var(--text-muted)] font-normal">-- Select SSH Connection --</span>
              )}
            </span>
            <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform shrink-0 ${connDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {connDropdownOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-[280px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden divide-y divide-[var(--border-color)]">
              <div className="p-2 bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2 bg-[var(--bg-primary)] rounded-lg px-2.5 py-1.5 border border-[var(--border-color)]">
                  <Search size={12} className="text-[var(--text-muted)] shrink-0" />
                  <input
                    type="text"
                    value={connSearch}
                    onChange={(e) => setConnSearch(e.target.value)}
                    placeholder="Search SSH connections..."
                    className="bg-transparent text-xs text-[var(--text-primary)] outline-none w-full placeholder:text-[var(--text-muted)]"
                    autoFocus
                  />
                  {connSearch && (
                    <button onClick={() => setConnSearch('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto py-1">
                {(!connections || connections.length === 0) ? (
                  <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">No SSH connections found</div>
                ) : (() => {
                  const filtered = connections.filter(c => 
                    c.name?.toLowerCase().includes(connSearch.toLowerCase()) || 
                    c.host?.toLowerCase().includes(connSearch.toLowerCase())
                  );
                  if (filtered.length === 0) {
                    return <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">No matching connections</div>;
                  }
                  return filtered.map((c) => {
                    const id = c.id || c._id;
                    const isSelected = id === selectedConnId;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setSelectedConnId(id);
                          setConnDropdownOpen(false);
                          setConnSearch('');
                        }}
                        className={`w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected ? 'bg-indigo-500/15 text-indigo-400 font-bold' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="truncate flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="truncate">{c.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)] font-normal truncate">({c.host})</span>
                        </div>
                        {isSelected && <Check size={13} className="text-indigo-400 shrink-0 ml-1" />}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
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
          { id: 'crons',   icon: <Clock size={13} />,      label: `Schedules (${serverCrons.length})` },
          { id: 'history', icon: <Database size={13} />,   label: `History (${historyProjects.length})` },
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

            {/* Server Specs & RAM Auto-Protection Card */}
            {rcloneStatus?.serverSpecs && (
              <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu size={15} className="text-indigo-400" />
                    <h4 className="text-xs font-bold text-[var(--text-primary)]">
                      Server Hardware & Smart OOM Protection
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    ✓ Crash-Protection Active
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-[var(--bg-secondary)] p-2 rounded-xl border border-[var(--border-color)]">
                    <span className="text-[9px] text-[var(--text-muted)] block">TOTAL RAM</span>
                    <strong className="text-indigo-400">{(rcloneStatus.serverSpecs.totalMemMb / 1024).toFixed(1)} GB</strong> ({rcloneStatus.serverSpecs.totalMemMb} MB)
                  </div>
                  <div className="bg-[var(--bg-secondary)] p-2 rounded-xl border border-[var(--border-color)]">
                    <span className="text-[9px] text-[var(--text-muted)] block">CPU CORES</span>
                    <strong className="text-indigo-400">{rcloneStatus.serverSpecs.cpuCores} Cores</strong>
                  </div>
                  <div className="bg-[var(--bg-secondary)] p-2 rounded-xl border border-[var(--border-color)]">
                    <span className="text-[9px] text-[var(--text-muted)] block">PROFILE</span>
                    <strong className="text-emerald-400 uppercase">{rcloneStatus.serverSpecs.mode.replace('_', ' ')}</strong>
                  </div>
                  <div className="bg-[var(--bg-secondary)] p-2 rounded-xl border border-[var(--border-color)]">
                    <span className="text-[9px] text-[var(--text-muted)] block">SAFE THREADS</span>
                    <span className="text-cyan-400 font-bold text-[10px]">--transfers {rcloneStatus.serverSpecs.recommended.transfers}</span>
                  </div>
                </div>

                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed pt-1">
                  ⚡ <strong>Auto-Protection:</strong> Rclone commands and crontab tasks automatically tune RAM stream buffers (<code>--buffer-size {rcloneStatus.serverSpecs.recommended.bufferSize}</code>), chunk size, and CPU priority (<code>nice -n 19</code>) to guarantee zero server crashes on large file transfers.
                </p>
              </div>
            )}

            {/* Active Running Jobs Banner with Abort Buttons */}
            {rcloneStatus?.runningJobs && rcloneStatus.runningJobs.length > 0 && (
              <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                    <RefreshCw size={13} className="animate-spin" />
                    Active Rclone Backup Processes ({rcloneStatus.runningJobs.length})
                  </div>
                  <button
                    onClick={() => handleKillProcess(null)}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer transition-colors shadow-sm flex items-center gap-1"
                  >
                    🛑 Abort All Processes
                  </button>
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
                        <button
                          onClick={() => handleKillProcess(job.pid)}
                          className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 font-bold border border-rose-500/30 cursor-pointer transition-colors"
                        >
                          🛑 Abort
                        </button>
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
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Backup Paths & Identity</label>
              </div>

              {/* Project Name (Optional) */}
              <div className="mb-3">
                <label className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5 mb-1">
                  <Database size={11} className="text-cyan-400" /> Project / Task Name <span className="text-[9px] font-normal opacity-70">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., Database Backup, Assets Sync"
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-cyan-500 focus:outline-none"
                />
              </div>

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
                  <PathInputWithAutocomplete
                    value={sourcePath}
                    onChange={setSourcePath}
                    placeholder="/var/www/html or /home"
                    selectedConnId={selectedConnId}
                    apiFetch={apiFetch}
                    remotes={rcloneStatus?.remotes || []}
                    accentColor="indigo"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none"
                  />
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
                  <PathInputWithAutocomplete
                    value={targetPath}
                    onChange={setTargetPath}
                    placeholder="gdrive:backup or s3remote:bucket/backups"
                    selectedConnId={selectedConnId}
                    apiFetch={apiFetch}
                    remotes={rcloneStatus?.remotes || []}
                    accentColor="emerald"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
                  />
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
                    <CustomSelect
                      value={timestampFormat}
                      onChange={setTimestampFormat}
                      textClass="text-indigo-400 font-mono font-semibold"
                      options={[
                        { value: 'YMD_MMM_HM', label: '2026_Jul_25_22_05' },
                        { value: 'DMY_HM', label: '25-07-2026_22-03' },
                        { value: 'YMD_HMS', label: '2026-07-25_22-03-41' },
                      ]}
                    />
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
                    <CustomSelect
                      value={retentionDays}
                      onChange={setRetentionDays}
                      textClass="text-amber-400 font-mono font-semibold"
                      options={[
                        { value: '3', label: '3 Days' },
                        { value: '7', label: '7 Days (Default)' },
                        { value: '14', label: '14 Days' },
                        { value: '30', label: '30 Days' },
                        { value: '90', label: '90 Days' },
                      ]}
                    />
                    <p className="text-[10px] text-amber-300">Delete folders older than {retentionDays} days automatically</p>
                  </div>
                )}
              </div>
            </div>

            {/* ─ Row 4: Advanced + Cron Schedule ─ */}
            <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide block">Advanced Options & Crash Protection</label>
                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  🛡️ Smart RAM Protection Active
                </span>
              </div>

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
                  <DynamicCronPicker
                    value={cronSchedule}
                    onChange={setCronSchedule}
                  />
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
          </div>
        )}

        {/* ── 4. Schedules / Crontab Tab ── */}
        {activeTab === 'crons' && (
          <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Clock className="text-indigo-400" size={18} />
                  Active Server Crontab Schedules
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Automated rclone backup schedules configured on {selectedConn?.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('backup')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
                >
                  <Plus size={13} /> Add New Schedule
                </button>
                <button
                  onClick={fetchCrons}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-bold border border-[var(--border-color)] transition-colors cursor-pointer"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            {/* ─ Active Crontab Tasks Card ─ */}
            <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
              <div className="divide-y divide-[var(--border-color)]">
                {serverCrons.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <Clock size={32} className="text-[var(--text-muted)] mx-auto opacity-40" />
                    <p className="text-xs text-[var(--text-muted)]">No active crontab schedules configured on {selectedConn?.name}.</p>
                    <button
                      onClick={() => setActiveTab('backup')}
                      className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Plus size={13} /> Create Backup Schedule
                    </button>
                  </div>
                ) : (
                  serverCrons.map((cron) => (
                    <div key={cron.id} className="group">
                      {/* Task Header */}
                      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--bg-tertiary)] group-hover:bg-[var(--bg-tertiary)]/80">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-[10px] shrink-0">{cron.humanSchedule}</span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">{cron.schedule}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => navigator.clipboard.writeText(cron.raw)} className="p-1.5 text-[var(--text-muted)] hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer" title="Copy Command"><Copy size={12} /></button>
                          <button
                            onClick={() => {
                              const rcloneMatch = cron.raw.match(/rclone\s+(copy|sync|move|check)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
                              let src = '/';
                              let tgt = 'gdrive:';
                              let act = 'copy';

                              if (rcloneMatch) {
                                act = rcloneMatch[1] ? rcloneMatch[1].toLowerCase() : 'copy';
                                src = rcloneMatch[2] || rcloneMatch[3] || rcloneMatch[4] || '/';
                                tgt = rcloneMatch[5] || rcloneMatch[6] || rcloneMatch[7] || 'gdrive:';
                                tgt = tgt.replace(/\/+\$\(date[^)]+\)/g, '').replace(/\/+$/, '');
                              }

                              const retMatch = cron.raw.match(/--min-age\s+(\d+)d/);

                              setEditingCron({
                                rawLine: cron.raw,
                                schedule: cron.schedule,
                                action: act,
                                source: src,
                                target: tgt,
                                options: {
                                  useTimestampFolder: cron.raw.includes('$(date'),
                                  timestampFormat: cron.raw.includes('%b') ? 'YMD_MMM_HM' : cron.raw.includes('%d-%m-%Y') ? 'DMY_HM' : 'YMD_HMS',
                                  enableRetention: !!retMatch,
                                  retentionDays: retMatch ? retMatch[1] : '7',
                                }
                              });
                              setActiveTab('backup');
                            }}
                            className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer" title="Edit Schedule"
                          >
                            <Settings size={12} />
                          </button>
                          <button onClick={() => handleDeleteCron(cron.raw)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer" title="Delete Schedule"><Trash2 size={12} /></button>
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

        {/* ════════════════════ TAB 4: HISTORY ════════════════════ */}
        {activeTab === 'history' && (
          <div className="p-5 max-w-3xl space-y-4">

            {/* Header & Filter Controls */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Database size={15} className="text-emerald-400" />
                  Backup Execution History
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Logs from scheduled rclone cron jobs on {selectedConn?.name}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Filter Pills */}
                <div className="flex items-center bg-[var(--bg-secondary)] p-1 rounded-xl border border-[var(--border-color)] text-[10px]">
                  <button
                    onClick={() => setHistoryFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setHistoryFilter('backup')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'backup' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  >
                    📋 Backup
                  </button>
                  <button
                    onClick={() => setHistoryFilter('cleanup')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'cleanup' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  >
                    🧹 Cleanup
                  </button>
                </div>

                {/* Auto-Refresh Toggle Button */}
                <button
                  onClick={() => setAutoRefreshHistory(!autoRefreshHistory)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-[10px] cursor-pointer border transition-colors ${
                    autoRefreshHistory 
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                      : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)]'
                  }`}
                  title="Toggle 6-second real-time history refresh"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${autoRefreshHistory ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                  {autoRefreshHistory ? 'Realtime 6s' : 'Paused'}
                </button>

                <button
                  onClick={() => fetchHistory(false)}
                  disabled={historyLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[11px] font-bold cursor-pointer border border-emerald-500/30 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={11} className={historyLoading ? 'animate-spin' : ''} />
                  Refresh Logs
                </button>

                <button
                  onClick={handleClearHistory}
                  disabled={historyLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-bold cursor-pointer border border-rose-500/20 disabled:opacity-50 transition-colors"
                  title="Clear all backup history log files on server"
                >
                  🧹 Clear Logs
                </button>
              </div>
            </div>

            {/* Project Groups */}
            <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
              <div className="divide-y divide-[var(--border-color)]">
                {historyLoading && historyProjects.length === 0 ? (
                  <div className="p-10 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-emerald-400" />
                    Fetching backup history logs from {selectedConn?.name}...
                  </div>
                ) : historyProjects.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <Database size={28} className="text-[var(--text-muted)] mx-auto opacity-40" />
                    <p className="text-xs text-[var(--text-muted)]">No backup execution logs found on {selectedConn?.name} yet.</p>
                    <p className="text-[10px] text-[var(--text-muted)] opacity-70">Logs appear in <code>/tmp/rclone-cron-*.log</code> after cron tasks run.</p>
                  </div>
                ) : (
                  historyProjects.map((project, pIdx) => {
                    const isCollapsed = collapsedProjects[pIdx] !== false;
                    const runsToDisplay = project.runs.filter(run => {
                      if (historyFilter === 'backup') return run.action !== 'cleanup';
                      if (historyFilter === 'cleanup') return run.action === 'cleanup';
                      return true;
                    });
                    if (runsToDisplay.length === 0) return null;

                    const hasActiveProjectRun = runsToDisplay.some(r => r.status === 'running');

                    return (
                      <div key={pIdx} className="border-b border-[var(--border-color)] last:border-b-0">
                        <button
                          onClick={() => setCollapsedProjects(prev => ({ ...prev, [pIdx]: !isCollapsed }))}
                          className="w-full px-4 py-3 bg-[var(--bg-tertiary)]/50 flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 text-xs font-bold text-indigo-400 font-mono">
                            <Folder size={13} />
                            <span>{project.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasActiveProjectRun && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleKillProcess(null, null);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer transition-colors shadow-sm flex items-center gap-1 shrink-0"
                                title="Abort all active transfers in this project at once"
                              >
                                🛑 Abort Whole Project
                              </button>
                            )}
                            <span className="text-[10px] text-[var(--text-muted)] font-semibold bg-black/20 px-2 py-0.5 rounded">
                              {runsToDisplay.length} Runs
                            </span>
                            <span className="text-[var(--text-muted)] text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                          </div>
                        </button>
                        {!isCollapsed && (
                          <div className="divide-y divide-[var(--border-color)]">
                            {runsToDisplay.map((run, idx) => {
                              const expandedId = `${pIdx}-${idx}`;
                              const isExpanded = expandedLogIdx === expandedId;
                              const isSuccess = run.status === 'success';
                              const isWarning = run.status === 'warning';
                              const isFailed = run.status === 'failed';
                              const isAborted = run.status === 'aborted';
                              const act = (run.action || 'copy').toLowerCase();

                              return (
                                <div key={idx} className="p-4 hover:bg-[var(--bg-tertiary)]/30 transition-colors">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                      {/* Action Tag */}
                                      {act === 'cleanup' && (
                                        <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold text-[10px] border border-amber-500/30 shrink-0">
                                          🧹 CLEANUP
                                        </span>
                                      )}
                                      {act === 'sync' && (
                                        <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 font-bold text-[10px] border border-purple-500/30 shrink-0">
                                          🔄 SYNC
                                        </span>
                                      )}
                                      {act === 'move' && (
                                        <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-bold text-[10px] border border-cyan-500/30 shrink-0">
                                          📦 MOVE
                                        </span>
                                      )}
                                      {act === 'check' && (
                                        <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-bold text-[10px] border border-indigo-500/30 shrink-0">
                                          🔍 CHECK
                                        </span>
                                      )}
                                      {act === 'copy' && (
                                        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 font-bold text-[10px] border border-blue-500/30 shrink-0">
                                          📋 COPY
                                        </span>
                                      )}

                                      {/* Status Badge */}
                                      {isAborted && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold text-[10px] border border-rose-500/30 shrink-0">
                                          🛑 ABORTED
                                        </span>
                                      )}
                                      {isSuccess && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold text-[10px] border border-emerald-500/30 shrink-0">
                                          <CheckCircle2 size={11} /> SUCCESS
                                        </span>
                                      )}
                                      {isWarning && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold text-[10px] border border-amber-500/30 shrink-0">
                                          <AlertTriangle size={11} /> WARNING ({run.errors} err)
                                        </span>
                                      )}
                                      {isFailed && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold text-[10px] border border-rose-500/30 shrink-0">
                                          <AlertTriangle size={11} /> FAILED
                                        </span>
                                      )}
                                      {!isSuccess && !isWarning && !isFailed && !isAborted && (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-[10px] border border-indigo-500/30">
                                            ● EXECUTING
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              e.preventDefault();
                                              handleKillProcess(null, run.logFile);
                                            }}
                                            className="px-2 py-0.5 rounded-full bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 font-bold text-[10px] border border-rose-500/30 cursor-pointer transition-colors"
                                            title="Abort running process"
                                          >
                                            🛑 Abort
                                          </button>
                                        </div>
                                      )}
                                      <div className="truncate space-y-0.5">
                                        <div className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-2">
                                          <span>📅 <strong className="text-[var(--text-primary)]">{run.startTime || 'Recent'}</strong></span>
                                          {run.elapsed && <span className="text-indigo-300 font-semibold">⏱️ {run.elapsed}</span>}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {run.sizeTransferred && (
                                        <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] font-mono text-cyan-400 font-bold">
                                          📦 {run.sizeTransferred}
                                        </span>
                                      )}
                                      {run.filesTransferred && (
                                        <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] font-mono text-indigo-300">
                                          📄 {run.filesTransferred} files
                                        </span>
                                      )}
                                      <button
                                        onClick={() => setExpandedLogIdx(isExpanded ? null : expandedId)}
                                        className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-[10px] font-bold cursor-pointer border border-indigo-500/20 transition-colors flex items-center gap-1"
                                      >
                                        <Terminal size={10} /> {isExpanded ? 'Hide Log' : 'View Log'}
                                      </button>
                                    </div>
                                  </div>
                                  {isExpanded && (
                                    <div className="mt-3 rounded-xl bg-black border border-[var(--border-color)] overflow-hidden">
                                      <div className="px-3 py-1 bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-muted)] flex items-center justify-between border-b border-[var(--border-color)]">
                                        <span>Terminal Log Output</span>
                                        <span className="text-emerald-400">{run.logFile}</span>
                                      </div>
                                      <div className="p-3 max-h-64 overflow-y-auto text-[10px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
                                        {run.logPreview || 'No additional logs available.'}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
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
                <CustomSelect
                  value={newRemoteType}
                  onChange={setNewRemoteType}
                  options={[
                    { value: 's3', label: 'AWS S3 / Cloudflare R2 / MinIO / Wasabi / B2' },
                    { value: 'drive', label: 'Google Drive' },
                    { value: 'sftp', label: 'SFTP / SSH Server' },
                    { value: 'webdav', label: 'WebDAV / Nextcloud' },
                  ]}
                />
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
        <div style={{ zIndex: 9999 }} className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
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
        <div style={{ zIndex: 9998 }} className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl relative">
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
                <DynamicCronPicker
                  value={editingCron.schedule}
                  onChange={(val) => setEditingCron({ ...editingCron, schedule: val })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 relative z-30">
                <div className="relative z-20">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Source Path</label>
                    <button onClick={() => openPathPicker('source')} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-0.5 cursor-pointer bg-indigo-500/10 hover:bg-indigo-500/20 px-1.5 py-0.5 rounded border border-indigo-500/20 transition-colors">
                      <Folder size={10} /> Browse...
                    </button>
                  </div>
                  <PathInputWithAutocomplete
                    value={editingCron.source}
                    onChange={(val) => setEditingCron({ ...editingCron, source: val })}
                    placeholder="/var/www/html"
                    selectedConnId={selectedConnId}
                    apiFetch={apiFetch}
                    remotes={rcloneStatus?.remotes || []}
                    accentColor="indigo"
                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none"
                  />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Destination</label>
                    <button onClick={() => openPathPicker('target')} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-0.5 cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/20 transition-colors">
                      <HardDrive size={10} /> Browse...
                    </button>
                  </div>
                  <PathInputWithAutocomplete
                    value={editingCron.target}
                    onChange={(val) => setEditingCron({ ...editingCron, target: val })}
                    placeholder="gdrive:backup"
                    selectedConnId={selectedConnId}
                    apiFetch={apiFetch}
                    remotes={rcloneStatus?.remotes || []}
                    accentColor="emerald"
                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none"
                  />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2 relative z-0">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-400 cursor-pointer select-none">
                  <input type="checkbox" checked={editingCron.options?.enableRetention ?? true} onChange={(e) => setEditingCron({ ...editingCron, options: { ...editingCron.options, enableRetention: e.target.checked } })} className="rounded border-[var(--border-color)] text-amber-500 focus:ring-0" />
                  🧹 Auto Retention Cleanup
                </label>
                {editingCron.options?.enableRetention && (
                  <div className="flex items-center gap-2 pl-5">
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0">Delete older than:</span>
                    <CustomSelect
                      value={editingCron.options?.retentionDays || '7'}
                      onChange={(val) => setEditingCron({ ...editingCron, options: { ...editingCron.options, retentionDays: val } })}
                      textClass="text-amber-400 font-mono font-semibold"
                      options={[
                        { value: '3', label: '3 Days' },
                        { value: '7', label: '7 Days' },
                        { value: '14', label: '14 Days' },
                        { value: '30', label: '30 Days' },
                        { value: '90', label: '90 Days' },
                      ]}
                    />
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
