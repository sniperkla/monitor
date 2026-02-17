'use client';

import { useApp } from '@/context/AppContext';
import { X, Database, Edit, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import DatabaseView from './DatabaseView';

export default function DatabaseBrowser({ initialConnection, onEditConnection, onNewConnection }) {
  const { state, dispatch } = useApp();
  const { activeDatabaseBrowsers } = state;
  const activeTab = state.activeDatabaseBrowserId;

  const setActiveTab = (id) => {
    dispatch({ type: 'SET_ACTIVE_DATABASE_BROWSER', payload: id });
  };

  const [isOpening, setIsOpening] = useState(!!initialConnection);
  const isStandalone = !!initialConnection;

  // Auto-open initial connection if provided (for standalone mode)
  useEffect(() => {
    if (initialConnection) {
      // Check if already open
      const existing = activeDatabaseBrowsers.find(b => b.connectionId === initialConnection._id);
      if (!existing) {
        dispatch({
          type: 'OPEN_DATABASE_BROWSER',
          payload: {
            id: `db-${initialConnection._id}-${Date.now()}`,
            connectionId: initialConnection._id,
            connectionName: initialConnection.name,
            color: initialConnection.color,
            connection: initialConnection,
          },
        });
      } else {
        setActiveTab(existing.id);
      }
      setIsOpening(false);
    }
  }, [initialConnection]);

  const handleCloseTab = (id) => {
    dispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: id });
  };

  const dbConnections = state.connections.filter(c => c.type === 'database');

  if (activeDatabaseBrowsers.length === 0 || isOpening) {
    if (isStandalone) {
      return (
        <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)]">
           <div className="text-center animate-pulse">
              <Database size={40} className="text-emerald-500 mx-auto mb-4" />
              <p className="text-[var(--text-muted)] text-sm">Opening {initialConnection.name}...</p>
           </div>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)]">
        <div className="text-center p-12 w-full max-w-4xl">
          <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-2xl relative"
            style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2))', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <Database size={36} style={{ color: 'var(--accent-emerald)' }} className="drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[var(--bg-primary)] shadow-lg">
               <Plus size={14} className="text-white" />
            </div>
          </div>
          <h3 className="text-2xl font-bold mb-2 text-[var(--text-primary)] tracking-tight">
            Database Launchpad
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-10">
            Select a connection to manage your data. 
            Your saved databases are shown below.
          </p>

          <div className="space-y-8">
            {dbConnections.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4 text-center">Your Saved Connections</h4>
                <div className="flex flex-wrap gap-4 justify-center">
                  {dbConnections.map(conn => (
                    <div key={conn._id} className="relative group">
                      <button 
                        onClick={() => {
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
                        className="flex flex-col items-center p-6 bg-white/5 hover:bg-white/10 rounded-3xl w-40 border border-white/5 hover:border-emerald-500/30 transition-all hover:scale-105 active:scale-95 shadow-xl group cursor-grab active:cursor-grabbing"
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
                    onClick={onNewConnection}
                    className="flex flex-col items-center justify-center p-6 bg-white/5 hover:bg-emerald-500/10 rounded-3xl w-40 border border-dashed border-white/20 hover:border-emerald-500/40 transition-all hover:scale-105 active:scale-95 group"
                  >
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 bg-white/5 border border-white/10 group-hover:bg-emerald-500/20 group-hover:border-emerald-500/30 transition-all">
                      <Plus size={24} className="text-[var(--text-muted)] group-hover:text-emerald-400" />
                    </div>
                    <span className="font-bold text-[10px] text-[var(--text-muted)] group-hover:text-emerald-400 uppercase tracking-tight">Add Connection</span>
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
                   <span>Create New Connection</span>
                </button>
                <p className="text-[9px] text-[var(--text-muted)] mt-4 uppercase tracking-[0.3em] font-medium opacity-50">
                   Start by adding a MongoDB or MySQL server
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isStandalone) {
    const browser = activeDatabaseBrowsers.find(b => b.connectionId === initialConnection._id);
    if (!browser) return null;
    return (
      <div className="h-full flex flex-col bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
        <DatabaseView
          connection={browser.connection}
          onClose={() => handleCloseTab(browser.id)}
          onEditConnection={onEditConnection}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
      {/* Tab bar */}
      <div className="flex bg-[var(--bg-tertiary)]/20 border-b border-[var(--border-color)] px-2 pt-2 gap-1 overflow-x-auto custom-scrollbar no-scrollbar">
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
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0 relative">
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
      </div>
    </div>
  );
}
