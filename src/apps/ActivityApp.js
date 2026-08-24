'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import {
  History, Search, RefreshCw, Trash2, ChevronDown,
  FolderOpen, FolderMinus, UploadCloud, Server, Rocket, DatabaseBackup,
  CloudSync, LogIn, Terminal, Settings, Monitor, Book, StickyNote,
  CircleCheckBig, CircleX, Info, Inbox,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CATEGORIES = [
  { id: '',        label: 'All',     icon: History },
  { id: 'app',     label: 'Apps',    icon: Monitor },
  { id: 'file',    label: 'Files',   icon: UploadCloud },
  { id: 'server',  label: 'Servers', icon: Server },
  { id: 'deploy',  label: 'Deploys', icon: Rocket },
  { id: 'backup',  label: 'Backups', icon: DatabaseBackup },
  { id: 'sync',    label: 'Sync',    icon: CloudSync },
];

// Map action prefixes to icons so every entry gets a meaningful glyph
const ACTION_ICONS = [
  { match: /^app\.open/,       icon: FolderOpen },
  { match: /^app\.close/,      icon: FolderMinus },
  { match: /^upload/,          icon: UploadCloud },
  { match: /^service/,         icon: Server },
  { match: /^deploy/,          icon: Rocket },
  { match: /^(backup|restore)/,icon: DatabaseBackup },
  { match: /^sync/,            icon: CloudSync },
  { match: /^auth/,            icon: LogIn },
  { match: /^terminal/,        icon: Terminal },
  { match: /^settings/,        icon: Settings },
  { match: /^wiki/,            icon: Book },
  { match: /^note/,            icon: StickyNote },
];

const STATUS_STYLES = {
  success: { dot: 'bg-emerald-400', text: 'text-emerald-300', Icon: CircleCheckBig },
  error:   { dot: 'bg-rose-400',    text: 'text-rose-300',    Icon: CircleX },
  info:    { dot: 'bg-sky-400',     text: 'text-sky-300',     Icon: Info },
};

