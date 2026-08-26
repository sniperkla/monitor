'use client';

import { useState, useEffect, useRef } from 'react';
import { useOS } from '@/context/OSContext';
import { Bot, Terminal, Settings, LayoutGrid, Monitor, Wifi, Volume2, Search, Power, User, X, StickyNote, Book, Layers, Columns, StickyNote as NoteIcon, BookOpen, FolderClosed, Cpu, Clock, ChevronLeft, ChevronRight, Grid3x3, Keyboard, Server, Rocket, MonitorPlay, Database, CloudCog, ShieldCheck, Activity, BrickWallShield, History } from 'lucide-react';
import { createPortal } from 'react-dom';
import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import NotepadApp from '@/apps/NotepadApp';
import WikiApp from '@/apps/WikiApp';
import DockerApp from '@/apps/DockerApp';
import AutoDeployApp from '@/apps/AutoDeployApp';
import TmuxApp from '@/apps/TmuxApp';
import AIAgentsApp from '@/apps/AIAgentsApp';
import dynamic from 'next/dynamic';

const MongoBackupApp = dynamic(() => import('@/apps/MongoBackupApp'), { ssr: false });
const RcloneApp = dynamic(() => import('@/apps/RcloneApp'), { ssr: false });
const ServerBackupApp = dynamic(() => import('@/apps/ServerBackupApp'), { ssr: false });
const ServerMonitorApp = dynamic(() => import('@/apps/ServerMonitorApp'), { ssr: false });
const FirewallBlocklistApp = dynamic(() => import('@/apps/FirewallBlocklistApp'), { ssr: false });
const ActivityApp = dynamic(() => import('@/apps/ActivityApp'), { ssr: false });
import { AnimatePresence, motion } from 'framer-motion';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import TerminalApp from '@/apps/TerminalApp';
import FilesApp from '@/apps/FilesApp';
import AppIcon from '@/components/common/AppIcon';
import PreviewWindow from './PreviewWindow';
import AiUsageBar from '@/components/AiUsageBar';
import { useAIUsagePolling } from '@/hooks/useAIUsage';
import { useIsMobile } from '@/hooks/useIsMobile';

