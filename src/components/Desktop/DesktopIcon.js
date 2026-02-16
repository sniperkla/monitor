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
    switch (iconStyle) {
      case 'flat':
        return 'bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-md';
      case 'neumorphic':
        return 'bg-[var(--bg-primary)] shadow-[5px_5px_10px_-1px_rgba(0,0,0,0.5),-5px_-5px_10px_-1px_rgba(255,255,255,0.05)] border-none';
      case 'outline':
        return 'bg-transparent border-2 border-white/20 hover:border-indigo-500/50';
      case 'minimal':
        return 'bg-transparent border-none shadow-none';
      default: // glass
        return 'bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm border border-[var(--border-color)] shadow-lg';
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

  return (
    <div
      ref={iconRef}
      className={`desktop-icon absolute flex flex-col items-center justify-center p-2 rounded-lg 
        cursor-grab active:cursor-grabbing hover:bg-white/10 active:bg-white/20 
        transition-[background,border,box-shadow] duration-150
        ${sizes.container} gap-2 z-10 group 
        ${isSelected ? 'bg-blue-500/30 border border-blue-400/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border border-transparent'}
        ${isDragging ? 'z-50 opacity-90' : ''}
      `}
      data-icon-id={id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
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
          <div className={`${sizes.iconBox} bg-white/5 border border-dashed border-white/20 rounded-xl opacity-50 ml-2 mt-2`} />
        </div>
      )}

      <div className={`${sizes.iconBox} flex items-center justify-center rounded-xl ${styleClass} transition-all pointer-events-none group-hover:scale-110 ${isDragging ? 'scale-110 shadow-2xl' : ''}`}>
        <Icon size={sizes.icon} className="text-white drop-shadow-md" />
      </div>
      <span className={`${sizes.text} text-white text-center font-medium drop-shadow-md select-none leading-tight pointer-events-none`}>
        {title}
      </span>
    </div>
  );
}
