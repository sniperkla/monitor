'use client';

import { useOS } from '@/context/OSContext';
import DesktopIcon from '@/components/Desktop/DesktopIcon';
import Window from '@/components/Desktop/Window';
import Taskbar from '@/components/Desktop/Taskbar';
import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import { Terminal, Settings, FolderClosed, Monitor, RefreshCw, Plus, 
  Image as ImageIcon, Layout, Grid, List, AlignLeft, SortAsc, Server,
  ChevronRight, Type, Calendar, HardDrive, Palette, MonitorCog, Globe, Maximize, Minimize, Database, Check, MonitorPlay
} from 'lucide-react';
import NotificationCenter from '@/components/Desktop/NotificationCenter';
import { useState, useEffect, useRef, cloneElement, isValidElement } from 'react';
import ConnectionModal from '@/components/ConnectionModal';
import DesktopModal from '@/components/Desktop/DesktopModal';
import { useApp } from '@/context/AppContext';
import TerminalApp from '@/apps/TerminalApp';
import FilesApp from '@/apps/FilesApp';
import FileManager from '@/components/FileManager';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import WikiChatWindow from './WikiChatWindow';
import PWAHandler from './PWAHandler';
import SpotlightSearch from './SpotlightSearch';
import PreviewWindow from './PreviewWindow';
import TmuxApp from '@/apps/TmuxApp';
import DockerApp from '@/apps/DockerApp';
import dynamic from 'next/dynamic';

const DatabaseBrowser = dynamic(() => import('@/components/DatabaseBrowser'), {
  ssr: false,
});

