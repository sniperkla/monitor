'use client';

import { useOS } from '@/context/OSContext';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function DesktopIcon({ id, title, icon: Icon, component, defaultPos, initialWidth, initialHeight }) {
  const { state, openWindow, updateIconPosition, setSortBy, setSelectedIcons, toggleIconSelection, updateMultipleIconPositions } = useOS();
  const { selectedIconIds } = state;
  const isSelected = selectedIconIds.includes(id);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, snapshot: null });
  const iconRef = useRef(null);
  
  const position = state.iconPositions[id] || defaultPos || { x: 0, y: 0 };
  const iconSize = state.iconSize || 'medium';

  const handleDoubleClick = () => {
    openWindow(id, title, component, Icon, { initialWidth, initialHeight });
  };

  const getSizes = () => {
    switch (iconSize) {
      case 'small': return { container: 'w-20', icon: 32, iconBox: 'w-10 h-10', text: 'text-[10px]' };
      case 'large': return { container: 'w-28', icon: 32, iconBox: 'w-16 h-16', text: 'text-sm' };
      default: return { container: 'w-24', icon: 24, iconBox: 'w-12 h-12', text: 'text-xs' };
    }
  };

  const sizes = getSizes();
  const iconStyle = state.iconStyle || 'glass';

  const getStyle = () => {
    const isLight = state.theme === 'light';
    
    switch (iconStyle) {
      case 'flat':
        return 'bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm';
      case 'neumorphic':
        return 'bg-[var(--bg-primary)] shadow-[var(--neumorphic-shadow-dark),var(--neumorphic-shadow-light)] border-none';
      case 'outline':
        return `bg-transparent border-2 ${isLight ? 'border-[var(--accent-indigo)]/50' : 'border-[var(--accent-indigo)]/30'} hover:bg-[var(--accent-indigo)]/10 transition-colors`;
      case 'minimal':
        return 'bg-transparent border-none shadow-none hover:bg-[var(--text-primary)]/10 transition-colors';
      default: // glass
        return isLight 
          ? 'bg-white/40 backdrop-blur-xl border border-white/60 shadow-xl ring-1 ring-black/5'
          : 'bg-black/25 backdrop-blur-xl border border-white/10 shadow-2xl ring-1 ring-white/5';
    }
  };

  const styleClass = getStyle();

  // --- Custom Drag System ---
  const handlePointerDown = useCallback((e) => {
    // Only left mouse button
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Handle selection
    if (e.shiftKey || e.metaKey) {
      toggleIconSelection(id);
      return; // Don't start drag on shift/cmd click
    } else if (!isSelected) {
      setSelectedIcons([id]);
    }

    // Snapshot ALL selected icon positions at drag start
    const idsToMove = isSelected ? [...selectedIconIds] : [id];
    // Make sure current icon is in the list
    if (!idsToMove.includes(id)) idsToMove.push(id);
    
    const snapshot = {};
    idsToMove.forEach(sid => {
      snapshot[sid] = state.iconPositions[sid] || defaultPos || { x: 0, y: 0 };
    });

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      snapshot,
      hasMoved: false,
    };

    setIsDragging(true);

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        dragRef.current.hasMoved = true;
      }

      const updates = {};
      Object.keys(dragRef.current.snapshot).forEach(sid => {
        const start = dragRef.current.snapshot[sid];
        updates[sid] = {
          x: start.x + dx,
          y: start.y + dy,
        };
      });
      // Track latest positions in the ref so pointerup can read them
      // (avoids stale closure reading old state.iconPositions)
      dragRef.current.lastPositions = updates;
      updateMultipleIconPositions(updates);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      // Grid snap all moved icons using the latest dragged positions
      // (not state.iconPositions which is stale due to React closure)
      const GRID_X = 100;
      const GRID_Y = 110;
      const updates = {};
      const currentPositions = dragRef.current.lastPositions || dragRef.current.snapshot;
      Object.keys(dragRef.current.snapshot).forEach(sid => {
        const pos = currentPositions[sid] || dragRef.current.snapshot[sid];
        const snappedX = Math.round(pos.x / GRID_X) * GRID_X;
        const snappedY = Math.round(pos.y / GRID_Y) * GRID_Y;
        updates[sid] = {
          x: Math.max(0, snappedX),
          y: Math.max(0, snappedY),
        };
      });
      updateMultipleIconPositions(updates);

      if (state.sortBy && state.sortBy !== 'none') {
        setSortBy('none');
      }

      dragRef.current.snapshot = null;
      dragRef.current.lastPositions = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [id, isSelected, selectedIconIds, state.iconPositions, defaultPos]);

  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes('application/ssh-connection') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const connectionData = e.dataTransfer.getData('application/ssh-connection');
    if (connectionData) {
      try {
        const connection = JSON.parse(connectionData);
        // Dispatch custom event that DesktopEnvironment can listen to
        window.dispatchEvent(new CustomEvent('desktop-icon-drop', { 
          detail: { targetAppId: id, connection } 
        }));
      } catch (err) {
        console.error('DesktopIcon drop parse error:', err);
      }
    }
  };

  return (
    <div
      ref={iconRef}
      className={`desktop-icon absolute flex flex-col items-center justify-center p-2 rounded-xl 
        cursor-grab active:cursor-grabbing hover:bg-[var(--text-primary)]/10 dark:hover:bg-white/10 active:bg-[var(--text-primary)]/15 
        transition-all duration-150
        ${sizes.container} gap-2 z-10 group 
        ${isSelected ? 'bg-[var(--accent-indigo)]/15 border border-[var(--accent-indigo)]/40 shadow-[0_8px_24px_rgba(0,0,0,0.15)] ring-1 ring-[var(--accent-indigo)]/20' : 'border border-transparent'}
        ${isDragging ? 'z-50 opacity-90' : ''}
      `}
      data-icon-id={id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      tabIndex={0}
      style={{ 
        left: position.x, 
        top: position.y,
        transition: isDragging ? 'none' : 'left 0.15s ease, top 0.15s ease',
        touchAction: 'none', // Prevent touch scroll interference
      }}
    >
      {/* Ghost Shadow (Grid Snap Preview) */}
      {isDragging && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${
              (Math.round(position.x / 100) * 100) - position.x
            }px, ${
              (Math.round(position.y / 110) * 110) - position.y
            }px)`,
            transition: 'transform 0.1s ease',
          }}
        >
          <div className={`${sizes.iconBox} bg-[var(--bg-tertiary)]/10 border border-dashed border-[var(--border-color)] rounded-xl opacity-50 ml-2 mt-2`} />
        </div>
      )}

      <div className={`${sizes.iconBox} flex items-center justify-center rounded-2xl ${styleClass} transition-all duration-300 pointer-events-none group-hover:scale-110 group-hover:shadow-indigo-500/20 ${isDragging ? 'scale-110 shadow-2xl' : ''}`}>
        <Icon size={sizes.icon} className="text-[var(--desktop-icon-glyph)] drop-shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-colors duration-300" />
      </div>
      <span className={`${sizes.text} text-[var(--desktop-icon-text)] text-center font-bold select-none leading-tight pointer-events-none px-2.5 py-1 rounded-lg transition-all duration-300 bg-[var(--bg-secondary)]/40 backdrop-blur-md border border-[var(--border-color)] shadow-sm mt-1.5`} 
        style={{ 
          textShadow: state.theme === 'light' ? 'none' : '0 1px 2px rgba(0,0,0,0.5)',
        }}>
        {title}
      </span>
    </div>
  );
}