// Module-level cache so re-mounts (window/tab switches) render instantly
// instead of flashing the loading skeleton again.
const _cache = { items: null, total: 0 };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Exact local timestamp, e.g. "20:45:33" (adds the date when it's not today)
function exactTime(dateStr) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const today = new Date(); today.setHours(0,0,0,0);
  if (d >= today) return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

export default function ActivityApp() {
  const { apiFetch } = useApp();
  const [items, setItems] = useState(_cache.items || []);
  const [total, setTotal] = useState(_cache.total || 0);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);
  const loadedOnceRef = useRef(false);
  // Mirror items into a ref so append loads never depend on stale closures
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const load = useCallback(async (opts = {}) => {
    const { append = false, q = search, cat = category } = opts;
    // Only show the skeleton on the very first load of this mount;
    // all later refreshes happen silently in the background (no flicker).
    if (!append && !loadedOnceRef.current) setLoading(true);
    else if (append) setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cat) params.set('category', cat);
      if (q) params.set('q', q);
      if (append && cursor) params.set('before', cursor);
      const res = await apiFetch(`/api/activity?${params}`);
      const data = res?.json ? await res.json() : res;
      if (data?.success) {
        setError(null);
        const nextItems = append
          ? [...itemsRef.current, ...(data.items || [])]
          : (data.items || []);
        setItems(nextItems);
        setTotal(data.total || 0);
        setHasMore(!!data.hasMore);
        setCursor(data.nextCursor || null);
        _cache.items = nextItems;
        _cache.total = data.total || 0;
      } else {
        // Surface API-level failures instead of silently showing "empty"
        const msg = data?.error || `API returned success=false (${res?.status ?? 'unknown'})`;
        if (!append) setError(msg);
        console.warn('[Activity] load failed:', msg);
      }
    } catch (e) {
      if (!append) setError(e?.message || 'Failed to load activity');
      console.warn('[Activity] load error:', e?.message);
    }
    finally {
      loadedOnceRef.current = true;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [apiFetch, category, cursor, search]);

  // Initial load + reload on filter change
  useEffect(() => { load({}); /* eslint-disable-next-line */ }, [category]);

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load({}), 350);
    return () => clearTimeout(searchTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(() => load({}), 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, cursor]);

  const clearAll = async () => {
    if (!confirm('Clear your entire activity history?')) return;
    setClearing(true);
    try {
      await apiFetch('/api/activity', { method: 'DELETE' });
      setItems([]); setTotal(0); setHasMore(false); setCursor(null);
    } catch (_) {}
    finally { setClearing(false); }
  };

  const getIcon = (item) => {
    for (const { match, icon } of ACTION_ICONS) {
      if (match.test(item.action)) return icon;
    }
    return History;
  };

  // Group items by day for section headers
  const dayLabel = (dateStr) => {
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d >= today) return 'Today';
    if (d >= yesterday) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };

  let lastDay = null;

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-slate-200">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
              <History size={16} className="text-indigo-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 leading-tight">Activity</h2>
              <p className="text-[11px] text-slate-500">{total} event{total === 1 ? '' : 's'} recorded</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => load({})}
              title="Refresh"
              className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={clearAll}
              disabled={clearing || total === 0}
              title="Clear history"
              className="p-2 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-300 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.06] transition-colors"
          />
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id || 'all'}
              onClick={() => setCategory(id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                category === id
                  ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40'
                  : 'bg-white/[0.04] text-slate-400 border border-transparent hover:bg-white/[0.07] hover:text-slate-200'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : error && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
              <CircleX size={24} className="text-rose-400" />
            </div>
            <p className="text-sm font-medium text-rose-300">Could not load activity</p>
            <p className="text-xs text-slate-500 mt-1 max-w-[280px] break-words">{error}</p>
            <button
              onClick={() => { setError(null); loadedOnceRef.current = false; load({}); }}
              className="mt-4 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4">
              <Inbox size={24} className="text-slate-600" />
            </div>
            <p className="text-sm font-medium text-slate-400">No activity yet</p>
            <p className="text-xs text-slate-600 mt-1 max-w-[240px]">
              Actions like opening apps, uploading files and managing servers will appear here.
            </p>
          </div>
        ) : (
          <>
            {items.map((item, idx) => {
              const ActionIcon = getIcon(item);
              const st = STATUS_STYLES[item.status] || STATUS_STYLES.info;
              const StatusIcon = st.Icon;
              const showDayHeader = dayLabel(item.createdAt) !== lastDay;
              lastDay = dayLabel(item.createdAt);
              return (
                <div key={item._id || idx}>
                  {showDayHeader && (
                    <div className="sticky top-0 z-10 -mx-5 px-5 py-1.5 mb-2 bg-[#0b0e14]/90 backdrop-blur-sm">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {dayLabel(item.createdAt)}
                      </span>
                    </div>
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className="group flex items-start gap-3 rounded-xl px-3 py-2.5 -mx-1 hover:bg-white/[0.03] transition-colors"
                  >
                    {/* Timeline rail */}
                    <div className="relative flex flex-col items-center pt-0.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        item.category === 'file' ? 'bg-cyan-500/10'
                        : item.category === 'server' ? 'bg-amber-500/10'
                        : item.category === 'deploy' ? 'bg-violet-500/10'
                        : item.category === 'backup' ? 'bg-teal-500/10'
                        : item.category === 'sync' ? 'bg-blue-500/10'
                        : 'bg-indigo-500/10'
                      }`}>
                        <ActionIcon size={13} className={
                          item.category === 'file' ? 'text-cyan-300'
                          : item.category === 'server' ? 'text-amber-300'
                          : item.category === 'deploy' ? 'text-violet-300'
                          : item.category === 'backup' ? 'text-teal-300'
                          : item.category === 'sync' ? 'text-blue-300'
                          : 'text-indigo-300'
                        } />
                      </div>
                      {idx < items.length - 1 && (
                        <div className="absolute top-9 bottom-[-10px] w-px bg-white/[0.06]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-[13px] text-slate-200 leading-snug break-words">{item.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center gap-1 text-[11px] ${st.text}`}>
                          <StatusIcon size={11} />
                          {item.status}
                        </span>
                        <span className="text-[11px] text-slate-600" title={new Date(item.createdAt).toLocaleString()}>
                          {timeAgo(item.createdAt)} · {exactTime(item.createdAt)}
                        </span>
                        {item.target && (
                          <span className="text-[11px] text-slate-500 truncate max-w-[180px]">· {item.target}</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}

            {/* Load more */}
            {hasMore && (
              <button
                onClick={() => load({ append: true })}
                disabled={loadingMore}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                <ChevronDown size={14} className={loadingMore ? 'animate-bounce' : ''} />
                {loadingMore ? 'Loading...' : 'Load older activity'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}