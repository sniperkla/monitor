'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { useOS } from '@/context/OSContext';
import { X, Minus, Maximize2, Minimize2, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getAppEndpoint } from '@/apps/appEndpoints';

function WindowControls({ onClose, onMinimize, onMaximize, isMaximized, layout = 'mac' }) {
  if (layout === 'pc') {
    return (
      <div className="flex items-center h-full nodrag">
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onMinimize}
          className="h-10 w-12 flex items-center justify-center hover:bg-[var(--bg-tertiary)] transition-colors group"
          title="Minimize"
        >
          <Minus size={14} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onMaximize}
          className="h-10 w-12 flex items-center justify-center hover:bg-[var(--bg-tertiary)] transition-colors group"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Minimize2 size={12} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
          ) : (
            <Square size={10} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
          )}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="h-10 w-12 flex items-center justify-center hover:bg-[#c42b1c] transition-colors group"
          title="Close"
        >
          <X size={16} className="text-[var(--text-secondary)] group-hover:text-white" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 h-full nodrag">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClose}
        className="w-3.5 h-3.5 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group z-50 relative"
        aria-label="Close"
      >
        <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onMinimize}
        className="w-3.5 h-3.5 rounded-full bg-[#febc2e] border border-[#d89e24]/30 flex items-center justify-center group z-50 relative"
        aria-label="Minimize"
      >
        <Minus size={8} className="opacity-0 group-hover:opacity-100 text-[#4d2d00] transition-opacity" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onMaximize}
        className="w-3.5 h-3.5 rounded-full bg-[#28c840] border border-[#1fa530]/30 flex items-center justify-center group z-50 relative"
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

