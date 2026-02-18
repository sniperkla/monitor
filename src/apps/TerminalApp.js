'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import TerminalView from '@/components/TerminalView';
import { Server, Terminal as TermIcon, Zap, X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function TerminalApp({ onEditConnection, initialConnection }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections, standaloneTerminals } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');
  const [activeTab, setActiveTab] = useState(null);
  const [isSelecting, setIsSelecting] = useState(standaloneTerminals.length === 0 && !initialConnection);
  const initialConnRef = useRef(initialConnection);
  const standaloneTermIdRef = useRef(null);
  const isStandalone = !!initialConnection;

  // For standalone mode: keep connection in local state only (not global)
  const [localStandaloneTerm, setLocalStandaloneTerm] = useState(null);

  // Auto-connect if initialConnection is provided
  useEffect(() => {
    if (initialConnRef.current) {
      const conn = initialConnRef.current;
      initialConnRef.current = null; // Only once
      const termId = `term-${conn._id}-${Date.now()}`;
      standaloneTermIdRef.current = termId;

      if (isStandalone) {
        // Standalone mode: use local state only, do NOT add to global standaloneTerminals
        // This prevents the tab from appearing in the multi-tab TerminalApp
        setLocalStandaloneTerm({
          id: termId,
          connectionId: conn._id,
          connectionName: conn.name,
          host: conn.host,
          color: conn.color,
          connection: conn,
        });
      } else {
        dispatch({
          type: 'OPEN_STANDALONE_TERMINAL',
          payload: {
            id: termId,
            connectionId: conn._id,
            connectionName: conn.name,
            host: conn.host,
            color: conn.color,
            connection: conn,
          },
        });
        setActiveTab(termId);
        setIsSelecting(false);
      }
    }
  }, [dispatch, isStandalone]);

  // Auto-select latest terminal if a new one is added and we aren't selecting
  useEffect(() => {
    if (standaloneTerminals.length > 0 && !isSelecting) {
      if (!activeTab || !standaloneTerminals.find(t => t.id === activeTab)) {
        setActiveTab(standaloneTerminals[standaloneTerminals.length - 1].id);
      }
    }
  }, [standaloneTerminals, activeTab, isSelecting]);

  const handleConnect = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }
    
    // Terminate existing session in the manager
    const existing = state.activeTerminals.find(t => t.connectionId === conn._id);
    if (existing) {
      dispatch({ type: 'CLOSE_TERMINAL', payload: existing.id });
    }

    const termId = `term-${conn._id}-${Date.now()}`;
    dispatch({
      type: 'OPEN_STANDALONE_TERMINAL',
      payload: {
        id: termId,
        connectionId: conn._id,
        connectionName: conn.name,
        host: conn.host,
        color: conn.color,
        connection: conn,
      },
    });
    setActiveTab(termId);
    setIsSelecting(false);
  };

  const handleCloseTab = (termId) => {
    dispatch({ type: 'CLOSE_STANDALONE_TERMINAL', payload: termId });
    if (activeTab === termId) {
      const remaining = standaloneTerminals.filter(t => t.id !== termId);
      if (remaining.length > 0) {
        setActiveTab(remaining[remaining.length - 1].id);
      } else {
        setIsSelecting(true);
        setActiveTab(null);
      }
    }
  };

  // In standalone mode, render just the single terminal without tabs (uses local state)
  if (isStandalone) {
    if (!localStandaloneTerm) {
      return <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden" />;
    }
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
        <TerminalView 
          connectionId={localStandaloneTerm.connectionId}
          connectionName={localStandaloneTerm.connectionName}
          host={localStandaloneTerm.host}
          color={localStandaloneTerm.color}
          connection={localStandaloneTerm.connection}
          onClose={() => setLocalStandaloneTerm(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      {/* App Tab Bar */}
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-2 h-10 shrink-0">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar h-full">
          {standaloneTerminals.map(term => (
            <button
              key={term.id}
              onClick={() => { setActiveTab(term.id); setIsSelecting(false); }}
              draggable
              onDragStart={(e) => {
                if (term.connection) {
                  e.dataTransfer.setData('application/ssh-connection', JSON.stringify(term.connection));
                  // Pass the standalone terminal tab ID so desktop can close it on drop
                  e.dataTransfer.setData('application/standalone-term-id', term.id);
                  // Tell desktop this came from TerminalApp → open as terminal directly
                  e.dataTransfer.setData('application/source-app-type', 'terminal');
                  e.dataTransfer.effectAllowed = 'copy';
                  // Create a drag image
                  const ghost = document.createElement('div');
                  ghost.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white';
                  ghost.style.cssText = `background:${term.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;`;
                  ghost.textContent = `🐚 ${term.connectionName}`;
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }
              }}
              className={`flex items-center gap-2 px-3 h-8 mt-2 rounded-t-lg transition-all text-xs border-x border-t cursor-grab active:cursor-grabbing ${
                activeTab === term.id && !isSelecting
                  ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
                  : 'bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              style={{ minWidth: '120px', maxWidth: '180px' }}
            >
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: term.color }} />
              <span className="truncate flex-1 text-left">{term.connectionName}</span>
              <X 
                size={12} 
                className="hover:text-red-400 shrink-0" 
                onClick={(e) => { e.stopPropagation(); handleCloseTab(term.id); }}
              />
            </button>
          ))}
          
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
        {/* Connection Picker - Layered on top if selecting */}
        {isSelecting && (
          <div className="absolute inset-0 bg-[var(--bg-primary)] overflow-y-auto z-20">
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <TermIcon size={22} className="text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{t('terminal.newSession')}</h1>
                  <p className="text-[var(--text-secondary)] text-sm font-mono">$ select a server to connect</p>
                </div>
                <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-mono text-emerald-400">{sshConnections.filter(c => c.status === 'online').length} online</span>
                </div>
              </div>

              {/* Connection Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sshConnections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => handleConnect(conn)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
                      e.dataTransfer.effectAllowed = 'copy';
                      const ghost = document.createElement('div');
                      ghost.style.cssText = `background:${conn.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;color:white;font-size:13px;font-weight:600;`;
                      ghost.textContent = `🐚 ${conn.name}`;
                      document.body.appendChild(ghost);
                      e.dataTransfer.setDragImage(ghost, 0, 0);
                      setTimeout(() => document.body.removeChild(ghost), 0);
                    }}
                    className="group relative p-4 rounded-xl border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = conn.color + '60'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  >
                    {/* Terminal prompt decoration */}
                    <div className="absolute top-3 right-3 font-mono text-[10px] text-[var(--text-muted)] opacity-40 group-hover:opacity-70 transition-opacity">ssh://</div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${conn.color}18`, border: `1px solid ${conn.color}30` }}>
                        <Server size={16} style={{ color: conn.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-[var(--text-primary)] truncate text-sm">{conn.name}</h3>
                        <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{conn.host}</p>
                      </div>
                      <div className={`w-2 h-2 rounded-full shrink-0 ${conn.status === 'online' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-500/60'}`} />
                    </div>
                    {/* Tags */}
                    {conn.tags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {conn.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-mono" style={{ background: `${conn.color}15`, color: conn.color }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                
                {sshConnections.length === 0 && (
                  <div className="col-span-full py-16 text-center rounded-2xl border border-dashed border-[var(--border-color)]">
                    <div className="font-mono text-[var(--text-muted)] text-sm mb-2">$ no ssh connections found</div>
                    <p className="text-xs text-[var(--text-muted)] opacity-60">{t('terminal.noConnections')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Terminals - Always mounted but hidden if selecting connection picker */}
        <div className={`h-full ${isSelecting ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {standaloneTerminals.map(term => (
            <div
              key={term.id}
              className="h-full"
              style={{ display: activeTab === term.id ? 'block' : 'none' }}
            >
              <TerminalView 
                connectionId={term.connectionId}
                connectionName={term.connectionName}
                host={term.host}
                color={term.color}
                connection={term.connection}
                onClose={() => handleCloseTab(term.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