export default function Taskbar() {
  const { state, focusWindow, toggleMinimize, openWindow, closeWindow, setTaskbarPosition, saveSettings, switchDesktop, switchToNextDesktop, switchToPrevDesktop, addNotification, pinApp, unpinApp, updateWindowProps } = useOS();
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { windows, activeWindowId, glassmorphism, taskbarPosition: _taskbarPosition, currentDesktopId, windowsByDesktop, desktops, pinnedApps } = state;
  const taskbarPosition = isMobile ? 'bottom' : _taskbarPosition;
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, windowId }
  const [taskbarContextMenu, setTaskbarContextMenu] = useState(null); // { x, y }
  const [showPreview, setShowPreview] = useState(false);
  const [showAllApps, setShowAllApps] = useState(false);
  const { minimizeAll, restoreAll } = useOS();
  const [mounted, setMounted] = useState(false);
  const startMenuRef = useRef(null);
  const contextMenuRef = useRef(null);
  const taskbarContextMenuRef = useRef(null);

  // Use centralized AI usage polling with notification callback for thresholds
  useAIUsagePolling(60000, ({ percent, used, limit, type }) => {
    addNotification({
      title: 'AI usage',
      message: `${percent}% used (${used.toLocaleString()} / ${limit.toLocaleString()} tokens)`,
      type,
    });
  });

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

  const handleContextMenu = (e, winId, pinnedAppId = null) => {
    e.preventDefault();
    e.stopPropagation();
    
    // We'll use a more flexible positioning strategy that doesn't rely on hardcoded menuHeight
    let x = e.clientX;
    let y = e.clientY;
    let position = { x, y };

    // Snap to taskbar edges and handle vertical boundary checks
    if (taskbarPosition === 'bottom') {
      position = { left: x, bottom: 'var(--taskbar-size, 56px)' };
    } else if (taskbarPosition === 'top') {
      position = { left: x, top: 'var(--taskbar-size, 56px)' };
    } else if (taskbarPosition === 'left' || taskbarPosition === 'right') {
      const taskbarSizeNum = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--taskbar-size')) || 56;
      const menuHeightEstimate = 320; 
      const isNearBottom = y + menuHeightEstimate > window.innerHeight;
      
      if (taskbarPosition === 'left') {
        position = isNearBottom 
          ? { left: taskbarSizeNum + 4, bottom: 10 } 
          : { left: taskbarSizeNum + 4, top: y };
      } else {
        position = isNearBottom 
          ? { right: taskbarSizeNum + 4, bottom: 10 } 
          : { right: taskbarSizeNum + 4, top: y };
      }
    }

    // Adjust horizontal bounds if needed
    const menuWidth = (winId || pinnedAppId) ? 180 : 240;
    if (position.left !== undefined) {
      if (position.left + menuWidth > window.innerWidth) {
        position.left = window.innerWidth - menuWidth - 10;
      }
      if (position.left < 10) position.left = 10;
    } else if (position.right !== undefined) {
      // already anchored to right
    }

    if (winId || pinnedAppId) {
      setContextMenu({ ...position, windowId: winId, pinnedAppId: pinnedAppId || (winId ? winId.split('-')[0] : null) });
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
    { id: 'ssh-manager', title: t('apps.sshManager'), icon: Monitor, component: <SSHApp />, initialWidth: 1400, initialHeight: 820 },
    { id: 'terminal', title: t('apps.terminal'), icon: Terminal, component: <TerminalApp />, initialWidth: 1100, initialHeight: 700 },
    { id: 'files', title: t('apps.files'), icon: FolderClosed, component: <FilesApp />, initialWidth: 900, initialHeight: 600 },
    { id: 'docker', title: 'Docker', icon: Server, component: <DockerApp />, initialWidth: 1000, initialHeight: 700 },
    { id: 'auto-deploy', title: 'Auto Deploy', icon: Rocket, component: <AutoDeployApp />, initialWidth: 1100, initialHeight: 760 },
    { id: 'tmux', title: t('apps.tmux'), icon: MonitorPlay, component: <TmuxApp />, initialWidth: 1000, initialHeight: 650 },
    { id: 'mongo-backup', title: 'Mongo Sync', icon: Database, component: <MongoBackupApp />, initialWidth: 1050, initialHeight: 680 },
    { id: 'rclone', title: 'Rclone Sync', icon: CloudCog, component: <RcloneApp />, initialWidth: 1100, initialHeight: 720 },
    { id: 'server-backup', title: 'Server Backup', icon: ShieldCheck, component: <ServerBackupApp />, initialWidth: 1200, initialHeight: 780 },
    { id: 'server-monitor', title: 'Server Monitor', icon: Activity, component: <ServerMonitorApp />, initialWidth: 1300, initialHeight: 800 },
    { id: 'ai-agents', title: 'AI Agents', icon: Bot, component: <AIAgentsApp />, initialWidth: 1100, initialHeight: 760 },
    { id: 'firewall-blocklist', title: 'Firewall Blocklist', icon: BrickWallShield, component: <FirewallBlocklistApp />, initialWidth: 1180, initialHeight: 780 },
    { id: 'activity', title: 'Activity', icon: History, component: <ActivityApp />, initialWidth: 900, initialHeight: 640 },
    { id: 'settings', title: t('apps.settings'), icon: Settings, component: <SettingsApp />, initialWidth: 700, initialHeight: 500 },
    { id: 'notepad', title: t('apps.notepad'), icon: StickyNote, component: <NotepadApp />, initialWidth: 800, initialHeight: 600 },
    { id: 'wiki', title: t('apps.resourceHub'), icon: Book, component: <WikiApp />, initialWidth: 1100, initialHeight: 700 },
  ];

  const isVertical = taskbarPosition === 'left' || taskbarPosition === 'right';
  const isHorizontal = taskbarPosition === 'top' || taskbarPosition === 'bottom';
  
  const taskbarClasses = `
    taskbar fixed z-[10000] transition-all duration-300 bg-transparent
    ${taskbarPosition === 'bottom' ? 'bottom-0 left-0 w-full h-[var(--taskbar-size,56px)]' : ''}
    ${taskbarPosition === 'top' ? 'top-0 left-0 w-full h-[var(--taskbar-size,56px)]' : ''}
    ${taskbarPosition === 'left' ? 'top-0 left-0 h-full w-16' : ''}
    ${taskbarPosition === 'right' ? 'top-0 right-0 h-full w-16' : ''}
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
          justifyContent: 'center',
          padding: 0,
          cursor: 'default'
        }}
      >
        <div
          className={`flex ${isVertical ? 'flex-col py-3 px-1 w-full h-full' : 'flex-row px-3 py-2 w-full h-full'} items-center gap-2 rounded-none border-0 bg-[var(--bg-secondary)] shadow-2xl backdrop-blur-xl ${
            isVertical 
              ? (taskbarPosition === 'left' ? 'border-r border-[var(--border-color)]' : 'border-l border-[var(--border-color)]')
              : (taskbarPosition === 'top' ? 'border-b border-[var(--border-color)]' : 'border-t border-[var(--border-color)]')
          }`}
          style={{
            background: glassmorphism ? 'var(--taskbar-bg)' : 'var(--bg-primary)',
            backdropFilter: glassmorphism ? 'blur(var(--glass-blur, 18px))' : 'none',
            boxShadow: '0 0 30px var(--shadow-strong)'
          }}
        >
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center gap-2 relative`} ref={startMenuRef}>
          <button 
            onClick={() => {
              setStartMenuOpen(!startMenuOpen);
              if (startMenuOpen) setShowAllApps(false);
              setContextMenu(null);
            }}
            className={`${isVertical ? 'w-10 h-10' : 'w-10 h-10'} rounded-2xl transition-all flex items-center justify-center shadow-lg shrink-0 border border-[var(--accent-indigo)]/30 ${
              startMenuOpen ? 'bg-[var(--bg-selected)] scale-95' : 'bg-[var(--bg-selected)] hover:opacity-90 active:scale-90 shadow-[var(--glow-indigo)]/50'
            }`}
          >
            <LayoutGrid size={20} className="text-[var(--text-selected)]" />
          </button>

          <AnimatePresence>
            {startMenuOpen && (
              <motion.div
                {...menuAnim}
                className="w-[90vw] max-w-[320px] sm:w-80 rounded-2xl overflow-hidden border border-[var(--border-color)] shadow-2xl"
                style={{
                  ...getStartMenuStyle(),
                  background: glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)',
                  backdropFilter: 'blur(var(--glass-blur, 24px))',
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
                            if (e.target.src.includes('ui-avatars.com')) {
                              e.target.onerror = null;
                              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236366f1'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                            } else {
                              e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`;
                            }
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
                        sessionStorage.removeItem('_vault_uri');
                        sessionStorage.removeItem('_vault_tunnel');
                        await signOut({ redirect: false });
                      }
                      window.location.href = '/'; 
                    }}
                    className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    title={session ? "Sign Out" : "Quit to Reveal Screen"}
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
                    className="w-full flex items-center gap-2 bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)] rounded-lg py-2.5 px-3 text-xs text-[var(--text-muted)] hover:border-[var(--accent-indigo)]/50 hover:bg-[var(--bg-tertiary)]/60 transition-all group"
                  >
                    <Search size={14} className="group-hover:text-[var(--accent-indigo)] transition-colors" />
                    <span className="flex-1 text-left">{t('desktop.taskbar.search')}</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]/60 font-mono">
                      <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] text-[9px]">⌘</kbd>
                      <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] text-[9px]">K</kbd>
                    </span>
                  </button>
                </div>

                {/* App List */}
                <div className="px-2 pb-4 space-y-1">
                  <h3 className="px-3 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('desktop.taskbar.allApps', 'All Apps')}</h3>
                  {(() => {
                    const LIMIT = 4;
                    const visible = showAllApps ? apps : apps.slice(0, LIMIT);
                    const hidden = apps.length - LIMIT;
                    return (
                      <>
                        {visible.map(app => (
                          <div key={app.id} className="flex items-center group/row">
                            <button
                              onClick={() => {
                                openWindow(app.id, app.title, app.component, app.icon, { 
                                  initialWidth: app.initialWidth, 
                                  initialHeight: app.initialHeight 
                                });
                                setStartMenuOpen(false);
                              }}
                              className="flex-1 flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors group"
                            >
                              <div className={`w-8 h-8 rounded-lg ${state.theme === 'retro' || state.theme === 'fallout' || state.theme === 'cyberpunk' ? '' : 'bg-[var(--bg-primary)]'} group-hover:bg-[var(--bg-card-hover)] flex items-center justify-center p-1`}>
                                <AppIcon id={app.id} size={16} theme={state.theme} iconStyle={state.iconStyle} />
                              </div>
                              <div className="text-left">
                                <span className="block text-sm font-medium text-[var(--text-primary)]">{app.title}</span>
                                <span className="block text-[10px] text-[var(--text-secondary)]">{t('desktop.taskbar.systemApp')}</span>
                              </div>
                            </button>
                            {(pinnedApps || []).includes(app.id) ? (
                              <button
                                onClick={() => { unpinApp(app.id); }}
                                className="opacity-0 group-hover/row:opacity-100 mr-2 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--accent-amber)] transition-all"
                                title={t('desktop.taskbar.unpinFromTaskbar', 'Unpin from Taskbar')}
                              >
                                <Columns size={12} />
                              </button>
                            ) : (
                              <button
                                onClick={() => { pinApp(app.id); }}
                                className="opacity-0 group-hover/row:opacity-100 mr-2 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--accent-indigo)] transition-all"
                                title={t('desktop.taskbar.pinToTaskbar', 'Pin to Taskbar')}
                              >
                                <Columns size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                        {!showAllApps && hidden > 0 && (
                          <button
                            onClick={() => setShowAllApps(true)}
                            className="w-full text-left px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors flex items-center gap-2"
                          >
                            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-lg font-bold">…</span>
                            <span>{hidden} more app{hidden > 1 ? 's' : ''}</span>
                          </button>
                        )}
                        {showAllApps && apps.length > LIMIT && (
                          <button
                            onClick={() => setShowAllApps(false)}
                            className="w-full text-left px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors flex items-center gap-2"
                          >
                            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-base font-bold">↑</span>
                            <span>Show less</span>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={isVertical ? 'h-px w-8 bg-[var(--border-color)] my-1' : 'w-px h-8 bg-[var(--border-color)] mx-2'} />
        </div>

        {/* Preview Window Button - hide on mobile */}
        {isHorizontal && !isMobile && (
          <button
            onClick={() => setShowPreview(true)}
            className="w-10 h-10 rounded-2xl transition-all flex items-center justify-center shadow-lg shrink-0 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] group"
            title="Preview Window (Ctrl+Cmd+↑ or three-finger swipe up)"
          >
            <Grid3x3 size={18} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
          </button>
        )}

        {/* Dock: Pinned + Running Apps */}
        <div className={`flex-1 flex ${isVertical ? 'flex-col overflow-y-auto no-scrollbar py-1' : 'flex-row items-center overflow-x-auto no-scrollbar px-2'} gap-1.5 relative ${isVertical ? 'items-center' : ''}`}>
          {/* Pinned app icons (always visible) */}
          {(pinnedApps || []).map(appId => {
            const appDef = apps.find(a => a.id === appId);
            if (!appDef) return null;
            const currentWins = (windowsByDesktop[currentDesktopId] || windows);
            const runningWin = currentWins.find(w => w.id === appId || w.id.startsWith(appId + '-') || w.id.split('-')[0] === appId);
            const isActive = runningWin && activeWindowId === runningWin.id && !runningWin.isMinimized;
            const isRunning = !!runningWin;
            const isMinimized = runningWin?.isMinimized;
            return (
              <button
                key={`pinned-${appId}`}
                onClick={() => {
                  if (contextMenu) setContextMenu(null);
                  if (runningWin) {
                    runningWin.isMinimized ? toggleMinimize(runningWin.id) : focusWindow(runningWin.id);
                  } else {
                    openWindow(appDef.id, appDef.title, appDef.component, appDef.icon, {
                      initialWidth: appDef.initialWidth,
                      initialHeight: appDef.initialHeight,
                    });
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, runningWin ? runningWin.id : null, appId)}
                title={appDef.title}
                className={`
                  ${isHorizontal ? 'w-11 h-11 rounded-2xl justify-center' : 'rounded-xl'} flex items-center gap-2 transition-all relative group shrink-0
                  ${isVertical ? 'w-10 h-10 justify-center mx-auto' : ''}
                  ${isActive
                    ? 'bg-[var(--accent-indigo)]/20 border border-[var(--accent-indigo)]/50 shadow-[0_0_8px_var(--accent-indigo)]/30'
                    : isRunning && !isMinimized
                      ? 'bg-[var(--bg-card-hover)] border border-[var(--border-hover)]'
                      : isMinimized
                        ? 'bg-[var(--bg-card)] border border-[var(--border-color)] opacity-60'
                        : 'bg-transparent border border-transparent hover:bg-[var(--bg-card)] hover:border-[var(--border-color)]'
                  }
                `}
              >
                <AppIcon id={appId} size={20} theme={state.theme} iconStyle={state.iconStyle} className={!isRunning ? 'opacity-60 group-hover:opacity-90 transition-opacity' : ''} />

                {/* Bottom bar indicators */}
                <AnimatePresence mode="popLayout">
                  {isActive && (
                    <motion.span
                      key={`indicator-${appId}`}
                      layoutId="taskbar-active-pinned"
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className={`absolute bg-[var(--accent-indigo)] rounded-full shadow-[0_0_10px_var(--accent-indigo)] ${
                        isVertical
                          ? (taskbarPosition === 'left' ? 'right-0 top-2 bottom-2 w-1' : 'left-0 top-2 bottom-2 w-1')
                          : 'bottom-0.5 w-5 h-1 left-1/2 -translate-x-1/2'
                      }`}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                {isRunning && !isActive && (
                  <span className={`absolute bg-[var(--accent-indigo)] rounded-full transition-opacity ${
                    isVertical
                      ? (taskbarPosition === 'left' ? 'right-0.5 top-1/2 -translate-y-1/2 h-2 w-0.5' : 'left-0.5 top-1/2 -translate-y-1/2 h-2 w-0.5')
                      : 'bottom-0.5 w-1.5 h-1.5 left-1/2 -translate-x-1/2'
                  } ${isMinimized ? 'opacity-30' : 'opacity-50'}`} />
                )}
              </button>
            );
          })}

          {/* Separator between pinned and unpinned running apps */}
          {(pinnedApps || []).length > 0 && (windowsByDesktop[currentDesktopId] || windows).some(win => {
            const baseId = win.id.split('-')[0];
            return !(pinnedApps || []).includes(win.id) && !(pinnedApps || []).includes(baseId);
          }) && (
            <div className={isVertical ? 'h-px w-8 bg-[var(--border-color)] my-1 shrink-0' : 'w-px h-7 bg-[var(--border-color)] mx-0.5 shrink-0'} />
          )}

          {/* Running windows that are NOT pinned */}
          {(windowsByDesktop[currentDesktopId] || windows)
            .filter((win, idx, arr) => arr.findIndex(w => w.id === win.id) === idx)
            .filter(win => {
              const baseId = win.id.split('-')[0];
              return !(pinnedApps || []).includes(win.id) && !(pinnedApps || []).includes(baseId);
            })
            .map(win => {
              const isActive = activeWindowId === win.id && !win.isMinimized;
              const isMinimized = win.isMinimized;
              return (
                <button
                  key={win.id}
                  onClick={() => {
                    if (contextMenu) setContextMenu(null);
                    win.isMinimized ? toggleMinimize(win.id) : focusWindow(win.id);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, win.id, null)}
                  title={win.title}
                  className={`
                    ${isHorizontal ? 'h-11 rounded-2xl justify-center px-3 max-w-[120px] min-w-[44px]' : 'rounded-xl'} flex items-center gap-2 transition-all relative group shrink-0
                    ${isVertical ? 'w-10 h-10 justify-center mx-auto' : ''}
                    ${isActive
                      ? 'bg-[var(--accent-emerald)]/20 border border-[var(--accent-emerald)]/50'
                      : isMinimized
                        ? 'bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)] opacity-60 hover:opacity-80 hover:bg-[var(--bg-tertiary)]'
                        : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)]'
                    }
                  `}
                >
                  <AppIcon id={win.id.split('-')[0]} size={18} theme={state.theme} iconStyle={state.iconStyle} />
                  {/* Show title label on horizontal taskbar for running (non-pinned) apps */}
                  {isHorizontal && (
                    <span className={`text-[11px] font-medium truncate max-w-[72px] hidden sm:inline-block transition-colors ${isActive ? 'text-[var(--accent-emerald)]' : 'text-[var(--text-secondary)]'}`}>
                      {win.title}
                    </span>
                  )}
                  {/* Bottom indicator - emerald for unpinned running apps */}
                  <AnimatePresence mode="popLayout">
                    {isActive && (
                      <motion.span
                        key={`indicator-${win.id}`}
                        layoutId="taskbar-active-running"
                        layout
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className={`absolute bg-[var(--accent-emerald)] rounded-full shadow-[0_0_10px_var(--accent-emerald)] ${
                          isVertical
                            ? (taskbarPosition === 'left' ? 'right-0 top-2 bottom-2 w-1' : 'left-0 top-2 bottom-2 w-1')
                            : 'bottom-0.5 w-5 h-1 left-1/2 -translate-x-1/2'
                        }`}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                  </AnimatePresence>
                  {!isActive && (
                    <span className={`absolute bg-[var(--accent-emerald)] rounded-full transition-opacity ${
                      isVertical
                        ? (taskbarPosition === 'left' ? 'right-0.5 top-1/2 -translate-y-1/2 h-2 w-0.5' : 'left-0.5 top-1/2 -translate-y-1/2 h-2 w-0.5')
                        : 'bottom-0.5 w-1.5 h-1.5 left-1/2 -translate-x-1/2'
                    } ${isMinimized ? 'opacity-30' : 'opacity-60'}`} />
                  )}
                </button>
              );
            })}
        </div>

        <div className={`flex items-center shrink-0 ${isVertical ? 'flex-col gap-3 py-3' : 'flex-row gap-2 sm:gap-3 ml-2 sm:ml-4'}`}>
          {/* Desktop Switcher - hidden on mobile */}
          {isHorizontal && !isMobile && (
            <div className="hidden sm:flex items-center gap-1 bg-[var(--bg-tertiary)] rounded-full border border-[var(--border-color)] px-2 py-1">
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

          {isHorizontal && <div className="hidden md:block"><AiUsageBar compact={true} /></div>}

          <div className="hidden sm:block"><LanguageSwitcher vertical={isVertical} taskbarPosition={taskbarPosition} /></div>
          <div className={`hidden sm:flex items-center gap-2 ${isVertical ? 'flex-col py-2.5 px-2' : 'px-3 py-1'} bg-[var(--bg-tertiary)] rounded-full border border-[var(--border-color)]`}>
            <Wifi size={14} className="text-[var(--accent-emerald)]" />
            <Volume2 size={14} className="text-[var(--text-muted)]" />
          </div>
          {isHorizontal && <div className="hidden sm:block w-px h-6 bg-[var(--border-color)]" />}
          <SystemClock vertical={isVertical} />
        </div>
        </div>
      </div>

      {mounted && createPortal(
        <PreviewWindow isOpen={showPreview} onClose={() => setShowPreview(false)} />,
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
                backdropFilter: 'blur(var(--glass-blur, 24px))',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-color)] mb-1 truncate">
                {windows.find(w => w.id === contextMenu.windowId)?.title || (contextMenu.pinnedAppId && apps.find(a => a.id === contextMenu.pinnedAppId)?.title) || t('common.application')}
              </div>
              {contextMenu.windowId && (
                <>
                  <button
                    onClick={() => { focusWindow(contextMenu.windowId); setContextMenu(null); }}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                  >
                    <Monitor size={13} className="text-[var(--accent-indigo)]" />
                    {t('desktop.taskbar.bringToFront')}
                  </button>
                  <button
                    onClick={() => { toggleMinimize(contextMenu.windowId); setContextMenu(null); }}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                  >
                    <Layers size={13} className="text-[var(--accent-amber)]" />
                    {windows.find(w => w.id === contextMenu.windowId)?.isMinimized ? t('common.restore') : t('common.minimize')}
                  </button>
                </>
              )}
              {contextMenu.pinnedAppId && (
                <>
                  <div className="h-px bg-[var(--border-color)] my-1 mx-2" />
                  {(pinnedApps || []).includes(contextMenu.pinnedAppId) ? (
                    <button
                      onClick={() => { unpinApp(contextMenu.pinnedAppId); setContextMenu(null); }}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <Columns size={13} className="text-[var(--accent-amber)]" />
                      {t('desktop.taskbar.unpinFromTaskbar', 'Unpin from Taskbar')}
                    </button>
                  ) : (
                    <button
                      onClick={() => { pinApp(contextMenu.pinnedAppId); setContextMenu(null); }}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <Columns size={13} className="text-[var(--accent-indigo)]" />
                      {t('desktop.taskbar.pinToTaskbar', 'Pin to Taskbar')}
                    </button>
                  )}
                </>
              )}
              {contextMenu.windowId && (
                <>
                  <div className="h-px bg-[var(--border-color)] my-1 mx-2" />
                  <button
                    onClick={() => {
                      closeWindow(contextMenu.windowId);
                      setContextMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors hover:text-red-400"
                  >
                    <X size={13} className="text-[var(--accent-rose)]" />
                    {t('common.close')} 
                  </button>
                </>
              )}
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
                backdropFilter: 'blur(var(--glass-blur, 24px))',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Quick Launch Section */}
              <div className="p-1.5">
                <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  {t('desktop.taskbar.quickLaunch')}
                </div>
                <button
                  onClick={() => { 
                    setTaskbarContextMenu(null);
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--glow-indigo)] rounded-lg flex items-center gap-2 transition-colors group"
                >
                  <Search size={13} className="text-[var(--accent-indigo)]" />
                  <span className="flex-1">{t('common.search')}</span>
                  <span className="text-[9px] text-[var(--text-muted)] font-mono">⌘K</span>
                </button>
                <button
                  onClick={() => { openWindow('terminal', t('apps.terminal'), <TerminalApp />, Terminal); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--glow-emerald)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Terminal size={13} className="text-[var(--accent-emerald)]" />
                  {t('apps.terminal')}
                </button>
                <button
                  onClick={() => { openWindow('files-app', t('apps.files'), <FilesApp />, FolderClosed); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--glow-indigo)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <FolderClosed size={13} className="text-[var(--accent-indigo)]" />
                  {t('apps.files')}
                </button>
                <button
                  onClick={() => { openWindow('notepad', t('apps.notepad'), <NotepadApp />, StickyNote); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--glow-amber,rgba(245,158,11,0.1))] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <StickyNote size={13} className="text-[var(--accent-amber)]" />
                  {t('apps.notepad')}
                </button>
              </div>

              <div className="h-px bg-[var(--border-color)] mx-3" />

              {/* Window Management */}
              <div className="p-1.5">
                <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  {t('desktop.taskbar.showDesktop')}
                </div>
                <button
                  onClick={() => { minimizeAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Monitor size={13} className="text-[var(--accent-indigo)]" />
                  {t('desktop.taskbar.showDesktop')}
                </button>
                <button
                  onClick={() => { restoreAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
                >
                  <LayoutGrid size={13} className="text-[var(--accent-emerald)]" />
                  {t('desktop.taskbar.restoreAll')}
                </button>
                {windows.length > 0 && (
                  <button
                    onClick={() => { windows.forEach(w => closeWindow(w.id)); setTaskbarContextMenu(null); }}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition-colors hover:text-red-400"
                  >
                    <X size={13} className="text-[var(--accent-rose)]" />
                    {t('desktop.taskbar.closeAll')}
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
                      {t('desktop.taskbar.running')} ({windows.length})
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
                    openWindow('settings', t('apps.settings'), <SettingsApp initialTab="appearance" />, Settings, { initialWidth: 900, initialHeight: 700 }); 
                    updateWindowProps('settings', { activeTab: 'appearance' });
                    setTaskbarContextMenu(null); 
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-[var(--accent-indigo)] font-bold hover:bg-[var(--glow-indigo)] rounded-lg flex items-center gap-2 transition-all group"
                >
                  <Settings size={14} className="group-hover:rotate-45 transition-transform duration-500" />
                  {t('desktop.taskbar.settings')}
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
            className="w-32 border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden overflow-y-auto max-h-60 custom-scrollbar z-[10002]"
            style={{
              ...getPopupStyle(),
              background: 'var(--window-bg)',
              backdropFilter: 'blur(var(--glass-blur, 24px))'
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
                {state.language === lang.code && <div className="w-1 h-1 rounded-full bg-[var(--accent-indigo)]" />}
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