export default function Window({ id, title, icon: Icon, component, isMinimized, isMaximized: _isMaximized, zIndex, initialWidth, initialHeight, minWidth: winMinWidth, minHeight: winMinHeight, previewMode = false, desktopHidden = false }) {
  const isMobile = useIsMobile();
  const isMaximized = _isMaximized;
  const { state: osState, focusWindow, closeWindow, toggleMinimize, toggleMaximize, snapWindow, updateWindowPosition } = useOS();
  const { glassmorphism, glassIntensity, taskbarPosition, windowLayout } = osState;
  const { snapSide } = osState.windows.find(w => w.id === id) || {};
  
  const rndRef = useRef(null);
  const [snapPreview, setSnapPreview] = useState(null);

  // ── Global Rnd ref registry so any window can imperatively control peers ──
  // setFreeRect is stable (React useState guarantee) so we don't need it in deps.
  // The closure captures the binding by ref; the effect runs after the full render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__wndRefs = window.__wndRefs || new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    window.__wndRefs.set(id, { rnd: rndRef, setFreeRect });
    return () => { window.__wndRefs?.delete(id); };
  }, [id]); // setFreeRect is intentionally omitted — it is stable

  // Track the "free" (non-snapped) position and size so we can restore seamlessly
  const windowState = osState.windows.find(w => w.id === id) || {};
  const [freeRect, setFreeRect] = useState({
    x: windowState.x ?? 100,
    y: windowState.y ?? (taskbarPosition === 'top' ? 64 : 40),
    width: windowState.width || initialWidth || 800,
    height: windowState.height || initialHeight || 600,
  });

  // Always-current ref so the layout effect can read freeRect without it being a dep
  const freeRectRef = useRef(freeRect);
  useEffect(() => { freeRectRef.current = freeRect; }, [freeRect]);

  // Track whether a real drag happened (not just a click/double-click)
  const dragMovedRef = useRef(false);

  // Track whether we've done the initial hydration sync so we can force-update Rnd once
  const hasHydratedRef = useRef(false);

  // Sync state when global state hydrates (e.g. from localStorage/DB after mount)
  // We sync whenever global state changes, unless this window is currently being moved by the user.
  useEffect(() => {
    if (windowState.x !== undefined && windowState.y !== undefined) {
      // Don't overwrite if we are currently dragging/resizing
      if (dragMovedRef.current) return;

      const rect = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width || initialWidth || 800,
        height: windowState.height || initialHeight || 600,
      };

      // Enforce the app's size endpoint — fixes sizes persisted by older
      // sessions before endpoints existed, and viewport-shrunk leftovers.
      const m = minSizeRef.current;
      rect.width = Math.min(Math.max(rect.width, m.w), safeArea.w);
      rect.height = Math.min(Math.max(rect.height, m.h), safeArea.h);

      // On first hydration OR meaningful difference — always force-update Rnd.
      // react-rnd's internal re-resizable needs an explicit updateSize call to
      // recalculate its resize-handle hit areas after the component mounts.
      // Without this, a soft refresh (F5) restores position via `default` prop but
      // the resize handles remain bound to stale internal dimensions.
      const isFirstSync = !hasHydratedRef.current;
      const hasMeaningfulDiff = Math.abs(freeRect.x - rect.x) > 1 || Math.abs(freeRect.y - rect.y) > 1 || 
          Math.abs(freeRect.width - rect.width) > 1 || Math.abs(freeRect.height - rect.height) > 1;

      if (isFirstSync || hasMeaningfulDiff) {
        hasHydratedRef.current = true;
        setFreeRect(rect);
        if (rndRef.current) {
          rndRef.current.updatePosition({ x: rect.x, y: rect.y });
          rndRef.current.updateSize({ width: rect.width, height: rect.height });
        }
      }
    }
    
    // Fallback sync if missing entirely in global state (freshly opened window)
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
  }, [windowState.x, windowState.y, windowState.width, windowState.height, id]);

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

  // ── Per-app size endpoint ("perfect endpoint") ──
  // Floor comes from window state (stamped by OPEN_WINDOW from appEndpoints.js),
  // falling back to the registry lookup for windows restored from older sessions.
  // Capped by the current safe area so the floor can never exceed the viewport.
  const endpoint = getAppEndpoint(windowState.appType || id);
  const EFF_MIN_W = Math.max(240, Math.min(winMinWidth ?? endpoint.minWidth, safeArea.w));
  const EFF_MIN_H = Math.max(150, Math.min(winMinHeight ?? endpoint.minHeight, safeArea.h));
  const minSizeRef = useRef({ w: EFF_MIN_W, h: EFF_MIN_H });
  useEffect(() => { minSizeRef.current = { w: EFF_MIN_W, h: EFF_MIN_H }; });

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

    // Force Rnd to re-sync its internal resizable state on mount.
    // After a soft refresh (F5), Rnd mounts with `default` values but its internal
    // re-resizable component may have stale resize-handle bounds. This deferred
    // updateSize call forces re-resizable to recalculate, fixing broken resize.
    const timer = setTimeout(() => {
      if (rndRef.current && !isMaximized && !snapSide) {
        const r = freeRectRef.current;
        rndRef.current.updateSize({ width: r.width, height: r.height });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []); // Run once on mount

  // ── Imperative Snap/Maximize Control ──
  // useLayoutEffect fires synchronously before the browser paints — eliminates the
  // one-frame teleport flash that useEffect caused when toggling maximize/restore.
  // freeRect intentionally NOT in deps: restore reads the latest value via freeRectRef.
  useLayoutEffect(() => {
    if (!rndRef.current) return;

    if (isMaximized || snapSide === 'top') {
      rndRef.current.updatePosition({ x: safeArea.x, y: safeArea.y });
      rndRef.current.updateSize({ width: safeArea.w, height: safeArea.h });
    } else if (snapSide === 'left') {
      rndRef.current.updatePosition({ x: safeArea.x, y: safeArea.y });
      rndRef.current.updateSize({ width: Math.floor(safeArea.w / 2), height: safeArea.h });
    } else if (snapSide === 'right') {
      rndRef.current.updatePosition({ x: safeArea.x + Math.floor(safeArea.w / 2), y: safeArea.y });
      rndRef.current.updateSize({ width: Math.ceil(safeArea.w / 2), height: safeArea.h });
    } else {
      // Restoring from snap/maximize — jump back to saved free rect before paint
      const r = freeRectRef.current;
      rndRef.current.updatePosition({ x: r.x, y: r.y });
      rndRef.current.updateSize({ width: r.width, height: r.height });
    }

    // Force Rnd to re-render so it passes updated position/size to Draggable/Resizable
    if (rndRef.current.forceUpdate) rndRef.current.forceUpdate();

  }, [isMaximized, snapSide, screen.w, screen.h, taskbarPosition]);

  // ── Drag handlers ──
  const handleDragStart = useCallback((e) => {
    dragMovedRef.current = false; // reset — will be set true only on actual movement
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
    dragMovedRef.current = true; // real drag movement detected
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
    } else if (dragMovedRef.current) {
      // Only update freeRect when real drag movement occurred — prevents double-click
      // from corrupting the saved restore position (Rnd fires dragStop on plain clicks too).
      const clampedX = Math.max(safeArea.x - freeRect.width + 100, Math.min(d.x, safeArea.x + safeArea.w - 100));
      const clampedY = Math.max(safeArea.y, Math.min(d.y, safeArea.y + safeArea.h - 40));
      
      setFreeRect(prev => ({ ...prev, x: clampedX, y: clampedY }));
      
      if (rndRef.current) {
        rndRef.current.updatePosition({ x: clampedX, y: clampedY });
      }
      
      updateWindowPosition(id, { position: { x: clampedX, y: clampedY } });
    }
    dragMovedRef.current = false;
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

  // ── Live collision push: resize peer windows when edges collide ──
  // Uses the global __wndRefs registry for imperative peer updates.
  // getBoundingClientRect() gives live DOM positions — no stale-state issues.
  const handleResize = useCallback((e, direction, ref, delta, position) => {
    const MARGIN = 20; // px — snap/push distance
    const MIN_W  = 280;
    const MIN_H  = 160;

    const myL = position.x;
    const myT = position.y;
    const myR = myL + parseInt(ref.style.width,  10);
    const myB = myT + parseInt(ref.style.height, 10);

    // Which edges is THIS resize dragging?
    const affectsRight  = direction === 'right'  || direction === 'topRight'    || direction === 'bottomRight';
    const affectsLeft   = direction === 'left'   || direction === 'topLeft'     || direction === 'bottomLeft';
    const affectsBottom = direction === 'bottom' || direction === 'bottomRight' || direction === 'bottomLeft';
    const affectsTop    = direction === 'top'    || direction === 'topRight'    || direction === 'topLeft';

    const registry = typeof window !== 'undefined' ? window.__wndRefs : null;
    if (!registry) return;

    for (const [peerId, peer] of registry) {
      if (peerId === id) continue;
      const peerRnd = peer.rnd?.current;
      if (!peerRnd) continue;
      const pEl = peerRnd.getSelfElement();
      if (!pEl) continue;
      const pr = pEl.getBoundingClientRect();
      if (pr.width < 10 || pr.height < 10) continue; // minimized / hidden

      const pL = pr.left, pT = pr.top, pR = pr.right, pB = pr.bottom;

      // Windows must share overlap on the perpendicular axis to be in collision path
      const vertOverlap  = myT < pB - 20 && myB > pT + 20;
      const horizOverlap = myL < pR - 20 && myR > pL + 20;

      // My RIGHT edge → peer LEFT edge: push peer rightward & shrink it
      if (affectsRight && vertOverlap) {
        const dist = myR - pL;
        if (dist > -MARGIN && dist < MARGIN) {
          peerRnd.updatePosition({ x: myR, y: pT });
          peerRnd.updateSize({ width: Math.max(MIN_W, pR - myR), height: pr.height });
        }
      }
      // My LEFT edge → peer RIGHT edge: shrink peer from its right
      if (affectsLeft && vertOverlap) {
        const dist = pR - myL;
        if (dist > -MARGIN && dist < MARGIN) {
          peerRnd.updateSize({ width: Math.max(MIN_W, myL - pL), height: pr.height });
        }
      }
      // My BOTTOM edge → peer TOP edge: push peer downward & shrink it
      if (affectsBottom && horizOverlap) {
        const dist = myB - pT;
        if (dist > -MARGIN && dist < MARGIN) {
          peerRnd.updatePosition({ x: pL, y: myB });
          peerRnd.updateSize({ width: pr.width, height: Math.max(MIN_H, pB - myB) });
        }
      }
      // My TOP edge → peer BOTTOM edge: shrink peer from its bottom
      if (affectsTop && horizOverlap) {
        const dist = pB - myT;
        if (dist > -MARGIN && dist < MARGIN) {
          peerRnd.updateSize({ width: pr.width, height: Math.max(MIN_H, myT - pT) });
        }
      }
    }
  }, [id]);

  const handleResizeStop = useCallback((e, direction, ref, delta, position) => {
    const newWidth  = parseInt(ref.style.width,  10);
    const newHeight = parseInt(ref.style.height, 10);
    const clampedY  = Math.max(safeArea.y, Math.min(position.y, safeArea.y + safeArea.h - 40));

    setFreeRect({ x: position.x, y: clampedY, width: newWidth, height: newHeight });

    if (rndRef.current && position.y !== clampedY) {
      rndRef.current.updatePosition({ x: position.x, y: clampedY });
    }

    updateWindowPosition(id, { position: { x: position.x, y: clampedY, width: newWidth, height: newHeight } });

    // Flush peer windows that were imperatively moved during the resize back into React state
    const registry = typeof window !== 'undefined' ? window.__wndRefs : null;
    if (registry) {
      for (const [peerId, peer] of registry) {
        if (peerId === id) continue;
        const peerRnd = peer.rnd?.current;
        if (!peerRnd) continue;
        const pEl = peerRnd.getSelfElement();
        if (!pEl) continue;
        const pr = pEl.getBoundingClientRect();
        if (pr.width < 10) continue;
        const rect = { x: Math.round(pr.left), y: Math.round(pr.top), width: Math.round(pr.width), height: Math.round(pr.height) };
        // Update peer's local freeRect so its next drag starts from the correct position
        peer.setFreeRect(rect);
        updateWindowPosition(peerId, { position: rect });
      }
    }
  }, [id, updateWindowPosition, safeArea]);

  // ── Safety net: enforce the app's size endpoint & visibility after
  // restore from minimize. react-rnd only guards interactive resizes via its
  // minWidth/minHeight — programmatic paths (hydration sync, peer pushes,
  // persisted legacy sizes) can leave the window below the endpoint or
  // partially off-screen, so we correct it one frame after restore.
  useEffect(() => {
    if (isMinimized || isSnappedOrMax) return;
    const timer = setTimeout(() => {
      if (!rndRef.current) return;
      const el = rndRef.current.getSelfElement();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const m = minSizeRef.current;

      // Clamp size up to the endpoint (never beyond the viewport)
      const w = Math.min(Math.max(r.width, m.w), window.innerWidth);
      const h = Math.min(Math.max(r.height, m.h), window.innerHeight);

      if (Math.abs(w - r.width) > 1 || Math.abs(h - r.height) > 1) {
        rndRef.current.updateSize({ width: w, height: h });
        setFreeRect(prev => ({ ...prev, width: w, height: h }));
        updateWindowPosition(id, {
          position: { x: Math.round(r.left), y: Math.round(Math.max(0, r.top)), width: Math.round(w), height: Math.round(h) },
        });
      }

      // Never let a restored window sit above/left of the viewport
      if (r.top < 0 || r.left < 0) {
        const x = Math.max(0, r.left);
        rndRef.current.updatePosition({ x, y: Math.max(0, r.top) });
        setFreeRect(prev => ({ ...prev, x, y: Math.max(0, r.top) }));
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isMinimized, isSnappedOrMax]);

  // In preview mode we keep minimized windows mounted (but hidden) so the PreviewWindow
  // can clone the DOM and show live previews.
  return (
    <>
      {/* Snap preview overlay */}
      <AnimatePresence>
        {snapPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed z-[9999] bg-[var(--bg-tertiary)]/20 backdrop-blur-md border border-[var(--border-color)] pointer-events-none shadow-2xl"
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
        minWidth={EFF_MIN_W}
        minHeight={EFF_MIN_H}
        dragHandleClassName="window-drag-handle"
        cancel=".nodrag,button,input,textarea,select,option,label"
        enableUserSelectHack={false}
        disableDragging={isMaximized}
        enableResizing={!isMaximized}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeStop={handleResizeStop}
        style={{
          zIndex,
          display: 'flex',
          ...(desktopHidden
            ? {
                opacity: 0,
                pointerEvents: 'none',
              }
            : null),
          ...(isMinimized
            ? {
                opacity: 0,
                pointerEvents: 'none',
              }
            : null),
        }}
        resizeHandleStyles={{
          top: { zIndex: 1 },
          topLeft: { zIndex: 1 },
          topRight: { zIndex: 1 },
          bottom: { zIndex: 1 },
          bottomLeft: { zIndex: 1 },
          bottomRight: { zIndex: 1 },
          left: { zIndex: 1 },
          right: { zIndex: 1 },
        }}
        className={isSnappedOrMax ? (
          `
          !transform-none 
          ${taskbarPosition === 'top' ? '!top-[56px] !bottom-0 !h-[calc(100vh-56px)]' : ''} 
          ${taskbarPosition === 'bottom' ? '!top-0 !bottom-[56px] !h-[calc(100vh-56px)]' : ''} 
          ${taskbarPosition === 'left' ? '!top-0 !bottom-0 !h-full' : ''} 
          ${taskbarPosition === 'right' ? '!top-0 !bottom-0 !h-full' : ''}
          ${taskbarPosition === 'right' ? '!right-[56px] !left-auto' : (
            snapSide === 'right' ? '!left-auto !right-0' : (
              taskbarPosition === 'left' ? '!left-[56px]' : '!left-0'
            )
          )}
          `
        ) : ''}
      >
        <motion.div
          initial={isMobile ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
          animate={isMobile ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={isMobile ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
          transition={isMobile ? { duration: 0.15 } : { duration: 0.2 }}
          data-window-id={id}
          className={`window-container flex flex-col w-full h-full overflow-hidden ${isMobile ? '' : 'shadow-2xl'} transition-all duration-200 ${isSnappedOrMax ? 'rounded-none border-0' : 'rounded-lg border'}`}
          style={{
            position: 'relative',
            zIndex: 2,
            background: (glassmorphism && windowState.appType === 'terminal') 
              ? 'transparent' 
              : (glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)'),
            backdropFilter: !isMobile && glassmorphism ? `blur(${glassIntensity ?? 20}px)` : 'none',
            borderColor: 'var(--border-color)',
          }}
          onPointerDown={() => focusWindow(id)}
        >
          {/* Title Bar — transparent in glass mode so the blurred window
              background shows through; opaque gradient when glassmorphism is off */}
          <div
            className={`title-bar h-10 flex items-center ${glassmorphism ? '' : 'bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)]'} border-b border-[var(--border-color)] ${windowLayout === 'mac' ? 'px-3 justify-between' : 'flex-row-reverse justify-between'}`}
            style={{ position: 'relative', zIndex: 60 }}
          >
            {/* Drag Handle Layer (behind controls) */}
            <div
              className="window-drag-handle absolute inset-0 z-0"
              onDoubleClick={(e) => {
                e.stopPropagation();
                toggleMaximize(id);
              }}
            />

            <div style={{ position: 'relative', zIndex: 70 }}>
              {!isMobile && (
                <WindowControls
                  onClose={(e) => { e?.stopPropagation?.(); closeWindow(id); }}
                  onMinimize={(e) => { e?.stopPropagation?.(); toggleMinimize(id); }}
                  onMaximize={(e) => { e?.stopPropagation?.(); toggleMaximize(id); }}
                  isMaximized={isMaximized}
                  layout={windowLayout}
                />
              )}
              {isMobile && (
                <WindowControls
                  onClose={(e) => { e?.stopPropagation?.(); closeWindow(id); }}
                  onMinimize={(e) => { e?.stopPropagation?.(); toggleMinimize(id); }}
                  onMaximize={(e) => { e?.stopPropagation?.(); toggleMaximize(id); }}
                  isMaximized={isMaximized}
                  layout={windowLayout}
                />
              )}
            </div>

            <div className={`flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] pointer-events-none select-none relative z-10 ${windowLayout === 'mac' ? 'flex-1 justify-center' : 'px-4'}`}>
              {Icon && <Icon size={14} className="text-[var(--text-secondary)]" />}
              <span className="truncate max-w-[50vw]">{title}</span>
            </div>

            {windowLayout === 'mac' && <div className="w-14" />}
          </div>

          {/* Window Content */}
          <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto relative scrollbar-hide select-text" style={{ WebkitOverflowScrolling: 'touch' }}>
            {component}
          </div>
        </motion.div>
      </Rnd>
    </>
  );
}
