'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { 
  Columns, Rows, Maximize2, Minimize2, X, 
  ExternalLink, Server, Grid, List as ListIcon, 
  Monitor, Database, Search, ChevronRight, Upload 
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';

const ConnectionPicker = ({ onSelect, search, setSearch, connections, t }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const filteredConnections = useMemo(() => {
    return connections.filter(conn => 
      conn.name.toLowerCase().includes(search.toLowerCase()) ||
      conn.host.toLowerCase().includes(search.toLowerCase())
    );
  }, [connections, search]);

  const handlePickerDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('application/ssh-connection')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handlePickerDragLeave = useCallback((e) => {
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handlePickerDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);

    const data = e.dataTransfer.getData('application/ssh-connection');
    if (!data) return;

    try {
      const conn = JSON.parse(data);
      if (conn.type === 'database') return;
      onSelect(conn);
    } catch (err) {
      console.error('Drop parse error:', err);
    }
  }, [onSelect]);

  return (
    <div 
      className="h-full bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden relative"
      onDragOver={handlePickerDragOver}
      onDragLeave={handlePickerDragLeave}
      onDrop={handlePickerDrop}
    >
      {/* Drop highlight overlay */}
      {isDragOver && (
        <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-indigo-500 bg-indigo-500/10 flex items-center justify-center z-10 pointer-events-none transition-all animate-pulse">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
              <Upload size={24} className="text-indigo-400" />
            </div>
            <span className="text-sm font-semibold text-indigo-400">
              {t('files.dropToOpen') || 'Drop to open file manager'}
            </span>
          </div>
        </div>
      )}
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="min-h-full flex items-center justify-center p-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-lg flex flex-col items-center gap-6"
          >
          <div className="w-20 h-20 rounded-[2rem] bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-xl shadow-indigo-500/5 ring-1 ring-white/5">
            <Server className="w-10 h-10 text-indigo-400" />
          </div>

          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              {t('files.layout.selectServer')}
            </h2>
            <p className="text-[var(--text-muted)] text-sm max-w-[280px] leading-relaxed mx-auto">
              {t('files.layout.dropServer')}
            </p>
          </div>

          <div className="w-full relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-[var(--accent-indigo)] transition-colors" />
            <input 
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('files.layout.searchServer')}
              className="w-full h-12 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl pl-12 pr-4 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-indigo)]/50 focus:ring-4 focus:ring-[var(--accent-indigo)]/10 transition-all placeholder:text-[var(--text-muted)] backdrop-blur-sm shadow-sm"
            />
          </div>

          <div className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2 space-y-1 backdrop-blur-sm shadow-xl">
            {filteredConnections.length > 0 ? (
              filteredConnections.map((conn) => (
                <button
                  key={conn.id || conn._id}
                  onClick={() => onSelect(conn)}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-[var(--bg-card-hover)] transition-all group text-left border border-transparent hover:border-[var(--border-hover)] active:scale-[0.98]"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shrink-0`} 
                     style={{ backgroundColor: conn.color || '#6366f1', background: `linear-gradient(135deg, ${conn.color || '#6366f1'}, ${conn.color || '#6366f1'}cc)` }}>
                    {conn.type === 'ssh' ? <Monitor size={18} /> : <Database size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate transition-colors">
                      {conn.name}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate font-mono">
                      {conn.host}
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                    <ChevronRight size={16} className="text-[var(--accent-indigo)]" />
                  </div>
                </button>
              ))
            ) : (
              <div className="p-10 text-center opacity-40">
                <Database className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-xs font-medium uppercase tracking-[0.2em]">{t('files.layout.noServers')}</p>
              </div>
            )}
          </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

// ─── Constants & Utils ──────────────────────────────────────────────────────

const INITIAL_RATIO = 0.5;

function createPane(fmData = null) {
  return {
    id: `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'pane',
    fmData, // { id, connectionId, connectionName, color, connection }
  };
}

function splitPane(layout, targetId, direction, newFmData = null) {
  if (layout.id === targetId && layout.type === 'pane') {
    return {
      id: `split-${Date.now()}`,
      type: 'split',
      direction, // 'horizontal' or 'vertical'
      ratio: INITIAL_RATIO,
      children: [
        { ...layout },
        createPane(newFmData)
      ],
    };
  }

  if (layout.type === 'split') {
    return {
      ...layout,
      children: layout.children.map(child => splitPane(child, targetId, direction, newFmData)),
    };
  }

  return layout;
}

function removePane(layout, targetId) {
  if (layout.type === 'split') {
    const [c1, c2] = layout.children;
    
    if (c1.id === targetId) return c2;
    if (c2.id === targetId) return c1;

    return {
      ...layout,
      children: layout.children.map(child => removePane(child, targetId)),
    };
  }
  return layout;
}

function getPaneById(layout, id) {
  if (layout.id === id) return layout;
  if (layout.type === 'split') {
    for (const child of layout.children) {
      const found = getPaneById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function getAllPaneIds(layout) {
  if (layout.type === 'pane') return [layout.id];
  return [...getAllPaneIds(layout.children[0]), ...getAllPaneIds(layout.children[1])];
}

function updatePaneData(layout, targetId, newData) {
  if (layout.id === targetId && layout.type === 'pane') {
    return { ...layout, fmData: newData };
  }
  if (layout.type === 'split') {
    return {
      ...layout,
      children: layout.children.map(child => updatePaneData(child, targetId, newData)),
    };
  }
  return layout;
}

function updateRatio(layout, splitId, ratio) {
  if (layout.id === splitId && layout.type === 'split') {
    return { ...layout, ratio };
  }
  if (layout.type === 'split') {
    return {
      ...layout,
      children: layout.children.map(child => updateRatio(child, splitId, ratio)),
    };
  }
  return layout;
}

// ─── Divider Component ──────────────────────────────────────────────────────

function Divider({ direction, onDrag, isActive }) {
  const isHoriz = direction === 'horizontal';
  
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const cur = isHoriz ? 'col-resize' : 'row-resize';
    document.body.style.cursor = cur;
    document.body.style.userSelect = 'none';

    // Overlay blocks child panes from stealing pointer events during drag
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:99999;cursor:${cur};`;
    document.body.appendChild(overlay);

    const handleMouseMove = (mm) => onDrag(mm);
    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [onDrag, isHoriz]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        zIndex: 10,
        ...(isHoriz 
          ? { width: '4px', minWidth: '4px', cursor: 'col-resize' }
          : { height: '4px', minHeight: '4px', cursor: 'row-resize' }),
        background: isActive ? 'var(--accent-indigo)' : 'var(--border-color)',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
      className="hover:bg-[var(--accent-indigo)]/50"
    />
  );
}

// ─── Recursive Layout Renderer ──────────────────────────────────────────────

function LayoutRenderer({ 
  layout, 
  activePaneId, 
  onFocusPane, 
  onClosePane, 
  onSplitPane, 
  onAssignConnection, 
  onRatioChange,
  connections, 
  zoomedPaneId,
  onPathChange
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const [search, setSearch] = useState('');
  const isHoriz = layout.type === 'split' ? layout.direction === 'horizontal' : false;
  const ratio = layout.type === 'split' ? (layout.ratio || 0.5) : 0.5;

  const handleDrag = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let newRatio;
    if (isHoriz) {
      newRatio = (e.clientX - rect.left) / rect.width;
    } else {
      newRatio = (e.clientY - rect.top) / rect.height;
    }
    newRatio = Math.max(0.1, Math.min(0.9, newRatio));
    onRatioChange(layout.id, newRatio);
  }, [isHoriz, layout.id, onRatioChange]);

  if (layout.type === 'pane') {
    const isActive = activePaneId === layout.id;

    return (
      <div
        onClick={() => onFocusPane(layout.id)}
        className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative transition-all ${
          isActive ? 'ring-1 ring-[var(--accent-indigo)]/40 z-10 shadow-lg' : 'ring-1 ring-white/5'
        }`}
        style={{ background: 'var(--bg-primary)' }}
      >
        {/* Pane Header (Optional but helpful for cross-drag) */}
        {!isActive && layout.fmData && (
           <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--accent-indigo)]/20 z-20 pointer-events-none" />
        )}

        <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
          {layout.fmData ? (
            <FileManager 
              connectionId={layout.fmData.connectionId}
              connectionName={layout.fmData.connectionName}
              connection={layout.fmData.connection}
              isSplit={true}
              isActivePane={isActive}
              initialPath={layout.fmData.initialPath}
              onClosePane={() => onClosePane(layout.id)}
              onSplit={(dir) => onSplitPane(layout.id, dir)}
              onPathChange={onPathChange ? (p) => onPathChange(layout.fmData.connectionId, p) : undefined}
            />
          ) : (
            <ConnectionPicker 
              onSelect={(conn) => onAssignConnection(layout.id, conn)}
              search={search}
              setSearch={setSearch}
              connections={connections}
              t={t}
            />
          )}
        </div>
      </div>
    );
  }

  // Split node
  return (
    <div
      ref={containerRef}
      className="flex-1 flex overflow-hidden min-w-0 min-h-0"
      style={{ flexDirection: isHoriz ? 'row' : 'column' }}
    >
      <div style={{ flex: `${ratio} 1 0`, display: 'flex', overflow: 'hidden' }}>
        <LayoutRenderer
          layout={layout.children[0]}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
          onAssignConnection={onAssignConnection}
          onRatioChange={onRatioChange}
          connections={connections}
          zoomedPaneId={zoomedPaneId}
          onPathChange={onPathChange}
        />
      </div>

      <Divider
        direction={isHoriz ? 'horizontal' : 'vertical'}
        onDrag={handleDrag}
        isActive={false}
      />

      <div style={{ flex: `${1 - ratio} 1 0`, display: 'flex', overflow: 'hidden' }}>
        <LayoutRenderer
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
          onAssignConnection={onAssignConnection}
          onRatioChange={onRatioChange}
          connections={connections}
          zoomedPaneId={zoomedPaneId}
          onPathChange={onPathChange}
        />
      </div>
    </div>
  );
}

// ─── Main FileLayout Component ──────────────────────────────────────────────

export default function FileLayout({ managers: propManagers, onCloseFileManager, onSplitFileManager, onPathChange }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections: allConnections, activeFileManagers: globalManagers } = state;
  const connections = allConnections.filter(c => c.type !== 'database');
  const managers = propManagers || globalManagers;

  const handledFmIdsRef = useRef(new Set());

  const [layout, setLayout] = useState(() => {
    if (!managers || managers.length === 0) {
      return createPane(null);
    }

    let currentLayout = null;
    managers.forEach((m, idx) => {
      handledFmIdsRef.current.add(m.id);
      const fmData = {
        id: m.id,
        connectionId: m.connectionId,
        connectionName: m.connectionName,
        color: m.color,
        connection: m.connection,
        initialPath: m.initialPath || '.'
      };

      if (!currentLayout) {
        currentLayout = createPane(fmData);
      } else {
        // Simple initial layout: stack them horizontally
        currentLayout = splitPane(currentLayout, currentLayout.id, 'horizontal', fmData);
      }
    });

    return currentLayout;
  });

  const [activePaneId, setActivePaneId] = useState(() => {
    if (layout) {
      const ids = getAllPaneIds(layout);
      return ids[ids.length - 1];
    }
    return null;
  });

  const [search, setSearch] = useState('');

  // ── Sync with Managers (Sync state during render for immediate updates) ──
  const [prevManagers, setPrevManagers] = useState(managers);

  if (managers !== prevManagers) {
    setPrevManagers(managers);
    
    const newManagers = managers.filter(f => !handledFmIdsRef.current.has(f.id));
    if (newManagers.length > 0) {
      let currentLayout = layout;
      newManagers.forEach(newFm => {
        handledFmIdsRef.current.add(newFm.id);
        const fmData = {
          id: newFm.id,
          connectionId: newFm.connectionId,
          connectionName: newFm.connectionName,
          color: newFm.color,
          connection: newFm.connection,
          initialPath: newFm.initialPath || '.'
        };

        if (!currentLayout || (currentLayout.type === 'pane' && !currentLayout.fmData)) {
          // If we have an empty picker pane, replace it or use it
          if (currentLayout?.id === activePaneId) {
            currentLayout = updatePaneData(currentLayout, activePaneId, fmData);
          } else {
            const firstPane = createPane(fmData);
            currentLayout = firstPane;
            setActivePaneId(firstPane.id);
          }
        } else {
          currentLayout = splitPane(currentLayout, activePaneId, 'horizontal', fmData);
          // Auto-focus the newly created pane
          const ids = getAllPaneIds(currentLayout);
          setActivePaneId(ids[ids.length - 1]);
        }
      });
      setLayout(currentLayout);
    }
  }

  // ── Sync with Managers (for cleanup) ──
  useEffect(() => {
    if (!managers || !layout) return;
    const managerIds = new Set(managers.map(m => m.id));
    
    // Recursive check for panes whose manager was moved out or closed
    const validateLayout = (node) => {
      if (node.type === 'pane') {
        if (node.fmData && !managerIds.has(node.fmData.id)) {
          return { clear: true, id: node.id };
        }
        return { clear: false };
      }
      const c1 = validateLayout(node.children[0]);
      const c2 = validateLayout(node.children[1]);
      if (c1.clear) return { clear: true, id: c1.id };
      if (c2.clear) return { clear: true, id: c2.id };
      return { clear: false };
    };

    const result = validateLayout(layout);
    if (result.clear) {
      // Instead of destroying the pane, reset fmData to null so ConnectionPicker
      // (server selection screen) is displayed, allowing the user to select another connection.
      setLayout(prev => updatePaneData(prev, result.id, null));
    }
  }, [managers, layout]);

  useEffect(() => {
    if (!layout) {
      setActivePaneId(null);
      return;
    }
    const ids = getAllPaneIds(layout);
    if (activePaneId && !ids.includes(activePaneId)) {
      setActivePaneId(ids[0]);
    } else if (!activePaneId) {
      setActivePaneId(ids[0]);
    }
  }, [layout, activePaneId]);

  const handleFocusPane = useCallback((id) => {
    setActivePaneId(id);
  }, []);

  const handleSplitPane = useCallback((targetId, direction) => {
    setLayout(prev => splitPane(prev, targetId, direction));
  }, []);

  const handleClosePane = useCallback((targetId) => {
    const pane = getPaneById(layout, targetId);
    if (pane?.fmData?.id) {
      if (onCloseFileManager) {
        onCloseFileManager(pane.fmData.id);
      } else {
        dispatch({ type: 'CLOSE_FILE_MANAGER', payload: pane.fmData.id });
      }
      handledFmIdsRef.current.delete(pane.fmData.id);
    }

    setLayout(prev => {
      if (!prev) return createPane(null);
      const remains = removePane(prev, targetId);
      // Last pane removed — show empty connection picker instead of crashing
      if (remains && remains.id === targetId) return createPane(null);
      return remains;
    });
  }, [layout, dispatch, onCloseFileManager]);

  const handleAssignConnection = useCallback((paneId, conn) => {
    const fmId = `files-${conn._id}-${Date.now()}`;
    const fmData = {
      id: fmId,
      connectionId: conn._id,
      connectionName: conn.name,
      color: conn.color,
      connection: conn,
    };

    if (onSplitFileManager) {
      onSplitFileManager(fmData);
    } else {
      dispatch({ type: 'OPEN_FILE_MANAGER', payload: fmData });
    }
    
    setLayout(prev => updatePaneData(prev, paneId, fmData));
    handledFmIdsRef.current.add(fmId);
  }, [dispatch, onSplitFileManager]);

  const handleRatioChange = useCallback((splitId, newRatio) => {
    setLayout(prev => updateRatio(prev, splitId, newRatio));
  }, []);

  // No need for separate null check if we initialize layout

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      <LayoutRenderer
        layout={layout || createPane(null)}
        activePaneId={activePaneId}
        onFocusPane={handleFocusPane}
        onClosePane={handleClosePane}
        onSplitPane={handleSplitPane}
        onAssignConnection={handleAssignConnection}
        onRatioChange={handleRatioChange}
        connections={connections}
        zoomedPaneId={null}
        onPathChange={onPathChange}
      />
    </div>
  );
}

