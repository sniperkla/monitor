'use client';

import { useApp } from '@/context/AppContext';
import { X, Database, Edit, Plus, Search, ChevronRight } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import DatabaseView from './DatabaseView';

// ─── Connection Picker (empty state — unified design) ────────────────────────

function DatabaseConnectionPicker({ dbConnections, onOpen, onNewConnection, t }) {
  const [search, setSearch] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const filtered = dbConnections.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.host || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="h-full bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden relative"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/ssh-connection')) {
          e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true);
        }
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault(); setIsDragOver(false);
        try {
          const conn = JSON.parse(e.dataTransfer.getData('application/ssh-connection'));
          if (conn.type === 'database') onOpen(conn);
        } catch (_) {}
      }}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-500/10 flex items-center justify-center z-10 pointer-events-none animate-pulse">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
              <Database size={24} className="text-emerald-400" />
            </div>
            <span className="text-sm font-semibold text-emerald-400">Drop to open database</span>
          </div>
        </div>
      )}

      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="min-h-full flex items-center justify-center p-8">
          <div className="w-full max-w-lg flex flex-col items-center gap-6">

            {/* Hero icon */}
            <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center border border-emerald-500/20 shadow-xl shadow-emerald-500/5 ring-1 ring-white/5"
              style={{ background: 'rgba(16,185,129,0.08)' }}>
              <Database className="w-10 h-10 text-emerald-400" />
            </div>

            {/* Title */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                {t('database.launchpad.title')}
              </h2>
              <p className="text-[var(--text-muted)] text-sm max-w-[280px] leading-relaxed mx-auto">
                {t('database.launchpad.subtitle')}
              </p>
            </div>

            {/* Search */}
            <div className="w-full relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-emerald-400 transition-colors" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('database.launchpad.search') || 'Search databases…'}
                className="w-full h-12 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl pl-12 pr-4 text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-[var(--text-muted)] backdrop-blur-sm shadow-sm"
              />
            </div>

            {/* List */}
            <div className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2 space-y-1 backdrop-blur-sm shadow-xl">
              {filtered.length > 0 ? filtered.map(conn => (
                <button
                  key={conn._id || conn.id}
                  onClick={() => onOpen(conn)}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-[var(--bg-card-hover)] transition-all group text-left border border-transparent hover:border-[var(--border-hover)] active:scale-[0.98]"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shrink-0"
                    style={{ background: `linear-gradient(135deg, ${conn.color || '#10b981'}, ${conn.color || '#10b981'}cc)` }}>
                    <Database size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{conn.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate font-mono">{conn.host || conn.dbProvider}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {conn.dbProvider && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        {conn.dbProvider}
                      </span>
                    )}
                    <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                      <ChevronRight size={16} className="text-emerald-400" />
                    </div>
                  </div>
                </button>
              )) : dbConnections.length > 0 ? (
                <div className="p-10 text-center opacity-40">
                  <Database className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
                  <p className="text-xs font-medium uppercase tracking-[0.2em]">No results</p>
                </div>
              ) : null}

              {/* Add connection row — always visible at bottom */}
              <button
                onClick={onNewConnection}
                className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-emerald-500/10 transition-all group text-left border border-transparent hover:border-emerald-500/20 active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-color)] group-hover:border-emerald-500/40 group-hover:bg-emerald-500/10 transition-all shrink-0">
                  <Plus size={18} className="text-[var(--text-muted)] group-hover:text-emerald-400 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-muted)] group-hover:text-emerald-400 transition-colors">
                    {t('database.launchpad.addConnection')}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] opacity-60">
                    {t('database.launchpad.startHint') || 'Connect to MySQL, PostgreSQL, MongoDB…'}
                  </div>
                </div>
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function DatabaseBrowser({ initialConnection, initialConnectionId, windowId, onEditConnection, onNewConnection }) {
  const { t } = useTranslation();
  const { state, dispatch } = useApp();
  const { activeDatabaseBrowsers, standaloneDatabaseBrowsers, connections } = state;
  const activeTab = state.activeDatabaseBrowserId;

  const setActiveTab = (id) => {
    dispatch({ type: 'SET_ACTIVE_DATABASE_BROWSER', payload: id });
  };

  const [isOpening, setIsOpening] = useState(!!initialConnection || !!initialConnectionId);
  const isStandalone = !!initialConnection || !!initialConnectionId;
  const [restoredConnection, setRestoredConnection] = useState(initialConnection || null);
  const initialConnIdRef = useRef(initialConnectionId);

  // Restore mode: auto-connect from initialConnectionId or localStorage
  useEffect(() => {
    if (restoredConnection) return;
    if (!connections || connections.length === 0) return;

    // 1. Try initial connection ID (passed via props on hydration)
    if (initialConnIdRef.current) {
      const conn = connections.find(c => c._id === initialConnIdRef.current);
      if (conn) {
        initialConnIdRef.current = null;
        setRestoredConnection(conn);
        return;
      }
    }

    // 2. Fallback to localStorage persisted ID
    if (windowId) {
      const savedConnId = localStorage.getItem(`db-connection-${windowId}`);
      if (savedConnId) {
        const conn = connections.find(c => c._id === savedConnId);
        if (conn) setRestoredConnection(conn);
      }
    }
  }, [connections, windowId, restoredConnection]);

  // Save selected connection whenever it changes
  useEffect(() => {
    if (restoredConnection?._id && windowId) {
      localStorage.setItem(`db-connection-${windowId}`, restoredConnection._id);
    }
  }, [restoredConnection, windowId]);

  // Use the restored connection for the rest of the logic
  const connToUse = restoredConnection;

  // Auto-open current connection if provided (for standalone mode)
  useEffect(() => {
    if (connToUse) {
      // Close matching manager tab if it exists
      const existingInManager = activeDatabaseBrowsers.find(b => b.connectionId === connToUse._id);
      if (existingInManager) {
        dispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: existingInManager.id });
      }

      // Check if already open in standalone
      const existing = standaloneDatabaseBrowsers.find(b => b.connectionId === connToUse._id);
      if (!existing) {
        const dbId = `db-${connToUse._id}-${Date.now()}`;
        dispatch({
          type: 'OPEN_STANDALONE_DATABASE_BROWSER',
          payload: {
            id: dbId,
            connectionId: connToUse._id,
            connectionName: connToUse.name,
            color: connToUse.color,
            connection: connToUse,
          },
        });
        setActiveTab(dbId);
      } else {
        setActiveTab(existing.id);
      }
      setIsOpening(false);
    }
  }, [connToUse]);

  const handleCloseTab = (id) => {
    if (isStandalone) {
      dispatch({ type: 'CLOSE_STANDALONE_DATABASE_BROWSER', payload: id });
    } else {
      dispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: id });
    }
  };

  const dbConnections = state.connections.filter(c => c.type === 'database');

  const resolveBrowserConnection = (browser) => {
    const fromList = connections.find(c => c._id === browser.connectionId);
    const base = browser.connection || fromList;
    if (!base) return fromList || null;
    if (!fromList) return base;
    return {
      ...fromList,
      ...base,
      password: base.password || fromList.password,
      privateKey: base.privateKey || fromList.privateKey,
      passphrase: base.passphrase || fromList.passphrase,
      authSource: base.authSource || fromList.authSource,
    };
  };

  // For standalone: show loading until the standalone browser is registered
  const standaloneBrowser = (isStandalone && connToUse)
    ? standaloneDatabaseBrowsers.find(b => b.connectionId === connToUse._id)
    : null;

  if (isStandalone && (isOpening || !standaloneBrowser)) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)]">
         <div className="text-center animate-pulse">
            <Database size={40} className="text-emerald-500 mx-auto mb-4" />
            <p className="text-[var(--text-muted)] text-sm">{t('common.opening', { name: connToUse?.name || '...' })}</p>
         </div>
      </div>
    );
  }

  if (!isStandalone && activeDatabaseBrowsers.length === 0) {
    return <DatabaseConnectionPicker dbConnections={dbConnections} onOpen={(conn) => {
      const existingInManager = activeDatabaseBrowsers.find(b => b.connectionId === conn._id);
      if (existingInManager) dispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: existingInManager.id });
      dispatch({
        type: 'OPEN_DATABASE_BROWSER',
        payload: { id: `db-${conn._id}-${Date.now()}`, connectionId: conn._id, connectionName: conn.name, color: conn.color, connection: conn },
      });
    }} onNewConnection={onNewConnection} t={t} />;
  }

  if (isStandalone) {
    if (!standaloneBrowser) return null;
    return (
      <div className="h-full flex flex-col bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
        <DatabaseView
          connection={resolveBrowserConnection(standaloneBrowser)}
          onClose={() => handleCloseTab(standaloneBrowser.id)}
          onEditConnection={onEditConnection}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
      {/* Tab bar */}
      <div className="flex bg-[var(--bg-tertiary)]/20 border-b border-[var(--border-color)] px-2 pt-2 gap-1 overflow-x-auto custom-scrollbar no-scrollbar">
        {activeDatabaseBrowsers.length > 0 ? (
          <>
            {activeDatabaseBrowsers.map((browser) => (
              <button
                key={browser.id}
                onClick={() => setActiveTab(browser.id)}
                draggable
                onDragStart={(e) => {
                  if (browser.connection) {
                    e.dataTransfer.setData('application/ssh-connection', JSON.stringify(browser.connection));
                    e.dataTransfer.effectAllowed = 'copy';
                    // Create a drag image
                    const ghost = document.createElement('div');
                    ghost.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white';
                    ghost.style.cssText = `background:${browser.color || '#10b981'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;`;
                    ghost.textContent = `🗄 ${browser.connectionName}`;
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 0, 0);
                    setTimeout(() => document.body.removeChild(ghost), 0);
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-x border-t min-w-[140px] max-w-[200px] shrink-0 cursor-grab active:cursor-grabbing ${
                  activeTab === browser.id
                    ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[0_-4px_12px_rgba(0,0,0,0.1)]'
                    : 'bg-transparent border-transparent text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                }`}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: browser.color || '#10b981' }} />
                <span className="truncate flex-1 text-left">{browser.connectionName}</span>
                <X 
                  size={12} 
                  className="shrink-0 opacity-50 hover:opacity-100 transition-opacity" 
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(browser.id); }} 
                />
              </button>
            ))}
          </>
        ) : null}
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0 relative">
        {activeDatabaseBrowsers.length > 0 ? (
          <>
            {activeDatabaseBrowsers.map(browser => (
              <div
                key={browser.id}
                className="h-full"
                style={{ display: activeTab === browser.id ? 'block' : 'none' }}
              >
                <DatabaseView
                  connection={resolveBrowserConnection(browser)}
                  onClose={() => handleCloseTab(browser.id)}
                  onEditConnection={onEditConnection}
                />
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
