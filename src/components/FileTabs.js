'use client';

import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { X, Folder, Plus, Upload } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FileLayout from '@/components/FileLayout';

export default function FileTabs() {
  const { state, dispatch } = useApp();
  const { t } = useTranslation();
  const { activeFileManagers } = state;
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('application/ssh-connection')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only trigger if we're actually leaving the container
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);

    const data = e.dataTransfer.getData('application/ssh-connection');
    if (!data) return;

    try {
      const conn = JSON.parse(data);
      
      // Don't open for database connections
      if (conn.type === 'database') return;

      // Check if a file manager for this connection already exists — focus it
      const existingFM = state.activeFileManagers.find(f => f.connectionId === conn._id);
      if (existingFM) {
        dispatch({ type: 'SET_ACTIVE_FILE_MANAGER', payload: existingFM.id });
        return;
      }

      // Open the file manager directly
      dispatch({
        type: 'OPEN_FILE_MANAGER',
        payload: {
          id: `files-${conn._id}-${Date.now()}`,
          connectionId: conn._id,
          connectionName: conn.name,
          color: conn.color,
          connection: conn,
        },
      });
    } catch (err) {
      console.error('Drop parse error:', err);
    }
  }, [state.activeFileManagers, dispatch]);

  if (activeFileManagers.length === 0) {
    return (
      <div 
        className="h-full flex items-center justify-center bg-[var(--bg-primary)] relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop highlight overlay */}
        {isDragOver && (
          <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-[var(--accent-indigo)] bg-[var(--accent-indigo)]/10 flex items-center justify-center z-10 pointer-events-none transition-all animate-pulse">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-[var(--accent-indigo)]/20 flex items-center justify-center">
                <Upload size={28} className="text-[var(--accent-indigo)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--accent-indigo)]">
                {t('files.dropToOpen') || 'Drop to open file manager'}
              </span>
            </div>
          </div>
        )}

        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-xl"
            style={{ background: 'var(--glow-indigo)', border: '1px solid var(--accent-indigo)' }}>
            <Folder size={36} className="text-[var(--accent-indigo)]" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-[var(--text-primary)] tracking-tight">
            {t('files.noActive') || 'No active file managers'}
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-xs mx-auto">
            {t('files.dragHint') || 'Select a connection in the sidebar or drag a server here to open its file manager.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop highlight overlay when file managers are already open */}
      {isDragOver && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-[var(--accent-indigo)] bg-[var(--accent-indigo)]/10 flex items-center justify-center z-50 pointer-events-none transition-all">
          <div className="flex flex-col items-center gap-3 bg-[var(--bg-primary)]/80 backdrop-blur-sm px-8 py-6 rounded-2xl border border-[var(--accent-indigo)]/30 shadow-xl">
            <Upload size={24} className="text-[var(--accent-indigo)]" />
            <span className="text-sm font-semibold text-[var(--accent-indigo)]">
              {t('files.dropToOpen') || 'Drop to open file manager'}
            </span>
          </div>
        </div>
      )}
      <FileLayout />
    </div>
  );
}
