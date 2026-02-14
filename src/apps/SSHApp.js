'use client';

import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import TerminalTabs from '@/components/TerminalTabs';
import FileTabs from '@/components/FileTabs';

import ConnectionModal from '@/components/ConnectionModal';
import { useApp } from '@/context/AppContext';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'react-hot-toast';


export default function SSHApp() {
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
    <div className="flex h-full w-full bg-[#0f172a] text-gray-100 font-sans overflow-hidden relative">
      <Sidebar 
        onNewConnection={handleNewConnection} 
        onEditConnection={handleEditConnection} 
      />

      <div className="flex-1 flex flex-col min-w-0 bg-[#0f172a] relative">
        {/* Top Navigation */}
        <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-[#0f172a]/50 backdrop-blur-md sticky top-0 z-10">
           <div className="flex items-center gap-4">
             <div className="flex bg-white/5 p-1 rounded-lg">
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'dashboard' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'dashboard'
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-gray-400 hover:text-white hover:bg-white/5'
                 }`}
               >
                  {t('ssh.dashboard')}
               </button>
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'terminal' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'terminal'
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-gray-400 hover:text-white hover:bg-white/5'
                 }`}
               >
                  {t('ssh.terminal')}
               </button>
               <button
                 onClick={() => dispatch({ type: 'SET_VIEW', payload: 'files' })}
                 className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                   state.view === 'files'
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                     : 'text-gray-400 hover:text-white hover:bg-white/5'
                 }`}
               >
                  {t('ssh.fileGui')}
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
