'use client';

import { X, Minus, Maximize2, Minimize2, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useOS } from '@/context/OSContext';
import { Rnd } from 'react-rnd';

function WindowButtons({ onClose, onMinimize, onMaximize, isMaximized, layout = 'mac', enableMinimize = true, enableMaximize = true }) {
  if (layout === 'pc') {
    return (
      <div className="flex items-center h-full">
        <button
          type="button"
          onClick={enableMinimize ? onMinimize : undefined}
          className={`h-10 w-12 flex items-center justify-center transition-colors group ${enableMinimize ? 'hover:bg-white/10' : 'opacity-50 cursor-default'}`}
          title="Minimize"
          disabled={!enableMinimize}
        >
          <Minus size={14} className="text-[var(--text-secondary)] group-hover:text-white" />
        </button>
        <button
          type="button"
          onClick={enableMaximize ? onMaximize : undefined}
          className={`h-10 w-12 flex items-center justify-center transition-colors group ${enableMaximize ? 'hover:bg-white/10' : 'opacity-50 cursor-default'}`}
          title={isMaximized ? "Restore" : "Maximize"}
          disabled={!enableMaximize}
        >
          {isMaximized ? (
            <Minimize2 size={12} className="text-[var(--text-secondary)] group-hover:text-white" />
          ) : (
            <Square size={10} className="text-[var(--text-secondary)] group-hover:text-white" />
          )}
        </button>
        <button
          type="button"
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
    <div className="flex items-center gap-2 px-3 h-full">
      <button
        type="button"
        onClick={onClose}
        className="w-3.5 h-3.5 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group transition-all z-20"
        aria-label="Close"
      >
        <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
      </button>
      <button
        type="button"
        onClick={enableMinimize ? onMinimize : undefined}
        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center group transition-all z-20 ${
          enableMinimize 
            ? 'bg-[#febc2e] hover:bg-[#febc2e] border-[#d89e24]/30' 
            : 'bg-[#cfcfcf] border-[#b0b0b0]/30 cursor-default'
        }`}
        aria-label="Minimize"
        disabled={!enableMinimize}
      >
        {enableMinimize && <Minus size={8} className="opacity-0 group-hover:opacity-100 text-[#4d2d00] transition-opacity" />}
      </button>
      <button
        type="button"
        onClick={enableMaximize ? onMaximize : undefined}
        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center group transition-all z-20 ${
          enableMaximize 
            ? 'bg-[#28c840] hover:bg-[#28c840] border-[#1fa530]/30' 
            : 'bg-[#cfcfcf] border-[#b0b0b0]/30 cursor-default'
        }`}
        aria-label={isMaximized ? "Restore" : "Maximize"}
        disabled={!enableMaximize}
      >
        {enableMaximize && (
          isMaximized ? (
            <Minimize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
          ) : (
            <Maximize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
          )
        )}
      </button>
    </div>
  );
}

function WindowTitleBar({ title, icon: Icon, onClose, onMinimize, onMaximize, isMaximized, layout = 'mac', enableMinimize = true, enableMaximize = true }) {
  const isMac = layout === 'mac';

  return (
    <div 
      className={`modal-drag-handle relative flex items-center h-10 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)] cursor-default select-none ${isMac ? 'px-3 justify-between' : 'flex-row-reverse justify-between'}`}
      onDoubleClick={(e) => { 
        // Only toggle if not clicking on buttons (buttons stop propagation naturally, but just in case)
        if (e.target.tagName !== 'BUTTON' && enableMaximize) {
          onMaximize();
        }
      }}
    >
      <div className={`relative z-20 flex items-center h-full ${isMac ? '' : 'order-1'}`}>
        <WindowButtons 
          onClose={onClose} 
          onMinimize={onMinimize} 
          onMaximize={onMaximize} 
          isMaximized={isMaximized} 
          layout={layout}
          enableMinimize={enableMinimize}
          enableMaximize={enableMaximize} 
        />
      </div>
      
      <div className={`relative z-10 flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] pointer-events-none select-none ${isMac ? 'flex-1 justify-center' : 'px-4'}`}>
        {Icon ? <Icon size={14} /> : null}
        <span className="truncate">{title}</span>
      </div>
      
      {isMac && <div className="w-14" />}
    </div>
  );
}