export default function DesktopEnvironment() {
  const { t } = useTranslation();
  const { state: osState, openWindow, setGlassmorphism, setIconSize, setSortBy, setWallpaper, updateIconPosition, setLanguage, setSelectedIcons, updateMultipleIconPositions, toggleMinimize, switchToPrevDesktop, switchToNextDesktop } = useOS();
  const { windows, iconSize, sortBy, currentDesktopId, windowsByDesktop, keyboardShortcuts } = osState;
  const { state: appState, dispatch: appDispatch, fetchConnections } = useApp();
  
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const [showNewConnModal, setShowNewConnModal] = useState(false);
  const [editConnection, setEditConnection] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [booting, setBooting] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dropMenu, setDropMenu] = useState(null); // { x, y, connection }
  const [selection, setSelection] = useState({ active: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [hideDesktopContent, setHideDesktopContent] = useState(false);

  const openWindowRef = useRef(openWindow);
  useEffect(() => { openWindowRef.current = openWindow; });

  useEffect(() => {
    const handleOpenSettingsTab = (e) => {
      const tab = e.detail || 'database';
      openWindowRef.current('settings', t('apps.settings'), <SettingsApp initialTab={tab} />, Settings, { initialWidth: 900, initialHeight: 700 });
    };
    window.addEventListener('open-settings-tab', handleOpenSettingsTab);
    return () => window.removeEventListener('open-settings-tab', handleOpenSettingsTab);
  }, []);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setBooting(false), 2000);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Three-finger swipe and keyboard shortcuts
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let lastSwipeUpTime = 0;

    const handleTouchStart = (e) => {
      if (e.touches.length === 3) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    };

    const handleTouchEnd = (e) => {
      if (e.changedTouches.length === 3 && touchStartTime) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchStartY - touchEndY;
        const deltaTime = Date.now() - touchStartTime;
        const currentTime = Date.now();

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];

        // Swipe up: ONLY open preview (no desktop switching as side-effect)
        if (!showPreview && deltaY > 80 && absY > absX * 2.2 && deltaTime < 500) {
          setShowPreview(true);

          if (currentDesktopWindows.length === 0) {
            setHideDesktopContent(true);
          } else {
            setHideDesktopContent(false);
            currentDesktopWindows.forEach((win) => {
              if (!win.isMinimized) toggleMinimize(win.id);
            });
          }

          lastSwipeUpTime = currentTime;
        }
        // Swipe down: close preview
        else if (showPreview && deltaY < -80 && absY > absX * 2.2 && deltaTime < 500) {
          setShowPreview(false);
          setHideDesktopContent(false);
        }
        // Swipe left/right for desktop switching
        else if (!showPreview && absX > 100 && absX > absY * 1.8 && deltaTime < 500) {
          if (deltaX > 0) {
            switchToPrevDesktop(); // Swipe right: previous desktop
          } else {
            switchToNextDesktop(); // Swipe left: next desktop
          }
        }
        touchStartTime = 0;
      }
    };

    const handleKeyDown = (e) => {
      // Check for terminal or input focus to prevent conflicts
      const activeElement = document.activeElement;
      const isTerminal = activeElement?.classList.contains('xterm-helper-textarea') || 
                         activeElement?.closest('.xterm');
      const isInput = activeElement?.tagName === 'INPUT' || 
                      activeElement?.tagName === 'TEXTAREA' || 
                      activeElement?.isContentEditable;

      if (isTerminal || isInput) {
        // If it's an Escape key and we're showing preview, we still want to close it
        if (e.key === 'Escape' && showPreview) {
           // allow it to fall through
        } else {
           return;
        }
      }

      const shortcuts = keyboardShortcuts || {
        previewWindow: 'Ctrl+Cmd+Up',
      };

      const isShortcut = (shortcut, pressedKey, ctrlKey, metaKey) => {
        if (!shortcut) return false;
        const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
        const hasCtrl = parts.includes('ctrl') && ctrlKey;
        const hasCmd = parts.includes('cmd') && metaKey;

        const k = (pressedKey || '').toLowerCase();
        const keyToken = k.startsWith('arrow') ? k.replace('arrow', '') : k;

        const hasKey = parts.includes(keyToken) || parts.includes(k);
        return hasCtrl && hasCmd && hasKey;
      };

      // Toggle preview window
      if (isShortcut(shortcuts.previewWindow, e.key, e.ctrlKey, e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();

        if (showPreview) {
          setShowPreview(false);
          return;
        }

        const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];
        setShowPreview(true);

        if (currentDesktopWindows.length === 0) {
          setHideDesktopContent(true);
        } else {
          setHideDesktopContent(false);
          currentDesktopWindows.forEach((win) => {
            if (!win.isMinimized) toggleMinimize(win.id);
          });
        }
      }

      // Escape to close preview window
      if (e.key === 'Escape' && showPreview) {
        setShowPreview(false);
        setHideDesktopContent(false);
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPreview, currentDesktopId, windowsByDesktop, keyboardShortcuts, toggleMinimize, switchToPrevDesktop, switchToNextDesktop]);

  const prevShowPreview = useRef(showPreview);
  useEffect(() => {
    if (!showPreview && prevShowPreview.current) {
      setHideDesktopContent(false);
      
      // When Mission Control closes, ensure windows on the current desktop are restored
      const currentDesktopWindows = windowsByDesktop[currentDesktopId] || [];
      currentDesktopWindows.forEach(win => {
        if (win.isMinimized) {
          // toggleMinimize on a minimized window will restore/focus it
          toggleMinimize(win.id);
        }
      });
    }
    prevShowPreview.current = showPreview;
  }, [showPreview, currentDesktopId, toggleMinimize]); // Removed windowsByDesktop from deps



  // Initialize Icon Positions to prevent jump glitches
  useEffect(() => {
    if (!mounted) return;
    const updates = {};
    let hasUpdates = false;
    
    DESKTOP_ICONS.forEach((icon, idx) => {
      // If position is missing in state, register default
      if (!osState.iconPositions[icon.id]) {
        updates[icon.id] = { x: 20, y: 20 + idx * 110 };
        hasUpdates = true;
      }
    });

    if (hasUpdates) {
      updateMultipleIconPositions(updates);
    }
  }, [mounted]);

  const handleEditConnection = (conn) => {
    setEditConnection(conn);
    setShowNewConnModal(true);
  };

  const DESKTOP_ICONS = [
    { id: 'ssh-manager', title: t('apps.sshManager'), icon: Monitor, component: <SSHApp />, type: 'app', initialWidth: 1400, initialHeight: 820 },
    { id: 'terminal', title: t('apps.terminal'), icon: Terminal, component: <TerminalApp onEditConnection={handleEditConnection} />, type: 'app', initialWidth: 1100, initialHeight: 700 },
    { id: 'files', title: t('apps.files'), icon: FolderClosed, component: <FilesApp onEditConnection={handleEditConnection} />, type: 'app', initialWidth: 900, initialHeight: 600 },
    { id: 'docker', title: 'Docker', icon: Server, component: <DockerApp />, type: 'app', initialWidth: 1000, initialHeight: 700 },
    { id: 'tmux', title: t('apps.tmux'), icon: MonitorPlay, component: <TmuxApp />, type: 'app', initialWidth: 1000, initialHeight: 650 },
    { id: 'settings', title: t('apps.settings'), icon: Settings, component: <SettingsApp />, type: 'app', initialWidth: 700, initialHeight: 500 },
  ];

  /* Sorting Logic with Auto-Enforcement */
  const applySort = (method = osState.sortBy) => {
    if (!method || method === 'none' || method === 'custom') return;

    const sorted = [...DESKTOP_ICONS].sort((a, b) => {
      if (method === 'name') return a.title.localeCompare(b.title);
      if (method === 'type') return a.type.localeCompare(b.type);
      return 0;
    });

    const GRID_X = 100;
    const GRID_Y = 110;
    const PADDING = 20;
    const taskbarHeight = 56;
    const taskbarPos = osState.taskbarPosition || 'bottom';
    
    let startX = PADDING;
    let startY = PADDING;
    
    if (taskbarPos === 'top') startY += taskbarHeight;
    if (taskbarPos === 'left') startX += taskbarHeight;

    const maxHeight = window.innerHeight - (taskbarPos === 'bottom' ? taskbarHeight + PADDING : PADDING);
    
    let currentX = startX;
    let currentY = startY;

    sorted.forEach((icon) => {
      updateIconPosition(icon.id, currentX, currentY);
      
      currentY += GRID_Y;
      if (currentY + GRID_Y > maxHeight) {
        currentY = startY;
        currentX += GRID_X;
      }
    });

    // Reset refresh key to force re-render components if needed
    setRefreshKey(prev => prev + 1);
  };

  // Enforce sort when state changes (Hard Sort)
  useEffect(() => {
    if (osState.sortBy && osState.sortBy !== 'none') {
      applySort(osState.sortBy);
    }
  }, [osState.sortBy]);

  const handleContextMenu = (e) => {
    const clickedInsideWindow = e.target.closest('.window-container');
    const clickedInsideTaskbar = e.target.closest('.taskbar');
    const clickedInsideIcon = e.target.closest('.desktop-icon');
    
    // Allow native context menu (Copy/Paste) inside windows
    if (clickedInsideWindow || clickedInsideTaskbar || clickedInsideIcon) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setActiveSubmenu(null);
    
    let x = e.clientX;
    let y = e.clientY;
    
    const menuWidth = 256; 
    const menuHeight = 400;
    const taskbarH = 56;
    
    // Bounds check
    const rightBound = taskbarPos === 'right' ? window.innerWidth - taskbarH : window.innerWidth;
    const bottomBound = taskbarPos === 'bottom' ? window.innerHeight - taskbarH : window.innerHeight;
    const leftBound = taskbarPos === 'left' ? taskbarH : 0;
    const topBound = taskbarPos === 'top' ? taskbarH : 0;
    
    if (x + menuWidth > rightBound) x -= menuWidth;
    if (x < leftBound) x = leftBound + 4;
    
    if (y + menuHeight > bottomBound) y -= menuHeight;
    if (y < topBound) y = topBound + 4;
    
    setContextMenu({ x, y });
  };

  const closeContext = () => { setContextMenu(null); setActiveSubmenu(null); };

  useEffect(() => {
    const handleGlobalClick = () => { 
      closeContext(); 
      setDropMenu(null); 
    };
    window.addEventListener('click', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  // Handle connection drop on desktop
  const handleDesktopDragOver = (e) => {
    if (e.dataTransfer.types.includes('application/ssh-connection')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDesktopDrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/ssh-connection');
    if (!data) return;
    try {
      const conn = JSON.parse(data);
      const sourceAppType = e.dataTransfer.getData('application/source-app-type');

      // If dragged from a TerminalApp tab, close that source tab first
      const sourceStandaloneTermId = e.dataTransfer.getData('application/standalone-term-id');
      if (sourceStandaloneTermId) {
        appDispatch({ type: 'CLOSE_STANDALONE_TERMINAL', payload: sourceStandaloneTermId });
      }

      // If dragged from a FilesApp tab, close that source tab first
      const sourceFilesTabId = e.dataTransfer.getData('application/standalone-files-id');
      if (sourceFilesTabId) {
        window.dispatchEvent(new CustomEvent('close-files-tab', { detail: { tabId: sourceFilesTabId } }));
      }

      // For databases, open immediately
      if (conn.type === 'database') {
        openStandaloneDatabase(conn);
        return;
      }

      // If dragged from TerminalApp → open as terminal directly (no menu)
      if (sourceAppType === 'terminal') {
        openStandaloneTerminal(conn);
        return;
      }

      // If dragged from FilesApp → open as file manager directly (no menu)
      if (sourceAppType === 'files') {
        openStandaloneFiles(conn);
        return;
      }

      // Otherwise (sidebar drag) → show the choice menu
      setDropMenu({ x: e.clientX, y: e.clientY, connection: conn });
    } catch (err) {
      console.error('Drop parse error:', err);
    }
  };

  useEffect(() => {
    const handleIconDrop = (e) => {
      const { targetAppId, connection } = e.detail;
      if (targetAppId === 'terminal') {
        openStandaloneTerminal(connection);
      } else if (targetAppId === 'files') {
        openStandaloneFiles(connection);
      } else if (targetAppId === 'ssh-manager') {
        // Default to terminal for SSH manager drop if it's a drag-action
        openStandaloneTerminal(connection);
      }
    };
    window.addEventListener('desktop-icon-drop', handleIconDrop);
    return () => window.removeEventListener('desktop-icon-drop', handleIconDrop);
  }, []);

    useEffect(() => {
      const handleOpenDocker = (e) => {
          const conn = e.detail?.connection;
          if (conn) openStandaloneDocker(conn);
      };

      const handleOpenTerminal = (e) => {
        const { connection, initialCommand, title } = e.detail;
        if (connection) openStandaloneTerminal(connection, null, initialCommand, title);
      };

      const handleOpenFiles = (e) => {
        const { connection, connectionIdOverride, title } = e.detail;
        if (connection) openStandaloneFiles(connection, connectionIdOverride, title);
      };

      window.addEventListener('open-docker-manager', handleOpenDocker);
      window.addEventListener('open-terminal', handleOpenTerminal);
      window.addEventListener('open-files', handleOpenFiles);
      window.addEventListener('pop-out-terminal', handleOpenTerminal); // Compatibility

      return () => {
        window.removeEventListener('open-docker-manager', handleOpenDocker);
        window.removeEventListener('open-terminal', handleOpenTerminal);
        window.removeEventListener('open-files', handleOpenFiles);
        window.removeEventListener('pop-out-terminal', handleOpenTerminal);
      };
    }, []);

  const openStandaloneTerminal = (conn, sourceStandaloneTermId = null, initialCommand = null, titleOverride = null) => {
    // Use unique ID so multiple standalone windows can coexist for same connection
    const winId = `standalone-term-${conn._id}-${Date.now()}`;
    
    // Close existing session in the manager if it exists (not standalone)
    const existing = appState.activeTerminals.find(t => t.connectionId === conn._id);
    if (existing) {
      appDispatch({ type: 'CLOSE_TERMINAL', payload: existing.id });
    }

    openWindow(
      winId,
      titleOverride || conn.name,
      <TerminalApp onEditConnection={handleEditConnection} initialConnection={conn} initialCommand={initialCommand} />,
      Terminal,
      { initialWidth: 900, initialHeight: 600, appType: 'terminal', props: { initialConnectionId: conn._id, initialCommand } }
    );
    setDropMenu(null);
  };

  const openStandaloneFiles = (conn, connectionIdOverride = null, titleOverride = null) => {
    // Use unique ID so multiple standalone windows can coexist for same connection
    const winId = `standalone-files-${connectionIdOverride || conn._id}-${Date.now()}`;

    // Close existing session in the manager if it exists
    const existing = appState.activeFileManagers.find(f => f.connectionId === (connectionIdOverride || conn._id));
    if (existing) {
      appDispatch({ type: 'CLOSE_FILE_MANAGER', payload: existing.id });
    }

    openWindow(
      winId,
      titleOverride || `Files: ${conn.name}`,
      <FilesApp onEditConnection={handleEditConnection} initialConnection={conn} initialConnectionId={connectionIdOverride} />,
      FolderClosed,
      { initialWidth: 900, initialHeight: 600, appType: 'files-app', props: { initialConnectionId: connectionIdOverride || conn._id } }
    );
    setDropMenu(null);
  };

  const openStandaloneDocker = (conn) => {
    const winId = `standalone-docker-${conn._id}-${Date.now()}`;
    openWindow(
      winId,
      `Docker: ${conn.name}`,
      <DockerApp initialConnection={conn} />,
      Server,
      { initialWidth: 1000, initialHeight: 700, appType: 'docker-app', props: { initialConnectionId: conn._id } }
    );
    setDropMenu(null);
  };

  const handleNewConnection = () => {
    setEditConnection(null);
    setShowNewConnModal(true);
  };

  const openStandaloneDatabase = (conn) => {
    const winId = `standalone-db-${conn._id}`;

    // Close existing session in the manager if it exists
    const existing = appState.activeDatabaseBrowsers.find(b => b.connectionId === conn._id);
    if (existing) {
      appDispatch({ type: 'CLOSE_DATABASE_BROWSER', payload: existing.id });
    }

    openWindow(
      winId,
      `DB: ${conn.name}`,
      <div className="h-full w-full bg-[var(--bg-primary)] p-4">
        <DatabaseBrowser 
          initialConnection={conn} 
          onEditConnection={handleEditConnection} 
          onNewConnection={handleNewConnection}
        />
      </div>,
      Database,
      { 
        initialWidth: 1000, 
        initialHeight: 700, 
        appType: 'database-browser', 
        props: { initialConnection: conn } 
      }
    );
    setDropMenu(null);
  };

  const handleMouseDown = (e) => {
    // Only trigger if clicking directly on the desktop or desktop layer
    if (e.target.classList.contains('desktop-layer') || e.target.classList.contains('desktop-env')) {
      if (e.button !== 0) return; // Left click only
      setSelection({ active: true, x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
      
      // Clear selection if not holding Shift/Cmd (standard OS behavior)
      if (!e.shiftKey && !e.metaKey) {
        setSelectedIcons([]);
      }
    }
  };

  const handleMouseMove = (e) => {
    if (selection.active) {
      const x1 = selection.x1;
      const y1 = selection.y1;
      const x2 = e.clientX;
      const y2 = e.clientY;
      
      setSelection(prev => ({ ...prev, x2, y2 }));

      // Get offset of desktop layer for correct hit detection
      const taskbarPos = osState.taskbarPosition || 'bottom';
      const offsetX = taskbarPos === 'left' ? 64 : 0;
      const offsetY = taskbarPos === 'top' ? 64 : 0;

      // Selection rectangle in viewport coordinates
      const rect = {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2)
      };

      const selectedIds = [];
      DESKTOP_ICONS.forEach(icon => {
        const pos = osState.iconPositions[icon.id] || { x: 20, y: 20 }; // Match defaultPos fallback
        
        // Icon hitbox in viewport coordinates
        const width = osState.iconSize === 'small' ? 80 : osState.iconSize === 'large' ? 112 : 96;
        const height = osState.iconSize === 'small' ? 80 : osState.iconSize === 'large' ? 112 : 96;
        
        const iconRect = {
          left: pos.x + offsetX,
          top: pos.y + offsetY,
          right: pos.x + offsetX + width,
          bottom: pos.y + offsetY + height + 20
        };

        // Standard overlap check
        if (!(iconRect.left > rect.right || 
              iconRect.right < rect.left || 
              iconRect.top > rect.bottom || 
              iconRect.bottom < rect.top)) {
          selectedIds.push(icon.id);
        }
      });

      setSelectedIcons(selectedIds);
    }
  };

  const handleMouseUp = () => {
    if (selection.active) {
      setSelection(prev => ({ ...prev, active: false }));
    }
  };

  if (!mounted) return null;

  const taskbarPos = osState.taskbarPosition || 'bottom';
  const getDesktopPadding = () => {
    switch (taskbarPos) {
      case 'top': return 'pt-16';
      case 'bottom': return 'pb-16';
      case 'left': return 'pl-16';
      case 'right': return 'pr-16';
      default: return 'pb-16';
    }
  };

  return (
    <div 
      onContextMenu={handleContextMenu}
      onDragOver={handleDesktopDragOver}
      onDrop={handleDesktopDrop}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`h-screen w-screen relative overflow-hidden bg-cover bg-center select-none desktop-env ${!osState.glassmorphism ? 'no-glass' : ''}`}
      style={{
        backgroundImage: `url("${osState.wallpaper}")`,
        fontFamily: "'Inter', sans-serif",
        transition: 'background-image 0.5s ease, filter 0.3s ease',
        filter: `brightness(${osState.brightness}%)`,
        zoom: osState.uiScale ? `${osState.uiScale}%` : '100%',
        padding: 0
      }}>
      
      {/* Desktop Selection Marquee */}
      {selection.active && (
        <div 
          className="fixed z-[9999] border border-blue-400 bg-blue-500/20 backdrop-blur-[1px] pointer-events-none rounded-sm"
          style={{
            left: Math.min(selection.x1, selection.x2),
            top: Math.min(selection.y1, selection.y2),
            width: Math.abs(selection.x2 - selection.x1),
            height: Math.abs(selection.y2 - selection.y1),
          }}
        />
      )}
      
      {/* Boot Splash */}
      <AnimatePresence>
        {booting && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[50000] bg-[var(--bg-primary)] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="relative w-24 h-24 mb-6"
            >
              <div className="absolute inset-0 rounded-3xl bg-indigo-500 blur-2xl opacity-20 animate-pulse" />
              <div className="relative w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl">
                <Monitor size={48} className="text-white" />
              </div>
            </motion.div>
            <motion.div 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center"
            >
              <h1 className="text-[var(--text-primary)] font-bold text-xl tracking-widest uppercase mb-2">Webtop OS</h1>
              <div className="flex gap-1 justify-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                    className="w-1 h-1 bg-indigo-400 rounded-full"
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Icons */}
      <div className={`absolute inset-0 pointer-events-none ${getDesktopPadding()} ${isRefreshing ? 'opacity-0' : 'opacity-100'}`}>
        <div 
          className="desktop-layer relative w-full h-full pointer-events-auto"
          onContextMenu={handleContextMenu}
          onClick={() => {
            // Collapse preview window when clicking on blank desktop area
            if (showPreview) {
              setShowPreview(false);
            }
          }}
        >
          {!hideDesktopContent && DESKTOP_ICONS.map((icon, idx) => (
            <DesktopIcon
              key={`${icon.id}-${refreshKey}`}
              id={icon.id}
              title={icon.title}
              icon={icon.icon}
              component={icon.component}
              initialWidth={icon.initialWidth}
              initialHeight={icon.initialHeight}
              defaultPos={{ x: 20, y: 20 + idx * 110 }}
            />
          ))}
        </div>
      </div>

      {/* Windows Layer */}
      {!hideDesktopContent && (() => {
        const currentWins = windowsByDesktop[currentDesktopId] || windows || [];
        const currentIds = new Set((currentWins || []).map((w) => w.id));
        const allWins = windowsByDesktop
          ? Object.values(windowsByDesktop).flat()
          : (windows || []);
        const deduped = Array.from(
          new Map((allWins || []).map((w) => [w.id, w])).values()
        );

        return deduped.map((win) => {
        let component = win.component;
        
        // Inject shared props (like onEditConnection) for restored windows
        // dependent on appType or ID.
        if (isValidElement(component)) {
          const isTerminal = win.appType === 'terminal' || win.id === 'terminal' || (win.id && win.id.startsWith('term'));
          const isFiles = win.appType === 'files' || win.appType === 'files-app' || win.id === 'files' || (win.id && win.id.startsWith('files'));
          
          if (isTerminal || isFiles) {
            component = cloneElement(component, { 
              onEditConnection: handleEditConnection,
              // Maintain existing props (like initialConnection for standalone)
              ...component.props 
            });
          }
        }

        return (
          <Window
            key={win.id}
            {...win}
            component={component}
            desktopHidden={!currentIds.has(win.id)}
            previewMode={showPreview}
          />
        );
        });
      })()}

      {/* Persistent Wiki Chat Windows */}
      <AnimatePresence>
        {appState.wikiChatWindows?.map(chat => (
          <WikiChatWindow 
            key={chat.id} 
            id={chat.id} 
            guide={chat.guide} 
            onClose={(id) => appDispatch({ type: 'CLOSE_WIKI_CHAT', payload: id })}
          />
        ))}
      </AnimatePresence>

      {/* Taskbar */}
      {!showPreview && <Taskbar />}

      {/* Context Menu */}
      {!showPreview && (
        <AnimatePresence>
          {contextMenu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[20000] w-64 rounded-lg border border-[var(--border-color)] shadow-2xl overflow-visible"
              style={{ 
                top: contextMenu.y, 
                left: contextMenu.x,
                background: osState.glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px var(--shadow-strong), 0 0 0 1px var(--border-color)'
              }}
            >
              <div className="py-1.5">
              {/* View submenu */}
              <ContextSubmenuItem
                icon={Grid}
                label={t('desktop.context.view')}
                active={activeSubmenu === 'view'}
                onHover={() => setActiveSubmenu('view')}
                onLeave={() => {}}
              >
                <ContextRadioItem label={t('desktop.context.icons.large')} checked={iconSize === 'large'} onClick={() => { setIconSize('large'); closeContext(); }} />
                <ContextRadioItem label={t('desktop.context.icons.medium')} checked={iconSize === 'medium'} onClick={() => { setIconSize('medium'); closeContext(); }} />
                <ContextRadioItem label={t('desktop.context.icons.small')} checked={iconSize === 'small'} onClick={() => { setIconSize('small'); closeContext(); }} />
              </ContextSubmenuItem>

              {/* Sort by submenu */}
              <ContextSubmenuItem
                icon={SortAsc}
                label={t('desktop.context.sort')}
                active={activeSubmenu === 'sort'}
                onHover={() => setActiveSubmenu('sort')}
                onLeave={() => {}}
              >
                <ContextRadioItem label={t('desktop.context.sortBy.name')} checked={sortBy === 'name'} onClick={() => { setSortBy('name'); applySort('name'); closeContext(); }} />
                <ContextRadioItem label={t('desktop.context.sortBy.type')} checked={sortBy === 'type'} onClick={() => { setSortBy('type'); applySort('type'); closeContext(); }} />
                <div className="h-px bg-[var(--border-color)] my-1" />
                <ContextRadioItem label={t('desktop.context.sortBy.none')} checked={!sortBy || sortBy === 'none'} onClick={() => { setSortBy('none'); closeContext(); }} />
              </ContextSubmenuItem>

              {/* Language submenu */}
              <ContextSubmenuItem
                icon={Globe}
                label={t('settings_ui.appearance.language')}
                active={activeSubmenu === 'language'}
                onHover={() => setActiveSubmenu('language')}
                onLeave={() => {}}
              >
                <ContextRadioItem label="English (US)" checked={osState.language === 'en'} onClick={() => { setLanguage('en'); closeContext(); }} />
                <ContextRadioItem label="ภาษาไทย (TH)" checked={osState.language === 'th'} onClick={() => { setLanguage('th'); closeContext(); }} />
                <ContextRadioItem label="简体中文 (CN)" checked={osState.language === 'cn'} onClick={() => { setLanguage('cn'); closeContext(); }} />
              </ContextSubmenuItem>

              <ContextItem 
                icon={isFullscreen ? Minimize : Maximize} 
                label={isFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => {
                  if (!isFullscreen) {
                    document.documentElement.requestFullscreen().catch(e => console.error(e));
                  } else {
                    document.exitFullscreen().catch(e => console.error(e));
                  }
                  closeContext();
                }} 
              />

              <div className="h-px bg-[var(--border-color)] my-1.5 mx-2" />

              <ContextItem 
                icon={RefreshCw} 
                label={t('desktop.context.refresh')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={async () => {
                  setIsRefreshing(true);
                  setTimeout(() => setIsRefreshing(false), 80);
                  setRefreshKey(prev => prev + 1);
                  closeContext();
                  await fetchConnections();
                }} 
              />

              <div className="h-px bg-[var(--border-color)] my-1.5 mx-2" />

              <ContextItem 
                icon={Plus} 
                label={t('desktop.context.newConn')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { setShowNewConnModal(true); closeContext(); }} 
              />
              <ContextItem 
                icon={Terminal} 
                label={t('desktop.context.terminal')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { openWindow('terminal', 'Terminal', <TerminalApp />, Terminal); closeContext(); }} 
              />

              <div className="h-px bg-[var(--border-color)] my-1.5 mx-2" />


              <ContextItem 
                icon={MonitorCog} 
                label={t('desktop.context.display')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { 
                  openWindow('settings', 'Settings', <SettingsApp initialTab="display" />, Settings, { initialWidth: 900, initialHeight: 700 }); 
                  closeContext(); 
                }} 
              />

              <div className="h-px bg-[var(--border-color)] my-1.5 mx-2" />

              <ContextItem 
                icon={Settings} 
                label={t('desktop.context.personalize')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { 
                  openWindow('settings', 'Settings', <SettingsApp initialTab="personalization" />, Settings, { initialWidth: 900, initialHeight: 700 }); 
                  closeContext(); 
                }} 
              />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Modals */}
      {showNewConnModal && (
        <ConnectionModal 
          onClose={() => { setShowNewConnModal(false); setEditConnection(null); }} 
          editConnection={editConnection}
        />
      )}

      <DesktopModal />
      <PWAHandler />
      <SpotlightSearch />
      <PreviewWindow isOpen={showPreview} onClose={() => setShowPreview(false)} />

      {/* Notifications */}
      <NotificationCenter />

      {/* Drop Menu - Choose Terminal or Files */}
      <AnimatePresence>
        {dropMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[30000] w-56 rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden"
            style={{
              top: Math.min(dropMenu.y, window.innerHeight - 200),
              left: Math.min(dropMenu.x, window.innerWidth - 240),
              background: 'var(--window-bg)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px var(--border-color)',
            }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--border-color)]/30">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: dropMenu.connection?.color || '#6366f1' }} />
                <span className="text-xs font-bold text-[var(--text-primary)] truncate">{dropMenu.connection?.name}</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">{dropMenu.connection?.host}</p>
            </div>

            <div className="py-1.5">
              {dropMenu.connection?.type === 'database' ? (
                <button
                  onClick={() => openStandaloneDatabase(dropMenu.connection)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-selected)] transition-colors group"
                >
                  <Database size={16} className="text-emerald-400 group-hover:text-[var(--text-selected)]" />
                  <div className="text-left">
                    <span className="text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-selected)] block font-medium">Open Database</span>
                    <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-selected)]/70">Manage Collections & Queries</span>
                  </div>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => openStandaloneTerminal(dropMenu.connection)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-selected)] transition-colors group"
                  >
                    <Terminal size={16} className="text-emerald-400 group-hover:text-[var(--text-selected)]" />
                    <div className="text-left">
                      <span className="text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-selected)] block font-medium">Open Terminal</span>
                      <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-selected)]/70">SSH shell session</span>
                    </div>
                  </button>
                  <button
                    onClick={() => openStandaloneFiles(dropMenu.connection)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-selected)] transition-colors group"
                  >
                    <FolderClosed size={16} className="text-blue-400 group-hover:text-[var(--text-selected)]" />
                    <div className="text-left">
                      <span className="text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-selected)] block font-medium">Open File Manager</span>
                      <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-selected)]/70">Browse remote files</span>
                    </div>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ContextItem({ icon: Icon, label, onClick, onHover, shortcut }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={onHover}
      className="w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md hover:bg-[var(--bg-selected)] active:opacity-80 transition-colors group text-left"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <Icon size={15} className="text-[var(--text-muted)] group-hover:text-[var(--text-selected)] transition-colors flex-shrink-0" />
      <span className="text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-selected)] flex-1">{label}</span>
      {shortcut && <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-selected)]/70">{shortcut}</span>}
    </button>
  );
}

