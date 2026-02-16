'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { useOS } from '@/context/OSContext';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function MacTrafficLights({ onClose, onMinimize, onMaximize, isMaximized }) {
  return (
    <div className="flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onClose}
        className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group"
        aria-label="Close"
      >
        <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
      </button>
      <button
        type="button"
        onClick={onMinimize}
        className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]/30 flex items-center justify-center group"
        aria-label="Minimize"
      >
        <Minus size={8} className="opacity-0 group-hover:opacity-100 text-[#4d2d00] transition-opacity" />
      </button>
      <button
        type="button"
        onClick={onMaximize}
        className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1fa530]/30 flex items-center justify-center group"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Minimize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
        ) : (
          <Maximize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
        )}
      </button>
    </div>
  );
}

export default function Window({ id, title, icon: Icon, component, isMinimized, isMaximized, zIndex, initialWidth, initialHeight }) {
  const { state: osState, focusWindow, closeWindow, toggleMinimize, toggleMaximize, snapWindow, updateWindowPosition } = useOS();
  const { glassmorphism, taskbarPosition } = osState;
  const { snapSide } = osState.windows.find(w => w.id === id) || {};
  
  const rndRef = useRef(null);
  const [snapPreview, setSnapPreview] = useState(null);

  // Track the "free" (non-snapped) position and size so we can restore seamlessly
  const windowState = osState.windows.find(w => w.id === id) || {};
  const [freeRect, setFreeRect] = useState({
    x: windowState.x ?? 100,
    y: windowState.y ?? (taskbarPosition === 'top' ? 64 : 40),
    width: windowState.width || initialWidth || 800,
    height: windowState.height || initialHeight || 600,
  });

  // Sync initial position if missing in global state (e.g. fresh open)
  useEffect(() => {
    if (windowState.x === undefined || windowState.y === undefined) {
      updateWindowPosition(id, { 
        position: { 
          x: freeRect.x, 
          y: freeRect.y, 
          width: freeRect.width, 
          height: freeRect.height 
        } 
      });
    }
  }, []);

  // Screen dimensions
  const [screen, setScreen] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const update = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', update);
    update();
    return () => window.removeEventListener('resize', update);
  }, []);

  const TASKBAR_H = 56;
  const isSnappedOrMax = isMaximized || !!snapSide;

  // Calculate safe area based on taskbar position
  let safeArea = { x: 0, y: 0, w: screen.w, h: screen.h };
  if (taskbarPosition === 'bottom') {
    safeArea.h -= TASKBAR_H;
  } else if (taskbarPosition === 'top') {
    safeArea.y += TASKBAR_H;
    safeArea.h -= TASKBAR_H;
  } else if (taskbarPosition === 'left') {
    safeArea.x += TASKBAR_H;
    safeArea.w -= TASKBAR_H;
  } else if (taskbarPosition === 'right') {
    safeArea.w -= TASKBAR_H;
  }

  // Sync initial position/size if missing in global state
  useEffect(() => {
    if (windowState.x === undefined || windowState.y === undefined || windowState.width === undefined || windowState.height === undefined) {
      updateWindowPosition(id, { 
        position: { 
          x: freeRect.x, 
          y: freeRect.y, 
          width: freeRect.width, 
          height: freeRect.height 
        } 
      });
    }
  }, []); // Run once on mount

  // ── Imperative Snap/Maximize Control ──
  useEffect(() => {
    if (!rndRef.current) return;

    let targetRect = freeRect;

    if (isMaximized || snapSide === 'top') {
      targetRect = { x: safeArea.x, y: safeArea.y, width: safeArea.w, height: safeArea.h };
    } else if (snapSide === 'left') {
      targetRect = { x: safeArea.x, y: safeArea.y, width: Math.floor(safeArea.w / 2), height: safeArea.h };
    } else if (snapSide === 'right') {
      targetRect = { x: safeArea.x + Math.floor(safeArea.w / 2), y: safeArea.y, width: Math.ceil(safeArea.w / 2), height: safeArea.h };
    }

    // Apply the target position/size
    rndRef.current.updatePosition({ x: targetRect.x, y: targetRect.y });
    rndRef.current.updateSize({ width: targetRect.width, height: targetRect.height });

  }, [isMaximized, snapSide, screen.w, screen.h, freeRect, taskbarPosition]);

  // ── Drag handlers ──
  const handleDragStart = useCallback((e) => {
    focusWindow(id);
    if (isSnappedOrMax && !isMaximized) {
      const restoreW = freeRect.width;
      const restoreH = freeRect.height;
      const safeX = Math.max(safeArea.x, Math.min(e.clientX - restoreW / 2, safeArea.x + safeArea.w - restoreW));
      const safeY = Math.max(safeArea.y, e.clientY - 20);
      
      setFreeRect(prev => ({ ...prev, x: safeX, y: safeY }));
      snapWindow(id, null);
      
      if (rndRef.current) {
         rndRef.current.updatePosition({ x: safeX, y: safeY });
         rndRef.current.updateSize({ width: restoreW, height: restoreH });
      }
    }
  }, [id, focusWindow, isSnappedOrMax, isMaximized, freeRect, screen, snapWindow, safeArea]);

  const handleDrag = useCallback((e) => {
    const sw = window.innerWidth;
    const EDGE = 20;
    if (e.clientX <= EDGE) {
      setSnapPreview('left');
    } else if (e.clientX >= sw - EDGE) {
      setSnapPreview('right');
    } else if (e.clientY <= EDGE) {
      setSnapPreview('top');
    } else {
      setSnapPreview(null);
    }
  }, []);

  const handleDragStop = useCallback((e, d) => {
    if (snapPreview) {
      snapWindow(id, snapPreview);
      setSnapPreview(null);
    } else {
      // Clamp position using safeArea
      const clampedX = Math.max(safeArea.x - freeRect.width + 100, Math.min(d.x, safeArea.x + safeArea.w - 100));
      const clampedY = Math.max(safeArea.y, Math.min(d.y, safeArea.y + safeArea.h - 40));
      
      setFreeRect(prev => ({ ...prev, x: clampedX, y: clampedY }));
      
      if (rndRef.current) {
        rndRef.current.updatePosition({ x: clampedX, y: clampedY });
      }
      
      updateWindowPosition(id, { position: { x: clampedX, y: clampedY } });
    }
  }, [snapPreview, id, freeRect, safeArea, snapWindow, updateWindowPosition]);

  // ── Resize handlers ──
  const handleResizeStart = useCallback(() => {
    focusWindow(id);
    if (isSnappedOrMax && !isMaximized) {
      if (rndRef.current) {
        const el = rndRef.current.getSelfElement();
        if (el) {
          const r = el.getBoundingClientRect();
          setFreeRect({ x: r.x, y: r.y, width: r.width, height: r.height });
          snapWindow(id, null);
        }
      }
    }
  }, [id, focusWindow, isSnappedOrMax, isMaximized, snapWindow]);

  const handleResizeStop = useCallback((e, direction, ref, delta, position) => {
    const newWidth = parseInt(ref.style.width, 10);
    const newHeight = parseInt(ref.style.height, 10);
    const clampedY = Math.max(safeArea.y, Math.min(position.y, safeArea.y + safeArea.h - 40));
    
    setFreeRect({ x: position.x, y: clampedY, width: newWidth, height: newHeight });
    
    if (rndRef.current && position.y !== clampedY) {
      rndRef.current.updatePosition({ x: position.x, y: clampedY });
    }
    
    updateWindowPosition(id, { position: { x: position.x, y: clampedY, width: newWidth, height: newHeight } });
  }, [screen, id, updateWindowPosition, safeArea]);

  // ── Safety check: ensure window is visible after restore from minimize ──
  useEffect(() => {
    if (isMinimized || isSnappedOrMax) return;
    const timer = setTimeout(() => {
      if (!rndRef.current) return;
      const el = rndRef.current.getSelfElement();
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0) {
        rndRef.current.updatePosition({ x: Math.max(0, r.left), y: 0 });
        setFreeRect(prev => ({ ...prev, y: 0 }));
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isMinimized, isSnappedOrMax]);

  if (isMinimized) return null;

  return (
    <>
      {/* Snap preview overlay */}
      <AnimatePresence>
        {snapPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed z-[9999] bg-white/10 backdrop-blur-md border border-white/20 pointer-events-none shadow-2xl"
            style={{
              top: snapPreview === 'top' ? safeArea.y : safeArea.y,
              left: snapPreview === 'right' ? safeArea.x + safeArea.w / 2 : safeArea.x,
              width: snapPreview === 'top' ? safeArea.w : safeArea.w / 2,
              height: safeArea.h,
            }}
          />
        )}
      </AnimatePresence>

      {/* Window */}
      <Rnd
        ref={rndRef}
        default={{
          x: freeRect.x,
          y: freeRect.y,
          width: freeRect.width,
          height: freeRect.height,
        }}
        // Removed size={} and position={} props to avoid controlled/uncontrolled conflict
        minWidth={500}
        minHeight={400}
        dragHandleClassName="title-bar"
        disableDragging={isMaximized}
        enableResizing={!isMaximized}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
        style={{ zIndex, display: 'flex' }}
        className={isSnappedOrMax ? (
          `
          !transform-none 
          ${taskbarPosition === 'top' ? '!top-[56px]' : '!top-0'} 
          ${taskbarPosition === 'left' ? '!left-[56px]' : (snapSide === 'right' ? '!left-auto !right-0' : '!left-0')} 
          ${taskbarPosition === 'right' ? '!right-[56px] !left-auto' : ''}
          `
        ) : ''}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`window-container flex flex-col w-full h-full overflow-hidden shadow-2xl transition-all duration-200 ${isSnappedOrMax ? 'rounded-none border-0' : 'rounded-lg border'}`}
          style={{
            background: glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)',
            backdropFilter: glassmorphism ? 'blur(20px)' : 'none',
            borderColor: 'var(--border-color)',
          }}
          onClick={() => focusWindow(id)}
        >
          {/* Title Bar */}
          <div
            className="title-bar h-10 flex items-center px-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)] cursor-move"
            onDoubleClick={(e) => { e.stopPropagation(); toggleMaximize(id); }}
          >
            <MacTrafficLights
              onClose={(e) => { e?.stopPropagation?.(); closeWindow(id); }}
              onMinimize={(e) => { e?.stopPropagation?.(); toggleMinimize(id); }}
              onMaximize={(e) => { e?.stopPropagation?.(); toggleMaximize(id); }}
              isMaximized={isMaximized}
            />

            <div className="flex-1 flex items-center justify-center select-none pointer-events-none">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                {Icon && <Icon size={14} className="text-[var(--text-secondary)]" />}
                <span className="truncate max-w-[50vw]">{title}</span>
              </div>
            </div>

            <div className="w-[52px]" />
          </div>

          {/* Window Content */}
          <div className="flex-1 overflow-auto relative scrollbar-hide">
            {component}
          </div>
        </motion.div>
      </Rnd>
    </>
  );
}
