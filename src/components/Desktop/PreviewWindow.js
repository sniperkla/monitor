'use client';

import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { X, Settings, Monitor, Maximize2, Minimize2, LayoutGrid, ChevronLeft, ChevronRight, Plus, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function PreviewWindow({ isOpen, onClose }) {
  const { state, focusWindow, closeWindow, toggleMinimize, toggleMaximize, switchDesktop, switchToNextDesktop, switchToPrevDesktop, saveSettings, setKeyboardShortcuts, dispatch, addDesktop, renameDesktop, removeDesktop, reorderDesktops, moveWindowToDesktop } = useOS();
  const { windows, activeWindowId, currentDesktopId, windowsByDesktop, desktops, keyboardShortcuts } = state;
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingWindow, setEditingWindow] = useState(null);
  const [draggedDesktopId, setDraggedDesktopId] = useState(null);
  const [dropDesktopId, setDropDesktopId] = useState(null);
  const [draggedWindow, setDraggedWindow] = useState(null); // { windowId, fromDesktopId }
  const [selectedWindowId, setSelectedWindowId] = useState(null);
  const dragGhostRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const windowCardRefs = useRef({});
  const previewSurfaceRefs = useRef({});
  const [renamingDesktopId, setRenamingDesktopId] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [dragScale, setDragScale] = useState(1);
  const [isCustomDragging, setIsCustomDragging] = useState(false);
  const [customDragWindow, setCustomDragWindow] = useState(null);
  const [shortcuts, setShortcuts] = useState({
    previewWindow: 'Ctrl+Cmd+Up',
    prevDesktop: 'Ctrl+Cmd+Left',
    nextDesktop: 'Ctrl+Cmd+Right',
    minimizeAll: 'Ctrl+Cmd+M',
    closeAll: 'Ctrl+Cmd+W',
  });

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  const handleClose = () => {
    // Combine all apps from current desktop with previous desktop
    const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];
    const currentDesktopIndex = desktops.findIndex(d => d.id === currentDesktopId);
    const prevDesktopIndex = (currentDesktopIndex - 1 + desktops.length) % desktops.length;
    const prevDesktopId = desktops[prevDesktopIndex].id;
    
    // Move all windows from current desktop to previous desktop
    currentDesktopWindows.forEach(win => {
      // Remove from current desktop
      dispatch({ 
        type: 'REMOVE_WINDOW_FROM_DESKTOP', 
        payload: { desktopId: currentDesktopId, windowId: win.id } 
      });
      
      // Add to previous desktop
      dispatch({ 
        type: 'ADD_WINDOW_TO_DESKTOP', 
        payload: { desktopId: prevDesktopId, window: win } 
      });
    });
    
    // Switch to previous desktop
    switchDesktop(prevDesktopId);
    
    // Close preview
    onClose();
  };

  const currentDesktopWindowsLegacy = windowsByDesktop[currentDesktopId] || windows;
  const currentDesktopIndex = desktops.findIndex(d => d.id === currentDesktopId);

  const handleWindowAction = (windowId, action) => {
    switch (action) {
      case 'focus':
        focusWindow(windowId);
        onClose();
        break;
      case 'close':
        closeWindow(windowId);
        break;
      case 'minimize':
        toggleMinimize(windowId);
        break;
      case 'maximize':
        toggleMaximize(windowId);
        break;
    }
  };

  const handleSaveSettings = async () => {
    try {
      setKeyboardShortcuts(shortcuts);
      await saveSettings();
      console.log('Shortcuts saved:', shortcuts);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save shortcuts:', error);
    }
  };

  const updateShortcut = (key, value) => {
    setShortcuts(prev => ({ ...prev, [key]: value }));
  };

  const beginRenameDesktop = (desktop) => {
    setRenamingDesktopId(desktop.id);
    setRenamingValue(desktop.name || '');
  };

  const commitRenameDesktop = () => {
    if (!renamingDesktopId) return;
    const name = (renamingValue || '').trim() || 'Desktop';
    renameDesktop(renamingDesktopId, name);
    setRenamingDesktopId(null);
    setRenamingValue('');
  };

  const cancelRenameDesktop = () => {
    setRenamingDesktopId(null);
    setRenamingValue('');
  };

  const handleDesktopDragStart = (e, desktopId) => {
    setDraggedDesktopId(desktopId);
    setIsDragging(true);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-desktop-id', desktopId);
    } catch {}
  };

  const handleDesktopDrop = (e, targetDesktopId) => {
    e.preventDefault();
    const src = e.dataTransfer.getData('application/x-desktop-id');
    if (src && src !== targetDesktopId) {
      reorderDesktops(src, targetDesktopId);
    }

    const winId = e.dataTransfer.getData('application/x-window-id');
    const fromId = e.dataTransfer.getData('application/x-window-from-desktop');
    if (winId && fromId && targetDesktopId && fromId !== targetDesktopId) {
      moveWindowToDesktop(winId, fromId, targetDesktopId);
    }

    setDraggedDesktopId(null);
    setDropDesktopId(null);
    setDraggedWindow(null);
    setIsDragging(false);
  };

  const handleDesktopDragOver = (e, targetDesktopId) => {
    e.preventDefault();
    setDropDesktopId(targetDesktopId);
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {}
  };

  const handleWindowMouseDown = (e, windowId, fromDesktopId) => {
    e.preventDefault();
    const card = windowCardRefs.current[windowId];
    if (!card) return;
    
    const cardRect = card.getBoundingClientRect();
    const offsetX = e.clientX - cardRect.left;
    const offsetY = e.clientY - cardRect.top;

    // Target drag preview size (keeps ghost compact and shows full rectangle)
    const TARGET_W = 280;
    const TARGET_H = 170;
    const baseScale = Math.min(
      1,
      TARGET_W / Math.max(1, cardRect.width),
      TARGET_H / Math.max(1, cardRect.height)
    );
    
    setCustomDragWindow({ windowId, fromDesktopId });
    setSelectedWindowId(windowId);
    setIsCustomDragging(true);
    
    // Create drag ghost
    const ghost = card.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.92';
    ghost.style.borderRadius = '12px';
    ghost.style.boxShadow = '0 18px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)';
    ghost.style.transition = 'transform 0.12s ease-out';
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
    
    const handleMouseMove = (moveEvent) => {
      const x = moveEvent.clientX - offsetX;
      const y = moveEvent.clientY - offsetY;
      
      // Update ghost position
      if (dragGhostRef.current) {
        dragGhostRef.current.style.left = `${x}px`;
        dragGhostRef.current.style.top = `${y}px`;
      }
      
      // Calculate distance to nearest desktop
      const desktops = document.querySelectorAll('[data-desktop-id]');
      
      if (desktops.length === 0) {
        setDragScale(1);
        return;
      }
      
      let minDistance = Infinity;
      
      desktops.forEach(desktop => {
        const rect = desktop.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(Math.pow(moveEvent.clientX - centerX, 2) + Math.pow(moveEvent.clientY - centerY, 2));
        
        if (distance < minDistance) {
          minDistance = distance;
        }
      });
      
      // Scale based on distance to desktop (closer = smaller)
      const maxDistance = 300;
      const proximityScale = Math.max(0.55, Math.min(1, minDistance / maxDistance));
      const scale = baseScale * proximityScale;
      setDragScale(scale);
      
      // Apply scale to ghost
      if (dragGhostRef.current) {
        // Keep the cursor aligned with the same point in the ghost while scaling
        const tx = offsetX * (1 - scale);
        const ty = offsetY * (1 - scale);
        dragGhostRef.current.style.transformOrigin = 'top left';
        dragGhostRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      }
    };
    
    const handleMouseUp = (upEvent) => {
      // Find which desktop we're over
      const desktops = document.querySelectorAll('[data-desktop-id]');
      let targetDesktop = null;
      
      desktops.forEach(desktop => {
        const rect = desktop.getBoundingClientRect();
        if (upEvent.clientX >= rect.left && upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top && upEvent.clientY <= rect.bottom) {
          targetDesktop = desktop.getAttribute('data-desktop-id');
        }
      });
      
      // Move window if dropped on a different desktop
      if (targetDesktop && targetDesktop !== fromDesktopId) {
        moveWindowToDesktop(windowId, fromDesktopId, targetDesktop);
      }
      
      // Clean up
      if (dragGhostRef.current) {
        document.body.removeChild(dragGhostRef.current);
        dragGhostRef.current = null;
      }
      setIsCustomDragging(false);
      setCustomDragWindow(null);
      setDragScale(1);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Clean up drag ghost
  useEffect(() => {
    if (!isCustomDragging && dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
      setDragScale(1);
    }
  }, [isCustomDragging]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDragEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('drop', handleDragEnd);
    return () => {
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('drop', handleDragEnd);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedWindowId(null);
      return;
    }

    // Prevent body scroll when preview is open
    const originalStyle = window.getComputedStyle(document.body);
    const originalOverflow = originalStyle.overflow;
    const originalPaddingRight = originalStyle.paddingRight;
    
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    
    return () => {
      // Restore original styles
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const renderOne = (windowId) => {
      const surface = previewSurfaceRefs.current[windowId];
      if (!surface) return;

      const node = document.querySelector(`[data-window-id="${windowId}"]`);
      if (!node) return;

      const rect = node.getBoundingClientRect();
      const targetW = surface.clientWidth;
      const targetH = surface.clientHeight;

      if (!rect.width || !rect.height || !targetW || !targetH) return;

      const scale = Math.min(targetW / rect.width, targetH / rect.height);

      const clone = node.cloneNode(true);
      clone.style.pointerEvents = 'none';
      clone.style.transform = `scale(${scale})`;
      clone.style.transformOrigin = 'top left';
      clone.style.position = 'absolute';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;

      surface.replaceChildren(clone);
    };

    const renderAll = () => {
      if (cancelled) return;
      const list = windowsByDesktop[currentDesktopId] || [];
      for (const w of list) {
        if (!w?.id) continue;
        renderOne(w.id);
      }
    };

    const t1 = setTimeout(renderAll, 200);
    const interval = setInterval(renderAll, 900);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearInterval(interval);
    };
  }, [isOpen, currentDesktopId, windowsByDesktop]);

  if (!isOpen) return null;

  const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];
  const wallpaper = state.wallpaper;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed inset-0 z-[99999] bg-[var(--window-bg)]"
          style={{
            boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
          }}
          onMouseDown={(e) => {
            // Clicking blank space should collapse preview window
            if (e.target === e.currentTarget) {
              if (!isDragging) onClose();
            }
          }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: wallpaper ? `url(${wallpaper})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 bg-black/55" />
          <div className="absolute inset-0 backdrop-blur-2xl" />

          <div className="relative h-full w-full flex flex-col">
            {/* Drag ghost for HTML5 DnD */}
            <div
              ref={dragGhostRef}
              style={{
                position: 'fixed',
                top: -1000,
                left: -1000,
                width: 160,
                height: 96,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 18px 38px rgba(0,0,0,0.45)',
              }}
            />

            {/* Desktop Bar */}
            <div className="flex items-center gap-4 px-8 py-6 bg-black/20 border-b border-white/10">
              <div className="flex items-center gap-3 flex-1 justify-center">
                {desktops.map((desktop, index) => {
                  const desktopWindows = windowsByDesktop[desktop.id] || [];
                  const isActive = desktop.id === currentDesktopId;
                  const canRemove = desktops.length > 1;
                  const showClose = canRemove;
                  const isDropTarget = dropDesktopId === desktop.id;
                  
                  return (
                    <motion.div
                      key={desktop.id}
                      className="relative cursor-pointer"
                      layout
                      draggable={renamingDesktopId !== desktop.id}
                      data-desktop-id={desktop.id}
                      onDragStart={(e) => handleDesktopDragStart(e, desktop.id)}
                      onDragEnd={() => {
                        setDraggedDesktopId(null);
                        setDropDesktopId(null);
                      }}
                      onDragOver={(e) => {
                        handleDesktopDragOver(e, desktop.id);
                      }}
                      onDrop={(e) => {
                        handleDesktopDrop(e, desktop.id);
                      }}
                      onClick={() => switchDesktop(desktop.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginRenameDesktop(desktop);
                      }}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      whileHover={{ scale: 1.05 }}
                      transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    >
                    {showClose && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeDesktop(desktop.id);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center hover:bg-[#ff6b6b] transition-colors z-20"
                        title="Close Desktop"
                      >
                        <X size={12} className="text-white" />
                      </button>
                    )}
                    <div
                      className={`w-40 h-28 rounded-2xl border-2 transition-all flex flex-col items-center justify-center ${
                        isActive
                          ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-lg'
                          : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:shadow-lg'
                      }`}
                      style={isDropTarget ? { outline: '2px solid rgba(59,130,246,0.8)', outlineOffset: '2px' } : undefined}
                    >
                      <Monitor size={24} className="mb-2" />
                      <div className="text-sm font-medium text-center w-full px-2">
                        {renamingDesktopId === desktop.id ? (
                          <input
                            value={renamingValue}
                            autoFocus
                            onChange={(e) => setRenamingValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                commitRenameDesktop();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelRenameDesktop();
                              }
                            }}
                            onBlur={commitRenameDesktop}
                            className="w-full text-center text-sm bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1 text-[var(--text-primary)]"
                          />
                        ) : (
                          desktop.name
                        )}
                      </div>
                      <div className="text-xs opacity-70 text-center">
                        {desktopWindows.length} windows
                      </div>
                    </div>
                    
                  </motion.div>
                );
                })}
              
              {/* Add Desktop Button */}
              <motion.button
                onClick={addDesktop}
                className="w-40 h-28 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all flex flex-col items-center justify-center text-white/70 hover:text-white"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                title="Add Desktop"
              >
                <Plus size={24} className="mb-2" />
                <div className="text-sm font-medium">
                  Add Desktop
                </div>
              </motion.button>
              </div>
            </div>

            {/* Mission Control Window Previews (current desktop) */}
            <div
              className="flex-1 overflow-auto px-10 py-10"
              onClick={(e) => {
                // Clicking blank area collapses preview
                if (e.target === e.currentTarget && !isDragging) onClose();
              }}
            >
              {currentDesktopWindows.length === 0 ? (
                <div className="text-center py-10 text-[var(--text-muted)] text-sm cursor-default">
                  No windows
                </div>
              ) : (
                <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {currentDesktopWindows.map((win) => {
                    const isSelected = selectedWindowId === win.id;

                    return (
                      <motion.div
                        layout
                        key={win.id}
                        ref={(el) => {
                          if (el) windowCardRefs.current[win.id] = el;
                          else delete windowCardRefs.current[win.id];
                        }}
                        onMouseDown={(e) => handleWindowMouseDown(e, win.id, currentDesktopId)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedWindowId(win.id);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          focusWindow(win.id);
                          onClose();
                        }}
                        className={`relative rounded-2xl border cursor-grab active:cursor-grabbing select-none transition-all overflow-hidden ${
                          isSelected
                            ? 'border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.35)]'
                            : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                        }`}
                        style={{
                          background: 'var(--bg-secondary)',
                          boxShadow: isSelected
                            ? '0 14px 35px rgba(0,0,0,0.35)'
                            : '0 10px 28px rgba(0,0,0,0.28)',
                          opacity: customDragWindow?.windowId === win.id ? 0.3 : 1,
                        }}
                        title={win.title}
                      >
                        {/* Title Bar */}
                        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
                          <div className="flex items-center gap-2 min-w-0">
                            {win.icon ? (
                              <win.icon size={14} className="text-[var(--text-secondary)]" />
                            ) : (
                              <Monitor size={14} className="text-[var(--text-secondary)]" />
                            )}
                            <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {win.title}
                            </div>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] ml-2 whitespace-nowrap">
                            {win.appType || ''}
                          </div>
                        </div>

                        {/* Preview Surface */}
                        <div
                          className="relative h-60 md:h-64 overflow-hidden"
                          style={{
                            background: 'rgba(255,255,255,0.02)',
                          }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              backgroundImage: wallpaper ? `url(${wallpaper})` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }}
                          />
                          <div className="absolute inset-0 bg-black/35" />
                          <div className="absolute inset-0 backdrop-blur-md" />

                          <div
                            ref={(el) => {
                              if (el) previewSurfaceRefs.current[win.id] = el;
                              else delete previewSurfaceRefs.current[win.id];
                            }}
                            className="absolute inset-0"
                            style={{
                              pointerEvents: 'none',
                            }}
                          />

                          {/* App Icon Badge */}
                          <div className="absolute top-3 left-3">
                            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
                              {win.icon ? (
                                <win.icon size={16} className="text-white/90" />
                              ) : (
                                <Monitor size={16} className="text-white/90" />
                              )}
                            </div>
                          </div>

                          <div className="absolute left-4 right-4 bottom-4">
                            <div className="space-y-2">
                              <div className="h-2 rounded bg-white/20 w-3/4" />
                              <div className="h-2 rounded bg-white/15 w-5/6" />
                              <div className="h-2 rounded bg-white/10 w-2/3" />
                            </div>
                          </div>

                          {/* Selected glow */}
                          {isSelected && (
                            <div className="absolute inset-0 ring-2 ring-blue-500/60" />
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
