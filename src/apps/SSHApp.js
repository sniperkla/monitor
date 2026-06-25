'use client';

import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import TerminalTabs from '@/components/TerminalTabs';
import FileTabs from '@/components/FileTabs';

import ConnectionModal from '@/components/ConnectionModal';
import { useApp } from '@/context/AppContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import dynamic from 'next/dynamic';

const DatabaseBrowser = dynamic(() => import('@/components/DatabaseBrowser'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center bg-transparent rounded-3xl opacity-50 italic"> {typeof window !== 'undefined' && window.localStorage ? (require('@/lib/i18n').default.t('common.loading')) : 'Loading...'} </div>
});

const MIN_SIDEBAR_W = 180;
const MAX_SIDEBAR_W = 480;
const DEFAULT_SIDEBAR_W = 260;

export default function SSHApp({ windowId }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [selectedConnection, setSelectedConnection] = useState(null);

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_W);
  const [isResizingActive, setIsResizingActive] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // When switching back to terminal, signal all TerminalView instances to re-fit
  useEffect(() => {
    if (state.view === 'terminal') {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('terminal:view-activated'));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [state.view]);

  // Also re-fit terminals whenever sidebarWidth or open state changes
  useEffect(() => {
    if (state.view === 'terminal') {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('terminal:view-activated'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sidebarWidth, state.sidebarOpen, state.view]);

  const handleNewConnection = () => {
    setModalMode('add');
    setSelectedConnection(null);
    setIsModalOpen(true);
  };

  const handleEditConnection = (conn) => {
    setModalMode('edit');
    setSelectedConnection(conn);
    setIsModalOpen(true);
  };

  // ── Drag-to-resize handlers ──────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizing.current = true;
    setIsResizingActive(true);
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;

    const onMouseMove = (mv) => {
      if (!isResizing.current) return;
      const delta = mv.clientX - startX.current;
      const next = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, startWidth.current + delta));
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      setIsResizingActive(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('terminal:view-activated'));
      }, 80);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  return (
    <div className="flex h-full w-full bg-transparent text-[var(--text-primary)] font-sans overflow-hidden relative">
      {/* Sidebar with dynamic width */}
      <div
        style={{
          width: state.sidebarOpen ? sidebarWidth : 0,
          minWidth: state.sidebarOpen ? sidebarWidth : 0,
          overflow: 'hidden',
          transition: isResizingActive ? 'none' : 'width 0.3s ease, min-width 0.3s ease',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {state.sidebarOpen && (
          <Sidebar
            onNewConnection={handleNewConnection}
            onEditConnection={handleEditConnection}
            width={sidebarWidth}
          />
        )}
      </div>

      {/* Resize Handle + Collapse Blade */}
      <div
        className="relative z-[100] flex-shrink-0 group/resizer"
        style={{ width: state.sidebarOpen ? '10px' : '0px', transition: 'width 0.3s ease' }}
      >
        {state.sidebarOpen && (
          <>
            {/* Drag resize strip */}
            <div
              className="absolute inset-0 cursor-col-resize hover:bg-[var(--accent-indigo)]/30 transition-colors duration-150"
              onMouseDown={onResizeMouseDown}
              style={{ borderRight: '1px solid var(--border-color)' }}
            />
            {/* Draggable visual indicator dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover/resizer:opacity-60 transition-opacity pointer-events-none">
              <div className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
              <div className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
              <div className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
            </div>
          </>
        )}

        {/* Collapse / Expand Blade */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
          className={`absolute top-1/2 -translate-y-1/2 z-10 w-5 h-14 flex flex-col items-center justify-center rounded-r-lg transition-all duration-300 shadow-[3px_0_12px_rgba(0,0,0,0.4)] group overflow-hidden ${
            state.sidebarOpen
              ? 'bg-[var(--bg-tertiary)] border border-[var(--border-color)] opacity-0 group-hover/resizer:opacity-100'
              : 'bg-[var(--accent-indigo)] border border-[var(--accent-indigo)] opacity-100 w-7'
          }`}
          style={{ left: '100%', marginLeft: '-1px' }}
          title={state.sidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
        >
          {state.sidebarOpen ? (
            <ChevronLeft size={14} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
          ) : (
            <ChevronRight size={16} className="text-white animate-pulse" />
          )}
        </button>
      </div>

      {/* Main content area — restored original structure */}
      <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
        {/* Top Navigation */}
        <div className="h-14 border-b border-[var(--border-color)] flex items-center px-6 bg-[var(--bg-primary)]/20 backdrop-blur-md sticky top-0 z-10">
           <div className="flex items-center gap-4 flex-1" />

           {/* Centered Navigation */}
           <div className="flex bg-[var(--bg-tertiary)]/30 p-1 rounded-lg">
             <button
               onClick={() => dispatch({ type: 'SET_VIEW', payload: 'dashboard' })}
               className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                 state.view === 'dashboard'
                   ? 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-lg shadow-[var(--glow-indigo)]/20 border border-[var(--accent-indigo)]/30'
                   : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
               }`}
             >
                {t('ssh.dashboard')}
             </button>
             <button
               onClick={() => dispatch({ type: 'SET_VIEW', payload: 'terminal' })}
               className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                 state.view === 'terminal'
                   ? 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-lg shadow-[var(--glow-indigo)]/20 border border-[var(--accent-indigo)]/30'
                   : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
               }`}
             >
                {t('ssh.terminal')}
             </button>
             <button
               onClick={() => dispatch({ type: 'SET_VIEW', payload: 'files' })}
               className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                 state.view === 'files'
                   ? 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-lg shadow-[var(--glow-indigo)]/20 border border-[var(--accent-indigo)]/30'
                   : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
               }`}
             >
                {t('ssh.fileGui')}
             </button>
              <button
                onClick={() => dispatch({ type: 'SET_VIEW', payload: 'database' })}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                  state.view === 'database'
                    ? 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-lg shadow-[var(--glow-indigo)]/20 border border-[var(--accent-indigo)]/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
                }`}
              >
                 {t('common.database')}
              </button>
            </div>

            <div className="flex-1" />
        </div>

        {/* Terminal view: zero padding, fills full area via absolute inset */}
        <div className={state.view === 'terminal' ? 'flex-1 relative overflow-hidden' : 'hidden h-full'}>
          <TerminalTabs windowId={windowId} />
        </div>

        {/* All other views: use the original padded scrollable main */}
        <main className={state.view !== 'terminal' ? 'flex-1 overflow-y-auto relative custom-scrollbar p-6' : 'hidden h-full'}>
          <div className={state.view === 'dashboard' ? 'block h-full' : 'hidden h-full'}>
            <Dashboard
              onNewConnection={handleNewConnection}
              onEditConnection={handleEditConnection}
            />
          </div>
          <div className={state.view === 'files' ? 'block h-full' : 'hidden h-full'}>
            <FileTabs />
          </div>
          <div className={state.view === 'database' ? 'block h-full' : 'hidden h-full'}>
            <DatabaseBrowser
              onNewConnection={handleNewConnection}
              onEditConnection={handleEditConnection}
            />
          </div>
        </main>
      </div>

      {isModalOpen && (
        <ConnectionModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setSelectedConnection(null); }}
          editConnection={modalMode === 'edit' ? selectedConnection : null}
        />
      )}
    </div>
  );
}
