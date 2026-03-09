'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { 
  Columns, Rows, Maximize2, Minimize2, X, 
  ExternalLink, Server, Grid, List as ListIcon 
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
    const handleMouseMove = (mm) => onDrag(mm);
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [onDrag]);

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
  zoomedPaneId
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
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
              onClosePane={() => onClosePane(layout.id)}
              onSplit={(dir) => onSplitPane(layout.id, dir)}
            />
          ) : (
            <div 
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/ssh-connection')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }
              }}
              onDrop={(e) => {
                const connData = e.dataTransfer.getData('application/ssh-connection');
                if (connData) {
                  try {
                    const conn = JSON.parse(connData);
                    onAssignConnection(layout.id, conn);
                  } catch (err) {
                    console.error('Failed to parse connection data:', err);
                  }
                }
              }}
              className="h-full flex flex-col items-center justify-center p-6 bg-[var(--bg-tertiary)]/30 italic text-[var(--text-muted)] text-xs border-2 border-dashed border-[var(--border-color)] m-4 rounded-2xl hover:bg-[var(--bg-tertiary)]/50 hover:border-[var(--accent-indigo)]/30 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-[var(--bg-primary)]/50 flex items-center justify-center mb-3 shadow-inner">
                <Server size={20} className="text-[var(--text-muted)] opacity-50" />
              </div>
              {t('files.layout.dropServer')}
            </div>
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
        />
      </div>
    </div>
  );
}

// ─── Main FileLayout Component ──────────────────────────────────────────────

export default function FileLayout({ managers: propManagers, onCloseFileManager, onSplitFileManager }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections, activeFileManagers: globalManagers } = state;
  const managers = propManagers || globalManagers;

  const [layout, setLayout] = useState(null);
  const [activePaneId, setActivePaneId] = useState(null);
  const handledFmIdsRef = useRef(new Set());

  // ── Sync with Managers ──
  useEffect(() => {
    if (!managers || managers.length === 0) {
      if (layout) setLayout(null);
      handledFmIdsRef.current.clear();
      return;
    }

    setLayout(prev => {
      let currentLayout = prev;
      const newManagers = managers.filter(f => !handledFmIdsRef.current.has(f.id));
      
      if (newManagers.length === 0) {
        // Check for closed managers
        const currentIds = new Set(managers.map(f => f.id));
        // This is tricky: we'd need to remove panes from layout if their FM id disappeared
        // But for now let's focus on adding.
        return currentLayout;
      }

      newManagers.forEach(newFm => {
        handledFmIdsRef.current.add(newFm.id);
        const fmData = {
          id: newFm.id,
          connectionId: newFm.connectionId,
          connectionName: newFm.connectionName,
          color: newFm.color,
          connection: newFm.connection,
        };

        if (!currentLayout) {
          const firstPane = createPane(fmData);
          currentLayout = firstPane;
          setActivePaneId(firstPane.id);
        } else {
          currentLayout = splitPane(currentLayout, activePaneId, 'horizontal', fmData);
          // Auto-focus the newly created pane
          const ids = getAllPaneIds(currentLayout);
          setActivePaneId(ids[ids.length - 1]);
        }
      });
      return currentLayout;
    });
  }, [managers, activePaneId]);

  // Handle pane removal when manager list shrinks
  useEffect(() => {
    if (!managers || !layout) return;
    const managerIds = new Set(managers.map(m => m.id));
    
    // Recursive check for panes that no longer have a manager
    const validateLayout = (node) => {
      if (node.type === 'pane') {
        if (node.fmData && !managerIds.has(node.fmData.id)) {
          return { remove: true, id: node.id };
        }
        return { remove: false };
      }
      const c1 = validateLayout(node.children[0]);
      const c2 = validateLayout(node.children[1]);
      if (c1.remove) return { remove: true, id: c1.id };
      if (c2.remove) return { remove: true, id: c2.id };
      return { remove: false };
    };

    const result = validateLayout(layout);
    if (result.remove) {
      setLayout(prev => removePane(prev, result.id));
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
      if (!prev) return null;
      const remains = removePane(prev, targetId);
      return (remains && remains.id === targetId) ? null : remains;
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

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center italic text-[var(--text-muted)]">
        {t('files.noConnections')}
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      <LayoutRenderer
        layout={layout}
        activePaneId={activePaneId}
        onFocusPane={handleFocusPane}
        onClosePane={handleClosePane}
        onSplitPane={handleSplitPane}
        onAssignConnection={handleAssignConnection}
        onRatioChange={handleRatioChange}
        connections={connections}
        zoomedPaneId={null}
      />
    </div>
  );
}

