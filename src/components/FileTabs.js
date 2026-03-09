'use client';

import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { X, Folder, Plus } from 'lucide-react';
import { useState } from 'react';

import FileLayout from '@/components/FileLayout';

export default function FileTabs() {
  const { state } = useApp();
  const { activeFileManagers } = state;

  if (activeFileManagers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-xl"
            style={{ background: 'var(--glow-indigo)', border: '1px solid var(--accent-indigo)' }}>
            <Folder size={36} className="text-[var(--accent-indigo)]" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-[var(--text-primary)] tracking-tight">
            No active file managers
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-xs mx-auto">
            Select a connection in the sidebar or drag a server here to open its file manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      <FileLayout />
    </div>
  );
}

