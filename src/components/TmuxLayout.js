'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import TerminalView from '@/components/TerminalView';
import RelayTerminalView from '@/components/RelayTerminalView';
import { Terminal, Plus, X, Columns, Rows, Maximize2, Minimize2, Server, Monitor, ExternalLink, RefreshCw, Search, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ─── Layout Tree Helpers ─────────────────────────────────────────────────────

let paneCounter = 0;
const genPaneId = () => `pane-${Date.now()}-${++paneCounter}`;

/**
 * Layout node is either:
 * { type: 'pane',  id: string, termData: { connectionId, connectionName, host, color, connection } | null }
 * { type: 'split', direction: 'horizontal' | 'vertical', children: [node, node], ratio: 0.5 }
 */

const createPane = (termData = null) => ({
  type: 'pane',
  id: genPaneId(),
  termData,
});

const splitPane = (layout, targetId, direction, newTermData = null) => {
  if (layout.type === 'pane') {
    if (layout.id === targetId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { ...layout },
          createPane(newTermData),
        ],
      };
    }
    return layout;
  }
  // Recurse into split children
  return {
    ...layout,
    children: layout.children.map(child => splitPane(child, targetId, direction, newTermData)),
  };
};

const removePane = (layout, targetId) => {
  if (layout.type === 'pane') return layout;

  const [left, right] = layout.children;

  // If one of the direct children is the target pane, return the other child
  if (left.type === 'pane' && left.id === targetId) return right;
  if (right.type === 'pane' && right.id === targetId) return left;

  // Recurse into children
  const newChildren = layout.children.map(child => removePane(child, targetId));

  // Check if any child became null-ish after deep removal
  return { ...layout, children: newChildren };
};

const getAllPaneIds = (layout) => {
  if (layout.type === 'pane') return [layout.id];
  return layout.children.flatMap(getAllPaneIds);
};

const getPaneById = (layout, id) => {
  if (layout.type === 'pane') return layout.id === id ? layout : null;
  for (const child of layout.children) {
    const found = getPaneById(child, id);
    if (found) return found;
  }
  return null;
};

const updatePaneData = (layout, paneId, termData) => {
  if (layout.type === 'pane') {
    if (layout.id === paneId) return { ...layout, termData };
    return layout;
  }
  return {
    ...layout,
    children: layout.children.map(child => updatePaneData(child, paneId, termData)),
  };
};

const updateRatio = (layout, splitId, newRatio) => {
  if (layout.type === 'pane') return layout;
  if (layout._splitId === splitId) return { ...layout, ratio: newRatio };
  return {
    ...layout,
    children: layout.children.map(child => updateRatio(child, splitId, newRatio)),
  };
};

// Assign stable split IDs for ratio tracking
let splitIdCounter = 0;
const assignSplitIds = (layout) => {
  if (layout.type === 'pane') return layout;
  const node = { ...layout };
  if (!node._splitId) node._splitId = `split-${++splitIdCounter}`;
  node.children = node.children.map(assignSplitIds);
  return node;
};

// ─── Draggable Divider ───────────────────────────────────────────────────────

