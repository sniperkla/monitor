'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { Server, FolderClosed, Zap, X, Plus, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function FilesApp({ onEditConnection, initialConnection }) {
  const { state } = useApp();
  const { t } = useTranslation();
  const { connections } = state;
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [isSelecting, setIsSelecting] = useState(!initialConnection);
  const initialConnRef = useRef(initialConnection);

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

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      {/* App Tab Bar */}
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-2 h-10 shrink-0">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar h-full">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setIsSelecting(false); }}
              className={`flex items-center gap-2 px-3 h-8 mt-2 rounded-t-lg transition-all text-xs border-x border-t ${
                activeTab === tab.id && !isSelecting
                  ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
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
          
          <button
            onClick={() => setIsSelecting(true)}
            className={`flex items-center justify-center w-8 h-8 mt-2 rounded-t-lg transition-all border-x border-t ${
              isSelecting
                ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-blue-400'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 border-transparent'
            }`}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
        {isSelecting ? (
          <div className="absolute inset-0 bg-[var(--bg-primary)] p-8 overflow-y-auto z-10">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                  <FolderClosed size={24} className="text-blue-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">{t('files.title')}</h1>
                  <p className="text-[var(--text-secondary)] text-sm">{t('files.selectConnection')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {connections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => handleConnect(conn)}
                    className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-blue-500/50 hover:bg-[var(--bg-card-hover)] transition-all cursor-pointer group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-100 transition-opacity">
                       <HardDrive size={32} className="text-blue-500/20" />
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: `${conn.color}20` }}>
                        <Server size={20} style={{ color: conn.color }} />
                      </div>
                      <div className={`w-2 h-2 rounded-full ${conn.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    </div>
                    <h3 className="font-bold text-[var(--text-primary)] mb-1 group-hover:text-blue-400 transition-colors">{conn.name}</h3>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono truncate uppercase tracking-widest">{conn.host}</p>
                  </div>
                ))}
                
                {connections.length === 0 && (
                  <div className="col-span-full py-16 text-center bg-[var(--bg-tertiary)]/20 rounded-3xl border border-dashed border-[var(--border-color)]">
                    <FolderClosed size={40} className="mx-auto mb-4 text-[var(--text-muted)]" />
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
