'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { useOS } from '@/context/OSContext';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    y: windowState.y ?? 40,
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

  const TASKBAR_H = 48;
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
              top: 0,
              left: snapPreview === 'right' ? '50%' : 0,
              width: snapPreview === 'top' ? '100%' : '50%',
              height: `calc(100% - ${TASKBAR_H}px)`,
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
        className={isMaximized ? '!top-0 !left-0 !transform-none' : ''}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`window-container flex flex-col w-full h-full overflow-hidden shadow-2xl transition-all duration-200 ${isSnappedOrMax ? 'rounded-none border-0' : 'rounded-lg border'}`}
          style={{
            background: glassmorphism ? 'rgba(15, 23, 42, 0.85)' : '#111827',
            backdropFilter: glassmorphism ? 'blur(20px)' : 'none',
            borderColor: glassmorphism ? 'rgba(255, 255, 255, 0.1)' : '#374151',
          }}
          onClick={() => focusWindow(id)}
        >
          {/* Title Bar */}
          <div
            className="title-bar h-10 flex items-center justify-between px-3 bg-white/5 border-b border-white/5 cursor-move"
            onDoubleClick={(e) => { e.stopPropagation(); toggleMaximize(id); }}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-200 select-none">
              {Icon && <Icon size={14} className="text-blue-400" />}
              {title}
            </div>
            <div className="flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                onClick={(e) => { e.stopPropagation(); toggleMinimize(id); }}
              >
                <Minus size={14} />
              </button>
              <button
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                onClick={(e) => { e.stopPropagation(); toggleMaximize(id); }}
              >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); closeWindow(id); }}
              >
                <X size={14} />
              </button>
            </div>
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
