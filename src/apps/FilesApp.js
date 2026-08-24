import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { useTranslation } from 'react-i18next';
import { FolderClosed, HardDrive, Server } from 'lucide-react';
import FileLayout from '@/components/FileLayout';

export default function FilesApp({ onEditConnection, initialConnection, initialConnectionId, windowId, initialPath }) {
  const { state, dispatch } = useApp();
  const { connectionsReady } = useApp();
  const { t } = useTranslation();
  const { connections } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');

  // Helper: get persisted path for a given connectionId
  const getPersistedPath = useCallback((connectionId) => {
    if (!windowId || !connectionId) return '.';
    try {
      const saved = localStorage.getItem(`files-path-${windowId}-${connectionId}`);
      return saved || '.';
    } catch { return '.'; }
  }, [windowId]);

  // Helper: persist path for a given connectionId
  const persistPath = useCallback((connectionId, path) => {
    if (!windowId || !connectionId || !path) return;
    try {
      localStorage.setItem(`files-path-${windowId}-${connectionId}`, path);
    } catch {}
  }, [windowId]);

  // Initialize tabs with initialConnection if provided
  const [tabs, setTabs] = useState(() => {
    if (initialConnection && initialConnection.storage !== 'manual') {
      const connectionId = initialConnectionId || initialConnection._id;
      return [{
        id: `files-${connectionId}-${Date.now()}`,
        connectionId,
        connectionName: initialConnection.name,
        color: initialConnection.color,
        connection: initialConnection,
        initialPath: initialPath || '.'
      }];
    }
    return [];
  });

  const [isSelecting, setIsSelecting] = useState(() => {
    if (initialConnection && initialConnection.storage !== 'manual') return false;
    return !initialConnectionId;
  });

  const initialConnIdRef = useRef(initialConnectionId);

  // Load persisted tabs on mount
  useEffect(() => {
    if (tabs.length > 0 || initialConnectionId) return;
    if (!windowId || !connectionsReady || connections.length === 0) return;

    const savedTabs = localStorage.getItem(`files-tabs-${windowId}`);
    if (savedTabs) {
      try {
        const parsed = JSON.parse(savedTabs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Re-verify connections exist and restore last saved path
          const validTabs = parsed.map(tab => {
            let baseId = tab.connectionId;
            if (typeof baseId === 'string' && baseId.startsWith('docker-')) {
               baseId = baseId.split(':').pop();
            }
            const conn = connections.find(c => c._id === baseId);
            if (!conn) return null;
            // Restore the last-visited path from localStorage
            const savedPath = getPersistedPath(tab.connectionId);
            return {
              ...tab,
              connection: conn,
              initialPath: savedPath !== '.' ? savedPath : (tab.initialPath || '.'),
            };
          }).filter(Boolean);
          
          if (validTabs.length > 0) {
            setTabs(validTabs);
            setIsSelecting(false);
          }
        }
      } catch (e) {
        console.error('Failed to load files tabs:', e);
      }
    }
  }, [connectionsReady, connections, windowId, getPersistedPath]);

  // Save tabs on change
  useEffect(() => {
    if (windowId && tabs.length > 0) {
      localStorage.setItem(`files-tabs-${windowId}`, JSON.stringify(tabs.map(t => ({ ...t, connection: undefined })))); // don't save full connection object
    } else if (windowId && tabs.length === 0) {
      localStorage.removeItem(`files-tabs-${windowId}`);
    }
  }, [tabs, windowId]);


  function handleConnect(conn, overrideId = null) {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }

    const connectionId = overrideId || conn._id;
    const fileId = `files-${connectionId}-${Date.now()}`;
    // Restore last path for this connection if available
    const savedPath = getPersistedPath(connectionId);
    const newTab = {
      id: fileId,
      connectionId: connectionId,
      connectionName: conn.name,
      color: conn.color,
      connection: conn,
      initialPath: savedPath,
    };

    setTabs(prev => [...prev, newTab]);
    setIsSelecting(false);
  }

  // Restore mode: auto-connect from persisted initialConnectionId
  useEffect(() => {
    if (tabs.length > 0) return;
    const targetId = initialConnIdRef.current;
    if (!targetId) return;
    if (!connectionsReady || connections.length === 0) return;

    let baseConnId = targetId;
    if (typeof targetId === 'string' && targetId.startsWith('docker-')) {
       // Format: docker-containerId:baseConnId
       baseConnId = targetId.split(':').pop();
    }

    const conn = connections.find((c) => c._id === baseConnId);
    if (!conn) return;

    initialConnIdRef.current = null;
    handleConnect(conn, targetId);
  }, [connectionsReady, connections, tabs.length]);

  const handleCloseFileManager = (id) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) setIsSelecting(true);
      return next;
    });
  };

  const handleSplitFileManager = (fmData) => {
    setTabs(prev => [...prev, fmData]);
  };

  // Called by FileLayout → LayoutRenderer → FileManager whenever user navigates to a new folder
  const handlePathChange = useCallback((connectionId, path) => {
    persistPath(connectionId, path);
  }, [persistPath]);

  return (
    <div className="@container flex flex-col h-full bg-transparent text-[var(--text-primary)] overflow-hidden">
      <div className="flex-1 min-h-0 relative">
        {isSelecting ? (
          <div className="absolute inset-0 bg-[var(--bg-primary)]/40 overflow-y-auto z-10">
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

              <div className="grid grid-cols-1 @3xl:grid-cols-2 @4xl:grid-cols-3 gap-4">
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
              onPathChange={handlePathChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
