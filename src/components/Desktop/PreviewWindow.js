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
  const [hoveredDesktop, setHoveredDesktop] = useState(null);
  const [hoveredForCloseDesktop, setHoveredForCloseDesktop] = useState(null);
  const [draggedDesktopId, setDraggedDesktopId] = useState(null);
  const [dropDesktopId, setDropDesktopId] = useState(null);
  const [draggedWindow, setDraggedWindow] = useState(null); // { windowId, fromDesktopId }
  const [selectedWindowId, setSelectedWindowId] = useState(null);
  const [renamingDesktopId, setRenamingDesktopId] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const closeHoverTimerRef = useRef(null);
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
  };

  const handleDesktopDragOver = (e, targetDesktopId) => {
    e.preventDefault();
    setDropDesktopId(targetDesktopId);
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {}
  };

  const handleWindowDragStart = (e, windowId, fromDesktopId) => {
    setDraggedWindow({ windowId, fromDesktopId });
    setSelectedWindowId(windowId);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-window-id', windowId);
      e.dataTransfer.setData('application/x-window-from-desktop', fromDesktopId);
    } catch {}
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedWindowId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed top-0 left-0 right-0 z-[99999] bg-[var(--window-bg)] border-b border-[var(--border-color)] shadow-2xl"
          style={{
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)',
          }}
        >
          {/* Close Button */}
          <div className="absolute top-2 right-2 z-10">
            <button
              onClick={handleClose}
              className="w-6 h-6 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center hover:bg-[#ff6b6b] transition-colors"
              title="Close Preview and Combine Apps"
            >
              <X size={12} className="text-white" />
            </button>
          </div>

          {/* Desktop Bar */}
          <div className="flex items-center gap-4 p-4 bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-3 flex-1 justify-center">
              {desktops.map((desktop, index) => {
                const desktopWindows = windowsByDesktop[desktop.id] || [];
                const isActive = desktop.id === currentDesktopId;
                const isHovered = hoveredDesktop === desktop.id;
                const canRemove = desktops.length > 1;
                const showClose = canRemove && hoveredForCloseDesktop === desktop.id;
                const isDropTarget = dropDesktopId === desktop.id;
                
                return (
                  <motion.div
                    key={desktop.id}
                    className="relative cursor-pointer"
                    layout
                    draggable={renamingDesktopId !== desktop.id}
                    onDragStart={(e) => handleDesktopDragStart(e, desktop.id)}
                    onDragEnd={() => {
                      setDraggedDesktopId(null);
                      setDropDesktopId(null);
                    }}
                    onDragOver={(e) => handleDesktopDragOver(e, desktop.id)}
                    onDrop={(e) => handleDesktopDrop(e, desktop.id)}
                    onHoverStart={() => {
                      setHoveredDesktop(desktop.id);
                      if (closeHoverTimerRef.current) clearTimeout(closeHoverTimerRef.current);
                      closeHoverTimerRef.current = setTimeout(() => {
                        setHoveredForCloseDesktop(desktop.id);
                      }, 500);
                    }}
                    onHoverEnd={() => {
                      setHoveredDesktop(null);
                      setHoveredForCloseDesktop(null);
                      if (closeHoverTimerRef.current) {
                        clearTimeout(closeHoverTimerRef.current);
                        closeHoverTimerRef.current = null;
                      }
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
                      className={`w-32 h-24 rounded-xl border-2 transition-all flex flex-col items-center justify-center ${
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
                    
                    {/* Expandable Window Preview (drag a window to another desktop) */}
                    <AnimatePresence>
                      {isHovered && (
                        <motion.div
                          initial={{ opacity: 0, y: -10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className="absolute top-full left-1/2 transform -translate-x-1/2 mt-4 z-10"
                        >
                          <div className="bg-[var(--window-bg)] border border-[var(--border-color)] rounded-xl shadow-2xl p-4 min-w-[400px] max-w-[500px]">
                            <div className="text-sm font-medium text-[var(--text-primary)] mb-3 text-center">
                              {desktop.name}
                            </div>
                            {desktopWindows.length === 0 ? (
                              <div className="text-center py-8 text-[var(--text-muted)]">
                                <Monitor size={32} className="mx-auto mb-3 opacity-50" />
                                <p className="text-sm">No windows</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                {desktopWindows.slice(0, 4).map(win => (
                                  <div
                                    key={win.id}
                                    className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-2 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors"
                                    draggable
                                    onDragStart={(e) => handleWindowDragStart(e, win.id, desktop.id)}
                                    onClick={() => {
                                      switchDesktop(desktop.id);
                                      focusWindow(win.id);
                                      onClose();
                                    }}
                                  >
                                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                                      {win.title}
                                    </div>
                                  </div>
                                ))}
                                {desktopWindows.length > 4 && (
                                  <div className="text-xs text-[var(--text-muted)] col-span-2 text-center py-2">
                                    +{desktopWindows.length - 4} more windows
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
              
              {/* Add Desktop Button */}
              <motion.button
                onClick={addDesktop}
                className="w-32 h-24 rounded-xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)] transition-all flex flex-col items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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

          {/* Compact Window Thumbnails (current desktop) */}
          <div className="px-6 pb-5 pt-2 bg-[var(--window-bg)]">
            {currentDesktopWindows.length === 0 ? (
              <div className="text-center py-6 text-[var(--text-muted)] text-sm">
                No running apps
              </div>
            ) : (
              <div className="flex justify-center">
                <div className="grid grid-cols-6 gap-3 max-w-[880px] w-full">
                  {currentDesktopWindows.map((win) => {
                    const isSelected = selectedWindowId === win.id;
                    return (
                      <div
                        key={win.id}
                        draggable
                        onDragStart={(e) => handleWindowDragStart(e, win.id, currentDesktopId)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedWindowId(win.id);
                        }}
                        className={`relative rounded-lg border cursor-grab active:cursor-grabbing select-none transition-all ${
                          isSelected
                            ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.35)]'
                            : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                        }`}
                        style={{
                          background: 'var(--bg-secondary)',
                        }}
                        title={win.title}
                      >
                        <div className="h-16 rounded-t-lg bg-[var(--bg-primary)]/40" />
                        <div className="px-2 py-2">
                          <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                            {win.title}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {win.appType || ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