function ContextSubmenuItem({ icon: Icon, label, children, active, onHover, onLeave }) {
  return (
    <div className="relative" onMouseEnter={onHover} onMouseLeave={onLeave}>
      <button
        className={`w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md transition-colors group text-left ${
          active ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-selected)]'
        }`}
        style={{ width: 'calc(100% - 8px)' }}
      >
        <Icon size={15} className={`flex-shrink-0 transition-colors ${active ? 'text-[var(--text-selected)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-selected)]'}`} />
        <span className={`text-[13px] flex-1 transition-colors ${active ? 'text-[var(--text-selected)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-selected)]'}`}>{label}</span>
        <ChevronRight size={12} className={`flex-shrink-0 transition-colors ${active ? 'text-[var(--text-selected)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-selected)]'}`} />
      </button>
      {active && (
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.1 }}
          className="absolute left-full top-0 ml-0.5 w-52 py-1.5 rounded-lg border border-[var(--border-color)] shadow-2xl z-10"
          style={{
            background: 'var(--window-bg)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
          }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

function ContextRadioItem({ label, checked, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md hover:bg-[var(--bg-selected)] transition-colors group text-left"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
        checked ? 'border-[var(--accent-indigo)] bg-[var(--bg-selected)]' : 'border-[var(--text-muted)]'
      }`}>
        {checked && <Check size={10} className="text-[var(--text-selected)]" strokeWidth={4} />}
      </span>
      <span className={`text-[13px] ${checked ? 'text-[var(--text-selected)]' : 'text-[var(--text-secondary)]'} group-hover:text-[var(--text-selected)]`}>{label}</span>
    </button>
  );
}
