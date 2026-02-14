'use client';

import { useOS } from '@/context/OSContext';
import DesktopIcon from '@/components/Desktop/DesktopIcon';
import Window from '@/components/Desktop/Window';
import Taskbar from '@/components/Desktop/Taskbar';
import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import { 
  Terminal, Settings, FolderClosed, Monitor, RefreshCw, Plus, 
  Image as ImageIcon, Layout, Grid, List, AlignLeft, SortAsc,
  ChevronRight, Type, Calendar, HardDrive, Palette, MonitorCog, Globe
} from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { useState, useEffect, useRef, cloneElement, isValidElement } from 'react';
import ConnectionModal from '@/components/ConnectionModal';
import { useApp } from '@/context/AppContext';
import TerminalApp from '@/apps/TerminalApp';
import FilesApp from '@/apps/FilesApp';
import FileManager from '@/components/FileManager';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export default function DesktopEnvironment() {
  const { t } = useTranslation();
  const { state: osState, openWindow, setGlassmorphism, setIconSize, setSortBy, setWallpaper, updateIconPosition, setLanguage, setSelectedIcons, updateMultipleIconPositions } = useOS();
  const { windows, iconSize, sortBy } = osState;
  const { fetchConnections } = useApp();
  
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

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setBooting(false), 2000);
    return () => clearTimeout(timer);
  }, []);

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
    { id: 'ssh-manager', title: t('ssh.manager'), icon: Monitor, component: <SSHApp />, type: 'app', initialWidth: 1200, initialHeight: 750 },
    { id: 'terminal', title: t('ssh.terminal'), icon: Terminal, component: <TerminalApp onEditConnection={handleEditConnection} />, type: 'app', initialWidth: 900, initialHeight: 600 },
    { id: 'files', title: t('ssh.fileGui'), icon: FolderClosed, component: <FilesApp onEditConnection={handleEditConnection} />, type: 'app', initialWidth: 900, initialHeight: 600 },
    { id: 'settings', title: t('common.settings'), icon: Settings, component: <SettingsApp />, type: 'app', initialWidth: 700, initialHeight: 500 },
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
    const maxHeight = window.innerHeight - 100; // Account for taskbar
    
    let currentX = PADDING;
    let currentY = PADDING;

    sorted.forEach((icon) => {
      updateIconPosition(icon.id, currentX, currentY);
      
      currentY += GRID_Y;
      if (currentY + GRID_Y > maxHeight) {
        currentY = PADDING;
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
    e.preventDefault();
    e.stopPropagation();
    const clickedInsideWindow = e.target.closest('.window-container');
    const clickedInsideTaskbar = e.target.closest('.taskbar');
    const clickedInsideIcon = e.target.closest('.desktop-icon');
    
    if (!clickedInsideWindow && !clickedInsideTaskbar && !clickedInsideIcon) {
      setActiveSubmenu(null);
      
      let x = e.clientX;
      let y = e.clientY;
      
      const menuWidth = 256; 
      const menuHeight = 400; 
      
      if (x + menuWidth > window.innerWidth) x -= menuWidth;
      if (y + menuHeight > window.innerHeight - 48) y -= menuHeight;
      if (y < 10) y = 10;
      
      setContextMenu({ x, y });
    }
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
      setDropMenu({ x: e.clientX, y: e.clientY, connection: conn });
    } catch (err) {
      console.error('Drop parse error:', err);
    }
  };

  const openStandaloneTerminal = (conn) => {
    const winId = `standalone-term-${conn._id}-${Date.now()}`;
    openWindow(
      winId,
      conn.name,
      <TerminalApp onEditConnection={handleEditConnection} initialConnection={conn} />,
      Terminal,
      { initialWidth: 900, initialHeight: 600, appType: 'terminal', props: { initialConnection: conn } }
    );
    setDropMenu(null);
  };

  const openStandaloneFiles = (conn) => {
    const winId = `standalone-files-${conn._id}-${Date.now()}`;
    openWindow(
      winId,
      `Files: ${conn.name}`,
      <FilesApp onEditConnection={handleEditConnection} initialConnection={conn} />,
      FolderClosed,
      { initialWidth: 900, initialHeight: 600, appType: 'files-app', props: { initialConnection: conn } }
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
      const offsetY = taskbarPos === 'top' ? 56 : 0;

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
      case 'top': return 'pt-14';
      case 'bottom': return 'pb-14';
      case 'left': return 'pl-16';
      case 'right': return 'pr-16';
      default: return 'pb-14';
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
            className="fixed inset-0 z-[50000] bg-[#0a0e1a] flex flex-col items-center justify-center"
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
              <h1 className="text-white font-bold text-xl tracking-widest uppercase mb-2">Webtop OS</h1>
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
        >
          {DESKTOP_ICONS.map((icon, idx) => (
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
      {windows.map(win => {
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
          />
        );
      })}

      {/* Taskbar */}
      <Taskbar />

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[20000] w-64 rounded-lg border border-white/[0.08] shadow-2xl overflow-visible"
            style={{ 
              top: contextMenu.y, 
              left: contextMenu.x,
              background: osState.glassmorphism ? 'rgba(20, 27, 45, 0.95)' : '#141b2d',
              backdropFilter: 'blur(24px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
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
                <div className="h-px bg-white/[0.1] my-1" />
                <ContextRadioItem label="None (Manual)" checked={!sortBy || sortBy === 'none'} onClick={() => { setSortBy('none'); closeContext(); }} />
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

              <div className="h-px bg-white/[0.06] my-1.5 mx-2" />

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

              <div className="h-px bg-white/[0.06] my-1.5 mx-2" />

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

              <div className="h-px bg-white/[0.06] my-1.5 mx-2" />


              <ContextItem 
                icon={MonitorCog} 
                label={t('desktop.context.display')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { openWindow('settings', 'Settings', <SettingsApp />, Settings); closeContext(); }} 
              />

              <div className="h-px bg-white/[0.06] my-1.5 mx-2" />

              <ContextItem 
                icon={Settings} 
                label={t('desktop.context.personalize')} 
                onHover={() => setActiveSubmenu(null)}
                onClick={() => { openWindow('settings', 'Settings', <SettingsApp />, Settings); closeContext(); }} 
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      {showNewConnModal && (
        <ConnectionModal 
          onClose={() => { setShowNewConnModal(false); setEditConnection(null); }} 
          editConnection={editConnection}
        />
      )}

      {/* Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
          },
        }}
      />

      {/* Drop Menu - Choose Terminal or Files */}
      <AnimatePresence>
        {dropMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[30000] w-56 rounded-xl border border-white/[0.08] shadow-2xl overflow-hidden"
            style={{
              top: Math.min(dropMenu.y, window.innerHeight - 200),
              left: Math.min(dropMenu.x, window.innerWidth - 240),
              background: 'rgba(15, 23, 42, 0.97)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: dropMenu.connection?.color || '#6366f1' }} />
                <span className="text-xs font-bold text-white truncate">{dropMenu.connection?.name}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{dropMenu.connection?.host}</p>
            </div>

            <div className="py-1.5">
              <button
                onClick={() => openStandaloneTerminal(dropMenu.connection)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-500/90 transition-colors group"
              >
                <Terminal size={16} className="text-emerald-400 group-hover:text-white" />
                <div className="text-left">
                  <span className="text-[13px] text-gray-200 group-hover:text-white block font-medium">Open Terminal</span>
                  <span className="text-[10px] text-gray-500 group-hover:text-white/70">SSH shell session</span>
                </div>
              </button>
              <button
                onClick={() => openStandaloneFiles(dropMenu.connection)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-500/90 transition-colors group"
              >
                <FolderClosed size={16} className="text-blue-400 group-hover:text-white" />
                <div className="text-left">
                  <span className="text-[13px] text-gray-200 group-hover:text-white block font-medium">Open File Manager</span>
                  <span className="text-[10px] text-gray-500 group-hover:text-white/70">Browse remote files</span>
                </div>
              </button>
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
      className="w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md hover:bg-blue-500/90 active:bg-blue-600 transition-colors group text-left"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <Icon size={15} className="text-gray-400 group-hover:text-white transition-colors flex-shrink-0" />
      <span className="text-[13px] text-gray-200 group-hover:text-white flex-1">{label}</span>
      {shortcut && <span className="text-[11px] text-gray-500 group-hover:text-white/70">{shortcut}</span>}
    </button>
  );
}

function ContextSubmenuItem({ icon: Icon, label, children, active, onHover, onLeave }) {
  return (
    <div className="relative" onMouseEnter={onHover} onMouseLeave={onLeave}>
      <button
        className={`w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md transition-colors group text-left ${
          active ? 'bg-blue-500/90' : 'hover:bg-blue-500/90'
        }`}
        style={{ width: 'calc(100% - 8px)' }}
      >
        <Icon size={15} className={`flex-shrink-0 transition-colors ${active ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
        <span className={`text-[13px] flex-1 transition-colors ${active ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>{label}</span>
        <ChevronRight size={12} className={`flex-shrink-0 transition-colors ${active ? 'text-white' : 'text-gray-500 group-hover:text-white'}`} />
      </button>
      {active && (
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.1 }}
          className="absolute left-full top-0 ml-0.5 w-52 py-1.5 rounded-lg border border-white/[0.08] shadow-2xl z-10"
          style={{
            background: 'rgba(20, 27, 45, 0.97)',
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
      className="w-full flex items-center gap-3 px-3 py-[6px] mx-1 rounded-md hover:bg-blue-500/90 transition-colors group text-left"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
        checked ? 'border-blue-400 bg-blue-500' : 'border-gray-500'
      }`}>
        {checked && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
      </span>
      <span className="text-[13px] text-gray-200 group-hover:text-white">{label}</span>
    </button>
  );
}
