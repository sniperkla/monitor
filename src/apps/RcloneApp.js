'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CloudSync, HardDrive, RefreshCw, Terminal, CheckCircle2, AlertTriangle,
  Plus, Trash2, Folder, File, Play, Shield, Settings, Server, Database,
  ArrowRight, Download, Eye, ExternalLink, Cpu, Info, Check, ShieldCheck,
  Zap, Copy, ArrowLeftRight, Monitor, ChevronRight, Link2, ChevronDown, Search, X, Clock,
  KeyRound, LogIn, HelpCircle
} from 'lucide-react';
import { useVault } from '@/context/VaultContext';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import MasterPasswordModal from '@/components/MasterPasswordModal';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import RcloneOnboarding, { hasCompletedRcloneOnboarding, resetRcloneOnboarding } from '@/components/RcloneOnboarding';
import ThemeSelect from '@/components/common/ThemeSelect';

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
  const justSelectedRef = useRef(false);
  const cacheRef = useRef({});

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
    const cacheKey = `${selectedConnId}:${targetType}:${dir}`;
    
    if (cacheRef.current[cacheKey]) {
      const filtered = cacheRef.current[cacheKey].filter(item =>
        item.Name && item.Name.toLowerCase().startsWith(prefix.toLowerCase())
      );
      setSuggestions(filtered);
      setIsOpen(filtered.length > 0);
      setSelectedIndex(filtered.length > 0 ? 0 : -1);
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch(`/api/rclone/browse?connectionId=${selectedConnId}&remote=${encodeURIComponent(targetType)}&path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.items)) {
        cacheRef.current[cacheKey] = data.items;
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
    justSelectedRef.current = false;
    
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchItems(newVal);
    }, 150);
  };

  const applySuggestion = (item) => {
    if (item.isRemoteName) {
      onChange(item.Name);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => fetchItems(item.Name), 150);
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

    justSelectedRef.current = true;
    onChange(newPath);
    setIsOpen(false);
    setSelectedIndex(-1);
    setSuggestions([]);
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
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    cacheRef.current = {};
  }, [selectedConnId]);

  return (
    <div ref={wrapperRef} className={`relative w-full ${isOpen ? 'z-[990]' : 'z-10'}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => {
            if (justSelectedRef.current) {
              justSelectedRef.current = false;
              return;
            }
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
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[var(--text-muted)] block">
              Custom Cron or Natural Input (e.g., &quot;5 min&quot;, &quot;18:00&quot;, &quot;every 2 hours&quot;, &quot;*/5 * * * *&quot;):
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

                const minMatch = lower.match(/^(?:every\s+)?(\d+)\s*(?:m|min|mins|minutes)$/);
                const timeMatch = lower.match(/^(\d{1,2})[:.](\d{2})$/);
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
              placeholder="e.g. 5 min, 18:00, or 0 4 * * 1-5"
              className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
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

export default function RcloneApp({ windowId = 'rclone', activeTab: propActiveTab }) {
  const { vaultStatus } = useVault();
  const { state: appState, apiFetch, connectionsReady } = useApp();
  const { showAlert, showConfirm, updateWindowProps, toggleMaximize, state: osState } = useOS();

  // Helper: ensure the window is maximized before starting the tour
  const ensureMaximizedThenShow = useCallback(() => {
    const win = (osState?.windows || []).find(w => w.id === windowId);
    if (win && !win.isMaximized) {
      toggleMaximize(windowId);
      setTimeout(() => setShowOnboarding(true), 350);
    } else {
      setShowOnboarding(true);
    }
  }, [osState, windowId, toggleMaximize]);

  // Onboarding: show on first visit, hide once completed
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasCompletedRcloneOnboarding()) {
        ensureMaximizedThenShow();
      }
    }, 400);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Read connections directly from AppContext so all apps share the same source of truth
  const connections = (appState?.connections || []).filter(c => c.type !== 'database');
  const [selectedConnId, setSelectedConnId] = useState('');
  const [activeTab, setActiveTabState] = useState(propActiveTab || 'setup'); // 'setup' | 'remotes' | 'backup' | 'browser'
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    if (windowId && updateWindowProps) {
      updateWindowProps(windowId, { activeTab: tab });
    }
  };
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
  // Google Drive auth mode: 'oauth' | 'service_account'
  const [driveAuthMode, setDriveAuthMode] = useState('oauth');
  // OAuth flow state
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthToast, setOauthToast] = useState(null); // { type: 'success'|'error', msg: string }

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

  // Cron Live Log (scheduled + manual — shown in Schedules tab)
  const [cronLiveLog, setCronLiveLog] = useState('');
  const [cronLiveLogRunning, setCronLiveLogRunning] = useState(false);
  const [cronLiveLogFile, setCronLiveLogFile] = useState('');
  const cronLiveLogRef = useRef(null);

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

  // Cron Schedule Result Modal State
  const [cronResult, setCronResult] = useState(null); // { testPassed, testStatus, humanSchedule, testOutput, finalSchedule }
  const [updateResult, setUpdateResult] = useState(null); // { success, message, schedule? }

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

  // Auto-select first connection once global connections are ready and none is selected yet
  useEffect(() => {
    if (!connectionsReady || connections.length === 0 || selectedConnId) return;
    // Try to restore from localStorage first
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('rclone-selected-conn') : null;
    const restoredConn = savedId && connections.find(c => (c._id || c.id) === savedId);
    const firstConn = restoredConn || connections[0];
    setSelectedConnId(firstConn._id || firstConn.id);
  }, [connectionsReady, connections, selectedConnId]);

  // Handle OAuth callback result (success/error query params added by /api/rclone/oauth/callback)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const success = params.get('oauth_success');
    const error   = params.get('oauth_error');
    if (success || error) {
      setOauthToast({ type: success ? 'success' : 'error', msg: success || error });
      // Clean the query string without a page reload
      const clean = window.location.pathname + (params.get('app') ? `?app=${params.get('app')}` : '');
      window.history.replaceState({}, '', clean);
      // If success, refresh remotes so the new one appears immediately
      if (success) {
        setTimeout(fetchRcloneStatus, 800);
      }
      // Auto-dismiss after 8 s
      setTimeout(() => setOauthToast(null), 8000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch Rclone status whenever selected connection changes & clear stale data
  useEffect(() => {
    if (selectedConnId) {
      // Persist so we can restore on reopen without needing SSH Manager
      if (typeof window !== 'undefined') localStorage.setItem('rclone-selected-conn', selectedConnId);

      if (vaultStatus === 'unlocked') {
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
        setCollapsedProjects({});
        setExpandedLogIdx(null);
        setHistoryFilter('all');
        fetchRcloneStatus();
        fetchCrons();
        fetchHistory();
      }
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
        showAlert(data?.error || 'Failed to kill process', 'Error');
      }
    } catch (err) {
      showAlert(`Error: ${err.message}`, 'Error');
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
    if (cronLiveLogRef.current) {
      cronLiveLogRef.current.scrollTop = cronLiveLogRef.current.scrollHeight;
    }
  }, [cronLiveLog]);

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
            if (data.log && data.log.trim()) {
              setInstallLog(data.log);
            }
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

  // Poll active backup job status (backup tab)
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
            // Mirror to cron live log as well so crons tab stays in sync
            setCronLiveLog(data.log || '');
            setCronLiveLogRunning(data.running);
            if (activeJob.logFile) setCronLiveLogFile(activeJob.logFile);
          }
        } catch (_) {}
      }, 1500);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activeJob, isJobRunning, selectedConnId, apiFetch]);

  // Poll most-recently-modified rclone log for Schedules tab (covers cron-triggered jobs)
  useEffect(() => {
    if (!selectedConnId || activeTab !== 'crons') return;
    // If a manual job is already feeding cronLiveLog via the effect above, skip independent polling
    let interval = null;
    interval = setInterval(async () => {
      try {
        // Find the latest modified rclone cron log across persistent and /tmp paths
        const res = await apiFetch(
          `/api/rclone/history?connectionId=${selectedConnId}&latestLog=1&target=${encodeURIComponent(targetPath || '')}`,
        );
        const data = await res.json();
        if (data?.success && data.latestLog) {
          // latestLog contains { logFile, content, running }
          setCronLiveLog(data.latestLog.content || '');
          setCronLiveLogRunning(!!data.latestLog.running);
          setCronLiveLogFile(data.latestLog.logFile || '');
        }
      } catch (_) {}
    }, 3000);
    return () => { if (interval) clearInterval(interval); };
  }, [selectedConnId, activeTab, apiFetch, targetPath]);

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
      showAlert('Please enter remote name and select type', 'Warning');
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
        showAlert(data?.error || 'Failed to add remote', 'Error');
      }
    } catch (err) {
      showAlert(err.message, 'Error');
    }
    setLoading(false);
  };

  /**
   * Start Google OAuth flow in a popup window.
   * Calls POST /api/rclone/oauth to get the auth URL, then opens a small
   * popup. The callback route redirects to /?app=rclone&oauth_success=...
   * which sends a postMessage back to this window to close the popup and
   * refresh remotes without ever navigating the main page.
   */
  const handleStartOAuth = async () => {
    if (!newRemoteName.trim()) {
      showAlert('Please enter a Remote Name before authenticating', 'Warning');
      return;
    }
    if (!remoteConfig.client_id?.trim() || !remoteConfig.client_secret?.trim()) {
      showAlert('Please enter your Client ID and Client Secret first', 'Warning');
      return;
    }

    setOauthLoading(true);
    setOauthToast(null);
    try {
      const res = await apiFetch('/api/rclone/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnId,
          remoteName: newRemoteName.trim(),
          clientId: remoteConfig.client_id,
          clientSecret: remoteConfig.client_secret,
          scope: remoteConfig.scope || 'drive',
        }),
      });
      const data = await res.json();
      if (!data?.success || !data?.authUrl) {
        setOauthLoading(false);
        setOauthToast({ type: 'error', msg: data?.error || 'Failed to build auth URL' });
        return;
      }

      // Open Google sign-in in a popup (600×700)
      const popupWidth  = 600;
      const popupHeight = 700;
      const left = Math.max(0, window.screenX + (window.outerWidth  - popupWidth)  / 2);
      const top  = Math.max(0, window.screenY + (window.outerHeight - popupHeight) / 2);
      const popup = window.open(
        data.authUrl,
        'google_oauth',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`,
      );

      if (!popup) {
        // Popup blocked — fall back to redirect
        setOauthLoading(false);
        setOauthToast({ type: 'error', msg: 'Popup blocked! Please allow popups for this site and try again.' });
        return;
      }

      // Listen for postMessage from the callback page OR poll for closure
      const messageHandler = async (event) => {
        // Only trust messages from same origin
        if (event.origin !== window.location.origin) return;
        const { oauthResult } = event.data || {};
        if (!oauthResult) return;

        window.removeEventListener('message', messageHandler);
        clearInterval(pollInterval);

        if (!oauthResult.success) {
          popup.close();
          setOauthLoading(false);
          setOauthToast({ type: 'error', msg: oauthResult.error || 'OAuth failed' });
          setTimeout(() => setOauthToast(null), 8000);
          return;
        }

        // Token received — now save via apiFetch so x-mongodb-uri headers are included
        try {
          const saveRes = await apiFetch('/api/rclone/oauth/save-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId:  oauthResult.connectionId,
              remoteName:    oauthResult.remoteName,
              clientId:      oauthResult.clientId,
              clientSecret:  oauthResult.clientSecret,
              scope:         oauthResult.scope,
              rcloneToken:   oauthResult.rcloneToken,
            }),
          });
          const saveData = await saveRes.json();

          popup.close();
          setOauthLoading(false);

          if (saveData?.success) {
            setOauthToast({ type: 'success', msg: saveData.message || `Remote "${newRemoteName}" authenticated!` });
            setShowAddRemoteModal(false);
            setNewRemoteName('');
            setRemoteConfig({});
            setDriveAuthMode('oauth');
            setTimeout(fetchRcloneStatus, 600);
          } else {
            setOauthToast({ type: 'error', msg: saveData?.error || 'Failed to save rclone config' });
          }
        } catch (saveErr) {
          popup.close();
          setOauthLoading(false);
          setOauthToast({ type: 'error', msg: `Save failed: ${saveErr.message}` });
        }
        setTimeout(() => setOauthToast(null), 8000);
      };
      window.addEventListener('message', messageHandler);

      // Fallback: if popup closed by user without completing
      const pollInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollInterval);
          window.removeEventListener('message', messageHandler);
          setOauthLoading(false);
        }
      }, 500);

    } catch (err) {
      setOauthLoading(false);
      setOauthToast({ type: 'error', msg: err.message });
    }
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
    showConfirm('Clear all backup history logs on server?', async () => {
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
          showAlert(data?.error || 'Failed to clear logs', 'Error');
        }
      } catch (err) {
        showAlert(`Error: ${err.message}`, 'Error');
      }
      setHistoryLoading(false);
    }, 'Clear History', 'Clear', 'Cancel');
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
      showAlert('Please specify source and target paths', 'Warning');
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
        const testStatus = data.testPassed ? 'Connection & Path Test Verification Passed!' : 'Schedule Saved (Dry-Run Notice)';
        setCronResult({
          testPassed: data.testPassed,
          testStatus,
          humanSchedule: data.humanSchedule || finalSchedule,
          testOutput: data.testOutput || 'Rclone connection & paths verified successfully.',
        });
        fetchCrons();
        fetchRcloneStatus();
      } else {
        showAlert(data?.error || 'Failed to add crontab job', 'Error');
      }
    } catch (err) {
      showAlert(err.message, 'Error');
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
        setUpdateResult({
          success: true,
          message: 'Schedule updated successfully on the server.',
          schedule: data.humanSchedule || editingCron.schedule,
        });
        setEditingCron(null);
        fetchCrons();
        fetchRcloneStatus();
      } else {
        setUpdateResult({ success: false, message: data?.error || 'Failed to update crontab task' });
      }
    } catch (err) {
      setUpdateResult({ success: false, message: err.message });
    }
    setLoading(false);
  };

  const handleDeleteCron = async (cronItem) => {
    const rawLine = typeof cronItem === 'string' ? cronItem : cronItem?.raw;
    const taskName = cronItem?.projectName || (cronItem?.source && cronItem?.target ? `${cronItem.source} ➔ ${cronItem.target}` : 'this schedule');

    const warnMsg =
      `⚠️ DELETE TASK FILES CONFIRMATION\n\n` +
      `Do you also want to delete all associated script & log files for "${taskName}" on the server?\n\n` +
      `• Click "Delete All" to DELETE ALL:\n` +
      `  1. Crontab schedule entry\n` +
      `  2. Shell script file (.sh)\n` +
      `  3. All execution log files (.log)\n` +
      `  4. Task lock files (.lock)\n\n` +
      `• Click "Schedule Only" to ONLY remove schedule from crontab (keep .sh script & log history).`;

    const executeCronDelete = async (removeScript) => {
      try {
        const res = await apiFetch(`/api/rclone/cron?connectionId=${selectedConnId}&rawLine=${encodeURIComponent(rawLine)}&removeScript=${removeScript}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (data?.success) {
          fetchCrons();
          fetchHistory(true);
          fetchRcloneStatus();
        } else {
          showAlert(data?.error || 'Failed to remove crontab job', 'Error');
        }
      } catch (err) {
        showAlert(err.message, 'Error');
      }
    };

    showConfirm(`Remove the schedule for "${taskName}" from server crontab?`, () => {
      showConfirm(warnMsg, () => executeCronDelete(true), 'Delete Task Files', 'Delete All', 'Schedule Only', () => executeCronDelete(false));
    }, 'Remove Schedule', 'Remove', 'Cancel');
  };

  const handleDeleteRemote = async (name) => {
    showConfirm(`Delete remote "${name}" from rclone config?`, async () => {
      try {
        const res = await apiFetch(`/api/rclone/remote?connectionId=${selectedConnId}&name=${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (data?.success) {
          fetchRcloneStatus();
        } else {
          showAlert(data?.error || 'Failed to delete remote', 'Error');
        }
      } catch (err) {
        showAlert(err.message, 'Error');
      }
    }, 'Delete Remote', 'Delete', 'Cancel');
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

    const cleanPath = fullPath.replace(/\/+$/, '');
    if (editingCron) {
      if (pickerMode === 'source') {
        setEditingCron({ ...editingCron, source: cleanPath });
      } else {
        setEditingCron({ ...editingCron, target: cleanPath });
      }
    } else {
      if (pickerMode === 'source') {
        setSourcePath(cleanPath);
      } else {
        setTargetPath(cleanPath);
      }
    }
    setPickerMode(null);
  };

  const handleStartBackupJob = async () => {
    if (!sourcePath || !targetPath) {
      showAlert('Please specify source and target paths', 'Warning');
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
          projectName,
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
        showAlert(data?.error || 'Failed to start Rclone job', 'Error');
      }
    } catch (err) {
      setIsJobRunning(false);
      showAlert(err.message, 'Error');
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
            data-onboarding={`tab-${tab.id}`}
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

        <div className="flex-1" />

        {/* Replay tutorial button */}
        <button
          data-onboarding="help-btn"
          onClick={() => { resetRcloneOnboarding(); ensureMaximizedThenShow(); }}
          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/60 transition-colors"
          title="Show tutorial"
        >
          <HelpCircle size={16} />
        </button>
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
                  onClick={() => { setShowAddRemoteModal(true); setDriveAuthMode('oauth'); setOauthToast(null); }}
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
                  <button onClick={() => { setShowAddRemoteModal(true); setDriveAuthMode('oauth'); setOauthToast(null); }} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer">
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

            {/* ─ Row 1: Mode + Action ─ */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Execution Mode Pills */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <button onClick={() => setExecMode('now')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${execMode === 'now' ? 'bg-emerald-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  <Zap size={12} /> Run Now
                </button>
                <button onClick={() => setExecMode('cron')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${execMode === 'cron' ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  <Clock size={12} /> Schedule
                </button>
              </div>

              <div className="h-6 w-px bg-[var(--border-color)]" />

              {/* Transfer Type Pills */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                {[
                  { id: 'copy',  label: 'Copy',  icon: Copy, tip: 'Add new files' },
                  { id: 'sync',  label: 'Sync',  icon: RefreshCw, tip: 'Mirror source' },
                  { id: 'move',  label: 'Move',  icon: ArrowLeftRight, tip: 'Move & delete source' },
                  { id: 'check', label: 'Check', icon: CheckCircle2, tip: 'Verify only' },
                ].map((act) => (
                  <button
                    key={act.id}
                    onClick={() => setAction(act.id)}
                    title={act.tip}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${action === act.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                  >
                    <act.icon size={12} /> {act.label}
                  </button>
                ))}
              </div>

              {execMode === 'cron' && (
                <span className="text-[10px] text-indigo-400 font-semibold ml-1">Schedule settings below</span>
              )}
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
                      → {((targetPath || 'gdrive:').replace(/\/+$/, ''))}/{timestampFormat === 'YMD_MMM_HM' ? '2026_Jul_25_22_05' : timestampFormat === 'DMY_HM' ? '25-07-2026_22-03' : '2026-07-25_22-03-41'}/
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

            {/* Execution log moved to Schedules tab — nothing here */}
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
                              // Strip $HOME/ prefix so the edit field shows a clean path.
                              // The API's normSource logic will re-expand it correctly on save,
                              // and this prevents the $HOME/$HOME/ accumulation bug on repeat saves.
                              const cleanSource = (cron.source || '/')
                                .replace(/^\$HOME\//, '/')
                                .replace(/^~\//, '/');
                              setEditingCron({
                                rawLine: cron.raw,
                                schedule: cron.schedule,
                                action: cron.action || 'copy',
                                source: cleanSource,
                                target: cron.target || 'gdrive:',
                                options: {
                                  useTimestampFolder: cron.options?.useTimestampFolder ?? true,
                                  timestampFormat: cron.options?.timestampFormat || 'YMD_HMS',
                                  enableRetention: cron.options?.enableRetention ?? false,
                                  retentionDays: cron.options?.retentionDays || '7',
                                }
                              });
                            }}
                            className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer" title="Edit Schedule"
                          >
                            <Settings size={12} />
                          </button>
                          <button onClick={() => handleDeleteCron(cron)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer" title="Delete Schedule"><Trash2 size={12} /></button>
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

            {/* ─ Live Execution Log ─ */}
            <div className="rounded-2xl bg-black border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <Terminal size={12} />
                  Live Execution Log
                  {cronLiveLogFile && (
                    <span className="font-mono text-[9px] text-[var(--text-muted)] opacity-60 ml-1 truncate max-w-[240px]" title={cronLiveLogFile}>
                      {cronLiveLogFile.split('/').pop()}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {cronLiveLogRunning && (
                    <span className="text-emerald-400 font-mono text-[10px] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                      RUNNING
                    </span>
                  )}
                  {cronLiveLog && !cronLiveLogRunning && (
                    <span className="text-slate-500 font-mono text-[10px]">● IDLE</span>
                  )}
                  <button
                    onClick={() => { setCronLiveLog(''); setCronLiveLogFile(''); setCronLiveLogRunning(false); }}
                    className="text-[10px] text-[var(--text-muted)] hover:text-rose-400 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Clear log view"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <pre
                ref={cronLiveLogRef}
                className="p-4 font-mono text-[11px] text-emerald-400 h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed"
              >
                {cronLiveLog || (
                  <span className="text-[var(--text-muted)] opacity-50">
                    Waiting for process output... Run a backup task or wait for a scheduled job to fire.
                  </span>
                )}
              </pre>
            </div>
          </div>
        )}

        {/* ════════════════════ TAB 4: HISTORY ════════════════════ */}
        {activeTab === 'history' && (
          <div className="p-5 max-w-3xl space-y-4">

            {/* Header & Controls */}
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

              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter Pills */}
                <div className="flex items-center bg-[var(--bg-secondary)] p-1 rounded-xl border border-[var(--border-color)] text-[10px]">
                  <button onClick={() => setHistoryFilter('all')} className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>All</button>
                  <button onClick={() => setHistoryFilter('backup')} className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'backup' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>📋 Backup</button>
                  <button onClick={() => setHistoryFilter('cleanup')} className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${historyFilter === 'cleanup' ? 'bg-indigo-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>🧹 Cleanup</button>
                </div>
                <button
                  onClick={() => setAutoRefreshHistory(!autoRefreshHistory)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-[10px] cursor-pointer border transition-colors ${autoRefreshHistory ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}
                  title="Toggle 6-second real-time history refresh"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${autoRefreshHistory ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                  {autoRefreshHistory ? 'Realtime 6s' : 'Paused'}
                </button>
                <button onClick={() => fetchHistory(false)} disabled={historyLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-[11px] font-bold cursor-pointer border border-emerald-500/30 disabled:opacity-50 transition-colors">
                  <RefreshCw size={11} className={historyLoading ? 'animate-spin' : ''} /> Refresh
                </button>
                <button onClick={handleClearHistory} disabled={historyLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-bold cursor-pointer border border-rose-500/20 disabled:opacity-50 transition-colors" title="Clear all backup history log files on server">
                  🧹 Clear
                </button>
              </div>
            </div>

            {/* Project Cards — one card per project name */}
            {historyLoading && historyProjects.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <RefreshCw size={14} className="animate-spin text-emerald-400" />
                Fetching backup history from {selectedConn?.name}...
              </div>
            ) : historyProjects.length === 0 ? (
              <div className="p-10 text-center space-y-2 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <Database size={28} className="text-[var(--text-muted)] mx-auto opacity-40" />
                <p className="text-xs text-[var(--text-muted)]">No backup execution logs found on {selectedConn?.name} yet.</p>
                <p className="text-[10px] text-[var(--text-muted)] opacity-70">Logs appear in <code>/tmp/rclone-cron-*.log</code> after cron tasks run.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {historyProjects.map((project, pIdx) => {
                  const projKey = project.name || `__proj_${pIdx}`;
                  // Default collapsed — expanded when collapsedProjects[projKey] === true
                  const isExpanded = collapsedProjects[projKey] === true;

                  const runsToDisplay = project.runs.filter(run => {
                    if (historyFilter === 'backup') return run.action !== 'cleanup';
                    if (historyFilter === 'cleanup') return run.action === 'cleanup';
                    return true;
                  });
                  if (runsToDisplay.length === 0) return null;

                  const hasActiveRun = runsToDisplay.some(r => r.status === 'running');
                  const lastStatus = runsToDisplay[0]?.status;
                  const statusDotCls = lastStatus === 'success' ? 'bg-emerald-400'
                    : lastStatus === 'failed'  ? 'bg-rose-400'
                    : lastStatus === 'warning' ? 'bg-amber-400'
                    : lastStatus === 'aborted' ? 'bg-rose-400'
                    : hasActiveRun             ? 'bg-indigo-400 animate-pulse'
                    : 'bg-gray-500';

                  return (
                    <div key={projKey} className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">

                      {/* ── Project header (click to expand/collapse) ── */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setCollapsedProjects(prev => ({ ...prev, [projKey]: !isExpanded }))}
                        onKeyDown={(e) => e.key === 'Enter' && setCollapsedProjects(prev => ({ ...prev, [projKey]: !isExpanded }))}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--bg-tertiary)]/60 transition-colors cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotCls}`} />
                          <Folder size={13} className="text-indigo-400 shrink-0" />
                          <span className="text-xs font-bold text-[var(--text-primary)] truncate">{project.name}</span>
                          {hasActiveRun && (
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold animate-pulse shrink-0">● RUNNING</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {hasActiveRun && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleKillProcess(null, null); }}
                              className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer transition-colors flex items-center gap-1"
                              title="Abort all active transfers in this project"
                            >🛑 Abort</button>
                          )}
                          <span className="text-[10px] text-[var(--text-muted)] bg-black/20 px-2 py-0.5 rounded font-semibold">
                            {runsToDisplay.length} backup{runsToDisplay.length !== 1 ? 's' : ''}
                          </span>
                          <span className={`text-[var(--text-muted)] text-xs transition-transform duration-200 inline-block ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
                        </div>
                      </div>

                      {/* ── Backup entries (one per run) ── */}
                      {isExpanded && (
                        <div className="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)]">
                          {runsToDisplay.map((run, idx) => {
                            const expandedId = `${pIdx}-${idx}`;
                            const isLogExpanded = expandedLogIdx === expandedId;
                            const act = (run.action || 'copy').toLowerCase();
                            const isSuccess = run.status === 'success';
                            const isWarning = run.status === 'warning';
                            const isFailed  = run.status === 'failed';
                            const isAborted = run.status === 'aborted';
                            const isRunning = !isSuccess && !isWarning && !isFailed && !isAborted;

                            const ACTION_BADGES = {
                              cleanup: { label: '🧹 CLEANUP', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
                              sync:    { label: '🔄 SYNC',    cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
                              move:    { label: '📦 MOVE',    cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
                              check:   { label: '🔍 CHECK',   cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
                              copy:    { label: '📋 COPY',    cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
                            };
                            const badge = ACTION_BADGES[act] || { label: act.toUpperCase(), cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };

                            return (
                              <div key={idx} className="px-4 py-3 hover:bg-[var(--bg-tertiary)]/20 transition-colors">
                                {/* Single backup row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    {/* Action */}
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${badge.cls}`}>{badge.label}</span>
                                    {/* Status */}
                                    {isAborted && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold text-[10px] border border-rose-500/30 shrink-0">🛑 ABORTED</span>}
                                    {isSuccess  && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold text-[10px] border border-emerald-500/30 shrink-0"><CheckCircle2 size={10} /> SUCCESS</span>}
                                    {isWarning  && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold text-[10px] border border-amber-500/30 shrink-0"><AlertTriangle size={10} /> WARNING ({run.errors} err)</span>}
                                    {isFailed   && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold text-[10px] border border-rose-500/30 shrink-0"><AlertTriangle size={10} /> FAILED</span>}
                                    {isRunning  && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-[10px] border border-indigo-500/30 shrink-0 animate-pulse">● EXECUTING</span>}
                                    {/* Timestamp & elapsed */}
                                    <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                                      📅 <strong className="text-[var(--text-primary)]">{run.startTime || 'Recent'}</strong>
                                      {run.elapsed && <span className="ml-1.5 text-indigo-300">⏱ {run.elapsed}</span>}
                                    </span>
                                  </div>

                                  {/* Right: stats + log button */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {run.sizeTransferred && (
                                      <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] font-mono text-cyan-400 font-bold">{run.sizeTransferred}</span>
                                    )}
                                    {run.filesTransferred && (
                                      <span className="px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] font-mono text-indigo-300">{run.filesTransferred} files</span>
                                    )}
                                    {isRunning && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleKillProcess(null, run.logFile); }}
                                        className="px-2 py-0.5 rounded-full bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 font-bold text-[10px] border border-rose-500/30 cursor-pointer transition-colors"
                                        title="Abort this running process"
                                      >🛑 Abort</button>
                                    )}
                                    <button
                                      onClick={() => setExpandedLogIdx(isLogExpanded ? null : expandedId)}
                                      className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-[10px] font-bold cursor-pointer border border-indigo-500/20 transition-colors flex items-center gap-1"
                                    >
                                      <Terminal size={10} /> {isLogExpanded ? 'Hide' : 'Log'}
                                    </button>
                                  </div>
                                </div>

                                {/* Log output panel */}
                                {isLogExpanded && (
                                  <div className="mt-2.5 rounded-xl bg-black border border-[var(--border-color)] overflow-hidden">
                                    <div className="px-3 py-1 bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-muted)] flex items-center justify-between border-b border-[var(--border-color)]">
                                      <span>Terminal Log</span>
                                      <span className="text-emerald-400 truncate max-w-[200px]" title={run.logFile}>{run.logFile?.split('/').pop()}</span>
                                    </div>
                                    <div className="p-3 max-h-64 overflow-y-auto text-[10px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
                                      {run.logPreview || 'No log content available. The backup task may still be starting or the log file is empty.'}
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
                })}
              </div>
            )}
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
            <div className="p-4 space-y-2">
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">Remote Name</label>
                <input type="text" value={newRemoteName} onChange={(e) => setNewRemoteName(e.target.value)} placeholder="e.g. gdrive_backup" className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
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

                  {/* ── Auth mode toggle ── */}
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
                    <button type="button" onClick={() => setDriveAuthMode('oauth')}
                      className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${driveAuthMode === 'oauth' ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      <LogIn size={11} /> OAuth
                    </button>
                    <button type="button" onClick={() => setDriveAuthMode('service_account')}
                      className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${driveAuthMode === 'service_account' ? 'bg-emerald-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      <KeyRound size={11} /> Service Account
                    </button>
                  </div>

                  {/* ════ OAuth Flow ════ */}
                  {driveAuthMode === 'oauth' && (
                    <div className="space-y-2">

                      {/* Redirect URI — inline copyable row */}
                      <div className="flex items-center gap-1.5 bg-[var(--bg-primary)] rounded-lg px-2 py-1.5 border border-indigo-500/20">
                        <span className="text-[9px] text-indigo-400 font-bold shrink-0 uppercase tracking-wide">Redirect URI</span>
                        <code className="text-[10px] font-mono text-emerald-300 flex-1 truncate select-all">
                          {typeof window !== 'undefined' ? `${window.location.origin}/api/rclone/oauth/callback` : '/api/rclone/oauth/callback'}
                        </code>
                        <button type="button"
                          onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/rclone/oauth/callback`)}
                          className="shrink-0 text-indigo-400 hover:text-white cursor-pointer p-0.5 rounded" title="Copy redirect URI">
                          <Copy size={11} />
                        </button>
                      </div>

                      {/* Client ID + Secret side by side */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="text" placeholder="Client ID"
                          value={remoteConfig.client_id || ''}
                          onChange={(e) => setRemoteConfig({ ...remoteConfig, client_id: e.target.value })}
                          className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
                        <input type="password" placeholder="Client Secret"
                          value={remoteConfig.client_secret || ''}
                          onChange={(e) => setRemoteConfig({ ...remoteConfig, client_secret: e.target.value })}
                          className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-indigo-500 focus:outline-none" />
                      </div>

                      {/* Scope + Folder ID side by side */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <ThemeSelect
                          className="w-full"
                          size="sm"
                          value={remoteConfig.scope || 'drive'}
                          onChange={(v) => setRemoteConfig({ ...remoteConfig, scope: v })}
                          options={[
                            { value: 'drive', label: 'Full Access' },
                            { value: 'drive.readonly', label: 'Read-Only' },
                            { value: 'drive.file', label: 'App Files Only' },
                          ]}
                        />
                        <input type="text" placeholder="Folder URL/ID (optional)"
                          value={remoteConfig._drive_url || ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
                            setRemoteConfig({ ...remoteConfig, _drive_url: raw, root_folder_id: match ? match[1] : raw.trim() });
                          }}
                          className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                      </div>
                      {remoteConfig.root_folder_id && (
                        <p className="text-[10px] text-emerald-400 font-mono -mt-1 px-0.5">✓ {remoteConfig.root_folder_id}</p>
                      )}

                      {/* Toast */}
                      {oauthToast && (
                        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold ${oauthToast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                          {oauthToast.type === 'success' ? <CheckCircle2 size={12} className="shrink-0" /> : <AlertTriangle size={12} className="shrink-0" />}
                          <span className="truncate">{oauthToast.msg}</span>
                        </div>
                      )}

                      {/* Sign in with Google */}
                      <button type="button" onClick={handleStartOAuth}
                        disabled={oauthLoading || !newRemoteName.trim() || !remoteConfig.client_id?.trim() || !remoteConfig.client_secret?.trim()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-gray-800 font-bold text-xs transition-colors shadow-sm cursor-pointer border border-gray-200">
                        {oauthLoading ? <RefreshCw size={13} className="animate-spin text-gray-500" /> : (
                          <svg width="14" height="14" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                          </svg>
                        )}
                        {oauthLoading ? 'Opening…' : 'Sign in with Google'}
                      </button>
                    </div>
                  )}

                  {/* ════ Service Account Flow ════ */}
                  {driveAuthMode === 'service_account' && (
                    <div className="space-y-2">
                      {/* Compact steps */}
                      <div className="flex items-start gap-2 bg-emerald-500/8 rounded-lg px-2.5 py-2 border border-emerald-500/20">
                        <ShieldCheck size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                          GCP → IAM → Service Accounts → Create → grant Drive access → download JSON → upload to server → paste path below.
                        </p>
                      </div>
                      <input type="text" placeholder="JSON path on server  (e.g. /home/ec2-user/gdrive-sa.json)"
                        value={remoteConfig.service_account_file || ''}
                        onChange={(e) => setRemoteConfig({ ...remoteConfig, service_account_file: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                      <input type="text" placeholder="Folder URL/ID (optional)"
                        value={remoteConfig._drive_url || ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const match = raw.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
                          setRemoteConfig({ ...remoteConfig, _drive_url: raw, root_folder_id: match ? match[1] : raw.trim() });
                        }}
                        className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
                      {remoteConfig.root_folder_id && (
                        <p className="text-[10px] text-emerald-400 font-mono px-0.5">✓ {remoteConfig.root_folder_id}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {newRemoteType === 'sftp' && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                  <input type="text" placeholder="Hostname / IP" onChange={(e) => setRemoteConfig({ ...remoteConfig, host: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                  <input type="text" placeholder="Username" onChange={(e) => setRemoteConfig({ ...remoteConfig, user: e.target.value })} className="w-full px-3.5 py-1.5 text-xs rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono focus:outline-none" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
              <button onClick={() => { setShowAddRemoteModal(false); setDriveAuthMode('oauth'); setOauthToast(null); }} className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-xs font-semibold hover:bg-[var(--border-color)] cursor-pointer">Cancel</button>
              {/* Hide Save button when using OAuth for drive — OAuth flow saves automatically */}
              {!(newRemoteType === 'drive' && driveAuthMode === 'oauth') && (
                <button onClick={handleSaveRemote} disabled={loading} className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-500/20">
                  {loading ? 'Saving...' : 'Save Remote'}
                </button>
              )}
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
              {/* Options Grid inside Edit Modal */}
              <div className="grid grid-cols-2 gap-2 relative z-0">
                {/* Timestamp Folders Option */}
                <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-indigo-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingCron.options?.useTimestampFolder ?? true}
                      onChange={(e) => setEditingCron({
                        ...editingCron,
                        options: { ...editingCron.options, useTimestampFolder: e.target.checked }
                      })}
                      className="rounded border-[var(--border-color)] text-indigo-600 focus:ring-0"
                    />
                    <span>📅 Timestamp Folder</span>
                  </label>
                  {(editingCron.options?.useTimestampFolder ?? true) && (
                    <div className="space-y-1 pl-5">
                      <CustomSelect
                        value={editingCron.options?.timestampFormat || 'YMD_HMS'}
                        onChange={(val) => setEditingCron({
                          ...editingCron,
                          options: { ...editingCron.options, timestampFormat: val }
                        })}
                        textClass="text-indigo-400 font-mono font-semibold"
                        options={[
                          { value: 'YMD_MMM_HM', label: '2026_Jul_25_22_05' },
                          { value: 'DMY_HM', label: '25-07-2026_22-03' },
                          { value: 'YMD_HMS', label: '2026-07-25_22-03-41' },
                        ]}
                      />
                    </div>
                  )}
                </div>

                {/* Auto Retention Option */}
                <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-amber-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingCron.options?.enableRetention ?? false}
                      onChange={(e) => setEditingCron({
                        ...editingCron,
                        options: { ...editingCron.options, enableRetention: e.target.checked }
                      })}
                      className="rounded border-[var(--border-color)] text-amber-500 focus:ring-0"
                    />
                    <span>🧹 Retention Cleanup</span>
                  </label>
                  {editingCron.options?.enableRetention && (
                    <div className="space-y-1 pl-5">
                      <CustomSelect
                        value={editingCron.options?.retentionDays || '7'}
                        onChange={(val) => setEditingCron({
                          ...editingCron,
                          options: { ...editingCron.options, retentionDays: val }
                        })}
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
      {/* ═══════ macOS-Style Cron Schedule Result Modal ═══════ */}
      <MacOSModalWindow
        isOpen={!!cronResult}
        onClose={() => setCronResult(null)}
        title={cronResult?.testPassed ? 'Schedule Created' : 'Dry-Run Notice'}
        icon={cronResult?.testPassed ? CheckCircle2 : AlertTriangle}
        defaultWidth={520}
        defaultHeight={420}
        closeOnOverlayClick={true}
        maxWidthClassName="max-w-[calc(100vw-40px)] sm:max-w-lg"
        contentClassName="p-0"
      >
        {cronResult && (
          <div className="flex flex-col">
            <div className={`px-6 py-4 ${cronResult.testPassed ? 'bg-emerald-500/10 border-b border-emerald-500/20' : 'bg-amber-500/10 border-b border-amber-500/20'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${cronResult.testPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {cronResult.testPassed ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    {cronResult.testPassed ? '✅ ' : '⚠️ '}{cronResult.testStatus}
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Schedule: <span className="font-mono text-indigo-400 font-semibold">{cronResult.humanSchedule}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-indigo-400" />
                <span className="text-xs font-bold text-[var(--text-primary)]">Connection & Path Test Output</span>
              </div>
              <pre className="w-full max-h-48 overflow-y-auto p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-[11px] text-emerald-400 leading-relaxed whitespace-pre-wrap custom-scrollbar">
                {cronResult.testOutput}
              </pre>
            </div>
            <div className="px-6 py-4 border-t border-[var(--border-color)] flex items-center justify-between gap-3 bg-[var(--bg-secondary)]/50">
              <span className="text-[10px] text-[var(--text-muted)]">
                {cronResult.testPassed
                  ? 'The schedule has been saved on your server and verified successfully.'
                  : 'Schedule saved. Check the rclone remote configuration if the dry-run shows issues.'
                }
              </span>
              <button
                onClick={() => setCronResult(null)}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer ${
                  cronResult.testPassed
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </MacOSModalWindow>

      {/* ═══════ Save Changes Result Modal ═══════ */}
      <MacOSModalWindow
        isOpen={!!updateResult}
        onClose={() => setUpdateResult(null)}
        title={updateResult?.success ? 'Schedule Updated' : 'Update Failed'}
        icon={updateResult?.success ? CheckCircle2 : AlertTriangle}
        defaultWidth={460}
        defaultHeight={260}
        closeOnOverlayClick={true}
        maxWidthClassName="max-w-[calc(100vw-40px)] sm:max-w-md"
        contentClassName="p-0"
      >
        {updateResult && (
          <div className="flex flex-col">
            <div className={`px-6 py-4 ${updateResult.success ? 'bg-emerald-500/10 border-b border-emerald-500/20' : 'bg-rose-500/10 border-b border-rose-500/20'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${updateResult.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {updateResult.success ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    {updateResult.success ? '✅ Schedule updated successfully!' : '❌ Update failed'}
                  </h3>
                  {updateResult.schedule && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Schedule: <span className="font-mono text-indigo-400 font-semibold">{updateResult.schedule}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 flex-1">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{updateResult.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-[var(--border-color)] flex justify-end bg-[var(--bg-secondary)]/50">
              <button
                onClick={() => setUpdateResult(null)}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer ${
                  updateResult.success
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-rose-600 hover:bg-rose-500 text-white'
                }`}
              >
                {updateResult.success ? 'Done ✓' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </MacOSModalWindow>

      {/* First-time onboarding overlay */}
      {showOnboarding && (
        <RcloneOnboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
