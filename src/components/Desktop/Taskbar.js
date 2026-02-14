'use client';

import { useOS } from '@/context/OSContext';
import { Terminal, Settings, LayoutGrid, Monitor, Wifi, Volume2, Search, Power, User, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';

export default function Taskbar() {
  const { state, focusWindow, toggleMinimize, openWindow, closeWindow, setTaskbarPosition, saveSettings } = useOS();
  const { data: session } = useSession();
  const { t } = useTranslation();
  const { windows, activeWindowId, glassmorphism, taskbarPosition } = state;
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, windowId }
  const [taskbarContextMenu, setTaskbarContextMenu] = useState(null); // { x, y }
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
    
    const menuWidth = winId ? 160 : 224;
    const menuHeight = winId ? 100 : 380;
    
    let x = e.clientX;
    let y = e.clientY;

    // Adjust positioning based on taskbar position
    if (taskbarPosition === 'bottom') y = window.innerHeight - menuHeight - 56;
    else if (taskbarPosition === 'top') y = 56;
    else if (taskbarPosition === 'left') x = 60;
    else if (taskbarPosition === 'right') x = window.innerWidth - menuWidth - 60;

    if (winId) {
      setContextMenu({ x, y, windowId: winId });
      setTaskbarContextMenu(null);
    } else {
      setTaskbarContextMenu({ x, y });
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
    { id: 'ssh-manager', title: t('ssh.manager'), icon: Monitor, component: <SSHApp /> },
    { id: 'settings', title: t('common.settings'), icon: Settings, component: <SettingsApp /> },
    { id: 'terminal', title: t('terminal.title'), icon: Terminal, component: <div className="p-8 text-center text-gray-400">{t('terminal.comingSoon')}</div> },
  ];

  const isVertical = taskbarPosition === 'left' || taskbarPosition === 'right';
  
  const taskbarClasses = `
    taskbar fixed z-[10000] transition-all duration-300 border-white/10
    ${taskbarPosition === 'bottom' ? 'bottom-0 left-0 w-full h-12 border-t' : ''}
    ${taskbarPosition === 'top' ? 'top-0 left-0 w-full h-12 border-b' : ''}
    ${taskbarPosition === 'left' ? 'top-0 left-0 h-full w-14 border-r' : ''}
    ${taskbarPosition === 'right' ? 'top-0 right-0 h-full w-14 border-l' : ''}
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
            onDrop={() => { setTaskbarPosition('top'); setIsDraggingTaskbar(false); }}
            className="absolute top-0 left-0 w-full h-24 bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={() => { setTaskbarPosition('bottom'); setIsDraggingTaskbar(false); }}
            className="absolute bottom-0 left-0 w-full h-24 bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={() => { setTaskbarPosition('left'); setIsDraggingTaskbar(false); }}
            className="absolute top-0 left-0 w-24 h-full bg-blue-500 opacity-0 transition-opacity pointer-events-auto" 
          />
          <div 
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.opacity = '0.3'; }}
            onDragLeave={(e) => e.currentTarget.style.opacity = '0'}
            onDrop={() => { setTaskbarPosition('right'); setIsDraggingTaskbar(false); }}
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
          background: glassmorphism ? 'rgba(15, 23, 42, 0.9)' : '#0f172a',
          backdropFilter: glassmorphism ? 'blur(12px)' : 'none',
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          alignItems: 'center',
          padding: isVertical ? '0.5rem 0' : '0 1rem',
          cursor: 'default'
        }}
      >
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center gap-2 relative ${isVertical ? 'py-2' : ''}`} ref={startMenuRef}>
          <button 
            onClick={() => {
              setStartMenuOpen(!startMenuOpen);
              setContextMenu(null);
            }}
            className={`w-10 h-10 rounded-lg transition-all flex items-center justify-center shadow-lg shrink-0 ${
              startMenuOpen ? 'bg-blue-500 scale-95' : 'bg-blue-600 hover:bg-blue-500 active:scale-90'
            }`}
          >
            <LayoutGrid size={20} className="text-white" />
          </button>

          <AnimatePresence>
            {startMenuOpen && (
              <motion.div
                {...menuAnim}
                className="w-80 rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
                style={{
                  ...getStartMenuStyle(),
                  background: glassmorphism ? 'rgba(15, 23, 42, 0.95)' : '#0f172a',
                  backdropFilter: 'blur(24px)',
                  zIndex: 10002,
                }}
              >
                {/* Start Menu Header */}
                <div className="p-4 bg-white/5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {session ? (
                      <>
                        <img 
                          src={session.user.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`} 
                          className="w-8 h-8 rounded-full border border-white/10 object-cover" 
                          alt="Avatar" 
                          onError={(e) => {
                            e.target.onerror = null; 
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`;
                          }}
                        />
                        <div className="min-w-0">
                          <span className="block text-sm font-semibold text-white truncate">{session.user.name}</span>
                          <span className="block text-[10px] text-gray-500 truncate">{session.user.email}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center">
                          <User size={16} className="text-white" />
                        </div>
                        <span className="text-sm font-semibold text-white">{t('common.guestUser')}</span>
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
                    className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <Power size={18} />
                  </button>
                </div>

                {/* Start Menu Search */}
                <div className="p-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                    <input 
                      type="text" 
                      placeholder={t('desktop.taskbar.search')}
                      className="w-full bg-black/20 border border-white/5 rounded-lg py-2 pl-9 pr-4 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                </div>

                {/* App List */}
                <div className="px-2 pb-4 space-y-1">
                  <h3 className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t('desktop.taskbar.pinned')}</h3>
                  {apps.map(app => (
                    <button
                      key={app.id}
                      onClick={() => {
                        openWindow(app.id, app.title, app.component, app.icon);
                        setStartMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors group"
                    >
                      <div className={`p-2 rounded-lg bg-gray-800 group-hover:bg-gray-700 text-blue-400`}>
                        <app.icon size={18} />
                      </div>
                      <div className="text-left">
                        <span className="block text-sm font-medium text-gray-200">{app.title}</span>
                        <span className="block text-[10px] text-gray-500">{t('desktop.taskbar.systemApp')}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={isVertical ? 'h-px w-8 bg-white/10 my-1' : 'w-px h-8 bg-white/10 mx-2'} />
        </div>

        <div className={`flex-1 flex ${isVertical ? 'flex-col overflow-y-auto no-scrollbar py-1' : 'flex-row items-center overflow-x-auto no-scrollbar px-2'} gap-1.5 relative ${isVertical ? 'items-center' : ''}`}>
          {windows.map(win => (
            <button
              key={win.id}
              onClick={() => {
                if (contextMenu) setContextMenu(null);
                win.isMinimized ? toggleMinimize(win.id) : focusWindow(win.id);
              }}
              onContextMenu={(e) => handleContextMenu(e, win.id)}
              title={win.title}
              className={`
                rounded-xl flex items-center gap-2 transition-all border relative group shrink-0
                ${isVertical ? 'w-10 h-10 justify-center mx-auto' : 'h-9 px-3 min-w-[140px] max-w-[200px]'}
                ${activeWindowId === win.id && !win.isMinimized
                  ? 'bg-white/15 border-white/20'
                  : 'bg-white/5 hover:bg-white/10 border-transparent'}
              `}
            >
              {win.icon && <win.icon size={16} className="text-blue-400 group-hover:scale-110 transition-transform shrink-0" />}
              {!isVertical && <span className="text-xs font-medium text-gray-200 truncate">{win.title}</span>}
              {activeWindowId === win.id && !win.isMinimized && (
                <motion.div 
                  layoutId="taskbar-active" 
                  className={`absolute bg-blue-500 rounded-full ${
                    isVertical 
                      ? (taskbarPosition === 'left' ? 'right-0 top-2 bottom-2 w-0.5' : 'left-0 top-2 bottom-2 w-0.5')
                      : 'bottom-0 left-2 right-2 h-0.5'
                  }`} 
                />
              )}
            </button>
          ))}

          {/* Taskbar Context Menu */}
          <AnimatePresence>
            {contextMenu && (
              <motion.div
                ref={contextMenuRef}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="fixed z-[10001] w-40 bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl p-1 overflow-hidden"
                style={{ 
                  left: contextMenu.x,
                  top: contextMenu.y
                }}
              >
                <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-white/5 mb-1">
                  {windows.find(w => w.id === contextMenu.windowId)?.title || 'Application'}
                </div>
                <button
                  onClick={() => {
                    closeWindow(contextMenu.windowId);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded flex items-center gap-2 transition-colors hover:text-red-400"
                >
                  <X size={14} className="text-red-400" />
                  {t('common.close')} 
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Taskbar Context Menu (Empty Space) */}
          <AnimatePresence>
            {taskbarContextMenu && (
              <motion.div
                ref={taskbarContextMenuRef}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="fixed z-[10001] w-56 bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-1.5 overflow-hidden"
                style={{ 
                  left: taskbarContextMenu.x,
                  top: taskbarContextMenu.y 
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-white/5 mb-1.5">
                  Taskbar Options
                </div>
                
                <button
                  onClick={() => { minimizeAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Monitor size={14} className="text-blue-400" />
                  Show Desktop
                </button>
                
                <button
                  onClick={() => { restoreAll(); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <LayoutGrid size={14} className="text-emerald-400" />
                  Restore All Windows
                </button>

                <div className="h-px bg-white/5 my-1.5 mx-2" />

                <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Task Manager
                </div>
                
                <div className="max-h-40 overflow-y-auto no-scrollbar">
                  {windows.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-gray-500 italic">No apps running</div>
                  ) : (
                    windows.map(win => (
                      <div key={win.id} className="flex items-center gap-1 px-1">
                        <button
                          onClick={() => { focusWindow(win.id); setTaskbarContextMenu(null); }}
                          className="flex-1 text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-white/5 rounded-l-md truncate flex items-center gap-2"
                        >
                          {win.icon && <win.icon size={12} className="text-blue-400/70" />}
                          {win.title}
                        </button>
                        <button
                          onClick={() => closeWindow(win.id)}
                          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-r-md transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="h-px bg-white/5 my-1.5 mx-2" />

                <button
                  onClick={() => { openWindow('settings', 'Settings', <SettingsApp />, Settings); setTaskbarContextMenu(null); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Settings size={14} className="text-gray-400" />
                  Taskbar Settings
                </button>

                <div className="h-px bg-white/5 my-1.5 mx-2" />
                <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Position</div>
                <div className="grid grid-cols-2 gap-1 px-1.5 pb-1">
                  {['top', 'bottom', 'left', 'right'].map(pos => (
                    <button
                      key={pos}
                      onClick={() => { setTaskbarPosition(pos); setTaskbarContextMenu(null); }}
                      className={`px-2 py-1.5 text-[10px] rounded uppercase font-bold text-center border transition-all ${
                        taskbarPosition === pos ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={`flex items-center shrink-0 ${isVertical ? 'flex-col gap-3 py-3' : 'flex-row gap-3 ml-4'}`}>
          <LanguageSwitcher vertical={isVertical} taskbarPosition={taskbarPosition} />
          <div className={`flex items-center gap-2 ${isVertical ? 'flex-col py-2' : 'px-3 py-1'} bg-white/5 rounded-full border border-white/5`}>
            <Wifi size={14} className="text-emerald-400" />
            {!isVertical && <Volume2 size={14} className="text-gray-400" />}
          </div>
          {!isVertical && <div className="w-px h-6 bg-white/10" />}
          <Clock vertical={isVertical} />
        </div>
      </div>
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
        className={`${vertical ? 'w-10 h-10' : 'h-8 px-2'} bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 flex flex-col items-center justify-center transition-all`}
      >
        <span className="text-[10px] font-bold text-gray-400 uppercase leading-none">{currentLang?.sub}</span>
        {!vertical && <span className="text-xs font-semibold text-gray-200 leading-none mt-1">{currentLang?.label}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-32 bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden overflow-y-auto max-h-60 custom-scrollbar z-[10002]"
            style={getPopupStyle()}
          >
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                }}
                className={`w-full px-4 py-2 text-left hover:bg-white/10 transition-colors flex items-center justify-between group ${
                  state.language === lang.code ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-300'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-bold">{lang.label}</span>
                  <span className="text-[9px] text-gray-500 group-hover:text-gray-400 uppercase">{lang.sub}</span>
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

function Clock({ vertical }) {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!mounted) return null;

  return (
    <div className={`flex flex-col ${vertical ? 'items-center' : 'items-end'}`}>
      <span className="text-xs font-bold text-white">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      {!vertical && <span className="text-[10px] text-gray-500">{time.toLocaleDateString()}</span>}
    </div>
  );
}
