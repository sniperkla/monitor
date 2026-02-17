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
  const [activeTab, setActiveTab] = useState(null);
  const [isSelecting, setIsSelecting] = useState(standaloneTerminals.length === 0 && !initialConnection);
  const initialConnRef = useRef(initialConnection);
  const standaloneTermIdRef = useRef(null);
  const isStandalone = !!initialConnection;

  // Auto-connect if initialConnection is provided
  useEffect(() => {
    if (initialConnRef.current) {
      const conn = initialConnRef.current;
      initialConnRef.current = null; // Only once
      const termId = `term-${conn._id}-${Date.now()}`;
      standaloneTermIdRef.current = termId;
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
  }, [dispatch]);

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

  // In standalone mode, render just the single terminal without tabs
  if (isStandalone) {
    const term = standaloneTerminals.find(t => t.id === standaloneTermIdRef.current);
    if (!term) {
      return <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden" />;
    }
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
        <TerminalView 
          connectionId={term.connectionId}
          connectionName={term.connectionName}
          host={term.host}
          color={term.color}
          connection={term.connection}
          onClose={() => handleCloseTab(term.id)}
          isStandalone
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
                  ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
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
          <div className="absolute inset-0 bg-[var(--bg-primary)] p-8 overflow-y-auto z-20">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
                  <TermIcon size={24} className="text-indigo-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('terminal.newSession')}</h1>
                  <p className="text-[var(--text-secondary)] text-sm">{t('terminal.selectConnection')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {connections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => handleConnect(conn)}
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
                    className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-indigo-500/50 hover:bg-[var(--bg-card-hover)] transition-all cursor-grab active:cursor-grabbing group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${conn.color}20` }}>
                        <Server size={16} style={{ color: conn.color }} />
                      </div>
                      <Zap size={14} className={conn.status === 'online' ? 'text-emerald-400 animate-pulse' : 'text-[var(--text-muted)]'} />
                    </div>
                    <h3 className="font-semibold text-[var(--text-primary)] mb-1 group-hover:text-indigo-400 transition-colors">{conn.name}</h3>
                    <p className="text-xs text-[var(--text-muted)] font-mono text-center truncate uppercase tracking-widest">{conn.host}</p>
                  </div>
                ))}
                
                {connections.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white/5 rounded-2xl border border-dashed border-white/10">
                    <p className="text-gray-500 text-sm mb-4">{t('terminal.noConnections')}</p>
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
