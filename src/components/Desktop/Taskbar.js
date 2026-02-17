'use client';

import { useState, useEffect, useRef } from 'react';
import { useOS } from '@/context/OSContext';
import { Terminal, Settings, LayoutGrid, Monitor, Wifi, Volume2, Search, Power, User, X, StickyNote, Book, Layers, Columns, StickyNote as NoteIcon, BookOpen, FolderClosed, Cpu, Clock, ChevronLeft, ChevronRight, Grid3x3, Keyboard } from 'lucide-react';
import { createPortal } from 'react-dom';
import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import NotepadApp from '@/apps/NotepadApp';
import WikiApp from '@/apps/WikiApp';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import TerminalApp from '@/apps/TerminalApp';
import FilesApp from '@/apps/FilesApp';
import PreviewWindow from './PreviewWindow';
import ShortcutSettings from './ShortcutSettings';

export default function Taskbar() {
  const { state, focusWindow, toggleMinimize, openWindow, closeWindow, setTaskbarPosition, saveSettings, switchDesktop, switchToNextDesktop, switchToPrevDesktop } = useOS();
  const { data: session } = useSession();
  const { t } = useTranslation();
  const { windows, activeWindowId, glassmorphism, taskbarPosition, currentDesktopId, windowsByDesktop, desktops } = state;
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, windowId }
  const [taskbarContextMenu, setTaskbarContextMenu] = useState(null); // { x, y }
  const [showPreview, setShowPreview] = useState(false);
  const [showShortcutSettings, setShowShortcutSettings] = useState(false);
  const { minimizeAll, restoreAll } = useOS();
  const [mounted, setMounted] = useState(false);
  const startMenuRef = useRef(null);
  const contextMenuRef = useRef(null);
  const taskbarContextMenuRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (startMenuRef.current && !startMenuRef.current.contains(event.target)) {
        setStartMenuOpen(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
      if (taskbarContextMenuRef.current && !taskbarContextMenuRef.current.contains(event.target)) {
        setTaskbarContextMenu(null);
      }
    };
    
    if (startMenuOpen || contextMenu || taskbarContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [startMenuOpen, contextMenu, taskbarContextMenu]);

  const handleContextMenu = (e, winId) => {
    e.preventDefault();
    e.stopPropagation();
    
    // We'll use a more flexible positioning strategy that doesn't rely on hardcoded menuHeight
    let x = e.clientX;
    let y = e.clientY;
    let position = { x, y };

    // Snap to taskbar edges and handle vertical boundary checks
    if (taskbarPosition === 'bottom') {
      position = { left: x, bottom: 56 };
    } else if (taskbarPosition === 'top') {
      position = { left: x, top: 56 };
    } else if (taskbarPosition === 'left' || taskbarPosition === 'right') {
      const menuHeightEstimate = 320; // safe fallack for overflow checks
      const isNearBottom = y + menuHeightEstimate > window.innerHeight;
      
      if (taskbarPosition === 'left') {
        position = isNearBottom 
          ? { left: 60, bottom: 10 } 
          : { left: 60, top: y };
      } else {
        position = isNearBottom 
          ? { right: 60, bottom: 10 } 
          : { right: 60, top: y };
      }
    }

    // Adjust horizontal bounds if needed
    const menuWidth = winId ? 160 : 240;
    if (position.left !== undefined) {
      if (position.left + menuWidth > window.innerWidth) {
        position.left = window.innerWidth - menuWidth - 10;
      }
      if (position.left < 10) position.left = 10;
    } else if (position.right !== undefined) {
      // already anchored to right
    }

    if (winId) {
      setContextMenu({ ...position, windowId: winId });
      setTaskbarContextMenu(null);
    } else {
      setTaskbarContextMenu(position);
      setContextMenu(null);
    }
    setStartMenuOpen(false); 
  };

  const [isDraggingTaskbar, setIsDraggingTaskbar] = useState(false);

  const handleDragStart = (e) => {
    // Only allow dragging from an empty area of the taskbar
    if (e.target.closest('button') || e.target.closest('input')) {
      e.preventDefault();
      return;
    }
    setIsDraggingTaskbar(true);
    e.dataTransfer.setData('application/webtop-taskbar', 'true');
    e.dataTransfer.effectAllowed = 'move';
    
    // Create an invisible drag image
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  if (!mounted) return null;

  const apps = [
    { id: 'ssh-manager', title: t('ssh.manager'), icon: Monitor, component: <SSHApp />, initialWidth: 1200, initialHeight: 800 },
    { id: 'settings', title: t('common.settings'), icon: Settings, component: <SettingsApp />, initialWidth: 800, initialHeight: 600 },
    { id: 'wiki', title: 'Resource Hub', icon: Book, component: <WikiApp />, initialWidth: 1100, initialHeight: 700 },
    { id: 'notepad', title: 'Notepad', icon: StickyNote, component: <NotepadApp />, initialWidth: 800, initialHeight: 600 },
    { id: 'terminal', title: t('terminal.title'), icon: Terminal, component: <TerminalApp />, initialWidth: 900, initialHeight: 600 },
  ];

  const isVertical = taskbarPosition === 'left' || taskbarPosition === 'right';
  const isHorizontal = taskbarPosition === 'top' || taskbarPosition === 'bottom';
  
  const taskbarClasses = `
    taskbar fixed z-[10000] transition-all duration-300 border-[var(--border-color)]
    ${taskbarPosition === 'bottom' ? 'bottom-0 left-0 w-full h-14' : ''}
    ${taskbarPosition === 'top' ? 'top-0 left-0 w-full h-14' : ''}
    ${taskbarPosition === 'left' ? 'top-0 left-0 h-full w-14' : ''}
    ${taskbarPosition === 'right' ? 'top-0 right-0 h-full w-14' : ''}
  `;

  // Start menu positioning based on taskbar position
  const getStartMenuStyle = () => {
    switch (taskbarPosition) {
      case 'top':
        return { position: 'absolute', top: '100%', left: 0, marginTop: 8 };
      case 'left':
        return { position: 'absolute', top: 0, left: '100%', marginLeft: 8 };
      case 'right':
        return { position: 'absolute', top: 0, right: '100%', marginRight: 8 };
      case 'bottom':
      default:
        return { position: 'absolute', bottom: '100%', left: 0, marginBottom: 8 };
    }
  };

  const getStartMenuAnimation = () => {
    switch (taskbarPosition) {
      case 'top':
        return { initial: { opacity: 0, y: -10, scale: 0.95 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -10, scale: 0.95 } };
      case 'left':
        return { initial: { opacity: 0, x: -10, scale: 0.95 }, animate: { opacity: 1, x: 0, scale: 1 }, exit: { opacity: 0, x: -10, scale: 0.95 } };
      case 'right':
        return { initial: { opacity: 0, x: 10, scale: 0.95 }, animate: { opacity: 1, x: 0, scale: 1 }, exit: { opacity: 0, x: 10, scale: 0.95 } };
      case 'bottom':
      default:
        return { initial: { opacity: 0, y: 10, scale: 0.95 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 10, scale: 0.95 } };
    }
  };

  const menuAnim = getStartMenuAnimation();

  return (
    <>
      {/* Taskbar Drop Zones */}
      {isDraggingTaskbar && (
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setTaskbarPosition('top'); 
              setIsDraggingTaskbar(false); 
            }}
            className="absolute top-0 left-0 w-full h-24 bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setTaskbarPosition('bottom'); 
              setIsDraggingTaskbar(false); 
            }}
            className="absolute bottom-0 left-0 w-full h-24 bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setTaskbarPosition('left'); 
              setIsDraggingTaskbar(false); 
            }}
            className="absolute top-0 left-0 w-24 h-full bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setTaskbarPosition('right'); 
              setIsDraggingTaskbar(false); 
            }}
            className="absolute top-0 right-0 w-24 h-full bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
        </div>
      )}

      <div 
        className={taskbarClasses}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => setIsDraggingTaskbar(false)}
        onContextMenu={(e) => handleContextMenu(e)}
        style={{
          background: 'transparent',
          backdropFilter: 'none',
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isVertical ? 'center' : 'center',
          padding: isVertical ? '0.5rem 0' : '0.5rem 0.75rem',
          cursor: 'default'
        }}
      >
        <div
          className={`flex ${isVertical ? 'flex-col py-2 px-2' : 'flex-row px-3 py-2'} items-center gap-2 rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl`}
          style={{
            background: glassmorphism ? 'var(--taskbar-bg)' : 'var(--bg-primary)',
            backdropFilter: glassmorphism ? 'blur(18px)' : 'none',
            boxShadow: '0 18px 45px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)'
          }}
        >
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center gap-2 relative`} ref={startMenuRef}>
          <button 
            onClick={() => {
              setStartMenuOpen(!startMenuOpen);
              setContextMenu(null);
            }}
            className={`w-10 h-10 rounded-2xl transition-all flex items-center justify-center shadow-lg shrink-0 ${
              startMenuOpen ? 'bg-blue-500 scale-95' : 'bg-blue-600 hover:bg-blue-500 active:scale-90'
            }`}
          >
            <LayoutGrid size={20} className="text-white" />
          </button>

          <AnimatePresence>
            {startMenuOpen && (
              <motion.div
                {...menuAnim}
                className="w-80 rounded-2xl overflow-hidden border border-[var(--border-color)] shadow-2xl"
                style={{
                  ...getStartMenuStyle(),
                  background: glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)',
                  backdropFilter: 'blur(24px)',
                  zIndex: 10002,
                }}
              >
                {/* Start Menu Header */}
                <div className="p-4 bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {session ? (
                      <>
                        <img 
                          src={session.user.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`} 
                          className="w-8 h-8 rounded-full border border-[var(--border-color)] object-cover" 
                          alt="Avatar" 
                          onError={(e) => {
                            e.target.onerror = null; 
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`;
                          }}
                        />
                        <div className="min-w-0">
                          <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{session.user.name}</span>
                          <span className="block text-[10px] text-[var(--text-muted)] truncate">{session.user.email}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center">
                          <User size={16} className="text-white" />
                        </div>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('common.guestUser')}</span>
                      </>
                    )}
                  </div>
                  <button 
                    onClick={async () => {
                      if (session) {
                        try {
                          await saveSettings();
                        } catch(e) { console.error(e) }
                        await signOut({ redirect: false });
                        window.location.href = '/login'; 
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    <Power size={18} />
                  </button>
                </div>

                {/* Start Menu Search → Opens Spotlight */}
                <div className="p-4">
                  <button
                    onClick={() => {
                      setStartMenuOpen(false);
                      // Dispatch keyboard event to open Spotlight
                      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
                    }}
                    className="w-full flex items-center gap-2 bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)] rounded-lg py-2.5 px-3 text-xs text-[var(--text-muted)] hover:border-indigo-500/50 hover:bg-[var(--bg-tertiary)]/60 transition-all group"
                  >
                    <Search size={14} className="group-hover:text-indigo-400 transition-colors" />
                    <span className="flex-1 text-left">{t('desktop.taskbar.search')}</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]/60 font-mono">
                      <kbd className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px]">⌘</kbd>
                      <kbd className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px]">K</kbd>
                    </span>
                  </button>
                </div>

                {/* App List */}
                <div className="px-2 pb-4 space-y-1">
                  <h3 className="px-3 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('desktop.taskbar.pinned')}</h3>
                  {apps.map(app => (
                    <button
                      key={app.id}
                      onClick={() => {
                        openWindow(app.id, app.title, app.component, app.icon, { 
                          initialWidth: app.initialWidth, 
                          initialHeight: app.initialHeight 
                        });
                        setStartMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors group"
                    >
                      <div className={`p-2 rounded-lg bg-[var(--bg-primary)] group-hover:bg-[var(--bg-card-hover)] text-blue-400`}>
                        <app.icon size={18} />
                      </div>
                      <div className="text-left">
                        <span className="block text-sm font-medium text-[var(--text-primary)]">{app.title}</span>
                        <span className="block text-[10px] text-[var(--text-secondary)]">{t('desktop.taskbar.systemApp')}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={isVertical ? 'h-px w-8 bg-[var(--border-color)] my-1' : 'w-px h-8 bg-[var(--border-color)] mx-2'} />
        </div>

        {/* Preview Window Button */}
        {isHorizontal && (
          <button
            onClick={() => setShowPreview(true)}
            className="w-10 h-10 rounded-2xl transition-all flex items-center justify-center shadow-lg shrink-0 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] group"
            title="Preview Window (Ctrl+Cmd+↑ or three-finger swipe up)"
          >
            <Grid3x3 size={18} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
          </button>
        )}

        {/* Running Apps */}
        <div className={`flex-1 flex ${isVertical ? 'flex-col overflow-y-auto no-scrollbar py-1' : 'flex-row items-center overflow-x-auto no-scrollbar px-2'} gap-1.5 relative ${isVertical ? 'items-center' : ''}`}>
          {(windowsByDesktop[currentDesktopId] || windows).map(win => (
            <button
              key={win.id}
              onClick={() => {
                if (contextMenu) setContextMenu(null);
                win.isMinimized ? toggleMinimize(win.id) : focusWindow(win.id);
              }}
              onContextMenu={(e) => handleContextMenu(e, win.id)}
              title={win.title}
              className={`
                ${isHorizontal ? 'w-11 h-11 rounded-2xl justify-center' : 'rounded-xl'} flex items-center gap-2 transition-all border relative group shrink-0
                ${isVertical ? 'w-10 h-10 justify-center mx-auto' : ''}
                ${activeWindowId === win.id && !win.isMinimized
                  ? 'bg-[var(--bg-card-hover)] border-[var(--border-hover)]'
                  : 'bg-[var(--bg-card)] hover:bg-[var(--bg-tertiary)] border-[var(--border-color)]'}
              `}
            >
              {win.icon && (
                <win.icon
                  size={16}
                  className={`text-[var(--accent-indigo)] group-hover:scale-110 transition-transform shrink-0 ${isHorizontal ? 'opacity-90' : ''}`}
                />
              )}
              {activeWindowId === win.id && !win.isMinimized && (
                <motion.div
                  layoutId="taskbar-active"
                  className={`absolute bg-blue-500 rounded-full ${
                    isVertical
                      ? (taskbarPosition === 'left' ? 'right-0 top-2 bottom-2 w-1' : 'left-0 top-2 bottom-2 w-1')
                      : 'bottom-1 w-1.5 h-1.5 left-1/2 -translate-x-1/2'
                  }`}
                />
              )}
            </button>
          ))}
        </div>

        <div className={`flex items-center shrink-0 ${isVertical ? 'flex-col gap-3 py-3' : 'flex-row gap-3 ml-4'}`}>
          {/* Desktop Switcher */}
          {isHorizontal && (
            <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded-full border border-[var(--border-color)] px-2 py-1">
              <button
                onClick={() => switchToPrevDesktop()}
                className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Previous Desktop (Ctrl+Cmd+←)"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-medium text-[var(--text-secondary)] px-1">
                {desktops.findIndex(d => d.id === currentDesktopId) + 1}/{desktops.length}
              </span>
              <button
                onClick={() => switchToNextDesktop()}
                className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Next Desktop (Ctrl+Cmd+→)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          <LanguageSwitcher vertical={isVertical} taskbarPosition={taskbarPosition} />
          <div className={`flex items-center gap-2 ${isVertical ? 'flex-col py-2.5 px-2' : 'px-3 py-1'} bg-[var(--bg-tertiary)] rounded-full border border-[var(--border-color)]`}>
            <Wifi size={14} className="text-emerald-400" />
            <Volume2 size={14} className="text-[var(--text-muted)]" />
            <button
              onClick={() => setShowShortcutSettings(true)}
              className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Keyboard Shortcuts"
            >
              <Keyboard size={14} />
            </button>
          </div>
          {isHorizontal && <div className="w-px h-6 bg-[var(--border-color)]" />}
          <SystemClock vertical={isVertical} />
        </div>
        </div>
      </div>

      {/* Preview Window */}
      {mounted && createPortal(
        <PreviewWindow isOpen={showPreview} onClose={() => setShowPreview(false)} />,
        document.body
      )}

      {/* Shortcut Settings */}
      {mounted && createPortal(
        <ShortcutSettings isOpen={showShortcutSettings} onClose={() => setShowShortcutSettings(false)} />,
        document.body
      )}

      {mounted && createPortal(
        <AnimatePresence>
          {contextMenu && (
            <motion.div
              ref={contextMenuRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[100000] w-48 backdrop-blur-xl border border-[var(--border-color)] rounded-xl shadow-2xl p-1.5 overflow-hidden"
              style={{ 
                background: 'var(--window-bg)',
                ...contextMenu,
                // Ensure contextMenu contains its own positioning keys (left, top, bottom, right)
                backdropFilter: 'blur(24px)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-color)] mb-1 truncate">
                {windows.find(w => w.id === contextMenu.windowId)?.title || 'Application'}
              </div>
              <button
                onClick={() => { focusWindow(contextMenu.windowId); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
              >
                <Monitor size={13} className="text-blue-400" />
                Bring to Front
              </button>
              <button
                onClick={() => { toggleMinimize(contextMenu.windowId); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
              >
                <Layers size={13} className="text-amber-400" />
                {windows.find(w => w.id === contextMenu.windowId)?.isMinimized ? 'Restore' : 'Minimize'}
              </button>
              <div className="h-px bg-[var(--border-color)] my-1 mx-2" />
              <button
                onClick={() => {
                  closeWindow(contextMenu.windowId);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors hover:text-red-400"
              >
                <X size={13} className="text-red-400" />
                {t('common.close')} 
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {mounted && createPortal(
        <AnimatePresence>
          {taskbarContextMenu && (
            <motion.div
              ref={taskbarContextMenuRef}
              initial={{ opacity: 0, scale: 0.95, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -5 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[99999] w-60 backdrop-blur-xl border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden"
              style={{ 
                background: 'var(--window-bg)',
                ...taskbarContextMenu,
                backdropFilter: 'blur(24px)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Quick Launch Section */}
              <div className="p-1.5">
                <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Quick Launch
                </div>
                <button
                  onClick={() => { 
                    setTaskbarContextMenu(null);
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-indigo-500/20 rounded-lg flex items-center gap-2 transition-colors group"
                >
                  <Search size={13} className="text-indigo-400" />
                  <span className="flex-1">Search</span>
                  <span className="text-[9px] text-[var(--text-muted)] font-mono">⌘K</span>
                </button>
                <button
                  onClick={() => { openWindow('terminal', t('terminal.title'), <TerminalApp />, Terminal); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-emerald-500/20 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Terminal size={13} className="text-emerald-400" />
                  Terminal
                </button>
                <button
                  onClick={() => { openWindow('files-app', 'Files', <FilesApp />, FolderClosed); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-blue-500/20 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <FolderClosed size={13} className="text-blue-400" />
                  Files
                </button>
                <button
                  onClick={() => { openWindow('notepad', 'Notepad', <NotepadApp />, StickyNote); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-amber-500/20 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <StickyNote size={13} className="text-amber-400" />
                  Notepad
                </button>
              </div>

              <div className="h-px bg-[var(--border-color)] mx-3" />

              {/* Window Management */}
              <div className="p-1.5">
                <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Windows
                </div>
                <button
                  onClick={() => { minimizeAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Monitor size={13} className="text-blue-400" />
                  Show Desktop
                </button>
                <button
                  onClick={() => { restoreAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <LayoutGrid size={13} className="text-emerald-400" />
                  Restore All
                </button>
                {windows.length > 0 && (
                  <button
                    onClick={() => { windows.forEach(w => closeWindow(w.id)); setTaskbarContextMenu(null); }}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition-colors hover:text-red-400"
                  >
                    <X size={13} className="text-red-400" />
                    Close All Windows
                  </button>
                )}
              </div>

              {/* Running Apps */}
              {windows.length > 0 && (
                <>
                  <div className="h-px bg-[var(--border-color)] mx-3" />
                  <div className="p-1.5">
                    <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <Cpu size={9} className="text-[var(--text-muted)]" />
                      Running ({windows.length})
                    </div>
                    <div className="max-h-32 overflow-y-auto custom-scrollbar">
                      {windows.map(win => (
                        <div key={win.id} className="flex items-center gap-1">
                          <button
                            onClick={() => { focusWindow(win.id); setTaskbarContextMenu(null); }}
                            className="flex-1 text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg truncate flex items-center gap-2"
                          >
                            {win.icon && <win.icon size={11} className="text-[var(--accent-indigo)] shrink-0" />}
                            <span className="truncate">{win.title}</span>
                          </button>
                          <button
                            onClick={() => closeWindow(win.id)}
                            className="p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors shrink-0"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="h-px bg-[var(--border-color)] mx-3" />

              {/* Settings & Position */}
              <div className="p-1.5 pt-0">
                <button
                  onClick={() => { 
                    openWindow('settings', 'Settings', <SettingsApp initialTab="personalization" />, Settings, { initialWidth: 900, initialHeight: 700 }); 
                    setTaskbarContextMenu(null); 
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-indigo-400 font-bold hover:bg-indigo-500/10 rounded-lg flex items-center gap-2 transition-all group"
                >
                  <Settings size={14} className="group-hover:rotate-45 transition-transform duration-500" />
                  Taskbar Settings
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

function LanguageSwitcher({ vertical, taskbarPosition }) {
  const { state, setLanguage } = useOS();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const languages = [
    { code: 'en', label: 'English', sub: 'US' },
    { code: 'th', label: 'ภาษาไทย', sub: 'TH' },
    { code: 'cn', label: '简体中文', sub: 'CN' },
  ];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentLang = languages.find(l => l.code === (state.language || 'en'));

  // Compute popup position based on taskbar position
  const getPopupStyle = () => {
    switch (taskbarPosition) {
      case 'top': return { position: 'absolute', top: '100%', right: 0, marginTop: 8 };
      case 'left': return { position: 'absolute', bottom: 0, left: '100%', marginLeft: 8 };
      case 'right': return { position: 'absolute', bottom: 0, right: '100%', marginRight: 8 };
      case 'bottom':
      default: return { position: 'absolute', bottom: '100%', right: 0, marginBottom: 8 };
    }
  };

  return (
    <div className="relative" ref={menuRef}>
        <button 
        onClick={() => setOpen(!open)}
        className={`${vertical ? 'w-10 h-10' : 'h-8 px-2'} bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] rounded-lg border border-[var(--border-color)] flex flex-col items-center justify-center transition-all`}
      >
        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase leading-none">{currentLang?.sub}</span>
        {!vertical && <span className="text-xs font-semibold text-[var(--text-primary)] leading-none mt-1">{currentLang?.label}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-32 backdrop-blur-xl border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden overflow-y-auto max-h-60 custom-scrollbar z-[10002]"
            style={{
              ...getPopupStyle(),
              background: 'var(--window-bg)'
            }}
          >
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                }}
                className={`w-full px-4 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-between group ${
                  state.language === lang.code ? 'text-[var(--accent-indigo)] bg-[var(--glow-indigo)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-[var(--text-primary)]">{lang.label}</span>
                  <span className="text-[9px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] uppercase">{lang.sub}</span>
                </div>
                {state.language === lang.code && <div className="w-1 h-1 rounded-full bg-indigo-400" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SystemClock({ vertical }) {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!mounted) return null;

  return (
    <div className={`flex flex-col ${vertical ? 'items-center mt-1' : 'items-end'}`}>
      <span className="text-xs font-bold text-[var(--text-primary)] leading-none">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span className={`text-[10px] text-[var(--text-muted)] ${vertical ? 'mt-1' : ''}`}>
        {vertical 
           ? time.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) 
           : time.toLocaleDateString()}
      </span>
    </div>
  );
}
