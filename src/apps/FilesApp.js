'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { Server, FolderClosed, Zap, X, Plus, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function FilesApp({ onEditConnection, initialConnection, initialConnectionId }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [isSelecting, setIsSelecting] = useState(!initialConnection);
  const initialConnRef = useRef(initialConnection);
  const initialConnIdRef = useRef(initialConnectionId);

  // Auto-connect if initialConnection is provided
  useEffect(() => {
    if (initialConnRef.current) {
      const conn = initialConnRef.current;
      initialConnRef.current = null;
      const fileId = `files-${conn._id}-${Date.now()}`;
      const newTab = {
        id: fileId,
        connectionId: conn._id,
        connectionName: conn.name,
        color: conn.color,
        connection: conn,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTab(fileId);
      setIsSelecting(false);
    }
  }, []);

  // Restore mode: auto-connect from persisted initialConnectionId
  useEffect(() => {
    if (initialConnRef.current) return;
    if (!initialConnIdRef.current) return;
    if (!connections || connections.length === 0) return;

    const conn = connections.find((c) => c._id === initialConnIdRef.current);
    if (!conn) return;

    initialConnIdRef.current = null;
    const fileId = `files-${conn._id}-${Date.now()}`;
    const newTab = {
      id: fileId,
      connectionId: conn._id,
      connectionName: conn.name,
      color: conn.color,
      connection: conn,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTab(fileId);
    setIsSelecting(false);
  }, [connections]);

  // Auto-select latest file manager if a new one is added
  useEffect(() => {
    if (tabs.length > 0 && !isSelecting) {
      if (!activeTab || !tabs.find(t => t.id === activeTab)) {
        setActiveTab(tabs[tabs.length - 1].id);
      }
    }
  }, [tabs, activeTab, isSelecting]);

  const handleConnect = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }

    // Terminate existing session in the manager
    const existing = state.activeFileManagers.find(f => f.connectionId === conn._id);
    if (existing) {
      dispatch({ type: 'CLOSE_FILE_MANAGER', payload: existing.id });
    }

    const fileId = `files-${conn._id}-${Date.now()}`;
    const newTab = {
      id: fileId,
      connectionId: conn._id,
      connectionName: conn.name,
      color: conn.color,
      connection: conn,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTab(fileId);
    setIsSelecting(false);
  };

  const handleCloseTab = (fileId) => {
    const newTabs = tabs.filter(t => t.id !== fileId);
    setTabs(newTabs);
    
    if (activeTab === fileId) {
      if (newTabs.length > 0) {
        setActiveTab(newTabs[newTabs.length - 1].id);
      } else {
        setIsSelecting(true);
        setActiveTab(null);
      }
    }
  };

  // Listen for external close requests (e.g. when a tab is dragged to the desktop)
  useEffect(() => {
    const handleExternalClose = (e) => {
      handleCloseTab(e.detail.tabId);
    };
    window.addEventListener('close-files-tab', handleExternalClose);
    return () => window.removeEventListener('close-files-tab', handleExternalClose);
  }, [tabs, activeTab]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      {/* App Tab Bar */}
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-2 h-10 shrink-0">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar h-full">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setIsSelecting(false); }}
              draggable
              onDragStart={(e) => {
                if (tab.connection) {
                  e.dataTransfer.setData('application/ssh-connection', JSON.stringify(tab.connection));
                  // Tell desktop this came from FilesApp → open as file manager directly
                  e.dataTransfer.setData('application/source-app-type', 'files');
                  // Pass the tab ID so desktop can close it on drop
                  e.dataTransfer.setData('application/standalone-files-id', tab.id);
                  e.dataTransfer.effectAllowed = 'copy';
                  // Create a drag image
                  const ghost = document.createElement('div');
                  ghost.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white';
                  ghost.style.cssText = `background:[var(--accent-indigo)];position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;`;
                  ghost.textContent = `📁 ${tab.connectionName}`;
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }
              }}
              className={`flex items-center gap-2 px-3 h-8 mt-2 rounded-t-lg transition-all text-xs border-x border-t cursor-grab active:cursor-grabbing ${
                activeTab === tab.id && !isSelecting
                  ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
                  : 'bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              style={{ minWidth: '140px', maxWidth: '200px' }}
            >
              <FolderClosed size={14} style={{ color: tab.color }} className="shrink-0" />
              <span className="truncate flex-1 text-left">{tab.connectionName}</span>
              <X 
                size={12} 
                className="hover:text-red-400 shrink-0" 
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
              />
            </button>
          ))}
          
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
        {isSelecting ? (
          <div className="absolute inset-0 bg-[var(--bg-primary)] overflow-y-auto z-10">
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'var(--glow-indigo)', border: '1px solid var(--accent-indigo)' }}>
                  <FolderClosed size={22} className="text-[var(--accent-indigo)]" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{t('files.title')}</h1>
                  <p className="text-[var(--text-secondary)] text-sm">{t('files.selectConnection')}</p>
                </div>
                <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--glow-indigo)] border border-[var(--accent-indigo)]/20">
                  <HardDrive size={12} className="text-[var(--accent-indigo)]" />
                  <span className="text-xs font-mono text-[var(--accent-indigo)]">{sshConnections.length} {t('common.servers') || 'servers'}</span>
                </div>
              </div>

              {/* Connection Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sshConnections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => handleConnect(conn)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
                      e.dataTransfer.effectAllowed = 'copy';
                      const ghost = document.createElement('div');
                      ghost.style.cssText = `background:${conn.color || '#3b82f6'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;color:white;font-size:13px;font-weight:600;`;
                      ghost.textContent = `📁 ${conn.name}`;
                      document.body.appendChild(ghost);
                      e.dataTransfer.setDragImage(ghost, 0, 0);
                      setTimeout(() => document.body.removeChild(ghost), 0);
                    }}
                    className="group relative p-5 rounded-2xl border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] active:scale-[0.98] overflow-hidden"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = conn.color + '50'; e.currentTarget.style.boxShadow = `0 4px 20px ${conn.color}15`; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    {/* Background decoration */}
                    <div className="absolute top-0 right-0 w-20 h-20 opacity-5 group-hover:opacity-10 transition-opacity" style={{ background: `radial-gradient(circle, ${conn.color}, transparent)` }} />
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-md" style={{ background: `${conn.color}20`, border: `1px solid ${conn.color}30` }}>
                        <FolderClosed size={20} style={{ color: conn.color }} />
                      </div>
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold ${
                        conn.status === 'online' 
                          ? 'bg-[var(--glow-emerald)] text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/20' 
                          : 'bg-[var(--glow-rose)] text-[var(--accent-rose)] border border-[var(--accent-rose)]/20'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${conn.status === 'online' ? 'bg-[var(--accent-emerald)] animate-pulse' : 'bg-[var(--accent-rose)]'}`} />
                        {conn.status === 'online' ? t('common.online') : t('common.offline')}
                      </div>
                    </div>
                    <h3 className="font-bold text-[var(--text-primary)] mb-1 truncate">{conn.name}</h3>
                    <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{conn.host}</p>
                    {conn.username && <p className="text-[10px] text-[var(--text-muted)] opacity-60 mt-1 font-mono">{t('common.user') || 'user'}: {conn.username}</p>}
                  </div>
                ))}
                
                {sshConnections.length === 0 && (
                  <div className="col-span-full py-16 text-center rounded-3xl border border-dashed border-[var(--border-color)]">
                    <FolderClosed size={40} className="mx-auto mb-4 text-[var(--text-muted)] opacity-40" />
                    <p className="text-[var(--text-secondary)] text-sm">{t('files.noConnections')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className="h-full"
                style={{ display: activeTab === tab.id ? 'block' : 'none' }}
              >
                <FileManager 
                  connectionId={tab.connectionId}
                  connectionName={tab.connectionName}
                  connection={tab.connection}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
