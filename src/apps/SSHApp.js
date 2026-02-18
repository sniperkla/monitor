'use client';

import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import TerminalTabs from '@/components/TerminalTabs';
import FileTabs from '@/components/FileTabs';

import ConnectionModal from '@/components/ConnectionModal';
import { useApp } from '@/context/AppContext';
import { useState, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';

import dynamic from 'next/dynamic';

const DatabaseBrowser = dynamic(() => import('@/components/DatabaseBrowser'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] opacity-50 italic"> {typeof window !== 'undefined' && window.localStorage ? (require('@/lib/i18n').default.t('common.loading')) : 'Loading...'} </div>
});



export default function SSHApp({ windowId }) {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
  const [selectedConnection, setSelectedConnection] = useState(null);

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
    <div className="flex h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden relative">
      <Sidebar 
        onNewConnection={handleNewConnection} 
        onEditConnection={handleEditConnection} 
      />

      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)] relative">
        {/* Top Navigation */}
        <div className="h-14 border-b border-[var(--border-color)] flex items-center justify-between px-6 bg-[var(--bg-primary)]/50 backdrop-blur-md sticky top-0 z-10">
           <div className="flex items-center gap-4">
             <div className="flex bg-[var(--bg-tertiary)]/30 p-1 rounded-lg">
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'dashboard' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'dashboard'
                     ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
                 }`}
               >
                  {t('ssh.dashboard')}
               </button>
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'terminal' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'terminal'
                     ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
                 }`}
               >
                  {t('ssh.terminal')}
               </button>
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'files' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'files'
                     ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
                 }`}
               >
                  {t('ssh.fileGui')}
               </button>
                <button
                  onClick={() => dispatch({ type: 'SET_VIEW', payload: 'database' })}
                  className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                    state.view === 'database'
                      ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] group'
                  }`}
                >
                   {t('common.database')}
                </button>
              </div>
           </div>
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
            <TerminalTabs />
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