export default function MacOSModalWindow({
  isOpen,
  title,
  icon,
  onClose,
  onMinimize: propOnMinimize,
  onMaximize: propOnMaximize,
  isMaximized: propIsMaximized,
  enableMinimize = true,
  enableMaximize = true,
  draggable = false,
  resizable = false,
  defaultWidth,
  defaultHeight,
  minWidth = 420,
  minHeight = 240,
  children,
  zIndexClassName = 'z-[50000]',
  maxWidthClassName = 'max-w-sm',
  maxHeightClassName = 'max-h-[85vh]',
  contentClassName = 'p-4',
  closeOnOverlayClick = false,
  overlayClassName = '',
  containerClassName = '',
  windowClassName = '',
}) {
  const { state: osState } = useOS();
  const windowLayout = osState?.windowLayout || 'mac';
  
  const [isMaximized, setIsMaximized] = useState(false);
  const effectiveMaximized = propIsMaximized ?? isMaximized;

  // Resizable dimensions (used only when resizable + not maximized)
  const [size, setSize] = useState(() => ({
    width: defaultWidth,
    height: defaultHeight,
  }));

  const [position, setPosition] = useState({ x: 0, y: 0 });

  const useFloating = (draggable || resizable) && !effectiveMaximized;

  // Reset local maximization state when modal closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setIsMaximized(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keep internal size in sync when default size props change (or when modal opens)
  useEffect(() => {
    if (!isOpen) return;
    setSize({ width: defaultWidth, height: defaultHeight });
  }, [isOpen, defaultWidth, defaultHeight]);

  // Initialize/center floating window position when opened
  useEffect(() => {
    if (!isOpen) return;
    if (!(draggable || resizable)) return;

    const w = typeof defaultWidth === 'number' ? defaultWidth : 560;
    const h = typeof defaultHeight === 'number' ? defaultHeight : 420;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const x = Math.max(12, Math.round((vw - w) / 2));
    const y = Math.max(12, Math.round((vh - h) / 2));

    setPosition({ x, y });
  }, [isOpen, draggable, resizable, defaultWidth, defaultHeight]);

  const handleMaximize = () => {
    if (!enableMaximize) return;
    if (propOnMaximize) {
      propOnMaximize();
    } else {
      setIsMaximized(!isMaximized);
    }
  };

  const handleMinimize = () => {
    if (!enableMinimize) return;
    if (propOnMinimize) {
      propOnMinimize();
    } else {
      // Default behavior for modals: just close it
      onClose?.();
    }
  };

  const resolvedOverlayClassName = overlayClassName?.trim()
    ? overlayClassName
    : 'bg-black/40';

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body);
      const originalOverflow = originalStyle.overflow;
      const originalPaddingRight = originalStyle.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center p-4 ${resolvedOverlayClassName} ${containerClassName} ${effectiveMaximized ? '!p-0' : 'p-4'}`}
          onClick={() => closeOnOverlayClick && onClose?.()}
        >
          {useFloating ? (
            <Rnd
              size={{
                width: typeof size?.width === 'number' ? size.width : (typeof defaultWidth === 'number' ? defaultWidth : 560),
                height: typeof size?.height === 'number' ? size.height : (typeof defaultHeight === 'number' ? defaultHeight : 420),
              }}
              position={position}
              onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
              onResizeStop={(e, dir, ref, delta, pos) => {
                setSize({
                  width: ref.offsetWidth,
                  height: ref.offsetHeight,
                });
                setPosition(pos);
              }}
              minWidth={minWidth}
              minHeight={minHeight}
              bounds="window"
              dragHandleClassName="modal-drag-handle"
              cancel="button,input,textarea,select,option,label,.nodrag"
              enableResizing={resizable}
              disableDragging={!draggable}
              style={{ zIndex: 1 }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className={`flex flex-col overflow-hidden w-full h-full ${windowClassName}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className={`${effectiveMaximized ? '' : 'rounded-xl border border-[var(--border-color)] shadow-2xl'} overflow-hidden flex flex-col flex-1 min-h-0 max-h-full`}
                  style={{
                    background: 'var(--window-bg)',
                    boxShadow: effectiveMaximized ? 'none' : '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(30px)',
                  }}
                >
                  <WindowTitleBar 
                    title={title} 
                    icon={icon} 
                    onClose={onClose} 
                    onMinimize={handleMinimize}
                    onMaximize={handleMaximize}
                    isMaximized={effectiveMaximized}
                    layout={windowLayout}
                    enableMinimize={enableMinimize}
                    enableMaximize={enableMaximize}
                  />
                  <div className={`${contentClassName} overflow-y-auto custom-scrollbar flex-1 min-h-0`}>
                    {children}
                  </div>
                </div>
              </motion.div>
            </Rnd>
          ) : (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ 
                scale: 1, 
                opacity: 1,
                width: effectiveMaximized ? '100%' : undefined,
                height: effectiveMaximized ? '100%' : undefined,
                maxWidth: effectiveMaximized ? '100%' : '100%',
                maxHeight: effectiveMaximized ? '100%' : '100%',
              }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={`w-full ${!effectiveMaximized ? maxWidthClassName : ''} ${!effectiveMaximized ? maxHeightClassName : ''} flex flex-col overflow-hidden ${windowClassName}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`${effectiveMaximized ? '' : 'rounded-xl border border-[var(--border-color)] shadow-2xl'} overflow-hidden flex flex-col flex-1 min-h-0 max-h-full`}
                style={{
                  background: 'var(--window-bg)',
                  boxShadow: effectiveMaximized ? 'none' : '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(30px)',
                }}
              >
                <WindowTitleBar 
                  title={title} 
                  icon={icon} 
                  onClose={onClose} 
                  onMinimize={handleMinimize}
                  onMaximize={handleMaximize}
                  isMaximized={effectiveMaximized}
                  layout={windowLayout}
                  enableMinimize={enableMinimize}
                  enableMaximize={enableMaximize}
                />
                <div className={`${contentClassName} overflow-y-auto custom-scrollbar flex-1 min-h-0`}>
                  {children}
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
