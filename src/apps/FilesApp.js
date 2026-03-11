import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useTranslation } from 'react-i18next';
import { FolderClosed, HardDrive, Server } from 'lucide-react';
import FileLayout from '@/components/FileLayout';

export default function FilesApp({ onEditConnection, initialConnection, initialConnectionId }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');

  // Initialize tabs with initialConnection if provided
  const [tabs, setTabs] = useState(() => {
    if (initialConnection && initialConnection.storage !== 'manual') {
      return [{
        id: `files-${initialConnection._id}-${Date.now()}`,
        connectionId: initialConnection._id,
        connectionName: initialConnection.name,
        color: initialConnection.color,
        connection: initialConnection,
      }];
    }
    return [];
  });

  const [isSelecting, setIsSelecting] = useState(() => {
    if (initialConnection && initialConnection.storage !== 'manual') return false;
    return !initialConnectionId;
  });

  const initialConnIdRef = useRef(initialConnectionId);

  // Restore mode: auto-connect from persisted initialConnectionId
  useEffect(() => {
    if (tabs.length > 0) return;
    if (!initialConnIdRef.current) return;
    if (!connections || connections.length === 0) return;

    const conn = connections.find((c) => c._id === initialConnIdRef.current);
    if (!conn) return;

    initialConnIdRef.current = null;
    handleConnect(conn);
  }, [connections, tabs.length]);

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
    setIsSelecting(false);
  };

  const handleCloseFileManager = (id) => {
    setTabs(prev => prev.filter(t => t.id !== id));
  };

  const handleSplitFileManager = (fmData) => {
    setTabs(prev => [...prev, fmData]);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <div className="flex-1 min-h-0 relative">
        {isSelecting ? (
          <div className="absolute inset-0 bg-[var(--bg-primary)] overflow-y-auto z-10">
            <div className="p-8 max-w-3xl mx-auto">
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
                  <span className="text-xs font-mono text-[var(--accent-indigo)]">{sshConnections.length} {t('common.servers')}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sshConnections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => handleConnect(conn)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className="group relative p-5 rounded-2xl border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] active:scale-[0.98] overflow-hidden"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-md" style={{ background: `${conn.color}20`, border: `1px solid ${conn.color}30` }}>
                        <FolderClosed size={20} style={{ color: conn.color }} />
                      </div>
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold ${
                        conn.status === 'online' ? 'bg-[var(--glow-emerald)] text-[var(--accent-emerald)]' : 'bg-[var(--glow-rose)] text-[var(--accent-rose)]'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${conn.status === 'online' ? 'bg-[var(--accent-emerald)] animate-pulse' : 'bg-[var(--accent-rose)]'}`} />
                        {conn.status === 'online' ? t('common.online') : t('common.offline')}
                      </div>
                    </div>
                    <h3 className="font-bold text-[var(--text-primary)] mb-1 truncate">{conn.name}</h3>
                    <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{conn.host}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full">
            <FileLayout 
              managers={tabs} 
              onCloseFileManager={handleCloseFileManager}
              onSplitFileManager={handleSplitFileManager}
            />
          </div>
        )}
      </div>
    </div>
  );
}
