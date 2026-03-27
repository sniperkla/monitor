'use client';

import { useApp } from '@/context/AppContext';
import { X, Database, Edit, Plus } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import DatabaseView from './DatabaseView';

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
    return (
      <div className="h-full bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
        <div className="h-full overflow-y-auto custom-scrollbar">
          <div className="text-center p-6 sm:p-12 w-full max-w-4xl mx-auto">
          <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-2xl relative"
            style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2))', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <Database size={36} style={{ color: 'var(--accent-emerald)' }} className="drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[var(--bg-primary)] shadow-lg">
               <Plus size={14} className="text-white" />
            </div>
          </div>
          <h3 className="text-2xl font-bold mb-2 text-[var(--text-primary)] tracking-tight">
            {t('database.launchpad.title')}
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-10">
            {t('database.launchpad.subtitle')}
          </p>

          <div className="space-y-8">
            {dbConnections.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4 text-center">
                  {t('database.launchpad.savedConnections')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 justify-items-center">
                  {dbConnections.map((conn, idx) => (
                    <div key={conn._id || conn.id || `conn-${idx}`} className="relative group">
                      <button 
                        onClick={() => {
                          // Terminate existing session in the manager
                          const existingInManager = activeDatabaseBrowsers.find(b => b.connectionId === conn._id);
                          if (existingInManager) {
                            dispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: existingInManager.id });
                          }

                          if (isStandalone) {
                            const dbId = `db-${conn._id}-${Date.now()}`;
                            dispatch({
                              type: 'OPEN_STANDALONE_DATABASE_BROWSER',
                              payload: {
                                id: dbId,
                                connectionId: conn._id,
                                connectionName: conn.name,
                                color: conn.color,
                                connection: conn,
                              }
                            });
                            setActiveTab(dbId);
                          } else {
                            dispatch({
                              type: 'OPEN_DATABASE_BROWSER',
                              payload: {
                                id: `db-${conn._id}-${Date.now()}`,
                                connectionId: conn._id,
                                connectionName: conn.name,
                                color: conn.color,
                                connection: conn,
                              }
                            });
                          }
                        }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
                          e.dataTransfer.effectAllowed = 'copy';
                          // Create a drag image
                          const ghost = document.createElement('div');
                          ghost.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white';
                          ghost.style.cssText = `background:${conn.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;`;
                          ghost.textContent = `🖥 ${conn.name}`;
                          document.body.appendChild(ghost);
                          e.dataTransfer.setDragImage(ghost, 0, 0);
                          setTimeout(() => document.body.removeChild(ghost), 0);
                        }}
                        className="flex flex-col items-center p-6 bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] rounded-3xl w-40 border border-[var(--border-color)] hover:border-emerald-500/30 transition-all hover:scale-105 active:scale-95 shadow-xl group cursor-grab active:cursor-grabbing"
                      >
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110" 
                          style={{ background: `${conn.color}15`, border: `1px solid ${conn.color}30` }}>
                          <Database size={24} style={{ color: conn.color }} />
                        </div>
                        <span className="font-bold text-xs truncate w-full" style={{ color: 'var(--text-primary)' }}>{conn.name}</span>
                        <span className="text-[8px] text-[var(--text-muted)] mt-1 uppercase tracking-wider">{conn.dbProvider}</span>
                      </button>
                    </div>
                  ))}
                  
                  {/* Add New Card (Trailing) */}
                  <button 
                    key="add-new-connection"
                    onClick={onNewConnection}
                    className="flex flex-col items-center justify-center p-6 bg-[var(--bg-card)] hover:bg-emerald-500/10 rounded-3xl w-40 border border-dashed border-[var(--border-color)] hover:border-emerald-500/40 transition-all hover:scale-105 active:scale-95 group"
                  >
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 bg-[var(--bg-tertiary)] border border-[var(--border-color)] group-hover:bg-emerald-500/20 group-hover:border-emerald-500/30 transition-all">
                      <Plus size={24} className="text-[var(--text-muted)] group-hover:text-emerald-400" />
                    </div>
                    <span className="font-bold text-[10px] text-[var(--text-muted)] group-hover:text-emerald-400 uppercase tracking-tight">{t('database.launchpad.addConnection')}</span>
                  </button>
                </div>
              </div>
            )}

            {!dbConnections.length && (
              <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                <button 
                   onClick={onNewConnection}
                   className="px-10 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl font-bold shadow-2xl shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
                >
                   <Plus size={20} />
                   <span>{t('database.launchpad.createFirst')}</span>
                </button>
                <p className="text-[9px] text-[var(--text-muted)] mt-4 uppercase tracking-[0.3em] font-medium opacity-50">
                   {t('database.launchpad.startHint')}
                </p>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    );
  }

  if (isStandalone) {
    if (!standaloneBrowser) return null;
    return (
      <div className="h-full flex flex-col bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
        <DatabaseView
          connection={standaloneBrowser.connection}
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
                  connection={browser.connection}
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