function Divider({ direction, onDrag, isActive }) {
  const dragging = useRef(false);
  const dividerRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    const cur = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.cursor = cur;
    document.body.style.userSelect = 'none';

    // Overlay blocks xterm/iframes from stealing pointer events during drag
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:99999;cursor:${cur};`;
    document.body.appendChild(overlay);

    const handleMouseMove = (e) => {
      if (!dragging.current) return;
      onDrag(e);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [direction, onDrag]);

  const isHoriz = direction === 'horizontal';

  return (
    <div
      ref={dividerRef}
      onMouseDown={handleMouseDown}
      className={`tmux-divider ${isHoriz ? 'tmux-divider-v' : 'tmux-divider-h'} ${isActive ? 'tmux-divider-active' : ''}`}
      style={{
        position: 'relative',
        zIndex: 10,
        ...(isHoriz
          ? { width: '4px', minWidth: '4px', cursor: 'col-resize' }
          : { height: '4px', minHeight: '4px', cursor: 'row-resize' }),
        background: isActive ? 'var(--tmux-divider-active, #4ade80)' : 'var(--tmux-divider, rgba(255,255,255,0.06))',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--tmux-divider-hover, rgba(74,222,128,0.4))'}
      onMouseLeave={(e) => e.currentTarget.style.background = isActive ? 'var(--tmux-divider-active, #4ade80)' : 'var(--tmux-divider, rgba(255,255,255,0.06))'}
    />
  );
}

// ─── Connection Picker (inline for empty panes) ─────────────────────────────

function PaneConnectionPicker({ connections, onSelect, onSplitH, onSplitV, paneId, canSplit }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const sshConnections = connections.filter(c => c.type !== 'database');
  const filtered = sshConnections.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.host || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="h-full w-full overflow-y-auto overflow-x-hidden bg-transparent relative"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/ssh-connection')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault(); setIsDragOver(false);
        try { const conn = JSON.parse(e.dataTransfer.getData('application/ssh-connection')); if (conn.type !== 'database') onSelect(conn); } catch (_) {}
      }}
    >
      {isDragOver && (
        <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-500/10 flex items-center justify-center z-10 pointer-events-none animate-pulse">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
              <Terminal size={24} className="text-emerald-400" />
            </div>
            <span className="text-sm font-semibold text-emerald-400">Drop to open terminal</span>
          </div>
        </div>
      )}
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="w-full max-w-lg flex flex-col items-center gap-6">

          {/* Icon — matches FileLayout w-20 h-20 */}
          <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center border border-emerald-500/20 shadow-xl shadow-emerald-500/5 ring-1 ring-white/5"
            style={{ background: 'rgba(74,222,128,0.08)' }}>
            <Terminal className="w-10 h-10 text-emerald-400" />
          </div>

          {/* Title — matches text-2xl font-bold */}
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Select Server
            </h2>
            <p className="text-[var(--text-muted)] text-sm max-w-[280px] leading-relaxed mx-auto">
              Choose a connection or drag one from the sidebar
            </p>
          </div>

          {/* Search — matches h-12 rounded-2xl pl-12 */}
          <div className="w-full relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-emerald-400 transition-colors" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search servers…"
              className="w-full h-12 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl pl-12 pr-4 text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-[var(--text-muted)] backdrop-blur-sm shadow-sm"
            />
          </div>

          {/* List — matches rounded-2xl border bg-[var(--bg-card)] p-2 */}
          <div className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2 space-y-1 backdrop-blur-sm shadow-xl">
            {filtered.length > 0 ? filtered.map(conn => (
              <button
                key={conn._id}
                onClick={() => onSelect(conn)}
                className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-[var(--bg-card-hover)] transition-all group text-left border border-transparent hover:border-[var(--border-hover)] active:scale-[0.98]"
              >
                {/* Avatar — matches w-10 h-10 rounded-xl with gradient */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shrink-0"
                  style={{ background: `linear-gradient(135deg, ${conn.color || '#6366f1'}, ${conn.color || '#6366f1'}cc)` }}>
                  <Monitor size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{conn.name}</div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate font-mono">{conn.host}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${conn.status === 'online' ? 'bg-emerald-400' : 'bg-red-500/60'}`} />
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                    <ChevronRight size={16} className="text-emerald-400" />
                  </div>
                </div>
              </button>
            )) : (
              <div className="p-10 text-center opacity-40">
                <Server className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-xs font-medium uppercase tracking-[0.2em]">No SSH connections</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Recursive Layout Renderer ──────────────────────────────────────────────

function PortalAnchor({ paneId, onRegisterRef }) {
  const elRef = useRef(null);
  // Use layoutEffect to ensure registration happens before the paint/mount of Portals
  useLayoutEffect(() => {
    onRegisterRef(paneId, elRef.current);
    return () => onRegisterRef(paneId, null);
  }, [paneId, onRegisterRef]);

  return <div ref={elRef} className="h-full w-full" />;
}

function LayoutRenderer({ layout, activePaneId, onFocusPane, onClosePane, onSplitPane, onAssignConnection, onPopOut, onRatioChange, connections, zoomedPaneId, onRegisterRef, windowId }) {
  const containerRef = useRef(null);

  // ⚠️ ALL hooks must be called unconditionally before any early return
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
    onRatioChange(layout._splitId, newRatio);
  }, [isHoriz, layout._splitId, onRatioChange]);

  if (layout.type === 'pane') {
    const isActive = activePaneId === layout.id;

    return (
      <div
        className="tmux-pane-wrapper"
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          outline: isActive ? '1px solid rgba(74,222,128,0.35)' : '1px solid var(--border-color)',
          transition: 'outline-color 0.15s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onFocusPane(layout.id);
        }}
      >
        {/* Pane toolbar */}
        <div
          className="flex items-center justify-between px-2 shrink-0"
          style={{
            height: '26px',
            background: isActive ? 'rgba(74,222,128,0.06)' : 'var(--bg-tertiary)',
            borderBottom: isActive ? '1px solid rgba(74,222,128,0.15)' : '1px solid var(--border-color)',
            transition: 'all 0.15s',
          }}
        >
          <div className="flex items-center gap-1.5">
            {layout.termData && (
              <>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: layout.termData.color || '#6366f1' }} />
                <span className="text-[10px] font-mono text-[var(--text-primary)]/50 truncate max-w-[120px]">
                  {layout.termData.connectionName}
                </span>
                <span className={`inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium ${typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
                  {typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? '⚡ Local' : '☁ Server'}
                </span>
              </>
            )}
            {!layout.termData && (
              <span className="text-[10px] font-mono text-[var(--text-primary)]/20">empty</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onSplitPane(layout.id, 'horizontal'); }}
              className="p-0.5 rounded hover:bg-[var(--text-primary)]/10 text-[var(--text-primary)]/30 hover:text-[var(--text-primary)]/60 transition-colors"
              title="Split Vertical (Ctrl+B %)"
            >
              <Columns size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSplitPane(layout.id, 'vertical'); }}
              className="p-0.5 rounded hover:bg-[var(--text-primary)]/10 text-[var(--text-primary)]/30 hover:text-[var(--text-primary)]/60 transition-colors"
              title="Split Horizontal (Ctrl+B &quot;)"
            >
              <Rows size={10} />
            </button>
            <button
               onClick={(e) => { 
                 e.stopPropagation(); 
                 window.dispatchEvent(new CustomEvent('terminal:restart', { 
                   detail: { terminalId: layout.termData?.connectionId } 
                 }));
               }}
               className="p-0.5 rounded hover:bg-[var(--text-primary)]/10 text-[var(--text-primary)]/30 hover:text-[var(--text-primary)]/60 transition-colors"
               title="Restart Session"
             >
               <RefreshCw size={10} />
             </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPopOut(layout); }}
              draggable
              onDragStart={(e) => {
                if (layout.termData) {
                  e.dataTransfer.setData('application/ssh-connection', JSON.stringify(layout.termData.connection));
                  e.dataTransfer.setData('application/source-app-type', 'terminal');
                  // Signal that this should close the source pane if dropped on desktop
                  e.dataTransfer.setData('application/tmux-pane-id', layout.id);
                  e.dataTransfer.setData('application/tmux-window-id', windowId);
                  
                  const ghost = document.createElement('div');
                  ghost.style.cssText = `background:${layout.termData.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;color:white;font-size:11px;font-weight:700;`;
                  ghost.textContent = `🐚 ${layout.termData.connectionName}`;
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }
              }}
              className="p-0.5 rounded hover:bg-[var(--text-primary)]/10 text-[var(--text-primary)]/30 hover:text-[var(--text-primary)]/60 transition-colors cursor-grab active:cursor-grabbing"
              title="Pop out to Window (Drag to Desktop)"
            >
              <ExternalLink size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClosePane(layout.id); }}
              className="p-0.5 rounded hover:bg-red-500/20 text-[var(--text-primary)]/30 hover:text-red-400 transition-colors"
              title="Close Pane (Ctrl+B x)"
            >
              <X size={10} />
            </button>
          </div>
        </div>

        {/* Pane content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
          {layout.termData ? (
            <PortalAnchor paneId={layout.id} onRegisterRef={onRegisterRef} />
          ) : (
            <PaneConnectionPicker
              connections={connections}
              onSelect={(conn) => onAssignConnection(layout.id, conn)}
              paneId={layout.id}
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
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isHoriz ? 'row' : 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: `${ratio} 1 0`, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <LayoutRenderer
          key={layout.children[0].id || 'left'}
          layout={layout.children[0]}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
          onAssignConnection={onAssignConnection}
          onPopOut={onPopOut}
          onRatioChange={onRatioChange}
          connections={connections}
          zoomedPaneId={zoomedPaneId}
          onRegisterRef={onRegisterRef}
          windowId={windowId}
        />
      </div>

      <Divider
        direction={isHoriz ? 'horizontal' : 'vertical'}
        onDrag={handleDrag}
        isActive={false}
      />

      <div style={{ flex: `${1 - ratio} 1 0`, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <LayoutRenderer
          key={layout.children[1].id || 'right'}
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
          onAssignConnection={onAssignConnection}
          onPopOut={onPopOut}
          onRatioChange={onRatioChange}
          connections={connections}
          zoomedPaneId={zoomedPaneId}
          onRegisterRef={onRegisterRef}
          windowId={windowId}
        />
      </div>
    </div>
  );
}


// ─── Main TmuxLayout Component ──────────────────────────────────────────────

export default function TmuxLayout({ windowId = 'default', isTmuxMode = false }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { connections, activeTerminals } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');

  // Handle terminal IDs that have already been integrated into the layout
  const handledTermIdsRef = useRef(new Set());
  const portalTargets = useRef({}); // Using Ref for DOM elements to avoid closure issues with state
  const [portalState, setPortalState] = useState({}); // State for triggers

  const registerPortalRef = useCallback((paneId, el) => {
    setPortalState(prev => {
      if (prev[paneId] === el) return prev;
      const next = { ...prev };
      if (el) next[paneId] = el;
      else delete next[paneId];
      return next;
    });
  }, []);

  const [windows, setWindows] = useState(() => {
    // 1. Try to load from localStorage using windowId
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`tmux-layout-${windowId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.windows && Array.isArray(parsed.windows)) {
             if (parsed._allTerms) parsed._allTerms.forEach(id => handledTermIdsRef.current.add(id));
             return parsed.windows.map(w => ({ ...w, layout: assignSplitIds(w.layout) }));
          }
        } catch (e) {
          console.error('Failed to load layout:', e);
        }
      }
    }
    return [];
  });

  const [activeWindowIndex, setActiveWindowIndex] = useState(0);
  const [zoomedPaneId, setZoomedPaneId] = useState(null);
  const prefixActive = useRef(false);
  const prefixTimer = useRef(null);
  const [hiddenRoom, setHiddenRoom] = useState(null);

  const activeWindow = windows[activeWindowIndex] || null;
  const layout = activeWindow?.layout || null;
  const activePaneId = activeWindow?.activePaneId || null;

  // Sync wrappers
  const updateActiveWindow = useCallback((updater) => {
    setWindows(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[activeWindowIndex] = updater(next[activeWindowIndex]);
      return next;
    });
  }, [activeWindowIndex]);

  const handleFocusPane = useCallback((id) => {
    updateActiveWindow(win => ({ ...win, activePaneId: id }));
  }, [updateActiveWindow]);

  const handleSplitPane = useCallback((targetId, direction) => {
    updateActiveWindow(win => {
       const newLayout = splitPane(win.layout, targetId, direction);
       const assigned = assignSplitIds(newLayout);
       return { ...win, layout: assigned };
    });
  }, [updateActiveWindow]);

  const handleClosePane = useCallback((targetId) => {
    const pane = layout ? getPaneById(layout, targetId) : null;
    if (pane?.termData?.terminalId) {
      dispatch({ type: 'CLOSE_TERMINAL', payload: pane.termData.terminalId });
      handledTermIdsRef.current.delete(pane.termData.terminalId);
    }

    setWindows(prev => {
      if (prev.length === 0) return prev;
      const win = prev[activeWindowIndex];
      if (!win) return prev;
      const paneIds = getAllPaneIds(win.layout);
      
      if (paneIds.length <= 1) {
        // Last pane in window - reset termData to null so PaneConnectionPicker (server selection) shows up
        const next = [...prev];
        next[activeWindowIndex] = {
          ...win,
          layout: updatePaneData(win.layout, targetId, null)
        };
        return next;
      }

      const next = [...prev];
      const newLayout = removePane(win.layout, targetId);
      const remaining = getAllPaneIds(newLayout);
      next[activeWindowIndex] = {
        ...win,
        layout: assignSplitIds(newLayout),
        activePaneId: targetId === win.activePaneId ? (remaining[0] || null) : win.activePaneId
      };
      return next;
    });
    setZoomedPaneId(null);
  }, [activeWindowIndex, layout, dispatch]);

  const handleAssignConnection = useCallback((paneId, conn) => {
    const termId = `term-${conn._id}-${Date.now()}`;
    const termData = {
      terminalId: termId,
      connectionId: conn._id,
      connectionName: conn.name,
      host: conn.host,
      color: conn.color,
      connection: conn,
    };
    
    handledTermIdsRef.current.add(termId);

    setWindows(prev => {
      const next = [...prev];
      for (let w = 0; w < next.length; w++) {
        const layout = next[w].layout;
        const ids = getAllPaneIds(layout);
        if (ids.includes(paneId)) {
           // We found the window that contains the pane we want to assign!
           next[w] = { ...next[w], layout: updatePaneData(layout, paneId, termData) };
           break;
        }
      }
      return next;
    });
    handleFocusPane(paneId);
  }, [handleFocusPane]);

  const handleRatioChange = useCallback((splitId, newRatio) => {
    updateActiveWindow(win => ({
      ...win,
      layout: updateRatio(win.layout, splitId, newRatio)
    }));
  }, [updateActiveWindow]);

  const handlePopOut = useCallback((pane) => {
    if (!pane.termData) return;
    
    // 1. Tell the OS to open a standalone window for this connection
    window.dispatchEvent(new CustomEvent('pop-out-terminal', {
      detail: { connection: pane.termData.connection }
    }));

    // 2. Close the local pane
    handleClosePane(pane.id);
  }, [handleClosePane]);

  const handleNewWindow = useCallback(() => {
    if (!activeWindow) return;
    
    // Create an empty pane or copy the existing host connection
    const currentPane = getPaneById(activeWindow.layout, activePaneId);
    
    let termData = null;
    if (currentPane?.termData) {
       termData = {
         ...currentPane.termData,
         terminalId: `term-${currentPane.termData.connectionId}-${Date.now()}`
       };
       handledTermIdsRef.current.add(termData.terminalId);
    }

    const newPane = createPane(termData);
    const newWin = {
      id: `win-${Date.now()}-${Math.random()}`,
      name: termData ? termData.connectionName : 'window',
      connectionId: termData ? termData.connectionId : null,
      layout: assignSplitIds(newPane),
      activePaneId: newPane.id
    };
    setWindows(prev => [...prev, newWin]);
    setActiveWindowIndex(prev => prev.length);
  }, [activeWindow, activePaneId]);

  // Listener to close pane if it's successfully dragged out
  useEffect(() => {
    const handleCloseTmuxPane = (e) => {
      if (e.detail?.paneId) {
        handleClosePane(e.detail.paneId);
      }
    };
    window.addEventListener(`close-tmux-pane-${windowId}`, handleCloseTmuxPane);
    return () => window.removeEventListener(`close-tmux-pane-${windowId}`, handleCloseTmuxPane);
  }, [windowId, handleClosePane]);

  const [renamingIndex, setRenamingIndex] = useState(null);

  // Sync to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const allTerms = [];
      const traverse = (node) => {
        if (node.type === 'pane' && node.termData?.terminalId) allTerms.push(node.termData.terminalId);
        if (node.children) node.children.forEach(traverse);
      };
      windows.forEach(w => traverse(w.layout));
      localStorage.setItem(`tmux-layout-${windowId}`, JSON.stringify({ windows, _allTerms: allTerms }));
    }
  }, [windows, windowId]);

  // ── Connection Selection Logic ──
  useEffect(() => {
    if (!activeTerminals || activeTerminals.length === 0) return;

    const newTerminals = activeTerminals.filter(t => !handledTermIdsRef.current.has(t.id));
    if (newTerminals.length === 0) return;

    setWindows(prev => {
      let currentWindows = [...prev];
      
      newTerminals.forEach(newTerminal => {
        handledTermIdsRef.current.add(newTerminal.id);
        const termData = {
          terminalId: newTerminal.id,
          connectionId: newTerminal.connectionId,
          connectionName: newTerminal.connectionName,
          host: newTerminal.host,
          color: newTerminal.color,
          connection: newTerminal.connection,
        };

        // 1. EXACT DUPLICATE CHECK: Search ALL windows/panes for this connectionId
        // This ensures that after a page refresh, we "re-occupy" the existing pane
        // instead of creating a second split for the same server.
        let foundExisting = false;
        for (let i = 0; i < currentWindows.length; i++) {
          const win = currentWindows[i];
          const paneIds = getAllPaneIds(win.layout);
          for (const pid of paneIds) {
            const pane = getPaneById(win.layout, pid);
            if (pane?.termData?.connectionId === newTerminal.connectionId) {
              // Found a pane that belongs to this server!
              // Update it with the NEW terminalId and bring it to focus.
              currentWindows[i] = {
                ...win,
                layout: updatePaneData(win.layout, pid, termData),
                activePaneId: pid
              };
              setActiveWindowIndex(i);
              foundExisting = true;
              break;
            }
          }
          if (foundExisting) break;
        }

        if (foundExisting) return; // Proceed to next new terminal

        // 2. FAVOR SPLITTING ACTIVE WINDOW: If not already in layout, find a place for it
        const targetWinIndex = (activeWindowIndex >= 0 && currentWindows[activeWindowIndex]) 
          ? activeWindowIndex 
          : (currentWindows.length > 0 ? 0 : -1);

        if (targetWinIndex >= 0) {
          const targetWin = currentWindows[targetWinIndex];
          const activeId = targetWin.activePaneId;
          const activePane = getPaneById(targetWin.layout, activeId);
          
          let newLayout;
          // If current pane is empty, use it. Otherwise, split.
          if (activePane && !activePane.termData) {
             newLayout = updatePaneData(targetWin.layout, activeId, termData);
          } else {
             const target = activeId || getAllPaneIds(targetWin.layout)[0];
             newLayout = splitPane(targetWin.layout, target, 'horizontal', termData);
          }

          currentWindows[targetWinIndex] = {
            ...targetWin,
            layout: assignSplitIds(newLayout),
            activePaneId: activePane && !activePane.termData ? activeId : (newLayout.children?.find(c => c.termData?.terminalId === newTerminal.id)?.id || activeId)
          };
          setActiveWindowIndex(targetWinIndex);
        } else {
          // 3. FIRST WINDOW: Create the initial layout entry
          const newPane = createPane(termData);
          const newWin = {
            id: `win-${Date.now()}-${Math.random()}`,
            name: newTerminal.connectionName,
            connectionId: newTerminal.connectionId,
            layout: assignSplitIds(newPane),
            activePaneId: newPane.id
          };
          currentWindows.push(newWin);
          setActiveWindowIndex(currentWindows.length - 1);
        }
      });
      return currentWindows;
    });
  }, [activeTerminals, activeWindowIndex]);

  // ── Auto-focus window for selected connection ──
  useEffect(() => {
    if (state.activeTerminalId) {
      // Find which window and pane has this terminalId
      for (let i = 0; i < windows.length; i++) {
        const win = windows[i];
        const paneIds = getAllPaneIds(win.layout);
        for (const pid of paneIds) {
          const pane = getPaneById(win.layout, pid);
          if (pane?.termData?.terminalId === state.activeTerminalId) {
            if (activeWindowIndex !== i) setActiveWindowIndex(i);
            if (win.activePaneId !== pid) {
              setWindows(prev => {
                const next = [...prev];
                next[i] = { ...next[i], activePaneId: pid };
                return next;
              });
            }
            return;
          }
        }
      }
    }
  }, [state.activeTerminalId, windows.length, activeWindowIndex]);

  useEffect(() => {
    if (state.selectedConnection?._id) {
      const idx = windows.findIndex(w => w.connectionId === state.selectedConnection._id);
      if (idx >= 0 && idx !== activeWindowIndex) {
        setActiveWindowIndex(idx);
      }
    }
  }, [state.selectedConnection?._id, windows.length, activeWindowIndex]);

  // ── Handle external drops (Drag to Desktop) ──
  useEffect(() => {
    const handleRemoteDrop = (e) => {
      const { paneId } = e.detail;
      // We check if this paneId exists in ANY of our windows and close it
      windows.forEach(win => {
        if (getAllPaneIds(win.layout).includes(paneId)) {
          handleClosePane(paneId);
        }
      });
    };
    window.addEventListener('tmux-pane-dropped', handleRemoteDrop);
    return () => window.removeEventListener('tmux-pane-dropped', handleRemoteDrop);
  }, [windows, handleClosePane]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        prefixActive.current = true;
        clearTimeout(prefixTimer.current);
        prefixTimer.current = setTimeout(() => { prefixActive.current = false; }, 2000);
        return;
      }

      if (!prefixActive.current) return;
      prefixActive.current = false;
      clearTimeout(prefixTimer.current);

      switch (e.key) {
        case '%': e.preventDefault(); if (activePaneId) handleSplitPane(activePaneId, 'horizontal'); break;
        case '"': e.preventDefault(); if (activePaneId) handleSplitPane(activePaneId, 'vertical'); break;
        case 'x': e.preventDefault(); if (activePaneId) handleClosePane(activePaneId); break;
        case 'z': e.preventDefault(); setZoomedPaneId(prev => prev === activePaneId ? null : activePaneId); break;
        case 'c': e.preventDefault(); handleNewWindow(); break;
        case ',': e.preventDefault(); setRenamingIndex(activeWindowIndex); break;
        case 'n': e.preventDefault(); setActiveWindowIndex(i => (i + 1) % windows.length); break;
        case 'p': e.preventDefault(); setActiveWindowIndex(i => (i - 1 + windows.length) % windows.length); break;
        case 'ArrowRight': case 'ArrowDown': 
          e.preventDefault(); 
          if (e.shiftKey && layout) {
             // Basic resizing: find active split parent and shift ratio
             // For now we'll stick to simple navigation to avoid complex tree math
             // but could be expanded. Let's do navigation first.
          }
          if (layout) {
            const ids = getAllPaneIds(layout);
            const idx = ids.indexOf(activePaneId);
            handleFocusPane(ids[(idx + 1) % ids.length]);
          }
          break;
        case 'ArrowLeft': case 'ArrowUp':
          e.preventDefault();
          if (layout) {
             const ids = getAllPaneIds(layout);
             const idx = ids.indexOf(activePaneId);
             handleFocusPane(ids[(idx - 1 + ids.length) % ids.length]);
          }
          break;
        case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
          e.preventDefault();
          const winIdx = parseInt(e.key);
          if (winIdx < windows.length) setActiveWindowIndex(winIdx);
          break;
        default: break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [layout, activePaneId, handleSplitPane, handleClosePane, handleFocusPane, windows.length, activeWindowIndex]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const connData = e.dataTransfer.getData('application/ssh-connection');
    if (connData && activePaneId) {
      try {
        const conn = JSON.parse(connData);
        handleAssignConnection(activePaneId, conn);
      } catch (err) { console.error('Drop parse error:', err); }
    }
  }, [activePaneId, handleAssignConnection]);

  // Terminal logic collection
  const terminalViews = useMemo(() => {
    const list = [];
    const traverse = (node) => {
      if (node.type === 'pane' && node.termData) list.push({ ...node.termData, paneId: node.id });
      if (node.children) node.children.forEach(traverse);
    };
    windows.forEach(w => traverse(w.layout));
    return list;
  }, [windows]);

  // Render
  if (windows.length === 0) {
    return (
      <PaneConnectionPicker 
        connections={connections} 
        onSelect={(conn) => {
          const termId = `term-${conn._id}-${Date.now()}`;
          const termData = {
            terminalId: termId,
            connectionId: conn._id,
            connectionName: conn.name,
            host: conn.host,
            color: conn.color,
            connection: conn,
          };
          handledTermIdsRef.current.add(termId);
          const newPane = createPane(termData);
          const newWin = {
            id: `win-${Date.now()}`,
            name: conn.name,
            connectionId: conn._id,
            layout: assignSplitIds(newPane),
            activePaneId: newPane.id
          };
          setWindows([newWin]);
          setActiveWindowIndex(0);
        }} 
      />
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{ position: 'relative', zIndex: 1 }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={handleDrop}
    >
      {/* Hidden Room fallback - only for moments when a pane is being deleted/moved */}
      <div ref={setHiddenRoom} className="hidden-terminal-room" style={{ display: 'none' }} />

      {/* Main split area - Keep ALL windows mounted to preserve Portals */}
      <div className="flex-1 min-h-0 relative">
        {windows.map((win, idx) => {
          const isActive = idx === activeWindowIndex;
          const isZoomed = zoomedPaneId && isActive; // Only apply zoom to the strictly active window

          return (
            <div 
              key={win.id} 
              className={`absolute inset-0 ${isActive ? 'flex flex-col' : 'hidden'}`}
              style={{ zIndex: isActive ? 10 : 1 }}
            >
              {isZoomed ? (
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between px-3 shrink-0 py-1 bg-emerald-400/5 border-b border-emerald-400/20">
                    <div className="flex items-center gap-2">
                      <Maximize2 size={11} className="text-emerald-400" />
                      <span className="text-[10px] font-bold text-emerald-400 tracking-wider">ZOOMED — {getPaneById(win.layout, zoomedPaneId)?.termData?.connectionName}</span>
                    </div>
                    <button onClick={() => setZoomedPaneId(null)} className="text-[10px] text-[var(--text-primary)]/30 hover:text-[var(--text-primary)]/60 font-mono">Ctrl+B z</button>
                  </div>
                  <div className="flex-1 relative overflow-hidden">
                    <PortalAnchor paneId={zoomedPaneId} onRegisterRef={registerPortalRef} />
                  </div>
                </div>
              ) : (
                <LayoutRenderer
                  layout={win.layout}
                  activePaneId={win.activePaneId}
                  onFocusPane={handleFocusPane}
                  onClosePane={handleClosePane}
                  onSplitPane={handleSplitPane}
                  onAssignConnection={handleAssignConnection}
                  onPopOut={handlePopOut}
                  onRatioChange={handleRatioChange}
                  connections={connections}
                  zoomedPaneId={null} // Controlled by parent
                  onRegisterRef={registerPortalRef}
                  windowId={windowId}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* tmux-style status bar (only visible if explicitly requested) */}
      {isTmuxMode && (
        <TmuxStatusBar
          windows={windows}
          activeWindowIndex={activeWindowIndex}
          onFocusWindow={setActiveWindowIndex}
          activePaneId={activePaneId}
          zoomedPaneId={zoomedPaneId}
          onSplit={(dir) => activePaneId && handleSplitPane(activePaneId, dir)}
          onZoom={() => activePaneId && setZoomedPaneId(prev => prev ? null : activePaneId)}
          renamingIndex={renamingIndex}
          onRename={(idx, newName) => {
            if (idx !== null && newName) {
              setWindows(prev => {
                const next = [...prev];
                next[idx] = { ...next[idx], name: newName };
                return next;
              });
            }
            setRenamingIndex(null);
          }}
        />
      )}

      {/* 
          Persistent Terminals Pool - MANUALLY BRIDGED 
          We render them into a static 'hidden-pool' container at the React level.
          Then we use useLayoutEffect to 'appendChild' them into the correct Layout Pane.
          This prevents React from unmounting/remounting the Terminal during structural changes.
      */}
      <div className="terminal-stable-pool" style={{ display: 'none' }}>
        {terminalViews.map(term => (
          <TerminalBridge
            key={term.terminalId}
            term={term}
            target={portalState[term.paneId]}
            hiddenRoom={hiddenRoom}
            onClose={() => handleClosePane(term.paneId)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Terminal Bridge Component ───────────────────────────────────────────────

const TerminalBridge = React.memo(({ term, target, hiddenRoom, onClose }) => {
  const bridgeRef = useRef(null);
  const wrapperRef = useRef(null);
  const { relayInfo } = useApp();
  const [relayMode, setRelayMode] = useState(() => localStorage.getItem('ssh_monitor_ssh_mode') === 'local');
  const relayOnline = relayInfo.connected;
  const relayCheckDone = relayInfo.checkDone;

  // Listen for setting changes
  useEffect(() => {
    const handleUseRelay = () => setRelayMode(localStorage.getItem('ssh_monitor_ssh_mode') === 'local');
    window.addEventListener('storage', handleUseRelay);
    window.addEventListener('ssh-mode-changed', handleUseRelay);
    return () => {
      window.removeEventListener('storage', handleUseRelay);
      window.removeEventListener('ssh-mode-changed', handleUseRelay);
    };
  }, []);

  // Determine if this specific terminal should use relay
  const isLocalhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(term.host || '');
  // RelayTerminalView is for SERVER MODE where server establishes SSH via /relay namespace
  // Use it when sshMode is explicitly 'server', otherwise use TerminalView for both server and local relay
  const useRelayNamespace = !relayMode && localStorage.getItem('ssh_monitor_ssh_mode') === 'server';
  
  // Wait for relay check before rendering localhost terminals to avoid wrong mode
  const needsRelayCheck = isLocalhost && !relayCheckDone;
  
  // 1. Structural Move: Move terminal to the active pane (target) or hiddenRoom
  useLayoutEffect(() => {
    const finalTarget = target || hiddenRoom;
    const node = bridgeRef.current;
    if (finalTarget && node) {
       if (node.parentNode !== finalTarget) {
         finalTarget.appendChild(node);
       }
    }
    if (target && node) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('terminal:pane-activated', {
          detail: { paneId: term.paneId },
        }));
      });
    }
  }, [target, hiddenRoom, term.paneId]);

  // 2. React Safety: On unmount, return terminal to React-controlled wrapper
  // This prevents the "Failed to execute 'removeChild' on 'Node'" error
  useLayoutEffect(() => {
    return () => {
      if (bridgeRef.current && wrapperRef.current) {
        wrapperRef.current.appendChild(bridgeRef.current);
      }
    };
  }, []);

  return (
    <div ref={wrapperRef} className="react-dom-bridge-anchor" style={{ display: 'none' }}>
      <div ref={bridgeRef} className="h-full w-full overflow-hidden" data-pane-id={term.paneId}>
        {needsRelayCheck ? (
          <div className="flex items-center justify-center h-full"><div className="text-xs text-[var(--text-muted)] animate-pulse">Checking relay...</div></div>
        ) : (
          <TerminalView
            connectionId={term.connectionId}
            connectionName={term.connectionName}
            host={term.host}
            color={term.color}
            connection={term.connection}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
});


// ─── tmux Status Bar ─────────────────────────────────────────────────────────

function TmuxStatusBar({ windows, activeWindowIndex, onFocusWindow, activePaneId, zoomedPaneId, onSplit, onZoom, renamingIndex, onRename }) {
  const [time, setTime] = useState('');
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (renamingIndex !== null) {
      setRenameValue(windows[renamingIndex]?.name || '');
    }
  }, [renamingIndex, windows]);

  const activeWindow = windows[activeWindowIndex];
  const paneCount = activeWindow ? getAllPaneIds(activeWindow.layout).length : 0;

  return (
    <div
      className="tmux-status-bar flex items-center shrink-0"
      style={{
        height: '24px',
        background: 'linear-gradient(to right, #1a2e1a, #0c1a0c)',
        borderTop: '1px solid rgba(74,222,128,0.15)',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: '10px',
        color: 'rgba(74,222,128,0.7)',
        userSelect: 'none',
      }}
    >
      {/* Left: session name */}
      <div
        className="flex items-center gap-1 px-2 shrink-0 h-full"
        style={{
          background: '#4ade80',
          color: '#000',
          fontWeight: 700,
          borderRight: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        <Terminal size={10} />
        <span className="uppercase tracking-tighter">tmux</span>
      </div>

      {/* Window tabs */}
      <div className="flex items-center flex-1 overflow-x-auto no-scrollbar gap-px px-1 h-full">
        {windows.map((win, idx) => {
          const isActive = activeWindowIndex === idx;
          const isRenaming = renamingIndex === idx;
          const name = win.name || 'window';

          if (isRenaming) {
            return (
              <div key={win.id} className="flex items-center px-2 bg-emerald-900/30 h-full border-b border-emerald-400">
                <span className="opacity-60 mr-1">{idx}:</span>
                <input
                  autoFocus
                  className="bg-transparent border-none outline-none text-emerald-400 w-24 h-full p-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRename(idx, renameValue);
                    if (e.key === 'Escape') onRename(null);
                  }}
                  onBlur={() => onRename(idx, renameValue)}
                />
              </div>
            );
          }

          return (
            <button
              key={win.id}
              onClick={() => onFocusWindow(idx)}
              className="flex items-center gap-1 px-2 h-full transition-all"
              style={{
                background: isActive ? 'rgba(74,222,128,0.15)' : 'transparent',
                color: isActive ? '#4ade80' : 'rgba(74,222,128,0.4)',
                fontWeight: isActive ? 700 : 400,
                borderBottom: isActive ? '1px solid #4ade80' : '1px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              <span className="opacity-60">{idx}:</span>
              <span>{name}</span>
              {isActive && <span className="text-emerald-400 ml-0.5">*</span>}
            </button>
          );
        })}
      </div>

      {/* Right: controls + time */}
      <div className="flex items-center gap-2 px-2 shrink-0 h-full" style={{ borderLeft: '1px solid rgba(74,222,128,0.1)' }}>
        {onSplit && (
          <div className="flex items-center gap-1.5 mr-2 opacity-60 hover:opacity-100 transition-opacity">
            <button onClick={() => onSplit('horizontal')} title="Split Vertical (Ctrl+B %)">
              <Columns size={10} />
            </button>
            <button onClick={() => onSplit('vertical')} title={'Split Horizontal (Ctrl+B ")'}>
              <Rows size={10} />
            </button>
          </div>
        )}
        
        {onZoom && (
          <button
            onClick={onZoom}
            className={`mr-2 transition-colors ${zoomedPaneId ? 'text-emerald-400' : 'opacity-60 hover:text-emerald-300'}`}
            title="Zoom Toggle (Ctrl+B z)"
          >
            {zoomedPaneId ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
          </button>
        )}

        <div className="flex items-center gap-2">
           <span className="text-[9px] opacity-40 font-mono">
             {paneCount} pane{paneCount !== 1 ? 's' : ''}
           </span>
           <span className="text-emerald-400/90 font-bold tabular-nums">{time}</span>
        </div>
      </div>
    </div>
  );
}
