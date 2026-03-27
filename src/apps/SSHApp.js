'use client';

import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import TerminalTabs from '@/components/TerminalTabs';
import FileTabs from '@/components/FileTabs';

import ConnectionModal from '@/components/ConnectionModal';
import { useApp } from '@/context/AppContext';
import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, PanelLeft, ChevronLeft, ChevronRight } from 'lucide-react';

import dynamic from 'next/dynamic';

const DatabaseBrowser = dynamic(() => import('@/components/DatabaseBrowser'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center bg-transparent rounded-3xl opacity-50 italic"> {typeof window !== 'undefined' && window.localStorage ? (require('@/lib/i18n').default.t('common.loading')) : 'Loading...'} </div>
});



export default function SSHApp({ windowId }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
  const [selectedConnection, setSelectedConnection] = useState(null);

  // When switching back to the terminal view, signal all TerminalView instances
  // to re-fit and refresh their viewport (fixes garbled text after tab switch).
  useEffect(() => {
    if (state.view === 'terminal') {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('terminal:view-activated'));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [state.view]);

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

  return (
    <div className="flex h-full w-full bg-transparent text-[var(--text-primary)] font-sans overflow-hidden relative">
      <Sidebar 
        onNewConnection={handleNewConnection} 
        onEditConnection={handleEditConnection} 
      />

      {/* Middle Sidebar Toggle Handle (The "Blade") */}
      <button
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        className={`absolute top-1/2 -translate-y-1/2 z-[100] w-6 h-16 flex flex-col items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-r-xl transition-all duration-300 shadow-[4px_0_15px_rgba(0,0,0,0.5)] group overflow-hidden ${state.sidebarOpen ? 'opacity-30 hover:opacity-100 hover:w-7' : 'opacity-100 w-8 bg-[var(--accent-indigo)] border-l-transparent'}`}
        style={{ 
          left: state.sidebarOpen ? '320px' : '0', 
          marginLeft: '-1px',
        }}
        title={state.sidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
      >
        <div className="flex flex-col items-center gap-1">
           <div className={`w-1 h-1 rounded-full ${state.sidebarOpen ? 'bg-[var(--text-primary)]/30 group-hover:bg-[var(--text-primary)]/60' : 'bg-[var(--text-primary)]/30 group-hover:bg-[var(--text-primary)]/60'}`} />
           {state.sidebarOpen ? (
             <ChevronLeft size={16} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
           ) : (
             <ChevronRight size={18} className="text-[var(--text-primary)] animate-pulse" />
           )}
           <div className={`w-1 h-1 rounded-full ${state.sidebarOpen ? 'bg-[var(--text-primary)]/30 group-hover:bg-[var(--text-primary)]/60' : 'bg-[var(--text-primary)]/30 group-hover:bg-[var(--text-primary)]/60'}`} />
        </div>
        
        {/* Visual feedback glow */}
        <div className="absolute inset-0 bg-[var(--text-primary)]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>

      <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
        {/* Top Navigation */}
        <div className="h-14 border-b border-[var(--border-color)] flex items-center px-6 bg-[var(--bg-primary)]/20 backdrop-blur-md sticky top-0 z-10">
           <div className="flex items-center gap-4 flex-1">
             {/* Left space for sidebar toggle alignment if needed */}
           </div>

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

            <div className="flex-1"></div>
        </div>

        <main className="flex-1 overflow-y-auto relative custom-scrollbar p-6">
          {/* Dashboard View */}
          <div className={state.view === 'dashboard' ? 'block h-full' : 'hidden h-full'}>
            <Dashboard 
              onNewConnection={handleNewConnection}
              onEditConnection={handleEditConnection}
            />
          </div>

          {/* Terminal View */}
          <div className={state.view === 'terminal' ? 'block h-full' : 'hidden h-full'}>
            <TerminalTabs windowId={windowId} />
          </div>

          {/* File Explorer View */}
          <div className={state.view === 'files' ? 'block h-full' : 'hidden h-full'}>
            <FileTabs />
          </div>

          {/* Database Viewer View */}
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
